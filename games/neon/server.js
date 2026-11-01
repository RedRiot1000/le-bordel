// ===================================================================
//  NÉON — Moteur du jeu (module du hub Le Bordel)
//  Des motos qui laissent un mur de lumière derrière elles. Toucher
//  un mur (même le sien), un obstacle ou le bord = BOUM. Les motos
//  avancent toujours : trop lent (après un choc) = BOUM aussi.
//  Dernier en vie = gagnant de la manche. Le SERVEUR fait foi.
// ===================================================================

import "../../public/games/patate/physics.js";
import "../../public/games/neon/rules.js";
import { spawnPoints } from "../patate/maps.js";

const P = globalThis.PatatePhysics;
const N = globalThis.NeonRules;
const K = P.K;

export const meta = {
  id: "neon",
  name: "Néon",
  emoji: "🏍️",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 6,
  description: "Ta moto laisse un mur de lumière. Touche un mur : BOUM. Dernier en vie gagne !",
};

// --- Rythme ---
const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
const NO_WALL_MS = 500;        // pas de mur les 0,5 premières secondes (le temps de s'écarter)
const GRACE_MS = 1000;         // pas d'explosion "trop lent" la 1re seconde
const END_DELAY = 1500;        // on regarde le dernier survivant avant la fin de manche
const FINISH_DELAY = 15000;    // temps pour lire les résultats avant le classement
const ZONE_START = 40000;      // la zone commence à rétrécir après 40 s
const ZONE_TIME = 30000;       // … et met 30 s pour arriver à sa taille mini
const ZONE_MIN = 0.35;         // taille mini (35 % de l'arène)
const FULL_EVERY = 30;         // tous les murs renvoyés une fois par seconde (sinon : seulement les nouveaux points)

const WALLS = { court: 5, normal: 8, long: 12 };

function defaultSettings() {
  return { rounds: 5, walls: "normal", jump: true, zone: true };
}

// ===================================================================
//  MODE PLAYLIST
// ===================================================================
export const playlist = {
  options: [
    {
      key: "rounds", label: "Nombre de manches", default: "5",
      choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }, { v: "7", label: "7" }],
    },
    {
      key: "walls", label: "Durée des murs", default: "normal",
      choices: [
        { v: "court", label: "⚡ 5 s", hint: "Murs courts : plus de place" },
        { v: "normal", label: "🙂 8 s", hint: "Normal" },
        { v: "long", label: "😈 12 s", hint: "Murs longs : ça se remplit vite" },
      ],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: Number(c.rounds) || 5, walls: WALLS[c.walls] ? c.walls : "normal" };
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r1 = (v) => Math.round(v * 10) / 10;

// ===================================================================
//  MAP : plus il y a de joueurs, plus l'arène est grande. Quelques obstacles.
// ===================================================================
function overlaps(a, b, gap) {
  return a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
}
function distToRect(px, py, r) {
  const qx = Math.max(r.x, Math.min(px, r.x + r.w)), qy = Math.max(r.y, Math.min(py, r.y + r.h));
  return Math.hypot(px - qx, py - qy);
}

