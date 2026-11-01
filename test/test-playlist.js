// Test automatique du mode PLAYLIST (1 humain + 2 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-playlist.js
import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => (game = state));
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const send = (ev, data = {}) => socket.emit(ev, data);
const act = (type, data = {}) => emit("gameAction", { type, data });

async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(100); }
  return false;
}

// Joue une manche d'Imposter jusqu'au bout (indices, vote, continuer).
async function playImposterRound(me) {
  return waitFor(() => {
    const r = game?.round;
    if (!r) return false;
    if (game.phase === "clues" && r.currentPlayerId === me) act("clue", { text: "x" + r.clues.length + Math.random().toString(36).slice(2, 5) });
    if (game.phase === "vote" && r.alive.includes(me) && !r.votedIds.includes(me)) act("vote", { targetId: r.alive.find((id) => id !== me) });
    if (game.phase === "result") act("continue");
    return game.phase === "gameOver";
  }, 60000);
}

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Hôte" });
  await emit("addBot"); await emit("addBot");

  console.log("\n— Playlist 1 : Patate chaude, réglages par défaut —");
  send("setLobbyMode", { mode: "playlist" });
  send("setDraft", { games: ["patate"], settingsMode: "default", count: 1 });
  await wait(200);
  check(hub.lobbyMode === "playlist" && hub.draft.games.join() === "patate", "Mode playlist, Patate cochée");
  await emit("startPlaylist");
  await wait(150);
  check(hub.phase === "next" && hub.next.vote === false && hub.next.gameId === "patate", "Écran « prochain jeu » sans vote");
  check(await waitFor(() => hub.phase === "game", 7000), "Le jeu se lance tout seul après 5 s");
  await waitFor(() => game, 1000);
  check(game.phase === "vehicle" && game.vehicleVote?.choices.length === 2, "Pas d'écran de réglages : direct au vote du véhicule");
  check(game.playlist?.rounds === 3 && game.settings.fuse === "normale", `Normal par défaut : 3 manches, mèche ${game.settings.fuse}`);
  send("abortGame");
  await wait(200);
  check(hub.phase === "lobby" && !hub.playlist, "L'hôte arrête la playlist → retour au salon");

  console.log("\n— Playlist 2 : Imposter ×2, vote des réglages —");
  game = null;
  send("setDraft", { games: ["imposter"], settingsMode: "vote", count: 2 });
  await wait(150);
  await emit("startPlaylist");
  await wait(150);
  check(hub.phase === "next" && hub.next.vote && hub.next.left > 25000, "Vote ouvert pendant 30 s");
  send("voteOption", { key: "difficulty", value: "difficile" });
  send("voteOption", { key: "rounds", value: "2" });
  send("voteOption", { key: "rounds", value: "999" });          // valeur invalide : ignorée
  await wait(200);
  check(hub.next.votes.difficulty?.difficile?.includes(me) && hub.next.votes.rounds?.["2"]?.includes(me) && !hub.next.votes.rounds?.["999"],
    "Mes votes sont comptés (et une valeur bidon est refusée)");
  send("launchNow");
  check(await waitFor(() => hub.phase === "game" && game, 3000), "L'hôte lance sans attendre la fin du vote");
  check(game.settings.timers.clue === 30 && game.settings.clueRounds === 2 && !game.settings.mrWhiteEnabled,
    "Difficile appliqué : 30 s par indice, 2 tours, pas de Mr White");
  check(game.playlist.rounds === 2, "2 manches votées");

  check(await playImposterRound(me), "Manche 1 jouée");
  check(game.playlist.played === 1 && !game.playlist.final, "Après la manche 1 : pas fini");
  await act("start");
  await waitFor(() => game.phase === "clues", 2000);
  check(await playImposterRound(me), "Manche 2 jouée");
  check(game.playlist.final && game.playlist.finishLeft > 10000, `Dernière manche : classement auto dans ${Math.round(game.playlist.finishLeft / 1000)} s`);
  const refused = await act("start");
  await wait(150);
  check(game.phase === "gameOver", "Impossible de lancer une 3e manche");
  await act("finish");
  await wait(200);
  check(hub.phase === "podium" && hub.lastResult.playlist?.num === 1 && !hub.lastResult.playlist.final, "Podium du jeu 1/2");

  send("nextInPlaylist");
  await wait(200);
  check(hub.phase === "next" && hub.next.num === 2, "Jeu suivant : vote du jeu 2/2");
  send("launchNow");
  await waitFor(() => hub.phase === "game", 3000);
  check(game.playlist.rounds === 2 && game.settings.timers.clue === 60, "Personne n'a voté → réglages par défaut (Normal, 2 manches)");
  await playImposterRound(me); await act("start"); await waitFor(() => game.phase === "clues", 2000); await playImposterRound(me);
  await act("finish");
  await wait(200);
  check(hub.phase === "podium" && hub.lastResult.playlist?.final, "Podium final de la playlist");
  send("closePodium");
  await wait(200);
  check(hub.phase === "lobby" && !hub.playlist, "Retour au salon, playlist terminée");

  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

setTimeout(() => { console.log("\n❌ Test bloqué (4 min)"); process.exit(1); }, 240_000);
run().catch((e) => { console.error(e); process.exit(1); });
