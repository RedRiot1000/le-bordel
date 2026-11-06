// ===================================================================
//  LE BORDEL — Serveur principal (le "hub")
//  Gère les salons, les joueurs, le choix du jeu et le score de soirée.
//  Chaque mini-jeu vit dans games/<nom>/ et suit le même "contrat" :
//    createGame(ctx) -> { publicState, onAction, onReconnect,
//                         onDisconnect, canJoin, destroy }
//  et appelle ctx.finish(classement) quand il est terminé.
// ===================================================================

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import path from "path";
import { GAMES, UPCOMING } from "./games/registry.js";

// --- Mise en place du serveur web ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static(path.join(__dirname, "public")));

// Version affichée en bas de page (Render fournit le n° du commit GitHub).
const pkg = JSON.parse(readFileSync(path.join(__dirname, "package.json"), "utf8"));
const VERSION = "v" + pkg.version +
  (process.env.RENDER_GIT_COMMIT ? " · " + process.env.RENDER_GIT_COMMIT.slice(0, 7) : " · local");
// Change à chaque démarrage : si un client voit un autre BOOT_ID,
// c'est que le serveur a été mis à jour -> il recharge la page.
const BOOT_ID = Date.now().toString(36);

// Petite page de santé (Render s'en sert pour savoir si le serveur va bien).
app.get("/health", (_, res) => res.json({ ok: true, version: VERSION }));

// ===================================================================
//  RÉGLAGES DU HUB
// ===================================================================
const MAX_PLAYERS = 8;
const POINTS = [10, 7, 5, 3, 2, 1];          // points de soirée par place
const COLORS = ["#7c5cff", "#ff5c9d", "#38e8c8", "#ffb547", "#4ade80", "#2e9dff", "#ff4d4d", "#e5e7eb", "#ffe14d", "#ff7a1a", "#a3e635", "#c026d3"];
const HOST_GRACE_MS = 15_000;                // délai avant de passer l'hôte à un autre
const ROOM_EMPTY_MS = 10 * 60_000;           // salon vide supprimé après 10 min
const BOT_NAMES = ["Bernard", "Ginette", "Michel", "Josiane", "Gérard", "Huguette", "Roger", "Monique"];
const VOTE_MS = 30_000;                      // playlist : temps pour voter les réglages
const INTRO_MS = 5_000;                      // playlist sans vote : écran "prochain jeu"
const MAX_PLAYLIST = 20;                     // nombre max de jeux dans une playlist

const rooms = {};

// ===================================================================
//  UTILITAIRES
// ===================================================================
function generateRoomCode() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code;
  do {
    code = Array.from({ length: 4 }, () =>
      letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms[code]);
  return code;
}

function generatePlayerId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const findPlayer = (room, id) => room.players.find((p) => p.id === id);
// Un vrai humain encore là ? (les bots ne comptent pas)
const humansOnline = (room) => room.players.some((p) => p.connected && !p.bot);

// Première couleur pas encore prise dans le salon.
function freeColor(room) {
  return COLORS.find((c) => !room.players.some((p) => p.color === c)) || COLORS[0];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Catalogue envoyé aux clients (infos des jeux + options votables en playlist).
const catalogue = {
  games: Object.values(GAMES).map((g) => ({ ...g.meta, options: g.playlist?.options || [] })),
  upcoming: UPCOMING,
};

// ===================================================================
//  ENVOI DE L'ÉTAT AUX JOUEURS
// ===================================================================
function publicHub(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,              // "lobby" | "next" | "game" | "podium"
    gameId: room.gameId,
    lastResult: room.lastResult,
    colors: COLORS,
    lobbyMode: room.lobbyMode,      // "single" (un jeu) | "playlist"
    draft: room.draft,              // la playlist en préparation dans le salon
    playlist: room.playlist && { num: room.playlist.index + 1, total: room.playlist.order.length },
    next: publicNext(room),         // écran "prochain jeu" (vote des réglages)
    pause: publicPause(room),       // jeux de réflexion : la partie peut être mise en pause
    players: room.players.map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      color: p.color,
      connected: p.connected,
      score: p.score,
      bot: !!p.bot,
      isHost: p.id === room.hostId,
    })),
  };
}

