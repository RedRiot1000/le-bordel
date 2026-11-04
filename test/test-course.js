// Test automatique : « Grand Prix » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-course.js
import { io } from "socket.io-client";
import "../public/games/patate/physics.js";
import "../public/games/course/track.js";

const P = globalThis.PatatePhysics;
const T = globalThis.CourseTrack;
const K = P.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Circuit —");
{
  const a = T.build(777), b = T.build(777);
  check(JSON.stringify(a.pts) === JSON.stringify(b.pts) && JSON.stringify(a.obstacles) === JSON.stringify(b.obstacles), "Même seed = même circuit (et mêmes obstacles)");
  let okAll = true, minTurn = Infinity, sep = Infinity, bad = "";
  for (let s = 1; s <= 40; s++) {
    const t = T.build(s * 99991);
    for (const c of t.curv) minTurn = Math.min(minTurn, 1 / Math.max(Math.abs(c), 1e-9));
    // La piste ne se touche jamais elle-même.
    for (let i = 0; i < t.N; i += 3) for (let j = i + 3; j < t.N; j += 3) {
      const along = Math.min(j - i, t.N - (j - i)) * T.STEP;
      if (along < T.WIDTH * 2.6) continue;
      sep = Math.min(sep, Math.hypot(t.pts[i].x - t.pts[j].x, t.pts[i].y - t.pts[j].y));
    }
    // La grille de départ est sur la piste, les pneus dehors.
    for (const g of T.startGrid(t, 8)) { const l = T.locate(t, g.x, g.y); if (!l || l.dist > T.WIDTH / 2 - 15) { okAll = false; bad = "grille"; } }
    for (const o of t.obstacles) {
      const l = T.locate(t, o.x + o.w / 2, o.y + o.h / 2);
      if (o.kind === "pneus" && l && l.dist < T.WIDTH / 2 + 20) { okAll = false; bad = "pneus sur la piste"; }
      if (o.kind === "paille" && (!l || l.dist > T.WIDTH / 2)) { okAll = false; bad = "paille hors piste"; }
    }
    if (Math.abs(t.len - T.LEN) > 200) { okAll = false; bad = "longueur"; }
  }
  check(okAll, `40 circuits : grille sur la piste, pneus dehors, paille sur la piste, ~${T.LEN / 10} m le tour ${bad}`);
  { let fails = 0; for (let k = 0; k < 300; k++) { try { T.build((k * 2654435761) >>> 0); } catch { fails++; } } check(fails === 0, `300 circuits générés sans échec (${fails})`); }
  check(T.LANES === 3 && T.WIDTH >= 220, `Piste à 3 voies (${T.WIDTH} px)`);
  check(minTurn >= 140, `Aucun virage impossible (rayon mini ${Math.round(minTurn)} px)`);
  check(sep >= T.WIDTH * 1.6, `La piste ne se touche jamais (écart mini ${Math.round(sep)} px)`);
  const t = T.build(5);
  check(T.offAt(t, t.pts[30].x, t.pts[30].y) === 0 && T.offAt(t, t.pts[30].x + T.normal(t, 30).x * 200, t.pts[30].y + T.normal(t, 30).y * 200) > 0.9, "Sur la piste / dans l'herbe");
  // L'herbe ralentit : même voiture, plein gaz 3 s, sur la piste vs dans l'herbe.
  const env = T.env(t);
  const speedAfter = (x, y, a) => { const c = P.newCar(x, y, a, "eclair"); for (let i = 0; i < 90; i++) { env.obstacles = []; for (let k = 0; k < 3; k++) P.drive(c, K.UP, P.TICK / 3, { ...env, offAt: () => (x === -1 ? 1 : 0) }, 1); } return Math.hypot(c.vx, c.vy); };
  check(speedAfter(-1, 0, 0) < speedAfter(0, 0, 0) * 0.7, "L'herbe ralentit beaucoup");
  // Nitro : se recharge plus en dérapant, et × regen.
  const c1 = P.newCar(0, 0, 0, "vipere"); c1.nitro = 0; c1.vx = 300; c1.slide = true;
  const c2 = P.newCar(0, 0, 0, "vipere"); c2.nitro = 0; c2.vx = 300;
  const flat = { ...env, offAt: () => 0, obstacles: [] };
  P.drive(c1, 0, 0.1, flat); P.drive(c2, 0, 0.1, flat);
  check(c1.nitro > c2.nitro * 2, "Nitro : le dérapage recharge bien plus vite");
  const c3 = P.newCar(0, 0, 0, "vipere"); c3.nitro = 0; c3.regen = 2; P.drive(c3, 0, 0.1, flat);
  check(Math.abs(c3.nitro - c2.nitro * 2) < 1e-9, "Nitro : le dernier recharge 2 × plus vite");
  // Barrières : on fonce tout droit avec nitro (et en tournant) → on ne sort jamais du circuit.
  {
    let worst = 0;
    for (let s = 1; s <= 12; s++) {
      const tr = T.build(s * 31337), e = T.env(tr);
      for (const startAt of [0, 2500, 5000, 7500]) {
        const p = T.at(tr, startAt);
        for (const keys of [K.UP | K.NITRO, K.UP | K.LEFT, K.UP | K.RIGHT | K.HB]) {
          const car = P.newCar(p.x, p.y, p.a, "titan");
          for (let i = 0; i < 150; i++) for (let k = 0; k < P.SUB; k++) { e.obstacles = T.nearObs(tr, car.x, car.y); P.drive(car, keys, P.TICK / P.SUB, e, 1); P.collideStatic(car, e); }
          const l = T.locate(tr, car.x, car.y);
          worst = Math.max(worst, l ? l.dist : 9999);
        }
      }
    }
    check(worst < T.WIDTH / 2 + T.RAIL, `Barrières : impossible de sortir du circuit (au plus loin ${Math.round(worst)} px du milieu)`);
  }
  check(P.RACE_TYPES.length === 3 && P.RACE_TYPES.every((x) => P.VEHICLES[x].special), "3 supersportives réservées à la course");
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
  const { playerId: me } = await emit("createRoom", { pseudo: "Pilote" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "course" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Grand Prix » se lance");
  await act("settings", { settings: { mode: "course", laps: 2, rounds: 3 } });
  await wait(150);
  await act("start");
  await wait(300);
  check(game.phase === "pick" && game.cars.length === 4 && game.mode === "course", "Choix des voitures (4 pilotes, mode course)");
  const r = await act("car", { type: "titan" });
  await wait(150);
  check(r.ok && game.picks[me] === "titan", "Je prends la TITAN");
  check(!(await act("car", { type: "camion" })).ok || game.picks[me] === "titan", "Voiture inconnue refusée");
  await waitFor(() => game.phase === "countdown", 12000);
  const t = T.build(game.seed);
  const mine0 = game.cars.find((c) => c.id === me);
  const l0 = T.locate(t, mine0.x, mine0.y);
  check(game.phase === "countdown" && mine0.type === "titan" && l0 && l0.dist < T.WIDTH / 2, "Sur la grille de départ, en TITAN");
  await waitFor(() => game.phase === "play", 6000);
  // Je conduis : je suis le milieu de la piste.
  let seq = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const c = game.cars.find((x) => x.id === me);
    const p = T.at(t, c.prog + 90 + Math.hypot(c.vx, c.vy) * 0.4);
    const diff = angDiff(Math.atan2(p.y - c.y, p.x - c.x), c.a);
    let k = K.UP;
    if (diff > 0.08) k |= K.RIGHT; else if (diff < -0.08) k |= K.LEFT;
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k } });
    await wait(33);
  }
  const mine = game.cars.find((c) => c.id === me);
  check(mine.prog > 800, `Ma voiture avance sur la piste (${Math.round(mine.prog / 10)} m)`);
  check(game.order.length === 4 && game.order.includes(me), `Classement en direct (je suis ${game.order.indexOf(me) + 1}e)`);
  const regens = game.order.map((id) => game.cars.find((c) => c.id === id).regen);
  check(regens[0] === 1 && regens[3] === 2, `Nitro de rattrapage : 1er ×${regens[0]}, dernier ×${regens[3]}`);
  // On laisse finir (les bots finissent, puis 20 s).
  await waitFor(() => game.phase === "roundOver", 150000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de course");
  const fin = lr.order.filter((id) => lr.times[id] != null);
  check(fin.length >= 1 && fin.every((id, i) => i === 0 || lr.times[id] >= lr.times[fin[i - 1]]), `Ordre d'arrivée (${fin.map((id) => (lr.times[id] / 1000).toFixed(1) + " s").join(" · ")})`);
  check(lr.gains[lr.order[0]] === 10 && lr.gains[lr.order[1]] === 7, "Points 10, 7…");
  // Manche 2 en élimination.
  await act("next");
  await wait(300);
  check(game.phase === "pick" && game.round === 2, "Manche 2 : nouveau circuit");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 240000);
