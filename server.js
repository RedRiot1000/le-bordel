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
const MAX_PLAYERS = 6;
const POINTS = [10, 7, 5, 3, 2, 1];          // points de soirée par place
const COLORS = ["#7c5cff", "#ff5c9d", "#38e8c8", "#ffb547", "#4ade80", "#2e9dff"];
const HOST_GRACE_MS = 15_000;                // délai avant de passer l'hôte à un autre
const ROOM_EMPTY_MS = 10 * 60_000;           // salon vide supprimé après 10 min

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

// Première couleur pas encore prise dans le salon.
function freeColor(room) {
  return COLORS.find((c) => !room.players.some((p) => p.color === c)) || COLORS[0];
}

// Catalogue envoyé aux clients (infos des jeux, sans le code).
const catalogue = {
  games: Object.values(GAMES).map((g) => g.meta),
  upcoming: UPCOMING,
};

// ===================================================================
//  ENVOI DE L'ÉTAT AUX JOUEURS
// ===================================================================
function publicHub(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,              // "lobby" | "game" | "podium"
    gameId: room.gameId,
    lastResult: room.lastResult,
    players: room.players.map((p) => ({
      id: p.id,
      pseudo: p.pseudo,
      color: p.color,
      connected: p.connected,
      score: p.score,
      isHost: p.id === room.hostId,
    })),
  };
}

function sendHub(room) {
  io.to(room.code).emit("hub", publicHub(room));
}

function sendGame(room, target = room.code) {
  if (!room.game) return;
  io.to(target).emit("game", { gameId: room.gameId, state: room.game.publicState() });
}

// ===================================================================
//  LANCER / TERMINER UN MINI-JEU
// ===================================================================
function startGame(room, gameId) {
  const def = GAMES[gameId];
  room.gameId = gameId;
  room.phase = "game";
  room.lastResult = null;

  // Le "contexte" : tout ce que le mini-jeu a le droit d'utiliser.
  const ctx = {
    players: () => room.players.map(({ id, pseudo, color, connected }) =>
      ({ id, pseudo, color, connected })),
    isHost: (id) => room.hostId === id,
    update: () => sendGame(room),
    sendTo: (playerId, type, payload) => {
      const p = findPlayer(room, playerId);
      if (p?.connected && p.socketId) io.to(p.socketId).emit("gameMsg", { type, payload });
    },
    finish: (ranking) => finishGame(room, ranking),
    savedSettings: room.gameSettings[gameId] || null,
    saveSettings: (s) => { room.gameSettings[gameId] = s; },
  };

  sendHub(room);                 // le client affiche l'écran du jeu...
  room.game = def.createGame(ctx);
  sendGame(room);                // ...puis reçoit son premier état
}

// ranking = liste de groupes d'ids, du 1er au dernier.
// Ex : [["a"], ["b","c"], ["d"]] -> a 1er, b et c 2es ex æquo, d 4e.
function finishGame(room, ranking = []) {
  room.game?.destroy();
  room.game = null;

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

  if (results.length) {
    room.lastResult = { gameId: room.gameId, results };
    room.phase = "podium";
  } else {
    // Personne n'a joué (jeu quitté avant la 1re manche) : retour direct au menu.
    room.phase = "lobby";
    room.gameId = null;
  }
  sendHub(room);
}

// L'hôte arrête le jeu en cours sans distribuer de points.
function abortGame(room) {
  room.game?.destroy();
  room.game = null;
  room.gameId = null;
  room.phase = "lobby";
  sendHub(room);
}

// ===================================================================
//  HÔTE ET NETTOYAGE
// ===================================================================
function transferHost(room) {
  const next = room.players.find((p) => p.connected && p.id !== room.hostId);
  if (!next) return;
  room.hostId = next.id;
  sendHub(room);
  sendGame(room);     // les boutons d'hôte du jeu changent de main
}

function scheduleCleanup(room) {
  clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    if (room.players.some((p) => p.connected)) return;
    room.game?.destroy();
    clearTimeout(room.hostTimer);
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
  if (room.players.length === 0) {
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
    if (room.phase === "game") return callback?.({ error: "Un jeu est déjà en cours." });
    const def = GAMES[gameId];
    if (!def) return callback?.({ error: "Jeu inconnu." });
    const n = room.players.length;
    if (n < def.meta.minPlayers) return callback?.({ error: `Il faut au moins ${def.meta.minPlayers} joueurs.` });
    if (n > def.meta.maxPlayers) return callback?.({ error: `${def.meta.maxPlayers} joueurs maximum pour ce jeu.` });
    callback?.({ ok: true });
    startGame(room, gameId);
  });

  // --- Action dans le mini-jeu en cours (transmise telle quelle) ---
  socket.on("gameAction", ({ type, data } = {}, callback) => {
    const room = roomOf();
    if (!room?.game || !me()) return callback?.({ error: "Aucun jeu en cours." });
    let res;
    try {
      res = room.game.onAction(socket.data.playerId, type, data || {});
    } catch (err) {
      console.error(`[${room.code}] erreur dans le jeu ${room.gameId} :`, err);
      res = { error: "Oups, le jeu a planté sur cette action." };
    }
    callback?.(res || { ok: true });
  });

  // --- L'hôte arrête le jeu (sans points) ---
  socket.on("abortGame", () => {
    const room = roomOf();
    if (room && amHost() && room.phase === "game") abortGame(room);
  });

  // --- Fin du podium : retour au menu ---
  socket.on("closePodium", () => {
    const room = roomOf();
    if (!room || !amHost() || room.phase !== "podium") return;
    room.phase = "lobby";
    room.gameId = null;
    sendHub(room);
  });

  // --- L'hôte expulse un joueur (hors jeu en cours) ---
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
  if (!room.players.some((x) => x.connected)) scheduleCleanup(room);
  sendHub(room);
}

// ===================================================================
//  DÉMARRAGE
// ===================================================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`\n  🎉  Le Bordel (${VERSION}) tourne sur http://localhost:${PORT}\n`);
});
