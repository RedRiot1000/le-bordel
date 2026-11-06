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
  get color() { return localStorage.getItem("bordel_color") || ""; },
  set color(v) { localStorage.setItem("bordel_color", v); },
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
  const target = $("screen-" + name);
  if (target.classList.contains("active")) return;   // déjà affiché : pas de nouvelle animation
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  target.classList.add("active");
}

const isHost = () => hub && hub.hostId === store.playerId;
const playerOf = (id) => hub?.players.find((p) => p.id === id);

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Petit rond de couleur avec l'initiale du joueur.
function avatar(p, cls = "mini-avatar") {
  // [...texte][0] = premier caractère entier (un emoji comme 🤖 compte pour un seul).
  const first = [...(p?.pseudo || "?")][0].toUpperCase();
  return `<span class="${cls}" style="--av:${p?.color || "var(--accent)"}">${escapeHtml(first)}</span>`;
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
  // Envoi rapide sans réponse (touches du clavier dans les jeux d'action).
  send: (type, data = {}) => socket.emit("gameAction", { type, data }),
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
  const what = hub.playlist ? "la playlist" : "le jeu en cours";
  if (confirm(`Arrêter ${what} ? Personne ne gagnera de points.`)) socket.emit("abortGame");
});

$("btn-help").addEventListener("click", () => { if (hub?.gameId) showHelp(hub.gameId); });
// Pause : l'hôte met en pause / relance ; les autres demandent (il faut la moitié des joueurs).
$("btn-pause").addEventListener("click", () => socket.emit(isHost() ? "pauseHost" : "pauseVote"));

// ===================================================================
//  ÉCRAN DE PAUSE (jeux de réflexion)
// ===================================================================
function renderPause() {
  const pz = hub?.phase === "game" ? hub.pause : null;
  const btn = $("btn-pause");
  btn.classList.toggle("hidden", !pz);
  let ov = document.getElementById("pause-overlay");
  if (!pz) { ov?.remove(); return; }
  const me = store.playerId, host = isHost();
  const iAsked = pz.votes.includes(me);
  btn.textContent = host ? (pz.active ? "▶ Reprendre" : "⏸ Pause")
    : pz.active ? (iAsked ? "▶ Je veux reprendre" : "⏸ En pause") : (iAsked ? `✋ Pause demandée (${pz.votes.length}/${pz.needed})` : `✋ Demander la pause (${pz.votes.length}/${pz.needed})`);
  btn.classList.toggle("on", iAsked || (host && pz.active));
  if (!pz.active) { ov?.remove(); return; }
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "pause-overlay";
    ov.className = "pause-overlay";
    // Dans .app (même « couche » que la barre du haut) : la barre reste au-dessus et cliquable.
    document.querySelector(".app").appendChild(ov);
  }
  const names = pz.votes.map((id) => escapeHtml(hub.players.find((p) => p.id === id)?.pseudo || "?"));
  const why = pz.host ? "L'hôte a mis la partie en pause." : `${names.join(", ")} ${pz.votes.length > 1 ? "ont" : "a"} demandé la pause.`;
  const myBtn = host ? '<button class="btn btn-primary btn-big" data-act="pauseHost">▶ Reprendre la partie</button>'
    : iAsked ? '<button class="btn btn-secondary" data-act="pauseVote">▶ Je veux reprendre</button>'
    : pz.host ? "<p class=\"muted\">Seul l'hôte peut relancer.</p>"
    : '<p class="muted">La partie repart dès que moins de la moitié des joueurs veut la pause.</p>';
  const key = JSON.stringify([pz, host, iAsked]);
  if (ov.dataset.key === key) return;
  ov.dataset.key = key;
  ov.innerHTML = `
    <div class="pause-card card">
      <div class="pause-icon">⏸</div>
      <h2>PAUSE</h2>
      <p>${why}</p>
      ${pz.host ? "" : `<p class="muted">${pz.votes.length} / ${pz.needed} nécessaires pour rester en pause</p>`}
      <div class="pause-actions">${myBtn}</div>
      <p class="muted pause-note">Le chrono est arrêté : profitez-en pour débattre sur Discord 🎙️</p>
    </div>`;
  ov.querySelectorAll("[data-act]").forEach((b) => { b.onclick = () => socket.emit(b.dataset.act); });
}

