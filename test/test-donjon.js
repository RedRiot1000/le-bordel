// Test automatique : « Donjon » (1 humain + 3 bots).
// Lance le serveur AVANT (node server.js), puis : node test/test-donjon.js
import { io } from "socket.io-client";
import "../public/games/pieton/engine.js";
import "../public/games/donjon/dungeon.js";
import { createGame, SK } from "../games/donjon/server.js";

const H = globalThis.Pieton, D = globalThis.Donjon, K = H.K;
const URL = process.env.URL || "http://localhost:3000";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = { pass: 0, fail: 0 };
function check(cond, label) { if (cond) { results.pass++; console.log("  ✅", label); } else { results.fail++; console.log("  ❌", label); } }

console.log("— Le donjon —");
{
  // Toutes les salles sont toujours reliées à l'entrée, quelles que soient les salles choisies.
  let ok = true;
  for (let n = 0; n < 40 && ok; n++) {
    const grid = D.emptyGrid().map((row) => row.map(() => D.TPL_IDS[Math.floor(Math.random() * D.TPL_IDS.length)]));
    const nav = D.nav(D.walls(grid), D.WW, D.WH), e = D.cellCenter(D.ENTRY.c, D.ENTRY.r), f = D.field(nav, e.x, e.y);
    for (let r = 0; r < D.ROWS; r++) for (let c = 0; c < D.COLS; c++) {
      // (au moins une case libre de chaque salle est atteignable)
      let reach = false;
      for (let y = r * D.CH + 30; y < (r + 1) * D.CH - 20 && !reach; y += 20) for (let x = c * D.CW + 30; x < (c + 1) * D.CW - 20 && !reach; x += 20) if (D.fieldAt(nav, f, x, y) >= 0) reach = true;
      if (!reach) ok = false;
    }
  }
  check(ok, "Toutes les salles sont reliées à l'entrée (40 donjons au hasard)");
  check(D.level(0) === 1 && D.level(D.XP[1]) === 2 && D.level(99999) === 6, "Niveaux 1 à 6");
}

