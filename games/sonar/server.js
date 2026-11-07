// ===================================================================
//  SONAR — Moteur du jeu (module du hub Le Bordel)
//  Une arène dans le noir. Personne ne voit personne : on entend les pas
//  (des échos visibles par tous), on lance un « ping » qui révèle ce qui
//  est autour… mais qui trahit aussi sa position. Un tir = une mort.
//  Marcher doucement (Espace maintenu) ne fait pas de bruit.
//  L'état public ne donne JAMAIS la position des joueurs : chacun reçoit en
//  privé sa propre position et ce que ses pings lui révèlent.
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/sonar/map.js";

const H = globalThis.Pieton;
const K = H.K;
export const PING = 64;                  // touche « ping » (clic droit)

export const meta = {
  id: "sonar",
  name: "Sonar",
  emoji: "📡",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Dans le noir total : écoute les pas, lance un ping, tire juste. Chaque bruit te trahit.",
};

const TICK_MS = 1000 / 30;
export const W = 1280, HGT = 800;
export const RUN = 0.9, SNEAK = 0.42;    // vitesses (× la normale) : normale (bruyante) et à pas de loup
export const STEP_EVERY = 0.32;          // un écho de pas toutes les 0,32 s quand on marche normalement
export const PING_R = 430, PING_CD = 3500;
export const DART_V = 1000, RELOAD = 1400;
export const SWEEP_AT = 60000, SWEEP_EVERY = 8000;   // après 60 s : un grand balayage révèle tout le monde toutes les 8 s
const COUNTDOWN_MS = 3000, END_DELAY = 1500, ROUND_OVER_MS = 6000, FINISH_DELAY = 15000, MAX_MS = 120000;

