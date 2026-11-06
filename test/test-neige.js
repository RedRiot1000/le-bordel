// Test automatique : « Boules de neige » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-neige.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import { MAKE, speedOf, rangeOf, wallRect } from "../games/neige/server.js";

const K = globalThis.Pieton.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Règles —");
check(speedOf(0) < speedOf(1) && rangeOf(0) < rangeOf(1), `Plus c'est chargé, plus ça va vite et loin (${rangeOf(0)} → ${rangeOf(1)} px)`);
const w = { x: 0, y: 0, w: 100, h: 40, hp: 4 }, w2 = { ...w, hp: 1 };
check(wallRect(w).w === 100 && wallRect(w2).w < 60, `Un muret abîmé rétrécit (100 → ${Math.round(wallRect(w2).w)} px)`);

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
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "neige" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Boules de neige » se lance");
  check(game.settings.rounds === 5 && game.settings.mode === "auto", "Par défaut : 5 manches, mode alterné");
  await act("settings", { settings: { mode: "equipes" } });
  await wait(100);
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.teamsMode && game.heroes.length === 4, "4 joueurs → 2 équipes");
  check(game.walls.length >= 4, `${game.walls.length} murets de neige`);
  const mine0 = game.heroes.find((h) => h.id === me);
  check(mine0.hearts === 3 && mine0.balls === 3, "3 cœurs et 3 boules au départ");

  await waitFor(() => game.phase === "play", 5000);
  let seq = 1;
  const send = (k, a = 0) => socket.emit("gameAction", { type: "in", data: { s: ++seq, k, a } });
  // Charger ~0,5 s puis lâcher.
  for (let i = 0; i < 15; i++) { send(K.FIRE); await wait(33); }
  check(game.heroes.find((h) => h.id === me).charge > 0.2, "Clic maintenu : la charge monte");
  send(0);
  await wait(100);
  const ball = game.balls.find((b) => b.team === game.teamOf[me]);
  const me1 = game.heroes.find((h) => h.id === me);
  check(me1.balls === 2, "Lâcher = une boule lancée (2 restantes)");
  if (ball) { const sp = Math.hypot(ball.vx, ball.vy); check(sp > speedOf(0.25) && sp < speedOf(0.9), `Vitesse selon la charge (${Math.round(sp)} px/s)`); }
  // Fabriquer : immobile 1 s, puis +1 boule (même en appuyant sur une flèche).
  await wait(300);
  const before = game.heroes.find((h) => h.id === me);
  for (let i = 0; i < 18; i++) { send(MAKE | K.UP); await wait(33); }   // ~0,6 s : en pleine fabrication
  const during = game.heroes.find((h) => h.id === me);
  for (let i = 0; i < 20; i++) { send(MAKE); await wait(33); }          // on finit
  send(0);
  await wait(100);
  const after = game.heroes.find((h) => h.id === me);
  if (after.alive && !during.hurt) {
    check(Math.hypot(during.x - before.x, during.y - before.y) < 15 && during.balls === 2, "Pendant la fabrication on ne bouge pas (même en appuyant sur une flèche)");
    check(after.balls === 3, "Clic droit maintenu 1 s : +1 boule");
  }

  // On laisse la manche se finir.
  await waitFor(() => game.phase === "roundOver", 120000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr, `Fin de manche : ${lr?.winTeam ? "équipe " + lr.winTeam + " gagne" : "?"}`);
  const okPts = Object.entries(lr.gains).every(([id, n]) => n === (game.teamOf[id] === lr.winTeam ? 3 : 0) + (lr.elims[id] || 0));
  check(okPts, "Points : 3 pour l'équipe gagnante + 1 par élimination");
  check(Object.values(lr.elims).reduce((a, b) => a + b, 0) >= 1, "Il y a eu des éliminations");

  await act("next");
  await wait(200);
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
