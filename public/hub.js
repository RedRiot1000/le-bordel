// ===================================================================
//  LE BORDEL — Client du hub (accueil, salon, podium)
//  Les mini-jeux s'enregistrent dans window.GAMES[id] avec :
//    mount(root, api)  -> affiche le jeu dans root
//    update(state)     -> nouvel état public reçu du serveur
//    message(type, p)  -> message privé (ex. ton rôle secret)
//    unmount()         -> nettoyage quand on quitte le jeu
// ===================================================================

const socket = io();

// --- Mémoire locale (pour revenir après une coupure / un F5) ---
const store = {
  get playerId() { return localStorage.getItem("bordel_pid") || ""; },
  set playerId(v) { localStorage.setItem("bordel_pid", v); },
  get code() { return localStorage.getItem("bordel_code") || ""; },
  set code(v) { localStorage.setItem("bordel_code", v); },
  get pseudo() { return localStorage.getItem("bordel_pseudo") || ""; },
  set pseudo(v) { localStorage.setItem("bordel_pseudo", v); },
};

let catalogue = { games: [], upcoming: [] };
let hub = null;            // état du salon reçu du serveur
let bootId = null;         // identifiant du démarrage du serveur
let mounted = null;        // { id, client } du mini-jeu affiché
let lastGameState = null;

const $ = (id) => document.getElementById(id);

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $("screen-" + name).classList.add("active");
}

const isHost = () => hub && hub.hostId === store.playerId;
const playerOf = (id) => hub?.players.find((p) => p.id === id);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Petit rond de couleur avec l'initiale du joueur.
function avatar(p, cls = "mini-avatar") {
  return `<span class="${cls}" style="--av:${p?.color || "var(--accent)"}">${escapeHtml((p?.pseudo || "?").charAt(0).toUpperCase())}</span>`;
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// Ce que chaque mini-jeu peut utiliser côté navigateur.
const api = {
  myId: () => store.playerId,
  isHost,
  players: () => hub?.players || [],
  action: (type, data = {}) => new Promise((res) =>
    socket.emit("gameAction", { type, data }, (r) => res(r || {}))),
  setTheme: (theme) => { document.body.className = theme || "theme-violet"; },
  escapeHtml,
  avatar,
};

// ===================================================================
//  ACCUEIL
// ===================================================================
$("input-pseudo").value = store.pseudo;

// Lien d'invitation (?code=ABCD) -> code pré-rempli.
const urlCode = new URLSearchParams(location.search).get("code");
if (urlCode) $("input-code").value = urlCode.toUpperCase();

$("input-code").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase(); });

function showHomeError(msg) { $("home-error").textContent = msg || ""; }

function enterRoom(res) {
  if (res.error) return showHomeError(res.error);
  store.playerId = res.playerId;
  store.code = res.code;
  showHomeError("");
  // On retire ?code= de l'adresse (sinon F5 ré-essaie de rejoindre).
  if (urlCode) history.replaceState(null, "", location.pathname);
}

$("btn-create").addEventListener("click", () => {
  const pseudo = $("input-pseudo").value.trim();
  if (!pseudo) return showHomeError("Choisis un pseudo d'abord.");
  store.pseudo = pseudo;
  socket.emit("createRoom", { pseudo }, enterRoom);
});

function join() {
  const pseudo = $("input-pseudo").value.trim();
  const code = $("input-code").value.trim().toUpperCase();
  if (!pseudo) return showHomeError("Choisis un pseudo d'abord.");
  if (code.length !== 4) return showHomeError("Le code fait 4 lettres.");
  store.pseudo = pseudo;
  socket.emit("joinRoom", { code, pseudo }, enterRoom);
}
$("btn-join").addEventListener("click", join);
$("input-code").addEventListener("keydown", (e) => { if (e.key === "Enter") join(); });
$("input-pseudo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") ($("input-code").value.length === 4 ? join() : $("btn-create").click());
});

// Retour à l'accueil (salon quitté, expulsé ou disparu).
function backHome(message) {
  unmountGame();
  hub = null;
  store.code = "";
  $("hub-bar").classList.add("hidden");
  api.setTheme("theme-violet");
  showScreen("home");
  if (message) showHomeError(message);
}

