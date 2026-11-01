// Test automatique : « Devine la map » (1 humain + 1 bot), avec les images du manifest.
// Lance le serveur AVANT (node server.js), puis : node test/test-cs2map.js
// (il faut au moins quelques screenshots importés avec  npm run images)
import { io } from "socket.io-client";
import { readFileSync } from "fs";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const manifest = JSON.parse(readFileSync(new globalThis.URL("../games/cs2map/manifest.json", import.meta.url), "utf8"));
const truth = (img) => manifest.find((m) => img.endsWith(m.file))?.map;   // (le test triche : il lit la réponse sur le disque)

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

async function run() {
  if (!manifest.length) { console.log("Aucun screenshot importé : test impossible."); process.exit(1); }
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "cs2map" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Devine la map » se lance à 2 joueurs");
  check(game.imageCount === manifest.length, `${game.imageCount} screenshots, ${game.maps.length} maps : ${game.maps.map((m) => m.name).join(", ")}`);

  // Sécurité : la liste des réponses n'est pas accessible depuis le navigateur.
  const leak = await fetch(URL + "/games/cs2map/manifest.json").then((r) => r.status).catch(() => 0);
  check(leak === 404, "La liste des réponses n'est pas téléchargeable (404)");

  await act("settings", { settings: { images: 5, time: 15, zoom: 4 } });
  await act("start");
  await wait(200);
  check(game.phase === "question" && game.total === 5, "Série de 5 images, la première s'affiche");
  const img = await fetch(URL + "/" + game.q.img);
  check(img.ok && img.headers.get("content-type")?.includes("image"), "L'image se télécharge (" + game.q.img.split("/").pop() + ")");
  check(game.q.map === null && game.q.answers === null, "La bonne réponse n'est PAS envoyée pendant la question");
  check(game.q.zoom === 4 && game.q.fx >= 0.2 && game.q.fx <= 0.8, `Zoom ×4 sur le point (${game.q.fx.toFixed(2)}, ${game.q.fy.toFixed(2)})`);

  let correctCount = 0, scoresHidden = true;
  for (let i = 0; i < 5; i++) {
    await waitFor(() => game.phase === "question" && game.index === i, 8000);
    const right = truth(game.q.img);
    const t0 = Date.now();
    // Images paires : bonne réponse rapide ; impaires : mauvaise réponse.
    const wrong = game.maps.find((m) => m.id !== right).id;
    await wait(i % 2 ? 300 : 1500);
    const r = await act("answer", { map: i % 2 ? wrong : right });
    if (i === 0) {
      const again = await act("answer", { map: wrong });
      check(r.ok && !!again.error, "Une seule réponse par image (la 2e est refusée)");
      const mine = game.players.find((p) => p.id === me);
      if (game.phase === "question" && mine.score !== 0) scoresHidden = false;
    }
    await waitFor(() => game.phase === "reveal" || game.phase === "over", 16000);
    const a = game.q.answers?.[me];
    if (a?.correct) correctCount++;
    if (i === 0) {
      check(game.q.map === right && game.q.mapName, `Révélation : c'était ${game.q.mapName}`);
      check(a.correct && a.points >= 40 && a.points <= 100, `Bonne réponse en ${a.secs} s → ${a.points} points`);
    }
    if (i === 1) check(a && !a.correct && a.points === 0, "Mauvaise réponse → 0 point");
  }
  check(scoresHidden, "Les scores ne bougent pas avant la révélation (pas de triche possible)");
  check(await waitFor(() => game.phase === "over", 8000), "Fin de la série");
  check(game.history?.length === 5 && new Set(game.history.map((h) => h.img)).size === 5, "5 images différentes dans le récap");
  check(correctCount === 3, "3 bonnes réponses sur 5 comptées");

  await act("finish");
  await wait(200);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

setTimeout(() => { console.log("\n❌ Test bloqué (3 min)"); process.exit(1); }, 180_000);
run().catch((e) => { console.error(e); process.exit(1); });
