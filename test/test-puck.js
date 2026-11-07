// Test automatique : « Puck » (air hockey, 1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-puck.js
import { io } from "socket.io-client";
import "../public/games/puck/rink.js";
import { createGame, clampMallet, MALLET_R } from "../games/puck/server.js";

const R = globalThis.Rink;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) { if (cond) { results.pass++; console.log("  ✅", label); } else { results.fail++; console.log("  ❌", label); } }

console.log("— Table et règles —");
{
  const p = { x: R.CX, y: R.CY - 200, vx: 0, vy: -900 };
  for (let i = 0; i < 30; i++) R.movePuck(p, 1 / 30);
  check(p.vy > 0 && p.y > R.Y0, "Le palet rebondit sur la bande");
  const q = { x: R.CX, y: R.CY, vx: 900, vy: 0 };
  let goal = 0;
  for (let i = 0; i < 60 && !goal; i++) goal = R.movePuck(q, 1 / 30);
  check(goal === 2, "Dans le but de droite : but pour l'équipe 1");
  const m1 = clampMallet(1, { x: R.CX + 300, y: R.CY }), m2 = clampMallet(2, { x: R.X0, y: R.CY });
  check(m1.x <= R.CX - MALLET_R && m2.x >= R.CX + MALLET_R, "Les maillets ne passent jamais la ligne du milieu");
  const list = ["a", "b", "c"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: () => {}, savedSettings: { rounds: 1, minutes: 2 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  check(Object.keys(g.mallets).length === 4 && g.mallets.robot?.team === 2, "3 joueurs : un robot complète (2 contre 2)");
  g.phase = "play"; g.playAt = Date.now(); g.faceoffUntil = 0;
  // Un maillet lancé sur le palet l'envoie loin.
  const A = g.mallets.a, side = A.team === 1 ? 1 : -1;
  for (const m of Object.values(g.mallets)) if (m !== A) { m.x = m.tx = m.team === 1 ? R.X0 + 60 : R.X1 - 60; m.y = m.ty = R.Y0 + 60; }
  A.x = R.CX - side * 300; A.y = R.CY; g.puck = { x: R.CX - side * 220, y: R.CY, vx: 0, vy: 0 };
  game.onAction("a", "in", { p: { x: R.CX - side * 40, y: R.CY } });
  for (let i = 0; i < 6; i++) { g.__moveMallets(1 / 30); g.__stepPuck(1 / 30); }
  check(Math.abs(g.puck.vx) > 700 && Math.sign(g.puck.vx) === side, `Percuter le palet l'envoie vers le camp adverse (${Math.round(g.puck.vx)} px/s)`);
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
  await act("settings", { settings: { rounds: 3, minutes: 2 } });
  await act("start");
  await wait(300);
  check(game.phase === "countdown" && game.mallets.filter((m) => m.team === 1).length === 2, "4 joueurs : 2 contre 2");
  await waitFor(() => game.phase === "play" && !game.faceoff, 8000);
  const mine = game.mallets.find((m) => m.id === me), target = { x: mine.team === 1 ? R.CX + 400 : R.CX - 400, y: R.Y0 + 100 };
  for (let i = 0; i < 30; i++) { socket.emit("gameAction", { type: "in", data: { p: target } }); await wait(33); }
  await wait(200);
  const m1 = game.mallets.find((m) => m.id === me);
  check(Math.abs(m1.x - R.CX) <= MALLET_R + 2 && m1.y < R.CY - 150, "Mon maillet suit la souris, et s'arrête à la ligne du milieu");
  await waitFor(() => game.phase === "roundOver", 140000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr, `Fin du match : ${lr?.goals[1]} – ${lr?.goals[2]}`);
  check(lr.order.every((id) => lr.gains[id] === lr.scorers[id] * 2 + (lr.win === 0 ? 1 : lr.teamOf[id] === lr.win ? 3 : 0)), "Points : +2 par but, +3 pour l'équipe gagnante");
  await waitFor(() => game.phase === "countdown" && game.round === 2, 12000);
  check(game.round === 2, "Le match suivant se lance tout seul");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
