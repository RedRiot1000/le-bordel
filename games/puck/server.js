// ===================================================================
//  PUCK — Moteur du jeu (module du hub Le Bordel)
//  Hockey néon en 2 équipes (tout le monde joue ; un robot complète si le
//  nombre est impair). On récupère le palet en passant dessus, on le garde
//  au bout de la crosse, on tire (clic maintenu = plus fort) ou on passe.
//  Sans le palet : une charge (Espace) bouscule et fait lâcher le palet.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/puck/rink.js";

const H = globalThis.Pieton;
const R = globalThis.Rink;
const K = H.K;

export const meta = {
  id: "puck",
  name: "Puck",
  emoji: "🏒",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Hockey néon en équipes : passes, tirs en rebond sur les bandes, charges. Marque plus de buts !",
};

const TICK_MS = 1000 / 30;
export const SPEED = 1.15;
export const CARRY_SLOW = 0.9;           // avec le palet, on va un peu moins vite
export const GRAB_R = 34;                // on récupère le palet à cette distance
export const STICK = 28;                 // le palet est tenu à cette distance devant soi
export const SHOT_MIN = 520, SHOT_MAX = 1500, CHARGE_S = 0.8;
export const LOCKOUT = 0.35;             // après un tir, on ne peut pas reprendre son propre palet tout de suite
export const MATCH_MS = 120000, FACEOFF_MS = 2000;
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

