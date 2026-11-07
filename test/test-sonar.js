// Test automatique : « Sonar » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-sonar.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/sonar/map.js";
import { createGame, PING, PING_R } from "../games/sonar/server.js";

const H = globalThis.Pieton, K = H.K, M = globalThis.SonarMap;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) { if (cond) { results.pass++; console.log("  ✅", label); } else { results.fail++; console.log("  ❌", label); } }

console.log("— Règles —");
{
  const a = M.build(9), b = M.build(9);
  check(JSON.stringify(a.rects) === JSON.stringify(b.rects) && a.rects.length >= 8, `Même seed = même arène (${a.rects.length} murs)`);
  let bad = 0;
  for (let s = 0; s < 100; s++) { const m = M.build(s * 7919); for (const p of m.spawns) if (m.rects.some((r) => p.x > r.x - 30 && p.x < r.x + r.w + 30 && p.y > r.y - 30 && p.y < r.y + r.h + 30)) bad++; }
  check(bad === 0, "100 arènes : aucun départ dans un mur");
  const list = ["a", "b"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const sent = [];
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: (id, type, p) => sent.push({ id, type, p }), savedSettings: { rounds: 4 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  const pub = JSON.stringify(game.publicState());
  check(!pub.includes(String(g.heroes.a.h.x)) && !/"heroes"/.test(pub), "L'état public ne donne pas la position des joueurs");
  g.phase = "play"; g.playAt = Date.now(); g.map.rects = [];
  const A = g.heroes.a, B = g.heroes.b;
  A.h.x = 300; A.h.y = 400; B.h.x = 300 + PING_R - 60; B.h.y = 400;
  const send = (id, k, a = 0) => { g.heroes[id].budget = 6; game.onAction(id, "in", { s: g.heroes[id].seq + 1, k, a }); };
  send("a", PING);
  const rv = sent.find((m) => m.type === "reveal" && m.id === "a");
  check(rv && rv.p.seen.length === 1 && g.pings.length === 1, "Un ping révèle (en privé) qui est dans le rayon, et tout le monde voit d'où il part");
  // Marcher normalement fait des échos, à pas de loup non.
  for (let i = 0; i < 30; i++) send("b", K.UP);
  const loud = g.steps.filter((s) => s.by === "b").length;
  for (let i = 0; i < 30; i++) send("b", K.UP | K.DASH);
  check(loud >= 2 && g.steps.filter((s) => s.by === "b").length === loud, `Marcher fait du bruit (${loud} échos), à pas de loup non`);
  // Tirer sur B : une touche = mort.
  B.h.x = 500; B.h.y = 400; A.prevK = 0;
  send("a", K.FIRE, 0);
  for (let i = 0; i < 20 && g.darts.length; i++) g.__step?.(1 / 30);
  check(typeof g.__step === "function" && !B.alive && A.elims === 1, "Une fléchette touche : éliminé");
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null, mine = null;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => (game = state));
socket.on("gameMsg", ({ type, payload }) => { if (type === "me") mine = payload; });
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); } return false; }
async function run() {
  console.log("— Partie —");
  await wait(300);
  await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "sonar" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Sonar » se lance");
  await act("start");
  await waitFor(() => game.phase === "play" && mine, 6000);
  check(!!mine, "Je reçois en privé ma position");
  const start = { x: mine.x, y: mine.y };
  let seq = 0;
  for (let i = 0; i < 30; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: i < 15 ? K.LEFT : K.UP, a: 0 } }); await wait(33); }
  await wait(250);
  check(!mine.alive || Math.hypot(mine.x - start.x, mine.y - start.y) > 30, "Je me déplace");
  await waitFor(() => game.phase === "roundOver", 130000);
  check(game.phase === "roundOver" && game.lastRound?.order.length === 4, "Fin de manche");
  await act("next");
  await wait(300);
  check(game.phase === "countdown" && game.round === 2, "Manche 2");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
