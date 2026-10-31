// Test automatique : une manche de Patate chaude à 3 faux joueurs.
// Lance le serveur AVANT (node server.js), puis : node test/test-patate.js
import { io } from "socket.io-client";

const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const results = { pass: 0, fail: 0 };
function check(cond, label) {
  if (cond) { results.pass++; console.log("  ✅", label); }
  else { results.fail++; console.log("  ❌", label); }
}

// Un faux joueur : s'il a la bombe, il fonce sur le plus proche.
class Bot {
  constructor(pseudo) {
    this.pseudo = pseudo;
    this.socket = io(URL, { transports: ["websocket"], forceNew: true });
    this.hub = null;
    this.game = null;
    this.keys = "";
    this.socket.on("hub", (h) => (this.hub = h));
    this.socket.on("game", ({ state }) => { this.game = state; this.think(); });
  }
  emit(ev, data) { return new Promise((res) => this.socket.emit(ev, data, res)); }
  act(type, data = {}) { return this.emit("gameAction", { type, data }); }

  think() {
    const s = this.game;
    if (s.phase !== "play") return;
    const meB = s.bodies.find((b) => b.id === this.id);
    let k = { u: false, d: false, l: false, r: false };
    if (meB?.alive && s.holderId === this.id) {
      const others = s.bodies.filter((b) => b.alive && b.id !== this.id);
      const t = others.sort((a, b) => Math.hypot(a.x - meB.x, a.y - meB.y) - Math.hypot(b.x - meB.x, b.y - meB.y))[0];
      if (t) k = { u: t.y < meB.y - 4, d: t.y > meB.y + 4, l: t.x < meB.x - 4, r: t.x > meB.x + 4 };
    }
    const sig = JSON.stringify(k);
    if (sig !== this.keys) { this.keys = sig; this.socket.emit("gameAction", { type: "input", data: k }); }
  }
}

async function run() {
  const bots = [new Bot("Alice"), new Bot("Bob"), new Bot("Chloé")];
  const [a, b, c] = bots;
  await wait(300);
  const created = await a.emit("createRoom", { pseudo: "Alice" });
  a.id = created.playerId;
  b.id = (await b.emit("joinRoom", { code: created.code, pseudo: "Bob" })).playerId;
  c.id = (await c.emit("joinRoom", { code: created.code, pseudo: "Chloé" })).playerId;

  console.log("\n— Patate chaude —");
  const picked = await a.emit("pickGame", { gameId: "patate" });
  await wait(200);
  check(picked.ok && b.game?.phase === "setup", "Patate chaude lancée, écran de réglages");

  await a.act("settings", { settings: { fuse: "test", obstacles: false } });
  const started = await a.act("start");
  await wait(200);
  check(started.ok && a.game.phase === "countdown", "Compte à rebours de début de manche");
  check(a.game.bodies.length === 3 && !!a.game.holderId, "3 joueurs dans l'arène, quelqu'un a la bombe");

  // Le joueur qui n'a PAS la bombe essaie de bouger pendant le jeu.
  const firstHolder = a.game.holderId;
  let passes = 0, booms = 0, lastHolder = firstHolder, lastBoom = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 25000 && a.game.phase !== "roundOver") {
    await wait(50);
    const s = a.game;
    if (s.holderId && s.holderId !== lastHolder && s.phase === "play") passes++;
    if (s.holderId) lastHolder = s.holderId;
    if (s.lastBoom && s.lastBoom !== lastBoom && JSON.stringify(s.lastBoom) !== JSON.stringify(lastBoom)) { booms++; lastBoom = s.lastBoom; }
  }
  check(passes >= 1, `La bombe a changé de main (${passes} passe(s))`);
  check(booms === 2, `2 explosions (${booms})`);
  check(a.game.phase === "roundOver", "Fin de manche");
  const pts = a.game.lastRound?.map((r) => r.points).sort();
  check(JSON.stringify(pts) === "[0,1,2]", "Points de manche 2 / 1 / 0 : " + JSON.stringify(a.game.lastRound?.map((r) => [r.place, r.points])));

  console.log("\n— Fin du jeu —");
  await a.act("finish");
  await wait(200);
  const scores = a.hub.players.map((p) => p.score).sort((x, y) => y - x);
  check(a.hub.phase === "podium" && JSON.stringify(scores) === "[10,7,5]", "Podium : 10 / 7 / 5 points de soirée");

  bots.forEach((x) => x.socket.close());
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}

setTimeout(() => { console.log("\n❌ Test bloqué (40 s)"); process.exit(1); }, 40_000);
run().catch((e) => { console.error(e); process.exit(1); });
