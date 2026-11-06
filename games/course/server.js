// ===================================================================
//  GRAND PRIX — Moteur du jeu (module du hub Le Bordel)
//  Course de supersportives vue de dessus sur un circuit généré au hasard.
//  Avant chaque course : on choisit sa voiture (ÉCLAIR, VIPÈRE, TITAN).
//  2 modes : COURSE (X tours, ordre d'arrivée) ou ÉLIMINATION (toutes les
//  20 s, le dernier explose). Nitro qui se recharge en dérapant, plus vite
//  quand on est loin derrière. On peut pousser les autres hors de la piste.
//  Le SERVEUR fait foi : même physique que le navigateur (physics.js).
// ===================================================================

import "../../public/games/patate/physics.js";
import "../../public/games/course/track.js";

const P = globalThis.PatatePhysics;
const T = globalThis.CourseTrack;
const K = P.K;
const RESET = 128;   // touche R : revenir sur la piste

export const meta = {
  id: "course",
  name: "Grand Prix",
  emoji: "🏁",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Course de supersportives sur un circuit au hasard : tours ou élimination, nitro et poussettes !",
};

const TICK_MS = 1000 / 30;
const PICK_MS = 10000;          // choix de la voiture
const COUNTDOWN_MS = 3500;
const FINISH_AFTER_FIRST = 20000;   // après l'arrivée du 1er, 20 s pour finir
const ELIM_EVERY = 20000;       // élimination : toutes les 20 s, le dernier explose
const MAX_MS = 6 * 60000;
const ROUND_OVER_MS = 8000;
const FINISH_DELAY = 15000;
const OFF_RESET = 3;            // hors piste depuis 3 s = retour sur la piste
const STUCK_RESET = 3;          // presque à l'arrêt 3 s = retour sur la piste
export const POINTS = [10, 7, 5, 3, 2, 1];
export const MODES = ["course", "elimination"];

function defaultSettings() {
  return { mode: "aleatoire", laps: 3, rounds: 5 };
}

