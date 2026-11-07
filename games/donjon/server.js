// ===================================================================
//  DONJON — Moteur du jeu (module du hub Le Bordel)
//  À chaque manche, un joueur est le MAÎTRE DU JEU (chacun son tour) ;
//  les autres sont les SLAYERS.
//   1) Choix des classes (10 s).
//   2) Préparation (2 min) : le maître construit son donjon (salles,
//      ennemis, pièges, boss) pendant que les slayers combattent des
//      hordes pour monter de niveau. Les PV perdus restent perdus !
//   3) Le donjon (3 min max) : les slayers le traversent jusqu'au boss.
//      Le maître déclenche ses pièges, lâche des renforts, et peut
//      prendre le contrôle du boss.
//  Le SERVEUR fait foi (30 calculs/s). Les slayers se déplacent avec le
//  moteur « bonhomme » (prédiction sans retard côté navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/donjon/dungeon.js";

const H = globalThis.Pieton;
const D = globalThis.Donjon;
const K = H.K;
export const SK = [64, 128, 256];      // touches des sorts 1, 2, 3
export const ALT = 64;                // le maître qui contrôle le boss : clic droit = attaque spéciale

export const meta = {
  id: "donjon",
  name: "Donjon",
  emoji: "🐉",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Un maître du jeu construit son donjon, les slayers montent de niveau puis le traversent. Chacun son tour au donjon !",
};

const TICK_MS = 1000 / 30;
export const CHOOSE_MS = 10000, HORDE_MS = 120000, ENTER_MS = 4000, DUNGEON_MS = 180000;
const ROUND_OVER_MS = 12000, FINISH_DELAY = 15000, END_DELAY = 2500;
export const RESPAWN_MS = 5000, RESPAWN_HP = 0.3, REVIVE_MS = 3000, REVIVE_HP = 0.25, REVIVE_R = 55;
export const POTION = 0.15, POTION_CHANCE = 0.1, POTION_MS = 12000;

function defaultSettings() { return { rounds: 0 }; }      // 0 = chacun est maître une fois
export const playlist = {
  options: [{ key: "rounds", label: "Manches", default: "0", choices: [{ v: "0", label: "Chacun maître 1 fois" }, { v: "2", label: "2" }, { v: "3", label: "3" }] }],
  settingsFor(c) { return { rounds: [0, 2, 3].includes(Number(c.rounds)) ? Number(c.rounds) : 0 }; },
};

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
const keyFor = (a) => KEYS[Math.round(((a + Math.PI * 4) % (Math.PI * 2)) / (Math.PI / 4)) % 8];