// Le prochain jeu de la playlist, avec qui a voté quoi.
function publicNext(room) {
  const nx = room.next;
  if (!nx) return null;
  const votes = {};   // { option: { valeur: [ids des votants] } }
  for (const [pid, v] of Object.entries(nx.votes)) {
    for (const [key, value] of Object.entries(v)) ((votes[key] ||= {})[value] ||= []).push(pid);
  }
  return { gameId: nx.gameId, num: nx.num, total: nx.total, vote: nx.vote, left: Math.max(0, nx.endsAt - Date.now()), votes };
}

// ===================================================================
//  PAUSE (jeux de réflexion : meta.pausable)
//  - L'hôte met en pause / relance quand il veut.
//  - Les joueurs peuvent demander la pause : elle démarre quand au moins la
//    moitié des joueurs (humains connectés) la demande, et repart dès que
//    moins de la moitié la demande encore.
//  Pendant la pause, l'horloge du jeu est arrêtée : chronos, bots, tout.
// ===================================================================

// Horloge d'un mini-jeu : son temps s'arrête pendant la pause.
function makeClock() {
  const c = { offset: 0, pausedAt: 0, timers: new Map(), seq: 0 };
  const now = () => (c.pausedAt || Date.now()) - c.offset;
  const arm = (id) => {
    const t = c.timers.get(id);
    t.real = setTimeout(() => { c.timers.delete(id); t.fn(); }, Math.max(0, t.at - now()));
  };
  return {
    now,
    setTimeout(fn, ms = 0) {
      const id = ++c.seq;
      c.timers.set(id, { fn, at: now() + ms });
      if (!c.pausedAt) arm(id);
      return id;
    },
    clearTimeout(id) {
      const t = c.timers.get(id);
      if (t) { clearTimeout(t.real); c.timers.delete(id); }
    },
    pause() {
      if (c.pausedAt) return;
      c.pausedAt = Date.now();
      for (const t of c.timers.values()) clearTimeout(t.real);
    },
    resume() {
      if (!c.pausedAt) return;
      c.offset += Date.now() - c.pausedAt;
      c.pausedAt = 0;
      for (const id of [...c.timers.keys()]) arm(id);
    },
    clearAll() {
      for (const t of c.timers.values()) clearTimeout(t.real);
      c.timers.clear();
    },
  };
}

const pausable = (room) => room.phase === "game" && !!room.game && !!GAMES[room.gameId]?.meta.pausable;
const humans = (room) => room.players.filter((p) => p.connected && !p.bot);

function pauseState(room) {
  const pz = room.pause;
  const ids = new Set(humans(room).map((p) => p.id));
  const votes = [...pz.votes].filter((id) => ids.has(id));
  const needed = Math.max(1, Math.ceil(ids.size / 2));
  return { active: pz.host || votes.length >= needed, host: pz.host, votes, needed };
}

function publicPause(room) {
  if (!pausable(room) || !room.pause) return null;
  return { ...pauseState(room), since: room.pause.since };
}

// Recalcule la pause après un vote, un départ… et arrête / relance l'horloge du jeu.
function updatePause(room) {
  if (!pausable(room) || !room.pause) return;
  const { active } = pauseState(room);
  const was = room.clock.paused;
  if (active && !was) { room.clock.pause(); room.clock.paused = true; room.pause.since = Date.now(); }
  if (!active && was) { room.clock.resume(); room.clock.paused = false; room.pause.since = 0; }
  sendHub(room);
  sendGame(room);
}

function sendHub(room) {
  io.to(room.code).emit("hub", publicHub(room));
}

// Pour tester : LAG_MS=60 simule un réseau lent (60 ms de retard dans chaque sens).
const LAG_MS = Number(process.env.LAG_MS) || 0;

function sendGame(room, target = room.code) {
  if (!room.game) return;
  const msg = { gameId: room.gameId, state: room.game.publicState() };
  if (LAG_MS) setTimeout(() => io.to(target).emit("game", msg), LAG_MS);
  else io.to(target).emit("game", msg);
}

