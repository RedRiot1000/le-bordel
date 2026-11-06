// ===================================================================
//  ROI DE LA COLLINE — Moteur du jeu (module du hub Le Bordel)
//  Tout le monde a une batte. Une zone dorée : chaque seconde passée
//  dedans rapporte 1 point… si on y est seul (ou seule son équipe).
//  La zone saute ailleurs toutes les 20 s. Un coup de batte propulse fort.
//  Modes : équipes, chacun pour soi, ou alterné (une manche sur deux).
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";

const H = globalThis.Pieton;
const K = H.K;

export const meta = {
  id: "colline",
  name: "Roi de la colline",
  emoji: "👑",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Une zone dorée, une batte chacun : reste dans la zone… et vire les autres !",
};

const TICK_MS = 1000 / 30;
export const W = 1280, HGT = 800;
export const ZONE_R = 110;            // rayon de la zone dorée
export const MOVE_EVERY = 20000;      // elle saute ailleurs toutes les 20 s...
export const WARN_MS = 3000;          // ... en prévenant 3 s avant
export const BAT_REACH = 64;          // portée du coup (devant soi)
export const BAT_ANGLE = 1.05;        // demi-angle du coup (rad)
export const BAT_CD = 500;            // recharge entre deux coups (0,5 s)
export const BAT_FORCE = 640;         // vitesse donnée à celui qu'on frappe
export const BAT_STUN = 0.45;         // il contrôle mal pendant ce temps
const COUNTDOWN_MS = 3000;
const ROUND_OVER_MS = 6000;
const FINISH_DELAY = 15000;
const TEAMS = { 1: { name: "Rouges", emoji: "🔴", color: "#ff4d5a" }, 2: { name: "Bleus", emoji: "🔵", color: "#3a8bff" } };

function defaultSettings() {
  return { rounds: 5, duration: 90, mode: "aleatoire" };   // mode : aleatoire · equipes · solo
}

