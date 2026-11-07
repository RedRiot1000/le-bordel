// Test automatique : « Golf de combat » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-golf.js
import { io } from "socket.io-client";
import "../public/games/golf/course.js";
import { createGame } from "../games/golf/server.js";

const G = globalThis.Golf;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) { if (cond) { results.pass++; console.log("  ✅", label); } else { results.fail++; console.log("  ❌", label); } }

console.log("— Trou et balles —");
{
  const a = G.build(3), b = G.build(3);
  check(JSON.stringify(a.segs) === JSON.stringify(b.segs), "Même seed = même trou");
  let bad = 0, joins = 0;
  for (let s = 0; s < 200; s++) {
    const h = G.build(s * 7919);
    if (!G.onCourse(h, h.tee.x, h.tee.y) || !G.onCourse(h, h.cup.x, h.cup.y) || G.inWater(h, h.cup.x, h.cup.y)) bad++;
    for (let i = 0; i + 1 < h.segs.length; i++) { const p = h.segs[i], q = h.segs[i + 1]; if (Math.min(p.x + p.w, q.x + q.w) - Math.max(p.x, q.x) < 100 || Math.min(p.y + p.h, q.y + q.h) - Math.max(p.y, q.y) < 100) joins++; }
  }
  check(bad === 0 && joins === 0, "200 trous : départ et trou sur le gazon, couloirs bien raccordés");
  {
    const lens = new Set(), obs = [];
    let boosts = 0, thin = 0;
    for (let s = 0; s < 120; s++) { const h = G.build(s * 104729); lens.add(h.segs.length); obs.push(h.blocks.length + h.bumpers.length + h.water.length + h.sand.length + h.boosts.length); boosts += h.boosts.length; thin += h.blocks.filter((b) => Math.min(b.w, b.h) < 20).length; }
    check(lens.has(1) && lens.has(2) && Math.max(...lens) >= 5, `Des trous très courts et très longs (${[...lens].sort().join(", ")} couloirs)`);
    check(Math.max(...obs) >= 10 && boosts > 10 && thin > 10, `Plus d'obstacles, des tapis et des barrières (jusqu'à ${Math.max(...obs)} obstacles)`);
  }
  // Une balle rebondit sur le bord et s'arrête.
  const flat = { segs: [{ x: 0, y: 0, w: 600, h: 300 }], blocks: [], bumpers: [], water: [], sand: [], cup: { x: 9999, y: 9999 } };
  const ball = { x: 300, y: 150, vx: 900, vy: 0 };
  for (let i = 0; i < 200; i++) G.roll(flat, ball, 1 / 30);
  check(ball.vx === 0 && ball.x < 600, "La balle rebondit sur la bordure, puis s'arrête");
  // Deux balles se cognent : celle qui était arrêtée part.
  const p = { x: 100, y: 100, vx: 500, vy: 0 }, q = { x: 116, y: 100, vx: 0, vy: 0 };
  G.collide(p, q);
  check(q.vx > 300 && p.vx < 200, "Les balles se cognent : l'autre part");
  // L'eau.
  const wet = { ...flat, water: [{ x: 400, y: 100, w: 100, h: 100 }] }, w2 = { x: 300, y: 150, vx: 700, vy: 0 };
  let res = null;
  for (let i = 0; i < 60 && !res; i++) res = G.roll(wet, w2, 1 / 30);
  check(res === "eau", "Dans l'eau : plouf");
  const list = ["a", "b"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: () => {}, savedSettings: { rounds: 4 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  g.phase = "play"; g.playAt = Date.now();
  const A = g.balls.a;
  game.onAction("a", "in", { s: 1, k: 32, a: 0 });
  A.charging -= 600;
  game.onAction("a", "in", { s: 2, k: 0, a: 0 });
  check(A.strokes === 1 && A.vx > 400, `Clic maintenu puis lâché : la balle part (${Math.round(A.vx)} px/s)`);
  game.onAction("a", "in", { s: 3, k: 32, a: 0 });
  game.onAction("a", "in", { s: 4, k: 0, a: 0 });
  check(A.strokes === 1, "On ne retape pas tant que la balle roule");
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => (game = state));
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); } return false; }
async function run() {
  console.log("— Partie —");
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "golf" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Golf de combat » se lance");
  await act("start");
  await waitFor(() => game.phase === "play", 6000);
  const h = G.build(game.seed);
  const a = Math.atan2(h.cup.y - h.tee.y, h.cup.x - h.tee.x);
  let seq = 0;
  for (let i = 0; i < 12; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: 32, a } }); await wait(33); }
  socket.emit("gameAction", { type: "in", data: { s: ++seq, k: 0, a } });
  await wait(300);
  check(game.balls.find((b) => b.id === me).strokes === 1, "Mon coup est compté");
  check(game.balls.filter((b) => b.id !== me).some((b) => b.strokes >= 1), "Les bots jouent en même temps");
  await waitFor(() => game.phase === "roundOver", 100000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin du trou");
  check(lr.order.every((id, i) => i === 0 || lr.strokes[id] >= lr.strokes[lr.order[i - 1]]) && lr.gains[lr.order[0]] === 10, "Le moins de coups gagne (10 points)");
  await act("next");
  await wait(300);
  check(game.phase === "countdown" && game.round === 2 && game.seed !== h.seed, "Trou 2 : un nouveau trou");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 160000);
