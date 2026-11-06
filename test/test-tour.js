// Test automatique : « La Tour » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-tour.js
import { io } from "socket.io-client";
import "../public/games/tour/tower.js";

const P = globalThis.Tower;
const K = P.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}
const run = (r, c, k, n) => { let res = null; for (let i = 0; i < n && !res; i++) res = P.step(r, typeof k === "function" ? k(i) : k, c); return res; };
// Une petite tour faite à la main.
const box = (over) => {
  const c = P.tower(1);
  c.ensure = () => {}; c.plats.length = 0; c.solids.length = 0; c.spikes.length = 0; c.bk.clear(); c.crumbles = {};
  const add = (o) => { o.id = c.plats.length; o.h = 18; c.plats.push(o); c.slot(Math.floor(o.y / 200)).p.push(o); return o; };
  add({ x: 0, y: 0, w: P.W, kind: "fix" });
  over?.(c, add);
  return c;
};

console.log("— Tour et perso —");
{
  const a = P.tower(1234), b = P.tower(1234);
  a.ensure(9000); b.ensure(9000);
  check(JSON.stringify(a.plats) === JSON.stringify(b.plats) && JSON.stringify(a.spikes) === JSON.stringify(b.spikes) && JSON.stringify(a.solids) === JSON.stringify(b.solids), "Même seed = même labyrinthe");
  check(a.secs.every((q) => q.routes.length >= 2 && q.routes.length <= 3), "À chaque étage : 2 ou 3 routes");
  {
    const shape = (c, q, i) => { const r0 = c.rows.slice(0); const start = q.y0 / P.TILE, end = (q.y0 + q.h) / P.TILE; return r0.slice(start, end).map((r) => r.join("")).join("|"); };
    const c = P.tower(4242); c.ensure(60000);
    const shapes = new Set(c.secs.map((q, i) => shape(c, q, i)));
    check(shapes.size === c.secs.length, `Tous les étages sont différents (${shapes.size}/${c.secs.length})`);
    check(new Set(c.secs.map((q) => q.h)).size >= 4, "Des étages de hauteurs différentes");
    const turns = new Set(c.secs.flatMap((q) => q.routes.filter((r) => r.kind === "zigzag").map((r) => r.way.length)));
    check(turns.size >= 2, `Des zigzags plus ou moins longs (${[...turns].join(", ")} étapes)`);
    check(c.spikes.every((k) => k.h <= 22), "Les piques sont seuls (jamais une rangée)");
  }
  const walls = a.rows.reduce((n, r) => n + r.reduce((x, y) => x + y, 0), 0) / (a.rows.length * P.COLS);
  check(walls > 0.25, `Des murs partout (${Math.round(walls * 100)} % de la tour)`);
  check(a.solids.some((q) => q.low) && a.plats.some((p) => p.kind === "crumble") && a.spikes.some((k) => k.faces), "Plafonds bas, rebords qui s'effritent, piques sur les murs");
  check(a.plats.length - 1 <= a.secs.length * 3 + 1, `Très peu de rebords : ${a.plats.length - 1} pour ${a.secs.length} étages (un par route)`);
  check(a.solids.filter((q) => q.low).length >= a.secs.length * 3, `Beaucoup de passages accroupis (${a.solids.filter((q) => q.low).length} pour ${a.secs.length} étages)`);
  // Un bot termine tous les zigzags (sans lave).
  {
    const lava = P.lavaAt; P.lavaAt = () => -1e9;
    let ok = 0, all = 0;
    for (const seed of [11, 22, 33]) {
      const c = P.tower(seed); c.ensure(9000);
      for (let n = 0; n < 6; n++) for (const route of c.secs[n].routes.filter((q) => q.kind === "zigzag")) {
        all++;
        for (let t = 0; t < 6; t++) {
          c.crumbles = {};
          const r = P.newRunner(route.way[0].x); r.y = c.secs[n].y0; r.on = n ? -1 : 0;
          const ai = P.newBot(0, 0.1); ai.route = route; ai.forced = true; ai.sec = n;
          let res = null, done = false;
          for (let i = 0; i < 750 && !done; i++) { res = P.step(r, P.bot(r, ai, c), c); done = r.y >= c.secs[n].y0 + c.secs[n].h - 1; }
          if (done) { ok++; break; }
        }
      }
    }
    P.lavaAt = lava;
    check(ok >= all * 0.85, `Un bot termine presque tous les zigzags (${ok}/${all} ; la recherche exhaustive les valide tous)`);
  }
  // Sauter, plus haut en maintenant.
  const c0 = box();
  const tap = P.newRunner(300), held = P.newRunner(300);
  let mt = 0, mh = 0;
  for (let i = 0; i < 30; i++) { P.step(tap, i === 0 ? K.JUMP : 0, c0); P.step(held, K.JUMP, c0); mt = Math.max(mt, tap.y); mh = Math.max(mh, held.y); }
  check(mt > 100 && mh > mt + 25, `Sauter : ${Math.round(mt)} px, maintenu ${Math.round(mh)} px`);
  // Courir.
  const r1 = P.newRunner(300); run(r1, c0, K.RIGHT, 30);
  check(r1.x > 540 && r1.y === 0, `Courir : ${Math.round(r1.x - 300)} px en 1 s`);
  // Plateforme traversable par en dessous, on atterrit dessus.
  const c1 = box((c, add) => add({ x: 200, y: 120, w: 200, kind: "fix" }));
  const r2 = P.newRunner(300); run(r2, c1, (i) => (i < 8 ? K.JUMP : 0), 40);
  check(r2.y === 120 && !r2.air, "On passe à travers par en dessous et on atterrit dessus");
  // Plateforme qui s'effrite.
  const c2 = box((c, add) => add({ x: 200, y: 120, w: 200, kind: "crumble" }));
  const r3 = P.newRunner(300); run(r3, c2, (i) => (i < 8 ? K.JUMP : 0), 90);
  check(r3.y === 0, "Elle s'effrite : on retombe");
  // Saut mural : grimper entre deux murs (cheminée) ; pas deux fois sur le même mur.
  const c3 = box((c) => { const s = { x: 150, y: 0, w: 30, h: 3000 }; c.solids.push(s); for (let b = -1; b < 17; b++) c.slot(b).s.push(s); });
  const r4 = P.newRunner(70);
  let mem = 0;
  for (let i = 0; i < 180; i++) {
    let k = 0;
    if (i === 0) k = K.JUMP;
    else if (r4.wall && r4.lock === 0 && !(r4.pk & K.JUMP) && r4.wall !== r4.lastW) k = K.JUMP;
    k |= r4.lock > 0 ? 0 : r4.vx >= 0 && r4.x > 75 ? K.RIGHT : K.LEFT;
    P.step(r4, k, c3); mem = Math.max(mem, r4.y);
  }
  check(mem > 700, `Saut mural : on grimpe la cheminée (${Math.round(mem)} px en 6 s)`);
  const r5 = P.newRunner(20); r5.y = 300; r5.air = true; r5.wall = -1; r5.lastW = -1; r5.pk = 0;
  const c4 = box();
  P.step(r5, K.JUMP | K.LEFT, c4);
  check(r5.vy < 100, "Pas deux sauts muraux de suite sur le même mur");
  // S'accroupir sous un plafond bas.
  const low = (c) => { const s = { x: 400, y: 34, w: 110, h: 44 }; c.solids.push(s); for (let b = -1; b < 2; b++) c.slot(b).s.push(s); };
  const c5 = box(low);
  const stand = P.newRunner(300), duck = P.newRunner(300);
  run(stand, c5, K.RIGHT, 40); run(duck, c5, K.RIGHT | K.DOWN, 90);
  check(stand.x < 400 && duck.x > 510, "Plafond bas : debout on bute, accroupi on passe");
  // Piques.
  const c6 = box((c) => { const s = { x: 400, y: 0, w: 60, h: 16 }; c.spikes.push(s); for (let b = -1; b < 2; b++) c.slot(b).k.push(s); });
  {
    const r6 = P.newRunner(300);
    check(run(r6, c6, K.RIGHT, 60) === "pique" && r6.alive && r6.stun === P.STUN, "Toucher un pique : sonné, pas éliminé");
    const x = r6.x; let moved = 0;
    for (let i = 0; i < 58; i++) { P.step(r6, K.LEFT | K.JUMP, c6); moved = Math.max(moved, Math.abs(r6.x - x), r6.y); }
    check(moved < 1 && r6.stun > 0, "Sonné : plus aucune commande pendant 2 s");
    for (let i = 0; i < 12; i++) P.step(r6, K.LEFT, c6);
    check(r6.stun === 0 && r6.x < x - 10, "Après 2 s, on repart");
  }
  // Lave.
  const r7 = P.newRunner(300);
  check(run(r7, c0, 0, 900) === "lave", `Sans bouger, la lave t'attrape (à ${Math.round(r7.t)} s)`);
  check(P.lavaAt(60) - P.lavaAt(50) > (P.lavaAt(20) - P.lavaAt(10)) * 2, "La lave accélère");
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

async function main() {
  console.log("— Partie —");
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Grimpeur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "tour" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« La Tour » se lance");
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.runners.length === 4 && game.runners.every((r) => r.y === 0 && r.alive), "4 grimpeurs au sol");
  await waitFor(() => game.phase === "play", 5000);
  // Prédiction : je saute en rythme en courant, le serveur doit calculer pareil.
  const tower = P.tower(game.seed);
  const mine = P.newRunner(game.runners.find((r) => r.id === me).x);
  let seq = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    const k = K.RIGHT | (seq % 20 < 6 ? K.JUMP : 0);
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k } });
    Object.assign(tower.crumbles, game.crumbles);
    P.step(mine, k, tower);
    await wait(33);
  }
  await wait(300);
  const srv = game.runners.find((r) => r.id === me);
  check(srv.t > 2 && Math.hypot(srv.x - mine.x, srv.y - mine.y) < 40, `Le serveur calcule la même chose que moi (écart ${Math.round(Math.hypot(srv.x - mine.x, srv.y - mine.y))} px)`);
  check(game.runners.some((r) => r.id !== me && r.best > 100), "Les bots grimpent");
  await waitFor(() => game.phase === "roundOver", 120000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de manche");
  const standing = Object.values(lr.cause).filter((c) => !c).length;
  check(standing <= 1, `Au plus 1 survivant à la fin (${standing})`);
  check(lr.gains[lr.order[0]] === 10 && lr.gains[lr.order[1]] === 7, "Points 10, 7…");
  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2, "Manche 2 (nouvelle tour)");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 180000);