// ===================================================================
//  LANCER / TERMINER UN MINI-JEU
// ===================================================================
// opts (mode playlist) = { settings, rounds } : réglages imposés + nombre de manches.
function startGame(room, gameId, opts = null) {
  const def = GAMES[gameId];
  room.gameId = gameId;
  room.phase = "game";
  room.lastResult = null;

  // L'horloge du jeu (arrêtée pendant une pause) et la pause elle-même.
  room.clock?.clearAll();
  room.clock = makeClock();
  room.pause = { host: false, votes: new Set(), since: 0 };
  const clock = room.clock;

  // Le "contexte" : tout ce que le mini-jeu a le droit d'utiliser.
  const ctx = {
    // Le temps du jeu : à utiliser à la place de Date.now / setTimeout pour que la pause marche.
    now: () => clock.now(),
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    // bot = joueur géré par l'ordinateur : c'est le jeu qui le fait jouer.
    players: () => room.players.map(({ id, pseudo, color, connected, bot }) =>
      ({ id, pseudo, color, connected, bot: !!bot })),
    isHost: (id) => room.hostId === id,
    update: () => sendGame(room),
    sendTo: (playerId, type, payload) => {
      const p = findPlayer(room, playerId);
      if (p?.connected && p.socketId) io.to(p.socketId).emit("gameMsg", { type, payload });
    },
    finish: (ranking) => finishGame(room, ranking),
    savedSettings: opts?.settings || room.gameSettings[gameId] || null,
    saveSettings: (s) => { room.gameSettings[gameId] = s; },
    playlist: opts ? { rounds: opts.rounds } : null,   // null = mode "un jeu"
  };

  sendHub(room);                 // le client affiche l'écran du jeu...
  room.game = def.createGame(ctx);
  if (opts) room.game.autoStart();   // playlist : pas d'écran de réglages, on joue direct
  if (def.meta.pausable) sendHub(room);   // le bouton pause apparaît (le jeu existe maintenant)
  sendGame(room);                // ...puis reçoit son premier état
}

// ===================================================================
//  MODE PLAYLIST
// ===================================================================

// Ordre des jeux : au hasard, jamais deux fois le même d'affilée.
function buildOrder(games, count) {
  const order = [];
  while (order.length < count) {
    const bag = shuffle(games);
    if (order.length && bag.length > 1 && bag[0] === order.at(-1)) bag.push(bag.shift());
    order.push(...bag);
  }
  return order.slice(0, count);
}

// Écran "prochain jeu" : vote des réglages (30 s) ou simple annonce (5 s).
function startNext(room) {
  const pl = room.playlist;
  const n = room.players.length;
  // On saute les jeux qui ne se jouent pas avec ce nombre de joueurs.
  while (pl.index < pl.order.length) {
    const m = GAMES[pl.order[pl.index]]?.meta;
    if (m && n >= m.minPlayers && n <= m.maxPlayers) break;
    pl.index++;
  }
  if (pl.index >= pl.order.length) return endPlaylist(room);

  const vote = pl.settingsMode === "vote";
  const ms = vote ? VOTE_MS : INTRO_MS;
  room.phase = "next";
  room.gameId = null;
  room.next = { gameId: pl.order[pl.index], num: pl.index + 1, total: pl.order.length, vote, endsAt: Date.now() + ms, votes: {} };
  clearTimeout(room.nextTimer);
  room.nextTimer = setTimeout(() => launchNext(room), ms);
  sendHub(room);
}

