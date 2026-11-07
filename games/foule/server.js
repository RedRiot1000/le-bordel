// ===================================================================
//  FOULE — Moteur du jeu (module du hub Le Bordel)
//  Une place la nuit, pleine de passants (des bots). Les joueurs leur
//  ressemblent exactement. Il faut repérer les vrais joueurs à leur façon de
//  bouger et les frapper au contact, sans se trahir. Frapper un passant par
//  erreur te révèle à tout le monde pendant 3 s.
//  L'état public ne dit JAMAIS qui est un joueur : chacun reçoit en privé
//  (ctx.sendTo) quel personnage est le sien.
// ===================================================================

import "../../public/games/pieton/engine.js";

const H = globalThis.Pieton;
const K = H.K;

export const meta = {
  id: "foule",
  name: "Foule",
  emoji: "🕴️",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Fonds-toi dans la foule, repère les vrais joueurs et frappe-les… sans te trahir.",
};

const TICK_MS = 1000 / 30;
export const W = 1280, HGT = 800;
export const WALK = 0.44;              // vitesse des joueurs (× la vitesse normale) : comme un passant pressé
export const HIT_R = 46;               // portée du coup
export const HIT_CD = 1500;            // recharge du coup
export const REVEAL_MS = 3000;         // frapper un passant te révèle 3 s
export const ROUND_MS = 120000;
export const SURVIVE_EVERY = 20000;    // +1 point toutes les 20 s en vie
const COUNTDOWN_MS = 3000, END_DELAY = 1800, ROUND_OVER_MS = 7000, FINISH_DELAY = 15000, BODY_MS = 7000;
export const COATS = ["#6b6f7a", "#8a6f5a", "#5f6f5f", "#7a5f6f", "#a39a88", "#4f5a6e"];
export const HATS = [null, "#1d1d22", "#3a2f28", "#5a5560"];

