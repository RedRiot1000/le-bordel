// Test automatique : « Ricochet » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-ricochet.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/ricochet/arena.js";
import { createGame, SHIELD, shrinkAt, SUDDEN_AT } from "../games/ricochet/server.js";

const A = globalThis.Ricochet, H = globalThis.Pieton, K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Arène et balles —");
{
  const a = A.build(42), b = A.build(42);
  check(JSON.stringify(a.walls) === JSON.stringify(b.walls), "Même seed = même arène");
  const sym = a.walls.every((w) => a.walls.some((o) => Math.abs(o.x1 - (A.W - w.x1)) < 0.01 && Math.abs(o.y1 - (A.H - w.y1)) < 0.01));
  check(sym, "L'arène est symétrique (personne n'est avantagé)");
  let out = 0, kinds = new Set();
  for (let s = 0; s < 200; s++) {
    const ar = A.build(s * 7919);
    for (const w of ar.walls) kinds.add(w.kind);
    const bl = { x: 640, y: 400, vx: 700, vy: 260, left: 3, age: 0 };
    for (let i = 0; i < 300 && !A.moveBullet(bl, ar, 1 / 30); i++);
    if (bl.x < 0 || bl.x > A.W || bl.y < 0 || bl.y > A.H) out++;
    for (const p of [...ar.spawnsFFA, ...ar.spawnsTeam[1], ...ar.spawnsTeam[2]]) if (ar.walls.some((w) => { const q = A.closest(w, p.x, p.y); return Math.hypot(q.x - p.x, q.y - p.y) < 40 + w.t / 2; })) out++;
  }
  check(out === 0, "200 arènes : aucune balle ne sort, aucun départ dans un mur");
  check(["pilier", "mur", "biais"].every((k) => kinds.has(k)), "Piliers, murs droits et murs en biais");
  // Une balle rebondit 3 fois puis disparaît.
  const flat = { walls: [] }, bl = { x: 100, y: 400, vx: A.BULLET_V, vy: 0, left: 3, age: 0 };
  let end = null, n = 0;
  for (let i = 0; i < 400 && !end; i++) { const before = bl.left; end = A.moveBullet(bl, flat, 1 / 30); if (bl.left < before) n++; }
  check(end === "fin" && n === 3, `Une balle rebondit 3 fois puis disparaît (${n} rebonds)`);
  // Le rebond sur un mur en biais renvoie la balle sur le côté.
  const diag = { walls: [{ x1: 500, y1: 300, x2: 700, y2: 500, t: 16 }] }, b2 = { x: 300, y: 400, vx: A.BULLET_V, vy: 0, left: 3, age: 0 };
  for (let i = 0; i < 20; i++) A.moveBullet(b2, diag, 1 / 30);
  check(Math.abs(b2.vy) > 600 && Math.abs(b2.vx) < 100, "Sur un mur en biais, la balle part sur le côté");
  {
    let seen = 0, pairs = 0;
    for (let s = 0; s < 40; s++) {
      const ar = A.build(s * 104729), sp = A.spawns(ar, 8);
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) { pairs++; if (!A.blocked(ar, sp[i], sp[j])) seen++; }
    }
    check(seen / pairs < 0.5, `À 8 joueurs, la plupart des départs sont cachés les uns des autres (${Math.round(100 * seen / pairs)} % se voient)`);
  }
  check(shrinkAt(SUDDEN_AT - 1) === 0 && shrinkAt(SUDDEN_AT + 20000) > 0.3, "Après 30 s, l'arène rétrécit");
}

console.log("— Règles —");
{
  const list = ["a", "b"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, savedSettings: { rounds: 5, mode: "solo" }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  g.phase = "play"; g.playAt = Date.now() - 3000; g.arena = { ...g.arena, walls: [] };
  const [A1, B1] = [g.heroes.a, g.heroes.b];
  A1.h.x = 300; A1.h.y = 400; B1.h.x = 700; B1.h.y = 400;
  const send = (id, k, a) => { g.heroes[id].budget = 6; game.onAction(id, "in", { s: g.heroes[id].seq + 1, k, a }); };
  send("a", K.FIRE, 0);
  check(g.bullets.length === 1, "Clic gauche : la balle part");
  send("a", 0, 0); send("a", K.FIRE, 0);
  check(g.bullets.length === 1, "Une seule balle à la fois");
  // Bouclier de B : la balle repart vers A… et le touche.
  send("b", SHIELD, Math.PI);
  let back = false;
  for (let k = 0; k < 40 && g.bullets.length; k++) { g.__step(1 / 30); if (g.bullets[0]?.by === "b" && g.bullets[0].vx < 0) back = true; }
  check(back, "Clic droit : le bouclier renvoie la balle là où on vise");
  check(!A1.alive && B1.alive, "La balle renvoyée touche le tireur : une touche = mort");
  check(g.heroes.b.elims === 1, "L'élimination compte pour celui qui a renvoyé");
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
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "ricochet" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Ricochet » se lance");
  await act("settings", { settings: { rounds: 5, mode: "auto" } });
  await act("start");
  await wait(300);
  check(game.phase === "countdown" && game.heroes.length === 4 && !game.teamsMode, "Manche 1 : chacun pour soi, 4 tireurs");
  await waitFor(() => game.phase === "play", 5000);
  // Je bouge en calculant de mon côté : le serveur doit trouver pareil.
  const ar = A.build(game.seed);
  const m0 = game.heroes.find((h) => h.id === me);
  const pred = H.copy(m0);
  let seq = 0, steps = 0;
  const keys = [K.UP, K.LEFT, K.DOWN, K.RIGHT];
  for (let i = 0; i < 60; i++) {
    const cur = game.heroes.find((h) => h.id === me);
    if (!cur.alive) break;
    const k = keys[Math.floor(i / 15)];
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k, a: 0 } });
    H.simulate(pred, k, 0, { walls: true, w: A.W, h: A.H, noDash: true, speedMul: 1.1, segs: ar.walls }, []);
    steps++;
    await wait(33);
  }
  await wait(250);
  const m1 = game.heroes.find((h) => h.id === me);
  const gap = Math.hypot(m1.x - pred.x, m1.y - pred.y);
  check(!m1.alive || gap < 40, `Le serveur calcule la même chose que moi (écart ${Math.round(gap)} px sur ${steps} pas)`);
  await waitFor(() => game.phase === "roundOver", 70000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de manche");
  check(Object.values(lr.gains).reduce((a, b) => a + b, 0) >= 6, "Points : 1 par joueur éliminé avant soi (+ éliminations)");
  await act("next");
  await wait(300);
  check(game.phase === "countdown" && game.round === 2 && game.teamsMode, "Manche 2 : en équipes (mode Alterné)");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 150000);
