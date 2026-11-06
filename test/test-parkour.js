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
  check(a.obs.length > 15 && a.gaps.length > 3, `Des obstacles et des trous (${a.obs.length} obstacles, ${a.gaps.length} trous sur 2 km)`);
  {
    const c = P.course(7); c.ensure(60000);
    const kinds = new Set(c.obs.map((o) => o.kind));
    check(["haie", "barre", "caisse", "pique", "laser", "scie", "rapide", "lent", "tremplin"].every((k) => kinds.has(k)), `Tous les pièges (${[...kinds].join(", ")})`);
    check(c.plats.some((p) => p.y === P.Y1) && c.plats.some((p) => p.y === P.Y2), "3 étages : sol, toits, passerelles");
    check(c.plats.some((p) => p.cr), "Des dalles qui s'effondrent");
    const roofs = c.plats.filter((p) => p.y === P.Y1).length;
    check(roofs >= 8, `Souvent un étage au-dessus (${roofs} toits sur 6 km)`);
  }
  // Sans rien faire : on prend des chocs, et le mur finit par nous rattraper.
  const c = P.course(99), r = P.newRunner();
  let res = null, chocs = 0;
  for (let i = 0; i < 12000 && res !== "mur"; i++) { res = P.step(r, 0, c); if (res === "choc" || res === "trou") chocs++; }
  check(res === "mur" && !r.alive && chocs >= 1, `Sans rien faire : ${chocs} chocs, puis le mur (à ${Math.floor(r.d / 10)} m)`);
  // Sauter puis glisser : la hauteur change.
  const r2 = P.newRunner(), c2 = P.flat();
  P.step(r2, K.JUMP, c2); for (let i = 0; i < 4; i++) P.step(r2, K.JUMP, c2);
  check(r2.y > 40, `Sauter : on monte (${Math.round(r2.y)} px)`);
  const r3 = P.newRunner();
  P.step(r3, K.DOWN, c2);
  check(r3.crouch && P.height(r3) === P.H_LOW, "Glisser : on est plus bas");
  // Une barre : debout = choc, en glissade = ça passe.
  const cb = P.flat([{ x: 300, kind: "barre" }]);
  const stand = P.newRunner(), slide = P.newRunner();
  let rs = null, rl = null;
  for (let i = 0; i < 40; i++) { rs = rs || P.step(stand, 0, cb); rl = rl || P.step(slide, K.DOWN, cb); }
  check(rs === "choc" && stand.alive && stand.slow > 0 && !rl, "Sous une barre : debout = choc (ralenti, pas éliminé), en glissade = ça passe");
  // Un choc ralentit et fait perdre du terrain.
  {
    const free = P.newRunner(), hit = P.newRunner(), cf = P.flat(), ch = P.flat([{ x: 300, kind: "haie" }]);
    for (let i = 0; i < 90; i++) { P.step(free, 0, cf); P.step(hit, 0, ch); }
    check(free.d - hit.d > 150, `Un choc fait perdre ${Math.round((free.d - hit.d) / 10)} m`);
  }
  // Atterrissage : sauter puis plonger à fond sur sol plat, jamais de chute.
  {
    const flat = P.flat(), rr = P.newRunner();
    let bad = null;
    for (let i = 0; i < 1500 && !bad; i++) { const ph = i % 24; bad = P.step(rr, ph < 6 ? K.JUMP : ph < 14 ? 0 : K.DOWN, flat); }
    check(bad === null || bad === "mur", "Sauter + plonger sur sol plat : on ne tombe jamais à l'atterrissage");
  }
  // Un trou : on perd du temps mais on repart.
  {
    const ch = P.flat([], [{ x: 300, w: 200 }]), rr = P.newRunner();
    let res = null;
    for (let i = 0; i < 200 && !res; i++) res = P.step(rr, 0, ch);
    check(res === "trou" && rr.alive && rr.stall > 0 && rr.d > 500, "Un trou : on tombe, on perd du temps, on repart après");
  }
  // Monter sur un toit : un saut maintenu y arrive, un saut court non.
  {
    const roof = P.flat([], [], [{ x: 60, w: 2000, y: P.Y1 }]);
    const high = P.newRunner(), low = P.newRunner();
    for (let i = 0; i < 50; i++) { P.step(high, i < 12 ? K.JUMP : 0, roof); P.step(low, i < 1 ? K.JUMP : 0, roof); }
    check(high.y === P.Y1 && !high.air, "Un saut maintenu monte sur le toit");
    check(low.y === 0, "Un saut court n'y arrive pas");
  }
  // Le tremplin envoie à l'étage du dessus.
  {
    const cc = P.flat([{ x: 200, kind: "tremplin", b: 0 }], [], [{ x: 280, w: 2000, y: P.Y1 }]), rr = P.newRunner();
    for (let i = 0; i < 40; i++) P.step(rr, 0, cc);
    check(rr.y === P.Y1, "Le tremplin envoie sur l'étage du dessus");
  }
  // Une dalle qui s'effondre : on ne peut pas y rester.
  {
    const cc = P.flat([], [{ x: 200, w: 900 }], [{ x: 200, w: 900, y: 0, cr: true }]), rr = P.newRunner();
    let res = null;
    for (let i = 0; i < 80 && !res; i++) res = P.step(rr, 0, cc);
    check(res === "trou", "Sur une dalle : si on reste, on tombe");
  }
  // Tapis.
  {
    const a1 = P.newRunner(), a2 = P.newRunner(), a3 = P.newRunner(), cf = P.flat(), cg = P.flat([{ x: 100, kind: "rapide", b: 0 }]), cl = P.flat([{ x: 100, kind: "lent", b: 0, w: 2000 }]);
    for (let i = 0; i < 60; i++) { P.step(a1, 0, cf); P.step(a2, 0, cg); P.step(a3, 0, cl); }
    check(a2.d > a1.d + 50 && a3.d < a1.d - 50, "Le tapis vert accélère, le tapis marron ralentit");
  }
  // Pièges en rythme : allumés, puis éteints.
  {
    const pique = { kind: "pique", b: 0, ph: 0 }, laser = { kind: "laser", b: 0, ph: 0 };
    check(P.zone(pique, 0.1) && !P.zone(pique, 1.2), "Les piques sortent et rentrent");
    check(P.zone(laser, 0.1)[0] === 0 && P.zone(laser, 1.3)[0] === 40, "Le laser passe de bas (sauter) à haut (glisser)");
  }
  // Le mur.
  check(P.wallAt(0) < 0 && P.wallAt(100) > P.wallAt(50), "Le mur part derrière et avance");
  check(P.wallAt(200) > P.distAt(200), "Le mur finit par rattraper même une course parfaite");
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
  check(game.phase === "countdown" && game.runners.length === 4 && game.runners.every((r) => r.d === 0 && r.alive), "4 coureurs, tout le monde au départ");
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
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de manche");
  const standing = Object.values(lr.cause).filter((c) => !c).length;
  check(standing <= 1, `Fin de manche avec au plus 1 coureur debout (${standing})`);
  check(!lr.cause[lr.order[0]] || standing === 0, "Le dernier debout est 1er");
  check(Object.values(lr.cause).every((c) => !c || c === "mur" || c === "parti"), "On n'est éliminé que par le mur");
  check(lr.gains[lr.order[0]] === 10 && lr.gains[lr.order[1]] === 7, "Points 10, 7…");
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
