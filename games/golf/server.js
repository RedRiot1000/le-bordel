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
export const HOLE_MS = 124000, AFTER_FIRST = 30000;  // un trou : de 52 s à 2 min selon sa longueur, et 30 s après le premier dans le trou
export const MAX_STROKES = 12;
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
  // Le temps d'un trou dépend de sa longueur.
  const holeMs = () => 40000 + 12000 * (g.hole?.segs.length || 3);

  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, seed: g.hole?.seed,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      total: g.total,
      balls: Object.entries(g.balls).map(([id, b]) => ({ id, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: Math.round(b.vx), vy: Math.round(b.vy), strokes: b.strokes, done: b.done, charge: b.charging ? Math.min(1, (t - b.charging) / (CHARGE_S * 1000)) : 0, aim: Math.round(b.aim * 100) / 100 })),
      timeLeft: g.phase === "play" ? Math.max(0, Math.min(holeMs() - (t - g.playAt), g.firstIn ? AFTER_FIRST - (t - g.firstIn) : 1e9)) : HOLE_MS,
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
    } else if (!last) {          // (la manche suivante se lance toute seule)
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
  //  BOTS : ils essaient des coups « dans leur tête » et gardent celui qui rapproche le plus du trou
  //  (en suivant le parcours, pas à vol d'oiseau), avec un peu d'erreur au moment de taper.
  // =================================================================
  const CELL = 20;
  let field = null, fieldSeed = null;
  // La distance au trou en suivant le gazon, case par case.
  function distField() {
    if (fieldSeed === g.hole.seed) return field;
    const cw = Math.ceil(G.W / CELL), ch = Math.ceil(G.H / CELL), f = new Float32Array(cw * ch).fill(1e9);
    const ok = (c, r) => { const x = c * CELL + CELL / 2, y = r * CELL + CELL / 2; return G.onCourse(g.hole, x, y) && !G.inWater(g.hole, x, y); };
    const start = Math.floor(g.hole.cup.y / CELL) * cw + Math.floor(g.hole.cup.x / CELL);
    f[start] = 0;
    let q = [start];
    while (q.length) {
      const nx = [];
      for (const k of q) {
        const c = k % cw, r = (k - c) / cw;
        for (const [dx, dy, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.41], [1, -1, 1.41], [-1, 1, 1.41], [-1, -1, 1.41]]) {
          const a = c + dx, b = r + dy;
          if (a < 0 || b < 0 || a >= cw || b >= ch) continue;
          const n = b * cw + a;
          if (f[n] <= f[k] + w || !ok(a, b)) continue;
          f[n] = f[k] + w; nx.push(n);
        }
      }
      q = nx;
    }
    field = { f, cw }; fieldSeed = g.hole.seed;
    return field;
  }
  const geo = (x, y) => { const F = distField(), c = Math.floor(x / CELL), r = Math.floor(y / CELL); const v = F.f[r * F.cw + c]; return v >= 1e9 ? 1e6 : v * CELL; };
  // Où s'arrêterait la balle ? (« trou », « eau », ou la position)
  function tryShot(b, a, v) {
    const t = { x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v };
    for (let k = 0; k < 360 && (t.vx || t.vy); k++) {
      const r = G.roll(g.hole, t, 1 / 30);
      if (r) return { res: r, x: t.x, y: t.y };
    }
    return { res: null, x: t.x, y: t.y };
  }
  function botInput(id, b) {
    const t = now(), ai = b.ai;
    if (moving(b) || b.done) { ai.plan = null; return { k: 0, aim: b.aim }; }
    if (!ai.plan) {
      if (t < (ai.thinkUntil || 0)) return { k: 0, aim: b.aim };
      ai.thinkUntil = t + 600 + Math.random() * 1000;
      const here = geo(b.x, b.y), cands = [];
      for (let i = 0; i < 32; i++) {
        const a = (i / 32) * Math.PI * 2 + Math.random() * 0.1;
        for (const v of [220, 380, 560, 780, 1020, 1300]) {
          const r = tryShot(b, a, v);
          const score = r.res === "trou" ? -1 : r.res === "eau" ? 1e7 : geo(r.x, r.y);
          cands.push({ a, v, score });
        }
      }
      cands.sort((x, y) => x.score - y.score);
      // Pas toujours le meilleur : un des 3 meilleurs, et une petite erreur.
      const pick = cands[Math.floor(Math.random() * Math.min(3, cands.length))];
      const useful = pick.score < here - 20 || pick.score < 0 ? pick : cands[0];
      ai.plan = { aim: useful.a + (Math.random() - 0.5) * 0.05, hold: (Math.min(SHOT_MAX, useful.v * (0.94 + Math.random() * 0.12)) / SHOT_MAX) * CHARGE_S * 1000, start: 0 };
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
      if (!g.endAt && (t - g.playAt >= holeMs() || (g.firstIn && t - g.firstIn >= AFTER_FIRST))) g.endAt = t;
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
