// ===================================================================
//  GOLF DE COMBAT — Moteur du jeu (module du hub Le Bordel)
//  Mini-golf vu de dessus, tout le monde joue le même trou EN MÊME TEMPS.
//  On vise, on maintient le clic pour doser la force, on lâche. Les balles
//  se cognent : on peut sortir celle d'un adversaire vers l'eau.
//  Le moins de coups gagne le trou. Dans l'eau : +1 coup, on rejoue d'où on a tiré.
// ===================================================================

import "../../public/games/golf/course.js";

const G = globalThis.Golf;
export const meta = {
  id: "golf",
  name: "Golf de combat",
  emoji: "⛳",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Mini-golf où tout le monde joue en même temps : dose ta force… et envoie leurs balles à l'eau !",
};

const TICK_MS = 1000 / 30;
export const SHOT_MAX = 1300, CHARGE_S = 1.1;      // la force : jusqu'à 1300 px/s, pleine charge en 1,1 s
export const HOLE_MS = 90000, AFTER_FIRST = 30000;  // un trou : 90 s au plus, et 30 s après le premier dans le trou
export const MAX_STROKES = 10;
const COUNTDOWN_MS = 3000, END_DELAY = 1500, ROUND_OVER_MS = 6000, FINISH_DELAY = 15000;
export const POINTS = [10, 7, 5, 3, 2, 1];

