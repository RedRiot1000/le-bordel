// Test automatique : « Cambrioleurs » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-casse.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/manoir/manor.js";
import "../public/games/casse/loot.js";

const H = globalThis.Pieton;
const M = globalThis.Manoir;
const C = globalThis.Casse;
const K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Manoir et butin —");
{
  const big = M.build(77, 8), small = M.build(77, 8, { small: true });
  check(small.manorRect.w < big.manorRect.w && small.manorRect.h < big.manorRect.h, `Manoir plus petit (${small.manorRect.w}×${small.manorRect.h} au lieu de ${big.manorRect.w}×${big.manorRect.h})`);
  check(JSON.stringify(M.build(5, 4, { small: true }).walls) === JSON.stringify(M.build(5, 4, { small: true }).walls), "Même seed = même manoir");
  let ok = true;
  for (let s = 1; s <= 25; s++) for (const n of [2, 5, 8]) { const m = M.build(s * 991, n, { small: true }); if (!m.portals.length || m.rooms.length < 6) ok = false; }
  check(ok, "75 petits manoirs valides (pièces, passages)");
  const v = (k) => C.LOOT[k];
  check(v("argenterie").value < v("vase").value && v("vase").value < v("tableau").value && v("tableau").value < v("coffre").value, "Plus ça vaut cher…");
  check(C.speedOf(null) > v("argenterie").speed && v("argenterie").speed > v("vase").speed && v("vase").speed > v("tableau").speed && v("tableau").speed > v("coffre").speed, "… plus on est lent");
  check(C.GUARD_SPEED < C.FREE_SPEED && C.GUARD_SPEED > v("tableau").speed, "Gardien : moins vite que les mains vides, plus vite qu'un tableau");
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
  console.log("— Partie —");
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Voleur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "casse" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Cambrioleurs » se lance");
  await act("start");
  await wait(250);
  check(game.phase === "countdown" && game.heroes.length === 4 && game.vans.length === 4 && game.loot.length > 10 && game.guards.length >= 2, `4 joueurs, 4 camionnettes, ${game.loot.length} objets, ${game.guards.length} gardiens`);
  const myVan = game.vans.find((v) => v.id === me), mine0 = game.heroes.find((h) => h.id === me);
  check(Math.hypot(myVan.x - mine0.x, myVan.y - mine0.y) < 5, "Départ à sa camionnette");
  await waitFor(() => game.phase === "play", 5000);
  // Je marche : le serveur me suit.
  let seq = 0;
  for (let i = 0; i < 45; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: K.UP } }); await wait(33); }
  await wait(200);
  const mine = game.heroes.find((h) => h.id === me);
  check(Math.hypot(mine.x - mine0.x, mine.y - mine0.y) > 100 && mine.dash === 0 || mine.y < mine0.y, `Je marche (${Math.round(mine0.y - mine.y)} px)`);
  // Les bots ramènent du butin.
  const earned = await waitFor(() => game.heroes.some((h) => h.money > 0), 40000);
  check(earned, `Les bots encaissent (${game.heroes.map((h) => h.money).join(" / ")})`);
  check(game.timeLeft > 0 && game.timeLeft <= 150000, "Chrono de 2 min 30");
  const alarm = await waitFor(() => game.alarm, 130000);
  check(alarm && game.timeLeft <= 30000, "L'alarme sonne dans les 30 dernières secondes");
  await waitFor(() => game.phase === "roundOver", 35000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de manche");
  const ms = lr.order.map((id) => lr.money[id]);
  check(ms.every((m, i) => i === 0 || m <= ms[i - 1]), `Classement à l'argent (${ms.join(" ≥ ")} $)`);
  check(lr.gains[lr.order[0]] === 10, "Le plus riche prend 10 points");
  await act("next");
  await wait(250);
  check(game.phase === "countdown" && game.round === 2, "Manche 2 (nouveau manoir)");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 230000);
