// Test automatique : « La Nuit du Tueur » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-tueur.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/lampe/manor.js";
import { PER_FUSE, ESCAPE, KILL, WOUND } from "../games/tueur/server.js";

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
  let ok = true, n = 0;
  for (let s = 1; s <= 30; s++) { const m = M.build(s * 7907, 2 + (s % 7)); const sp = M.hideSpots(m); n += sp.length; if (!sp.every((p) => m.nav.free[M.cellOf(m.nav, p.x, p.y)])) ok = false; }
  check(ok && n > 30, `Des cachettes devant les armoires / lits / buffets (${Math.round(n / 30)} par manoir en moyenne), toutes accessibles`);
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
  const picked = await emit("pickGame", { gameId: "tueur" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« La Nuit du Tueur » se lance");
  check(game.settings.duration === 180, "Par défaut : manches de 3 min");
  await act("settings", { settings: { duration: 120 } });
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.rounds === 4 && game.heroes.filter((h) => h.killer).length === 1, "4 joueurs = 4 manches, 1 tueur");
  check(game.fuses.length === 3 && game.box && !game.gateOpen, "3 fusibles, un tableau électrique, portail fermé");
  check(game.items.length >= 5 && game.heroes.filter((h) => !h.killer).every((h) => h.lamp), "Des objets au sol, les humains ont leur lampe");
  const killers = [game.killer];
  await waitFor(() => game.phase === "play", 5000);
  await wait(300);
  check(game.heroes.find((h) => h.killer).frozen, "Le tueur attend quelques secondes avant de partir");
  // On laisse la manche se finir (je ne bouge pas).
  let sawWound = false, sawKill = false;
  await waitFor(() => {
    if (game.heroes?.some((h) => h.wounded)) sawWound = true;
    if (game.heroes?.some((h) => !h.alive)) sawKill = true;
    return game.phase === "roundOver";
  }, 140000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr, "Fin de manche");
  console.log(`     (tueur ${lr.killer === me ? "moi" : lr.killer} · fusibles ${lr.fusesDone}/${lr.fusesTotal} · échappés ${lr.escaped.length} · morts ${lr.dead.length})`);
  if (lr.killer !== me) check(sawWound && (sawKill || lr.escaped.length > 0), "Le couteau blesse, puis tue");
  else check(lr.fusesDone > 0 || lr.escaped.length > 0 || lr.caught.length > 0, "Les humains cherchent les fusibles (tueur immobile)");
  const ok = Object.entries(lr.gains).every(([id, n]) => {
    const s = lr.stats[id];
    return n === (id === lr.killer ? s.kills * KILL + s.wounds * WOUND : s.fuses * PER_FUSE + (lr.escaped.includes(id) ? ESCAPE : 0));
  });
  check(ok, "Points de la manche justes");
  // Les manches suivantes : chacun est le tueur une fois.
  for (let r = 2; r <= 4; r++) {
    await act("next");
    await waitFor(() => game.phase === "countdown" && game.round === r, 3000);
    killers.push(game.killer);
    await act("finish").catch(() => {});
    break;
  }
  check(new Set(killers).size === killers.length, "Un nouveau tueur à la manche suivante");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