function defaultSettings() { return { rounds: 6 }; }
export const playlist = {
  options: [{ key: "rounds", label: "Trous", default: "6", choices: [{ v: "4", label: "4" }, { v: "6", label: "6" }, { v: "9", label: "9" }] }],
  settingsFor(c) { return { rounds: [4, 6, 9].includes(Number(c.rounds)) ? Number(c.rounds) : 6 }; },
};
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function createGame(ctx) {
  const g = {
    phase: "setup",
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, total: {}, round: 0,
    hole: null, balls: {},   // id -> { x, y, vx, vy, from, strokes, done, charging, aim, bot, ai, seq, prevK, doneAt }
    playAt: 0, firstIn: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };
  const moving = (b) => b.vx !== 0 || b.vy !== 0;

  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, seed: g.hole?.seed,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      total: g.total,
      balls: Object.entries(g.balls).map(([id, b]) => ({ id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: Math.round(b.vx), vy: Math.round(b.vy), strokes: b.strokes, done: b.done, charge: b.charging ? Math.min(1, (t - b.charging) / (CHARGE_S * 1000)) : 0, aim: Math.round(b.aim * 100) / 100 })),
      timeLeft: g.phase === "play" ? Math.max(0, Math.min(HOLE_MS - (t - g.playAt), g.firstIn ? AFTER_FIRST - (t - g.firstIn) : 1e9)) : HOLE_MS,
      firstIn: !!g.firstIn,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  function startGame() {
    g.scores = {}; g.total = {}; g.round = 0;
    for (const p of players().filter((p) => p.connected)) { g.scores[p.id] = 0; g.total[p.id] = 0; }
    startRound();
  }
  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    g.hole = G.build((Math.random() * 2 ** 31) >>> 0);
    g.balls = {};
    list.forEach((p, i) => {
      // Les balles au départ, un peu écartées les unes des autres.
      const x = g.hole.tee.x + (i % 2) * 24, y = g.hole.tee.y + (i - (list.length - 1) / 2) * 22;
      const ok = G.onCourse(g.hole, x, y);
      g.balls[p.id] = { x: ok ? x : g.hole.tee.x, y: ok ? y : g.hole.tee.y, vx: 0, vy: 0, from: null, strokes: 0, done: false, charging: 0, aim: 0, bot: !!p.bot, ai: {}, seq: 0, prevK: 0, lastInputAt: 0 };
      g.scores[p.id] = g.scores[p.id] || 0; g.total[p.id] = g.total[p.id] || 0;
    });
    g.firstIn = 0; g.endAt = 0; g.lastRound = null; g.feed = []; g.fx = [];
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }
  function endRound() {
    stopLoop();
    // Ceux qui ne sont pas dans le trou : leurs coups + 2.
    for (const b of Object.values(g.balls)) if (!b.done) b.strokes = Math.min(MAX_STROKES + 2, b.strokes + 2);
    const ids = Object.keys(g.balls).sort((a, b) => g.balls[a].strokes - g.balls[b].strokes);
    const gains = {};
    let rank = 0;
    ids.forEach((id, i) => { if (i > 0 && g.balls[id].strokes > g.balls[ids[i - 1]].strokes) rank = i; gains[id] = POINTS[rank] || 0; });
    for (const [id, n] of Object.entries(gains)) { g.scores[id] = (g.scores[id] || 0) + n; g.total[id] = (g.total[id] || 0) + g.balls[id].strokes; }
    g.lastRound = { gains, order: ids, strokes: Object.fromEntries(ids.map((id) => [id, g.balls[id].strokes])), done: Object.fromEntries(ids.map((id) => [id, g.balls[id].done])), par: g.hole.par };
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

  // Viser + doser : clic maintenu (la force monte), relâché = la balle part. Seulement quand elle est arrêtée.
  function act(id, k, aim) {
    const b = g.balls[id];
    if (!b || b.done) return;
    const t = now();
    if (typeof aim === "number") b.aim = aim;
    const fire = k & 32;
    if (g.phase !== "play" || moving(b) || b.strokes >= MAX_STROKES) { b.charging = 0; b.prevK = k; return; }
    if (fire && !b.charging) b.charging = t;
    if (!fire && b.charging) {
      const c = Math.max(0.04, Math.min(1, (t - b.charging) / (CHARGE_S * 1000)));
      b.charging = 0;
      b.from = { x: b.x, y: b.y };
      b.vx = Math.cos(b.aim) * SHOT_MAX * c; b.vy = Math.sin(b.aim) * SHOT_MAX * c;
      b.strokes++;
      addFx({ kind: "coup", x: Math.round(b.x), y: Math.round(b.y), who: id });
    }
    b.prevK = k;
  }

  function stepBalls(dt) {
    const t = now();
    const list = Object.entries(g.balls).filter(([, b]) => !b.done);
    for (const [id, b] of list) {
      if (!moving(b)) continue;
      const res = G.roll(g.hole, b, dt);
      if (b.bumped) { b.bumped = false; addFx({ kind: "bump", x: Math.round(b.x), y: Math.round(b.y) }); }
      if (res === "eau") {
        b.strokes++;
        addFx({ kind: "plouf", x: Math.round(b.x), y: Math.round(b.y), who: id });
        const back = b.from && G.onCourse(g.hole, b.from.x, b.from.y) && !G.inWater(g.hole, b.from.x, b.from.y) ? b.from : g.hole.tee;
        b.x = back.x; b.y = back.y; b.vx = 0; b.vy = 0;
        say(`💦 ${pseudo(id)} est à l'eau (+1 coup)`);
      } else if (res === "trou") {
        b.done = true; b.vx = 0; b.vy = 0; b.x = g.hole.cup.x; b.y = g.hole.cup.y;
        addFx({ kind: "trou", x: Math.round(b.x), y: Math.round(b.y), who: id });
        say(b.strokes === 1 ? `🏆 TROU EN UN de ${pseudo(id)} !` : `⛳ ${pseudo(id)} : dans le trou en ${b.strokes} coups`);
        if (!g.firstIn) g.firstIn = t;
      }
    }
    // Les balles se cognent (même une balle arrêtée peut être poussée).
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i][1], c = list[j][1];
      if (a.done || c.done) continue;
      if (G.collide(a, c)) addFx({ kind: "choc", x: Math.round((a.x + c.x) / 2), y: Math.round((a.y + c.y) / 2) });
    }
    if (!g.endAt && Object.values(g.balls).every((b) => b.done || (b.strokes >= MAX_STROKES && !moving(b)))) g.endAt = t + END_DELAY;
  }

  // =================================================================
  //  BOTS : ils visent le trou (ou un point du chemin s'il est caché), et dosent avec un peu d'erreur
  // =================================================================
  const lineClear = (x0, y0, x1, y1) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 10); for (let i = 1; i < n; i++) { const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n; if (!G.onCourse(g.hole, x, y) || G.inWater(g.hole, x, y)) return false; } return true; };
  // La force qu'il faut pour qu'une balle s'arrête après d (le gazon freine de façon exponentielle).
  const powerFor = (d) => { const k = -Math.log(1 - G.ROLL); return Math.min(SHOT_MAX, d * k + 30); };
  function botInput(id, b) {
    const t = now(), ai = b.ai;
    if (moving(b) || b.done) { ai.plan = null; return { k: 0, aim: b.aim }; }
    if (!ai.plan) {
      if (t < (ai.thinkUntil || 0)) return { k: 0, aim: b.aim };
      ai.thinkUntil = t + 500 + Math.random() * 900;
      const h = g.hole;
      // La cible : le trou s'il est visible, sinon le milieu du couloir le plus avancé qu'on voit.
      let target = null;
      if (lineClear(b.x, b.y, h.cup.x, h.cup.y)) target = { x: h.cup.x, y: h.cup.y, cup: true };
      else {
        const pts = [];
        h.segs.forEach((s, i) => { for (let k = 0.2; k < 1; k += 0.2) pts.push({ x: s.x + s.w / 2 + (s.w > s.h ? (k - 0.5) * s.w : 0), y: s.y + s.h / 2 + (s.w > s.h ? 0 : (k - 0.5) * s.h), score: i + k }); });
        for (const p of pts.sort((a, c) => c.score - a.score)) if (lineClear(b.x, b.y, p.x, p.y)) { target = p; break; }
        if (!target) target = { x: h.cup.x, y: h.cup.y };
      }
      const d = Math.hypot(target.x - b.x, target.y - b.y);
      const err = 0.05 + Math.random() * 0.06;
      const aim = Math.atan2(target.y - b.y, target.x - b.x) + (Math.random() - 0.5) * err;
      const v = powerFor(target.cup ? d + 20 : d) * (0.88 + Math.random() * 0.24);
      ai.plan = { aim, hold: (v / SHOT_MAX) * CHARGE_S * 1000, start: 0 };
    }
    const p = ai.plan;
    if (!p.start) p.start = t;
    if (t - p.start < p.hold) return { k: 32, aim: p.aim };
    ai.plan = null;
    return { k: 0, aim: p.aim };
  }

  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000);
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      for (const [id, b] of Object.entries(g.balls)) if (b.bot) { const x = botInput(id, b); act(id, x.k, x.aim); }
      stepBalls(dt);
      if (!g.endAt && (t - g.playAt >= HOLE_MS || (g.firstIn && t - g.firstIn >= AFTER_FIRST))) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }
  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![4, 6, 9].includes(s.rounds)) s.rounds = 6;
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
    // { s, k, a } : touches (32 = clic maintenu) et angle visé.
    in(pid, { s, k, a }) {
      const b = g.balls[pid];
      if (!b || b.bot || typeof s !== "number" || s <= b.seq) return;
      b.seq = s;
      b.lastInputAt = now();
      act(pid, k & 32, typeof a === "number" && isFinite(a) ? a : null);
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
  g.__step = stepBalls;    // (pour les tests)

  return {
    publicState,
    _g: g,
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data || {}) || { ok: true };
    },
    onReconnect() { ctx.update(); },
    onDisconnect(id) { const b = g.balls[id]; if (b) { b.bot = true; } ctx.update(); },
    canJoin: () => ["setup", "over", "roundOver"].includes(g.phase),
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startGame();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