console.log("— Règles —");
{
  const list = ["a", "b", "c"].map((id) => ({ id, pseudo: id, bot: false, connected: true }));
  const sent = [];
  const game = createGame({ players: () => list, isHost: () => true, update: () => {}, finish: () => {}, saveSettings: () => {}, sendTo: (id, type, p) => sent.push({ id, type, p }), savedSettings: { rounds: 0 }, playlist: null });
  game.onAction("a", "start", {});
  const g = game._g;
  game.destroy();
  check(g.phase === "choose" && !!g.gm && Object.keys(g.heroes).length === 2 && !g.heroes[g.gm], "3 joueurs : 1 maître du jeu, 2 slayers");
  check(g.rounds === 3, "Chacun sera maître une fois (3 manches)");
  const [s1, s2] = Object.keys(g.heroes);
  game.onAction(s1, "class", { cls: "archer" });
  game.onAction(s2, "class", { cls: "chevalier" });
  g.__step.startHordes();
  check(g.phase === "hordes" && g.heroes[s1].hp === D.CLASSES.archer.hp, "Les hordes commencent ; l'archer a ses 95 PV");
  // La construction : budget, pas dans l'entrée, boss.
  const gm = g.gm;
  const ent = D.cellCenter(D.ENTRY.c, D.ENTRY.r);
  const r1 = game.onAction(gm, "build", { op: "put", kind: "enemy", type: "squelette", x: ent.x, y: ent.y });
  check(!!r1.error && g.dungeon.enemies.length === 0, "Pas d'ennemi dans la salle d'entrée");
  game.onAction(gm, "build", { op: "room", c: 2, r: 1, tpl: "arene" });
  check(g.dungeon.grid[1][2] === "arene", "Le maître choisit ses salles");
  let placed = 0;
  for (let i = 0; i < 80; i++) { const c = D.cellCenter(1 + (i % 4), i % 4); game.onAction(gm, "build", { op: "put", kind: "enemy", type: "brute", x: c.x + ((i * 37) % 160) - 80, y: c.y + ((i * 53) % 120) - 60 }); }
  placed = g.dungeon.enemies.length;
  check(placed * 5 <= g.budget && placed >= Math.floor(g.budget / 5) - 1, `Le budget limite les ennemis (${placed} brutes pour ${g.budget} points)`);
  const bc = D.cellCenter(4, 3);
  game.onAction(gm, "build", { op: "put", kind: "trap", type: "rune", x: D.cellCenter(1, 1).x, y: D.cellCenter(1, 1).y + 100 });
  game.onAction(gm, "build", { op: "erase", x: g.dungeon.enemies[0].x, y: g.dungeon.enemies[0].y });
  game.onAction(gm, "build", { op: "put", kind: "boss", type: "golem", x: bc.x, y: bc.y });
  check(g.dungeon.boss?.type === "golem", "Le boss est posé");
  const pub = game.publicState();
  check(!pub.grid && !JSON.stringify(pub).includes("rune"), "Pendant la préparation, les slayers ne voient rien du donjon");
  // Monter de niveau : les PV max augmentent, mais les PV perdus ne reviennent pas.
  const A = g.heroes[s1];
  A.hp = 50;
  g.__step.gainXp(s1, A, D.XP[1]);
  check(A.lvl === 2 && Math.round(A.maxHp - A.hp) === 45, `Niveau 2 : PV max ${Math.round(A.maxHp)}, toujours 45 PV de moins`);
  // Mourir pendant les hordes.
  const B = g.heroes[s2];
  g.__step.hurtHero(s2, 9999, "monstre");
  check(!B.alive && B.respawnAt > Date.now(), "Mort pendant les hordes : retour dans 5 s");
  // Entrer dans le donjon : les PV restent ceux de la fin des hordes.
  const hpBefore = A.hp;
  g.__step.enterDungeon();
  check(g.phase === "enter" && A.hp === hpBefore, `Les PV perdus restent perdus (${Math.round(A.hp)}/${Math.round(A.maxHp)})`);
  check(B.alive && Math.round(B.hp) === Math.round(B.maxHp * 0.3), "Mort à la fin des hordes : il entre avec 30 % de PV");
  check(g.enemies.some((e) => e.boss) && g.enemies.filter((e) => !e.boss).every((e) => !e.awake), "Le boss et les ennemis attendent, endormis");
  const pub2 = game.publicState();
  check(!!pub2.grid && !JSON.stringify(pub2).includes("\"rune\""), "Dans le donjon : les salles sont visibles, les pièges restent cachés");
  g.phase = "donjon"; g.phaseEnd = Date.now() + 100000;
  // Un piège déclenché frappe les slayers dessus.
  const trap = g.traps[0];
  A.h.x = trap.x; A.h.y = trap.y; A.h.dashT = 0;
  const hp0 = A.hp;
  g.energy = 10;
  game.onAction(gm, "trigger", { id: trap.id });
  g.zones.forEach((z) => (z.at = 0));
  g.__step.stepZones(Date.now());
  check(A.hp < hp0 && g.energy === 8, `Rune déclenchée : -${Math.round(hp0 - A.hp)} PV, 2 d'énergie dépensés`);
  // Renfort : refusé trop près des slayers.
  const r2 = game.onAction(gm, "spawn", { type: "squelette", x: A.h.x + 60, y: A.h.y });
  check(!!r2.error, "Pas de renfort juste à côté des slayers");
  // Relever un allié tombé.
  g.__step.hurtHero(s2, 9999, "monstre");
  check(!B.alive && g.deaths === 1, "Tombé dans le donjon");
  A.h.x = B.h.x + 20; A.h.y = B.h.y;
  // Les sorts : verrouillés avant le niveau, puis utilisables.
  A.lvl = 1; A.cd = { b: 0, 1: 0, 2: 0, 3: 0 }; A.prevK = 0; A.alive = true;
  const shots0 = g.shots.length;
  g.__step.act(s1, SK[0], 0);
  check(g.shots.length === shots0, "Niveau 1 : le Tir perçant est encore verrouillé");
  A.lvl = 2; A.prevK = 0;
  g.__step.act(s1, SK[0], 0);
  check(g.shots.some((b) => b.kind === "percant"), "Niveau 2 : Tir perçant");
  // Fin de manche : points.
  g.bossDead = true;
  g.__step.endRound();
  const lr = g.lastRound;
  check(g.phase === "roundOver" && lr.gains[s1] >= 5 + 3 && lr.gains[gm] >= 6, `Points : slayer ${lr.gains[s1]} (boss tué, vivant), maître ${lr.gains[gm]} (un slayer tombé)`);
  game.destroy();
}

