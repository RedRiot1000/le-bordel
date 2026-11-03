// Test automatique : « Avis de recherche » (1 humain qui ne bouge pas + 3 bots), manches de 90 s.
// Lance le serveur AVANT (node server.js), puis : node test/test-police.js
import { io } from "socket.io-client";
import "../public/games/patate/physics.js";
import "../public/games/police/city.js";
import { COPS_DELAY, SURVIVE_BONUS, PER_20S, COP_ARREST } from "../games/police/server.js";

const C = globalThis.PoliceCity;
const P = globalThis.PatatePhysics;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Ville —");
{
  let ok = true, sizes = [];
  for (let s = 1; s <= 60; s++) {
    const city = C.build(s * 7919, 2 + (s % 7));
    const again = C.build(s * 7919, 2 + (s % 7));
    if (JSON.stringify(city.obstacles) !== JSON.stringify(again.obstacles)) ok = false;
    // Toutes les rues se rejoignent (on peut aller partout).
    const nav = city.nav;
    const start = nav.free.findIndex((v) => v);
    const d = C.field(nav, [start]);
    let free = 0, reach = 0;
    for (let i = 0; i < d.length; i++) { if (nav.free[i]) free++; if (d[i] >= 0) reach++; }
    if (reach < free * 0.97) ok = false;
    sizes.push(`${city.w}×${city.h}`);
  }
  check(ok, "60 villes : même seed = même ville, et (presque) toutes les rues se rejoignent");
  const c8 = C.build(4242, 8);
  check(c8.exits.length === 2 && c8.station.spots.length === 3 && c8.rivers.length === 2 && c8.rounds.length === 3 && c8.gates.length > 0,
    `Ville complète : 2 rivières, ${c8.rounds.length} ronds-points (au centre de chaque ville), ${c8.gates.length} portiques, commissariat, 2 sorties`);
  const dists = new Set(c8.towns.map((t) => t.d));
  check(dists.size === 3 && c8.towns[1].d === "centre", "3 villes séparées, le centre-ville au milieu : " + c8.towns.map((t) => t.d).join(", "));
  // Le périphérique n'est pas collé aux villes.
  check(c8.towns.every((t) => t.y - (c8.highway.y + c8.highway.lane) >= 150), "Le périphérique passe loin des villes (voies d'accès)");
  // Les trottoirs se montent : tous les trottoirs sont roulables.
  let sw = 0, swOk = 0;
  for (let i = 0; i < c8.grid.length; i++) if (c8.grid[i] === C.KIND.SIDEWALK) { sw++; const x = (i % c8.TW) * C.TILE + 15, y = Math.floor(i / c8.TW) * C.TILE + 15; if (!c8.obstacles.some((o) => x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h)) swOk++; }
  check(sw > 100 && swOk === sw, `Tous les trottoirs sont montables (${sw} tuiles)`);
  // Portique : une F1 passe dessous, un van non.
  const gateEnv = { w: 2000, h: 2000, grip: 1, oils: [], obstacles: [{ x: 600, y: 900, w: 10, h: 200, gate: true }], nitro: false };
  const through = (type) => { const car = P.newCar(400, 1000, 0, type); for (let k = 0; k < 90; k++) P.simulate(car, P.K.UP, gateEnv, 1, []); return car.x > 620; };
  check(through("f1") && through("sport") && through("moto") && !through("minivan") && !through("truck"), "Portique : F1, sportive, moto passent ; van et camion bloqués");
  check(C.build(1, 2).w < C.build(1, 8).w, `La ville grandit avec le nombre de joueurs (${C.build(1, 2).w} → ${C.build(1, 8).w} px de large)`);
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
const inside = (c, o) => c.x > o.x && c.x < o.x + o.w && c.y > o.y && c.y < o.y + o.h;

async function run() {
  console.log("— Partie —");
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "police" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Avis de recherche » se lance");
  check(game.settings.rounds === 3 && game.settings.duration === 120 && game.settings.flee === 30, "Par défaut : 3 manches de 2 min, 30 s pour sortir");
  await act("settings", { settings: { duration: 90, rounds: 2 } });
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.cars.length === 4 && game.cars.every((c) => c.type === "f1" && c.role === "free"), "4 fugitifs en F1");
  check(game.cops.length === 0 && game.stars === 1, "Pas encore de police, ⭐");
  const city = C.build(game.city.seed, game.city.n);
  check(game.cars.every((c) => !city.obstacles.some((o) => inside(c, o))), "Tout le monde démarre dans une rue (pas dans un immeuble)");
  const seed1 = game.city.seed;

  await waitFor(() => game.phase === "play", 5000);
  await wait(COPS_DELAY - 1000);
  check(game.cops.length === 0, "Pas de flic pendant les 5 premières secondes");
  // On surveille la manche : apparitions, étoiles, arrestations.
  const seen = new Set();
  let spawnTooClose = 0, maxCops = 0, sawArrestGauge = false, iWasCop = false, fromBase = 0, sawFlee = null;
  const bases = [...city.station.spots, ...city.exits.map((e) => e.spawn)];
  await waitFor(() => {
    for (const cop of game.cops) {
      if (seen.has(cop.id)) continue;
      seen.add(cop.id);
      const free = game.cars.filter((c) => c.role === "free");
      if (free.length && Math.min(...free.map((f) => Math.hypot(f.x - cop.x, f.y - cop.y))) < 400) spawnTooClose++;
      if (bases.some((b) => Math.hypot(b.x - cop.x, b.y - cop.y) < 120)) fromBase++;
    }
    maxCops = Math.max(maxCops, game.cops.length);
    if (game.cars.some((c) => c.role === "free" && c.arrest > 0)) sawArrestGauge = true;
    if (game.flee && !sawFlee) sawFlee = { stars: game.stars, left: game.fleeLeft };
    const mine = game.cars.find((c) => c.id === me);
    if (mine?.role === "cop" && mine.type === "minivan") iWasCop = true;
    return game.phase === "roundOver";
  }, 140000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && !!lr, "Fin de manche 1");
  console.log(`     (${seen.size} flics apparus, max ${maxCops} en même temps, ⭐${lr.stars}, arrestations à ${lr.arrests.map((a) => Math.round(a.at / 1000) + " s" + (a.id === me ? " (moi)" : "")).join(", ") || "aucune"})`);
  check(seen.size > 0 && spawnTooClose === 0, "Les flics apparaissent, jamais sous le nez d'un fugitif");
  check(fromBase >= seen.size * 0.8, `Ils sortent du commissariat ou des sorties (${fromBase}/${seen.size})`);
  // (la manche peut finir avant ⭐⭐⭐⭐⭐ si tout le monde est arrêté : 1 étoile de plus toutes les 18 s sur 90 s)
  const someLeft = lr.survivors.length + lr.late.length > 0;
  const lastAt = someLeft ? 90000 : Math.max(...lr.arrests.map((x) => x.at));
  console.log(`     (évadés : ${lr.survivors.length}, pas sortis à temps : ${lr.late.length})`);
  if (someLeft) check(sawFlee && sawFlee.stars === 5 && sawFlee.left > 25000, "Fin du chrono : « FUYEZ ! » (⭐⭐⭐⭐⭐, 30 s pour sortir)");
  check(lr.stars === Math.min(5, 1 + Math.floor(lastAt / 18000)), `Le niveau de recherche monte (⭐${lr.stars} au bout de ${Math.round(lastAt / 1000)} s)`);
  check(lr.arrests.some((a) => a.id === me), "Moi, immobile : arrêté");
  check(iWasCop, "Arrêté = je deviens flic (van)");
  check(sawArrestGauge, "La jauge d'arrestation se remplit avant l'arrestation");
  // Points.
  const exp = {};
  for (const a of lr.arrests) { exp[a.id] = (exp[a.id] || 0) + Math.floor(Math.min(a.at, 90000) / 20000) * PER_20S; for (const b of a.by) exp[b] = (exp[b] || 0) + COP_ARREST; }
  for (const id of lr.survivors) exp[id] = (exp[id] || 0) + Math.floor(90000 / 20000) * PER_20S + SURVIVE_BONUS;
  for (const id of lr.late) exp[id] = (exp[id] || 0) + Math.floor(90000 / 20000) * PER_20S;
  check(Object.keys({ ...exp, ...lr.gains }).every((id) => (exp[id] || 0) === (lr.gains[id] || 0)), "Points de la manche justes");

  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2 && game.city.seed !== seed1 && game.cars.every((c) => c.role === "free"), "Manche 2 : nouvelle ville, tout le monde repart en F1");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 240000);
