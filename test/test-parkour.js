// Test automatique : « Parkour » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-parkour.js
import { io } from "socket.io-client";
import "../public/games/parkour/course.js";

const P = globalThis.Parkour;
const K = P.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Parcours et coureur —");
{
  const a = P.course(1234), b = P.course(1234);
  a.ensure(20000); b.ensure(20000);
  check(JSON.stringify(a.obs) === JSON.stringify(b.obs) && JSON.stringify(a.gaps) === JSON.stringify(b.gaps), "Même seed = même parcours");
  check(a.obs.length > 20 && a.gaps.length > 3, `Des obstacles et des trous (${a.obs.length} obstacles, ${a.gaps.length} trous sur 2 km)`);
  const kinds = new Set(a.obs.map((o) => o.kind));
  check(["haie", "barre", "caisse"].every((k) => kinds.has(k)), "Haies, barres, caisses (et oiseaux)");
  // Sans rien faire : on finit par tomber (obstacle ou trou).
  const c = P.course(99), r = P.newRunner();
  let res = null;
  for (let i = 0; i < 2000 && !res; i++) res = P.step(r, 0, c);
  check(!!res && !r.alive, `Sans rien faire, on est éliminé (${res}, à ${Math.floor(r.d / 10)} m)`);
  // Sauter puis glisser : la hauteur change.
  const r2 = P.newRunner(), c2 = P.course(5);
  P.step(r2, K.JUMP, c2); for (let i = 0; i < 4; i++) P.step(r2, K.JUMP, c2);
  check(r2.y > 40, `Sauter : on monte (${Math.round(r2.y)} px)`);
  const r3 = P.newRunner();
  P.step(r3, K.DOWN, c2);
  check(r3.crouch && P.height(r3) === P.H_LOW, "Glisser : on est plus bas");
  // Une barre : debout = touché, en glissade = ça passe.
  const cb = { obs: [{ x: 300, kind: "barre" }], gaps: [], ensure() {} };
  const stand = P.newRunner(), slide = P.newRunner();
  let rs = null, rl = null;
  for (let i = 0; i < 40; i++) { rs = rs || P.step(stand, 0, cb); rl = rl || P.step(slide, K.DOWN, cb); }
  check(rs === "obstacle" && !rl && slide.alive, "Sous une barre : debout = éliminé, en glissade = ça passe");
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
  const picked = await emit("pickGame", { gameId: "parkour" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Parkour » se lance");
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.lanes.length === 4 && game.runners.every((r) => r.d === 0 && r.alive), "4 lignes, tout le monde au départ");
  await waitFor(() => game.phase === "play", 5000);
  // Je cours en jouant comme un bot simple (je saute quand un obstacle bas arrive, je glisse sous les barres).
  const course = P.course(game.seed);
  let seq = 0;
  const mine = P.newRunner();
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    const r = game.runners.find((x) => x.id === me);
    const near = P.near(course, mine.d, mine.d + 160);
    let k = 0;
    if (near.gaps.length || near.obs.some((o) => !["barre", "oiseau_haut"].includes(o.kind))) k = K.JUMP;
    else if (near.obs.length) k = K.DOWN;
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k } });
    P.step(mine, k, course);
    await wait(33);
    if (!r.alive) break;
  }
  const me1 = game.runners.find((x) => x.id === me);
  check(me1.d > 500, `Mon coureur avance (${Math.floor(me1.d / 10)} m)`);
  check(Math.abs(me1.d - mine.d) < 60, "Le serveur calcule la même course que moi (prédiction exacte)");
  // On laisse finir la manche.
  await waitFor(() => game.phase === "roundOver", 120000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de manche quand tout le monde est tombé");
  const dists = lr.order.map((id) => lr.dist[id]);
  check(dists.every((d, i) => i === 0 || d <= dists[i - 1]), `Classement à la distance (${dists.join(" ≥ ")} m)`);
  check(lr.gains[lr.order[0]] === 10, "Le plus loin prend 10 points");
  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2, "Manche 2 (nouveau parcours)");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 180000);
