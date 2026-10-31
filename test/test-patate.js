// Test automatique : Patate chaude (voitures) avec 1 humain + 2 bots.
// Lance le serveur AVANT (node server.js), puis : node test/test-patate.js
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
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); }
  return false;
}

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Pilote" });
  await emit("addBot");
  await emit("addBot");
  await emit("pickGame", { gameId: "patate" });
  await wait(200);
  check(game?.phase === "setup", "Patate chaude : écran de réglages");

  console.log("\n— Manche 1 —");
  await act("settings", { settings: { fuse: "test", slippery: true } });
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.cars.length === 3, "3 voitures sur la ligne de départ");
  const map1 = game.map;
  check(map1.obstacles.length >= 3 && ["asphalte", "terre", "neige"].includes(map1.surface),
    `Map aléatoire : ${map1.surface}, ${map1.obstacles.length} obstacles, ${map1.oils.length} flaque(s)`);

  await waitFor(() => game.phase === "play", 5000);
  const start = game.cars.find((c) => c.id === me);
  const botStart = game.cars.filter((c) => c.id !== me).map((c) => ({ x: c.x, y: c.y }));

  // On accélère tout droit pendant 1 s (touches envoyées 30 fois/s, comme le navigateur).
  let seq = 0;
  for (let i = 0; i < 30; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: 1 } }); await wait(33); }
  await wait(150);
  const mine = game.cars.find((c) => c.id === me);
  const moved = Math.hypot(mine.x - start.x, mine.y - start.y);
  check(moved > 60, `Ma voiture avance (${moved.toFixed(0)} px, vitesse ${Math.hypot(mine.vx, mine.vy).toFixed(0)})`);
  check(mine.seq >= seq - 3, `Le serveur a traité mes touches (n° ${mine.seq}/${seq})`);
  const botsMoved = game.cars.filter((c) => c.id !== me).every((c, i) => Math.hypot(c.x - botStart[i].x, c.y - botStart[i].y) > 20);
  check(botsMoved, "Les bots conduisent");

  // On lâche tout et on attend la fin de la manche.
  socket.emit("gameAction", { type: "in", data: { s: ++seq, k: 0 } });
  const over = await waitFor(() => game.phase === "roundOver", 25000);
  check(over, "Fin de manche (2 explosions)");
  const pts = game.lastRound?.map((r) => r.points).sort();
  check(JSON.stringify(pts) === "[0,1,2]", "Points de manche 2 / 1 / 0");
  check(game.cars.filter((c) => !c.alive).length === 2, "Les 2 épaves restent dans l'arène");

  console.log("\n— Manche 2 —");
  await act("start");
  await wait(200);
  check(game.map.id !== map1.id, "Nouvelle map tirée au hasard");
  await waitFor(() => game.phase === "roundOver", 25000);

  console.log("\n— Fin du jeu —");
  await act("finish");
  await wait(200);
  check(hub.phase === "podium", "Podium");

  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

setTimeout(() => { console.log("\n❌ Test bloqué (80 s)"); process.exit(1); }, 80_000);
run().catch((e) => { console.error(e); process.exit(1); });
