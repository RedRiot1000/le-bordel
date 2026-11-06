// ===================================================================
//  PARKOUR — Moteur du jeu (module du hub Le Bordel)
//  Chacun sa ligne, le même parcours pour tout le monde (tiré d'une seed).
//  On court tout seul, de plus en plus vite : sauter, s'accroupir, glisser.
//  Un obstacle touché (ou un trou) = éliminé. Le plus loin gagne.
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
  description: "Chacun sa ligne, le même parcours : saute, accroupis-toi, glisse… le plus loin gagne !",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
const END_DELAY = 1500;
const LAST_EXTRA = 10000;              // le dernier en course doit encore faire 1000 m (10 px = 1 m) de plus que l'avant-dernier
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

const shuffle = (arr) => {
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
    lanes: [],            // l'ordre des lignes (ids)
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
      lanes: g.lanes,
      runners: Object.entries(g.runners).map(([id, s]) => ({ id, seq: s.seq, cause: s.cause, ...P.copy(s.r) })),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      lastStand: g.phase === "play" ? g.lastStand || null : null,
      lastTarget: g.lastTarget || 0,
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600).map(({ id, lane, kind }) => ({ id, lane, kind })),
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
    g.lanes = shuffle(list.map((p) => p.id));
    g.runners = {};
    for (const p of list) {
      // Chaque bot a son temps de réaction (et il finit par se tromper).
      const react = 0.16 + Math.random() * 0.12;
      g.runners[p.id] = { r: P.newRunner(), bot: !!p.bot, seq: 0, lastInputAt: 0, ticks: 0, ai: { react, k: 0, until: 0, done: new Set() }, deadAt: 0, cause: null };
      g.scores[p.id] = g.scores[p.id] || 0;
    }
    g.fx = [];
    g.endAt = 0; g.lastStand = null; g.lastTarget = 0;
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function addFx(id, kind) { g.fx.push({ id: ++g.fxId, t: now(), lane: id, kind }); if (g.fx.length > 30) g.fx.shift(); }

  // Un pas de course pour un coureur.
  function advance(id, k) {
    const s = g.runners[id];
    s.ticks++;
    const was = s.r.alive;
    const res = P.step(s.r, k, g.course);
    if (was && res) {
      s.cause = res;
      s.deadAt = now();
      addFx(id, res);
      checkEnd();
    }
  }

  // Fin de manche : plus personne en course, ou un seul (le dernier debout a gagné).
  function checkEnd() {
    const n = alive().length, total = Object.keys(g.runners).length;
    if (n === 0) { const t = now() + END_DELAY; if (!g.endAt || g.endAt > t) g.endAt = t; }
    else if (n === 1 && total > 1 && !g.lastStand) {
      // Le dernier en course : il continue jusqu'à 1000 m de plus que le meilleur des autres.
      g.lastStand = alive()[0];
      g.lastTarget = Math.max(...Object.entries(g.runners).filter(([id]) => id !== g.lastStand).map(([, x]) => x.r.d)) + LAST_EXTRA;
    }
  }

  // Classement de la manche : à la distance.
  function endRound() {
    stopLoop();
    const order = Object.keys(g.runners).sort((a, b) => g.runners[b].r.d - g.runners[a].r.d);
    const gains = {};
    let rank = 0;
    order.forEach((id, i) => {
      if (i > 0 && Math.floor(g.runners[id].r.d) < Math.floor(g.runners[order[i - 1]].r.d)) rank = i;
      gains[id] = POINTS[rank] || 0;
    });
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = { order, gains, dist: Object.fromEntries(order.map((id) => [id, Math.floor(g.runners[id].r.d / 10)])), cause: Object.fromEntries(order.map((id) => [id, g.runners[id].cause])) };
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
    const r = s.r, ai = s.ai, t = r.t;
    if (t < ai.until) return ai.k;
    ai.k = 0;
    const v = P.speedAt(r.t);
    // Le prochain danger devant.
    const ahead = P.near(g.course, r.d, r.d + v * 1.2);
    const items = [...ahead.obs.map((o) => ({ x: o.x, kind: o.kind, key: "o" + o.x })), ...ahead.gaps.map((gp) => ({ x: gp.x, kind: "trou", w: gp.w, key: "g" + gp.x }))]
      .filter((it) => it.x + 30 > r.d - 10).sort((a, b) => a.x - b.x);
    const it = items.find((x) => !ai.done.has(x.key));
    if (!it) return 0;
    const dist = it.x - (r.d + P.W / 2);
    // Il réagit au bon moment… avec son temps de réaction et un peu de hasard (plus c'est rapide, plus il se trompe).
    const err = (Math.random() - 0.5) * (0.06 + v / 6000);
    const low = it.kind === "barre" || it.kind === "oiseau_haut";
    const lead = low ? 0.12 : it.kind === "trou" ? 0.06 : it.kind === "caisse" ? 0.2 : 0.16;
    if (dist < v * (lead + err) + 4 && dist > -10) {
      ai.done.add(it.key);
      if (Math.random() < Math.min(0.12, 0.004 + v / 14000)) return 0;   // il rate parfois
      if (low) { ai.k = K.DOWN; ai.until = t + (P.KINDS[it.kind].w + 60) / v + 0.1; }
      else { ai.k = K.JUMP; ai.until = t + (it.kind === "caisse" ? 0.2 : it.kind === "trou" ? Math.min(0.2, it.w / v) : 0.08); }
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
      // Le dernier en course a fait ses 1000 m de plus : on arrête.
      if (g.lastStand && !g.endAt && g.runners[g.lastStand]?.r.alive && g.runners[g.lastStand].r.d >= g.lastTarget) g.endAt = t + 300;
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
    if (s.r.alive) { s.r.alive = false; s.cause = "parti"; }
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
