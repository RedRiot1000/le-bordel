// Test automatique : Néon (1 humain + 2 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-neon.js
import { io } from "socket.io-client";
import "../public/games/patate/physics.js";
import "../public/games/neon/rules.js";

const P = globalThis.PatatePhysics, N = globalThis.NeonRules, K = P.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

// --- Règles (sans serveur) ---
console.log("— Règles —");
const env = { w: 3000, h: 3000, grip: 1, oils: [], obstacles: [], nitro: false, jump: true };
const speedAfter = (k, s = 3) => { const c = N.newMoto(200, 1500, 0); for (let i = 0; i < s * 30; i++) N.simulate(c, k, env, null); return N.speed(c); };
const vIdle = speedAfter(0), vSlow = speedAfter(K.DOWN), vFast = speedAfter(K.UP);
check(Math.abs(vIdle - N.CRUISE) < 25, `Sans toucher : la moto roule toute seule (${vIdle.toFixed(0)} px/s)`);
check(vSlow >= N.MIN - 10 && vSlow < vIdle, `En freinant : jamais sous le minimum (${vSlow.toFixed(0)} px/s)`);
check(vFast > vIdle + 80, `En accélérant : ${vFast.toFixed(0)} px/s`);
const jm = N.newMoto(200, 1500, 0);
N.simulate(jm, K.HB, env, null);
const j1 = jm.jump;
for (let i = 0; i < 20; i++) N.simulate(jm, K.HB, env, null);
check(j1 > 0 && jm.jump === 0 && jm.jumpCd > 3, "Saut : 0,5 s en l'air, puis recharge (Espace gardé = pas de 2e saut)");
const grid = N.buildGrid({ a: [100, 100, 0, 1, 200, 100, 0, 0] }, {});
check(N.hitWall(grid, 150, 104, N.HIT_R, "b") === "a" && N.hitWall(grid, 150, 120, N.HIT_R, "b") === null, "Un mur se touche à quelques px, pas plus loin");

// --- Partie en ligne ---
const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null;
let trails = {}, lastTick = -1, syncOk = 0, syncBad = 0;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => {
  game = state;
  // Même recollage des murs que le navigateur, et on vérifie qu'il colle au complet.
  if (state.trails) {
    if (state.phase === "play" && state.tick === lastTick + 1) {
      // Même bout de mur (le point le plus récent), et au plus 4 points d'écart à la queue
      // (les vieux points s'effacent un poil plus tard chez nous : marge de 0,1 s).
      let ok = true;
      for (const [id, full] of Object.entries(state.trails)) {
        const mine = [...(trails[id] || []), ...(state.adds?.[id] || [])];
        if (Math.abs(mine.length - full.length) > 16 || mine.slice(-4).join() !== full.slice(-4).join()) ok = false;
      }
      if (ok) syncOk++; else syncBad++;
    }
    trails = {}; for (const [id, p] of Object.entries(state.trails)) trails[id] = p.slice();
    lastTick = state.tick;
  } else if (state.tick === lastTick + 1) {
    for (const [id, p] of Object.entries(state.adds || {})) (trails[id] ||= []).push(...p);
    lastTick = state.tick;
    const limit = state.t - state.wallMs - 100;   // (même marge que le navigateur)
    for (const tr of Object.values(trails)) { let cut = 0; while (cut < tr.length && tr[cut + 2] < limit) cut += 4; if (cut) tr.splice(0, cut); }
  }
});
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); }
  return false;
}

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  await emit("addBot");
  await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "neon" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Néon » se lance");
  check(game.settings.rounds === 5 && game.settings.jump && game.settings.zone, "Par défaut : 5 manches, saut et zone activés");
  await act("settings", { settings: { rounds: 3, walls: "long" } });
  await wait(100);
  check(game.settings.rounds === 3 && game.settings.walls === "long", "Réglages : 3 manches, murs de 12 s");

  console.log("\n— Manche 1 —");
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.motos.length === 3 && game.motos.every((m) => m.type === "moto"), "3 motos sur la ligne de départ");
  check(game.map.w === 1280, `Arène pour 3 joueurs : ${game.map.w}×${game.map.h}, ${game.map.obstacles.length} obstacles`);
  await waitFor(() => game.phase === "play", 5000);
  const start = game.motos.find((m) => m.id === me);
  await wait(1000);
  // Je ne touche à rien : ma moto avance toute seule (le serveur la fait rouler).
  const mine = game.motos.find((m) => m.id === me);
  check(Math.hypot(mine.x - start.x, mine.y - start.y) > 150 || !mine.alive, `Sans toucher le clavier, ma moto avance (${Math.hypot(mine.x - start.x, mine.y - start.y).toFixed(0)} px en 1 s)`);
  await wait(1200);
  check(Object.values(trails).some((t) => t.length > 20), `Les murs de lumière se dessinent (${Object.values(trails).map((t) => t.length / 4).join(" / ")} points)`);

  // Je fonce tout droit en accélérant : je finis dans un mur, un obstacle ou le bord.
  let seq = 0;
  for (let i = 0; i < 300 && game.motos.find((m) => m.id === me)?.alive; i++) {
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k: K.UP } });
    await wait(33);
  }
  check(!game.motos.find((m) => m.id === me).alive, "Je finis par exploser (tout droit = BOUM)");
  const over = await waitFor(() => game.phase === "roundOver", 90000);
  check(over, "Fin de manche quand il reste un seul survivant");
  const lr = game.lastRound;
  check(lr?.length === 3 && lr.every((r) => r.points === r.survival + r.kills), `Points = survie + kills : ${lr?.map((r) => `${r.points}${r.kills ? "(💀" + r.kills + ")" : ""}`).join(" / ")}`);
  check(lr?.some((r) => r.survival === 2 || r.place === 1), "Le gagnant a le plus de points de survie");
  check(syncOk > 0 && syncBad === 0, `Murs recollés sans erreur (${syncOk} vérifications, ${syncBad} écart)`);

  console.log("\n— Manches 2 et 3 —");
  for (let r = 2; r <= 3; r++) {
    await act("start");
    await waitFor(() => game.phase === "play", 5000);
    await waitFor(() => game.phase === "roundOver", 100000);
  }
  check(game.phase === "roundOver" && game.final && game.finishLeft > 10000, "Après 3 manches : dernière manche, classement automatique dans 15 s");
  const again = await act("start");
  await wait(100);
  check(game.phase === "roundOver", "Plus de manche après la dernière");
  await act("finish");
  await wait(200);
  check(hub.phase === "podium", "Podium");

  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 400000);