export const playlist = {
  options: [
    {
      key: "mode", label: "Mode", default: "aleatoire",
      choices: [{ v: "aleatoire", label: "🔁 Alterné", hint: "Une manche en équipes, une manche chacun pour soi" }, { v: "equipes", label: "🔴🔵 Équipes" }, { v: "solo", label: "👤 Chacun pour soi" }],
    },
    {
      key: "rounds", label: "Manches", default: "5",
      choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }, { v: "8", label: "8" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), mode: ["aleatoire", "equipes", "solo"].includes(c.mode) ? c.mode : "aleatoire", rounds: [3, 5, 8].includes(Number(c.rounds)) ? Number(c.rounds) : 5 };
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const overlap = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},           // points de la soirée (secondes cumulées)
    round: 0,
    teamsMode: false,
    teamOf: {},
    rects: [],            // obstacles (piliers, caisses) { x, y, w, h, kind }
    heroes: {},           // id -> { h, bot, seq, lastInputAt, ai, prevK, aim, batAt, swingAt, held }
    zone: null,           // { x, y, r }
    nextZone: null,
    moveAt: 0,
    held: {},             // côté -> secondes tenues dans la manche (côté = équipe ou joueur)
    contested: false,
    owner: null,          // côté qui tient la zone en ce moment
    feed: [],
    playAt: 0, timeUpAt: 0, phaseEnd: 0,
    lastRound: null,
    loop: null, lastTickAt: 0,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const sideOf = (id) => (g.teamsMode ? "t" + g.teamOf[id] : id);
  const enemies = (a, b) => a !== b && (!g.teamsMode || g.teamOf[a] !== g.teamOf[b]);
  const ENV = () => ({ walls: true, w: W, h: HGT, rects: g.rects, noDash: true });
  const durationMs = () => g.settings.duration * 1000;

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
      players: players().map((p) => ({ ...p, score: Math.floor(g.scores[p.id] || 0) })),
      teamsMode: g.teamsMode, teamOf: g.teamOf, teams: TEAMS,
      rects: g.rects,
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, swing: Math.max(0, 250 - (t - s.swingAt)) / 250, held: Math.floor(s.held), aim: Math.round((s.aim ?? s.h.face) * 100) / 100,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: 0, dashT: 0, pushT: 0, heavy: 0,
      })),
      zone: g.zone, nextZone: t >= g.moveAt - WARN_MS ? g.nextZone : null, moveIn: Math.max(0, g.moveAt - t),
      held: Object.fromEntries(Object.entries(g.held).map(([k, v]) => [k, Math.floor(v)])),
      contested: g.contested, owner: g.owner,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.phase === "countdown" ? durationMs() : 0,
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 400).map(({ id, x, y, kind }) => ({ id, x, y, kind })),
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

  // Une place pour la zone : loin des obstacles (et de l'ancienne zone).
  function zoneSpot(avoid) {
    // On garde la place la plus loin de l'ancienne zone (jamais la même), sans obstacle dedans.
    let best = null, bd = -1;
    for (let k = 0; k < 80; k++) {
      const z = { x: rand(ZONE_R + 60, W - ZONE_R - 60), y: rand(ZONE_R + 50, HGT - ZONE_R - 50), r: ZONE_R };
      if (g.rects.some((r) => overlap({ x: z.x - z.r, y: z.y - z.r, w: 2 * z.r, h: 2 * z.r }, r, 10))) continue;
      if (!avoid) return z;
      const d = Math.hypot(z.x - avoid.x, z.y - avoid.y);
      if (d > bd) { bd = d; best = z; }
      if (d > 450 && Math.random() < 0.3) break;
    }
    return best || (avoid && Math.hypot(avoid.x - W / 2, avoid.y - HGT / 2) < 50 ? { x: W / 2 + (Math.random() < 0.5 ? -360 : 360), y: HGT / 2, r: ZONE_R } : { x: W / 2, y: HGT / 2, r: ZONE_R });
  }

  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    const n = list.length;
    g.round++;
    const m = g.settings.mode;
    // Équipes : à partir de 3 joueurs. Alterné : une manche sur deux, à partir de 4 et seulement si les équipes sont égales (nombre pair).
    g.teamsMode = m === "equipes" ? n >= 3 : m === "aleatoire" ? n >= 4 && n % 2 === 0 && g.round % 2 === 0 : false;
    g.teamOf = {};
    if (g.teamsMode) list.forEach((p, i) => { g.teamOf[p.id] = (i % 2) + 1; });
    // Les obstacles : piliers et caisses, loin du centre (la 1re zone).
    g.rects = [];
    const want = Math.floor(rand(6, 10));
    for (let tries = 0; tries < 300 && g.rects.length < want; tries++) {
      const pillar = Math.random() < 0.5;
      const w = pillar ? rand(44, 60) : rand(70, 120), h = pillar ? w : rand(40, 56);
      const vert = !pillar && Math.random() < 0.5;
      const o = { x: rand(60, W - 60 - (vert ? h : w)), y: rand(60, HGT - 60 - (vert ? w : h)), w: vert ? h : w, h: vert ? w : h, kind: pillar ? "pilier" : "caisse" };
      if (Math.hypot(o.x + o.w / 2 - W / 2, o.y + o.h / 2 - HGT / 2) < 290) continue;
      if (g.rects.some((p) => overlap(o, p, 90))) continue;
      g.rects.push(o);
    }
    g.zone = { x: W / 2, y: HGT / 2, r: ZONE_R };
    g.heroes = {};
    // En cercle autour de la zone (en équipes : chaque équipe d'un côté).
    const order = g.teamsMode ? [...list.filter((p) => g.teamOf[p.id] === 1), ...list.filter((p) => g.teamOf[p.id] === 2)] : list;
    order.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2 + Math.PI;
      const x = W / 2 + Math.cos(a) * 250, y = HGT / 2 + Math.sin(a) * 250;
      g.heroes[p.id] = { h: H.newHero(x, y, a + Math.PI), bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, prevK: 0, aim: a + Math.PI, batAt: 0, swingAt: 0, held: 0 };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.held = {};
    g.contested = false; g.owner = null;
    g.feed = []; g.fx = [];
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    say(g.teamsMode ? "👥 Manche en équipes : 🔴 contre 🔵 !" : "👤 Manche en chacun pour soi !");
    startLoop();
  }

  function say(text) { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); }
  function addFx(x, y, kind) { g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(x), y: Math.round(y), kind }); if (g.fx.length > 40) g.fx.shift(); }

  // Fin de manche : les secondes passées dans la zone (pendant que son camp la tenait seul) sont ramenées
  // sur 10 points : le meilleur de la manche prend 10, les autres en proportion. Comme ça, une manche en
  // équipes (où l'on marque à plusieurs) ne pèse pas plus qu'une manche en chacun pour soi.
  function endRound() {
    stopLoop();
    const gains = {}, secs = {};
    const best = Math.max(1, ...Object.values(g.heroes).map((s) => s.held));
    for (const [id, s] of Object.entries(g.heroes)) { secs[id] = Math.floor(s.held); gains[id] = Math.round((10 * s.held) / best); }
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    const sides = Object.entries(g.held).sort((a, b) => b[1] - a[1]);
    g.lastRound = {
      gains, secs, teamsMode: g.teamsMode,
      winTeam: g.teamsMode && sides.length ? Number(sides[0][0].slice(1)) : null,
      teamHeld: g.teamsMode ? { 1: Math.floor(g.held.t1 || 0), 2: Math.floor(g.held.t2 || 0) } : null,
      winner: !g.teamsMode && sides.length ? sides[0][0] : null,
    };
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
    for (const [id, score] of Object.entries(g.scores)) (byScore[Math.floor(score)] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  UN JOUEUR AGIT : marcher, viser, coup de batte
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    const env = ENV(), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, k & (K.UP | K.DOWN | K.LEFT | K.RIGHT), s.aim, dt, env);
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id) H.collideHeroes(s.h, o.h);
    }
    if (g.phase === "play" && (k & K.FIRE) && !(s.prevK & K.FIRE) && t - s.batAt >= BAT_CD) swing(id, s, t);
    s.prevK = k;
  }

  // Un coup de batte : tous les ennemis juste devant sont propulsés.
  function swing(id, s, t) {
    s.batAt = t; s.swingAt = t;
    const a = s.aim ?? s.h.face;
    let hit = false;
    for (const [oid, o] of Object.entries(g.heroes)) {
      if (!enemies(id, oid)) continue;
      const dx = o.h.x - s.h.x, dy = o.h.y - s.h.y, d = Math.hypot(dx, dy);
      if (d > BAT_REACH + H.R || d < 1) continue;
      if (Math.abs(angDiff(Math.atan2(dy, dx), a)) > BAT_ANGLE) continue;
      // Propulsé dans la direction du coup (un peu vers l'extérieur).
      const ax = Math.cos(a) * 0.6 + (dx / d) * 0.4, ay = Math.sin(a) * 0.6 + (dy / d) * 0.4, l = Math.hypot(ax, ay) || 1;
      o.h.vx = (ax / l) * BAT_FORCE; o.h.vy = (ay / l) * BAT_FORCE;
      o.h.stun = BAT_STUN;
      addFx((s.h.x + o.h.x) / 2, (s.h.y + o.h.y) / 2, "hit");
      hit = true;
    }
    if (!hit) addFx(s.h.x + Math.cos(a) * 40, s.h.y + Math.sin(a) * 40, "whiff");
  }

  // =================================================================
  //  LA ZONE : qui est dedans, qui marque, quand elle saute
  // =================================================================
  function stepZone(dt, t) {
    if (t >= g.moveAt) {
      g.zone = g.nextZone || zoneSpot(g.zone);
      g.nextZone = zoneSpot(g.zone);
      g.moveAt = t + MOVE_EVERY;
      addFx(g.zone.x, g.zone.y, "zone");
    }
    const inside = Object.entries(g.heroes).filter(([, s]) => Math.hypot(s.h.x - g.zone.x, s.h.y - g.zone.y) < g.zone.r);
    const sides = new Set(inside.map(([id]) => sideOf(id)));
    g.contested = sides.size > 1;
    g.owner = sides.size === 1 ? [...sides][0] : null;
    if (g.owner) {
      g.held[g.owner] = (g.held[g.owner] || 0) + dt;
      for (const [, s] of inside) s.held += dt;
    }
  }

  // =================================================================
  //  BOTS : ils vont dans la zone et tapent ceux qui y sont
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const blocked = (x, y) => x < 30 || y < 30 || x > W - 30 || y > HGT - 30 || g.rects.some((r) => x > r.x - 22 && x < r.x + r.w + 22 && y > r.y - 22 && y < r.y + r.h + 22);
  function steer(h, ai, goal) {
    let ang = Math.atan2(goal.y - h.y, goal.x - h.x);
    if (blocked(h.x + Math.cos(ang) * 36, h.y + Math.sin(ang) * 36)) {
      ai.side = ai.side || (Math.random() < 0.5 ? 1 : -1);
      ang += ai.side * 1.3;
      if (blocked(h.x + Math.cos(ang) * 36, h.y + Math.sin(ang) * 36)) { ai.side = -ai.side; ang -= ai.side * 2.6; }
    }
    if (Math.hypot(goal.x - h.x, goal.y - h.y) < 14) return 0;
    return KEYS[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  }
  function botInput(id, s) {
    const h = s.h, ai = s.ai, t = now();
    // Où aller : la zone (la prochaine, si elle va bouter bientôt), un peu au hasard dedans.
    const z = g.nextZone && t > g.moveAt - 1500 ? g.nextZone : g.zone;
    if (!ai.spot || ai.zx !== z.x || Math.random() < 0.01) { const a = rand(0, Math.PI * 2), r = rand(0, z.r * 0.55); ai.spot = { x: z.x + Math.cos(a) * r, y: z.y + Math.sin(a) * r }; ai.zx = z.x; }
    // L'ennemi le plus proche (de préférence dans la zone).
    let foe = null, fd = 1e9;
    for (const [oid, o] of Object.entries(g.heroes)) {
      if (!enemies(id, oid)) continue;
      const inZone = Math.hypot(o.h.x - g.zone.x, o.h.y - g.zone.y) < g.zone.r;
      const d = Math.hypot(o.h.x - h.x, o.h.y - h.y) * (inZone ? 0.7 : 1);
      if (d < fd) { fd = d; foe = o; }
    }
    let k = 0, aim = s.aim ?? h.face;
    const near = foe && Math.hypot(foe.h.x - h.x, foe.h.y - h.y) < 160;
    if (near) {
      // On se place pour taper l'ennemi VERS l'extérieur de la zone.
      const fx = foe.h.x, fy = foe.h.y, oa = Math.atan2(fy - z.y, fx - z.x);
      const want = { x: fx - Math.cos(oa) * 40, y: fy - Math.sin(oa) * 40 };
      k |= steer(h, ai, Math.hypot(foe.h.x - h.x, foe.h.y - h.y) < BAT_REACH + 6 ? h : want);
      aim = Math.atan2(fy - h.y, fx - h.x) + (Math.random() - 0.5) * 0.2;
      if (Math.hypot(fx - h.x, fy - h.y) < BAT_REACH + H.R - 4 && !(s.prevK & K.FIRE) && Math.random() < 0.5) k |= K.FIRE;
    } else {
      k |= steer(h, ai, ai.spot);
      aim = Math.hypot(h.vx, h.vy) > 40 ? Math.atan2(h.vy, h.vx) : aim;
    }
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
      if (t >= g.phaseEnd) {
        g.phase = "play";
        g.playAt = t;
        g.timeUpAt = t + durationMs();
        g.moveAt = t + MOVE_EVERY;
        g.nextZone = zoneSpot(g.zone);
      }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.heroes)) {
        if (s.bot) { const b = botInput(id, s); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);
      }
      stepZone(dt, t);
      if (t >= g.timeUpAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    if (!g.heroes[id] || !["countdown", "play"].includes(g.phase)) return;
    delete g.heroes[id];
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5, 8].includes(s.rounds)) s.rounds = 5;
      if (![60, 90, 120].includes(s.duration)) s.duration = 90;
      if (!["aleatoire", "equipes", "solo"].includes(s.mode)) s.mode = "aleatoire";
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
      if (typeof a === "number" && isFinite(a)) st.aim = a;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, k & 63, st.aim);
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