// ===================================================================
//  AIDE D'UN JEU (fenêtre ❓) — le texte est dans games-help.js
// ===================================================================
function showHelp(gameId) {
  const h = window.GAME_HELP?.[gameId];
  const g = catalogue?.games.find((x) => x.id === gameId);
  if (!h || !g) return;
  const list = (items) => `<ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
  const box = document.createElement("div");
  box.className = "help-overlay";
  box.innerHTML = `
    <div class="help-card card" role="dialog" aria-modal="true">
      <button class="help-close" title="Fermer">✕</button>
      <h2><span class="help-emoji">${g.emoji}</span> ${escapeHtml(g.name)}</h2>
      <p class="help-goal">🎯 ${h.goal}</p>
      <h3>📜 Comment on joue</h3>
      <ol>${h.steps.map((t) => `<li>${t}</li>`).join("")}</ol>
      ${h.controls ? `<h3>🎮 Les touches</h3>${list(h.controls)}` : ""}
      <h3>🏆 Les points</h3>${list(h.points)}
      <h3>💡 Exemple</h3>
      <p class="help-example">${h.example}</p>
      <button class="btn btn-primary help-ok">J'ai compris !</button>
    </div>`;
  const close = () => { box.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector(".help-close").onclick = close;
  box.querySelector(".help-ok").onclick = close;
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
}

function renderBar() {
  renderPause();
  $("hub-bar").classList.remove("hidden");
  $("bar-code").textContent = hub.code;
  const online = hub.players.filter((p) => p.connected).length;
  $("bar-online").textContent = `👥 ${online}/${hub.players.length} en ligne`;
  $("btn-abort").classList.toggle("hidden", !(isHost() && ["game", "next"].includes(hub.phase)));
  $("btn-help").classList.toggle("hidden", !(hub.phase === "game" && window.GAME_HELP?.[hub.gameId]));
  $("btn-abort").textContent = hub.playlist ? "⏹ Arrêter la playlist" : "⏹ Arrêter le jeu";
  $("bar-playlist").classList.toggle("hidden", !hub.playlist);
  if (hub.playlist) $("bar-playlist").textContent = `🎲 Jeu ${hub.playlist.num}/${hub.playlist.total}`;
}

// ===================================================================
//  SALON : joueurs + menu des jeux
// ===================================================================
$("btn-add-bot").addEventListener("click", () => {
  socket.emit("addBot", {}, (res) => { if (res?.error) toast(res.error); });
});

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

let colorTriedIn = null;
let plGear = null;   // le jeu dont la fenêtre de réglages est ouverte

// La fenêtre de réglages d'un jeu de la playlist (l'engrenage). Seul l'hôte peut changer quelque chose.
function renderGear() {
  $("pl-gear")?.remove();
  const g = catalogue.games.find((x) => x.id === plGear);
  if (!g || hub?.phase !== "lobby" || hub.lobbyMode !== "playlist") { plGear = null; return; }
  const host = isHost(), conf = hub.draft.config?.[g.id] || {};
  const box = document.createElement("div");
  box.id = "pl-gear";
  box.className = "gear-overlay";
  box.innerHTML = `
    <div class="gear-card card" role="dialog" aria-modal="true">
      <h2>${g.emoji} ${escapeHtml(g.name)}</h2>
      ${g.options.map((o) => `
        <div class="setting-block"><label>${escapeHtml(o.label)}</label><div class="cat-chips">
          ${o.choices.map((c) => `<button class="cat-chip ${(conf[o.key] ?? o.default) === c.v ? "on" : ""}" data-k="${o.key}" data-v="${escapeHtml(c.v)}" title="${escapeHtml(c.hint || "")}" ${host ? "" : "disabled"}>${escapeHtml(c.label)}</button>`).join("")}
        </div></div>`).join("")}
      ${host ? "" : `<p class="settings-note">Seul l'hôte peut modifier les réglages.</p>`}
      <button class="btn btn-primary" data-close>OK</button>
    </div>`;
  document.body.appendChild(box);
  const close = () => { plGear = null; box.remove(); };
  box.onclick = (e) => { if (e.target === box) close(); };
  box.querySelector("[data-close]").onclick = close;
  box.querySelectorAll("[data-k]").forEach((b) => {
    b.onclick = () => socket.emit("setDraft", { config: { gameId: g.id, key: b.dataset.k, value: b.dataset.v } });
  });
}
function renderLobby() {
  $("room-code").textContent = hub.code;
  $("player-count").textContent = `${hub.players.length}/8`;

  // --- Joueurs (triés par score de soirée) ---
  const list = $("player-list");
  const sorted = [...hub.players].sort((a, b) => b.score - a.score);
  list.innerHTML = sorted.map((p) => `
    <li class="${p.connected ? "" : "offline"}">
      ${avatar(p, "avatar")}
      <span class="name">${escapeHtml(p.pseudo)}${p.id === store.playerId ? " (toi)" : ""}</span>
      ${p.isHost ? '<span class="badge-host">HÔTE</span>' : ""}
      ${p.bot ? '<span class="badge-bot">BOT</span>' : ""}
      ${!p.connected ? '<span class="tag">hors ligne</span>' : ""}
      <span class="pts">${p.score} pts</span>
      ${isHost() && !p.isHost ? `<button class="kick-btn" data-id="${p.id}" title="${p.bot ? "Retirer le bot" : "Expulser"}">✕</button>` : ""}
    </li>`).join("");
  list.querySelectorAll(".kick-btn").forEach((b) => {
    b.onclick = () => {
      const p = playerOf(b.dataset.id);
      if (p?.bot || confirm(`Expulser ${p?.pseudo} du salon ?`)) socket.emit("kickPlayer", { playerId: b.dataset.id });
    };
  });

  // --- Ma couleur : les couleurs des autres joueurs sont barrées, celles des bots restent libres ---
  const mine = playerOf(store.playerId);
  const sw = $("color-pick");
  sw.innerHTML = (hub.colors || []).map((c) => {
    const owner = hub.players.find((p) => p.color === c);
    const taken = owner && owner.id !== store.playerId && !owner.bot;
    return `<button class="color-swatch ${mine?.color === c ? "on" : ""} ${taken ? "taken" : ""}" style="--sw:${c}" data-c="${c}" ${taken ? "disabled" : ""}
      title="${taken ? escapeHtml(owner.pseudo) + " a cette couleur" : "Choisir cette couleur"}" aria-label="Couleur ${c}"></button>`;
  }).join("");
  sw.querySelectorAll("[data-c]").forEach((b) => {
    b.onclick = () => socket.emit("pickColor", { color: b.dataset.c }, (res) => {
      if (res?.error) toast(res.error); else store.color = b.dataset.c;
    });
  });
  // La couleur choisie la dernière fois revient toute seule en arrivant dans un salon.
  if (mine && store.color && store.color !== mine.color && colorTriedIn !== hub.code) {
    colorTriedIn = hub.code;
    socket.emit("pickColor", { color: store.color });
  }

  // --- Bouton "Ajouter un bot" (hôte) ---
  const n = hub.players.length;
  const host = isHost();
  $("btn-add-bot").classList.toggle("hidden", !host || n >= 8);

  // --- Mode : un jeu / playlist ---
  const playlistMode = hub.lobbyMode === "playlist";
  const draft = hub.draft;
  $("mode-switch").querySelectorAll("button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === hub.lobbyMode);
    b.disabled = !host;
  });

  // --- Menu des jeux ---
  const minNeeded = Math.min(...catalogue.games.map((g) => g.minPlayers));
  const hint = $("games-hint");
  hint.classList.toggle("warn", host && n < minNeeded);
  hint.textContent = n < minNeeded && host ? `👉 Il faut au moins ${minNeeded} joueurs. Invite tes potes ou ajoute des bots 🤖 pour tester !`
    : playlistMode ? (host ? "Coche les jeux de la playlist : ils seront joués dans un ordre au hasard." : "L'hôte prépare une playlist de jeux…")
    : (host ? "Clique sur un jeu pour le lancer." : "L'hôte choisit le prochain jeu…");

  const tiles = catalogue.games.map((g) => {
    const ok = n >= g.minPlayers && n <= g.maxPlayers;
    const why = n < g.minPlayers ? ` · il manque ${g.minPlayers - n} joueur(s)` : "";
    const picked = playlistMode && draft.games.includes(g.id);
    // L'hôte peut toujours cliquer : s'il manque du monde, un message l'explique.
    return `<div class="gt-wrap">
      <button class="game-tile ${ok ? "" : "locked"} ${playlistMode ? "pickable" : ""} ${picked ? "picked" : ""}" data-id="${g.id}" ${host ? "" : "disabled"}>
        ${playlistMode ? `<span class="gt-check">${picked ? "✓" : ""}</span>` : ""}
        <span class="gt-emoji">${g.emoji}</span>
        <span class="gt-name">${escapeHtml(g.name)}</span>
        <span class="gt-meta">${g.family} · ${g.minPlayers}-${g.maxPlayers} joueurs${why}</span>
        <span class="gt-desc">${escapeHtml(g.description)}</span>
      </button>
      ${window.GAME_HELP?.[g.id] ? `<button class="gt-help" data-help="${g.id}" title="Comment on joue ?">?</button>` : ""}
      ${playlistMode && g.options.length ? `<button class="gt-gear" data-gear="${g.id}" title="Réglages de ce jeu">⚙️</button>` : ""}
    </div>`;
  });
  const soon = catalogue.upcoming.map((g) => `
      <button class="game-tile soon" disabled>
        <span class="gt-emoji">${g.emoji}</span>
        <span class="gt-name">${escapeHtml(g.name)}</span>
        <span class="gt-meta">${g.family} · bientôt</span>
      </button>`);
  $("game-tiles").innerHTML = tiles.concat(soon).join("");

  $("game-tiles").querySelectorAll(".gt-gear").forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); plGear = b.dataset.gear; renderGear(); };
  });
  $("game-tiles").querySelectorAll(".gt-help").forEach((b) => {
    b.onclick = () => showHelp(b.dataset.help);
  });
  $("game-tiles").querySelectorAll(".game-tile:not(.soon)").forEach((b) => {
    b.onclick = () => {
      $("lobby-error").textContent = "";
      if (playlistMode) {
        // Playlist : on coche / décoche le jeu.
        const id = b.dataset.id;
        const games = draft.games.includes(id) ? draft.games.filter((x) => x !== id) : [...draft.games, id];
        socket.emit("setDraft", { games });
        return;
      }
      socket.emit("pickGame", { gameId: b.dataset.id }, (res) => {
        if (res?.error) $("lobby-error").textContent = res.error;
      });
    };
  });

  // --- Panneau de la playlist ---
  $("playlist-panel").classList.toggle("hidden", !playlistMode);
  $("pl-bulk").classList.toggle("hidden", !playlistMode);
  if (!playlistMode) return;
  const count = draft.count || draft.games.length;
  $("pl-count").textContent = count;
  $("pl-dec").disabled = !host || count <= 1;
  $("pl-inc").disabled = !host || count >= 20;
  // Tout / rien / par catégorie.
  const allIds = catalogue.games.map((g) => g.id);
  const families = [...new Set(catalogue.games.map((g) => g.family))];
  const isAll = allIds.every((id) => draft.games.includes(id));
  $("pl-bulk").innerHTML = `
    <button class="cat-chip ${isAll ? "on" : ""}" data-bulk="all" ${host ? "" : "disabled"}>✅ Tout</button>
    <button class="cat-chip ${draft.games.length ? "" : "on"}" data-bulk="none" ${host ? "" : "disabled"}>⬜ Rien</button>
    ${families.map((f) => {
      const ids = catalogue.games.filter((g) => g.family === f).map((g) => g.id);
      return `<button class="cat-chip ${ids.every((id) => draft.games.includes(id)) ? "on" : ""}" data-fam="${escapeHtml(f)}" ${host ? "" : "disabled"}>${escapeHtml(f)}</button>`;
    }).join("")}`;
  $("pl-bulk").querySelectorAll("[data-bulk]").forEach((b) => { b.onclick = () => socket.emit("setDraft", { games: b.dataset.bulk === "all" ? allIds : [] }); });
  $("pl-bulk").querySelectorAll("[data-fam]").forEach((b) => {
    b.onclick = () => {
      const ids = catalogue.games.filter((g) => g.family === b.dataset.fam).map((g) => g.id);
      const on = ids.every((id) => draft.games.includes(id));
      socket.emit("setDraft", { games: on ? draft.games.filter((id) => !ids.includes(id)) : [...new Set([...draft.games, ...ids])] });
    };
  });
  renderGear();
  const start = $("btn-start-playlist");
  start.classList.toggle("hidden", !host);
  start.disabled = !draft.games.length;
  start.textContent = draft.games.length ? `🎲 Lancer la playlist (${count} jeu${count > 1 ? "x" : ""})` : "Coche au moins un jeu";
}

// Boutons du salon (mode et playlist), branchés une seule fois.
$("mode-switch").querySelectorAll("button").forEach((b) => {
  b.onclick = () => socket.emit("setLobbyMode", { mode: b.dataset.mode });
});
const plCount = () => hub.draft.count || hub.draft.games.length;
$("pl-dec").onclick = () => socket.emit("setDraft", { count: plCount() - 1 });
$("pl-inc").onclick = () => socket.emit("setDraft", { count: plCount() + 1 });
$("btn-start-playlist").onclick = () => {
  $("lobby-error").textContent = "";
  socket.emit("startPlaylist", {}, (res) => { if (res?.error) $("lobby-error").textContent = res.error; });
};

// ===================================================================
//  PLAYLIST : PROCHAIN JEU
// ===================================================================
let nextEndLocal = 0;
const nextTotalMs = 5000;

$("btn-launch-now").onclick = () => socket.emit("launchNow");

function renderNext() {
  const nx = hub.next;
  const game = catalogue.games.find((g) => g.id === nx.gameId);
  nextEndLocal = Date.now() + nx.left;
  $("next-num").textContent = `🎲 Jeu ${nx.num} / ${nx.total}`;
  $("next-emoji").textContent = game?.emoji || "🎮";
  $("next-name").textContent = game?.name || "?";
  $("next-hint").textContent = "C'est parti !";
  $("btn-launch-now").classList.toggle("hidden", !isHost());

  // Les réglages choisis par l'hôte (pour info).
  $("next-options").innerHTML = (game?.options || []).map((o) => `
    <div class="next-option">
      <div class="next-option-label">${escapeHtml(o.label)}</div>
      <div class="next-choices">
        <span class="next-choice on"><span class="nc-label">${escapeHtml(o.choices.find((c) => c.v === nx.choices?.[o.key])?.label || "")}</span></span>
      </div>
    </div>`).join("");
}

// Compte à rebours de l'écran "prochain jeu".
setInterval(() => {
  if (hub?.phase !== "next") return;
  const left = Math.max(0, nextEndLocal - Date.now());
  $("next-sec").textContent = Math.ceil(left / 1000);
  $("next-fill").style.width = Math.min(100, (left / nextTotalMs) * 100) + "%";
}, 200);

// ===================================================================
//  PODIUM
// ===================================================================
$("btn-close-podium").addEventListener("click", () => {
  // En playlist (pas finie) : jeu suivant. Sinon : retour au menu.
  const pl = hub.lastResult?.playlist;
  socket.emit(pl && !pl.final && hub.playlist ? "nextInPlaylist" : "closePodium");
});

function renderPodium() {
  const r = hub.lastResult;
  const game = catalogue.games.find((g) => g.id === r?.gameId);
  const pl = r?.playlist;
  $("podium-title").textContent = `🏆 Résultats — ${game ? game.emoji + " " + game.name : ""}` +
    (pl ? ` (jeu ${pl.num}/${pl.total})` : "");
  $("btn-close-podium").textContent = !pl ? "Retour au menu"
    : pl.final ? "🏁 Fin de la playlist — retour au menu" : `▶ Jeu suivant (${pl.num + 1}/${pl.total})`;
  document.querySelector(".podium-sub").textContent = pl?.final ? "🏆 Classement final de la playlist" : "Classement de la soirée";
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
  else if (h.phase === "next") { renderNext(); showScreen("next"); }
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
