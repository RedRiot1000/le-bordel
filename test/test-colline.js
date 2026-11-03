// Test automatique : « Roi de la colline » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-colline.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import { MOVE_EVERY } from "../games/colline/server.js";

const K = globalThis.Pieton.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
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
  const picked = await emit("pickGame", { gameId: "colline" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Roi de la colline » se lance");
  check(game.settings.mode === "aleatoire" && game.settings.rounds === 3 && game.settings.duration === 90, "Par défaut : aléatoire, 3 manches de 1 min 30");
  await act("settings", { settings: { duration: 60, mode: "solo" } });
  await act("start");
  await wait(200);
  check(game.phase === "countdown" && game.heroes.length === 4 && !game.teamsMode, "4 joueurs, chacun pour soi");
  const z = game.zone;
  const d = game.heroes.map((h) => Math.hypot(h.x - z.x, h.y - z.y));
  check(d.every((x) => Math.abs(x - d[0]) < 2 && x > z.r), "Tout le monde apparaît en cercle autour de la zone dorée");
  check(game.rects.length >= 4, `${game.rects.length} obstacles`);

  await waitFor(() => game.phase === "play", 5000);
  // Je fonce dans la zone en tapant devant moi.
  let seq = 1, swung = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const h = game.heroes.find((x) => x.id === me);
    const a = Math.atan2(game.zone.y - h.y, game.zone.x - h.x);
    const k = (Math.abs(game.zone.x - h.x) > 20 ? (game.zone.x > h.x ? K.RIGHT : K.LEFT) : 0) | (Math.abs(game.zone.y - h.y) > 20 ? (game.zone.y > h.y ? K.DOWN : K.UP) : 0) | (Math.floor((Date.now() - t0) / 300) % 2 ? K.FIRE : 0);
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k, a } });
    if (game.heroes.find((x) => x.id === me).swing > 0) swung = true;
    await wait(33);
  }
  check(swung, "Clic = un coup de batte");
  check(game.contested || game.owner || Object.keys(game.held).length > 0, "La zone est disputée (tenue ou contestée)");
  // La zone saute ailleurs au bout de 20 s.
  const z0 = { ...game.zone };
  const moved = await waitFor(() => game.zone.x !== z0.x || game.zone.y !== z0.y, MOVE_EVERY + 2000);
  check(moved, "La zone dorée saute ailleurs toutes les 20 s");
  let sawHit = false;
  await waitFor(() => { if ((game.fx || []).some((f) => f.kind === "hit")) sawHit = true; return game.phase === "roundOver"; }, 50000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr, "Fin de manche");
  check(sawHit, "Des coups de batte ont touché");
  const tot = Object.values(lr.gains).reduce((a, b) => a + b, 0);
  check(tot > 10 && tot <= 61, `Points = secondes dans la zone sans contestation (${tot} s au total, max 60)`);
  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2, "Manche 2");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 120000);
