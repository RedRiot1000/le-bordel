// Test automatique : tous les jeux à 8 joueurs (1 humain + 7 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-8joueurs.js
import { io } from "socket.io-client";
import { arenaMap, islandsMap } from "../games/sumo/maps.js";
import { spawnPoints } from "../games/patate/maps.js";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}
// Plus petite distance entre deux points de départ.
const minGap = (pts) => {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
  return m;
};

console.log("— Départs à 8 —");
{
  let worst = Infinity;
  for (let i = 0; i < 300; i++) worst = Math.min(worst, minGap(islandsMap(8).spawns));
  check(worst > 80, `Sumo îles : jamais deux voitures l'une sur l'autre (écart mini ${Math.round(worst)} px sur 300 maps)`);
  check(minGap(arenaMap(8).spawns) > 80, `Sumo arène : écart ${Math.round(minGap(arenaMap(8).spawns))} px`);
  check(minGap(spawnPoints(8, 1280, 800)) > 80, `Patate : écart ${Math.round(minGap(spawnPoints(8, 1280, 800)))} px`);
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

// Ce qu'on attend de chaque jeu une fois lancé à 8.
const GAMES = {
  imposter: () => game.phase !== "setup",
  patate: () => game.cars?.length === 8,
  sumo: () => game.phase !== "setup",
  cs2map: () => game.phase !== "setup",
  quidenous: () => game.who?.length === 8,
  neon: () => game.phase !== "setup",
  carfoot: () => game.teams?.blue.length === 4 && game.teams?.red.length === 4,
  sur10: () => game.who?.length === 8,
  classement: () => game.rounds === 8,
  chat: () => game.cars?.length === 8 && game.cars.filter((c) => c.role === "cat").length === 2,
  police: () => game.cars?.length === 8 && game.cars.every((c) => c.type === "f1"),
  pensepareil: () => game.who?.length === 8 && game.phase === "propose" && game.perPlayer === 1,
  deuxverites: () => game.who?.length === 8 && game.phase === "write",
  sol: () => game.heroes?.length === 8,
  territoire: () => game.heroes?.length === 8,
  neige: () => game.heroes?.length === 8 && game.teamsMode,
  lampe: () => game.heroes?.length === 8 && game.heroes.filter((h) => h.ghost).length === 1,
  colline: () => game.heroes?.length === 8,
  tueur: () => game.heroes?.length === 8 && game.heroes.filter((h) => h.killer).length === 1 && game.rounds === 8,
};

async function run() {
  console.log("— Salon —");
  await wait(300);
  await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 7; i++) await emit("addBot");
  await wait(200);
  check(hub.players.length === 8, "8 joueurs dans le salon");
  check(new Set(hub.players.map((p) => p.color)).size === 8, "8 couleurs différentes");
  const ninth = await emit("addBot");
  check(!!ninth?.error, "Le 9e est refusé : " + (ninth?.error || ""));

  console.log("— Chaque jeu à 8 —");
  for (const [id, ok] of Object.entries(GAMES)) {
    game = null;
    const r = await emit("pickGame", { gameId: id });
    await waitFor(() => game, 3000);
    await act("start");
    const started = await waitFor(() => game && ok(), 15000);
    // Voitures : personne ne démarre sur quelqu'un d'autre.
    let extra = "";
    const cars = game?.cars || game?.motos;
    if (Array.isArray(cars) && cars.length) extra = ` · écart mini au départ ${Math.round(minGap(cars))} px`;
    check(r.ok && started, `${id} se lance à 8${extra}`);
    await wait(1500);
    socket.emit("abortGame");
    await waitFor(() => hub.phase === "lobby", 5000);
  }

  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 240000);
