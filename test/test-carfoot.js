// Test automatique : Car-foot (1 humain + 3 bots = 2 contre 2), un match de 2 min.
// Lance le serveur AVANT (node server.js), puis : node test/test-carfoot.js
import { io } from "socket.io-client";
import "../public/games/patate/physics.js";
import "../public/games/carfoot/ball.js";

const P = globalThis.PatatePhysics, B = globalThis.CarFootBall, K = P.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

// --- Physique du ballon (sans serveur) ---
console.log("— Ballon —");
{
  const ball = { x: 600, y: 450, vx: 0, vy: 0 };
  const car = { ...P.newCar(540, 450, 0), vx: 400 };
  let touched = false;
  for (let i = 0; i < 30; i++) { car.x += car.vx / 90; if (B.hitCar(ball, car)) touched = true; B.move(ball, 1 / 90); }
  check(touched && ball.vx > 400, `Une voiture à 400 px/s frappe le ballon : il part à ${ball.vx.toFixed(0)} px/s`);
  const slow = { x: 800, y: 450, vx: 500, vy: 0 };
  for (let i = 0; i < 90; i++) B.move(slow, 1 / 90);
  check(slow.vx < 500 && slow.vx > 250, `Il ralentit tout seul (${slow.vx.toFixed(0)} px/s après 1 s)`);
  const wall = { x: 700, y: 30, vx: 0, vy: -400 };
  for (let i = 0; i < 20; i++) B.move(wall, 1 / 90);
  check(wall.vy > 200, "Il rebondit sur les murs");
  check(B.goal({ x: B.GD - B.R - 1, y: B.H / 2 }) === "left" && B.goal({ x: B.GD + 5, y: B.H / 2 }) === null, "But seulement quand le ballon a entièrement passé la ligne");
  check(B.goal({ x: 10, y: 100 }) === null, "Pas de but à côté de la cage");
}

// --- Match en ligne ---
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
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "carfoot" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Car-foot » se lance");
  check(game.settings.duration === 3 && game.settings.golden, "Par défaut : 3 min, but en or");
  await act("settings", { settings: { duration: 2 } });
  await act("start");
  await wait(200);
  check(game.phase === "kickoff" && game.teams.blue.length === 2 && game.teams.red.length === 2, "2 contre 2, remise en jeu");
  const myTeam = game.players.find((p) => p.id === me).team;
  const mine0 = game.cars.find((c) => c.id === me);
  check(myTeam === "blue" ? mine0.x < B.W / 2 : mine0.x > B.W / 2, `Je suis chez les ${myTeam === "blue" ? "Bleus (à gauche)" : "Rouges (à droite)"}`);
  check(Math.hypot(game.ball.x - B.W / 2, game.ball.y - B.H / 2) < 1, "Ballon au centre");
  // Figé pendant le compte à rebours.
  socket.emit("gameAction", { type: "in", data: { s: 1, k: K.UP } });
  await wait(300);
  const still = game.cars.find((c) => c.id === me);
  check(Math.hypot(still.x - mine0.x, still.y - mine0.y) < 1, "Personne ne bouge pendant le compte à rebours");

  await waitFor(() => game.phase === "play", 5000);
  // Je fonce vers le ballon (ma voiture est tournée vers le centre).
  let seq = 1, touchedBall = false;
  for (let i = 0; i < 90; i++) {
    socket.emit("gameAction", { type: "in", data: { s: ++seq, k: K.UP } });
    await wait(33);
    if (Math.hypot(game.ball.vx, game.ball.vy) > 50) touchedBall = true;
  }
  check(touchedBall, "Le ballon a été frappé");
  const c0 = game.clockLeft;
  await wait(2000);
  check(game.clockLeft < c0 || game.phase !== "play", `Le chrono tourne (${Math.ceil(game.clockLeft / 1000)} s restantes)`);

  // On laisse les bots jouer jusqu'à la fin du match.
  let sawGoal = false, sawKickoffAfterGoal = false;
  const end = await waitFor(() => {
    if (game.phase === "goal") sawGoal = true;
    if (sawGoal && game.phase === "kickoff") sawKickoffAfterGoal = true;
    return game.phase === "over";
  }, 260000);
  check(end, "Fin du match");
  const total = game.score.blue + game.score.red;
  check(game.goals.length === total, `Score ${game.score.blue} – ${game.score.red}, ${total} but(s) enregistré(s)`);
  if (total) check(sawGoal && (sawKickoffAfterGoal || game.overtime || game.phase === "over"), "Après un but : célébration puis remise en jeu");
  check(game.result === (game.score.blue > game.score.red ? "blue" : game.score.red > game.score.blue ? "red" : "draw"), `Résultat : ${game.result}`);
  const scorers = Object.values(game.stats).reduce((s, x) => s + x.goals + x.own, 0);
  check(scorers <= total, "Les buteurs sont comptés");

  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium (équipe gagnante devant)");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 330000);
