// Test automatique : « Lampe torche » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-lampe.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/lampe/manor.js";
import { WAKE_MS, DRAIN, PER_15S, SURVIVE_BONUS, CATCH } from "../games/lampe/server.js";

const K = globalThis.Pieton.K;
const M = globalThis.Manoir;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Manoir —");
{
  let same = true, reach = true;
  for (let s = 1; s <= 40; s++) {
    const n = 2 + (s % 7), m = M.build(s * 7907, n);
    if (JSON.stringify(m.rects) !== JSON.stringify(M.build(s * 7907, n).rects)) same = false;
    for (const r of m.rooms) {
      let ok = false;
      for (let x = r.x + 10; x < r.x + r.w && !ok; x += 20) for (let y = r.y + 10; y < r.y + r.h && !ok; y += 20) if (m.nav.free[M.cellOf(m.nav, x, y)]) ok = true;
      if (!ok) reach = false;
    }
  }
  check(same, "40 manoirs : même seed = même manoir");
  check(reach, "Toutes les pièces sont accessibles");
  const m2 = M.build(5, 2), m8 = M.build(5, 8);
  check(m2.rooms.length < m8.rooms.length, `Plus grand à 8 joueurs (${m2.rooms.length} → ${m8.rooms.length} pièces)`);
  const kinds = new Set(m8.rooms.map((r) => r.kind));
  check(["hall", "bal", "couloir"].every((k) => kinds.has(k)) && m8.rooms.some((r) => r.cave), "Hall, salle de bal, couloir… et une cave");
  check(m8.portals.some((p) => p.kind === "stairs") && m8.portals.some((p) => p.kind === "secret"), `Escaliers et passages secrets (${m8.portals.length})`);
  check(m8.switches.length > 0 && m8.creaks.length > 0 && m8.webs.length > 0 && m8.windows.length > 0 && m8.garden.length > 5, "Lustres, planches qui craquent, toiles, fenêtres, jardin");
  // La lumière : dans le cône oui, derrière soi non, et les murs (et les portes fermées) l'arrêtent.
  const blk = M.blockers(m8, []);
  const r = m8.rooms.find((x) => !x.cave && x.w > 200), cx = r.x + 40, cy = r.y + r.h / 2;
  check(M.inCone(blk, cx, cy, 0, cx + 150, cy) && !M.inCone(blk, cx, cy, Math.PI, cx + 150, cy), "Le cône de la lampe éclaire devant, pas derrière");
  check(!M.inCone(blk, r.x + r.w / 2, r.y + 30, -Math.PI / 2, r.x + r.w / 2, r.y - 60), "Les murs arrêtent la lumière");
  const d0 = m8.doors.find((d) => !d.ext), dc = { x: d0.x + d0.w / 2, y: d0.y + d0.h / 2 };
  const a = d0.vert ? { x: dc.x - 60, y: dc.y } : { x: dc.x, y: dc.y - 60 }, b = d0.vert ? { x: dc.x + 60, y: dc.y } : { x: dc.x, y: dc.y + 60 };
  check(M.los(blk, a.x, a.y, b.x, b.y) && !M.los(M.blockers(m8, [d0]), a.x, a.y, b.x, b.y), "Une porte fermée arrête la lumière et le regard");
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
  const picked = await emit("pickGame", { gameId: "lampe" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Lampe torche » se lance");
  check(game.settings.rounds === 3 && game.settings.duration === 90, "Par défaut : 3 manches de 1 min 30");
  await act("settings", { settings: { duration: 60 } });
  await act("start");
  await wait(200);
  const ghosts0 = game.heroes.filter((h) => h.ghost);
  check(game.phase === "countdown" && game.heroes.length === 4 && ghosts0.length === 1, "4 joueurs : 1 fantôme, 3 humains");
  check(game.heroes.filter((h) => !h.ghost).every((h) => h.lamp && h.bat === 1), "Les humains commencent lampe allumée, batterie pleine");
  check(game.doors.length > 10 && game.doors.includes("0") && game.doors.includes("1"), "Portes du manoir ouvertes, portes du jardin fermées");
  check(game.piles.length >= 5, `${game.piles.length} piles dans le manoir`);
  const m = M.build(game.manor.seed, game.manor.n);
  check(game.heroes.every((h) => m.nav.free[M.cellOf(m.nav, h.x, h.y)]), "Tout le monde démarre dans une pièce (pas dans un mur ni un meuble)");

  await waitFor(() => game.phase === "play", 5000);
  await wait(300);
  const g0 = game.heroes.find((h) => h.ghost);
  check(g0.frozen && game.wakeIn > 0 && game.wakeIn <= WAKE_MS, "Le fantôme dort les 3 premières secondes");
  const iAmGhost = game.heroes.find((h) => h.id === me).ghost;
  let seq = 1;
  const send = (k, a = 0) => socket.emit("gameAction", { type: "in", data: { s: ++seq, k, a } });
  if (!iAmGhost) {
    const b0 = game.heroes.find((h) => h.id === me).bat;
    for (let i = 0; i < 30; i++) { send(0); await wait(33); }
    const b1 = game.heroes.find((h) => h.id === me).bat;
    check(b1 < b0 && b0 - b1 < DRAIN * 2.5, `Lampe allumée : la batterie baisse (${b0} → ${b1})`);
    send(K.FIRE); await wait(60); send(0); await wait(100);
    check(!game.heroes.find((h) => h.id === me).lamp, "Clic = lampe éteinte");
    const b2 = game.heroes.find((h) => h.id === me).bat;
    for (let i = 0; i < 20; i++) { send(0); await wait(33); }
    check(game.heroes.find((h) => h.id === me).bat === b2, "Lampe éteinte : la batterie ne bouge plus");
  } else console.log("     (je suis le fantôme : pas de test de lampe)");

  // On laisse la manche se finir (je ne bouge plus : on verra si on m'attrape).
  let sawSeen = false, sawConvert = false;
  await waitFor(() => {
    if (game.heroes?.some((h) => h.ghost && h.seen)) sawSeen = true;
    if ((game.heroes?.filter((h) => h.ghost).length || 0) > 1) sawConvert = true;
    if (game.phase === "play") send(0);
    return game.phase === "roundOver";
  }, 90000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr, "Fin de manche");
  console.log(`     (attrapés : ${Object.entries(lr.caught).map(([, ms]) => Math.round(ms / 1000) + " s").join(", ") || "aucun"} · survivants : ${lr.survivors.length})`);
  check(sawConvert || lr.survivors.length === 3, "Contagion : un humain touché devient fantôme");
  if (!iAmGhost) check(sawSeen, "Un fantôme a été vu dans la lumière d'une lampe");
  // Points.
  const pts = (ms) => Math.floor(Math.min(ms, 60000) / 15000) * PER_15S;
  const ok = Object.keys(lr.gains).every((id) => {
    let n = (lr.catches[id] || 0) * CATCH;
    if (id !== lr.startGhost) n += lr.survivors.includes(id) ? pts(60000) + SURVIVE_BONUS : pts(lr.caught[id]);
    return n === lr.gains[id];
  });
  check(ok, "Points de la manche justes");

  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2 && game.startGhost !== lr.startGhost, "Manche 2 : un autre fantôme de départ");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 150000);
