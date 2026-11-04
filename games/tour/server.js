// ===================================================================
//  LA TOUR — Moteur du jeu (module du hub Le Bordel)
//  Tout le monde grimpe la même tour, la lave monte de plus en plus vite.
//  Courir, sauter, s'accroupir, sauter sur les murs. Piques (rares).
//  Le dernier en vie gagne la manche. On se traverse entre joueurs.
//  Le SERVEUR fait foi : il avance chaque perso d'un pas à chaque touche
//  reçue (comme le navigateur), jamais plus vite que le temps réel.
// ===================================================================

import "../../public/games/tour/tower.js";

const P = globalThis.Tower;
const K = P.K;

export const meta = {
  id: "tour",
  name: "La Tour",
  emoji: "🌋",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Grimpe la tour plus vite que la lave : sauts, sauts muraux, piques… le dernier en vie gagne !",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
const END_DELAY = 1500;
const LAST_DELAY = 2500;      // quand il ne reste qu'un joueur : il a gagné, fin 2,5 s après
const ROUND_OVER_MS = 7000;
const FINISH_DELAY = 15000;
const MAX_MS = 240000;
export const POINTS = [10, 7, 5, 3, 2, 1];

function defaultSettings() { return { rounds: 3 }; }

export const playlist = {
  options: [{ key: "rounds", label: "Manches", default: "3", choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }] }],
  settingsFor(c) { return { ...defaultSettings(), rounds: Number(c.rounds) === 5 ? 5 : 3 }; },
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
    seed: 0, tower: null,
    runners: {},          // id -> { r, bot, seq, lastInputAt, ticks, ai, cause, deadAt }
    deaths: [],           // ordre d'élimination
    playAt: 0, endAt: 0, phaseEnd: 0,
    lastRound: null,
    loop: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const alive = () => Object.keys(g.runners).filter((id) => g.runners[id].r.alive);

  function publicState() {
    const t = now();
    return {
      phase: g.phase,
      settings: g.settings,
      round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      seed: g.seed,
      runners: Object.entries(g.runners).map(([id, s]) => ({ id, seq: s.seq, cause: s.cause, ...P.copy(s.r) })),
      crumbles: g.tower ? g.tower.crumbles : {},
      time: g.phase === "play" ? (t - g.playAt) / 1000 : 0,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 700).map(({ id, x, y, kind }) => ({ id, x, y, kind })),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  function startGame() {
    g.scores = {};
    g.round = 0;
    g.final = false;
    startRound();
  }

  function startRound() {
    clearTimeout(g.finishTimer);
    g.round++;
    g.seed = (Math.random() * 2 ** 31) >>> 0;
    g.tower = P.tower(g.seed);
    g.runners = {};
    g.deaths = [];
    g.lastRound = null;
    g.fx = [];
    g.endAt = 0;
    const list = players().filter((p) => p.connected);
    list.forEach((p, i) => {
      g.scores[p.id] = g.scores[p.id] || 0;
      const x = P.W * (i + 1) / (list.length + 1);
      g.runners[p.id] = {
        r: P.newRunner(x), bot: !!p.bot, seq: 0, lastInputAt: 0, ticks: 0, cause: null, deadAt: 0,
        ai: { m: 0, wait: 0, react: 0.02 + Math.random() * 0.08, slip: 0.01 + Math.random() * 0.03, err: 0, hold: 0 },
      };
    });
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function addFx(s, kind) { g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(s.r.x), y: Math.round(s.r.y), kind }); if (g.fx.length > 30) g.fx.shift(); }

  function advance(id, k) {
    const s = g.runners[id];
    s.ticks++;
    const was = s.r.alive;
    const res = P.step(s.r, k, g.tower);
    if (was && res) {
      s.cause = res; s.deadAt = now();
      g.deaths.push(id);
      addFx(s, res);
      checkEnd();
    }
  }

  function checkEnd() {
    const n = alive().length, total = Object.keys(g.runners).length, t = now();
    if (n === 0) { if (!g.endAt || g.endAt > t + END_DELAY) g.endAt = t + END_DELAY; }
    else if (n === 1 && total > 1 && !g.endAt) g.endAt = t + LAST_DELAY;
  }

  function endRound() {
    stopLoop();
    // Les survivants d'abord (les plus hauts), puis l'ordre inverse des éliminations.
    const left = alive().sort((a, b) => g.runners[b].r.best - g.runners[a].r.best);
    const order = [...left, ...[...g.deaths].reverse()];
    const gains = {};
    order.forEach((id, i) => { gains[id] = POINTS[i] || 0; g.scores[id] = (g.scores[id] || 0) + gains[id]; });
    g.lastRound = {
      order, gains,
      height: Object.fromEntries(order.map((id) => [id, Math.floor(g.runners[id].r.best / 10)])),
      cause: Object.fromEntries(order.map((id) => [id, g.runners[id].cause])),
    };
    const last = g.round >= g.settings.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last && ctx.playlist) {
      g.phaseEnd = now() + ROUND_OVER_MS;
      g.finishTimer = setTimeout(() => { if (g.phase === "roundOver") { startRound(); ctx.update(); } }, ROUND_OVER_MS);
    }
    ctx.update();
  }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  BOTS : ils suivent le chemin principal, plateforme après plateforme,
  //  avec un temps de réaction et des ratés (de plus en plus avec la vitesse de la lave).
  // =================================================================
  function botKeys(s) {
    const r = s.r, ai = s.ai, c = g.tower, main = c.main;
    c.ensure(r.y);
    // (en l'air, il garde la cible de son saut ; il ne choisit la suivante qu'une fois posé)
    if (!r.air || !ai.jt) {
      while (ai.m + 1 < main.length - 1 && main[ai.m + 1].y <= r.y + 8) ai.m++;
      while (ai.m > 0 && main[ai.m].y > r.y + 8) ai.m--;
      if (!r.air) ai.jt = null;
    }
    const cur = main[ai.m], tgt = ai.jt || main[ai.m + 1];
    if (!tgt) return 0;
    const px = P.platX(tgt, r.t);
    const tx = px + (tgt.safe ?? tgt.w / 2) + ai.err;
    const dx = tx - r.x;
    const dirK = Math.abs(dx) < 8 ? 0 : dx > 0 ? K.RIGHT : K.LEFT;
    if (r.air) {
      ai.hold--;
      return dirK | (r.vy > 0 && ai.hold > 0 ? K.JUMP : 0);
    }
    if (r.t < ai.wait) return 0;
    // Tunnel : on le traverse accroupi avant de sauter.
    if (cur.tunnel && r.y === cur.y) {
      const toFar = dx > 0 ? r.x < cur.tx[1] + 10 : r.x > cur.tx[0] - 10;     // le bloc est encore entre lui et la suite
      if (toFar) return dirK | (r.x > cur.tx[0] - 50 && r.x < cur.tx[1] + 50 ? K.DOWN : 0);
    }
    const gap = Math.max(px - r.x, r.x - (px + tgt.w), 0);
    if (!P.platOn(c, tgt, r.t)) return 0;
    if (gap < 120 + Math.random() * 30) {
      // Un raté de temps en temps : il saute mal.
      const hard = Math.min(1, r.t / 90);
      ai.err = (Math.random() - 0.5) * (tgt.w * 0.5 + 120 * hard * (Math.random() < ai.slip * 6 ? 3 : 0.4));
      ai.hold = 8;
      ai.jt = tgt;
      ai.wait = r.t + ai.react + (Math.random() < ai.slip ? 0.6 : 0);
      return dirK | (r.pk & K.JUMP ? 0 : K.JUMP);
    }
    return dirK;
  }

  // =================================================================
  //  BOUCLE (30 fois/s)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      const allowed = Math.floor((t - g.playAt) / TICK_MS);
      for (const [id, s] of Object.entries(g.runners)) {
        if (s.bot) { while (s.ticks < allowed) advance(id, s.r.alive ? botKeys(s) : 0); }
        // Un joueur qui ne répond plus (onglet en pause) : il reste là, la lave avance quand même.
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
    if (!s || !["countdown", "play"].includes(g.phase) || !s.r.alive) return;
    s.r.alive = false; s.cause = "parti";
    g.deaths.push(id);
    checkEnd();
  }

  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5].includes(s.rounds)) s.rounds = 3;
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
    // Une touche = un pas (1/30 s). Jamais plus vite que le temps réel.
    in(pid, { s, k }) {
      const st = g.runners[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      st.seq = s;
      st.lastInputAt = now();
      if (g.phase !== "play") return;
      const allowed = Math.floor((now() - g.playAt) / TICK_MS) + 8;
      if (st.ticks >= allowed) return;
      advance(pid, k & 15);
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
    _g: g,   // (pour les tests / simulations)
  };
}
