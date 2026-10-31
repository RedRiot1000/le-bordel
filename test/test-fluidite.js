// Test de fluidité : on conduit comme le navigateur (calcul local + envoi
// des touches 30 fois/s) et on compte combien de fois le serveur trouve
// un résultat DIFFÉRENT de notre prédiction (= une saccade à l'écran).
// Lance le serveur AVANT (node server.js), puis : node test/test-fluidite.js
import { io } from "socket.io-client";
import "../public/games/patate/physics.js";

const P = globalThis.PatatePhysics;
const K = P.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let game = null;
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });

let me = null, pred = null, seq = 0, driving = true;
const history = new Map();
const stats = { msgs: 0, ok: 0, diff: 0, maxErr: 0, sumErr: 0, crashes: 0 };

function env() {
  const m = game.map;
  return { w: m.w, h: m.h, grip: m.grip, oils: m.oils, obstacles: m.obstacles, nitro: game.settings.nitro };
}

socket.on("game", ({ state }) => {
  game = state;
  const sc = state.cars.find((c) => c.id === me);
  if (!sc || !sc.alive || state.phase !== "play" || !driving) return;
  if (!pred) { pred = P.copyCar(sc); return; }
  stats.msgs++;
  const h = history.get(sc.seq);
  if (!h) return;
  const err = Math.hypot(h.x - sc.x, h.y - sc.y);
  const near = state.cars.some((c) => c.id !== me && Math.hypot(c.x - sc.x, c.y - sc.y) < 60);
  if (err < 0.05 && Math.abs(angDiff(h.a, sc.a)) < 0.002) stats.ok++;
  else if (near) stats.crashes++;   // un choc avec une autre voiture : normal que ça diffère
  else {
    stats.diff++; stats.maxErr = Math.max(stats.maxErr, err); stats.sumErr += err;
    if (process.env.DEBUG) console.log(`  écart ${err.toFixed(1)} px au n°${sc.seq} (envoyés ${seq}) · porteur=${state.holderId === me ? "moi" : "autre"} · vitesse ${Math.hypot(sc.vx, sc.vy).toFixed(0)}`);
  }
  // Recalage (comme le navigateur) si on s'est trompé.
  if (err >= 0.05) {
    pred = P.copyCar(sc);
    for (let s = sc.seq + 1; s <= seq; s++) { const k = history.get(s)?.k ?? 0; P.simulate(pred, k, env(), state.holderId === me ? P.HOLDER_BONUS : 1); history.set(s, { ...P.copyCar(pred), k }); }
  }
});

async function run() {
  await wait(300);
  me = (await emit("createRoom", { pseudo: "Testeur" })).playerId;
  await emit("addBot"); await emit("addBot");
  await emit("pickGame", { gameId: "patate" });
  await wait(200);
  await act("settings", { settings: { fuse: "longue" } });
  await act("start");
  while (!game || game.phase !== "play") await wait(20);
  await wait(100);

  // Programme de conduite : 8 secondes de virages, frein à main, nitro.
  const plan = [
    [1.2, K.UP], [0.8, K.UP | K.RIGHT], [0.5, K.UP | K.LEFT | K.HB], [0.6, K.UP | K.LEFT],
    [0.9, K.UP | K.NITRO], [1.0, K.UP | K.RIGHT], [0.8, K.DOWN], [1.2, K.UP | K.LEFT], [1.0, K.UP],
  ];
  const t0 = Date.now();
  let next = t0;
  for (const [secs, k] of plan) {
    const end = Date.now() + secs * 1000;
    while (Date.now() < end && game.phase === "play" && game.cars.find((c) => c.id === me)?.alive) {
      seq++;
      socket.emit("gameAction", { type: "in", data: { s: seq, k } });
      P.simulate(pred, k, env(), game.holderId === me ? P.HOLDER_BONUS : 1);
      history.set(seq, { ...P.copyCar(pred), k });
      next += 1000 / 30;
      await wait(Math.max(0, next - Date.now()));
    }
  }
  await wait(150);       // derniers messages en route
  driving = false;       // ensuite on ne conduit plus : la voiture part en roue libre, normal
  const pct = (100 * stats.ok / Math.max(1, stats.ok + stats.diff)).toFixed(1);
  console.log(`\nMessages reçus : ${stats.msgs} · prédiction exacte : ${stats.ok} · écarts sans choc : ${stats.diff} · chocs : ${stats.crashes}`);
  console.log(`Prédiction juste : ${pct} %  ·  écart moyen ${(stats.sumErr / Math.max(1, stats.diff)).toFixed(2)} px  ·  écart max ${stats.maxErr.toFixed(1)} px\n`);
  socket.close();
  process.exit(+pct >= 99 ? 0 : 1);
}

setTimeout(() => { console.log("❌ bloqué"); process.exit(1); }, 40_000);
run().catch((e) => { console.error(e); process.exit(1); });
