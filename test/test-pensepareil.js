// Test automatique : « Pense pareil » (1 humain + 2 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-pensepareil.js
import { io } from "socket.io-client";
import { normalize } from "../games/pensepareil/server.js";
import { PROMPTS } from "../games/pensepareil/prompts.js";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Réponses proches —");
check(["Le chat", "chats", "Chat !", "LES CHATS"].every((t) => normalize(t) === "chat"), "« Le chat », « chats », « Chat ! », « LES CHATS » = pareil");
check(normalize("Les Chevaux") === normalize("cheval") && normalize("Éléphant") === normalize("elephant"), "Chevaux = cheval, accents ignorés");
check(normalize("Tomate") !== normalize("Fraise"), "Deux réponses différentes restent différentes");
check(PROMPTS.length >= 300 && PROMPTS.every((p) => p.answers.length >= 4), `${PROMPTS.length} thèmes, avec des réponses pour les bots`);

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
  const picked = await emit("pickGame", { gameId: "pensepareil" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Pense pareil » se lance");
  check(game.settings.rounds === 8 && game.settings.answerTime === 30 && game.settings.themes === "joueurs", "Par défaut : 8 thèmes, 30 s, thèmes écrits par les joueurs");

  // --- Mode « joueurs » : chacun écrit ses thèmes ---
  await act("settings", { settings: { rounds: 5, answerTime: 20 } });
  await act("start");
  await wait(200);
  check(game.phase === "propose" && game.perPlayer === 2, "Chacun écrit ses thèmes (5 thèmes / 3 joueurs = 2 chacun)");
  check(!!(await act("propose", { texts: ["Un truc qui flotte"] })).error, "Il faut écrire ses 2 thèmes");
  const dice = await act("random");
  check(dice.ok && PROMPTS.some((p) => p.text === dice.text), "🎲 propose un thème de la banque : " + dice.text);
  await act("propose", { texts: ["Un truc qui   flotte", "Un sport de ouf"] });
  await waitFor(() => game.phase === "answer", 15000);
  const mineThemes = [];
  for (let r = 1; r <= 5; r++) {
    await waitFor(() => game.phase === "answer" && game.round === r, 30000);
    if (game.promptBy === me) mineThemes.push(game.prompt);
    await act("answer", { text: "Truc" });
    await waitFor(() => game.phase === "reveal" && game.round === r, 30000);
    await act("next");
  }
  check(mineThemes.includes("Un truc qui flotte") && mineThemes.includes("Un sport de ouf"), "Mes 2 thèmes ont été joués, avec mon nom (« Thème de… »)");
  await waitFor(() => game.phase === "over", 5000);
  await act("setup");
  await wait(150);

  // --- Mode « banque » ---
  await act("settings", { settings: { themes: "banque" } });
  await act("start");
  await wait(200);
  check(game.phase === "answer" && game.rounds === 5 && !!game.prompt, `Thème 1 : « ${game.prompt} »`);
  check(!!(await act("answer", { text: "   " })).error, "Réponse vide refusée");
  await act("answer", { text: "Zzz réponse unique" });
  check(game.groups === undefined && !JSON.stringify(game).includes("Zzz"), "Les réponses restent secrètes avant la révélation");

  await waitFor(() => game.phase === "reveal", 25000);
  check(game.phase === "reveal" && game.groups.length >= 1, `Révélation : ${game.groups.map((g) => g.label + " ×" + g.ids.length).join(", ")}`);
  const okGains = game.groups.every((g) => g.ids.every((id) => game.gains[id] === g.ids.length - 1));
  check(okGains, "1 point par autre joueur avec la même réponse");
  const mine = game.groups.find((g) => g.ids.includes(me));
  check(mine && mine.ids.length === 1 && game.gains[me] === 0, "Ma réponse unique : seul dans mon coin = 0");
  // L'hôte fusionne ma réponse dans le plus gros paquet.
  const big = game.groups.find((g) => g.key !== mine.key);
  if (big) {
    const before = big.ids.length;
    check(!!(await act("merge", { from: mine.key, into: "nimporte quoi" })).error, "Fusion vers une réponse inconnue refusée");
    await act("merge", { from: mine.key, into: big.key });
    await wait(150);
    const merged = game.groups.find((g) => g.key === big.key);
    check(merged.ids.includes(me) && merged.ids.length === before + 1 && game.gains[me] === before, `Fusion : je rejoins « ${big.label} » et je marque ${before}`);
  }
  const expected = { ...game.gains };
  await act("next");
  await waitFor(() => game.phase === "answer" && game.round === 2, 3000);
  check(game.players.every((p) => (p.score || 0) === (expected[p.id] || 0)), "Les points (avec la fusion) sont gardés");

  // On laisse les bots finir la partie (je ne réponds plus).
  for (let r = 2; r <= 5; r++) {
    await waitFor(() => game.phase === "reveal" && game.round === r, 25000);
    await act("next");
  }
  await waitFor(() => game.phase === "over", 5000);
  check(game.phase === "over" && game.history.length === 5, "Fin après 5 thèmes");
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
