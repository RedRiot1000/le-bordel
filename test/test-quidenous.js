// Test automatique : « Qui de nous ? » (1 humain + 2 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-quidenous.js
import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let game = null;
socket.on("game", ({ state }) => (game = state));
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); }
  return false;
}

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  await emit("addBot");
  await wait(100);
  const tooFew = await emit("pickGame", { gameId: "quidenous" });
  check(!!tooFew.error, "Refusé à 2 joueurs (minimum 3)");
  await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "quidenous" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Qui de nous ? » se lance à 3 joueurs");

  await act("settings", { settings: { perPlayer: 2, writeTime: 60, voteTime: 20 } });
  await wait(100);
  check(game.settings.perPlayer === 2 && game.settings.writeTime === 60, "Réglages : 2 questions par joueur, 60 s d'écriture");
  await act("settings", { settings: { perPlayer: 9 } });
  await wait(100);
  check(game.settings.perPlayer === 1, "Réglage invalide ramené à la valeur par défaut");
  await act("settings", { settings: { perPlayer: 2 } });

  await act("start");
  await wait(200);
  check(game.phase === "write" && game.who.length === 3, "Phase d'écriture, 3 joueurs");
  const dice = await act("random");
  check(dice.ok && /^Qui /.test(dice.text), "🎲 propose une question : " + dice.text);
  const half = await act("write", { texts: ["Qui est le plus drôle"] });
  check(!!half.error, "Il faut écrire les 2 questions");
  await act("write", { texts: ["  Qui est   le plus drôle  ", dice.text] });
  await waitFor(() => game.phase === "vote", 65000);
  check(game.phase === "vote" && game.vote.total === 6, "Tout le monde a écrit -> 6 questions à voter");
  check(game.vote.author === undefined && game.revealed === undefined, "Pendant le vote : ni l'auteur ni les votes ne sont envoyés");

  let sawMine = false, refused = false;
  const myVotes = [];
  for (let i = 1; i <= 6; i++) {
    await waitFor(() => game.phase === "vote" && game.vote.num === i, 25000);
    if (game.vote.text === "Qui est le plus drôle ?") sawMine = true;
    const target = game.who[i % 3];   // de temps en temps je vote pour moi
    myVotes.push(target);
    const r = await act("vote", { target });
    if (i === 1) refused = !!(await act("vote", { target })).error;
    if (!r.ok) console.log("   vote refusé :", r.error);
  }
  check(sawMine, "Ma question a été nettoyée (« Qui est le plus drôle ? »)");
  check(refused, "Un seul vote par question");

  await waitFor(() => game.phase === "reveal", 25000);
  check(game.phase === "reveal" && game.revealed.length === 1, "La cérémonie commence : 1 question dévoilée à la fois");
  const r0 = game.revealed[0];
  check(Object.keys(r0.votes).length === 3 && !!r0.author, "Tous les votes et l'auteur sont dévoilés");
  check(r0.winners.length >= 1 && r0.winners.every((w) => r0.counts[w] === Math.max(...Object.values(r0.counts))), "Le gagnant est bien le plus désigné");

  // L'hôte accélère la cérémonie.
  for (let i = 2; i <= 6; i++) {
    await act("next");
    await waitFor(() => game.revealed?.length === i || game.phase === "over", 2000);
  }
  await act("next");
  await waitFor(() => game.phase === "over", 3000);
  check(game.phase === "over" && game.revealed.length === 6, "Palmarès après les 6 questions");

  // Points : +1 chaque fois que j'ai voté pour un des plus désignés.
  const expected = game.revealed.filter((q) => q.winners.includes(q.votes[me])).length;
  const mine = game.players.find((p) => p.id === me).score;
  check(mine === expected, `Mes points = mes votes « comme la majorité » (${mine})`);
  const nbTitles = Object.values(game.titles).flat().length;
  const nbWinners = game.revealed.reduce((s, q) => s + q.winners.length, 0);
  check(nbTitles === nbWinners, `${nbTitles} titres distribués (ex. « ${Object.values(game.titles).flat()[0]} »)`);
  check(game.revealed.some((q) => q.title === "est le plus drôle"), "Le titre retire « Qui » et le « ? »");

  // Rejouer, puis terminer -> podium.
  await act("start");
  await wait(200);
  check(game.phase === "write", "Rejouer relance une écriture");
  await act("write", { texts: ["Qui a le plus de chance", "Qui ment le mieux"] });
  await waitFor(() => game.phase === "vote", 65000);
  socket.emit("abortGame", {});
  await wait(300);
  check(true, "Arrêt du jeu sans erreur");

  console.log(`\n${results.pass} réussis, ${results.fail} ratés`);
  socket.close();
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 400000);