export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0,
    teamOf: {},           // id -> 1 / 2
    heroes: {},           // id -> { h, team, bot, robot, seq, lastInputAt, prevK, aim, charging, goals, ai, lockUntil }
    puck: { x: R.CX, y: R.CY, vx: 0, vy: 0 }, carrier: null, lastTouch: null, lastShooter: null,
    goals: { 1: 0, 2: 0 }, faceoffUntil: 0,
    playAt: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => (g.heroes[id]?.robot ? "Robot" : players().find((p) => p.id === id)?.pseudo || "?");
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };
  const envOf = (s) => ({ walls: true, w: R.W, h: R.H, push: true, speedMul: SPEED * (g.carrier === s.id ? CARRY_SLOW : 1), rects: R.heroRects });

  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      teams: TEAMS, teamOf: g.teamOf, goals: g.goals,
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, team: s.team, robot: !!s.robot, charge: s.charging ? Math.min(1, (t - s.charging) / (CHARGE_S * 1000)) : 0,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: s.h.dash, dashT: 0, pushT: s.h.pushT, heavy: 0,
      })),
      puck: { x: Math.round(g.puck.x * 10) / 10, y: Math.round(g.puck.y * 10) / 10, vx: Math.round(g.puck.vx), vy: Math.round(g.puck.vy) },
      carrier: g.carrier,
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

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {}; g.round = 0;
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }
  // L'engagement : tout le monde dans son camp, le palet au centre.
  function faceoff(t) {
    const byTeam = { 1: [], 2: [] };
    for (const [id, s] of Object.entries(g.heroes)) byTeam[s.team].push(id);
    for (const tm of [1, 2]) byTeam[tm].forEach((id, i) => {
      const s = g.heroes[id], n = byTeam[tm].length;
      const x = tm === 1 ? R.CX - 120 - (i % 2) * 180 : R.CX + 120 + (i % 2) * 180, y = R.CY + (i - (n - 1) / 2) * 130;
      s.h = H.newHero(x, y, tm === 1 ? 0 : Math.PI); s.charging = 0; s.lockUntil = 0;
    });
    g.puck = { x: R.CX, y: R.CY, vx: 0, vy: 0 }; g.carrier = null;
    g.faceoffUntil = t + FACEOFF_MS;
  }
  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    g.teamOf = {}; g.heroes = {};
    list.forEach((p, i) => { g.teamOf[p.id] = (i % 2) + 1; });
    for (const p of list) g.heroes[p.id] = { id: p.id, h: H.newHero(0, 0), team: g.teamOf[p.id], bot: !!p.bot, seq: 0, lastInputAt: 0, prevK: 0, aim: 0, charging: 0, goals: 0, ai: {}, lockUntil: 0 };
    // Nombre impair : un robot complète l'équipe la moins nombreuse.
    if (list.length % 2) g.heroes.robot = { id: "robot", h: H.newHero(0, 0), team: 2, bot: true, robot: true, seq: 0, prevK: 0, aim: 0, charging: 0, goals: 0, ai: {}, lockUntil: 0 };
    g.goals = { 1: 0, 2: 0 };
    g.endAt = 0; g.lastRound = null; g.feed = []; g.fx = [];
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    faceoff(now() + COUNTDOWN_MS);
    g.lastTickAt = now();
    startLoop();
  }
  function endRound() {
    stopLoop();
    const win = g.goals[1] > g.goals[2] ? 1 : g.goals[2] > g.goals[1] ? 2 : 0;
    const gains = {};
    for (const [id, s] of Object.entries(g.heroes)) {
      if (s.robot) continue;
      const n = s.goals * 2 + (win === 0 ? 1 : s.team === win ? 3 : 0);
      gains[id] = n;
      g.scores[id] = (g.scores[id] || 0) + n;
    }
    g.lastRound = { win, goals: { ...g.goals }, gains, order: Object.keys(gains).sort((a, b) => gains[b] - gains[a]), scorers: Object.fromEntries(Object.keys(gains).map((id) => [id, g.heroes[id].goals])), teamOf: { ...g.teamOf } };
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
  //  UN JOUEUR AGIT : patiner, tirer, charger
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s) return;
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    const frozen = t < g.faceoffUntil;
    const env = envOf(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, frozen ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | (g.carrier === id ? 0 : K.DASH)), s.aim, dt, env);
      H.collideWalls(s.h, env);
      R.keepIn(s.h, H.R);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id) H.collideHeroes(s.h, o.h);
    }
    // La charge : ceux qui sont juste devant sont bousculés, et lâchent le palet.
    if (s.h.pushed) {
      s.h.pushed = false;
      const hit = H.applyPush(s.h, Object.values(g.heroes).filter((o) => o !== s).map((o) => o.h));
      for (const hh of hit) {
        const o = Object.values(g.heroes).find((x) => x.h === hh);
        if (o && g.carrier === o.id) { g.carrier = null; g.puck.vx = hh.vx * 1.1; g.puck.vy = hh.vy * 1.1; o.lockUntil = t + 600; addFx({ kind: "vol", x: Math.round(hh.x), y: Math.round(hh.y) }); }
      }
    }
    if (g.phase === "play" && !frozen && g.carrier === id) {
      // Tirer : clic maintenu = plus fort ; relâché = le palet part là où on vise.
      const fire = k & K.FIRE;
      if (fire && !s.charging) s.charging = t;
      if (!fire && s.charging) {
        const c = Math.min(1, (t - s.charging) / (CHARGE_S * 1000));
        s.charging = 0;
        const sp = SHOT_MIN + (SHOT_MAX - SHOT_MIN) * c;
        g.carrier = null; g.lastShooter = id; s.lockUntil = t + LOCKOUT * 1000;
        g.puck.vx = Math.cos(s.aim) * sp + s.h.vx * 0.3; g.puck.vy = Math.sin(s.aim) * sp + s.h.vy * 0.3;
        addFx({ kind: c > 0.6 ? "tir" : "passe", x: Math.round(g.puck.x), y: Math.round(g.puck.y) });
      }
    } else s.charging = 0;
    s.prevK = k;
  }

  // Le palet : tenu au bout de la crosse, ou libre (il glisse et rebondit).
  function stepPuck(dt) {
    const t = now();
    if (g.carrier) {
      const s = g.heroes[g.carrier];
      if (!s) { g.carrier = null; return; }
      const a = s.aim;
      g.puck.x = s.h.x + Math.cos(a) * STICK; g.puck.y = s.h.y + Math.sin(a) * STICK;
      g.puck.vx = s.h.vx; g.puck.vy = s.h.vy;
      // (tenu contre la bande : on le garde dans la patinoire)
      g.puck.x = Math.max(R.X0 + R.PUCK_R, Math.min(R.X1 - R.PUCK_R, g.puck.x)); g.puck.y = Math.max(R.Y0 + R.PUCK_R, Math.min(R.Y1 - R.PUCK_R, g.puck.y));
      return;
    }
    const goal = R.movePuck(g.puck, dt);
    if (goal) return scored(goal === 1 ? 2 : 1, t);
    // Ramasser : le plus proche, à portée.
    let best = null, bd = GRAB_R;
    for (const [id, s] of Object.entries(g.heroes)) { if (t < s.lockUntil || t < g.faceoffUntil) continue; const d = dist(s.h, g.puck); if (d < bd) { bd = d; best = id; } }
    if (best) { g.carrier = best; g.lastTouch = best; }
  }
  function scored(team, t) {
    g.goals[team]++;
    const by = g.lastShooter && g.heroes[g.lastShooter]?.team === team ? g.lastShooter : null;
    if (by) g.heroes[by].goals++;
    addFx({ kind: "but", team, x: Math.round(g.puck.x), y: Math.round(g.puck.y) });
    say(`🚨 BUT des ${TEAMS[team].emoji} ${TEAMS[team].name}${by ? ` (${pseudo(by)})` : ""} ! ${g.goals[1]} – ${g.goals[2]}`);
    g.lastShooter = null;
    faceoff(t + 1200);
  }

  g.__stepPuck = stepPuck;   // (pour les tests)

  // =================================================================
  //  BOTS : le plus proche du palet va le chercher, un autre défend, les autres se démarquent
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const keyTo = (h, p) => (dist(h, p) < 14 ? 0 : KEYS[Math.round(((Math.atan2(p.y - h.y, p.x - h.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]);
  function botInput(id, s) {
    const t = now(), h = s.h, ai = s.ai;
    const goalX = s.team === 1 ? R.X1 : R.X0, ownX = s.team === 1 ? R.X0 : R.X1;
    const mates = Object.values(g.heroes).filter((o) => o.team === s.team);
    const foes = Object.values(g.heroes).filter((o) => o.team !== s.team);
    let k = 0, aim = s.aim;
    if (g.carrier === id) {
      // Avec le palet : vers le but adverse ; tirer quand on est assez près, en visant un coin du but.
      const tgt = { x: goalX, y: R.CY + (ai.corner = ai.corner ?? (Math.random() < 0.5 ? -1 : 1)) * (R.GOAL / 2 - 26) };
      const d = dist(h, tgt);
      aim = Math.atan2(tgt.y - h.y, tgt.x - h.x) + (Math.random() - 0.5) * 0.08;
      const pressed = foes.some((o) => dist(o.h, h) < 90);
      if (d < 430 || (pressed && d < 650)) {
        if (!s.charging) { ai.shotHold = t + 300 + Math.random() * 400; ai.corner = null; }
        if (t < ai.shotHold) k |= K.FIRE;
      } else if (pressed && Math.random() < 0.04) {
        // Une passe au coéquipier le plus avancé.
        const m = mates.filter((o) => o !== s).sort((a, b) => Math.abs(goalX - a.h.x) - Math.abs(goalX - b.h.x))[0];
        if (m) { aim = Math.atan2(m.h.y - h.y, m.h.x - h.x); k |= s.charging ? 0 : K.FIRE; ai.passing = true; }
      }
      return { k: k | keyTo(h, { x: goalX - (s.team === 1 ? 140 : -140), y: R.CY + Math.sin(t / 700 + h.y) * 120 }), aim };
    }
    // Sans le palet.
    const P = g.puck, chaser = mates.slice().sort((a, b) => dist(a.h, P) - dist(b.h, P))[0];
    const carrierTeam = g.carrier ? g.heroes[g.carrier]?.team : 0;
    let goal;
    if (chaser === s) goal = { x: P.x + P.vx * 0.2, y: P.y + P.vy * 0.2 };
    else if (mates.length > 1 && mates.slice().sort((a, b) => Math.abs(ownX - a.h.x) - Math.abs(ownX - b.h.x))[0] === s) goal = { x: ownX + (s.team === 1 ? 160 : -160), y: (P.y + R.CY) / 2 };
    else goal = { x: (P.x + goalX) / 2, y: R.CY + (h.y < R.CY ? -170 : 170) };
    k |= keyTo(h, goal);
    aim = Math.atan2(P.y - h.y, P.x - h.x);
    // Charger le porteur adverse quand il est tout près, devant.
    if (carrierTeam && carrierTeam !== s.team) {
      const c = g.heroes[g.carrier].h;
      if (dist(c, h) < H.R * 2 + H.PUSH_REACH - 4 && h.dash <= 0 && Math.random() < 0.3) { aim = Math.atan2(c.y - h.y, c.x - h.x); k |= K.DASH; }
    }
    return { k, aim };
  }

  // =================================================================
  //  BOUCLE (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000);
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.heroes)) {
        if (s.bot) { const b = botInput(id, s); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);
      }
      stepPuck(dt);
      if (!g.endAt && t - g.playAt >= g.settings.minutes * 60000 && t >= g.faceoffUntil) g.endAt = t + 800;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }
  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }
  function leave(id) { const s = g.heroes[id]; if (s) { s.bot = true; } }   // un joueur parti : un bot prend sa place

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
      act(pid, k & 63, aim);
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
    onReconnect(id) { const s = g.heroes[id]; if (s && !s.robot && players().find((p) => p.id === id && !p.bot)) s.bot = false; ctx.update(); },
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
