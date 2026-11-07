// Test automatique : « Foule » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-foule.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import { createGame, HIT_R } from "../games/foule/server.js";

const H = globalThis.Pieton, K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Règles —");
{
  const list = ["a", "b", "c"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const sent = {};
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: (id, type, p) => { (sent[id] ||= []).push({ type, p }); }, savedSettings: { rounds: 3 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  const pub = JSON.stringify(game.publicState().ents);
  check(!/player|bot|pseudo/.test(pub) && !list.some((p) => pub.includes(`"${p.id}"`)), "L'état public ne dit pas qui est un joueur");
  check(g.ents.length >= 30 && g.ents.filter((x) => x.player).length === 3, `Une foule (${g.ents.length} personnages dont 3 joueurs)`);
  g.phase = "play"; g.playAt = Date.now();
  const A = g.byPlayer.a, B = g.byPlayer.b;
  // Mettre A juste à côté d'un passant (et loin de tout le reste).
  for (const x of g.ents) { x.h.x = 1200; x.h.y = 700 - g.ents.indexOf(x) * 0; }
  g.plaza.rects = [];
  g.ents.forEach((x, i) => { x.h.x = 60 + (i % 10) * 110; x.h.y = 60 + Math.floor(i / 10) * 110; });
  const npc = g.ents.find((x) => !x.player);
  A.h.x = npc.h.x + 30; A.h.y = npc.h.y;
  const send = (x, id, k) => { x.budget = 6; game.onAction(id, "in", { s: x.seq + 1, k }); };
  send(A, "a", K.FIRE);
  check(!npc.alive && A.revUntil > Date.now(), "Frapper un passant : il tombe, et on est révélé");
  A.hitReady = 0; A.prevK = 0;
  A.h.x = B.h.x + 30; A.h.y = B.h.y;
  send(A, "a", 0); send(A, "a", K.FIRE);
  check(!B.alive && A.kills === 1, "Frapper un joueur : il est éliminé");
  check(HIT_R >= 40, "Il faut être au contact pour frapper");
  game.onAction("a", "next", {});
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null, mine = null;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => (game = state));
socket.on("gameMsg", ({ type, payload }) => { if (type === "me") mine = payload; });
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); } return false; }

async function run() {
  console.log("— Partie —");
  await wait(300);
  await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "foule" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Foule » se lance");
  await act("start");
  await waitFor(() => game.phase === "play" && mine, 6000);
  check(!!mine && game.ents.some((x) => x.e === mine.e), "Je reçois en privé quel personnage est le mien");
  const start = { x: mine.x, y: mine.y };
  let seq = 0;
  for (let i = 0; i < 40; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: i < 20 ? K.RIGHT : K.DOWN } }); await wait(33); }
  await wait(250);
  check(Math.hypot(mine.x - start.x, mine.y - start.y) > 40 || !mine.alive, "Je me déplace dans la foule");
  await waitFor(() => game.phase === "roundOver", 130000);
  const lr = game.lastRound;
  check(game.phase === "roundOver" && lr && lr.order.length === 4, "Fin de manche");
  await act("next");
  await wait(300);
  check(game.phase === "countdown" && game.round === 2, "Manche 2");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