export const playlist = {
  options: [
    {
      key: "mode", label: "Mode", default: "aleatoire",
      choices: [
        { v: "aleatoire", label: "🔁 Alterné", hint: "Une manche en course, une manche en élimination" },
        { v: "course", label: "🏁 Course", hint: "X tours, l'ordre d'arrivée compte" },
        { v: "elimination", label: "💥 Élimination", hint: "Toutes les 20 s, le dernier explose" },
      ],
    },
    { key: "laps", label: "Tours", default: "3", choices: [{ v: "2", label: "2" }, { v: "3", label: "3" }, { v: "5", label: "5" }] },
    { key: "rounds", label: "Manches", default: "5", choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }, { v: "8", label: "8" }] },
  ],
  settingsFor(c) {
    const s = defaultSettings();
    if (["aleatoire", ...MODES].includes(c.mode)) s.mode = c.mode;
    if ([2, 3, 5].includes(Number(c.laps))) s.laps = Number(c.laps);
    if ([3, 5, 8].includes(Number(c.rounds))) s.rounds = Number(c.rounds);
    return s;
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const wrap = (d, L) => { d = ((d % L) + L) % L; return d > L / 2 ? d - L : d; };

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",        // setup | pick | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    round: 0,
    mode: "course",
    seed: 0, track: null, env: null,
    cars: {},              // id -> { car, bot, seq, lastInputAt, budget, prog, safe, off, stuck, finished, finishAt, alive, ai, cause }
    picks: {},             // id -> type (choix de la voiture)
    phaseEnd: 0, playAt: 0, endAt: 0, firstAt: 0, elimNext: 0,
    finishOrder: [], elimOrder: [],
    cones: {},             // cônes renversés : id -> { a, v }
    order: [],             // classement en direct
    lastRound: null,
    fx: [], fxId: 0,
    loop: null, botTimers: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const solid = (s) => s.alive && !s.finished;       // une voiture qui roule encore (et qu'on peut toucher)

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s) — valeurs EXACTES pour la prédiction
  // =================================================================
  function publicState() {
    const t = now();
    g.fx = g.fx.filter((f) => t - f.t < 700);
    return {
      phase: g.phase,
      settings: g.settings,
      round: g.round,
      mode: g.mode,
      laps: g.settings.laps,
      seed: g.seed,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      picks: g.picks,
      cars: Object.entries(g.cars).map(([id, s]) => ({
        id, seq: s.seq, alive: s.alive, finished: s.finished, prog: s.prog, cause: s.cause,
        ...P.copyCar(s.car),
      })),
      order: g.order,
      cones: g.cones,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      elimLeft: g.mode === "elimination" && g.phase === "play" ? Math.max(0, g.elimNext - t) : 0,
      endLeft: g.firstAt && g.phase === "play" ? Math.max(0, g.endAt - t) : 0,
      raceMs: g.phase === "play" ? t - g.playAt : 0,
      lastRound: g.lastRound,
      fx: g.fx.map(({ id, x, y, s, big, kind }) => ({ id, x, y, s, big, kind })),
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
    g.final = false;
    startRound();
  }

  function startRound() {
    clearTimeout(g.finishTimer);
    g.round++;
    g.seed = (Math.random() * 2 ** 31) >>> 0;
    g.track = T.build(g.seed);
    g.env = T.env(g.track);
    g.mode = g.settings.mode === "aleatoire" ? MODES[(g.round - 1) % 2] : g.settings.mode;
    g.cars = {};
    g.picks = {};
    g.cones = {};
    g.finishOrder = []; g.elimOrder = [];
    g.lastRound = null;
    g.fx = [];
    g.endAt = 0; g.firstAt = 0;
    const list = players().filter((p) => p.connected);
    for (const p of list) {
      g.scores[p.id] = g.scores[p.id] || 0;
      g.cars[p.id] = {
        car: P.newCar(0, 0, 0, "eclair"), bot: !!p.bot, seq: 0, lastInputAt: 0, budget: 6, budgetAt: 0,
        prog: 0, safe: 0, off: 0, stuck: 0, finished: false, finishAt: 0, alive: true, cause: null, resetAt: 0,
        ai: { lat: (Math.random() - 0.5) * 0.3, skill: 0.86 + Math.random() * 0.12, care: 0.9 + Math.random() * 0.2 },
      };
      if (p.bot) g.botTimers.push(setTimeout(() => choose(p.id, pick(P.RACE_TYPES)), 1200 + Math.random() * 4000));
    }
    g.phase = "pick";
    g.phaseEnd = now() + PICK_MS;
    startLoop();
  }

  function choose(id, type) {
    if (g.phase !== "pick" || !g.cars[id] || !P.RACE_TYPES.includes(type)) return { error: "Choix impossible." };
    g.picks[id] = type;
    const all = Object.keys(g.cars).every((pid) => g.picks[pid]);
    if (all) g.phaseEnd = Math.min(g.phaseEnd, now() + 1200);
    return { ok: true };
  }

  // Fin du choix : grille de départ (le leader au classement part derrière).
  function toGrid() {
    const ids = Object.keys(g.cars).sort((a, b) => (g.scores[a] || 0) - (g.scores[b] || 0) || Math.random() - 0.5);
    const spots = T.startGrid(g.track, ids.length);
    ids.forEach((id, i) => {
      const s = g.cars[id], sp = spots[i];
      const type = g.picks[id] || pick(P.RACE_TYPES);
      g.picks[id] = type;
      s.car = P.newCar(sp.x, sp.y, sp.a, type);
      s.prog = sp.s; s.safe = sp.s;
    });
    g.order = ids.slice().reverse();
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
  }

  function addFx(x, y, s, extra = {}) {
    const t = now();
    if (!extra.big && g.fx.some((f) => t - f.t < 150 && Math.hypot(f.x - x, f.y - y) < 40)) return;
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), s: Math.round(s), ...extra });
  }

  // =================================================================
  //  UNE VOITURE AVANCE DE 1/30 s (en 3 petits pas), avec les chocs.
  //  Pour un humain : à chaque touche reçue (comme sa prédiction).
  // =================================================================
  function advanceCar(id, k) {
    const s = g.cars[id];
    if (!s.alive) return;
    const dt = P.TICK / P.SUB;
    const drive = s.finished ? 0 : k;   // arrivé : il roule en roue libre
    for (let sub = 0; sub < P.SUB; sub++) {
      g.env.obstacles = T.nearObs(g.track, s.car.x, s.car.y);
      P.drive(s.car, drive, dt, g.env, 1);
      const hit = P.collideStatic(s.car, g.env);
      if (hit > 180) addFx(s.car.x, s.car.y, hit);
      if (!solid(s)) continue;
      for (const oid in g.cars) {
        if (oid === id) continue;
        const o = g.cars[oid];
        if (!solid(o)) continue;
        const res = P.collideCars(s.car, o.car);
        if (res.impact > 120) addFx(res.x, res.y, res.impact);
      }
    }
    if (solid(s) && g.phase === "play") track(id, s, k);
  }

  // Suivi de la course : avancée sur la piste, hors piste, coincé, tours, arrivée.
  function track(id, s, k) {
    const c = s.car, L = g.track.len, W = T.WIDTH;
    const l = T.locate(g.track, c.x, c.y);
    if (l && l.dist < W / 2 + 140) {
      const cur = ((s.prog % L) + L) % L;
      const d = wrap(l.s - cur, L);
      if (Math.abs(d) < 400) s.prog += d;                 // (pas de saut : couper par l'herbe ne compte pas)
      if (l.dist < T.halfAt(g.track, l.i) - 12 && s.prog > s.safe) s.safe = s.prog;
    }
    const offNow = !l || l.dist > W / 2 + T.RAIL + 30;     // (l'herbe avant la barrière, c'est encore le circuit)
    s.off = offNow ? s.off + P.TICK : 0;
    const speed = Math.hypot(c.vx, c.vy);
    s.stuck = speed < 30 ? s.stuck + P.TICK : 0;
    if (s.off > OFF_RESET || s.stuck > (s.bot ? 2 : STUCK_RESET) || (k & RESET && now() - s.resetAt > 1500)) respawn(s);
    // Cônes renversés.
    for (const cn of g.track.cones) {
      if (g.cones[cn.id]) continue;
      if (Math.hypot(cn.x - c.x, cn.y - c.y) < 22) { g.cones[cn.id] = { a: Math.atan2(c.vy, c.vx), v: Math.round(Math.max(150, speed * 1.3)) }; }
    }
    // Arrivée (mode course).
    if (g.mode === "course" && s.prog >= g.settings.laps * L) {
      s.finished = true; s.finishAt = now() - g.playAt;
      g.finishOrder.push(id);
      addFx(c.x, c.y, 0, { kind: "arrivee" });
      if (!g.firstAt) { g.firstAt = now(); g.endAt = now() + FINISH_AFTER_FIRST; }
      checkEnd();
    }
  }

  // Retour sur la piste au dernier endroit sûr (au milieu, arrêté, dans le bon sens).
  function respawn(s) {
    const p = T.at(g.track, s.safe - 40);
    const c = s.car;
    c.x = p.x; c.y = p.y; c.a = p.a; c.vx = c.vy = c.w = 0; c.slide = false;
    s.prog = s.safe - 40;
    s.off = 0; s.stuck = 0; s.resetAt = now(); s.resets = (s.resets || 0) + 1;
    addFx(p.x, p.y, 0, { kind: "retour" });
  }

  // Classement en direct + nitro de rattrapage.
  function updateOrder() {
    const racing = Object.keys(g.cars).filter((id) => solid(g.cars[id])).sort((a, b) => g.cars[b].prog - g.cars[a].prog);
    const out = Object.keys(g.cars).filter((id) => !g.cars[id].alive).sort((a, b) => g.elimOrder.indexOf(b) - g.elimOrder.indexOf(a));
    g.order = [...g.finishOrder, ...racing, ...out];
    // Plus on est loin derrière, plus la nitro se recharge vite (le dernier : × 2).
    const n = racing.length;
    racing.forEach((id, i) => { g.cars[id].car.regen = n > 1 ? 1 + i / (n - 1) : 1; });
  }

  // Élimination : le dernier explose.
  function explodeLast() {
    const racing = Object.keys(g.cars).filter((id) => solid(g.cars[id])).sort((a, b) => g.cars[a].prog - g.cars[b].prog);
    if (racing.length <= 1) return;
    const id = racing[0], s = g.cars[id], c = s.car;
    s.alive = false; s.cause = "explosé";
    g.elimOrder.push(id);
    addFx(c.x, c.y, 0, { big: true, kind: "boum" });
    // Le souffle repousse ceux qui sont à côté.
    for (const o of Object.values(g.cars)) {
      if (!solid(o)) continue;
      const dx = o.car.x - c.x, dy = o.car.y - c.y, d = Math.hypot(dx, dy) || 1;
      if (d < 220) { const f = (1 - d / 220) * 420; o.car.vx += (dx / d) * f; o.car.vy += (dy / d) * f; o.car.w += (Math.random() - 0.5) * 8 * (1 - d / 220); o.car.slide = true; }
    }
    checkEnd();
  }

  function checkEnd() {
    const t = now();
    const racing = Object.values(g.cars).filter(solid).length;
    if (g.mode === "elimination" && racing <= 1) { if (!g.endAt || g.endAt > t + 2500) g.endAt = t + 2500; }
    if (g.mode === "course" && racing === 0) { if (!g.endAt || g.endAt > t + 1500) g.endAt = t + 1500; }
  }

  function endRound() {
    stopLoop();
    updateOrder();
    const order = g.order.slice();
    const gains = {};
    order.forEach((id, i) => { gains[id] = POINTS[i] || 0; g.scores[id] = (g.scores[id] || 0) + gains[id]; });
    g.lastRound = {
      order, gains, mode: g.mode,
      times: Object.fromEntries(order.map((id) => [id, g.cars[id].finished ? g.cars[id].finishAt : null])),
      laps: Object.fromEntries(order.map((id) => [id, Math.max(0, Math.floor(g.cars[id].prog / g.track.len))])),
      cause: Object.fromEntries(order.map((id) => [id, g.cars[id].cause])),
      types: { ...g.picks },
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
  //  BOTS : ils suivent le milieu de la piste (un peu décalés), freinent
  //  avant les virages, évitent la paille, nitro en ligne droite.
  // =================================================================
  function botKeys(id, s) {
    const c = s.car, ai = s.ai, V = P.spec(c), tr = g.track, L = tr.len, W = T.WIDTH;
    const speed = Math.hypot(c.vx, c.vy);
    const fwd = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
    // Où aller : un point devant sur la piste.
    let lat = ai.lat * W;
    for (const o of tr.obstacles) {
      if (o.kind !== "paille") continue;
      const d = wrap(o.s - s.prog, L);
      if (d > -30 && d < 420) { lat = -Math.sign(o.lat || 1) * W * 0.3; break; }
    }
    const la = 70 + speed * 0.4;
    const p = T.at(tr, s.prog + la), n = T.normal(tr, p.i);
    // (dans une portion étroite, il reste sur le bitume)
    const room = Math.max(0, Math.min(T.halfAt(tr, p.i), T.halfAt(tr, Math.floor((((s.prog % L) + L) % L) / T.STEP))) - 24);
    lat = Math.max(-room, Math.min(room, lat));
    const tx = p.x + n.x * lat, ty = p.y + n.y * lat;
    const diff = angDiff(Math.atan2(ty - c.y, tx - c.x), c.a);
    // Vitesse permise : selon le virage le plus serré qui arrive.
    const span = 120 + speed * 1.0;
    const i0 = Math.floor((((s.prog % L) + L) % L) / T.STEP);
    let kmax = 0;
    for (let j = 0; j < span / T.STEP; j += 2) kmax = Math.max(kmax, Math.abs(tr.curv[(i0 + j) % tr.N]));
    const gripF = Math.max(0.95, Math.min(1.15, V.grip / 12));
    const vT = Math.sqrt((620 * ai.skill * gripF * ai.care) / Math.max(kmax, 1e-4));
    let k = 0;
    if (diff > 0.08) k |= K.RIGHT; else if (diff < -0.08) k |= K.LEFT;
    if (fwd > vT * 1.06 && fwd > 150) k |= K.DOWN;
    else if (fwd < vT) k |= K.UP;
    if (Math.abs(diff) > 1.2 && speed < 80) k = (k & ~K.UP) | K.UP;    // repartir après un tête-à-queue
    if (kmax < 1 / 1100 && Math.abs(diff) < 0.15 && c.nitro > 0.25 && fwd > 150 && (k & K.UP)) k |= K.NITRO;
    return k;
  }

  // =================================================================
  //  BOUCLE (30 fois/s)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "pick") {
      if (t >= g.phaseEnd) toGrid();
    } else if (g.phase === "countdown") {
      if (t >= g.phaseEnd) {
        g.phase = "play"; g.playAt = t;
        if (g.mode === "elimination") g.elimNext = t + ELIM_EVERY;
      }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.cars)) {
        if (!s.alive) continue;
        if (s.bot) advanceCar(id, botKeys(id, s));
        else if (s.finished || t - s.lastInputAt > 200) advanceCar(id, 0);   // onglet en pause / arrivé : roue libre
      }
      updateOrder();
      if (g.mode === "elimination" && t >= g.elimNext && !g.endAt) { explodeLast(); g.elimNext += ELIM_EVERY; }
      if (!g.endAt && t - g.playAt > MAX_MS) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() {
    clearInterval(g.loop); g.loop = null;
    g.botTimers.forEach(clearTimeout); g.botTimers = [];
  }

  function leave(id) {
    const s = g.cars[id];
    if (!s || !["pick", "countdown", "play"].includes(g.phase) || !s.alive) return;
    s.alive = false; s.cause = "parti";
    if (!g.elimOrder.includes(id)) g.elimOrder.push(id);
    checkEnd();
  }

  // =================================================================
  //  ACTIONS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (!["aleatoire", ...MODES].includes(s.mode)) s.mode = "aleatoire";
      if (![2, 3, 5].includes(s.laps)) s.laps = 3;
      if (![3, 5, 8].includes(s.rounds)) s.rounds = 5;
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
      startRound();
      ctx.update();
    },
    car(pid, { type }) { return choose(pid, type); },
    // Touches : { s: numéro, k: touches } (30 fois/s). Chaque message = 1/30 s de conduite.
    in(pid, { s, k }) {
      const st = g.cars[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (g.phase !== "play" || !st.alive) return;
      st.budget = Math.min(6, st.budget + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      advanceCar(pid, k & 255);
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
    // Pour les tests / simulations.
    _g: g,
  };
}