function defaultSettings() { return { rounds: 4 }; }
export const playlist = {
  options: [{ key: "rounds", label: "Manches", default: "4", choices: [{ v: "3", label: "3" }, { v: "4", label: "4" }, { v: "6", label: "6" }] }],
  settingsFor(c) { return { ...defaultSettings(), rounds: [3, 4, 6].includes(Number(c.rounds)) ? Number(c.rounds) : 4 }; },
};

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// La place : une fontaine au milieu, des bancs, des kiosques, des arbres en bac.
export function buildPlaza() {
  const rects = [{ x: W / 2 - 70, y: HGT / 2 - 70, w: 140, h: 140, kind: "fontaine" }];
  const tries = [];
  for (let i = 0; i < 40 && rects.length < 14; i++) {
    const kind = pick(["banc", "banc", "kiosque", "arbre"]);
    const horiz = Math.random() < 0.5;
    const w = kind === "banc" ? (horiz ? 90 : 26) : kind === "kiosque" ? 70 : 34, h = kind === "banc" ? (horiz ? 26 : 90) : kind === "kiosque" ? 70 : 34;
    const o = { x: rand(70, W - 70 - w), y: rand(70, HGT - 70 - h), w, h, kind };
    if (rects.some((p) => o.x < p.x + p.w + 80 && o.x + o.w + 80 > p.x && o.y < p.y + p.h + 80 && o.y + o.h + 80 > p.y)) continue;
    rects.push(o); tries.push(o);
  }
  // Les lampadaires (décor) et les points où vont les passants.
  const lamps = Array.from({ length: 7 }, () => ({ x: rand(80, W - 80), y: rand(80, HGT - 80) }));
  return { rects, lamps };
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0,
    plaza: null,
    ents: [],             // tout le monde : { e, h, coat, hat, player (id ou null), alive, revUntil, hitReady, ai, speed }
    byPlayer: {},         // id du joueur -> son personnage
    bodies: [],
    playAt: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };
  const livePlayers = () => g.ents.filter((x) => x.player && x.alive);
  const envOf = (x) => ({ walls: true, w: W, h: HGT, noDash: true, speedMul: x.speed, rects: g.plaza.rects });

  // =================================================================
  //  ÉTAT PUBLIC (le même pour tout le monde : aucun indice sur qui est un joueur)
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      plaza: g.plaza,
      ents: g.ents.filter((x) => x.alive).map((x) => ({
        e: x.e, x: Math.round(x.h.x * 10) / 10, y: Math.round(x.h.y * 10) / 10, vx: Math.round(x.h.vx), vy: Math.round(x.h.vy),
        face: Math.round(x.h.face * 100) / 100, walk: Math.round(x.h.walk * 100) / 100, coat: x.coat, hat: x.hat, rev: t < x.revUntil,
      })),
      bodies: g.bodies.map((b) => ({ x: b.x, y: b.y, coat: b.coat, hat: b.hat, face: b.face })),
      left: livePlayers().length,
      timeLeft: g.phase === "play" ? Math.max(0, ROUND_MS - (t - g.playAt)) : ROUND_MS,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 500).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }
  // Ce que chaque joueur reçoit pour lui seul : son personnage et sa position exacte (pour la prédiction).
  function sendPrivate() {
    const t = now();
    for (const [pid, x] of Object.entries(g.byPlayer)) {
      if (x.bot) continue;
      ctx.sendTo(pid, "me", { e: x.e, round: g.round, seq: x.seq, alive: x.alive, hitIn: Math.max(0, x.hitReady - t), speed: x.speed, ...H.copy(x.h) });
    }
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {}; g.round = 0;
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }

  function freeSpot() {
    for (let i = 0; i < 200; i++) {
      const p = { x: rand(50, W - 50), y: rand(50, HGT - 50) };
      if (g.plaza.rects.some((o) => p.x > o.x - 30 && p.x < o.x + o.w + 30 && p.y > o.y - 30 && p.y < o.y + o.h + 30)) continue;
      if (g.ents.some((x) => dist(x.h, p) < 40)) continue;
      return p;
    }
    return { x: 60, y: 60 };
  }

  function startRound() {
    const list = players().filter((p) => p.connected);
    g.round++;
    g.plaza = buildPlaza();
    g.ents = []; g.byPlayer = {}; g.bodies = [];
    const npcs = 22 + list.length * 3;
    const ids = shuffle(Array.from({ length: npcs + list.length }, (_, i) => i + 1));
    let k = 0;
    const make = (player, bot) => {
      const p = freeSpot();
      const x = { e: ids[k++], h: H.newHero(p.x, p.y, rand(0, Math.PI * 2)), coat: pick(COATS), hat: pick(HATS), player, bot, alive: true, revUntil: 0, hitReady: 0, prevK: 0, seq: 0, lastInputAt: 0, aliveMs: 0, kills: 0,
        speed: player ? WALK : rand(0.36, 0.46), ai: { goal: null, pauseUntil: 0 } };
      g.ents.push(x);
      return x;
    };
    for (let i = 0; i < npcs; i++) make(null, true);
    for (const p of list) { g.byPlayer[p.id] = make(p.id, !!p.bot); g.scores[p.id] = g.scores[p.id] || 0; }
    g.ents = shuffle(g.ents);
    g.endAt = 0; g.lastRound = null; g.feed = []; g.fx = [];
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }

  function endRound() {
    stopLoop();
    const gains = {};
    const alive = livePlayers();
    for (const [pid, x] of Object.entries(g.byPlayer)) {
      let n = x.kills * 3 + Math.floor(x.aliveMs / SURVIVE_EVERY);
      if (x.alive && alive.length === 1) n += 3;
      gains[pid] = n;
      g.scores[pid] = (g.scores[pid] || 0) + n;
    }
    const order = Object.keys(g.byPlayer).sort((a, b) => gains[b] - gains[a]);
    g.lastRound = { gains, order, kills: Object.fromEntries(order.map((id) => [id, g.byPlayer[id].kills])), alive: Object.fromEntries(order.map((id) => [id, g.byPlayer[id].alive])), survivor: alive.length === 1 ? alive[0].player : null };
    const last = g.round >= g.settings.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last && ctx.playlist) {
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
  //  BOUGER, FRAPPER
  // =================================================================
  function move(x, k) {
    const env = envOf(x), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(x.h, k & (K.UP | K.DOWN | K.LEFT | K.RIGHT), null, dt, env);
      H.collideWalls(x.h, env);
      for (const o of g.ents) if (o !== x && o.alive) H.collideHeroes(x.h, o.h);
    }
  }
  function act(x, k) {
    if (!x.alive) return;
    move(x, k);
    const t = now();
    if (g.phase === "play" && k & (K.FIRE | K.DASH) && !(x.prevK & (K.FIRE | K.DASH)) && t >= x.hitReady) strike(x, t);
    x.prevK = k;
  }
  // Le coup : il touche le plus proche à portée. Un joueur tombe ; un passant aussi, mais ça te révèle.
  function strike(x, t) {
    x.hitReady = t + HIT_CD;
    let best = null, bd = HIT_R;
    for (const o of g.ents) { if (o === x || !o.alive) continue; const d = dist(o.h, x.h); if (d < bd) { bd = d; best = o; } }
    addFx({ kind: "coup", x: Math.round(x.h.x), y: Math.round(x.h.y), a: Math.round(x.h.face * 100) / 100 });
    if (!best) return;
    best.alive = false;
    g.bodies.push({ x: Math.round(best.h.x), y: Math.round(best.h.y), coat: best.coat, hat: best.hat, face: best.h.face, until: t + BODY_MS });
    addFx({ kind: "chute", x: Math.round(best.h.x), y: Math.round(best.h.y) });
    if (best.player) {
      x.kills++;
      say(`💀 ${pseudo(best.player)} est tombé !`);
      if (livePlayers().length <= 1 && !g.endAt) g.endAt = t + END_DELAY;
    } else {
      x.revUntil = t + REVEAL_MS;
      say("😱 Un passant innocent est tombé… le coupable est révélé !");
    }
  }

  // =================================================================
  //  PASSANTS ET BOTS
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const keyTo = (h, p) => KEYS[Math.round(((Math.atan2(p.y - h.y, p.x - h.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  const blocked = (x, y) => x < 30 || y < 30 || x > W - 30 || y > HGT - 30 || g.plaza.rects.some((o) => x > o.x - 22 && x < o.x + o.w + 22 && y > o.y - 22 && y < o.y + o.h + 22);
  // Un passant : il va quelque part, s'arrête, regarde autour, repart.
  function wander(x, t) {
    const ai = x.ai, h = x.h;
    if (t < ai.pauseUntil) return 0;
    if (!ai.goal || dist(h, ai.goal) < 20 || t > ai.giveUp) {
      if (ai.goal && Math.random() < 0.55) { ai.pauseUntil = t + rand(400, 3200); ai.goal = null; return 0; }
      ai.goal = freeSpot(); ai.giveUp = t + 12000;
    }
    let k = keyTo(h, ai.goal);
    const i = KEYS.indexOf(k), ang = (i * Math.PI) / 4;
    if (blocked(h.x + Math.cos(ang) * 34, h.y + Math.sin(ang) * 34)) { ai.side = ai.side || (Math.random() < 0.5 ? 1 : -1); k = KEYS[(i + ai.side * 2 + 8) % 8]; }
    return k;
  }
  // Un joueur bot : il se comporte comme un passant, et de temps en temps il « soupçonne » quelqu'un et va le frapper.
  function hunter(x, t) {
    const ai = x.ai;
    if (ai.target && (!ai.target.alive || t > ai.huntUntil)) ai.target = null;
    if (!ai.target && t >= (ai.nextHunt || t + 1)) {
      ai.nextHunt = t + rand(7000, 15000);
      const others = g.ents.filter((o) => o !== x && o.alive);
      const real = others.filter((o) => o.player), revealed = others.filter((o) => t < o.revUntil);
      // Il devine juste de temps en temps (un révélé, c'est presque sûr).
      ai.target = revealed.length && Math.random() < 0.8 ? pick(revealed) : real.length && Math.random() < 0.22 ? pick(real) : pick(others);
      ai.huntUntil = t + 9000;
    }
    if (!ai.nextHunt) ai.nextHunt = t + rand(3000, 7000);
    if (ai.target) {
      const d = dist(ai.target.h, x.h);
      if (d < HIT_R - 8 && t >= x.hitReady) { ai.target = null; return K.FIRE; }
      return keyTo(x.h, ai.target.h);
    }
    return wander(x, t);
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000);
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      for (const x of g.ents) {
        if (!x.alive) continue;
        if (!x.player) act(x, wander(x, t));
        else if (x.bot) act(x, hunter(x, t));
        else if (t - x.lastInputAt > 200) act(x, 0);
        if (x.player) x.aliveMs += dt * 1000;
      }
      g.bodies = g.bodies.filter((b) => t < b.until);
      if (!g.endAt && t - g.playAt >= ROUND_MS) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    sendPrivate();
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }
  function leave(id) {
    const x = g.byPlayer[id];
    if (!x?.alive || !["countdown", "play"].includes(g.phase)) return;
    x.alive = false;
    if (livePlayers().length <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 4, 6].includes(s.rounds)) s.rounds = 4;
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
    in(pid, { s, k }) {
      const x = g.byPlayer[pid];
      if (!x || x.bot || typeof s !== "number" || s <= x.seq) return;
      const t = now();
      x.seq = s;
      x.lastInputAt = t;
      if (g.phase !== "play") return;
      x.budget = Math.min(6, (x.budget ?? 6) + (t - (x.budgetAt || t)) * 0.036);
      x.budgetAt = t;
      if (x.budget < 1) return;
      x.budget -= 1;
      act(x, k & 63);
    },
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

  return {
    publicState,
    _g: g,
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data || {}) || { ok: true };
    },
    onReconnect() { sendPrivate(); ctx.update(); },
    onDisconnect(id) { leave(id); ctx.update(); },
    canJoin: () => ["setup", "over", "roundOver"].includes(g.phase),
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startGame();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
