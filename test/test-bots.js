// Test automatique : un seul humain + 2 bots jouent à Imposter puis Patate chaude.
// Lance le serveur AVANT (node server.js), puis : node test/test-bots.js
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
const act = (type, data = {}) => emit("gameAction", { type, data });

async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(100); }
  return false;
}

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Solo" });

  console.log("\n— Salon —");
  const tooFew = await emit("pickGame", { gameId: "imposter" });
  check(!!tooFew.error, "Seul : message clair → " + tooFew.error);
  await emit("addBot");
  await emit("addBot");
  await wait(200);
  check(hub.players.length === 3 && hub.players.filter((p) => p.bot).length === 2, "2 bots ajoutés : " + hub.players.map((p) => p.pseudo).join(", "));

  console.log("\n— Imposter avec bots —");
  await emit("pickGame", { gameId: "imposter" });
  await wait(200);
  await act("settings", { settings: { clueRounds: 1, mrWhiteEnabled: false } });
  await act("start");
  // On joue notre tour quand il arrive, on vote, on continue après chaque résultat.
  const done = await waitFor(() => {
    const r = game?.round;
    if (!r) return false;
    if (game.phase === "clues" && r.currentPlayerId === me) act("clue", { text: "moi" + r.clues.length });
    if (game.phase === "vote" && r.alive.includes(me) && !r.votedIds.includes(me)) {
      act("vote", { targetId: r.alive.find((id) => id !== me) });
    }
    if (game.phase === "result") act("continue");
    return game.phase === "gameOver";
  }, 30000);
  check(done, "Les bots donnent leurs indices et votent : la manche va au bout");
  const botClues = game.round.clues.filter((c) => c.playerId !== me && !c.absent);
  check(botClues.length >= 2, "Indices des bots : " + botClues.map((c) => c.text).join(", "));
  await act("finish");
  await wait(200);
  check(hub.phase === "podium", "Podium");
  socket.emit("closePodium");
  await wait(200);

  console.log("\n— Patate chaude avec bots —");
  await emit("pickGame", { gameId: "patate" });
  await wait(200);
  await act("settings", { settings: { fuse: "test", obstacles: true, vehicle: "hasard" } });
  await act("start");
  let passes = 0, last = null;
  const over = await waitFor(() => {
    if (game.phase === "play" && game.holderId && last && game.holderId !== last) passes++;
    if (game.holderId) last = game.holderId;
    return game.phase === "roundOver";
  }, 30000);
  check(over, "La manche se termine (les bots bougent et explosent)");
  console.log("     passes vues :", passes, "· classement :", game.lastRound?.map((r) => r.points).join("/"));

  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

setTimeout(() => { console.log("\n❌ Test bloqué (75 s)"); process.exit(1); }, 75_000);
run().catch((e) => { console.error(e); process.exit(1); });
