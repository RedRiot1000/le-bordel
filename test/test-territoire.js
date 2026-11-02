// Test automatique : « Territoire » (1 humain + 3 bots), un match de 60 s.
// Lance le serveur AVANT (node server.js), puis : node test/test-territoire.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import { CELL, GW, SHOT_RANGE } from "../games/territoire/server.js";

const K = globalThis.Pieton.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null, stat = null, grid = null;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => {
  game = state;
  if (state.static) stat = state.static;
  // On rejoue la peinture comme le navigateur (grille complète ou cases changées).
  if (state.paint?.full) grid = state.paint.full.split("").map((ch) => (ch === "#" ? 255 : Number(ch)));
  else if (grid && state.paint) for (let j = 0; j < state.paint.adds.length; j += 2) grid[state.paint.adds[j]] = state.paint.adds[j + 1];
});
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); }
  return false;
}
const cellAt = (x, y) => Math.floor(y / CELL) * GW + Math.floor(x / CELL);

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "territoire" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Territoire » se lance");
  check(game.settings.duration === 90 && game.settings.mode === "auto", "Par défaut : 90 s, mode auto");
  await act("settings", { settings: { duration: 60 } });
  await act("start");
  await waitFor(() => game.phase === "countdown" && stat, 3000);
  check(stat.teamsMode && Object.keys(stat.owners).length === 2 && stat.owners[1].ids.length === 2, "4 joueurs → 2 équipes de 2");
  check(stat.rects.length >= 3, `${stat.rects.length} obstacles`);
  const myOwner = stat.ownerOf[me];
  const start = game.heroes.find((h) => h.id === me);
  check(grid && grid[cellAt(start.x, start.y)] === myOwner, "Une tache de ma couleur sous mes pieds au départ");

  await waitFor(() => game.phase === "play", 5000);
  // Je marche vers le centre en tirant devant moi.
  let seq = 1;
  const t0 = Date.now();
  let shot = false;
  while (Date.now() - t0 < 2500) {
    const h = game.heroes.find((x) => x.id === me);
    const a = Math.atan2(400 - h.y, 640 - h.x);
    const k = (Math.abs(640 - h.x) > 20 ? (640 > h.x ? K.RIGHT : K.LEFT) : 0) | (Math.abs(400 - h.y) > 20 ? (400 > h.y ? K.DOWN : K.UP) : 0) | K.FIRE;
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k, a, tx: h.x + Math.cos(a) * 400, ty: h.y + Math.sin(a) * 400 } });
    if (game.shots.some((s) => s.owner === myOwner)) shot = true;
    await wait(33);
  }
  const mine = game.heroes.find((h) => h.id === me);
  check(Math.hypot(mine.x - start.x, mine.y - start.y) > 100, "Mon bonhomme marche");
  check(grid[cellAt(mine.x, mine.y)] === myOwner, "Mes pas peignent le sol de ma couleur");
  check(shot, "Clic gauche = un jet de peinture");
  const s0 = game.shots.find((s) => s.owner === myOwner);
  if (s0) check(Math.hypot(s0.x1 - s0.x0, s0.y1 - s0.y0) <= SHOT_RANGE + 1, "Le jet est limité à sa portée");
  check((game.pct[myOwner] || 0) > 0.02, `Mon équipe a déjà ${(100 * (game.pct[myOwner] || 0)).toFixed(1)} % de l'arène`);

  // On laisse le match se finir.
  let sawBonus = false;
  await waitFor(() => { if (game.bonuses?.length) sawBonus = true; return game.phase === "over"; }, 75000);
  check(game.phase === "over" && game.result, "Fin du match");
  check(sawBonus, "Des caisses bonus sont apparues");
  const sc = game.result.scores;
  check(sc.length === 2 && sc[0].pct >= sc[1].pct && sc[0].pct + sc[1].pct > 0.4, `Résultat : ${sc.map((s) => (s.pct * 100).toFixed(1) + " %").join(" contre ")}`);
  // La grille rejouée (cases changées) = ce que compte le serveur.
  const counted = grid.filter((v) => v === sc[0].owner).length, total = grid.filter((v) => v !== 255).length;
  check(Math.abs(counted / total - sc[0].pct) < 0.002, "La peinture reçue par le navigateur = le score du serveur");

  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 120000);