export function generateMap(players) {
  const W = 1280 + 160 * Math.max(0, players - 3);
  const H = Math.round(W * 0.625);
  // Départ en "moulinet" : tournées un peu de côté, pour ne pas toutes foncer au même point.
  const spawns = spawnPoints(players, W, H).map((s) => ({ ...s, a: s.a + 0.55 }));
  const obstacles = [];
  const wanted = Math.floor(rand(3, 7));
  for (let tries = 0; tries < 400 && obstacles.length < wanted; tries++) {
    const kind = pick(["bloc", "mur-h", "mur-v", "pilier"]);
    let w, h;
    if (kind === "bloc") { w = rand(60, 130); h = rand(60, 120); }
    else if (kind === "mur-h") { w = rand(160, 300); h = 30; }
    else if (kind === "mur-v") { w = 30; h = rand(150, 260); }
    else { w = h = rand(40, 56); }
    const o = { x: Math.round(rand(140, W - 140 - w)), y: Math.round(rand(140, H - 140 - h)), w: Math.round(w), h: Math.round(h) };
    if (obstacles.some((p) => overlaps(o, p, 140))) continue;
    // Pas d'obstacle juste devant un point de départ.
    if (spawns.some((s) => distToRect(s.x, s.y, o) < 120 || distToRect(s.x + Math.cos(s.a) * 160, s.y + Math.sin(s.a) * 160, o) < 60)) continue;
    obstacles.push(o);
  }
  return { id: Math.random().toString(36).slice(2, 8), w: W, h: H, obstacles, spawns, seed: Math.floor(Math.random() * 1e6) };
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    roundNum: 0,
    roundsPlayed: 0,
    map: null,
    env: null,
    motos: {},            // id -> { car, alive, bot, seq, lastInputAt, ai, kills }
    trails: {},           // id -> [x, y, t, b, ...]
    adds: {},             // nouveaux points depuis le dernier envoi
    lastAdds: {},
    tick: 0,
    grid: new Map(),
    dead: [],             // morts du calcul en cours : { id, by, x, y }
    elimGroups: [],       // éliminés, par paquets (même instant = même place)
    booms: [],            // explosions récentes (pour l'écran)
    playStart: 0,
    phaseEnd: 0,
    endAt: 0,
    zone: null,
    lastRound: null,
    loop: null,
    final: false,
    finishAt: 0,
    finishTimer: null,
  };

  const now = () => Date.now();
  const players = () => ctx.players();
  const aliveIds = () => Object.keys(g.motos).filter((id) => g.motos[id].alive);
  const wallMs = () => (WALLS[g.settings.walls] || 8) * 1000;
  const roundLimit = () => ctx.playlist?.rounds || g.settings.rounds;

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s). Les murs : seulement les nouveaux points,
  //  et la totalité une fois par seconde (le navigateur recolle les morceaux).
  // =================================================================
  function publicState() {
    const t = now();
    const full = g.phase !== "play" || g.tick % FULL_EVERY === 0;
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      wallMs: wallMs(),
      roundNum: g.roundNum,
      rounds: roundLimit(),
      playlist: ctx.playlist && { rounds: ctx.playlist.rounds },
      final: g.final,
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      map: g.map && { id: g.map.id, w: g.map.w, h: g.map.h, obstacles: g.map.obstacles, seed: g.map.seed },
      zone: g.zone,
      motos: Object.entries(g.motos).map(([id, s]) => ({
        id, alive: s.alive, seq: s.seq, type: "moto",
        x: s.car.x, y: s.car.y, a: s.car.a, vx: s.car.vx, vy: s.car.vy, w: s.car.w,
        nitro: 0, slide: s.car.slide, st: s.car.st, boost: false, jump: s.car.jump, jumpCd: s.car.jumpCd,
      })),
      tick: g.tick,
      adds: g.lastAdds,
      trails: full ? g.trails : null,
      booms: g.booms,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      lastRound: g.lastRound,
    };
  }

  // =================================================================
  //  DÉROULÉ D'UNE MANCHE
  // =================================================================
  function startRound() {
    const list = players().filter((p) => p.connected);
    g.roundNum++;
    g.map = generateMap(list.length);
    g.env = { w: g.map.w, h: g.map.h, grip: 1, oils: [], obstacles: g.map.obstacles, nitro: false, jump: g.settings.jump };
    g.motos = {};
    g.trails = {};
    g.adds = {};
    g.lastAdds = {};
    g.dead = [];
    g.elimGroups = [];
    g.booms = [];
    g.lastRound = null;
    g.endAt = 0;
    g.zone = { x0: 0, y0: 0, x1: g.map.w, y1: g.map.h };
    list.forEach((p, i) => {
      const s = g.map.spawns[i];
      g.motos[p.id] = { car: N.newMoto(s.x, s.y, s.a), alive: true, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, kills: 0 };
      g.trails[p.id] = [];
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  // Ajoute un point au mur d'une moto (si elle a assez avancé, et pas en l'air).
  function trailPoint(id, s, t) {
    if (t < g.playStart + NO_WALL_MS) return;
    const tr = g.trails[id];
    const tail = N.tail(s.car);
    if (s.car.jump > 0) { s.gap = true; return; }   // en l'air : pas de mur
    const n = tr.length;
    if (n && !s.gap && Math.hypot(tail.x - tr[n - 4], tail.y - tr[n - 3]) < N.STEP) return;
    const pt = [r1(tail.x), r1(tail.y), t, n === 0 || s.gap ? 1 : 0];
    s.gap = false;
    tr.push(...pt);
    (g.adds[id] ||= []).push(...pt);
  }

  // Une moto avance d'un calcul (1/30 s) avec ses touches.
  function advance(id, k) {
    const s = g.motos[id];
    if (!s.alive) return;
    const t = now();
    const kk = N.prep(s.car, k, g.env);
    const dt = P.TICK / P.SUB;
    let crashed = false;
    for (let sub = 0; sub < P.SUB; sub++) {
      P.drive(s.car, kk, dt, g.env, 1);
      if (touchesStatic(s.car)) crashed = true;   // bord ou obstacle : même en frôlant
      P.collideStatic(s.car, g.env);
      for (const oid of aliveIds()) {
        if (oid !== id) P.collideCars(s.car, g.motos[oid].car);
      }
    }
    trailPoint(id, s, t);
    if (crashed) return kill(id, null);
    // Les murs de lumière (on saute par-dessus pendant un saut).
    if (s.car.jump <= 0) {
      const nose = N.nose(s.car);
      const by = N.hitWall(g.grid, nose.x, nose.y, N.HIT_R, id);
      if (by) return kill(id, by);
    }
    // La zone qui rétrécit.
    const z = g.zone;
    if (s.car.x < z.x0 || s.car.x > z.x1 || s.car.y < z.y0 || s.car.y > z.y1) return kill(id, null);
    // Trop lent (après un choc) : la moto explose.
    if (t > g.playStart + GRACE_MS && N.speed(s.car) < N.DIE) return kill(id, null);
  }

  // La moto touche-t-elle le bord de l'arène ou un obstacle ?
  function touchesStatic(c) {
    for (const s of P.circles(c)) {
      if (s.x < s.r || s.y < s.r || s.x > g.map.w - s.r || s.y > g.map.h - s.r) return true;
      for (const o of g.map.obstacles) {
        const qx = Math.max(o.x, Math.min(s.x, o.x + o.w)), qy = Math.max(o.y, Math.min(s.y, o.y + o.h));
        if (Math.hypot(s.x - qx, s.y - qy) < s.r) return true;
      }
    }
    return false;
  }

  function kill(id, by) {
    const s = g.motos[id];
    if (!s.alive) return;
    s.alive = false;
    g.dead.push({ id, by: by && by !== id ? by : null });
    g.booms.push({ id, x: Math.round(s.car.x), y: Math.round(s.car.y), t: now(), by: by || null });
  }

  // Les morts de ce calcul : même instant = même place au classement.
  function flushDeaths() {
    if (!g.dead.length) return;
    for (const d of g.dead) if (d.by && g.motos[d.by]) g.motos[d.by].kills++;
    g.elimGroups.push(g.dead.map((d) => d.id));
    g.dead = [];
    if (aliveIds().length <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  function updateZone(t) {
    const W = g.map.w, H = g.map.h;
    if (!g.settings.zone) return;
    const f = Math.max(0, Math.min(1, (t - g.playStart - ZONE_START) / ZONE_TIME)) * (1 - ZONE_MIN);
    g.zone = { x0: r1((W * f) / 2), y0: r1((H * f) / 2), x1: r1(W - (W * f) / 2), y1: r1(H - (H * f) / 2) };
  }

  // Points : 1 par joueur éliminé avant toi (+1 par kill).
  function endRound() {
    stopLoop();
    const groups = [...g.elimGroups];
    const alive = aliveIds();
    if (alive.length) groups.push(alive);
    const total = Object.keys(g.motos).length;
    let before = 0;
    const rows = [];
    for (const grp of groups) {
      for (const id of grp) rows.push({ id, survival: before, kills: g.motos[id].kills, place: total - before - grp.length + 1 });
      before += grp.length;
    }
    for (const r of rows) {
      r.points = r.survival + r.kills;
      g.scores[r.id] = (g.scores[r.id] || 0) + r.points;
    }
    g.lastRound = rows.reverse();
    g.phase = "roundOver";
    g.roundsPlayed++;
    if (g.roundsPlayed >= roundLimit()) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  // =================================================================
  //  BOTS : ils regardent devant eux (5 directions) et vont vers le plus libre.
  // =================================================================
  function freeDist(s, id, angle, max) {
    const c = s.car, z = g.zone;
    const nose = N.nose(c);
    for (let d = 12; d <= max; d += 12) {
      const x = nose.x + Math.cos(angle) * d, y = nose.y + Math.sin(angle) * d;
      if (x < z.x0 + 14 || x > z.x1 - 14 || y < z.y0 + 14 || y > z.y1 - 14) return d;
      if (g.map.obstacles.some((o) => x > o.x - 12 && x < o.x + o.w + 12 && y > o.y - 12 && y < o.y + o.h + 12)) return d;
      if (N.hitWall(g.grid, x, y, 12, id)) return d;
    }
    return max;
  }

  function botKeys(id, s) {
    const c = s.car, ai = s.ai;
    ai.wobble = (ai.wobble || 0) - P.TICK;
    if (ai.wobble <= 0) { ai.wobble = rand(0.6, 1.8); ai.bias = rand(-0.25, 0.25); }
    const angles = [-0.9, -0.45, 0, 0.45, 0.9];
    const free = angles.map((da) => freeDist(s, id, c.a + da, 240));
    let best = 2;
    for (let i = 0; i < angles.length; i++) {
      const score = free[i] - Math.abs(angles[i]) * 30;
      if (score > free[best] - Math.abs(angles[best]) * 30 + 5) best = i;
    }
    let k = 0;
    const turn = free[2] > 200 ? ai.bias : angles[best];
    if (turn < -0.1) k |= K.LEFT;
    if (turn > 0.1) k |= K.RIGHT;
    if (free[2] > 220 && Math.random() < 0.3) k |= K.UP;
    if (free[2] < 60 && Math.max(...free) < 80) k |= K.HB;   // coincé : on saute
    return k;
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playStart = t; }
    } else if (g.phase === "play") {
      g.tick++;
      updateZone(t);
      // Murs trop vieux : ils s'effacent.
      const limit = t - wallMs();
      for (const tr of Object.values(g.trails)) {
        let cut = 0;
        while (cut < tr.length && tr[cut + 2] < limit) cut += 4;
        if (cut) { tr.splice(0, cut); if (tr.length) tr[3] = 1; }
      }
      const live = {};
      for (const [id, s] of Object.entries(g.motos)) if (s.alive && s.car.jump <= 0 && !s.gap) live[id] = N.tail(s.car);
      g.grid = N.buildGrid(g.trails, live);
      for (const [id, s] of Object.entries(g.motos)) {
        if (!s.alive) continue;
        if (s.bot) advance(id, botKeys(id, s));
        else if (t - s.lastInputAt > 200) advance(id, 0);   // onglet en pause : la moto continue tout droit
      }
      flushDeaths();
      g.booms = g.booms.filter((b) => t - b.t < 1500);
      g.lastAdds = g.adds;
      g.adds = {};
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5, 7].includes(s.rounds)) s.rounds = 5;
      if (!WALLS[s.walls]) s.walls = "normal";
      s.jump = !!s.jump; s.zone = !!s.zone;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      if (g.phase === "setup") { g.roundsPlayed = 0; g.roundNum = 0; }
      startRound();
      ctx.update();
    },
    // Touches : { s: numéro, k: touches } (30 fois/s) — chaque message = 1/30 s de route.
    in(pid, { s, k }) {
      const m = g.motos[pid];
      if (!m || m.bot || typeof s !== "number" || s <= m.seq) return;
      const t = now();
      m.seq = s;
      m.lastInputAt = t;
      if (!m.alive || g.phase !== "play") return;
      m.budget = Math.min(6, (m.budget ?? 6) + (t - (m.budgetAt || t)) * 0.036);
      m.budgetAt = t;
      if (m.budget < 1) return;
      m.budget -= 1;
      advance(pid, k & 63);
    },
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "roundOver" || ctx.playlist || g.final) return;
      g.phase = "setup";
      ctx.update();
    },
    finish(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase)) return;
      ctx.finish(ranking());
    },
  };

  return {
    publicState,
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data) || { ok: true };
    },
    onReconnect() { ctx.update(); },
    onDisconnect(pid) {
      if (g.motos[pid]?.alive && ["countdown", "play"].includes(g.phase)) { kill(pid, null); flushDeaths(); }
      ctx.update();
    },
    canJoin: () => g.phase === "setup" || g.phase === "roundOver",
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startRound();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