function defaultSettings() { return { rounds: 6 }; }
export const playlist = {
  options: [{ key: "rounds", label: "Manches", default: "6", choices: [{ v: "4", label: "4" }, { v: "6", label: "6" }, { v: "9", label: "9" }] }],
  settingsFor(c) { return { ...defaultSettings(), rounds: [4, 6, 9].includes(Number(c.rounds)) ? Number(c.rounds) : 6 }; },
};

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// L'arène est dans un fichier partagé avec le navigateur.
export const buildMap = (seed) => globalThis.SonarMap.build(seed);
// Le segment touche-t-il un rectangle ?
function segHitsRect(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0,
    map: null,
    heroes: {},           // id -> { h, alive, sneak, stepT, pingReady, reloadAt, bot, seq, lastInputAt, prevK, elims, aim, ai }
    darts: [], dartId: 0,
    steps: [], pings: [], order: [], feed: [],
    playAt: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0, nextSweep: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const alive = () => Object.keys(g.heroes).filter((id) => g.heroes[id].alive);
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 60) g.fx.shift(); };
  const envOf = (s) => ({ walls: true, w: W, h: HGT, noDash: true, speedMul: s.sneak ? SNEAK : RUN, rects: g.map.rects });

  // =================================================================
  //  ÉTAT PUBLIC : les bruits (pas, pings, tirs), jamais les positions
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, seed: g.map?.seed,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      alive: alive().length,
      darts: g.darts.map((d) => ({ id: d.id, x: Math.round(d.x), y: Math.round(d.y), vx: Math.round(d.vx), vy: Math.round(d.vy) })),
      steps: g.steps.filter((s) => t - s.t < 900).map((s) => ({ id: s.id, x: s.x, y: s.y, age: t - s.t })),
      pings: g.pings.filter((p) => t - p.t < 1400).map((p) => ({ id: p.id, x: p.x, y: p.y, age: t - p.t, big: !!p.big })),
      dead: g.order.map((id) => ({ id, x: Math.round(g.heroes[id].h.x), y: Math.round(g.heroes[id].h.y) })),
      sweepIn: g.phase === "play" && t - g.playAt > SWEEP_AT - 5000 ? Math.max(0, g.nextSweep - t) : null,
      timeLeft: g.phase === "play" ? Math.max(0, MAX_MS - (t - g.playAt)) : MAX_MS,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 500).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }
  function sendPrivate() {
    const t = now();
    for (const [id, s] of Object.entries(g.heroes)) {
      if (s.bot) continue;
      ctx.sendTo(id, "me", { round: g.round, seq: s.seq, alive: s.alive, sneak: s.sneak, pingIn: Math.max(0, s.pingReady - t), reloadIn: Math.max(0, s.reloadAt - t), ...H.copy(s.h) });
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
  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    g.map = buildMap((Math.random() * 2 ** 31) >>> 0);
    g.heroes = {};
    const spots = shuffle(g.map.spawns);
    list.forEach((p, i) => {
      const sp = spots[i % spots.length];
      g.heroes[p.id] = { h: H.newHero(sp.x, sp.y, Math.atan2(HGT / 2 - sp.y, W / 2 - sp.x)), alive: true, sneak: false, stepT: 0, pingReady: 0, reloadAt: 0, bot: !!p.bot, seq: 0, lastInputAt: 0, prevK: 0, elims: 0, aim: 0, ai: { heard: [] } };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.darts = []; g.steps = []; g.pings = []; g.order = []; g.feed = []; g.fx = [];
    g.endAt = 0; g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }
  function eliminate(id, by) {
    const s = g.heroes[id];
    if (!s?.alive) return;
    s.alive = false;
    g.order.push(id);
    addFx({ kind: "mort", x: Math.round(s.h.x), y: Math.round(s.h.y) });
    if (by && g.heroes[by]) { g.heroes[by].elims++; say(`📡 ${pseudo(by)} a eu ${pseudo(id)} dans le noir`); }
    else say(`💀 ${pseudo(id)} est tombé`);
    if (alive().length <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }
  function endRound() {
    stopLoop();
    const gains = {}, winners = alive();
    [...g.order, ...winners].forEach((id, i) => { gains[id] = i + g.heroes[id].elims; });
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = { gains, winner: winners.length === 1 ? winners[0] : null, order: [...winners, ...g.order.slice().reverse()], elims: Object.fromEntries(Object.keys(g.heroes).map((id) => [id, g.heroes[id].elims])) };
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
  //  BOUGER, PING, TIRER
  // =================================================================
  // Un ping : il révèle (en privé) tout ce qui est dans le rayon, et tout le monde voit d'où il part.
  function ping(id, s, t, big = false) {
    const id2 = ++g.fxId;
    g.pings.push({ id: id2, x: Math.round(s.h.x), y: Math.round(s.h.y), t, big });
    if (g.pings.length > 20) g.pings.shift();
    const seen = [];
    for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && o.alive && dist(o.h, s.h) < PING_R) seen.push({ x: Math.round(o.h.x), y: Math.round(o.h.y) });
    if (!s.bot) ctx.sendTo(id, "reveal", { x: Math.round(s.h.x), y: Math.round(s.h.y), seen, r: PING_R });
    else s.ai.seen = { at: t, list: seen };
  }
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s?.alive) return;
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    s.sneak = !!(k & K.DASH);
    const env = envOf(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, k & (K.UP | K.DOWN | K.LEFT | K.RIGHT), s.aim, dt, env);
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && o.alive) H.collideHeroes(s.h, o.h);
    }
    // Les pas : un écho (visible par tous) quand on marche normalement.
    const moving = Math.hypot(s.h.vx, s.h.vy) > 40;
    if (moving && !s.sneak) {
      s.stepT += H.TICK;
      if (s.stepT >= STEP_EVERY) { s.stepT = 0; g.steps.push({ id: ++g.fxId, x: Math.round(s.h.x), y: Math.round(s.h.y), t, by: id }); if (g.steps.length > 80) g.steps.shift(); }
    } else s.stepT = Math.min(s.stepT, STEP_EVERY * 0.6);
    if (g.phase === "play") {
      if (k & PING && !(s.prevK & PING) && t >= s.pingReady) { s.pingReady = t + PING_CD; ping(id, s, t); }
      if (k & K.FIRE && !(s.prevK & K.FIRE) && t >= s.reloadAt) {
        s.reloadAt = t + RELOAD;
        const a = s.aim;
        g.darts.push({ id: ++g.dartId, by: id, x: s.h.x + Math.cos(a) * 24, y: s.h.y + Math.sin(a) * 24, vx: Math.cos(a) * DART_V, vy: Math.sin(a) * DART_V, age: 0 });
        addFx({ kind: "tir", x: Math.round(s.h.x), y: Math.round(s.h.y) });    // le coup de feu se voit
      }
    }
    s.prevK = k;
  }
  function stepDarts(dt) {
    for (const d of [...g.darts]) {
      const x0 = d.x, y0 = d.y;
      d.x += d.vx * dt; d.y += d.vy * dt; d.age += dt;
      let gone = d.x < 0 || d.y < 0 || d.x > W || d.y > HGT || d.age > 2;
      if (!gone && g.map.rects.some((r) => segHitsRect(x0, y0, d.x, d.y, r))) { gone = true; addFx({ kind: "impact", x: Math.round(d.x), y: Math.round(d.y) }); }
      if (!gone) for (const [oid, o] of Object.entries(g.heroes)) {
        if (!o.alive || oid === d.by) continue;
        const dx = d.x - x0, dy = d.y - y0, L2 = dx * dx + dy * dy || 1;
        const f = Math.max(0, Math.min(1, ((o.h.x - x0) * dx + (o.h.y - y0) * dy) / L2));
        if (Math.hypot(x0 + dx * f - o.h.x, y0 + dy * f - o.h.y) < H.R + 3) { gone = true; eliminate(oid, d.by); break; }
      }
      if (gone) g.darts = g.darts.filter((x) => x !== d);
    }
  }

  g.__step = stepDarts;      // (pour les tests)

  // =================================================================
  //  BOTS : ils écoutent les pas et les pings, pingent de temps en temps, avancent à pas de loup
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const keyTo = (h, p) => KEYS[Math.round(((Math.atan2(p.y - h.y, p.x - h.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  const clearShot = (a, b) => !g.map.rects.some((r) => segHitsRect(a.x, a.y, b.x, b.y, r));
  function botInput(id, s) {
    const h = s.h, ai = s.ai, t = now();
    // Ce qu'il a entendu de récent (les pas et les pings des autres).
    const clues = [];
    for (const st of g.steps) if (st.by !== id && t - st.t < 1200 && dist(st, h) < 600) clues.push({ x: st.x, y: st.y, t: st.t });
    for (const p of g.pings) if (dist(p, h) > 5 && t - p.t < 1500) clues.push({ x: p.x, y: p.y, t: p.t });
    if (ai.seen && t - ai.seen.at < 900) for (const q of ai.seen.list) clues.push({ x: q.x, y: q.y, t: ai.seen.at, sure: true });
    clues.sort((a, b) => b.t - a.t);
    const c = clues.find((q) => q.sure) || clues[0];
    let k = 0, aim = s.aim;
    if (!ai.shootAt) ai.shootAt = t + 2500 + Math.random() * 2500;     // (au début, il attend un peu)
    if (c) {
      const d = dist(c, h), fresh = t - c.t < 700;
      aim = Math.atan2(c.y - h.y, c.x - h.x) + (Math.random() - 0.5) * (c.sure ? 0.16 : 0.5);
      if (fresh && (c.sure ? d < 480 : d < 300) && clearShot(h, c) && t >= s.reloadAt && t >= (ai.shootAt || 0)) { k |= K.FIRE; ai.shootAt = t + 1000 + Math.random() * 1600; }
      ai.goal = { x: c.x, y: c.y };
    }
    if (t >= s.pingReady && t >= (ai.pingAt || 0) && (!c || t - c.t > 1500)) { k |= PING; ai.pingAt = t + 5000 + Math.random() * 6000; }
    if (!ai.goal || dist(ai.goal, h) < 40) ai.goal = { x: rand(80, W - 80), y: rand(80, HGT - 80) };
    let mk = keyTo(h, ai.goal);
    const i = KEYS.indexOf(mk), ang = (i * Math.PI) / 4, ax = h.x + Math.cos(ang) * 36, ay = h.y + Math.sin(ang) * 36;
    if (g.map.rects.some((r) => ax > r.x - 20 && ax < r.x + r.w + 20 && ay > r.y - 20 && ay < r.y + r.h + 20)) { ai.side = ai.side || (Math.random() < 0.5 ? 1 : -1); mk = KEYS[(i + ai.side * 2 + 8) % 8]; if (Math.random() < 0.02) ai.goal = null; }
    k |= mk;
    if ((c && dist(c, h) < 520) || ai.calm > t) k |= K.DASH;      // près d'un bruit, ou par prudence : il avance sans bruit
    if (!ai.calm || t > ai.calm + 4000) ai.calm = t + 2000 + Math.random() * 3000;
    return { k, aim };
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000);
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; g.nextSweep = t + SWEEP_AT; }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.heroes)) {
        if (!s.alive) continue;
        if (s.bot) { const b = botInput(id, s); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);
      }
      stepDarts(dt);
      // Mort subite : un grand balayage révèle tout le monde, à tout le monde.
      if (t >= g.nextSweep) {
        g.nextSweep = t + SWEEP_EVERY;
        for (const [id, s] of Object.entries(g.heroes)) if (s.alive) { g.pings.push({ id: ++g.fxId, x: Math.round(s.h.x), y: Math.round(s.h.y), t, big: true }); }
        for (const [id, s] of Object.entries(g.heroes)) {
          if (!s.alive) continue;
          const seen = Object.entries(g.heroes).filter(([oid, o]) => oid !== id && o.alive).map(([, o]) => ({ x: Math.round(o.h.x), y: Math.round(o.h.y) }));
          if (!s.bot) ctx.sendTo(id, "reveal", { x: Math.round(s.h.x), y: Math.round(s.h.y), seen, r: 2000 }); else s.ai.seen = { at: t, list: seen };
        }
        say("📡 Grand balayage : tout le monde est révélé !");
      }
      if (!g.endAt && t - g.playAt > MAX_MS) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    sendPrivate();
    ctx.update();
  }
  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }
  function leave(id) { if (g.heroes[id]?.alive && ["countdown", "play"].includes(g.phase)) eliminate(id, null); }

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
    in(pid, { s, k, a }) {
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      const aim = typeof a === "number" && isFinite(a) ? a : null;
      if (aim !== null) st.aim = aim;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, k & 127, aim);
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