// Fin du vote : on compte, puis on lance le jeu avec les réglages gagnants.
function launchNext(room) {
  clearTimeout(room.nextTimer);
  const nx = room.next;
  if (!nx || room.phase !== "next") return;
  const def = GAMES[nx.gameId];
  const choices = {};
  for (const o of def.playlist.options) {
    const counts = {};
    for (const v of Object.values(nx.votes)) if (v[o.key] != null) counts[v[o.key]] = (counts[v[o.key]] || 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    const top = Object.keys(counts).filter((k) => counts[k] === max);
    // Personne n'a voté -> valeur par défaut. Égalité -> tirage au sort.
    choices[o.key] = max === 0 ? o.default : top[Math.floor(Math.random() * top.length)];
  }
  room.next = null;
  room.playlist.choices = choices;
  startGame(room, nx.gameId, { settings: def.playlist.settingsFor(choices), rounds: Number(choices.rounds) || 2 });
}

function endPlaylist(room) {
  clearTimeout(room.nextTimer);
  room.playlist = null;
  room.next = null;
  room.gameId = null;
  room.phase = "lobby";
  sendHub(room);
}

// ranking = liste de groupes d'ids, du 1er au dernier.
// Ex : [["a"], ["b","c"], ["d"]] -> a 1er, b et c 2es ex æquo, d 4e.
function finishGame(room, ranking = []) {
  room.game?.destroy();
  room.game = null;
  room.clock?.clearAll();

  const results = [];
  let place = 0;
  for (const group of ranking) {
    const pts = POINTS[place] ?? 0;
    for (const id of group) {
      const p = findPlayer(room, id);
      if (!p) continue;
      p.score += pts;
      results.push({ playerId: id, place: place + 1, points: pts });
    }
    place += group.length;
  }

  const pl = room.playlist;
  if (results.length) {
    room.lastResult = { gameId: room.gameId, results };
    if (pl) room.lastResult.playlist = { num: pl.index + 1, total: pl.order.length, final: pl.index + 1 >= pl.order.length, choices: pl.choices };
    room.phase = "podium";
  } else if (pl) {
    // Jeu de la playlist pas joué (pas assez de monde...) : on passe au suivant.
    pl.index++;
    return startNext(room);
  } else {
    // Personne n'a joué (jeu quitté avant la 1re manche) : retour direct au menu.
    room.phase = "lobby";
    room.gameId = null;
  }
  sendHub(room);
}

// L'hôte arrête le jeu en cours (et la playlist) sans distribuer de points.
function abortGame(room) {
  room.game?.destroy();
  room.game = null;
  room.clock?.clearAll();
  endPlaylist(room);
}

// ===================================================================
//  HÔTE ET NETTOYAGE
// ===================================================================
function transferHost(room) {
  const next = room.players.find((p) => p.connected && !p.bot && p.id !== room.hostId);
  if (!next) return;
  room.hostId = next.id;
  sendHub(room);
  sendGame(room);     // les boutons d'hôte du jeu changent de main
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (humansOnline(room)) return;
    room.game?.destroy();
    clearTimeout(room.hostTimer);
    clearTimeout(room.nextTimer);
    delete rooms[room.code];
  }, ROOM_EMPTY_MS);
}

// Retire un joueur du salon (expulsé ou parti volontairement).
function removePlayer(room, playerId) {
  const p = findPlayer(room, playerId);
  if (!p) return;
  const sock = p.socketId && io.sockets.sockets.get(p.socketId);
  if (sock) { sock.leave(room.code); sock.data = {}; }
  room.players = room.players.filter((x) => x.id !== playerId);
  if (!room.players.some((x) => !x.bot)) {   // plus aucun humain : on ferme
    room.game?.destroy();
    delete rooms[room.code];
    return;
  }
  if (room.hostId === playerId) transferHost(room);
  sendHub(room);
}