// ===================================================================
//  BARRE DU SALON
// ===================================================================
$("btn-leave").addEventListener("click", () => {
  if (!confirm("Quitter le salon ?")) return;
  socket.emit("leaveRoom");
  backHome();
});

$("btn-abort").addEventListener("click", () => {
  if (confirm("Arrêter le jeu en cours ? Personne ne gagnera de points.")) socket.emit("abortGame");
});

function renderBar() {
  $("hub-bar").classList.remove("hidden");
  $("bar-code").textContent = hub.code;
  const online = hub.players.filter((p) => p.connected).length;
  $("bar-online").textContent = `👥 ${online}/${hub.players.length} en ligne`;
  $("btn-abort").classList.toggle("hidden", !(isHost() && hub.phase === "game"));
}

// ===================================================================
//  SALON : joueurs + menu des jeux
// ===================================================================
$("btn-copy").addEventListener("click", async () => {
  const link = `${location.origin}${location.pathname}?code=${hub.code}`;
  try {
    await navigator.clipboard.writeText(link);
    $("btn-copy").textContent = "✅ Copié !";
    setTimeout(() => ($("btn-copy").textContent = "📋 Copier le lien"), 1500);
  } catch {
    prompt("Copie ce lien :", link);
  }
});

function renderLobby() {
  $("room-code").textContent = hub.code;
  $("player-count").textContent = `${hub.players.length}/6`;

  // --- Joueurs (triés par score de soirée) ---
  const list = $("player-list");
  const sorted = [...hub.players].sort((a, b) => b.score - a.score);
  list.innerHTML = sorted.map((p) => `
    <li class="${p.connected ? "" : "offline"}">
      ${avatar(p, "avatar")}
      <span class="name">${escapeHtml(p.pseudo)}${p.id === store.playerId ? " (toi)" : ""}</span>
      ${p.isHost ? '<span class="badge-host">HÔTE</span>' : ""}
      ${!p.connected ? '<span class="tag">hors ligne</span>' : ""}
      <span class="pts">${p.score} pts</span>
      ${isHost() && !p.isHost ? `<button class="kick-btn" data-id="${p.id}" title="Expulser">✕</button>` : ""}
    </li>`).join("");
  list.querySelectorAll(".kick-btn").forEach((b) => {
    b.onclick = () => {
      const p = playerOf(b.dataset.id);
      if (confirm(`Expulser ${p?.pseudo} du salon ?`)) socket.emit("kickPlayer", { playerId: b.dataset.id });
    };
  });

  // --- Menu des jeux ---
  const n = hub.players.length;
  const host = isHost();
  $("games-hint").textContent = host
    ? "Clique sur un jeu pour le lancer."
    : "L'hôte choisit le prochain jeu…";

  const tiles = catalogue.games.map((g) => {
    const ok = n >= g.minPlayers && n <= g.maxPlayers;
    const why = n < g.minPlayers ? ` · il manque ${g.minPlayers - n} joueur(s)` : "";
    return `
      <button class="game-tile" data-id="${g.id}" ${host && ok ? "" : "disabled"}>
        <span class="gt-emoji">${g.emoji}</span>
        <span class="gt-name">${escapeHtml(g.name)}</span>
        <span class="gt-meta">${g.family} · ${g.minPlayers}-${g.maxPlayers} joueurs${why}</span>
        <span class="gt-desc">${escapeHtml(g.description)}</span>
      </button>`;
  });
  const soon = catalogue.upcoming.map((g) => `
      <button class="game-tile soon" disabled>
        <span class="gt-emoji">${g.emoji}</span>
        <span class="gt-name">${escapeHtml(g.name)}</span>
        <span class="gt-meta">${g.family} · bientôt</span>
      </button>`);
  $("game-tiles").innerHTML = tiles.concat(soon).join("");

  $("game-tiles").querySelectorAll(".game-tile:not(.soon)").forEach((b) => {
    b.onclick = () => {
      $("lobby-error").textContent = "";
      socket.emit("pickGame", { gameId: b.dataset.id }, (res) => {
        if (res?.error) $("lobby-error").textContent = res.error;
      });
    };
  });
}

