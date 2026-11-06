// Test automatique : une soirée complète à 3 joueurs (hub + Imposter).
// Lance le serveur AVANT (node server.js), puis : npm test
import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Un faux joueur piloté par le test.
class Bot {
  constructor(pseudo) {
    this.pseudo = pseudo;
    this.socket = io(URL, { transports: ["websocket"], forceNew: true });
    this.hub = null;
    this.game = null;
    this.role = null;
    this.socket.on("hub", (h) => (this.hub = h));
    this.socket.on("game", ({ state }) => (this.game = state));
    this.socket.on("gameMsg", ({ type, payload }) => { if (type === "yourRole") this.role = payload; });
  }
  emit(ev, data) { return new Promise((res) => this.socket.emit(ev, data, res)); }
  send(ev, data = {}) { this.socket.emit(ev, data); }   // sans attendre de réponse
  act(type, data = {}) { return this.emit("gameAction", { type, data }); }
}

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

async function run() {
  console.log("\n— Salon —");
  const a = new Bot("Alice"), b = new Bot("Bob"), c = new Bot("Chloé");
  await wait(300);
  const created = await a.emit("createRoom", { pseudo: "Alice" });
  check(created.ok && created.code.length === 4, "Alice crée le salon " + created.code);
  const code = created.code;
  a.id = created.playerId;
  b.id = (await b.emit("joinRoom", { code, pseudo: "Bob" })).playerId;
  check(!!b.id, "Bob rejoint");
  const tooFew = await a.emit("pickGame", { gameId: "imposter" });
  check(!!tooFew.error, "Impossible de lancer Imposter à 2 : " + tooFew.error);
  c.id = (await c.emit("joinRoom", { code, pseudo: "Chloé" })).playerId;
  await wait(200);
  check(a.hub.players.length === 3, "3 joueurs dans le salon");
  check(new Set(a.hub.players.map((p) => p.color)).size === 3, "chacun a une couleur différente");
  // Choix de la couleur.
  {
    const colors = a.hub.colors, bobColor = a.hub.players.find((p) => p.id === b.id).color;
    check(colors.length >= 10, `${colors.length} couleurs au choix`);
    const free = colors.find((col) => !a.hub.players.some((p) => p.color === col));
    await a.emit("pickColor", { color: free });
    await wait(100);
    check(a.hub.players.find((p) => p.id === a.id).color === free, "Je choisis ma couleur");
    const refused = await a.emit("pickColor", { color: bobColor });
    check(!!refused.error, "Impossible de prendre la couleur d'un autre joueur : " + refused.error);
    check(!!(await a.emit("pickColor", { color: "#123456" })).error, "Couleur inconnue refusée");
    await a.emit("addBot");
    await wait(100);
    const bot = a.hub.players.find((p) => p.bot), old = bot.color, mine = free;
    const ok = await a.emit("pickColor", { color: old });
    await wait(100);
    const after = a.hub.players.find((p) => p.id === bot.id);
    check(ok.ok && a.hub.players.find((p) => p.id === a.id).color === old && after.color === mine, "Priorité sur les bots : le bot prend mon ancienne couleur");
    a.send("kickPlayer", { playerId: bot.id });
    await wait(100);
  }

  const notHost = await b.emit("pickGame", { gameId: "imposter" });
  await wait(100);
  check(notHost.error && a.hub.phase === "lobby", "Bob (pas hôte) ne peut pas lancer de jeu");

  console.log("\n— Imposter —");
  await a.emit("pickGame", { gameId: "imposter" });
  await wait(200);
  check(b.hub.phase === "game" && b.hub.gameId === "imposter", "Tout le monde passe sur Imposter");
  check(b.game?.phase === "setup", "Imposter démarre sur les réglages");

  // Réglages : 1 Undercover, pas de Mr White, 1 tour d'indices, sans minuteur.
  await a.act("settings", { settings: { mrWhiteEnabled: false, clueRounds: 1, timers: { enabled: false } } });
  await a.act("start");
  await wait(200);
  const bots = [a, b, c];
  check(bots.every((x) => x.role?.word), "Chacun a reçu son mot secret");
  check(b.game.phase === "clues", "Phase indices");

  // Une 4e personne ne peut pas entrer en pleine manche.
  const d = new Bot("Dan");
  await wait(200);
  const late = await d.emit("joinRoom", { code, pseudo: "Dan" });
  check(!!late.error, "Dan refusé en pleine manche : " + late.error);
  d.socket.close();

  // Reconnexion : Bob coupe et revient, il récupère son mot.
  const bobWord = b.role.word;
  b.socket.close();
  await wait(200);
  b.socket = io(URL, { transports: ["websocket"], forceNew: true });
  b.role = null;
  b.socket.on("hub", (h) => (b.hub = h));
  b.socket.on("game", ({ state }) => (b.game = state));
  b.socket.on("gameMsg", ({ type, payload }) => { if (type === "yourRole") b.role = payload; });
  await wait(300);
  const back = await b.emit("joinRoom", { code, playerId: b.id, pseudo: "Bob" });
  await wait(200);
  check(back.ok && b.role?.word === bobWord, "Bob se reconnecte et retrouve son mot");

  // Tout le monde donne un indice (dans l'ordre du serveur).
  for (let i = 0; i < 10 && a.game.phase === "clues"; i++) {
    const cur = bots.find((x) => x.id === a.game.round.currentPlayerId);
    if (!cur) { await wait(100); continue; }
    await cur.act("clue", { text: "indice" + i });
    await wait(100);
  }
  check(a.game.phase === "vote", "Passage au vote");

  // Tout le monde vote contre l'Undercover (lui vote contre quelqu'un d'autre).
  const under = bots.find((x) => x.role.word !== bots.find((y) => y !== x && y.role.word === x.role.word)?.role.word);
  for (const x of bots) {
    const target = x === under ? bots.find((y) => y !== x) : under;
    await x.act("vote", { targetId: target.id });
  }
  await wait(200);
  check(a.game.phase === "result" && a.game.round.result.eliminatedId === under.id, "L'Undercover est éliminé");
  await a.act("continue");
  await wait(200);
  check(a.game.phase === "gameOver" && a.game.round.outcome.winnerSide === "civils", "Les civils gagnent la manche");

  console.log("\n— Fin du jeu & podium —");
  await a.act("finish");
  await wait(200);
  check(a.hub.phase === "podium", "Podium affiché");
  const pts = Object.fromEntries(a.hub.players.map((p) => [p.pseudo, p.score]));
  console.log("     points de soirée :", pts);
  const civils = bots.filter((x) => x !== under);
  check(civils.every((x) => a.hub.players.find((p) => p.id === x.id).score === 10), "Les 2 civils ex æquo 1ers → 10 pts");
  check(a.hub.players.find((p) => p.id === under.id).score === 5, "L'Undercover 3e → 5 pts");
  a.send("closePodium");
  await wait(200);
  check(b.hub.phase === "lobby", "Retour au menu des jeux");

  console.log("\n— Expulsion —");
  a.send("kickPlayer", { playerId: c.id });
  await wait(200);
  check(a.hub.players.length === 2, "Chloé expulsée par l'hôte");

  bots.forEach((x) => x.socket.close());
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

// Garde-fou : si le test bloque quelque part, on arrête au bout de 20 s.
setTimeout(() => { console.log("\n❌ Test bloqué (20 s)"); process.exit(1); }, 20_000);
run().catch((e) => { console.error(e); process.exit(1); });
