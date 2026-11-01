// Test automatique : « 2 vérités, 1 mensonge » (1 humain + 2 bots, 1 manche).
// Lance le serveur AVANT (node server.js), puis : node test/test-deuxverites.js
import { io } from "socket.io-client";
import { THEMES } from "../games/deuxverites/themes.js";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Thèmes —");
check(THEMES.length >= 25 && THEMES.every((t) => t.hint && t.bot.length >= 3), `${THEMES.length} thèmes, avec une aide et des phrases pour les bots`);

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
  await emit("addBot");
  await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "deuxverites" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« 2 vérités, 1 mensonge » se lance");
  check(game.settings.rounds === 2 && game.settings.writeTime === 90 && game.settings.guessTime === 25, "Par défaut : 2 manches, 90 s pour écrire, 25 s pour voter");
  await act("settings", { settings: { rounds: 1, writeTime: 60, guessTime: 20 } });
  await act("start");
  await wait(200);
  check(game.phase === "write" && !!game.theme?.title && !!game.theme.hint, `Thème : « ${game.theme.title} »`);
  check(!!(await act("write", { lines: ["A", "B"], lie: 0 })).error, "Il faut 3 phrases");
  check(!!(await act("write", { lines: ["A", "B", "C"] })).error, "Il faut cocher le mensonge");
  const MY = ["J'ai un chat qui s'appelle Steak", "J'ai déjà vu un ovni", "Je sais jongler"];
  check((await act("write", { lines: MY, lie: 1 })).ok, "Mes 3 phrases envoyées (la 2e est fausse)");

  await waitFor(() => game.phase === "guess", 20000);
  check(game.phase === "guess" && game.turn.total === 3 && game.turn.lines.length === 3, "Un joueur à la fois, 3 phrases chacun");
  check(game.turn.lie === undefined && !JSON.stringify(game).includes('"lie"'), "Le mensonge reste secret pendant le vote");

  let sawMine = false, refusedSelf = false, okReveal = true, mixed = false;
  for (let num = 1; num <= 3; num++) {
    await waitFor(() => game.phase === "guess" && game.turn.num === num, 30000);
    const t = game.turn;
    if (t.id === me) {
      sawMine = MY.every((l) => t.lines.includes(l));
      mixed = mixed || t.lines.join() !== MY.join();
      refusedSelf = !!(await act("vote", { index: 0 })).error;
    } else {
      await act("vote", { index: 2 });
      await act("vote", { index: 0 });   // je change d'avis
    }
    await waitFor(() => game.phase === "reveal" && game.turn.num === num, 30000);
    const r = game.turn;
    if (r.id === me && r.lines[r.lie] !== MY[1]) okReveal = false;
    if (r.id !== me && r.votes[me] !== 0) okReveal = false;
    let fooled = 0;
    for (const [id, v] of Object.entries(r.votes)) {
      if (r.gains[id] !== (v === r.lie ? 1 : 0)) okReveal = false;
      if (v !== r.lie) fooled++;
    }
    if (r.gains[r.id] !== fooled) okReveal = false;
    await act("next");
  }
  check(sawMine, "Mes phrases sont affichées aux autres");
  check(refusedSelf, "Je ne vote pas pour mes propres phrases");
  check(okReveal, "Révélation : le bon mensonge, mon vote corrigé, et les points justes (+1 trouvé, +1 par piégé)");

  await waitFor(() => game.phase === "over", 5000);
  check(game.phase === "over" && game.history.length === 3, "Fin de partie : les 3 mensonges au récap");
  const total = {};
  for (const id of game.who) total[id] = 0;
  check(game.players.reduce((s, p) => s + p.score, 0) >= 0, `Scores : ${game.players.map((p) => p.pseudo + " " + p.score).join(", ")}`);
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