// ===================================================================
//  PODIUM
// ===================================================================
$("btn-close-podium").addEventListener("click", () => socket.emit("closePodium"));

function renderPodium() {
  const r = hub.lastResult;
  const game = catalogue.games.find((g) => g.id === r?.gameId);
  $("podium-title").textContent = `🏆 Résultats — ${game ? game.emoji + " " + game.name : ""}`;
  const medals = ["🥇", "🥈", "🥉"];
  $("podium-list").innerHTML = (r?.results || []).map((x, i) => {
    const p = playerOf(x.playerId);
    return `<li style="animation-delay:${i * 0.12}s">
      <span class="place">${medals[x.place - 1] || x.place + "e"}</span>
      ${avatar(p)}
      <span class="name">${escapeHtml(p?.pseudo || "?")}</span>
      <span class="gain">+${x.points}</span>
    </li>`;
  }).join("");

  const sorted = [...hub.players].sort((a, b) => b.score - a.score);
  $("evening-list").innerHTML = sorted.map((p, i) => `
    <li style="animation-delay:${0.4 + i * 0.08}s">
      <span>${i + 1}</span>${avatar(p)}
      <span class="name">${escapeHtml(p.pseudo)}</span>
      <span class="pts">${p.score} pts</span>
    </li>`).join("");

  $("btn-close-podium").classList.toggle("hidden", !isHost());
  $("podium-wait").classList.toggle("hidden", isHost());
}

// ===================================================================
//  MINI-JEU : affichage / retrait
// ===================================================================
function mountGame(gameId) {
  if (mounted?.id === gameId) return;
  unmountGame();
  const client = window.GAMES[gameId];
  if (!client) { toast(`Jeu "${gameId}" introuvable dans cette version.`); return; }
  $("game-root").innerHTML = "";
  client.mount($("game-root"), api);
  mounted = { id: gameId, client };
}

function unmountGame() {
  if (!mounted) return;
  try { mounted.client.unmount(); } catch (e) { console.error(e); }
  mounted = null;
  lastGameState = null;
  $("game-root").innerHTML = "";
  api.setTheme("theme-violet");
}

// ===================================================================
//  RÉCEPTION DU SERVEUR
// ===================================================================
socket.on("welcome", (info) => {
  // Le serveur a redémarré (mise à jour) -> on recharge pour avoir la nouvelle version.
  if (bootId && bootId !== info.bootId) { location.reload(); return; }
  bootId = info.bootId;
  catalogue = { games: info.games, upcoming: info.upcoming };
  $("version").textContent = info.version;

  // Revenir automatiquement dans son salon après un F5 / une coupure.
  if (store.code && store.playerId) {
    socket.emit("joinRoom", { code: store.code, playerId: store.playerId, pseudo: store.pseudo }, (res) => {
      if (res.error) backHome("Ton ancien salon n'existe plus (serveur redémarré ou salon fermé).");
    });
  }
});

socket.on("hub", (h) => {
  hub = h;
  renderBar();
  if (h.phase === "game") {
    mountGame(h.gameId);
    showScreen("game");
    // L'hôte a pu changer : le jeu redessine ses boutons.
    if (mounted && lastGameState) mounted.client.update(lastGameState);
    return;
  }
  unmountGame();
  if (h.phase === "podium") { renderPodium(); showScreen("podium"); }
  else { renderLobby(); showScreen("lobby"); }
});

socket.on("game", ({ gameId, state }) => {
  if (!mounted || mounted.id !== gameId) return;
  lastGameState = state;
  mounted.client.update(state);
});

socket.on("gameMsg", ({ type, payload }) => {
  mounted?.client.message?.(type, payload);
});

socket.on("kicked", () => backHome("L'hôte t'a expulsé du salon."));

socket.on("disconnect", () => { if (hub) toast("Connexion perdue… reconnexion en cours"); });
