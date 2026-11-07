// Test automatique : « Puck » (1 humain + 2 bots, donc un robot complète).
// Lance le serveur AVANT (node server.js), puis : node test/test-puck.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/puck/rink.js";
import { createGame } from "../games/puck/server.js";

const H = globalThis.Pieton, K = H.K, R = globalThis.Rink;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) { if (cond) { results.pass++; console.log("  ✅", label); } else { results.fail++; console.log("  ❌", label); } }

console.log("— Patinoire et règles —");
{
  // Le palet rebondit sur la bande et ralentit.
  const p = { x: R.CX, y: R.CY - 200, vx: 0, vy: -900 };
  for (let i = 0; i < 30; i++) R.movePuck(p, 1 / 30);
  check(p.vy > 0 && p.y > R.Y0, "Le palet rebondit sur la bande");
  const q = { x: R.CX, y: R.CY, vx: 800, vy: 0 };
  let goal = 0;
  for (let i = 0; i < 60 && !goal; i++) goal = R.movePuck(q, 1 / 30);
  check(goal === 2, "Dans le but de droite : but pour l'équipe 1");
  const z = { x: R.CX, y: R.CY + 300, vx: 900, vy: 0 };
  let g2 = 0;
  for (let i = 0; i < 60 && !g2; i++) g2 = R.movePuck(z, 1 / 30);
  check(g2 === 0 && z.x < R.X1, "À côté du but : il rebondit, pas de but");
  const list = ["a", "b", "c"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: () => {}, savedSettings: { rounds: 1, minutes: 2 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  check(Object.keys(g.heroes).length === 4 && g.heroes.robot && g.heroes.robot.team === 2, "3 joueurs : un robot complète (2 contre 2)");
  g.phase = "play"; g.playAt = Date.now(); g.faceoffUntil = 0;
  const A = g.heroes.a;
  A.h.x = R.CX - 40; A.h.y = R.CY; g.puck = { x: R.CX - 10, y: R.CY, vx: 0, vy: 0 };
  for (const o of Object.values(g.heroes)) if (o !== A) { o.h.x = R.CX - 400; o.h.y = R.CY + 250; }
  g.__stepPuck?.(1 / 30);
  check(typeof g.__stepPuck === "function" && g.carrier === "a", "Passer sur le palet : on le prend");
  const send = (k, a = 0) => { A.budget = 6; game.onAction("a", "in", { s: A.seq + 1, k, a }); };
  send(K.FIRE, 0); A.charging -= 900; send(0, 0);
  check(g.carrier === null && g.puck.vx > 1000, `Clic maintenu puis relâché : tir puissant (${Math.round(g.puck.vx)} px/s)`);
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
  const picked = await emit("pickGame", { gameId: "puck" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Puck » se lance");
  await act("settings", { settings: { rounds: 1, minutes: 2 } });
  await act("start");
  await wait(300);
  const t1 = game.heroes.filter((h) => h.team === 1).length, t2 = game.heroes.filter((h) => h.team === 2).length;
  check(game.phase === "countdown" && t1 === 2 && t2 === 2, "4 joueurs : 2 contre 2");
  await waitFor(() => game.phase === "play" && !game.faceoff, 8000);
  const m0 = game.heroes.find((h) => h.id === me);
  let seq = 0;
  for (let i = 0; i < 30; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: K.UP, a: 0 } }); await wait(33); }
  await wait(250);
  const m1 = game.heroes.find((h) => h.id === me);
  check(Math.hypot(m1.x - m0.x, m1.y - m0.y) > 40, "Je patine");
  await waitFor(() => game.phase === "over", 140000);
  const lr = game.lastRound;
  check(game.phase === "over" && lr && lr.goals[1] + lr.goals[2] >= 1, `Fin du match : ${lr?.goals[1]} – ${lr?.goals[2]}`);
  check(lr.order.every((id) => lr.gains[id] === lr.scorers[id] * 2 + (lr.win === 0 ? 1 : lr.teamOf[id] === lr.win ? 3 : 0)), "Points : +2 par but, +3 pour l'équipe gagnante");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