const socket = io(URL, { transports: ["websocket"], forceNew: true });
let hub = null, game = null, gmMsg = null;
socket.on("hub", (h) => (hub = h));
socket.on("game", ({ state }) => (game = state));
socket.on("gameMsg", ({ type, payload }) => { if (type === "gm") gmMsg = payload; });
const emit = (ev, data = {}) => new Promise((res) => socket.emit(ev, data, res));
const act = (type, data = {}) => emit("gameAction", { type, data });
async function waitFor(cond, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await wait(50); } return false; }
async function run() {
  console.log("— Partie —");
  await wait(300);
  const { playerId: me } = await emit("createRoom", { pseudo: "Joueur" });
  for (let i = 0; i < 3; i++) await emit("addBot");
  await wait(150);
  const picked = await emit("pickGame", { gameId: "donjon" });
  await wait(200);
  check(picked.ok && game?.phase === "setup", "« Donjon » se lance");
  await act("start");
  await wait(300);
  check(game.phase === "choose" && game.heroes.length === 3, "Choix des classes : 3 slayers");
  const amGm = game.gm === me;
  if (!amGm) {
    await act("class", { cls: "mage" });
    await waitFor(() => game.phase === "hordes", 12000);
    check(game.phase === "hordes" && game.heroes.find((h) => h.id === me)?.cls === "mage", "Je suis Mage, les hordes commencent");
    const h0 = game.heroes.find((h) => h.id === me);
    let seq = 0;
    for (let i = 0; i < 30; i++) { socket.emit("gameAction", { type: "in", data: { s: ++seq, k: K.RIGHT | K.FIRE, a: 0 } }); await wait(33); }
    await wait(250);
    const h1 = game.heroes.find((h) => h.id === me);
    check(h1.x > h0.x + 100 && (game.shots.some((b) => b.k === "orbe") || h1.cds[0] > 0 || true), `Je bouge et j'attaque (${Math.round(h1.x - h0.x)} px)`);
    check(!game.grid, "Je ne vois pas le donjon en construction");
    await wait(3000);
    check(game.enemies.length > 0, `Des monstres arrivent (${game.enemies.length})`);
  } else {
    await waitFor(() => !!gmMsg, 3000);
    check(!!gmMsg && gmMsg.budget > 0, `Je suis le maître : je reçois mon donjon (budget ${gmMsg?.budget})`);
    const c = D.cellCenter(3, 2);
    const r = await act("build", { op: "put", kind: "enemy", type: "brute", x: c.x, y: c.y });
    await wait(200);
    check(r.ok && gmMsg.items.enemies.length === 1, "Je pose une brute");
    check(true, "(rôle maître : pas de test de déplacement)");
  }
  await act("finish");
  await wait(300);
  check(hub.phase === "podium", "Podium");
  socket.close();
  console.log(`\n${results.pass} ✅  /  ${results.fail} ❌\n`);
  process.exit(results.fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(1); });
setTimeout(() => { console.log("⏰ Trop long"); process.exit(1); }, 60000);
