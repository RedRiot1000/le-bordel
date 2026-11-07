// ===================================================================
//  PUCK — Moteur du jeu (module du hub Le Bordel)
//  Air hockey néon en 2 équipes (tout le monde joue ; un robot complète si
//  le nombre est impair). Chacun dirige un maillet à la souris, dans SA
//  moitié de patinoire : on ne passe jamais la ligne du milieu. On ne touche
//  le palet qu'en le percutant ; il faut l'envoyer dans le but adverse.
//  Le SERVEUR fait foi (30 calculs/s).
// ===================================================================

import "../../public/games/puck/rink.js";

const R = globalThis.Rink;
export const meta = {
  id: "puck",
  name: "Puck",
  emoji: "🏒",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Air hockey néon en équipes, à la souris : percute le palet et envoie-le dans le but adverse !",
};

const TICK_MS = 1000 / 30;
export const MALLET_R = 28;              // le maillet
export const MALLET_V = 1700;            // sa vitesse maximale (il suit la souris)
export const PUCK_MAX = 2100;            // le palet ne va jamais plus vite
export const HIT = 0.95;                 // un choc renvoie presque toute la vitesse
export const FACEOFF_MS = 1300;
const COUNTDOWN_MS = 3000, ROUND_OVER_MS = 7000, FINISH_DELAY = 15000;
const TEAMS = { 1: { name: "Cyans", emoji: "🔷", color: "#21e6ff" }, 2: { name: "Oranges", emoji: "🔶", color: "#ff8a1f" } };

function defaultSettings() { return { rounds: 3, minutes: 2 }; }
export const playlist = {
  options: [
    { key: "rounds", label: "Matchs", default: "3", choices: [{ v: "1", label: "1" }, { v: "3", label: "3" }, { v: "5", label: "5" }] },
    { key: "minutes", label: "Durée d'un match", default: "2", choices: [{ v: "2", label: "2 min" }, { v: "3", label: "3 min" }] },
  ],
  settingsFor(c) { return { rounds: [1, 3, 5].includes(Number(c.rounds)) ? Number(c.rounds) : 3, minutes: [2, 3].includes(Number(c.minutes)) ? Number(c.minutes) : 2 }; },
};
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Un maillet reste dans sa moitié, et dans la patinoire.
export function clampMallet(team, p) {
  const r = MALLET_R;
  p.x = team === 1 ? Math.max(R.X0 + r, Math.min(R.CX - r, p.x)) : Math.max(R.CX + r, Math.min(R.X1 - r, p.x));
  p.y = Math.max(R.Y0 + r, Math.min(R.Y1 - r, p.y));
  const o = { x: p.x, y: p.y, vx: 0, vy: 0 };
  R.keepIn(o, r);
  p.x = o.x; p.y = o.y;
  return p;
}