// ===================================================================
//  CONNEXIONS TEMPS RÉEL
// ===================================================================
io.on("connection", (socket) => {
  socket.emit("welcome", { bootId: BOOT_ID, version: VERSION, ...catalogue });

  const roomOf = () => rooms[socket.data.code];
  const me = () => { const r = roomOf(); return r && findPlayer(r, socket.data.playerId); };
  const amHost = () => { const r = roomOf(); return r && r.hostId === socket.data.playerId; };

  // Rattache cette connexion à un joueur d'un salon.
  function attach(room, player) {
    player.connected = true;
    player.socketId = socket.id;
    socket.data = { code: room.code, playerId: player.id };
    socket.join(room.code);
    clearTimeout(room.cleanupTimer);
    if (room.hostId === player.id) clearTimeout(room.hostTimer);
    updatePause(room);   // un joueur revient : la moitié nécessaire change
  }

  // --- Créer un salon ---
  socket.on("createRoom", ({ pseudo } = {}, callback) => {
    pseudo = (pseudo || "").trim().slice(0, 20);
    if (!pseudo) return callback?.({ error: "Choisis un pseudo." });
    const code = generateRoomCode();
    const player = { id: generatePlayerId(), pseudo, color: COLORS[0], connected: true, score: 0 };
    const room = {
      code,
      hostId: player.id,
      phase: "lobby",
      players: [player],
      gameId: null,
      game: null,
      gameSettings: {},     // réglages mémorisés par jeu pour la soirée
      lastResult: null,
      lobbyMode: "single",  // "single" = un jeu, "playlist" = plusieurs au hasard
      draft: { games: Object.keys(GAMES), settingsMode: "default", count: 0 },   // tous les jeux cochés par défaut
      playlist: null,       // playlist en cours : { order, index, settingsMode, choices }
      next: null,           // écran "prochain jeu" en cours
    };
    rooms[code] = room;
    attach(room, player);
    callback?.({ ok: true, code, playerId: player.id });
    sendHub(room);
  });

  // --- Rejoindre / revenir après une coupure ---
  socket.on("joinRoom", ({ code, pseudo, playerId } = {}, callback) => {
    code = (code || "").trim().toUpperCase();
    pseudo = (pseudo || "").trim().slice(0, 20);
    const room = rooms[code];
    if (!room) return callback?.({ error: "Salon introuvable." });

    let player = playerId ? findPlayer(room, playerId) : null;
    const isNew = !player;
    if (player) {
      if (pseudo) player.pseudo = pseudo;
    } else {
      if (!pseudo) return callback?.({ error: "Choisis un pseudo." });
      if (room.players.length >= MAX_PLAYERS) return callback?.({ error: `Salon plein (${MAX_PLAYERS} max).` });
      if (room.phase === "game" && !room.game?.canJoin()) {
        return callback?.({ error: "Un jeu est en cours, réessaie à la fin de la manche." });
      }
      player = { id: generatePlayerId(), pseudo, color: freeColor(room), connected: true, score: 0 };
      room.players.push(player);
    }
    attach(room, player);
    callback?.({ ok: true, code, playerId: player.id });
    sendHub(room);

    if (room.game) {
      if (isNew) sendGame(room);                 // tout le monde voit le nouveau
      else {
        sendGame(room, socket.id);               // le revenant récupère l'état...
        room.game.onReconnect(player.id);        // ...et ses infos secrètes
      }
    }
  });

  // --- L'hôte choisit un jeu ---
  socket.on("pickGame", ({ gameId } = {}, callback) => {
    const room = roomOf();
    if (!room) return callback?.({ error: "Tu n'es dans aucun salon." });
    if (!amHost()) return callback?.({ error: "Seul l'hôte choisit le jeu." });
    if (room.phase === "game" || room.phase === "next" || room.playlist) return callback?.({ error: "Un jeu est déjà en cours." });
    const def = GAMES[gameId];
    if (!def) return callback?.({ error: "Jeu inconnu." });
    const n = room.players.length;
    if (n < def.meta.minPlayers) return callback?.({ error: `Il faut au moins ${def.meta.minPlayers} joueurs.` });
    if (n > def.meta.maxPlayers) return callback?.({ error: `${def.meta.maxPlayers} joueurs maximum pour ce jeu.` });
    callback?.({ ok: true });
    startGame(room, gameId);
  });

  // --- Action dans le mini-jeu en cours (transmise telle quelle) ---
  socket.on("gameAction", (msg = {}, callback) => {
    if (LAG_MS) setTimeout(() => handleGameAction(msg, callback), LAG_MS);
    else handleGameAction(msg, callback);
  });

  function handleGameAction({ type, data } = {}, callback) {
    const room = roomOf();
    if (!room?.game || !me()) return callback?.({ error: "Aucun jeu en cours." });
    if (room.clock?.paused) return callback?.({ error: "⏸ La partie est en pause." });
    let res;
    try {
      res = room.game.onAction(socket.data.playerId, type, data || {});
    } catch (err) {
      console.error(`[${room.code}] erreur dans le jeu ${room.gameId} :`, err);
      res = { error: "Oups, le jeu a planté sur cette action." };
    }
    callback?.(res || { ok: true });
  }

  // --- L'hôte arrête le jeu / la playlist (sans points) ---
  // --- Pause (jeux de réflexion) ---
  // L'hôte : pause / reprise immédiate (la reprise efface aussi les demandes des joueurs).
  socket.on("pauseHost", () => {
    const room = roomOf();
    if (!room || !amHost() || !pausable(room)) return;
    if (pauseState(room).active) { room.pause.host = false; room.pause.votes.clear(); }
    else room.pause.host = true;
    updatePause(room);
  });
  // Un joueur demande la pause (ou retire sa demande).
  socket.on("pauseVote", () => {
    const room = roomOf();
    if (!room || !me() || !pausable(room)) return;
    const id = socket.data.playerId;
    if (room.pause.votes.has(id)) room.pause.votes.delete(id); else room.pause.votes.add(id);
    updatePause(room);
  });

  socket.on("abortGame", () => {
    const room = roomOf();
    if (room && amHost() && ["game", "next"].includes(room.phase)) abortGame(room);
  });

  // --- Fin du podium : retour au menu (fin de la playlist s'il y en a une) ---
  socket.on("closePodium", () => {
    const room = roomOf();
    if (!room || !amHost() || room.phase !== "podium") return;
    endPlaylist(room);
  });

  // ================= MODE PLAYLIST =================

  // L'hôte passe de "un jeu" à "playlist" (tout le monde voit le changement).
  socket.on("setLobbyMode", ({ mode } = {}) => {
    const room = roomOf();
    if (!room || !amHost() || room.phase !== "lobby" || !["single", "playlist"].includes(mode)) return;
    room.lobbyMode = mode;
    // Passage en playlist avec rien de coché : on coche tout.
    if (mode === "playlist" && !room.draft.games.length) room.draft.games = Object.keys(GAMES);
    sendHub(room);
  });

  // L'hôte prépare la playlist : jeux cochés, réglages (défaut/vote), nombre de jeux.
  socket.on("setDraft", ({ games, settingsMode, count } = {}) => {
    const room = roomOf();
    if (!room || !amHost() || room.phase !== "lobby") return;
    const d = room.draft;
    if (Array.isArray(games)) d.games = [...new Set(games)].filter((id) => GAMES[id]);
    if (["default", "vote"].includes(settingsMode)) d.settingsMode = settingsMode;
    if (Number.isFinite(count)) d.count = Math.max(1, Math.min(MAX_PLAYLIST, Math.round(count)));
    sendHub(room);
  });

  socket.on("startPlaylist", (_, callback) => {
    const room = roomOf();
    if (!room || !amHost()) return callback?.({ error: "Seul l'hôte lance la playlist." });
    if (room.phase !== "lobby") return callback?.({ error: "Un jeu est déjà en cours." });
    const d = room.draft;
    const n = room.players.length;
    const playable = d.games.filter((id) => n >= GAMES[id].meta.minPlayers && n <= GAMES[id].meta.maxPlayers);
    if (!d.games.length) return callback?.({ error: "Coche au moins un jeu." });
    if (!playable.length) return callback?.({ error: `Pas assez de joueurs pour ces jeux (il en faut au moins ${Math.min(...d.games.map((id) => GAMES[id].meta.minPlayers))}).` });
    const count = d.count || d.games.length;
    room.playlist = { order: buildOrder(playable, count), index: 0, settingsMode: d.settingsMode, choices: null };
    callback?.({ ok: true });
    startNext(room);
  });

  // Un joueur vote pour un réglage du prochain jeu.
  socket.on("voteOption", ({ key, value } = {}) => {
    const room = roomOf();
    const nx = room?.next;
    if (!nx || !nx.vote || room.phase !== "next" || !me()) return;
    const opt = GAMES[nx.gameId].playlist.options.find((o) => o.key === key);
    if (!opt || !opt.choices.some((c) => c.v === value)) return;
    (nx.votes[socket.data.playerId] ||= {})[key] = value;
    sendHub(room);
  });

  // L'hôte n'attend pas la fin des 30 s.
  socket.on("launchNow", () => {
    const room = roomOf();
    if (room && amHost() && room.phase === "next") launchNext(room);
  });

  // Podium d'un jeu de la playlist -> jeu suivant.
  socket.on("nextInPlaylist", () => {
    const room = roomOf();
    if (!room || !amHost() || room.phase !== "podium" || !room.playlist) return;
    room.playlist.index++;
    if (room.playlist.index >= room.playlist.order.length) endPlaylist(room);
    else startNext(room);
  });

  // --- Un joueur choisit sa couleur (dans le salon). Priorité sur les bots ; pas celle d'un autre joueur. ---
  socket.on("pickColor", ({ color } = {}, callback) => {
    const room = roomOf();
    const me = room && findPlayer(room, socket.data.playerId);
    if (!me || room.phase === "game") return callback?.({ error: "Pas pendant une partie." });
    if (!COLORS.includes(color)) return callback?.({ error: "Couleur inconnue." });
    const other = room.players.find((p) => p.color === color && p.id !== me.id);
    if (other && !other.bot) return callback?.({ error: `${other.pseudo} a déjà cette couleur.` });
    if (other) other.color = me.color;     // le bot prend mon ancienne couleur
    me.color = color;
    callback?.({ ok: true });
    sendHub(room);
  });

  // --- L'hôte ajoute un bot (pour tester seul ou compléter une partie) ---
  socket.on("addBot", (_, callback) => {
    const room = roomOf();
    if (!room || !amHost()) return callback?.({ error: "Seul l'hôte peut ajouter des bots." });
    if (room.phase === "game") return callback?.({ error: "Attends la fin du jeu en cours." });
    if (room.players.length >= MAX_PLAYERS) return callback?.({ error: `Salon plein (${MAX_PLAYERS} max).` });
    const used = new Set(room.players.map((p) => p.pseudo));
    const name = BOT_NAMES.find((n) => !used.has("🤖 " + n)) || "Bot";
    room.players.push({
      id: generatePlayerId(), pseudo: "🤖 " + name, color: freeColor(room),
      connected: true, score: 0, bot: true,
    });
    callback?.({ ok: true });
    sendHub(room);
  });

  // --- L'hôte expulse un joueur ou retire un bot (hors jeu en cours) ---
  socket.on("kickPlayer", ({ playerId } = {}) => {
    const room = roomOf();
    if (!room || !amHost() || room.phase === "game" || playerId === room.hostId) return;
    const p = findPlayer(room, playerId);
    if (p?.socketId) io.to(p.socketId).emit("kicked");
    removePlayer(room, playerId);
  });

  // --- Quitter le salon volontairement ---
  socket.on("leaveRoom", () => {
    const room = roomOf();
    if (!room) return;
    const id = socket.data.playerId;
    if (room.phase === "game") {
      // En plein jeu, on ne casse pas la partie : il passe juste hors ligne.
      handleDisconnect(room, id);
      socket.leave(room.code);
      socket.data = {};
    } else {
      removePlayer(room, id);
    }
  });

  // --- Coupure (onglet fermé, réseau...) ---
  socket.on("disconnect", () => {
    const room = roomOf();
    const p = me();
    // On ignore si le joueur s'est déjà reconnecté avec un autre onglet.
    if (room && p && p.socketId === socket.id) handleDisconnect(room, p.id);
  });
});

function handleDisconnect(room, playerId) {
  const p = findPlayer(room, playerId);
  if (!p) return;
  p.connected = false;
  p.socketId = null;
  if (room.hostId === playerId) {
    clearTimeout(room.hostTimer);
    room.hostTimer = setTimeout(() => {
      if (!findPlayer(room, room.hostId)?.connected) transferHost(room);
    }, HOST_GRACE_MS);
  }
  room.game?.onDisconnect(playerId);
  if (!humansOnline(room)) scheduleCleanup(room);
  sendHub(room);
  updatePause(room);   // un joueur en moins : la moitié nécessaire change
}

// ===================================================================
//  DÉMARRAGE
// ===================================================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n  🎉  Le Bordel (${VERSION}) tourne sur http://localhost:${PORT}\n`);
});
