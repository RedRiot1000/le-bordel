// Test automatique : « Chat et souris » (1 humain + 3 bots), 2 manches de 60 s.
// Lance le serveur AVANT (node server.js), puis : node test/test-chat.js
import { io } from "socket.io-client";
import { generateMap } from "../games/patate/maps.js";
import { W, H, ASPHALT_CHANCE } from "../games/chat/server.js";

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
  // Sol : 75 % d'asphalte (on tire 2000 maps).
  let asphalt = 0;
  for (let i = 0; i < 2000; i++) if (generateMap({ W, H, players: 4, slippery: true, size: 4, asphaltChance: ASPHALT_CHANCE }).surface === "asphalte") asphalt++;
  check(asphalt > 1400 && asphalt < 1600, `Sol : ${Math.round(asphalt / 20)} % d'asphalte (attendu 75 %)`);

  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "chat" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Chat et souris » se lance");
  check(game.settings.rounds === 7 && game.settings.duration === 90, "Par défaut : 7 manches de 90 s");
  await act("settings", { settings: { duration: 60, rounds: 3 } });
  await act("start");
  await wait(200);
  const cats = game.cars.filter((c) => c.role === "cat");
  check(game.phase === "countdown" && game.cars.length === 4 && cats.length === 1, "4 joueurs : 1 chat, 3 souris");
  check(cats[0].type === "sport" && game.cars.filter((c) => c.role === "mouse").every((c) => c.type === "moto"), "Le chat est une Sportive, les souris des motos");
  check(game.map.w === 2560 && game.map.h === 1600 && game.map.obstacles.length >= 12, `Map 2 fois plus grande (${game.map.w}×${game.map.h}, ${game.map.obstacles.length} obstacles)`);
  const starter1 = game.starters[0];
  const catStart = { ...cats[0] };

  await waitFor(() => game.phase === "play", 5000);
  await wait(1200);
  const catNow = game.cars.find((c) => c.id === starter1);
  const miceMoved = game.cars.filter((c) => c.role === "mouse" && c.id !== me).some((c) => Math.hypot(c.vx, c.vy) > 50);
  check(Math.hypot(catNow.x - catStart.x, catNow.y - catStart.y) < 2 && miceMoved, "Les souris partent avant le chat (2 s d'avance)");

  // Je ne bouge pas : si je suis souris, je me fais attraper.
  let sawFresh = false, lastCaughtAt = 0;
  await waitFor(() => {
    if (game.cars.some((c) => c.fresh)) sawFresh = true;
    if (!lastCaughtAt && game.phase === "play" && game.cars.every((c) => c.role === "cat")) lastCaughtAt = Date.now();
    return game.phase === "roundOver";
  }, 70000);
  const after = lastCaughtAt ? Date.now() - lastCaughtAt : null;
  const lr = game.lastRound;
  check(game.phase === "roundOver" && !!lr, "Fin de manche 1");
  console.log(`     (manche 1 : ${lr.caught.length} souris attrapée(s) à ${lr.caught.map((c) => Math.round(c.at / 1000) + " s" + (c.id === me ? " (moi)" : "")).join(", ")} · ${lr.survivors.length} libre(s))`);
  check(lr.caught.length + lr.survivors.length === 3, "Chaque souris est soit attrapée, soit libre");
  if (after !== null) check(after > 1000, `La partie continue ${(after / 1000).toFixed(1)} s après la dernière capture avant les scores`);
  check(lr.caught.every((c) => game.cars.find((x) => x.id === c.id)?.role === "cat"), "Une souris attrapée devient chat");
  if (lr.caught.length) check(sawFresh, "Le nouveau chat clignote (il ne peut pas attraper tout de suite)");
  // Points de la manche.
  const exp = {};
  lr.caught.forEach((c, i) => { exp[c.by] = (exp[c.by] || 0) + 1; exp[c.id] = (exp[c.id] || 0) + i; });
  for (const id of lr.survivors) exp[id] = (exp[id] || 0) + lr.caught.length + 2;
  check(Object.keys({ ...exp, ...lr.gains }).every((id) => (exp[id] || 0) === (lr.gains[id] || 0)), "Points de la manche justes");
  const caughtTotal1 = lr.caught.length;

  await act("next");
  await wait(200);
  check(game.phase === "countdown" && game.round === 2 && game.starters[0] !== starter1, "Manche 2 : un autre joueur commence chat");
  await waitFor(() => game.phase === "roundOver", 70000);
  console.log(`     (manche 2 : ${game.lastRound.caught.map((c) => Math.round(c.at / 1000) + " s" + (c.id === me ? " (moi)" : "")).join(", ")})`);
  check(caughtTotal1 + game.lastRound.caught.length > 0, "Les chats-bots attrapent des souris");
  const sum = game.players.reduce((s, p) => s + p.score, 0);
  check(sum > 0, `Scores cumulés (${game.players.map((p) => p.score).join(" / ")})`);

  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
