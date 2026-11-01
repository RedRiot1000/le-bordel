// Test automatique : « Sur 10 » (1 humain + 2 bots, 2 manches).
// Lance le serveur AVANT (node server.js), puis : node test/test-sur10.js
import { io } from "socket.io-client";
import { pointsFor } from "../games/sur10/server.js";
import { THEMES } from "../games/sur10/themes.js";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Règles —");
check(pointsFor(0) === 3 && pointsFor(1) === 2 && pointsFor(2) === 1 && pointsFor(3) === 0, "Points : pile 3, à 1 près 2, à 2 près 1, sinon 0");
check(THEMES.length >= 50 && THEMES.every((t) => t.examples.length >= 4 && t.examples.every((e) => e.note >= 0 && e.note <= 10 && e.text)), `${THEMES.length} thèmes, tous avec des exemples notés 0-10`);

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
  await wait(100);
  const tooFew = await emit("pickGame", { gameId: "sur10" });
  check(!!tooFew.error, "Refusé à 2 joueurs (minimum 3)");
  await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "sur10" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Sur 10 » se lance à 3 joueurs");
  check(game.settings.rounds === 3 && game.settings.writeTime === 60 && game.settings.guessTime === 20, "Par défaut : 3 manches, 60 s, 20 s");
  await act("settings", { settings: { rounds: 7 } });
  await wait(100);
  check(game.settings.rounds === 3, "Réglage invalide ramené à la valeur par défaut");
  await act("settings", { settings: { rounds: 2, guessTime: 15 } });

  await act("start");
  await wait(200);
  check(game.phase === "theme" && game.themeVote.choices.length === 3 && game.round === 1, "Manche 1 : vote entre 3 thèmes");
  const choices = game.themeVote.choices.map((c) => c.title);
  check(!!(await act("theme", { index: 5 })).error, "Thème inexistant refusé");
  await act("theme", { index: 0 });
  await act("theme", { index: 2 });   // je change d'avis
  await wait(100);
  check(game.phase !== "theme" || game.themeVote.votes[me] === 2, "On peut changer son vote");
  await waitFor(() => game.phase === "write", 17000);
  check(game.phase === "write" && choices.includes(game.theme.title), `Thème choisi : « ${game.theme.title} »`);

  check(!!(await act("write", { clue: "Raclette" })).error, "Sans note : refusé");
  check(!!(await act("write", { note: 11, clue: "Raclette" })).error, "Note 11 : refusée");
  check(!!(await act("write", { note: 7, clue: "   " })).error, "Indice vide : refusé");
  const w = await act("write", { note: 7, clue: "  Ma   super   réponse  " });
  check(w.ok, "Note 7 + indice envoyés");

  await waitFor(() => game.phase === "guess", 15000);
  check(game.phase === "guess" && game.turn.total === 3, "Phase « on devine » : 3 joueurs à deviner");
  check(game.turn.note === undefined && !JSON.stringify(game).includes('"note":'), "La note n'est jamais envoyée avant la révélation");

  let sawMine = false, refusedSelf = false, refusedTwice = false, refusedBad = false, gainsOk = true;
  for (let num = 1; num <= 3; num++) {
    await waitFor(() => game.phase === "guess" && game.turn.num === num, 20000);
    const t = game.turn;
    if (t.id === me) {
      sawMine = t.clue === "Ma super réponse";
      refusedSelf = !!(await act("guess", { value: 5 })).error;
    } else {
      refusedBad = !!(await act("guess", { value: 12 })).error;
      await act("guess", { value: 5 });
      refusedTwice = !!(await act("guess", { value: 6 })).error;
    }
    await waitFor(() => game.phase === "reveal" && game.turn.num === num, 20000);
    const r = game.turn;
    if (r.id === me && r.note !== 7) gainsOk = false;
    // Les points de chaque devineur et de l'auteur.
    let close = 0;
    for (const [id, v] of Object.entries(r.guesses)) {
      const d = Math.abs(v - r.note);
      if (r.gains[id] !== pointsFor(d)) gainsOk = false;
      if (d <= 1) close++;
    }
    if (r.gains[r.id] !== close) gainsOk = false;
    if (Object.keys(r.guesses).length !== 2) gainsOk = false;
    await act("next");   // l'hôte passe
  }
  check(sawMine, "Mon indice a été nettoyé (« Ma super réponse »)");
  check(refusedSelf, "Je ne peux pas deviner ma propre note");
  check(refusedBad && refusedTwice, "Une seule devinette valide (0-10) par joueur");
  check(gainsOk, "Révélation : ma note (7), les devinettes et les points sont justes");

  await waitFor(() => game.phase === "theme", 5000);
  check(game.phase === "theme" && game.round === 2 && !game.themeVote.choices.some((c) => c.title === game.history?.[0]?.theme), "Manche 2 : nouveau vote de thème");
  // Je ne fais rien cette manche : on avance quand même.
  await waitFor(() => game.phase === "write", 17000);
  const theme2 = game.theme.title;
  await act("write", { note: 0, clue: "Un truc nul" });
  for (let num = 1; num <= 3; num++) {
    await waitFor(() => game.phase === "reveal" && game.turn.num === num, 30000);   // (écriture des bots + 15 s)
    await act("next");
  }
  await waitFor(() => game.phase === "over", 5000);
  if (game.phase !== "over") console.log("   phase:", game.phase, "manche", game.round, game.turn);
  check(game.phase === "over" && game.history.length === 6, "Fin après 2 manches : 6 indices au récap");
  check(game.history[0].theme !== theme2, "Pas deux fois le même thème");
  const total = {};
  for (const h of game.history) for (const [id, n] of Object.entries(h.gains)) total[id] = (total[id] || 0) + n;
  check(game.players.every((p) => (total[p.id] || 0) === p.score), "Scores = somme des points gagnés");

  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 200000);
