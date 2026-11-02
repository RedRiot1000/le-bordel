// Test automatique : « Sol qui s'effondre » + le moteur bonhomme.
// Lance le serveur AVANT (node server.js), puis : node test/test-sol.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import { makeArena, tileAt, COLS, ROWS, TILE } from "../games/sol/server.js";

const H = globalThis.Pieton, K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Moteur bonhomme —");
{
  const h = H.newHero(100, 100);
  for (let i = 0; i < 30; i++) H.simulate(h, K.RIGHT, null, {});
  check(h.x > 280 && Math.abs(h.vx - H.SPEED) < 1, `Il marche à droite (${Math.round(h.vx)} px/s)`);
  for (let i = 0; i < 10; i++) H.simulate(h, 0, null, {});
  check(Math.hypot(h.vx, h.vy) < 1, "Il s'arrête quand on lâche (un peu d'inertie)");
  const d = H.newHero(100, 100);
  H.simulate(d, K.DOWN | K.DASH, null, {});
  check(d.vy > 500 && d.dash > 1.5, "Dash : grosse vitesse, puis recharge 2 s");
  // Un dash qui touche projette l'autre.
  const a = H.newHero(100, 100), b = H.newHero(150, 100);
  for (let i = 0; i < 6; i++) { H.simulate(a, K.RIGHT | K.DASH, null, {}); H.collideHeroes(a, b); H.drive(b, 0, null, H.TICK, {}); }
  check(b.vx > 250 && b.stun > 0, `Un dash projette l'autre (${Math.round(b.vx)} px/s)`);
  const c2 = H.newHero(100, 100), hv = { ...H.newHero(150, 100), heavy: 5 };
  for (let i = 0; i < 6; i++) { H.simulate(c2, K.RIGHT | K.DASH, null, {}); H.collideHeroes(c2, hv); H.drive(hv, 0, null, H.TICK, {}); }
  check(hv.vx < b.vx * 0.5, "Un joueur « lourd » est bien plus dur à pousser");
  // La poussée (Sol qui s'effondre) : on ne bouge pas, celui qui est devant est repoussé.
  const p = H.newHero(100, 100, 0), front = H.newHero(140, 100), behind = H.newHero(60, 100);
  H.simulate(p, K.DASH, null, { push: true });
  check(p.pushed && p.pushT > 0 && Math.hypot(p.vx, p.vy) < 1, "Poussée : bras tendus, sans avancer");
  const hits = H.applyPush(p, [front, behind]);
  check(hits.length === 1 && hits[0] === front && front.vx > 400 && behind.vx === 0, "Seul celui qui est DEVANT est repoussé");
  H.simulate(p, K.DASH, null, { push: true });
  check(p.dash > 0.5, "Recharge avant de pouvoir repousser");
  const w = H.newHero(20, 20);
  for (let i = 0; i < 20; i++) H.simulate(w, K.LEFT | K.UP, null, { walls: true, w: 400, h: 400, rects: [] });
  check(w.x >= H.R - 0.01 && w.y >= H.R - 0.01, "Les murs l'arrêtent");
}

console.log("— Arènes —");
for (const shape of ["carré", "rond", "croix", "anneau", "îlots", "gruyère"]) {
  const g = makeArena(shape, 4);
  let n = 0;
  for (const v of g) n += v;
  check(n > 150 && n < COLS * ROWS, `${shape} : ${n} dalles`);
}
check(tileAt(-5, 10) === -1 && tileAt(TILE * 2 + 1, TILE + 1) === COLS + 2, "Repérage des dalles");

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
  const picked = await emit("pickGame", { gameId: "sol" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Sol qui s'effondre » se lance");
  check(game.settings.rounds === 3 && game.settings.floor === "solides", "Par défaut : 3 manches, dalles solides");
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.heroes.length === 4, "4 bonshommes sur l'arène");
  const tiles = game.arena.tiles;
  check(game.heroes.every((h) => tiles[tileAt(h.x, h.y)] === "1"), `Tout le monde démarre sur une dalle (arène : ${game.arena.shape})`);
  const start = game.heroes.find((h) => h.id === me);
  socket.emit("gameAction", { type: "in", data: { s: 1, k: K.RIGHT } });
  await wait(300);
  const still = game.heroes.find((h) => h.id === me);
  check(Math.hypot(still.x - start.x, still.y - start.y) < 1, "Personne ne bouge pendant le compte à rebours");

  await waitFor(() => game.phase === "play", 5000);
  // Je cours en rond un moment : les dalles se fissurent derrière moi.
  let seq = 1, sawCracked = false, sawFalling = false;
  const keys = [K.RIGHT, K.DOWN, K.LEFT, K.UP];
  for (let i = 0; i < 60; i++) {
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k: keys[Math.floor(i / 8) % 4] } });
    await wait(33);
    if (game.arena.tiles.includes("a")) sawCracked = true;
    if (/[2-9]/.test(game.arena.tiles)) sawFalling = true;
  }
  check(sawCracked, "Les dalles où on passe se fissurent (1er passage)");
  check(sawFalling, "Des dalles tombent (2e passage)");
  const mine = game.heroes.find((h) => h.id === me);
  check(Math.hypot(mine.x - start.x, mine.y - start.y) > 20 || !mine.alive, "Mon bonhomme a bougé");

  // On laisse les bots finir la manche (je ne bouge plus : je vais tomber).
  await waitFor(() => game.phase === "roundOver", 120000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, `Fin de manche : ${lr?.winner ? "gagnant trouvé" : "?"}`);
  check(lr.order[0] === lr.winner && lr.gains[lr.winner] === 3 && lr.gains[lr.order[3]] === 0, "Points : 3 au dernier debout … 0 au premier tombé");
  check(game.players.reduce((s, p) => s + p.score, 0) === 6, "Total des points de la manche = 0+1+2+3");

  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2, "Manche 2 : nouvelle arène");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