export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | choose | hordes | enter | donjon | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0, rounds: 0, turn: [],
    gm: null, heroes: {},
    world: "horde", rects: [], nav: null, fields: {}, fieldsAt: 0,
    dungeon: null,        // { grid, enemies: [{ type, x, y }], traps: [{ id, type, x, y }], boss: { type, x, y } }
    budget: 0,
    enemies: [], shots: [], zones: [], snares: [], potions: [], traps: [],
    eid: 0, sid: 0, zid: 0,
    energy: 0, energyAt: 0, bossCtl: false, bossIn: { k: 0, p: null, prevK: 0 }, bossAwake: false, bossDead: false, bossCell: null,
    gmDmg: 0, deaths: 0,
    hordeT: 0, spawnAt: 0,
    phaseStart: 0, phaseEnd: 0, endAt: 0, lastTickAt: 0,
    lastRound: null, loop: null, timer: null,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const isBot = (id) => !!players().find((p) => p.id === id)?.bot;
  const gmAuto = () => isBot(g.gm) || !players().find((p) => p.id === g.gm)?.connected;   // (maître bot ou parti : son donjon joue tout seul)
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 60) g.fx.shift(); };
  const slayers = () => Object.entries(g.heroes);
  const aliveHeroes = () => slayers().filter(([, s]) => s.alive);
  const W = () => (g.world === "horde" ? D.HW : D.WW), HH = () => (g.world === "horde" ? D.HH : D.WH);
  const ENV = (s) => ({ walls: true, w: W(), h: HH(), speedMul: D.CLASSES[s.cls].speed, rects: g.rects });
  const cdMul = (s) => (s.cls === "mage" && s.lvl >= 5 ? 0.75 : 1);

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s). Le donjon n'y est pas pendant la construction,
  //  et les pièges n'y sont jamais (seul le maître les voit, en privé).
  // =================================================================
  function publicState() {
    const t = now();
    const showDungeon = ["enter", "donjon", "roundOver", "over"].includes(g.phase) && g.dungeon;
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, rounds: g.rounds, gm: g.gm, world: g.world,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      heroes: slayers().map(([id, s]) => ({
        id, cls: s.cls, seq: s.seq, alive: s.alive, hp: Math.round(s.hp), maxHp: Math.round(s.maxHp), lvl: s.lvl, xp: s.xp,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, dash: s.h.dash, dashT: s.h.dashT, stun: s.h.stun, pushT: 0, heavy: 0,
        shield: t < s.shieldUntil, rage: t < s.rageUntil, revive: Math.round((s.revive / REVIVE_MS) * 100) / 100,
        respawn: s.respawnAt ? Math.max(0, s.respawnAt - t) : 0,
        cds: [s.cd.b, s.cd[1], s.cd[2], s.cd[3]].map((c) => Math.max(0, c - t)),
      })),
      enemies: g.enemies.map((e) => ({
        id: e.id, t: e.type, boss: !!e.boss, x: Math.round(e.x), y: Math.round(e.y), face: Math.round(e.face * 100) / 100, hp: Math.round(e.hp), mh: Math.round(e.maxHp), r: e.r,
        wind: e.wind ? { k: e.wind.kind, x: Math.round(e.wind.x), y: Math.round(e.wind.y), r: e.wind.r, left: Math.max(0, e.wind.at - t), tot: e.wind.tot } : null,
        slow: t < e.slowUntil, stun: t < e.stunUntil || t < e.rootUntil, awake: !!e.awake,
      })),
      shots: g.shots.map((b) => ({ id: b.id, k: b.kind, side: b.side, x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), r: b.r })),
      zones: g.zones.map((z) => ({ id: z.id, k: z.kind, x: Math.round(z.x), y: Math.round(z.y), r: z.r, w: z.w, h: z.h, left: Math.max(0, z.at - t), tot: z.tot, side: z.side })),
      snares: g.snares.map((s) => ({ x: Math.round(s.x), y: Math.round(s.y) })),
      potions: g.potions.map((p) => ({ id: p.id, x: Math.round(p.x), y: Math.round(p.y) })),
      grid: showDungeon ? g.dungeon.grid : null,
      boss: showDungeon && g.dungeon.boss ? { type: g.dungeon.boss.type, ctl: g.bossCtl, awake: g.bossAwake, dead: g.bossDead } : null,
      energy: g.phase === "donjon" ? Math.floor(g.energy) : 0,
      phaseLeft: Math.max(0, g.phaseEnd - t), phaseTot: g.phaseEnd - g.phaseStart,
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }
  // Le maître du jeu reçoit en privé son donjon (construction) et l'état de ses pièges.
  function sendGm() {
    if (!g.gm || isBot(g.gm) || !g.dungeon) return;
    const t = now();
    ctx.sendTo(g.gm, "gm", {
      round: g.round, grid: g.dungeon.grid, budget: g.budget, left: g.budget - spent(),
      items: g.phase === "hordes" || g.phase === "choose" ? { enemies: g.dungeon.enemies, traps: g.dungeon.traps, boss: g.dungeon.boss } : { boss: g.dungeon.boss },
      traps: g.traps.map((tr) => ({ id: tr.id, type: tr.type, x: tr.x, y: tr.y, ready: Math.max(0, tr.readyAt - t) })),
    });
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {}; g.round = 0;
    const list = players().filter((p) => p.connected);
    for (const p of list) g.scores[p.id] = 0;
    g.turn = shuffle(list.map((p) => p.id));
    g.rounds = g.settings.rounds ? Math.min(g.settings.rounds, g.turn.length) : g.turn.length;
    startRound();
  }
  function setPhase(phase, ms) { g.phase = phase; g.phaseStart = now(); g.phaseEnd = now() + ms; }
  function newHero(id, x, y) {
    return { h: H.newHero(x, y, 0), cls: null, hp: 1, maxHp: 1, lvl: 1, xp: 0, alive: true, respawnAt: 0, cd: { b: 0, 1: 0, 2: 0, 3: 0 }, shieldUntil: 0, rageUntil: 0,
      seq: 0, lastInputAt: 0, bot: isBot(id), prevK: 0, aim: 0, dmg: 0, dmg2: 0, taken: 0, revive: 0, ai: {}, charge: null };
  }
  function startRound() {
    clearTimeout(g.timer);
    const list = players().filter((p) => p.connected);
    for (const p of list) if (!g.turn.includes(p.id)) g.turn.push(p.id);
    const order = g.turn.filter((id) => list.some((p) => p.id === id));
    g.gm = order[g.round % order.length];
    g.round++;
    g.heroes = {};
    list.filter((p) => p.id !== g.gm).forEach((p, i) => { g.heroes[p.id] = newHero(p.id, D.HW / 2 + (i - 3) * 40, D.HH / 2); g.scores[p.id] = g.scores[p.id] || 0; });
    g.scores[g.gm] = g.scores[g.gm] || 0;
    g.world = "horde"; g.rects = D.hordeWalls(); g.nav = D.nav(g.rects, D.HW, D.HH); g.fields = {}; g.fieldsAt = 0;
    g.dungeon = { grid: D.emptyGrid(), enemies: [], traps: [], boss: null };
    g.budget = D.budgetFor(Object.keys(g.heroes).length);
    g.enemies = []; g.shots = []; g.zones = []; g.snares = []; g.potions = []; g.traps = [];
    g.energy = 0; g.bossCtl = false; g.bossIn = { k: 0, p: null, prevK: 0 }; g.bossAwake = false; g.bossDead = false;
    g.gmDmg = 0; g.deaths = 0; g.endAt = 0; g.lastRound = null; g.feed = []; g.fx = [];
    setPhase("choose", CHOOSE_MS);
    say(`🎲 ${pseudo(g.gm)} est le maître du jeu !`);
    g.lastTickAt = now();
    startLoop();
  }
  // Fin du choix : chacun reçoit sa classe (au hasard s'il n'a pas choisi), et les hordes commencent.
  function startHordes() {
    for (const [id, s] of slayers()) {
      if (!s.cls) s.cls = pick(D.CLASS_IDS);
      s.maxHp = s.hp = D.CLASSES[s.cls].hp;
      s.h = H.newHero(s.h.x, s.h.y, -Math.PI / 2);
    }
    setPhase("hordes", HORDE_MS);
    g.hordeT = now(); g.spawnAt = now() + 1500;
    if (isBot(g.gm)) botBuild();
  }
  function enterDungeon() {
    autoComplete();
    g.world = "donjon"; g.rects = D.walls(g.dungeon.grid); g.nav = D.nav(g.rects, D.WW, D.WH); g.fields = {}; g.fieldsAt = 0;
    g.enemies = []; g.shots = []; g.zones = []; g.snares = []; g.potions = [];
    const c = D.cellCenter(D.ENTRY.c, D.ENTRY.r);
    let i = 0;
    for (const [, s] of slayers()) {
      // Les PV perdus pendant les hordes restent perdus. Un slayer mort à la fin des hordes revient avec ses 30 %.
      if (!s.alive) { s.alive = true; s.hp = s.maxHp * RESPAWN_HP; s.respawnAt = 0; }
      const a = (i++ / Math.max(1, Object.keys(g.heroes).length)) * Math.PI * 2;
      s.h = H.newHero(c.x + Math.cos(a) * 50, c.y + Math.sin(a) * 50, 0);
      s.cd = { b: 0, 1: 0, 2: 0, 3: 0 }; s.shieldUntil = s.rageUntil = 0; s.charge = null; s.revive = 0;
    }
    const n = Object.keys(g.heroes).length;
    for (const e of g.dungeon.enemies) spawnEnemy(e.type, e.x, e.y, { sleep: true, hpMul: D.groupMul(n) });
    const b = g.dungeon.boss;
    const def = D.BOSSES[b.type], bossHp = (def.hpBase + def.hpPer * n) * (1 + 0.08 * (n - 1));
    const boss = spawnEnemy(null, b.x, b.y, { sleep: true });
    Object.assign(boss, { boss: true, type: b.type, r: def.r, hp: bossHp, maxHp: bossHp, speed: def.speed, cdA: 0, cdB: now() + 4000 });
    g.bossCell = D.cellOf(b.x, b.y);
    g.traps = g.dungeon.traps.map((tr) => ({ ...tr, readyAt: 0 }));
    g.energy = D.ENERGY_START; g.energyAt = now();
    setPhase("enter", ENTER_MS);
    say("🚪 Les slayers entrent dans le donjon !");
  }
  // Les cases vides restent des salles vides (toujours reliées) ; s'il n'y a pas de boss, on le met au fond.
  function autoComplete() {
    const d = g.dungeon;
    if (!d.boss) {
      const far = { c: D.COLS - 1, r: D.ROWS - 1 - D.ENTRY.r };
      const p = freeNear(D.cellCenter(far.c, far.r), 34);
      d.boss = { type: pick(D.BOSS_IDS), x: p.x, y: p.y };
      if (!isBot(g.gm)) say("⏰ Pas de boss posé : il est mis au fond, au hasard");
    }
  }
  function freeNear(p, r) {
    const rects = D.walls(g.dungeon.grid);
    for (let rad = 0; rad < 200; rad += 10) for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, x = p.x + Math.cos(a) * rad, y = p.y + Math.sin(a) * rad;
      if (D.free(rects, x, y, r + 4, D.WW, D.WH)) return { x, y };
    }
    return p;
  }

  function endRound() {
    stopLoop();
    const gains = {}, stats = {};
    const ids = Object.keys(g.heroes);
    const dead = ids.filter((id) => !g.heroes[id].alive).length;
    // Slayers : 5 en moyenne (jusqu'à 10) pour sa part des dégâts de l'équipe, jusqu'à 8 pour la survie (selon les PV gardés), +5 si le boss tombe.
    const teamDmg = ids.reduce((n, id) => n + g.heroes[id].dmg2, 0) || 1;
    for (const id of ids) {
      const s = g.heroes[id];
      const surv = s.alive ? 3 + Math.round((5 * s.hp) / s.maxHp) : 0;
      gains[id] = Math.min(10, Math.round((5 * ids.length * s.dmg2) / teamDmg)) + surv + (g.bossDead ? 5 : 0);   // (5 en moyenne, 10 pour qui fait tout)
      stats[id] = { cls: s.cls, lvl: s.lvl, dmg: Math.round(s.dmg2), alive: s.alive, hp: Math.round(s.hp), maxHp: Math.round(s.maxHp) };
    }
    // Maître du jeu : jusqu'à 12 pour les dégâts infligés (comparés aux PV de l'équipe), jusqu'à 12 selon la part de slayers tombés, +3 si tous tombent, +5 si le boss tient.
    const teamHp = ids.reduce((n, id) => n + g.heroes[id].maxHp, 0) || 1;
    gains[g.gm] = Math.min(12, Math.round((12 * g.gmDmg) / teamHp)) + Math.round((12 * dead) / Math.max(1, ids.length)) + (ids.length && dead === ids.length ? 3 : 0) + (g.bossDead ? 0 : 5);
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    const order = Object.keys(gains).sort((a, b) => gains[b] - gains[a]);
    g.lastRound = { gains, order, gm: g.gm, stats, bossDead: g.bossDead, bossType: g.dungeon?.boss?.type, gmDmg: Math.round(g.gmDmg), dead, total: ids.length };
    const last = g.round >= g.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last) {
      g.phaseEnd = now() + ROUND_OVER_MS;
      g.finishTimer = setTimeout(() => { if (g.phase === "roundOver") startRound(); }, ROUND_OVER_MS);
    }
    ctx.update();
  }
  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  CONSTRUCTION (le maître du jeu, pendant les hordes)
  // =================================================================
  const spent = () => {
    const d = g.dungeon;
    return d.enemies.reduce((n, e) => n + D.ENEMIES[e.type].cost, 0) + d.traps.reduce((n, tr) => n + D.TRAPS[tr.type].cost, 0);
  };
  const inEntry = (x, y) => { const c = D.cellOf(x, y); return c.c === D.ENTRY.c && c.r === D.ENTRY.r; };
  function build(op) {
    const d = g.dungeon;
    if (op.op === "room") {
      const { c, r } = op;
      if (!(c >= 0 && c < D.COLS && r >= 0 && r < D.ROWS) || !D.TEMPLATES[op.tpl] || (c === D.ENTRY.c && r === D.ENTRY.r)) return;
      d.grid[r][c] = op.tpl;
      // (ce qui se retrouve dans un mur de la nouvelle salle est enlevé)
      const rects = D.walls(d.grid);
      d.enemies = d.enemies.filter((e) => D.free(rects, e.x, e.y, D.ENEMIES[e.type].r, D.WW, D.WH));
      d.traps = d.traps.filter((tr) => D.free(rects, tr.x, tr.y, 4, D.WW, D.WH));
      if (d.boss && !D.free(rects, d.boss.x, d.boss.y, D.BOSSES[d.boss.type].r, D.WW, D.WH)) d.boss = null;
      return;
    }
    const x = Number(op.x), y = Number(op.y);
    if (!isFinite(x) || !isFinite(y)) return;
    const rects = D.walls(d.grid);
    if (op.op === "erase") {
      const near = (o) => Math.hypot(o.x - x, o.y - y) < 30;
      const before = d.enemies.length + d.traps.length;
      d.enemies = d.enemies.filter((e) => !near(e));
      d.traps = d.traps.filter((tr) => !near(tr));
      if (before === d.enemies.length + d.traps.length && d.boss && Math.hypot(d.boss.x - x, d.boss.y - y) < 45) d.boss = null;
      return;
    }
    if (op.op !== "put" || inEntry(x, y)) return { error: "Pas dans la salle d'entrée !" };
    if (op.kind === "enemy" && D.ENEMIES[op.type]) {
      if (!D.free(rects, x, y, D.ENEMIES[op.type].r, D.WW, D.WH)) return { error: "Ici, c'est un mur" };
      if (spent() + D.ENEMIES[op.type].cost > g.budget) return { error: "Budget épuisé" };
      if (d.enemies.length >= 60) return { error: "60 ennemis au plus" };
      d.enemies.push({ type: op.type, x: Math.round(x), y: Math.round(y) });
    } else if (op.kind === "trap" && D.TRAPS[op.type]) {
      if (!D.free(rects, x, y, 4, D.WW, D.WH)) return { error: "Ici, c'est un mur" };
      if (spent() + D.TRAPS[op.type].cost > g.budget) return { error: "Budget épuisé" };
      if (d.traps.length >= 20) return { error: "20 pièges au plus" };
      d.traps.push({ id: ++g.zid, type: op.type, x: Math.round(x), y: Math.round(y) });
    } else if (op.kind === "boss" && D.BOSSES[op.type]) {
      if (!D.free(rects, x, y, D.BOSSES[op.type].r, D.WW, D.WH)) return { error: "Trop près d'un mur pour le boss" };
      d.boss = { type: op.type, x: Math.round(x), y: Math.round(y) };
    }
  }
  // Le maître du jeu bot : des salles au hasard, le boss au fond, des ennemis surtout vers le fond, des pièges près des portes.
  function botBuild() {
    const d = g.dungeon;
    for (let r = 0; r < D.ROWS; r++) for (let c = 0; c < D.COLS; c++) if (!(c === D.ENTRY.c && r === D.ENTRY.r)) d.grid[r][c] = pick(D.TPL_IDS);
    const cells = [];
    for (let r = 0; r < D.ROWS; r++) for (let c = 0; c < D.COLS; c++) if (!(c === D.ENTRY.c && r === D.ENTRY.r)) cells.push({ c, r, far: Math.abs(c - D.ENTRY.c) + Math.abs(r - D.ENTRY.r) });
    const bc = cells.sort((a, b) => b.far - a.far)[Math.floor(Math.random() * 3)];
    const bp = freeNear(D.cellCenter(bc.c, bc.r), 36);
    d.boss = { type: pick(D.BOSS_IDS), x: Math.round(bp.x), y: Math.round(bp.y) };
    const rects = D.walls(d.grid);
    const randIn = (cell, r) => { for (let i = 0; i < 40; i++) { const x = cell.c * D.CW + rand(30, D.CW - 30), y = cell.r * D.CH + rand(30, D.CH - 30); if (D.free(rects, x, y, r, D.WW, D.WH)) return { x, y }; } return null; };
    let guard = 0;
    while (guard++ < 200) {
      const left = g.budget - spent();
      if (left < 2) break;
      const cell = cells[Math.min(cells.length - 1, Math.floor(Math.pow(Math.random(), 1.6) * cells.length))];   // (plutôt les salles du fond)
      if (Math.random() < 0.22) {
        const type = left >= 3 && Math.random() < 0.5 ? "rune" : "pics";
        const p = randIn(cell, 4);
        if (p) build({ op: "put", kind: "trap", type, x: p.x, y: p.y });
      } else {
        const opts = D.ENEMY_IDS.filter((t) => D.ENEMIES[t].cost <= left);
        const type = pick(opts), p = randIn(cell, D.ENEMIES[type].r);
        if (p) build({ op: "put", kind: "enemy", type, x: p.x, y: p.y });
      }
    }
  }

  // =================================================================
  //  LES ENNEMIS
  // =================================================================
  function spawnEnemy(type, x, y, o = {}) {
    const def = type ? D.ENEMIES[type] : { hp: 100, speed: 100, r: 30 };
    const mul = o.hpMul || 1;
    const e = { id: ++g.eid, type, x, y, face: Math.PI / 2, r: def.r, hp: def.hp * mul, maxHp: def.hp * mul, speed: def.speed, cd: now() + rand(300, 900), wind: null,
      slowUntil: 0, stunUntil: 0, rootUntil: 0, taunt: null, awake: !o.sleep, target: null, losAt: 0, los: false };
    g.enemies.push(e);
    return e;
  }
  function updateFields(t) {
    if (t - g.fieldsAt < 400) return;
    g.fieldsAt = t;
    g.fields = {};
    for (const [id, s] of aliveHeroes()) g.fields[id] = D.field(g.nav, s.h.x, s.h.y);
  }
  function nearestHero(e, maxTiles = 1e9) {
    let best = null, bd = 1e9;
    for (const [id, s] of aliveHeroes()) {
      const f = g.fields[id];
      const d = f ? D.fieldAt(g.nav, f, e.x, e.y) : -1;
      const v = d < 0 ? dist(e, s.h) / D.TILE + 50 : d;
      if (v < bd && v <= maxTiles) { bd = v; best = id; }
    }
    return best;
  }
  function moveToward(e, id, dt, speed, away = false) {
    const s = g.heroes[id];
    if (!s) return;
    const direct = dist(e, s.h) < 90 && D.los(g.rects, e.x, e.y, s.h.x, s.h.y);
    let d;
    if (direct || !g.fields[id]) { const dx = s.h.x - e.x, dy = s.h.y - e.y, l = Math.hypot(dx, dy) || 1; d = { x: dx / l, y: dy / l }; }
    else d = D.dirFrom(g.nav, g.fields[id], e.x, e.y);
    if (!d) return;
    if (away) d = { x: -d.x, y: -d.y };
    e.x += d.x * speed * dt; e.y += d.y * speed * dt;
  }
  // Un ennemi se réveille : toute sa salle avec lui.
  function wakeRoom(e, t) {
    const c = D.cellOf(e.x, e.y);
    for (const o of g.enemies) {
      if (o.awake || o.boss) continue;
      const oc = D.cellOf(o.x, o.y);
      if (oc.c === c.c && oc.r === c.r) { o.awake = true; o.cd = t + rand(200, 700); }
    }
    e.awake = true;
  }
  function enemyTick(e, t, dt) {
    if (e.boss) return bossTick(e, t, dt);
    const def = D.ENEMIES[e.type];
    // Endormi (dans le donjon) : il se réveille quand un slayer approche.
    if (!e.awake) {
      const id = nearestHero(e, 19);
      if (id && dist(e, g.heroes[id].h) < 380) wakeRoom(e, t);
      else return;
    }
    if (t < e.stunUntil) return;
    // Sa cible : celui qui le provoque (Défi), sinon le plus proche.
    let id = e.taunt && t < e.taunt.until && g.heroes[e.taunt.id]?.alive ? e.taunt.id : null;
    if (!id) { if (!e.target || !g.heroes[e.target]?.alive || Math.random() < 0.01) e.target = nearestHero(e); id = e.target; }
    if (!id) return;
    const s = g.heroes[id], d = dist(e, s.h);
    e.face = Math.atan2(s.h.y - e.y, s.h.x - e.x);
    const speed = def.speed * (t < e.slowUntil ? 0.4 : 1) * (t < e.rootUntil ? 0 : 1);
    // Une attaque en préparation : il ne bouge plus, puis elle part (on peut l'esquiver).
    if (e.wind) {
      if (t >= e.wind.at) {
        hurtZone(e.wind.x, e.wind.y, e.wind.r, def.dmg, "monstre");
        addFx({ kind: e.wind.kind === "slam" ? "slam" : "griffe", x: Math.round(e.wind.x), y: Math.round(e.wind.y), r: e.wind.r });
        e.wind = null; e.cd = t + def.cd;
      }
      return;
    }
    if (def.kind === "tir") {
      if (t - e.losAt > 300) { e.losAt = t; e.los = D.los(g.rects, e.x, e.y, s.h.x, s.h.y); }
      if (e.los && d < def.keep - 40) moveToward(e, id, dt, speed * 0.8, true);
      else if (!e.los || d > def.keep + 60) moveToward(e, id, dt, speed);
      if (e.los && d < 460 && t >= e.cd) {
        const a = e.face + rand(-0.06, 0.06);
        g.shots.push({ id: ++g.sid, kind: "os", side: "monstre", x: e.x + Math.cos(a) * 20, y: e.y + Math.sin(a) * 20, vx: Math.cos(a) * D.SHOT_V, vy: Math.sin(a) * D.SHOT_V, r: 6, dmg: def.dmg, life: 1.4, hit: new Set() });
        e.cd = t + def.cd + rand(-200, 300);
      }
      return;
    }
    // Mêlée et brute : il fonce, puis prépare son coup quand il est assez près.
    if (d < def.range + 10 && t >= e.cd) {
      const reach = def.kind === "slam" ? 0 : 22;
      e.wind = { kind: def.kind, at: t + def.wind, tot: def.wind, x: e.x + Math.cos(e.face) * reach, y: e.y + Math.sin(e.face) * reach, r: def.kind === "slam" ? def.range : def.range - 4 };
      return;
    }
    if (d > def.range - 8) moveToward(e, id, dt, speed);
  }

  // Le boss : il reste dans sa salle. Le maître du jeu peut le piloter (bossCtl), sinon il se débrouille.
  function bossTick(e, t, dt) {
    const def = D.BOSSES[e.type];
    const inCell = (s) => { const c = D.cellOf(s.h.x, s.h.y); return c.c === g.bossCell.c && c.r === g.bossCell.r; };
    if (!g.bossAwake) {
      if (aliveHeroes().some(([, s]) => inCell(s))) { g.bossAwake = true; e.awake = true; say(`⚠️ ${def.emoji} ${def.name} se réveille !`); e.cdA = t + 800; e.cdB = t + 3500; }
      else return;
    }
    if (t < e.stunUntil) return;
    const speed = def.speed * (t < e.slowUntil ? 0.5 : 1);
    if (e.wind) {
      if (t >= e.wind.at) {
        if (e.wind.kind === "slam" || e.wind.kind === "morsure") { hurtZone(e.wind.x, e.wind.y, e.wind.r, e.wind.kind === "slam" ? 32 : 28, "monstre"); addFx({ kind: "slam", x: Math.round(e.wind.x), y: Math.round(e.wind.y), r: e.wind.r }); }
        e.wind = null;
      }
      return;
    }
    let aimP = null, wantA = false, wantB = false, mv = null;
    if (g.bossCtl && !gmAuto()) {
      const inp = g.bossIn, k = inp.k || 0;
      let x = (k & K.RIGHT ? 1 : 0) - (k & K.LEFT ? 1 : 0), y = (k & K.DOWN ? 1 : 0) - (k & K.UP ? 1 : 0);
      const l = Math.hypot(x, y); if (l) mv = { x: x / l, y: y / l };
      aimP = inp.p;
      wantA = !!(k & K.FIRE); wantB = !!(k & ALT);
    } else {
      const inside = aliveHeroes().filter(([, s]) => inCell(s));
      const targets = inside.length ? inside : aliveHeroes();
      if (!targets.length) return;
      targets.sort((a, b) => dist(a[1].h, e) - dist(b[1].h, e));
      const s = targets[0][1], d = dist(s.h, e);
      aimP = { x: s.h.x, y: s.h.y };
      const melee = e.type !== "necro";
      const want = melee ? def.r + 40 : 230;
      if (d > want) { const l = d || 1; mv = { x: (s.h.x - e.x) / l, y: (s.h.y - e.y) / l }; }
      else if (!melee && d < 150) { const l = d || 1; mv = { x: -(s.h.x - e.x) / l, y: -(s.h.y - e.y) / l }; }
      wantA = melee ? d < def.r + 70 : d < 520;
      wantB = Math.random() < 0.03 && d < 420;
    }
    if (mv) { e.x += mv.x * speed * dt; e.y += mv.y * speed * dt; }
    // (il ne quitte pas sa salle)
    const cr = D.cellRect(g.bossCell.c, g.bossCell.r), m = D.WALL / 2 + e.r;
    e.x = Math.max(cr.x + m, Math.min(cr.x + cr.w - m, e.x)); e.y = Math.max(cr.y + m, Math.min(cr.y + cr.h - m, e.y));
    if (aimP) e.face = Math.atan2(aimP.y - e.y, aimP.x - e.x);
    const a = e.face;
    if (wantA && t >= e.cdA) {
      if (e.type === "golem") { e.wind = { kind: "slam", at: t + 650, tot: 650, x: e.x + Math.cos(a) * 40, y: e.y + Math.sin(a) * 40, r: 92 }; e.cdA = t + 1700; }
      else if (e.type === "dragon") { e.wind = { kind: "morsure", at: t + 450, tot: 450, x: e.x + Math.cos(a) * 42, y: e.y + Math.sin(a) * 42, r: 64 }; e.cdA = t + 1300; }
      else { shoot("monstre", "sombre", e.x, e.y, a, 480, 8, 17, 1.4); e.cdA = t + 750; }
    } else if (wantB && t >= e.cdB) {
      if (e.type === "golem") { shoot("monstre", "rocher", e.x, e.y, a, 420, 16, 38, 1.6); e.cdB = t + 4000; }
      else if (e.type === "dragon") { for (let i = -3; i <= 3; i++) shoot("monstre", "feu", e.x, e.y, a + i * 0.12, 400, 9, 11, 0.65); e.cdB = t + 5500; }
      else { for (let i = 0; i < 2; i++) { const p = { x: e.x + Math.cos(a + (i ? 1 : -1) * 1.2) * 60, y: e.y + Math.sin(a + (i ? 1 : -1) * 1.2) * 60 }; D.pushOut(p, 16, g.rects); spawnEnemy("squelette", p.x, p.y); } addFx({ kind: "invoque", x: Math.round(e.x), y: Math.round(e.y) }); e.cdB = t + 9000; }
    }
  }

  function separate() {
    const E = g.enemies;
    for (let i = 0; i < E.length; i++) {
      const a = E[i];
      for (let j = i + 1; j < E.length; j++) {
        const b = E[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = a.r + b.r;
        if (d >= min || d < 0.01) continue;
        const o = (min - d) / 2, nx = dx / d, ny = dy / d;
        if (!a.boss) { a.x -= nx * o; a.y -= ny * o; }
        if (!b.boss) { b.x += nx * o; b.y += ny * o; }
      }
      // (les ennemis ne bousculent pas les slayers : ce sont eux qui s'écartent)
      for (const [, s] of aliveHeroes()) {
        const dx = a.x - s.h.x, dy = a.y - s.h.y, d = Math.hypot(dx, dy), min = a.r + H.R;
        if (d < min && d > 0.01 && !a.boss) { a.x = s.h.x + (dx / d) * min; a.y = s.h.y + (dy / d) * min; }
      }
      D.pushOut(a, a.r, g.rects);
    }
  }

  // =================================================================
  //  DÉGÂTS
  // =================================================================
  function hurtHero(id, dmg, src) {
    const s = g.heroes[id];
    if (!s?.alive || s.h.dashT > 0) return;     // (en pleine esquive : intouchable)
    const t = now();
    let d = dmg;
    if (t < s.shieldUntil) d *= 0.3;
    if (s.cls === "chevalier" && s.lvl >= 5) d *= 0.8;
    if (g.phase === "hordes") d *= 0.6;    // (les hordes tapent un peu moins fort que le donjon)
    const n = Object.keys(g.heroes).length;
    if (n <= 2) d *= n === 1 ? 0.6 : 0.85;  // (seul ou à deux, on a un peu plus de marge : personne pour vous relever)
    s.hp -= d; s.taken += d;
    if (g.phase === "donjon") g.gmDmg += d;
    addFx({ kind: "aie", x: Math.round(s.h.x), y: Math.round(s.h.y), who: id, n: Math.round(d) });
    if (s.hp > 0) return;
    s.hp = 0; s.alive = false; s.revive = 0;
    if (g.phase === "hordes") {
      // Mort pendant les hordes : retour dans 5 s, avec 30 % des PV, et la moitié de l'expérience du niveau en cours en moins.
      const lo = D.XP[s.lvl - 1] || 0;
      s.xp = Math.round(lo + (s.xp - lo) * 0.5);
      s.respawnAt = t + RESPAWN_MS;
      say(`💀 ${pseudo(id)} tombe face aux hordes (retour dans 5 s)`);
    } else {
      g.deaths++;
      say(`💀 ${pseudo(id)} est tombé${src === "piège" ? " dans un piège" : ""} ! Restez 3 s près de lui pour le relever`);
      if (!aliveHeroes().length && !g.endAt) g.endAt = t + END_DELAY;
    }
  }
  function hurtZone(x, y, r, dmg, src) {
    for (const [id, s] of aliveHeroes()) if (Math.hypot(s.h.x - x, s.h.y - y) < r + H.R * 0.6) hurtHero(id, dmg, src);
  }
  function hurtEnemy(e, dmg, byId, o = {}) {
    const s = g.heroes[byId];
    if (!e || e.hp <= 0) return;
    let d = dmg;
    if (s && s.cls === "archer" && s.lvl >= 5 && Math.random() < 0.25) { d *= 2; o.crit = true; }
    if (!e.awake && !e.boss) wakeRoom(e, now());
    if (e.boss && !g.bossAwake) { g.bossAwake = true; e.awake = true; say(`⚠️ ${D.BOSSES[e.type].emoji} ${D.BOSSES[e.type].name} se réveille !`); }
    e.hp -= d;
    if (s) {
      s.dmg += d; if (g.phase === "donjon") s.dmg2 += d;
      if (s.cls === "armes" && s.lvl >= 5) s.hp = Math.min(s.maxHp, s.hp + d * 0.15);
    }
    if (o.stun) e.stunUntil = now() + o.stun;
    if (o.slow) e.slowUntil = now() + o.slow;
    if (o.push && !e.boss) { e.x += Math.cos(o.push) * 30; e.y += Math.sin(o.push) * 30; D.pushOut(e, e.r, g.rects); }
    addFx({ kind: o.crit ? "crit" : "touche", x: Math.round(e.x), y: Math.round(e.y), n: Math.round(d) });
    if (e.hp > 0) return;
    g.enemies = g.enemies.filter((x) => x !== e);
    addFx({ kind: e.boss ? "boss" : "meurt", x: Math.round(e.x), y: Math.round(e.y), t: e.type });
    if (e.boss) {
      g.bossDead = true;
      say(`🏆 ${D.BOSSES[e.type].name} est vaincu${s ? ` (coup final : ${pseudo(byId)})` : ""} !`);
      if (!g.endAt) g.endAt = now() + END_DELAY;
      return;
    }
    if (g.phase === "hordes") {
      // L'expérience va à tous les slayers (on joue ensemble) ; parfois une petite potion.
      const share = Math.min(1, 1.3 / Math.max(1, Object.keys(g.heroes).length));   // (plus on est nombreux, moins chaque mort rapporte : il y a plus de monstres)
      for (const [hid, hs] of slayers()) gainXp(hid, hs, D.ENEMIES[e.type].xp * share);
      if (Math.random() < POTION_CHANCE) g.potions.push({ id: ++g.zid, x: e.x, y: e.y, until: now() + POTION_MS });
    }
  }
  function gainXp(id, s, n) {
    if (!s.alive) return;
    const before = s.lvl;
    s.xp += n;
    s.lvl = D.level(s.xp);
    for (let l = before + 1; l <= s.lvl; l++) {
      const gain = D.CLASSES[s.cls].hp * D.HP_PER_LVL;
      s.maxHp += gain; s.hp += gain;          // (le gain de PV max s'ajoute, mais les PV perdus ne reviennent pas)
      addFx({ kind: "niveau", who: id, lvl: l, x: Math.round(s.h.x), y: Math.round(s.h.y) });
    }
  }

  // =================================================================
  //  LES SLAYERS : bouger, attaquer, sorts
  // =================================================================
  function shoot(side, kind, x, y, a, v, r, dmg, life, extra = {}) {
    g.shots.push({ id: ++g.sid, kind, side, x: x + Math.cos(a) * 22, y: y + Math.sin(a) * 22, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r, dmg, life, hit: new Set(), ...extra });
  }
  const dmgMul = (s) => (1 + D.DMG_PER_LVL * (s.lvl - 1)) * (now() < s.rageUntil ? 1.5 : 1);
  function arc(id, s, range, half, dmg, o = {}) {
    let n = 0;
    for (const e of [...g.enemies]) {
      const d = dist(e, s.h);
      if (d > range + e.r) continue;
      if (Math.abs(angDiff(Math.atan2(e.y - s.h.y, e.x - s.h.x), s.aim)) > half && d > e.r + H.R) continue;
      hurtEnemy(e, dmg, id, { ...o, push: o.push ? Math.atan2(e.y - s.h.y, e.x - s.h.x) : undefined }); n++;
    }
    return n;
  }
  function around(id, s, r, dmg, o = {}) { for (const e of [...g.enemies]) if (dist(e, s.h) < r + e.r) hurtEnemy(e, dmg, id, o); }
  const canFight = () => g.phase === "hordes" || g.phase === "donjon";
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s?.alive || !s.cls) return;
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    const env = ENV(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH), s.aim, dt, env);
      H.collideWalls(s.h, env);
    }
    if (!canFight()) { s.prevK = k; return; }
    const a = s.aim, x = s.h.x, y = s.h.y, m = dmgMul(s), cm = cdMul(s);
    // Attaque de base (on peut rester appuyé).
    if (k & K.FIRE && t >= s.cd.b) {
      const C = D.CLASSES[s.cls];
      let cd = C.basic.cd * cm;
      if (s.cls === "mage") shoot("slayer", "orbe", x, y, a, 620, 7, 20 * m, 0.9, { by: id });
      else if (s.cls === "archer") shoot("slayer", "fleche", x, y, a, 820, 5, 16 * m, 0.8, { by: id });
      else if (s.cls === "chevalier") { arc(id, s, 70, 1.15, 26 * m); addFx({ kind: "coup", x: Math.round(x), y: Math.round(y), a: Math.round(a * 100) / 100, r: 70, who: id }); }
      else { arc(id, s, 78, 1.2, 34 * m); addFx({ kind: "coup", x: Math.round(x), y: Math.round(y), a: Math.round(a * 100) / 100, r: 78, who: id }); if (t < s.rageUntil) cd *= 0.6; }
      s.cd.b = t + cd;
    }
    // Les sorts (1, 2, 3) : débloqués aux niveaux 2, 3, 4.
    for (let i = 0; i < 3; i++) {
      if (!(k & SK[i]) || s.prevK & SK[i]) continue;
      const sk = D.CLASSES[s.cls].skills[i];
      if (s.lvl < sk.lvl || t < s.cd[i + 1]) continue;
      s.cd[i + 1] = t + sk.cd * cm;
      cast(id, s, i, t, a, m);
    }
    s.prevK = k;
  }
  function cast(id, s, i, t, a, m) {
    const x = s.h.x, y = s.h.y;
    const fx = (kind, o = {}) => addFx({ kind, x: Math.round(x), y: Math.round(y), a: Math.round(a * 100) / 100, who: id, ...o });
    if (s.cls === "mage") {
      if (i === 0) shoot("slayer", "feu", x, y, a, 520, 10, 0, 1.0, { by: id, boom: { r: 85, dmg: 42 * m } });
      else if (i === 1) { around(id, s, 140, 18 * m, { slow: 2500 }); fx("nova", { r: 140 }); }
      else {
        let px = x, py = y;
        for (let d = 10; d <= 240; d += 10) { const nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d; if (!D.free(g.rects, nx, ny, H.R + 1, W(), HH())) break; px = nx; py = ny; }
        fx("teleport"); s.h.x = px; s.h.y = py; s.h.vx = s.h.vy = 0; addFx({ kind: "teleport", x: Math.round(px), y: Math.round(py), who: id });
      }
    } else if (s.cls === "chevalier") {
      if (i === 0) { s.shieldUntil = t + 3000; fx("bouclier"); }
      else if (i === 1) { s.h.vx = Math.cos(a) * 900; s.h.vy = Math.sin(a) * 900; s.h.dashT = 0.28; s.charge = { until: t + 320, hit: new Set(), dmg: 30 * m }; fx("charge"); }
      else { for (const e of g.enemies) if (dist(e, s.h) < 320) e.taunt = { id, until: t + 4000 }; s.shieldUntil = Math.max(s.shieldUntil, t + 1500); fx("defi", { r: 320 }); }
    } else if (s.cls === "archer") {
      if (i === 0) shoot("slayer", "percant", x, y, a, 950, 7, 38 * m, 0.9, { by: id, pierce: true });
      else if (i === 1) { const px = x + Math.cos(a) * 230, py = y + Math.sin(a) * 230; for (const dl of [300, 800, 1300]) g.zones.push({ id: ++g.zid, kind: "pluie", side: "slayer", by: id, x: px, y: py, r: 100, at: t + dl, tot: dl, dmg: 15 * m }); }
      else { g.snares.push({ x, y, until: t + 20000, by: id, dmg: 30 * m }); fx("piege"); }
    } else {
      if (i === 0) { around(id, s, 100, 40 * m); fx("tourbillon", { r: 100 }); }
      else if (i === 1) { arc(id, s, 80, 0.9, 30 * m, { stun: 1600 }); fx("etourdi", { r: 80 }); }
      else { s.rageUntil = t + 6000; fx("rage"); }
    }
  }

  // Les tirs volent : murs, ennemis (tirs des slayers) ou slayers (tirs des monstres).
  function stepShots(dt) {
    for (const b of [...g.shots]) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let end = b.life <= 0 || !D.free(g.rects, b.x, b.y, 1, W(), HH());
      if (!end && b.side === "slayer") {
        for (const e of [...g.enemies]) {
          if (b.hit.has(e.id) || dist(e, b) > e.r + b.r) continue;
          b.hit.add(e.id);
          if (!b.boom) hurtEnemy(e, b.dmg, b.by);
          if (!b.pierce) { end = true; break; }
        }
      } else if (!end) {
        for (const [id, s] of aliveHeroes()) {
          if (Math.hypot(s.h.x - b.x, s.h.y - b.y) > H.R + b.r || s.h.dashT > 0) continue;
          hurtHero(id, b.dmg, "monstre"); end = true; break;
        }
      }
      if (end) {
        g.shots = g.shots.filter((x) => x !== b);
        if (b.boom) { for (const e of [...g.enemies]) if (dist(e, b) < b.boom.r + e.r) hurtEnemy(e, b.boom.dmg, b.by); addFx({ kind: "explosion", x: Math.round(b.x), y: Math.round(b.y), r: b.boom.r }); }
      }
    }
  }
  function stepZones(t) {
    for (const z of [...g.zones]) {
      if (t < z.at) continue;
      g.zones = g.zones.filter((x) => x !== z);
      if (z.side === "slayer") { for (const e of [...g.enemies]) if (dist(e, z) < z.r + e.r) hurtEnemy(e, z.dmg, z.by); addFx({ kind: "pluie", x: Math.round(z.x), y: Math.round(z.y), r: z.r }); }
      else if (z.kind === "pics") { for (const [id, s] of aliveHeroes()) if (Math.abs(s.h.x - z.x) < z.w / 2 + 6 && Math.abs(s.h.y - z.y) < z.h / 2 + 6) hurtHero(id, z.dmg, "piège"); addFx({ kind: "pics", x: Math.round(z.x), y: Math.round(z.y), w: z.w, h: z.h }); }
      else { hurtZone(z.x, z.y, z.r, z.dmg, "piège"); addFx({ kind: "explosion", x: Math.round(z.x), y: Math.round(z.y), r: z.r }); }
    }
    for (const sn of [...g.snares]) {
      if (t > sn.until) { g.snares = g.snares.filter((x) => x !== sn); continue; }
      const e = g.enemies.find((e) => !e.boss && dist(e, sn) < e.r + 14);
      if (!e) continue;
      g.snares = g.snares.filter((x) => x !== sn);
      e.rootUntil = t + 2500;
      hurtEnemy(e, sn.dmg, sn.by);
      addFx({ kind: "clac", x: Math.round(sn.x), y: Math.round(sn.y) });
    }
  }
  // La charge du chevalier frappe ceux qu'elle traverse.
  function stepCharges(t) {
    for (const [id, s] of aliveHeroes()) {
      if (!s.charge) continue;
      if (t > s.charge.until) { s.charge = null; continue; }
      for (const e of [...g.enemies]) {
        if (s.charge.hit.has(e.id) || dist(e, s.h) > e.r + H.R + 8) continue;
        s.charge.hit.add(e.id);
        hurtEnemy(e, s.charge.dmg, id, { push: Math.atan2(e.y - s.h.y, e.x - s.h.x), stun: 500 });
      }
    }
  }
  // Relever un coéquipier (donjon) ; revenir après 5 s (hordes) ; potions.
  function stepHeroes(t, dt) {
    for (const [id, s] of slayers()) {
      if (s.alive) continue;
      if (g.phase === "hordes" && s.respawnAt && t >= s.respawnAt) {
        s.alive = true; s.hp = s.maxHp * RESPAWN_HP; s.respawnAt = 0;
        s.h = H.newHero(D.HW / 2 + rand(-40, 40), D.HH / 2 + rand(-40, 40), 0);
        say(`✨ ${pseudo(id)} revient (${Math.round(RESPAWN_HP * 100)} % de PV)`);
      }
      if (g.phase === "donjon") {
        const helper = aliveHeroes().some(([, o]) => dist(o.h, s.h) < REVIVE_R);
        s.revive = helper ? s.revive + dt * 1000 : Math.max(0, s.revive - dt * 1000);
        if (s.revive >= REVIVE_MS) { s.alive = true; s.hp = s.maxHp * REVIVE_HP; s.revive = 0; say(`🙌 ${pseudo(id)} est relevé !`); addFx({ kind: "releve", x: Math.round(s.h.x), y: Math.round(s.h.y) }); }
      }
    }
    for (const p of [...g.potions]) {
      if (t > p.until) { g.potions = g.potions.filter((x) => x !== p); continue; }
      const hit = aliveHeroes().find(([, s]) => dist(s.h, p) < H.R + 14);
      if (!hit) continue;
      const s = hit[1];
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * POTION);
      g.potions = g.potions.filter((x) => x !== p);
      addFx({ kind: "potion", x: Math.round(p.x), y: Math.round(p.y), who: hit[0] });
    }
  }

  // Les hordes : des vagues de plus en plus fortes, depuis les bords.
  function stepHordes(t) {
    const n = Object.keys(g.heroes).length, el = (t - g.hordeT) / 1000;
    const want = Math.min(40, Math.round(1 + 3.5 * n + el / 25));     // (au début ~5 par slayer seul, puis de plus en plus)
    if (t < g.spawnAt || g.enemies.length >= want) return;
    g.spawnAt = t + Math.max(250, 900 - el * 4) / Math.max(1, n * 0.7);
    const u = Math.random(), type = el > 25 && u < 0.14 ? "brute" : u < 0.32 ? "archer" : "squelette";
    const side = Math.floor(Math.random() * 4);
    const x = side === 0 ? 20 : side === 1 ? D.HW - 20 : rand(40, D.HW - 40), y = side === 2 ? 20 : side === 3 ? D.HH - 20 : rand(40, D.HH - 40);
    spawnEnemy(type, x, y, { hpMul: 1 + el / 160 });
  }

  // =================================================================
  //  LE MAÎTRE DU JEU (phase 2) : énergie, pièges, renforts
  // =================================================================
  function trigger(trId) {
    const tr = g.traps.find((x) => x.id === trId), t = now();
    if (!tr || t < tr.readyAt) return;
    const def = D.TRAPS[tr.type];
    if (g.energy < def.energy) return { error: "Pas assez d'énergie" };
    g.energy -= def.energy; tr.readyAt = t + def.cd;
    g.zones.push({ id: ++g.zid, kind: tr.type, side: "monstre", x: tr.x, y: tr.y, r: def.r || 0, w: def.w, h: def.h, at: t + def.wind, tot: def.wind, dmg: def.dmg });
  }
  function reinforce(type, x, y) {
    const cost = D.REINFORCE[type];
    if (!cost || !isFinite(x) || !isFinite(y)) return;
    if (g.energy < cost) return { error: "Pas assez d'énergie" };
    if (!D.free(g.rects, x, y, D.ENEMIES[type].r, D.WW, D.WH)) return { error: "Ici, c'est un mur" };
    if (aliveHeroes().some(([, s]) => dist(s.h, { x, y }) < 260)) return { error: "Trop près des slayers (260 px minimum)" };
    const c = D.cellOf(x, y);
    if (g.bossCell && c.c === g.bossCell.c && c.r === g.bossCell.r) return { error: "Pas dans la salle du boss" };
    g.energy -= cost;
    const e = spawnEnemy(type, x, y);
    e.awake = true;
    addFx({ kind: "invoque", x: Math.round(x), y: Math.round(y) });
  }
  function gmBot(t) {
    for (const tr of g.traps) {
      if (t < tr.readyAt) continue;
      const def = D.TRAPS[tr.type];
      const near = aliveHeroes().some(([, s]) => (def.r ? dist(s.h, tr) < def.r * 0.8 : Math.abs(s.h.x - tr.x) < def.w / 2 && Math.abs(s.h.y - tr.y) < def.h / 2));
      if (near && g.energy >= def.energy && Math.random() < 0.5) trigger(tr.id);
    }
    if (g.energy >= 6 && Math.random() < 0.01) {
      const hs = aliveHeroes();
      if (!hs.length) return;
      const s = pick(hs)[1];
      for (let i = 0; i < 12; i++) {
        const a = rand(0, Math.PI * 2), d = rand(300, 460), x = s.h.x + Math.cos(a) * d, y = s.h.y + Math.sin(a) * d;
        if (!reinforce(pick(["archer", "squelette", "brute"]), x, y) && g.enemies.length) break;
      }
    }
  }

  // =================================================================
  //  BOTS SLAYERS
  // =================================================================
  let bossField = null, bossFieldAt = 0;
  function botInput(id, s, t) {
    const ai = s.ai, h = s.h, C = D.CLASSES[s.cls];
    let k = 0, aim = s.aim;
    const ranged = s.cls === "mage" || s.cls === "archer";
    // L'ennemi le plus proche (dans le donjon : seulement s'il est réveillé ou tout près).
    // (seulement un ennemi qu'il voit : sinon il se colle contre un mur en le visant)
    if (!ai.foeAt || t - ai.foeAt > 250 || (ai.foe && !g.enemies.includes(ai.foe))) {
      ai.foeAt = t; ai.foe = null;
      ai.ignore = ai.ignore || {};
      const cands = g.enemies.map((e) => ({ e, d: dist(e, h) })).filter(({ e, d }) => (e.awake || d < 260) && (g.world === "horde" || d < 520) && !(ai.ignore[e.id] > t)).sort((a, b) => a.d - b.d);
      for (const c of cands.slice(0, 4)) if (c.d < 70 || D.los(g.rects, h.x, h.y, c.e.x, c.e.y)) { ai.foe = c.e; break; }
    }
    // (un ennemi qu'il n'arrive pas à blesser depuis 4 s : il le laisse tomber un moment)
    if (ai.foe) {
      if (!ai.eng || ai.eng.id !== ai.foe.id) ai.eng = { id: ai.foe.id, hp: ai.foe.hp, at: t };
      else if (ai.foe.hp < ai.eng.hp) { ai.eng.hp = ai.foe.hp; ai.eng.at = t; }
      else if (t - ai.eng.at > 4000 && !ai.foe.boss) { ai.ignore[ai.foe.id] = t + 8000; ai.foe = null; ai.eng = null; }
    }
    const foe = ai.foe, fd = foe ? dist(foe, h) : 1e9;
    // Esquive : une attaque ennemie va tomber sur moi.
    const danger = g.enemies.find((e) => e.wind && Math.hypot(e.wind.x - h.x, e.wind.y - h.y) < e.wind.r + H.R && e.wind.at - t < 320)
      || g.zones.find((z) => z.side === "monstre" && Math.hypot(z.x - h.x, z.y - h.y) < (z.r || 45) + H.R && z.at - t < 400)
      || g.shots.find((b) => b.side === "monstre" && Math.hypot(b.x - h.x, b.y - h.y) < 70);
    let move = null, stay = false, onPath = false;
    if (danger) {
      move = Math.atan2(h.y - (danger.wind?.y ?? danger.y), h.x - (danger.wind?.x ?? danger.x)) + (Math.random() < 0.5 ? 0.6 : -0.6);
      if (h.dash <= 0 && Math.random() < 0.5) k |= K.DASH;
    }
    // Relever un allié tombé (donjon), si c'est calme : il va près de lui et reste.
    const down = g.world === "donjon" && slayers().find(([oid, o]) => oid !== id && !o.alive && dist(o.h, h) < 600);
    if (move === null && down && (!foe || fd > 260)) {
      if (dist(down[1].h, h) > 30) move = Math.atan2(down[1].h.y - h.y, down[1].h.x - h.x); else stay = true;
    }
    if (foe) {
      aim = Math.atan2(foe.y - h.y, foe.x - h.x) + rand(-0.05, 0.05);
      const want = ranged ? 230 : foe.r + 34;
      if (move === null && !stay) {
        if (fd > want + 20) move = Math.atan2(foe.y - h.y, foe.x - h.x);
        else if (ranged && fd < 150) move = Math.atan2(h.y - foe.y, h.x - foe.x) + (ai.side || 1) * 0.5;
        else if (ranged) move = Math.atan2(foe.y - h.y, foe.x - h.x) + (ai.side || 1) * Math.PI / 2;
      }
      if (fd < (ranged ? 520 : want + 30) && (!ranged || D.los(g.rects, h.x, h.y, foe.x, foe.y))) k |= K.FIRE;
      // Les sorts.
      const close = g.enemies.filter((e) => dist(e, h) < 170).length;
      for (let i = 0; i < 3; i++) {
        if (s.lvl < C.skills[i].lvl || t < s.cd[i + 1] || Math.random() > 0.08) continue;
        const ok = s.cls === "mage" ? (i === 0 ? fd < 420 : i === 1 ? close >= 2 : s.hp < s.maxHp * 0.4 && fd < 140)
          : s.cls === "chevalier" ? (i === 0 ? close >= 2 || foe.boss : i === 1 ? fd < 260 && fd > 80 : close >= 3)
          : s.cls === "archer" ? (i === 0 ? fd < 500 : i === 1 ? fd > 150 && fd < 320 : close >= 1)
          : (i === 0 ? close >= 2 : i === 1 ? fd < 90 : close >= 2 || foe.boss);
        if (ok) k |= SK[i];
      }
    } else if (move === null && !stay) {
      if (g.world === "donjon") {
        // Rien autour : il avance vers le boss.
        // (vers le boss, là où il est maintenant : recalculé chaque seconde)
        if (!bossField || t - bossFieldAt > 1000) { const b = g.enemies.find((e) => e.boss) || g.dungeon.boss; bossField = D.field(g.nav, b.x, b.y); bossFieldAt = t; }
        const d = D.dirFrom(g.nav, bossField, h.x, h.y);
        if (d) { move = Math.atan2(d.y, d.x); onPath = true; }
      } else if (g.world === "horde") move = Math.atan2(D.HH / 2 - h.y, D.HW / 2 - h.x);
    }
    if (Math.random() < 0.01) ai.side = Math.random() < 0.5 ? 1 : -1;
    if (typeof move === "number" && !stay) {
      // (il contourne les murs)
      if (!onPath) for (let i = 0; i < 6; i++) { const x = h.x + Math.cos(move) * 34, y = h.y + Math.sin(move) * 34; if (D.free(g.rects, x, y, H.R, W(), HH())) break; move += (ai.side || 1) * 0.6; }
      k |= keyFor(move);
    }
    return { k, aim };
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000) || TICK_MS / 1000;
    g.lastTickAt = t;
    if (g.phase === "choose") {
      for (const [id, s] of slayers()) if (!s.cls && isBot(id) && t - g.phaseStart > 1500 + Math.random() * 4000) s.cls = pick(D.CLASS_IDS);
      if (t >= g.phaseEnd || slayers().every(([, s]) => s.cls)) startHordes();
    } else if (g.phase === "enter") {
      if (t >= g.phaseEnd) { setPhase("donjon", DUNGEON_MS); bossField = null; }
    } else if (g.phase === "hordes" || g.phase === "donjon") {
      if (g.phase === "hordes") stepHordes(t);
      else {
        g.energy = Math.min(D.ENERGY_MAX, g.energy + dt * 1000 / D.ENERGY_EVERY);
        if (gmAuto()) gmBot(t);
      }
      for (const [id, s] of slayers()) {
        if (!s.alive) continue;
        if (s.bot || isBot(id)) { const b = botInput(id, s, t); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);
      }
      updateFields(t);
      for (const e of [...g.enemies]) enemyTick(e, t, dt);
      separate();
      stepShots(dt);
      stepZones(t);
      stepCharges(t);
      stepHeroes(t, dt);
      if (g.phase === "hordes" && t >= g.phaseEnd) enterDungeon();
      else if (g.phase === "donjon") {
        if (!g.endAt && t >= g.phaseEnd) g.endAt = t;
        if (g.endAt && t >= g.endAt) return endRound();
      }
    }
    sendGm();
    ctx.update();
  }
  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  g.__step = { stepShots, stepZones, enemyTick, hurtHero, hurtEnemy, act, build, botBuild, enterDungeon, startHordes, trigger, reinforce, gainXp, endRound };   // (pour les tests)

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![0, 2, 3].includes(s.rounds)) s.rounds = 0;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startGame();
      ctx.update();
    },
    next(pid) {
      if (!ctx.isHost(pid) || g.phase !== "roundOver") return;
      clearTimeout(g.finishTimer);
      startRound();
      ctx.update();
    },
    class(pid, { cls }) {
      const s = g.heroes[pid];
      if (!s || g.phase !== "choose" || !D.CLASSES[cls]) return;
      s.cls = cls;
      ctx.update();
    },
    // Slayer : { s, k, a }. Maître qui pilote le boss : { k, p: { x, y } }.
    in(pid, { s, k, a, p }) {
      const t = now();
      if (pid === g.gm) {
        g.bossIn = { k: Number(k) || 0, p: p && isFinite(p.x) && isFinite(p.y) ? { x: p.x, y: p.y } : g.bossIn.p };
        return;
      }
      const st = g.heroes[pid];
      if (!st || typeof s !== "number" || s <= st.seq) return;
      st.seq = s; st.lastInputAt = t;
      const aim = typeof a === "number" && isFinite(a) ? a : null;
      if (aim !== null) st.aim = aim;
      if (!["hordes", "donjon", "enter"].includes(g.phase)) return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, (Number(k) || 0) & 511, aim);
    },
    build(pid, op) {
      if (pid !== g.gm || !["choose", "hordes"].includes(g.phase) || !op) return;
      return build(op);
    },
    trigger(pid, { id }) { if (pid === g.gm && g.phase === "donjon") return trigger(id); },
    spawn(pid, { type, x, y }) { if (pid === g.gm && g.phase === "donjon") return reinforce(type, Number(x), Number(y)); },
    control(pid, { on }) { if (pid === g.gm && ["donjon", "enter"].includes(g.phase)) { g.bossCtl = !!on; g.bossIn = { k: 0, p: g.bossIn.p }; ctx.update(); } },
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "over" || ctx.playlist) return;
      g.phase = "setup";
      ctx.update();
    },
    finish(pid) {
      if (!ctx.isHost(pid)) return;
      stopLoop();
      ctx.finish(ranking());
    },
  };

  function leave(id) {
    if (!["choose", "hordes", "enter", "donjon"].includes(g.phase)) return;
    if (g.heroes[id]) g.heroes[id].bot = true;           // (un slayer qui part : un bot le remplace)
    if (id === g.gm) { g.bossCtl = false; }               // (le maître qui part : son donjon joue tout seul)
  }

  return {
    publicState,
    _g: g,
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data || {}) || { ok: true };
    },
    onReconnect(id) { if (g.heroes[id] && !isBot(id)) g.heroes[id].bot = false; sendGm(); ctx.update(); },
    onDisconnect(id) { leave(id); ctx.update(); },
    canJoin: () => ["setup", "over", "roundOver"].includes(g.phase),
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startGame();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); clearTimeout(g.timer); },
  };
}
