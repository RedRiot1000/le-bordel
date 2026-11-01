// ===================================================================
//  AVIS DE RECHERCHE — Moteur du jeu (module du hub Le Bordel)
//  Les joueurs (en F1) fuient la police dans une ville aléatoire.
//  Des voitures de police (IA) arrivent de plus en plus nombreuses
//  (niveau de recherche ⭐ à ⭐⭐⭐⭐⭐). Presque à l'arrêt pendant 1 s avec
//  au moins 2 véhicules de police autour = ARRÊTÉ : on devient flic (van).
//  Le SERVEUR fait foi (30 calculs/s, même physique que le navigateur).
// ===================================================================

import "../../public/games/patate/physics.js";
import "../../public/games/police/city.js";

const P = globalThis.PatatePhysics;
const C = globalThis.PoliceCity;
const K = P.K;

export const meta = {
  id: "police",
  name: "Avis de recherche",
  emoji: "🚨",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "En F1 dans une ville, la police arrive de partout. Tiens jusqu'au bout !",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
export const COPS_DELAY = 5000;    // les flics arrivent 5 s après le départ
export const ARREST_MS = 1000;     // presque à l'arrêt pendant 1 s...
export const ARREST_SPEED = 65;    // ... en dessous de cette vitesse (px/s)...
export const ARREST_DIST = 110;    // ... avec au moins 2 véhicules de police à moins de 110 px
const END_DELAY = 1500;            // on voit la dernière arrestation avant les scores
const ROUND_OVER_MS = 7000;        // playlist : manche suivante toute seule
const FINISH_DELAY = 15000;
const SPAWN_MIN_DIST = 550;        // un flic n'apparaît jamais sous le nez d'un joueur...
const SPAWN_MAX_DIST = 1200;       // ... mais pas trop loin non plus (il arrive vite)
export const MAX_COPS = [3, 4, 5, 6, 7];   // flics par joueur libre, selon les étoiles
export const MAX_TOTAL = 40;              // et jamais plus de 40 en tout (pour que ça reste fluide)
// Les véhicules de police selon les étoiles (chances sur 100).
//   sport = chasse · moto = rapide et agile mais ne bloque rien · minivan = coupe la route
//   supercar = très rapide (⭐⭐⭐) · truck = bulldozer qui bloque tout (⭐⭐⭐)
export const COP_MIX = [
  { sport: 60, moto: 40 },
  { sport: 45, moto: 25, minivan: 30 },
  { sport: 30, moto: 20, minivan: 20, supercar: 15, truck: 15 },
  { sport: 25, moto: 15, minivan: 20, supercar: 20, truck: 20 },
  { sport: 20, moto: 15, minivan: 20, supercar: 25, truck: 20 },
];
// Moteur des flics : ⭐ ×1 → ⭐⭐⭐⭐⭐ ×1,25. À partir de ⭐⭐⭐, une Sportive boostée va aussi vite qu'une F1 :
// il faut semer la police dans les rues, pas juste tenir la ligne droite.
export const COP_POWER = (stars) => 0.95 + 0.06 * stars;
const HELI_STARS = 4;
export const SURVIVE_BONUS = 3, PER_20S = 1, COP_ARREST = 2;

const COP_COLOR = "#16213e";

function defaultSettings() {
  return { rounds: 3, duration: 120 };
}

export const playlist = {
  options: [
    {
      key: "rounds", label: "Manches", default: "2",
      choices: [{ v: "2", label: "2" }, { v: "3", label: "3" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: Number(c.rounds) === 3 ? 3 : 2 };
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    round: 0,
    city: null,
    env: null,
    roadCells: [],        // cases de rue atteignables (pour faire apparaître les voitures)
    cars: {},             // id joueur -> { car, role: "free" | "cop", bot, seq, lastInputAt, ai, arrest, freeMs }
    cops: [],             // flics IA : { id, car, ai }
    copId: 0,
    arrests: [],          // { id, at, by: [ids joueurs-flics] }
    gains: {},
    playAt: 0,
    timeUpAt: 0,
    endAt: 0,
    stars: 1,
    heli: null,           // { target, x, y }
    fields: {},           // id joueur libre -> distances (pour l'IA)
    copField: null,       // distance aux flics (pour les bots qui fuient)
    fieldsAt: 0,
    nextSpawnAt: 0,
    phaseEnd: 0,
    lastRound: null,
    loop: null,
    fx: [],
    fxId: 0,
    final: false,
    finishAt: 0,
    finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const freeIds = () => Object.keys(g.cars).filter((id) => g.cars[id].role === "free");
  const durationMs = () => g.settings.duration * 1000;

  // Tous les véhicules de police (IA + joueurs arrêtés).
  function policeCars() {
    const list = g.cops.map((c) => c.car);
    for (const s of Object.values(g.cars)) if (s.role === "cop") list.push(s.car);
    return list;
  }

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s) — la ville n'est pas envoyée : juste sa seed.
  // =================================================================
  const carOut = (c) => ({ x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, w: c.w, nitro: c.nitro, slide: c.slide, st: c.st, boost: c.boost, type: c.type });
  function publicState() {
    const t = now();
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      city: g.city && { seed: g.city.seed, n: g.city.nPlayers },
      cars: Object.entries(g.cars).map(([id, s]) => ({ id, role: s.role, seq: s.seq, arrest: Math.min(1, s.arrest / ARREST_MS), ...carOut(s.car) })),
      // Flics IA : arrondis (ils peuvent être 32 : on allège ce qu'on envoie 30 fois par seconde).
      cops: g.cops.map(({ id, car: c }) => ({
        id, type: c.type, st: c.st, boost: c.boost,
        x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, a: Math.round(c.a * 1000) / 1000,
        vx: Math.round(c.vx), vy: Math.round(c.vy), w: Math.round(c.w * 100) / 100,
      })),
      stars: g.stars,
      heli: g.heli && { target: g.heli.target, x: Math.round(g.heli.x), y: Math.round(g.heli.y) },
      arrests: g.arrests,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      copsIn: g.phase === "play" ? Math.max(0, g.playAt + COPS_DELAY - t) : COPS_DELAY,
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.phase === "countdown" ? durationMs() : 0,
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600),
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
    const seed = Math.floor(Math.random() * 1e9);
    g.city = C.build(seed, list.length);
    g.city.nPlayers = list.length;
    g.env = { w: g.city.w, h: g.city.h, grip: 1, oils: [], obstacles: g.city.obstacles, nitro: true };
    // Les rues atteignables (la plus grande zone reliée).
    const nav = g.city.nav;
    const start = nav.free.findIndex((v, i) => v && i > nav.cols * 2);
    const d = C.field(nav, [start]);
    g.roadCells = [];
    for (let i = 0; i < d.length; i++) if (d[i] >= 0) g.roadCells.push(i);
    // Départs : éparpillés dans la ville, loin les uns des autres.
    g.cars = {};
    const spots = [];
    for (const p of shuffle(list)) {
      let best = null, bestD = -1;
      for (let k = 0; k < 40; k++) {
        const c = C.centerOf(nav, pick(g.roadCells));
        const dd = spots.length ? Math.min(...spots.map((s) => dist(s, c))) : rand(0, 1);
        if (dd > bestD) { bestD = dd; best = c; }
      }
      spots.push(best);
      const car = P.newCar(best.x, best.y, roadAngle(best), "f1");
      g.cars[p.id] = { car, role: "free", bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, arrest: 0, freeMs: 0 };
      g.scores[p.id] = g.scores[p.id] || 0;
    }
    g.cops = [];
    g.arrests = [];
    g.gains = {};
    g.stars = 1;
    g.heli = null;
    g.fields = {};
    g.copField = null;
    g.fieldsAt = 0;
    g.endAt = 0;
    g.fx = [];
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  // Une voiture posée dans une rue : tournée dans le sens de la rue (le côté le plus dégagé).
  function roadAngle(p) {
    const nav = g.city.nav;
    let best = 0, bestLen = -1;
    for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      let len = 0;
      for (let k = 1; k < 8; k++) {
        const c = C.cellOf(nav, p.x + Math.cos(a) * k * C.NAV, p.y + Math.sin(a) * k * C.NAV);
        if (!nav.free[c]) break;
        len++;
      }
      if (len > bestLen) { bestLen = len; best = a; }
    }
    return best;
  }

  function arrest(id, by) {
    const s = g.cars[id];
    const t = now();
    const at = t - g.playAt;
    g.arrests.push({ id, at, by });
    g.gains[id] = (g.gains[id] || 0) + Math.floor(at / 20000) * PER_20S;
    for (const cid of by) g.gains[cid] = (g.gains[cid] || 0) + COP_ARREST;
    // Il devient flic : un van de police, au même endroit.
    const c = s.car;
    s.car = { ...P.newCar(c.x, c.y, c.a, "minivan"), vx: c.vx * 0.3, vy: c.vy * 0.3 };
    s.role = "cop";
    s.arrest = 0;
    s.ai = {};
    addFx(c.x, c.y, 400, true);
    if (g.heli?.target === id) g.heli.target = null;
    if (freeIds().length === 0 && !g.endAt) g.endAt = t + END_DELAY;
  }

  function endRound() {
    stopLoop();
    const t = now();
    const survivors = freeIds();
    for (const id of survivors) g.gains[id] = (g.gains[id] || 0) + Math.floor(durationMs() / 20000) * PER_20S + SURVIVE_BONUS;
    for (const [id, n] of Object.entries(g.gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = { survivors, arrests: g.arrests, gains: { ...g.gains }, stars: g.stars };
    const last = g.round >= g.settings.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = t + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last && ctx.playlist) {
      g.phaseEnd = t + ROUND_OVER_MS;
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
  //  LA POLICE : niveau de recherche, apparitions, hélico
  // =================================================================
  function updateWanted(t) {
    const step = durationMs() / 5;
    g.stars = Math.min(5, 1 + Math.floor((t - g.playAt) / step));
    if (t < g.playAt + COPS_DELAY) return;
    // Apparitions : une toutes les quelques secondes, jusqu'au maximum.
    const free = freeIds();
    const max = Math.min(MAX_TOTAL, MAX_COPS[g.stars - 1] * free.length);
    if (free.length && g.cops.length < max && t >= g.nextSpawnAt) {
      spawnCop(free);
      // Plus il y a de fugitifs, plus ça arrive vite.
      g.nextSpawnAt = t + Math.max(350, ((3000 - g.stars * 400) / Math.max(1, free.length / 2)) * rand(0.7, 1.2));
    }
    // L'hélico : à partir de ⭐⭐⭐⭐, il suit un joueur libre.
    if (g.stars >= HELI_STARS && free.length) {
      if (!g.heli) g.heli = { target: null, x: g.city.w / 2, y: -200 };
      if (!g.heli.target || !g.cars[g.heli.target] || g.cars[g.heli.target].role !== "free") {
        // Le plus longtemps libre... ou au hasard.
        g.heli.target = pick(free);
      }
      const tc = g.cars[g.heli.target].car;
      const dx = tc.x - g.heli.x, dy = tc.y - g.heli.y, d = Math.hypot(dx, dy) || 1;
      const v = Math.min(d, 520 * P.TICK);
      g.heli.x += (dx / d) * v; g.heli.y += (dy / d) * v;
    } else if (!free.length) g.heli = null;
  }

  function spawnCop(free) {
    const targets = free.map((id) => g.cars[id].car);
    const others = policeCars();
    let spot = null;
    for (let k = 0; k < 60 && !spot; k++) {
      const c = C.centerOf(g.city.nav, pick(g.roadCells));
      const dMin = Math.min(...targets.map((t) => dist(t, c)));
      if (dMin < SPAWN_MIN_DIST || dMin > SPAWN_MAX_DIST) continue;
      if (others.some((o) => dist(o, c) < 70)) continue;
      spot = c;
    }
    if (!spot) return;
    const mix = COP_MIX[g.stars - 1];
    let r = Math.random() * 100, type = "sport";
    for (const [ty, w] of Object.entries(mix)) { if ((r -= w) < 0) { type = ty; break; } }
    const car = P.newCar(spot.x, spot.y, roadAngle(spot), type);
    g.cops.push({ id: "cop" + ++g.copId, car, ai: {} });
  }

  // Les distances (en suivant les rues) vers chaque joueur libre, et vers les flics.
  function updateFields(t) {
    if (t - g.fieldsAt < 350) return;
    g.fieldsAt = t;
    const nav = g.city.nav;
    g.fields = {};
    g.aheadFields = {};
    for (const id of freeIds()) {
      const c = g.cars[id].car;
      g.fields[id] = C.field(nav, [C.nearestFree(nav, C.cellOf(nav, c.x, c.y))]);
      const ax = Math.max(0, Math.min(g.city.w, c.x + c.vx * 1.3)), ay = Math.max(0, Math.min(g.city.h, c.y + c.vy * 1.3));
      g.aheadFields[id] = C.field(nav, [C.nearestFree(nav, C.cellOf(nav, ax, ay))]);
    }
    const pc = policeCars();
    g.copField = pc.length ? C.field(nav, pc.map((c) => C.nearestFree(nav, C.cellOf(nav, c.x, c.y)))) : null;
  }

  // =================================================================
  //  CONDUITE DE L'IA (flics et bots fugitifs)
  // =================================================================
  function steerTo(car, ai, target, opts = {}) {
    const speed = Math.hypot(car.vx, car.vy);
    ai.reverse = Math.max(0, (ai.reverse || 0) - P.TICK);
    if (ai.wantGo && speed < 25) ai.stuck = (ai.stuck || 0) + P.TICK; else ai.stuck = 0;
    if (ai.stuck > 0.7) { ai.reverse = 0.7; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? K.LEFT : K.RIGHT; }
    if (ai.reverse > 0) { ai.wantGo = false; return K.DOWN | ai.revSteer; }
    if (!target) { ai.wantGo = false; return speed > 30 ? K.DOWN : 0; }
    const want = Math.atan2(target.y - car.y, target.x - car.x);
    const diff = angDiff(want, car.a);
    let k = 0;
    if (diff > 0.1) k |= K.RIGHT; else if (diff < -0.1) k |= K.LEFT;
    // On ralentit dans les virages serrés (sinon on finit dans un mur).
    const sharp = Math.abs(diff);
    if (sharp < 1.6 || speed < 90) {
      if (sharp > 0.7 && speed > (opts.corner || 230)) k |= K.DOWN;
      else k |= K.UP;
      ai.wantGo = true;
    } else { k |= K.DOWN; ai.wantGo = false; }
    if (opts.nitro && sharp < 0.2 && car.nitro > 0.3) k |= K.NITRO;
    return k;
  }

  // Un flic IA : il suit les rues vers sa cible, puis fonce dessus de près.
  function copKeys(cop, idx) {
    const c = cop.car, ai = cop.ai, nav = g.city.nav;
    ai.think = (ai.think || 0) - P.TICK;
    if (ai.think <= 0 || !ai.target || !g.cars[ai.target] || g.cars[ai.target].role !== "free") {
      ai.think = 0.5 + Math.random() * 0.3;
      // Cible : le joueur libre le plus proche (par la route) ; la moitié des flics suit l'hélico.
      let best = null, bestD = 1e9;
      const cell = C.nearestFree(nav, C.cellOf(nav, c.x, c.y));
      for (const [id, f] of Object.entries(g.fields)) {
        const d = f[cell] < 0 ? 1e8 : f[cell];
        if (d < bestD) { bestD = d; best = id; }
      }
      if (g.heli?.target && g.fields[g.heli.target] && idx % 2 === 0) best = g.heli.target;
      ai.target = best;
    }
    if (!ai.target || !g.fields[ai.target]) return steerTo(c, ai, null);
    const t = g.cars[ai.target].car;
    const d = dist(c, t);
    // Vans et camions visent devant le joueur (pour lui couper la route), les autres le percutent.
    const lead = c.type === "minivan" || c.type === "truck" ? 0.8 : 0.35;
    let target;
    // 1 flic sur 3 (et tous les vans/camions) ne suit pas le fugitif : il file là où il va arriver, pour le prendre en tenaille.
    const cutter = idx % 3 === 1 || lead > 0.5;
    if (d < 230) target = { x: t.x + t.vx * lead * (d / 230), y: t.y + t.vy * lead * (d / 230) };
    else target = C.lookAhead(nav, (cutter && g.aheadFields?.[ai.target]) || g.fields[ai.target], c.x, c.y, 3);
    // Nitro en ligne droite quand le fugitif est loin (sauf les camions).
    return steerTo(c, ai, target, { corner: CORNER[c.type] || 210, nitro: c.type !== "truck" && d > 260 });
  }
  // Vitesse max dans un virage serré, selon le véhicule.
  const CORNER = { moto: 270, supercar: 240, sport: 210, minivan: 190, truck: 160 };

  // Un bot fugitif : il choisit un point loin des flics et y va par les rues.
  function fleeKeys(id, s) {
    const c = s.car, ai = s.ai, nav = g.city.nav;
    ai.think = (ai.think || 0) - P.TICK;
    const near = Math.min(1e9, ...policeCars().map((o) => dist(o, c)));
    if (ai.think <= 0 || (near < 160 && !ai.panic) || (ai.goal && dist(ai.goal, c) < 80)) {
      ai.think = 1.6 + Math.random();
      ai.panic = near < 160;
      let best = null, bestScore = -1e9;
      for (let k = 0; k < 24; k++) {
        const cell = pick(g.roadCells);
        const p = C.centerOf(nav, cell);
        const danger = g.copField && g.copField[cell] >= 0 ? g.copField[cell] : 60;
        const score = danger * 3 - dist(p, c) / C.NAV * 0.5 + rand(0, 6);
        if (score > bestScore) { bestScore = score; best = cell; }
      }
      ai.goal = C.centerOf(nav, best);
      ai.goalField = C.field(nav, [best]);
    } else if (!ai.panic || near > 260) ai.panic = false;
    const target = ai.goalField ? C.lookAhead(nav, ai.goalField, c.x, c.y, 3) : null;
    return steerTo(c, ai, target, { corner: 250, nitro: near < 300 });
  }

  // =================================================================
  //  PHYSIQUE
  // =================================================================
  const bonusOf = (car, isCop) => (isCop ? COP_POWER(g.stars) : 1);
  function allCars() {
    const list = [];
    for (const [id, s] of Object.entries(g.cars)) list.push({ id, car: s.car });
    for (const c of g.cops) list.push({ id: c.id, car: c.car });
    return list;
  }

  function advanceCar(car, k, isCop, selfId) {
    const dt = P.TICK / P.SUB;
    const others = allCars().filter((o) => o.id !== selfId && Math.abs(o.car.x - car.x) < 140 && Math.abs(o.car.y - car.y) < 140);
    for (let sub = 0; sub < P.SUB; sub++) {
      P.drive(car, k, dt, g.env, bonusOf(car, isCop));
      const hit = P.collideStatic(car, g.env);
      if (hit > 220) addFx(car.x, car.y, hit);
      for (const o of others) {
        const res = P.collideCars(car, o.car);
        if (res.impact > 140) addFx(res.x, res.y, res.impact);
      }
    }
  }

  // Les arrestations : presque à l'arrêt + au moins 2 véhicules de police autour, pendant 1 s.
  function checkArrests() {
    const police = [];
    for (const c of g.cops) police.push({ id: null, car: c.car });
    for (const [id, s] of Object.entries(g.cars)) if (s.role === "cop") police.push({ id, car: s.car });
    for (const id of freeIds()) {
      const s = g.cars[id], c = s.car;
      const around = police.filter((p) => dist(p.car, c) < ARREST_DIST);
      const slow = Math.hypot(c.vx, c.vy) < ARREST_SPEED;
      if (slow && around.length >= 2) {
        s.arrest += TICK_MS;
        if (s.arrest >= ARREST_MS) arrest(id, around.map((p) => p.id).filter(Boolean));
      } else s.arrest = Math.max(0, s.arrest - TICK_MS * 2);
    }
  }

  function addFx(x, y, s, big = false) {
    const t = now();
    if (!big && g.fx.some((f) => t - f.t < 150 && Math.hypot(f.x - x, f.y - y) < 40)) return;
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), s: Math.round(s), big });
    if (g.fx.length > 40) g.fx.shift();
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) {
        g.phase = "play";
        g.playAt = t;
        g.timeUpAt = t + durationMs();
        g.nextSpawnAt = t + COPS_DELAY;
      }
    } else if (g.phase === "play") {
      updateWanted(t);
      updateFields(t);
      g.cops.forEach((cop, i) => advanceCar(cop.car, copKeys(cop, i), true, cop.id));
      for (const [id, s] of Object.entries(g.cars)) {
        if (s.bot) advanceCar(s.car, s.role === "cop" ? copKeys(s, 0) : fleeKeys(id, s), s.role === "cop", id);
        else if (t - s.lastInputAt > 200) advanceCar(s.car, 0, s.role === "cop", id);   // onglet en pause
      }
      if (!g.endAt) checkArrests();
      if (!g.endAt && t >= g.timeUpAt) g.endAt = t + END_DELAY;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    if (!g.cars[id] || !["countdown", "play"].includes(g.phase)) return;
    delete g.cars[id];
    if (g.phase === "play" && freeIds().length === 0 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![2, 3, 5].includes(s.rounds)) s.rounds = 3;
      if (![90, 120, 180].includes(s.duration)) s.duration = 120;
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
    in(pid, { s, k }) {
      const st = g.cars[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      advanceCar(st.car, k & 63, st.role === "cop", pid);
    },
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "over" || ctx.playlist) return;
      g.phase = "setup";
      ctx.update();
    },
    finish(pid) {
      // (en pleine manche aussi : on garde les points déjà marqués)
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
