// Test automatique : la PAUSE des jeux de réflexion (3 joueurs humains).
// Lance le serveur AVANT (node server.js), puis : node test/test-pause.js
import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

// Un joueur = une connexion.
function client() {
  const c = { socket: io(URL, { transports: ["websocket"], forceNew: true }), hub: null, game: null };
  c.socket.on("hub", (h) => (c.hub = h));
  c.socket.on("game", ({ state }) => (c.game = state));
  c.emit = (ev, data = {}) => new Promise((res) => c.socket.emit(ev, data, res));
  c.act = (type, data = {}) => c.emit("gameAction", { type, data });
  return c;
}
async function waitFor(cond, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); }
  return false;
}

async function run() {
  const H = client(), J = client(), K = client();
  await wait(300);
  const { code } = await H.emit("createRoom", { pseudo: "Hôte" });
  await J.emit("joinRoom", { code, pseudo: "Jade" });
  await K.emit("joinRoom", { code, pseudo: "Karim" });
  await wait(200);

  // Un jeu d'action : pas de pause.
  await H.emit("pickGame", { gameId: "patate" });
  await wait(300);
  check(H.hub.phase === "game" && H.hub.pause === null, "Jeu d'action (Patate) : pas de pause");
  H.socket.emit("abortGame");
  await waitFor(() => H.hub.phase === "lobby", 3000);

  // Un jeu de réflexion : Sur 10.
  await H.emit("pickGame", { gameId: "sur10" });
  await wait(300);
  await H.act("start");
  await waitFor(() => H.game?.phase === "theme", 3000);
  check(!!H.hub.pause && H.hub.pause.active === false && H.hub.pause.needed === 2, "Sur 10 : pause possible, il faut 2 joueurs sur 3");

  // Jade demande la pause : 1/2, ça continue.
  J.socket.emit("pauseVote");
  await wait(300);
  check(H.hub.pause.votes.length === 1 && !H.hub.pause.active, "1 demande sur 2 : la partie continue");
  // Karim aussi : 2/2 → pause.
  K.socket.emit("pauseVote");
  await waitFor(() => H.hub.pause.active, 2000);
  check(H.hub.pause.active, "2 demandes sur 3 joueurs : PAUSE");
  const leftAtPause = H.game.left;
  await wait(2500);
  const blocked = await J.act("theme", { index: 0 });
  check(!!blocked.error && /pause/.test(blocked.error), "Pendant la pause, on ne peut pas jouer : " + blocked.error);
  check(H.game.phase === "theme", "Le chrono est arrêté (toujours au vote du thème)");

  // Jade annule : 1/2 → ça repart, avec le temps qu'il restait.
  J.socket.emit("pauseVote");
  await waitFor(() => !H.hub.pause.active, 2000);
  check(!H.hub.pause.active, "Moins de la moitié veut la pause : ça redémarre");
  check(Math.abs(H.game.left - leftAtPause) < 700, `Le chrono reprend où il en était (${Math.round(leftAtPause / 1000)} s → ${Math.round(H.game.left / 1000)} s)`);
  check((await J.act("theme", { index: 0 })).ok, "On peut rejouer");

  // L'hôte : pause et reprise immédiates.
  H.socket.emit("pauseHost");
  await waitFor(() => H.hub.pause.active, 2000);
  check(H.hub.pause.active && H.hub.pause.host, "L'hôte met en pause tout seul");
  J.socket.emit("pauseVote");   // (Jade ne peut pas relancer une pause de l'hôte)
  await wait(300);
  check(H.hub.pause.active, "Une pause de l'hôte reste active même si un joueur change d'avis");
  H.socket.emit("pauseHost");
  await waitFor(() => !H.hub.pause.active, 2000);
  check(!H.hub.pause.active && H.hub.pause.votes.length === 0, "L'hôte relance : la pause et toutes les demandes s'effacent");

  // Un joueur part pendant une pause : la moitié se recalcule.
  J.socket.emit("pauseVote");
  K.socket.emit("pauseVote");
  await waitFor(() => H.hub.pause.active, 2000);
  K.socket.close();
  await waitFor(() => H.hub.pause.needed === 1, 3000);
  check(H.hub.pause.needed === 1 && H.hub.pause.active, "Un joueur part : il ne faut plus qu'1 demande sur 2 (toujours en pause)");

  for (const c of [H, J]) c.socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 60000);
