// Test automatique : « Foule » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-foule.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import { createGame } from "../games/foule/server.js";

const H = globalThis.Pieton, K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) { if (cond) { results.pass++; console.log("  ✅", label); } else { results.fail++; console.log("  ❌", label); } }

console.log("— Règles —");
{
  const list = ["a", "b", "c"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const sent = [];
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: (id, type, p) => sent.push({ id, type, p }), savedSettings: { laps: 1 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  const pub = JSON.stringify(game.publicState().ents);
  check(!/player|bot|pseudo/.test(pub), "L'état public ne dit pas qui est un joueur");
  check(g.rounds === 3 && !!g.sniper && !g.byPlayer[g.sniper] && Object.keys(g.byPlayer).length === 2, "3 joueurs = 3 manches ; 1 sniper, 2 cachés dans la foule");
  check(g.ammo === 2 + 3, `Le sniper a peu de balles (${g.ammo})`);
  g.phase = "play"; g.playAt = Date.now();
  const hider = Object.values(g.byPlayer)[0], npc = g.ents.find((x) => !x.player);
  // Tirer sur un passant : il tombe, une balle de perdue.
  game.onAction(g.sniper, "in", { k: K.FIRE, p: { x: npc.h.x, y: npc.h.y } });
  check(!npc.alive && g.ammo === 4 && g.kills === 0, "Tirer sur un passant : une balle perdue");
  game.onAction(g.sniper, "in", { k: 0, p: { x: hider.h.x, y: hider.h.y } });
  g.reloadAt = 0;
  game.onAction(g.sniper, "in", { k: K.FIRE, p: { x: hider.h.x, y: hider.h.y } });
  check(!hider.alive && g.kills === 1, "Tirer sur un joueur caché : touché");
  // Les passants ont plusieurs comportements.
  const t = Date.now();
  const modes = new Set();
  for (let i = 0; i < 400; i++) for (const x of g.ents.slice(0, 20)) { x.ai.until = 0; g.__brain?.(x, t + i * 50); modes.add(x.ai.mode); }
  check(typeof g.__brain === "function" && ["marche", "trotte", "groupe", "banc", "pause"].every((m) => modes.has(m)), `Les passants marchent, trottinent, discutent, s'assoient, s'arrêtent (${[...modes].join(", ")})`);
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
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "foule" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Foule » se lance");
  await act("start");
  await waitFor(() => game.phase === "play" && mine, 7000);
  check(!!mine && (mine.role === "sniper") === (game.sniper === me), `Je reçois mon rôle en privé (${mine?.role})`);
  if (mine.role === "hider") {
    const start = { x: mine.x, y: mine.y };
    let seq = 0;
    for (let i = 0; i < 40; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: i < 20 ? K.RIGHT : K.DOWN | K.DASH, a: 0 } }); await wait(33); }
    await wait(250);
    check(!mine.alive || Math.hypot(mine.x - start.x, mine.y - start.y) > 40, "Caché : je marche et je trottine");
  } else {
    socket.emit("gameAction", { type: "in", data: { k: 0, p: { x: 300, y: 300 } } });
    await wait(200);
    check(game.laser.x === 300 && game.laser.y === 300, "Sniper : tout le monde voit mon laser");
  }
  await waitFor(() => game.phase === "roundOver", 100000);
  check(game.phase === "roundOver" && game.lastRound, "Fin de manche");
  const s1 = game.sniper;
  await waitFor(() => game.phase === "countdown" && game.round === 2, 12000);
  check(game.round === 2 && game.sniper !== s1, "La manche suivante se lance toute seule, avec un autre sniper");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
