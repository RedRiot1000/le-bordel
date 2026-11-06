// Test automatique : « Cavale » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-cavale.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/cavale/quartier.js";
import { copCount, RANGE, ROUND_MS } from "../games/cavale/server.js";

const Q = globalThis.Quartier, H = globalThis.Pieton, K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Quartier —");
{
  const a = Q.build(77), b = Q.build(77), c = Q.build(78);
  check(a.cells.join() === b.cells.join() && a.runSpots[0].x === b.runSpots[0].x, "Même seed = même quartier");
  check(a.cells.join() !== c.cells.join(), "Une autre seed = un autre quartier");
  let ok = true, houses = 0, walls = 1;
  for (let s = 0; s < 80; s++) {
    const t = Q.build(s * 7919);
    const on = (p) => t.walk[Math.floor(p.y / Q.T) * Q.COLS + Math.floor(p.x / Q.T)];
    const p = Q.prisonSpot((s * 523) % Q.W, (s * 311) % Q.H);
    Q.prisonAt(t, p.c, p.r);
    if (![...t.buttons, ...t.freeSpots, ...t.runSpots.slice(0, 20).filter(on)].every(on)) ok = false;
    if (t.copSpots.length < 3) ok = false;
    if (t.runSpots.length < 40 || t.boxSpots.length < 24 || t.cars.length < 15) ok = false;
    if (t.ground.includes(Q.FLOOR)) houses++;
    walls = Math.min(walls, t.cells.filter((v) => v).length / t.cells.length);
  }
  check(ok, "80 quartiers, prison posée n'importe où : boutons et sorties accessibles, voitures garées");
  check(houses >= 70, `Des maisons à traverser (${houses}/80 quartiers)`);
  check(walls > 0.08, `Le quartier n'est pas vide (au moins ${Math.round(walls * 100)} % de murs)`);
  const t = Q.build(5);
  check(t.prison === null && t.buttons.length === 0, "Au début, pas de prison : c'est un gardien qui la pose");
  const sp = Q.prisonSpot(99999, -50);
  check(sp.c + Q.PW < Q.COLS && sp.r > 0, "La prison reste dans le quartier, même posée dans un coin");
  Q.prisonAt(t, 40, 30);
  const P = t.prison;
  const inside = t.jailSpots[0], out = t.buttons[0];
  check(!t.walk[Math.floor(inside.y / Q.T) * Q.COLS + Math.floor(inside.x / Q.T)], "La prison n'est pas reliée au quartier");
  check(t.buttons.length === 2 && t.buttons[0].x < P.x && t.buttons[1].x > P.x + P.w, "2 boutons, de chaque côté de la prison");
  check(!Q.sees(t, inside, out), "On ne tire pas à travers les murs de la prison");
  const f = Q.flow(t, t.buttons[1].x, t.buttons[1].y), p = Q.next(t, f, t.runSpots[0].x, t.runSpots[0].y);
  check(p && p.left > 0, "Les bots trouvent un chemin jusqu'au bouton");
  check(Q.near(t, P.x - 20, P.cy).every((o) => o.x + o.w <= P.x + 1 || o.x >= P.x - 1), "Une place dégagée autour de la prison");
  check(copCount(3) === 1 && copCount(4) === 1 && copCount(5) === 1 && copCount(6) === 2 && copCount(8) === 2, "1 flic jusqu'à 5 joueurs, puis 2");
  check(ROUND_MS === 120000 && RANGE > 200, "Manche de 2 min");
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
  const { playerId: me } = await emit("createRoom", { pseudo: "Testeur" });
  await emit("addBot");
  await wait(150);
  const few = await emit("pickGame", { gameId: "cavale" });
  check(!few.ok, "Il faut au moins 3 joueurs");
  for (let i = 0; i < 2; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "cavale" });
  await wait(250);
  check(picked.ok && game?.phase === "setup", "« Cavale » se lance");
  await act("settings", { settings: { rounds: 3 } });
  await wait(100);
  await act("start");
  await wait(300);
  check(game.phase === "countdown" && game.heroes.length === 4, "4 joueurs dans le quartier");
  check(game.heroes.filter((h) => h.role === "cop").length === 1, "1 flic, 3 runners");
  const round1Cop = game.heroes.find((h) => h.role === "cop").id;
  await waitFor(() => game.phase === "play", 5000);
  check(game.prison === null && game.heroes.find((h) => h.id === game.warden)?.role === "cop", "Un gardien doit poser la prison");
  if (game.warden === me) { await wait(300); socket.emit("gameAction", { type: "in", data: { s: 1, k: K.DASH, a: 0 } }); }
  await waitFor(() => game.prison, 11000);
  check(!!game.prison, `La prison est posée (case ${game.prison?.c}, ${game.prison?.r})`);
  // Je cours en calculant de mon côté, comme le navigateur : le serveur doit trouver pareil.
  await waitFor(() => game.copWait <= 0, 6000);
  let seq = 5;
  const m0 = game.heroes.find((h) => h.id === me);
  const t = Q.build(game.seed);
  Q.prisonAt(t, game.prison.c, game.prison.r);
  const pred = H.copy(m0); pred.stun = 0;
  const keys = [K.UP, K.UP | K.LEFT, K.LEFT, K.DOWN | K.LEFT, K.DOWN, K.RIGHT];
  let stepN = 0, worst = 0;
  await wait(300);
  Object.assign(pred, H.copy(game.heroes.find((h) => h.id === me))); pred.stun = 0;
  for (let i = 0; i < 90; i++) {
    const cur = game.heroes.find((h) => h.id === me);
    if (cur.jailed || cur.stun > 0 || cur.lock) break;
    const k = keys[Math.floor(i / 15)];
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k, a: null } });
    H.simulate(pred, k, null, { walls: true, w: Q.W, h: Q.H, noDash: true, speedMul: cur.spd, rects: [...Q.near(t, pred.x, pred.y), ...game.bars] }, []);
    stepN++;
    await wait(33);
  }
  await wait(250);
  const m1 = game.heroes.find((h) => h.id === me);
  worst = Math.hypot(m1.x - pred.x, m1.y - pred.y);
  check(m1.jailed || m1.stun > 0 || (stepN > 10 && worst < 40), `Le serveur calcule la même chose que moi (écart ${Math.round(worst)} px sur ${stepN} pas)`);
  // On laisse les bots jouer.
  await waitFor(() => game.phase === "roundOver", 135000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && ["cops", "runners"].includes(lr.win), `Fin de manche : ${lr?.win === "cops" ? "les flics gagnent" : "les runners gagnent"}`);
  const winners = lr.order.filter((id) => (lr.win === "cops") === (lr.role[id] === "cop"));
  check(winners.every((id) => lr.gains[id] >= 2), "L'équipe gagnante marque au moins 2 points");
  check(lr.order.every((id) => lr.gains[id] === lr.arrests[id] * 2 + lr.frees[id] * 3 + (lr.role[id] === "runner" && !lr.jailed[id] ? 3 : 0) + (winners.includes(id) ? 2 : 0)), "Les points suivent les règles");
  await act("next");
  await wait(300);
  check(game.phase === "countdown" && game.round === 2 && game.heroes.find((h) => h.role === "cop").id !== round1Cop, "Manche 2 : nouveau flic, nouveau quartier");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
