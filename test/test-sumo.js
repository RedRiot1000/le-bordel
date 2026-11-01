// Test automatique : Sumo avec 1 humain + 2 bots (une manche Arène, une manche Îles).
// Lance le serveur AVANT (node server.js), puis : node test/test-sumo.js
import { io } from "socket.io-client";
import "../public/games/sumo/ground.js";

const G = globalThis.SumoGround;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

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

// On conduit tout droit, à fond (on finira bien par tomber !).
let seq = 0, driving = false;
async function drive() {
  driving = true;
  while (driving) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: 1 } }); await wait(33); }
}

async function run() {
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Pilote" });
  await emit("addBot"); await emit("addBot");
  await wait(150);
  check(hub.players.length === 3, "3 joueurs (dont 2 bots)");
  const picked = await emit("pickGame", { gameId: "sumo" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "Sumo lancé, écran de réglages");

  console.log("\n— Manche Arène —");
  await act("settings", { settings: { variant: "arena", shrink: "rapide", cards: "same" } });
  await act("start");
  await wait(200);
  check(game.map.kind === "arena" && game.mode === "ffa", "Arène, chacun pour soi (3 joueurs = impair)");
  check(game.cars.every((c) => G.onGround(game.map, c.x, c.y, game.arenaR)), "Toutes les voitures démarrent sur la plateforme");

  // Cartes de véhicules.
  check(game.phase === "pick" && game.cards[me]?.length === 3, "3 cartes de véhicules proposées : " + game.cards[me]?.join(", "));
  check(new Set(Object.values(game.cards).map((c) => c.join())).size === 1, "Les mêmes cartes pour tout le monde");
  const bad = await act("pick", { type: "pas-un-vehicule" });
  check(!!bad.error, "Une carte bidon est refusée");
  const allCards = game.cards;   // (les cartes ne sont plus envoyées après la phase de choix)
  const choice = allCards[me][1];
  await act("pick", { type: choice });
  check(await waitFor(() => game.phase === "countdown", 1500), "Tout le monde a choisi → compte à rebours sans attendre");
  check(game.cars.find((c) => c.id === me).type === choice, `Je conduis le véhicule choisi (${choice})`);
  check(game.cars.every((c) => allCards[c.id].includes(c.type)), "Les bots ont un véhicule parmi les cartes");
  await waitFor(() => game.phase === "play", 5000);
  check(await waitFor(() => game.power, 7000), "Un power-up 🎁 apparaît sur la map");
  check(G.onGround(game.map, game.power.x, game.power.y, game.arenaR), "Le power-up est sur le sol");
  const start = game.cars.find((c) => c.id === me);
  drive();
  await wait(700);
  const moved = game.cars.find((c) => c.id === me);
  check(Math.hypot(moved.x - start.x, moved.y - start.y) > 40, "Ma voiture avance");
  const fell = await waitFor(() => { const c = game.cars.find((x) => x.id === me); return !c.alive || c.falling; }, 8000);
  check(fell, "En fonçant tout droit, je finis par tomber dans le vide");
  driving = false;
  check(await waitFor(() => game.phase === "roundOver", 90000), "La manche se termine");
  const rows = game.lastRound.rows;
  check(rows.length === 3 && rows.every((r) => typeof r.points === "number"), "Points de manche : " + rows.map((r) => r.points).join(" / "));
  check(game.feed.length > 0 || rows.some((r) => r.ejections), "Le fil d'info annonce les chutes/éjections");

  console.log("\n— Manche Îles —");
  await act("setup");
  await act("settings", { settings: { variant: "islands", zoneTime: 10, cards: "different" } });
  await act("start");
  await wait(200);
  check(game.phase === "pick", "Phase des cartes (cette fois différentes pour chacun)");
  // Je ne choisis pas : au bout de 10 s, une de mes cartes est prise au hasard.
  const myCards = game.cards[me];
  check(await waitFor(() => game.phase === "countdown", 12000), "Sans choix, la manche part au bout de 10 s");
  check(myCards.includes(game.cars.find((c) => c.id === me).type), "J'ai reçu une de mes 3 cartes au hasard");
  check(game.map.kind === "islands" && game.map.islands.length >= 4 && game.map.corridors.length >= game.map.islands.length - 1,
    `Map d'îles : ${game.map.islands.length} îles, ${game.map.corridors.length} couloirs`);
  check(await waitFor(() => game.zone, 10000), "Une zone sûre s'allume");
  check(game.zone.left > 5000 && game.zone.left <= 10000, `Chrono de la zone : ${Math.round(game.zone.left / 1000)} s`);
  check(await waitFor(() => game.phase === "roundOver", 120000), "La manche des îles se termine");

  console.log("\n— Fin du jeu —");
  await act("finish");
  await wait(200);
  check(hub.phase === "podium", "Podium");

  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

setTimeout(() => { console.log("\n❌ Test bloqué (4 min)"); process.exit(1); }, 240_000);
run().catch((e) => { console.error(e); process.exit(1); });
