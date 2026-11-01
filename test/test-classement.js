// Test automatique : « Classement » (1 humain + 2 bots, chacun juge 1 fois).
// Lance le serveur AVANT (node server.js), puis : node test/test-classement.js
import { io } from "socket.io-client";
import { scoreOf, endsOf } from "../games/classement/server.js";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

console.log("— Règles —");
check(scoreOf([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]) === 10, "Classement parfait = 10 pts");
check(scoreOf([1, 0, 2, 3, 4], [0, 1, 2, 3, 4]) === 8, "Deux choses inversées = 8 pts");
check(scoreOf([4, 3, 2, 1, 0], [0, 1, 2, 3, 4]) === 2, "Tout à l'envers = 2 pts (le milieu est bon)");
const e = endsOf("0 = inoffensif · 10 = mortel");
check(e.top === "mortel" && e.bottom === "inoffensif" && endsOf(null).top === "génial", "Échelle lue : 1er = mortel, 5e = inoffensif");

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
  const picked = await emit("pickGame", { gameId: "classement" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Classement » se lance à 3 joueurs");
  check(game.settings.laps === 1 && game.settings.rankTime === 45, "Par défaut : chacun juge 1 fois, 45 s");
  await act("settings", { settings: { rankTime: 30 } });
  await act("start");
  await wait(200);
  check(game.phase === "pick" && game.rounds === 3 && game.choices.length === 3, "3 manches (1 juge chacune), 3 thèmes proposés");

  let judged = false, refusedPick = false, refusedBad = false, scoresOk = true, noLeak = true, sawRank = 0;
  for (let round = 1; round <= 3; round++) {
    await waitFor(() => game.round === round && game.phase === "pick", 20000);
    if (game.judge === me) {
      judged = true;
      await act("theme", { index: 1 });
    } else {
      refusedPick = !!(await act("theme", { index: 0 })).error;
    }
    await waitFor(() => game.phase === "rank" && game.round === round, 10000);
    sawRank++;
    if (game.ranks !== undefined) noLeak = false;
    refusedBad = !!(await act("rank", { list: [0, 0, 1, 2, 3] })).error;
    await act("rank", { list: [4, 3, 2, 1, 0] });
    await act("rank", { list: [0, 1, 2, 3, 4] });   // on peut corriger
    await waitFor(() => game.phase === "reveal" && game.round === round, 35000);
    const truth = game.ranks?.[game.judge];
    if (truth) {
      if (game.ranks[me].join() !== "0,1,2,3,4") scoresOk = false;
      const others = Object.keys(game.ranks).filter((id) => id !== game.judge);
      for (const id of others) if (game.gains[id] !== scoreOf(game.ranks[id], truth)) scoresOk = false;
      const avg = Math.round(others.reduce((s, id) => s + game.gains[id], 0) / others.length);
      if (game.gains[game.judge] !== avg) scoresOk = false;
    }
    await act("next");
  }
  check(sawRank === 3, "Chaque manche : tout le monde classe");
  check(judged, "J'ai été juge une fois et j'ai choisi le thème");
  check(refusedPick, "Seul le juge choisit le thème");
  check(refusedBad, "Un classement avec deux fois la même chose est refusé");
  check(noLeak, "Aucun classement n'est envoyé avant la révélation");
  check(scoresOk, "Révélation : ma correction gardée, points des devineurs et du juge justes");

  await waitFor(() => game.phase === "over", 5000);
  check(game.phase === "over" && game.history.length === 3, "Fin : 3 manches au récap");
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