export function createGame(ctx) {
  const g = {
    phase: "setup",
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0,
    teamOf: {},
    mallets: {},          // id -> { x, y, vx, vy, tx, ty, team, bot, robot, goals, ai, lastInputAt }
    puck: { x: R.CX, y: R.CY, vx: 0, vy: 0 }, lastHit: null,
    goals: { 1: 0, 2: 0 }, faceoffUntil: 0,
    playAt: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => (g.mallets[id]?.robot ? "Robot" : players().find((p) => p.id === id)?.pseudo || "?");
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };

  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      teams: TEAMS, teamOf: g.teamOf, goals: g.goals,
      mallets: Object.entries(g.mallets).map(([id, m]) => ({ id, team: m.team, robot: !!m.robot, x: Math.round(m.x * 10) / 10, y: Math.round(m.y * 10) / 10, vx: Math.round(m.vx), vy: Math.round(m.vy) })),
      puck: { x: Math.round(g.puck.x * 10) / 10, y: Math.round(g.puck.y * 10) / 10, vx: Math.round(g.puck.vx), vy: Math.round(g.puck.vy) },
      faceoff: Math.max(0, g.faceoffUntil - t),
      timeLeft: g.phase === "play" ? Math.max(0, g.settings.minutes * 60000 - (t - g.playAt)) : g.settings.minutes * 60000,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  function startGame() {
    g.scores = {}; g.round = 0;
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }
  // L'engagement : chacun dans son camp ; le palet dans le camp de l'équipe qui a encaissé (au début : au centre).
  function faceoff(t, toTeam = 0) {
    const byTeam = { 1: [], 2: [] };
    for (const [id, m] of Object.entries(g.mallets)) byTeam[m.team].push(id);
    for (const tm of [1, 2]) byTeam[tm].forEach((id, i) => {
      const m = g.mallets[id], n = byTeam[tm].length;
      const x = tm === 1 ? R.X0 + 120 + (i % 2) * 170 : R.X1 - 120 - (i % 2) * 170, y = R.CY + (i - (n - 1) / 2) * 140;
      Object.assign(m, clampMallet(tm, { x, y }), { vx: 0, vy: 0 }); m.tx = m.x; m.ty = m.y;
    });
    g.puck = { x: toTeam === 1 ? R.CX - 150 : toTeam === 2 ? R.CX + 150 : R.CX, y: R.CY, vx: 0, vy: 0 };
    g.faceoffUntil = t + FACEOFF_MS;
  }
  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    g.teamOf = {}; g.mallets = {};
    list.forEach((p, i) => { g.teamOf[p.id] = (i % 2) + 1; });
    for (const p of list) g.mallets[p.id] = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, team: g.teamOf[p.id], bot: !!p.bot, goals: 0, ai: {}, lastInputAt: 0 };
    if (list.length % 2) g.mallets.robot = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0, team: 2, bot: true, robot: true, goals: 0, ai: {} };
    g.goals = { 1: 0, 2: 0 };
    g.endAt = 0; g.lastRound = null; g.feed = []; g.fx = []; g.lastHit = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    faceoff(now() + COUNTDOWN_MS, Math.random() < 0.5 ? 1 : 2);   // (le palet commence dans un camp tiré au hasard)
    g.lastTickAt = now();
    startLoop();
  }
  function endRound() {
    stopLoop();
    const win = g.goals[1] > g.goals[2] ? 1 : g.goals[2] > g.goals[1] ? 2 : 0;
    const gains = {};
    for (const [id, m] of Object.entries(g.mallets)) {
      if (m.robot) continue;
      const n = m.goals * 2 + (win === 0 ? 1 : m.team === win ? 3 : 0);
      gains[id] = n;
      g.scores[id] = (g.scores[id] || 0) + n;
    }
    g.lastRound = { win, goals: { ...g.goals }, gains, order: Object.keys(gains).sort((a, b) => gains[b] - gains[a]), scorers: Object.fromEntries(Object.keys(gains).map((id) => [id, g.mallets[id].goals])), teamOf: { ...g.teamOf } };
    const last = g.round >= g.settings.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last) {          // (le match suivant se lance tout seul)
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
  //  LA PHYSIQUE : les maillets suivent leur cible ; le palet glisse et rebondit
  // =================================================================
  function moveMallets(dt) {
    const frozen = now() < g.faceoffUntil;
    for (const m of Object.values(g.mallets)) {
      const target = clampMallet(m.team, { x: m.tx, y: m.ty });
      const dx = target.x - m.x, dy = target.y - m.y, d = Math.hypot(dx, dy), maxStep = MALLET_V * dt;
      const k = frozen ? 0 : d > maxStep ? maxStep / d : 1;
      const nx = m.x + dx * k, ny = m.y + dy * k;
      m.vx = (nx - m.x) / dt; m.vy = (ny - m.y) / dt;
      m.x = nx; m.y = ny;
    }
    // Deux maillets de la même équipe ne se chevauchent pas.
    const list = Object.values(g.mallets);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.team !== b.team) continue;
      const d = dist(a, b), min = MALLET_R * 2;
      if (d >= min || d === 0) continue;
      const nx = (b.x - a.x) / d, ny = (b.y - a.y) / d, over = (min - d) / 2;
      a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
      clampMallet(a.team, a); clampMallet(b.team, b);
    }
  }
  function stepPuck(dt) {
    const t = now(), SUB = 4, d = dt / SUB, p = g.puck, rr = R.PUCK_R + MALLET_R;
    for (let s = 0; s < SUB; s++) {
      // Les chocs avec les maillets.
      for (const [id, m] of Object.entries(g.mallets)) {
        const dx = p.x - m.x, dy = p.y - m.y, dd = Math.hypot(dx, dy);
        if (dd >= rr || dd === 0) continue;
        const nx = dx / dd, ny = dy / dd;
        p.x = m.x + nx * (rr + 0.5); p.y = m.y + ny * (rr + 0.5);
        const rv = (p.vx - m.vx) * nx + (p.vy - m.vy) * ny;
        if (rv < 0) { p.vx -= (1 + HIT) * rv * nx; p.vy -= (1 + HIT) * rv * ny; }
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > PUCK_MAX) { p.vx *= PUCK_MAX / sp; p.vy *= PUCK_MAX / sp; }
        if (g.lastHit !== id || t - (g.lastHitAt || 0) > 200) addFx({ kind: "choc", x: Math.round(p.x), y: Math.round(p.y), team: m.team });
        g.lastHit = id; g.lastHitAt = t;
      }
      const goal = R.movePuck(p, d);
      if (goal) return scored(goal === 1 ? 2 : 1, t);
    }
  }
  function scored(team, t) {
    g.goals[team]++;
    const by = g.lastHit && g.mallets[g.lastHit]?.team === team ? g.lastHit : null;
    if (by) g.mallets[by].goals++;
    addFx({ kind: "but", team, x: Math.round(g.puck.x), y: Math.round(g.puck.y) });
    say(`🚨 BUT des ${TEAMS[team].emoji} ${TEAMS[team].name}${by ? ` (${pseudo(by)})` : ""} ! ${g.goals[1]} – ${g.goals[2]}`);
    g.lastHit = null;
    faceoff(t + 900, team === 1 ? 2 : 1);
  }

  // =================================================================
  //  BOTS : le plus proche du palet attaque (il vise derrière le palet pour le renvoyer vers le but), les autres défendent
  // =================================================================
  function botTargets() {
    const p = g.puck;
    for (const tm of [1, 2]) {
      const ms = Object.values(g.mallets).filter((m) => m.team === tm && m.bot);
      if (!ms.length) continue;
      const ownX = tm === 1 ? R.X0 : R.X1, goalX = tm === 1 ? R.X1 : R.X0, side = tm === 1 ? 1 : -1;
      const inMine = tm === 1 ? p.x < R.CX + 30 : p.x > R.CX - 30;     // (jusqu'à la ligne du milieu : il peut encore le toucher)
      const striker = ms.slice().sort((a, b) => dist(a, p) - dist(b, p))[0];
      ms.forEach((m, i) => {
        const ai = m.ai;
        ai.err = ai.err ?? (Math.random() - 0.5) * 40;
        if (m === striker && inMine) {
          // Se placer derrière le palet (côté de son but), puis foncer dedans vers le but adverse.
          const ax = goalX - p.x, ay = R.CY + ai.err - p.y, al = Math.hypot(ax, ay) || 1;
          const behind = { x: p.x - (ax / al) * 46, y: p.y - (ay / al) * 46 };
          // (si le palet est collé à une bande, on ne peut pas passer derrière : on le frappe directement)
          const reach = clampMallet(tm, { ...behind }), stuck = dist(reach, behind) > 8;
          const ready = dist(m, behind) < 26;
          if (stuck) { m.tx = p.x + (ax / al) * 15; m.ty = p.y + (ay / al) * 15; }
          else { m.tx = ready ? p.x + (ax / al) * 60 : behind.x; m.ty = ready ? p.y + (ay / al) * 60 : behind.y; }
          // (arrêté à côté du palet sans l'avoir touché : on recommence par derrière)
          if (!stuck && ready && dist(m, p) > R.PUCK_R + MALLET_R + 30 && Math.hypot(m.vx, m.vy) < 40) { m.tx = behind.x; m.ty = behind.y; }
          if (Math.random() < 0.01) ai.err = (Math.random() - 0.5) * 80;
        } else {
          // Défendre : entre le palet et son but, à une distance qui dépend du rang.
          const dx = ownX + side * (110 + i * 90), f = (dx - ownX) / ((p.x - ownX) || 1);
          m.tx = dx; m.ty = R.CY + (p.y - R.CY) * Math.max(0.3, Math.min(1, f + 0.4)) + (i % 2 ? 60 : -60) * (ms.length > 2 ? 1 : 0);
        }
      });
    }
  }

  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000) || TICK_MS / 1000;
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      botTargets();
      moveMallets(dt);
      stepPuck(dt);
      // Le palet est resté immobile 3 s (coincé, ou personne n'y touche) : on le remet en jeu.
      if (Math.hypot(g.puck.vx, g.puck.vy) > 40 || t < g.faceoffUntil) g.stillSince = t;
      else if (t - (g.stillSince || t) > 3000) { g.stillSince = t; say("🔄 Palet bloqué : remise en jeu"); faceoff(t, g.puck.x < R.CX ? 1 : 2); }
      if (!g.endAt && t - g.playAt >= g.settings.minutes * 60000 && t >= g.faceoffUntil) g.endAt = t + 800;
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
      if (![1, 3, 5].includes(s.rounds)) s.rounds = 3;
      if (![2, 3].includes(s.minutes)) s.minutes = 2;
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
    // { p: { x, y } } : où est la souris (le maillet va vers ce point, dans sa moitié).
    in(pid, { p }) {
      const m = g.mallets[pid];
      if (!m || m.bot || !p || !isFinite(p.x) || !isFinite(p.y)) return;
      m.tx = p.x; m.ty = p.y; m.lastInputAt = now();
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
  g.__stepPuck = stepPuck; g.__moveMallets = moveMallets;    // (pour les tests)

  return {
    publicState,
    _g: g,
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data || {}) || { ok: true };
    },
    onReconnect(id) { const m = g.mallets[id]; if (m && !m.robot) m.bot = false; ctx.update(); },
    onDisconnect(id) { const m = g.mallets[id]; if (m) m.bot = true; ctx.update(); },
    canJoin: () => ["setup", "over", "roundOver"].includes(g.phase),
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startGame();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
