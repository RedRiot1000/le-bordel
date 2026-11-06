// ===================================================================
//  PARKOUR — Moteur du jeu (module du hub Le Bordel)
//  Tout le monde sur la même piste, le même parcours (tiré d'une seed), 3 étages.
//  On court tout seul, de plus en plus vite : sauter, s'accroupir, glisser.
//  Un choc ralentit, un trou fait perdre du temps. Le mur qui suit la course élimine.
//  Le dernier en course gagne.
//  Le SERVEUR fait foi : il avance chaque coureur d'un pas à chaque touche
//  reçue (comme le navigateur), en vérifiant qu'il ne va pas plus vite que le temps.
// ===================================================================

import "../../public/games/parkour/course.js";

const P = globalThis.Parkour;
const K = P.K;

export const meta = {
  id: "parkour",
  name: "Parkour",
  emoji: "🏃",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Cours sur 3 étages, évite les pièges : le mur qui te suit élimine les plus lents !",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
const END_DELAY = 1500;
const LAST_DELAY = 2500;               // quand il ne reste qu'un coureur : il a gagné, fin 2,5 s après
const ROUND_OVER_MS = 6000;
const FINISH_DELAY = 15000;
const MAX_MS = 180000;                 // une manche dure au plus 3 min
export const POINTS = [10, 7, 5, 3, 2, 1];

function defaultSettings() {
  return { rounds: 7 };
}

export const playlist = {
  options: [
    {
      key: "rounds", label: "Manches", default: "7",
      choices: [{ v: "5", label: "5" }, { v: "7", label: "7" }, { v: "10", label: "10" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: [5, 7, 10].includes(Number(c.rounds)) ? Number(c.rounds) : 7 };
  },
};

const shuffle = (arr) => {   // (mélange)
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    round: 0,
    seed: 0, course: null,
    out: [],              // l'ordre des éliminations
    runners: {},          // id -> { r, bot, seq, lastInputAt, ticks, ai, deadAt, cause }
    playAt: 0, endAt: 0, phaseEnd: 0,
    lastRound: null,
    loop: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const alive = () => Object.keys(g.runners).filter((id) => g.runners[id].r.alive);

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s)
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      seed: g.seed,
      wall: g.phase === "play" ? P.wallAt((t - g.playAt) / 1000) : -P.WALL_GAP,
      runners: Object.entries(g.runners).map(([id, s]) => ({ id, seq: s.seq, cause: s.cause, ...P.copy(s.r) })),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600).map(({ id, who, kind }) => ({ id, who, kind })),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {};
    g.round = 0;
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }

  function startRound() {
    const list = players().filter((p) => p.connected);
    g.round++;
    g.seed = Math.floor(Math.random() * 1e9);
    g.course = P.course(g.seed);
    g.out = [];
    g.runners = {};
    for (const p of list) {
      // Chaque bot a son temps de réaction (et il finit par se tromper).
      const react = 0.16 + Math.random() * 0.12;
      g.runners[p.id] = { r: P.newRunner(), bot: !!p.bot, seq: 0, lastInputAt: 0, ticks: 0, ai: { react, k: 0, until: 0, b: 0, bold: 0.3 + Math.random() * 0.6, done: new Set() }, deadAt: 0, cause: null };
      g.scores[p.id] = g.scores[p.id] || 0;
    }
    g.fx = [];
    g.endAt = 0;
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function addFx(id, kind) { g.fx.push({ id: ++g.fxId, t: now(), who: id, kind }); if (g.fx.length > 30) g.fx.shift(); }

  // Un pas de course pour un coureur.
  function advance(id, k) {
    const s = g.runners[id];
    s.ticks++;
    const was = s.r.alive;
    const res = P.step(s.r, k, g.course);
    if (was && res) {
      addFx(id, res);
      if (res === "mur") { s.cause = res; s.deadAt = now(); g.out.push(id); checkEnd(); }
    }
  }

  // Fin de manche : plus personne en course, ou un seul (le dernier debout a gagné).
  function checkEnd() {
    const n = alive().length, total = Object.keys(g.runners).length;
    if (n === 0) { const t = now() + END_DELAY; if (!g.endAt || g.endAt > t) g.endAt = t; }
    else if (n === 1 && total > 1 && !g.endAt) g.endAt = now() + LAST_DELAY;
  }

  // Classement de la manche : le dernier en course, puis l'ordre inverse des éliminations.
  function endRound() {
    stopLoop();
    const still = alive().sort((a, b) => g.runners[b].r.d - g.runners[a].r.d);
    const order = [...still, ...g.out.slice().reverse().filter((id) => g.runners[id])];
    const gains = {};
    order.forEach((id, i) => { gains[id] = POINTS[i] || 0; });
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = { order, gains, dist: Object.fromEntries(order.map((id) => [id, Math.floor(g.runners[id].r.d / 10)])), cause: Object.fromEntries(order.map((id) => [id, g.runners[id].cause])), hits: Object.fromEntries(order.map((id) => [id, g.runners[id].r.hits])) };
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
  //  BOTS : ils regardent devant eux et réagissent (plus ou moins vite)
  // =================================================================
  function botKeys(s) {
    const r = s.r, ai = s.ai, t = r.t, c = g.course;
    if (t < ai.until) return ai.k;
    ai.k = 0;
    if (r.stall > 0) return 0;
    if (!r.air) ai.b = r.y;
    const b = ai.b, v = Math.max(200, P.speedOf(r));
    const under = !r.air && P.support(c, r, r.d, r.y);
    // Sur des dalles qui s'effondrent : il saute tout de suite.
    if (under?.cr && !(r.pk & K.JUMP)) { ai.k = K.JUMP; ai.until = t + 0.07; return ai.k; }
    const ahead = P.near(c, r.d, r.d + v * 1.2);
    // Une fourche : il monte s'il aime le risque.
    for (const p of ahead.plats) {
      if (p.cr || p.y <= b || p.y - b > 130 || p.x < r.d) continue;
      const key = "p" + p.id;
      if (ai.done.has(key) || p.x - r.d > v * 0.2) continue;
      ai.done.add(key);
      if (!r.air && Math.random() < ai.bold) { ai.k = K.JUMP; ai.until = t + 0.24; return ai.k; }
    }
    // Le prochain danger sur son étage.
    const items = [];
    for (const o of ahead.obs) if (o.b === b && !P.KINDS[o.kind].pad && o.x + 30 > r.d - 10) items.push({ x: o.x, o, key: "o" + o.x + "/" + o.b });
    if (b === 0) for (const gp of ahead.gaps) if (gp.x + 30 > r.d - 10) items.push({ x: gp.x, w: gp.w, key: "g" + gp.x });
    for (const p of ahead.plats) if (p.cr && p.y === b && p.x > r.d - 10) items.push({ x: p.x, w: 60, key: "c" + p.id });
    items.sort((a, c2) => a.x - c2.x);
    const it = items.find((x) => !ai.done.has(x.key));
    if (!it) return 0;
    const dist = it.x - (r.d + P.W / 2);
    const z = it.o ? P.zone(it.o, t + Math.max(0, dist) / v) : null;
    if (it.o && !z) { if (dist < 10) ai.done.add(it.key); return 0; }
    const low = !!z && z[0] >= 30;                 // à passer en glissant
    const big = !!z && z[1] > 60;
    // Il réagit au bon moment… avec un peu de hasard (plus c'est rapide, plus il se trompe).
    const err = (Math.random() - 0.5) * (0.06 + v / 6000);
    const lead = low ? 0.12 : it.o ? (big ? 0.2 : 0.16) : 0.06;
    if (dist < v * (lead + err) + 4 && dist > -10) {
      ai.done.add(it.key);
      if (Math.random() < Math.min(0.14, 0.01 + v / 11000)) return 0;   // il rate parfois
      if (low) { ai.k = K.DOWN; ai.until = t + (P.wOf(it.o) + 60) / v + 0.1; }
      else { ai.k = K.JUMP; ai.until = t + (big ? 0.2 : it.w ? Math.min(0.2, it.w / v) : 0.08); }
      return ai.k;
    }
    return 0;
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      const allowed = Math.floor((t - g.playAt) / TICK_MS);
      for (const [id, s] of Object.entries(g.runners)) {
        if (s.bot) { while (s.ticks < allowed) advance(id, s.r.alive ? botKeys(s) : 0); }
        // Un joueur qui ne répond plus (onglet en pause) : il court quand même… les mains vides.
        // (on attend 1 s de silence : un petit trou de réseau ne doit jamais faire « rater » un saut)
        else while (s.ticks < allowed - 30 && t - s.lastInputAt > 1000) advance(id, 0);
      }
      if (!g.endAt && t - g.playAt > MAX_MS) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    const s = g.runners[id];
    if (!s || !["countdown", "play"].includes(g.phase)) return;
    if (s.r.alive) { s.r.alive = false; s.cause = "parti"; g.out.push(id); }
    checkEnd();
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![5, 7, 10].includes(s.rounds)) s.rounds = 7;
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
    // Une touche = un pas de course (1/30 s). Jamais plus vite que le temps réel.
    in(pid, { s, k }) {
      const st = g.runners[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      st.seq = s;
      st.lastInputAt = now();
      if (g.phase !== "play") return;
      const allowed = Math.floor((now() - g.playAt) / TICK_MS) + 8;
      if (st.ticks >= allowed) return;
      advance(pid, k & 3);
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
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data || {}) || { ok: true };
    },
    onReconnect() { ctx.update(); },
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
