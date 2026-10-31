// ===================================================================
//  PATATE CHAUDE — Moteur du jeu (module du hub Le Bordel)
//  Des petites voitures téléguidées dans une arène aléatoire. Une
//  voiture porte la bombe et la refile en touchant une autre. Quand
//  la mèche (cachée) arrive au bout : BOUM, éliminé (l'épave reste).
//  C'est le SERVEUR qui fait foi : il calcule tout 30 fois par seconde
//  avec la même physique que le navigateur (physics.js).
// ===================================================================

import "../../public/games/patate/physics.js";
import { generateMap } from "./maps.js";

const P = globalThis.PatatePhysics;
const K = P.K;

export const meta = {
  id: "patate",
  name: "Patate chaude",
  emoji: "💣",
  family: "Action",
  minPlayers: 3,
  maxPlayers: 6,
  description: "Petites voitures, une bombe : refile-la avant qu'elle explose !",
};

// --- Rythme ---
const TICK_MS = 1000 / 30;     // 30 calculs par seconde
const NO_PASS_BACK = 1.0;      // pas de renvoi immédiat au précédent (s)
const PASS_COOLDOWN = 0.3;     // délai mini entre deux passes (s)
const COUNTDOWN_MS = 3000;     // compte à rebours en début de manche
const RESPAWN_MS = 2000;       // pause avant la bombe suivante
const BOOM_MS = 1800;          // durée de l'explosion à l'écran
const MAX_QUEUE = 4;           // touches en attente max par joueur (évite le retard qui s'accumule)

// Durée de la mèche (en secondes, tirée au hasard dans l'intervalle).
// ("test" = mèche éclair utilisée seulement par les tests automatiques.)
const FUSES = { courte: [12, 20], normale: [18, 30], longue: [28, 42], test: [4, 6] };

function defaultSettings() {
  return { fuse: "normale", nitro: true, slippery: true };
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const r2 = (v) => Math.round(v * 100) / 100;
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ===================================================================
//  CRÉATION D'UNE PARTIE (appelée par le hub)
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | boom | roundOver
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},           // points Patate (classement final)
    roundNum: 0,
    map: null,
    env: null,            // ce dont la physique a besoin (murs, sol, huile)
    cars: {},             // id -> { car, alive, bot, queue, lastK, seq, ai }
    holderId: null,
    prevHolder: null,
    lastPassAt: 0,
    fuseStart: 0,
    fuseEnd: 0,
    phaseEnd: 0,
    elimOrder: [],
    lastBoom: null,       // { id, x, y }
    lastRound: null,
    fx: [],               // chocs récents (pour les étincelles côté navigateur)
    fxId: 0,
    loop: null,
  };

  const now = () => Date.now();
  const aliveIds = () => Object.keys(g.cars).filter((id) => g.cars[id].alive);

  // =================================================================
  //  ÉTAT PUBLIC (envoyé 30 fois par seconde pendant le jeu)
  // =================================================================
  function publicState() {
    const t = now();
    let heat = 0;
    if (g.phase === "play" && g.fuseEnd > g.fuseStart) {
      heat = Math.min(1, (t - g.fuseStart) / (g.fuseEnd - g.fuseStart));
    }
    g.fx = g.fx.filter((f) => t - f.t < 600);
    return {
      phase: g.phase,
      settings: g.settings,
      roundNum: g.roundNum,
      players: ctx.players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      map: g.map && {
        id: g.map.id, surface: g.map.surface, grip: g.map.grip, seed: g.map.seed,
        obstacles: g.map.obstacles, oils: g.map.oils, w: P.W, h: P.H,
      },
      cars: Object.entries(g.cars).map(([id, s]) => ({
        id, alive: s.alive, seq: s.seq,
        x: r2(s.car.x), y: r2(s.car.y), a: Math.round(s.car.a * 1000) / 1000,
        vx: r2(s.car.vx), vy: r2(s.car.vy), w: r2(s.car.w),
        nitro: r2(s.car.nitro), slide: s.car.slide, st: s.car.st, boost: s.car.boost,
      })),
      holderId: g.holderId,
      heat,                                   // 0 -> 1 : la bombe clignote de plus en plus vite
      phaseLeft: Math.max(0, g.phaseEnd - t), // ms restantes (compte à rebours, explosion)
      lastBoom: g.lastBoom,
      lastRound: g.lastRound,
      fx: g.fx.map(({ id, x, y, s, cars }) => ({ id, x, y, s, cars })),
    };
  }

  // =================================================================
  //  DÉROULÉ D'UNE MANCHE
  // =================================================================
  function startRound() {
    const players = ctx.players().filter((p) => p.connected);
    g.roundNum++;
    g.map = generateMap({ W: P.W, H: P.H, players: players.length, slippery: g.settings.slippery });
    g.env = { w: P.W, h: P.H, grip: g.map.grip, oils: g.map.oils, obstacles: g.map.obstacles, nitro: g.settings.nitro };
    g.cars = {};
    g.elimOrder = [];
    g.lastBoom = null;
    g.lastRound = null;
    g.fx = [];

    players.forEach((p, i) => {
      const s = g.map.spawns[i];
      g.cars[p.id] = { car: P.newCar(s.x, s.y, s.a), alive: true, bot: !!p.bot, queue: [], lastK: 0, seq: 0, ai: {} };
      g.scores[p.id] = g.scores[p.id] || 0;   // il apparaît au classement
    });

    giveBomb(pick(players).id);
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function giveBomb(id) {
    g.holderId = id;
    g.prevHolder = null;
    g.lastPassAt = 0;
  }

  function lightFuse() {
    const [a, b] = FUSES[g.settings.fuse] || FUSES.normale;
    g.fuseStart = now();
    g.fuseEnd = g.fuseStart + rand(a, b) * 1000;
  }

  function eliminate(id) {
    const s = g.cars[id];
    if (!s || !s.alive) return;
    s.alive = false;
    s.car.boost = false;
    g.elimOrder.push(id);
  }

  function explode() {
    const id = g.holderId;
    const c = g.cars[id].car;
    g.lastBoom = { id, x: Math.round(c.x), y: Math.round(c.y) };
    // Le souffle repousse les voitures proches.
    for (const oid of aliveIds()) {
      if (oid === id) continue;
      const o = g.cars[oid].car;
      const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy) || 1;
      if (d < 220) {
        const f = (1 - d / 220) * 420;
        o.vx += (dx / d) * f; o.vy += (dy / d) * f;
        o.w += (Math.random() - 0.5) * 10 * (1 - d / 220);
        o.slide = true;
      }
    }
    // L'épave est projetée et tourne.
    c.vx *= 0.3; c.vy *= 0.3; c.w = (Math.random() - 0.5) * 6;
    eliminate(id);
    g.holderId = null;
    g.phase = "boom";
    g.phaseEnd = now() + BOOM_MS;
  }

  function nextBombOrEnd() {
    const alive = aliveIds();
    if (alive.length <= 1) return endRound();
    giveBomb(pick(alive));
    g.phase = "countdown";
    g.phaseEnd = now() + RESPAWN_MS;
  }

  // Points : 1 par joueur éliminé avant toi, le gagnant a n-1.
  function endRound() {
    const ids = Object.keys(g.cars);
    const order = [...g.elimOrder, ...aliveIds()];   // du 1er éliminé au gagnant
    g.lastRound = order.map((id, i) => ({ id, points: i, place: ids.length - i })).reverse();
    for (const r of g.lastRound) g.scores[r.id] = (g.scores[r.id] || 0) + r.points;
    g.holderId = null;
    g.phase = "roundOver";
    stopLoop();
    ctx.update();
  }

  // =================================================================
  //  BOTS AU VOLANT
  //  Le porteur fonce sur la voiture la plus proche, les autres fuient
  //  vers un point loin de la bombe. S'ils sont coincés, ils reculent.
  // =================================================================
  function botKeys(id, s, dt) {
    const c = s.car, ai = s.ai;
    const speed = Math.hypot(c.vx, c.vy);
    ai.think = (ai.think || 0) - dt;
    ai.reverse = Math.max(0, (ai.reverse || 0) - dt);

    // Coincé contre un mur ? On recule en braquant.
    if (ai.wantGo && speed < 30) ai.stuck = (ai.stuck || 0) + dt; else ai.stuck = 0;
    if (ai.stuck > 0.8) { ai.reverse = 0.9; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? K.LEFT : K.RIGHT; }
    if (ai.reverse > 0) { ai.wantGo = false; return K.DOWN | ai.revSteer; }

    const holder = g.holderId && g.cars[g.holderId]?.car;
    if (ai.think <= 0) {
      ai.think = 0.25 + Math.random() * 0.2;   // réfléchit ~4 fois par seconde
      if (id === g.holderId) {
        // Chasse : la voiture la plus proche (en visant un peu devant elle).
        let best = null, bestD = Infinity;
        for (const oid of aliveIds()) {
          if (oid === id) continue;
          const o = g.cars[oid].car;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          if (d < bestD) { bestD = d; best = o; }
        }
        if (best) ai.target = { x: best.x + best.vx * 0.3, y: best.y + best.vy * 0.3 };
        ai.dist = bestD;
      } else if (holder) {
        // Fuite : un point loin de la bombe (on en change de temps en temps).
        const dH = Math.hypot(holder.x - c.x, holder.y - c.y);
        ai.flee = (ai.flee || 0) - 0.3;
        if (!ai.target || ai.flee <= 0 || dH < 160) {
          let best = null, bestScore = -Infinity;
          for (let i = 0; i < 12; i++) {
            const p = { x: rand(90, P.W - 90), y: rand(90, P.H - 90) };
            if (g.map.obstacles.some((o) => p.x > o.x - 40 && p.x < o.x + o.w + 40 && p.y > o.y - 40 && p.y < o.y + o.h + 40)) continue;
            const score = Math.hypot(p.x - holder.x, p.y - holder.y) - 0.5 * Math.hypot(p.x - c.x, p.y - c.y);
            if (score > bestScore) { bestScore = score; best = p; }
          }
          if (best) ai.target = best;
          ai.flee = 1.5;
        }
        ai.dist = dH;
      } else {
        ai.target = null;
      }
    }

    if (!ai.target) { ai.wantGo = false; return 0; }
    const want = Math.atan2(ai.target.y - c.y, ai.target.x - c.x);
    const diff = angDiff(want, c.a);
    let k = 0;
    if (diff > 0.12) k |= K.RIGHT;
    else if (diff < -0.12) k |= K.LEFT;
    if (Math.abs(diff) < 1.9 || speed < 120) { k |= K.UP; ai.wantGo = true; }
    else { k |= K.DOWN; ai.wantGo = false; }
    if (Math.abs(diff) > 1.0 && speed > 230 && Math.random() < 0.4) k |= K.HB;          // dérapage pour tourner
    if (id === g.holderId && Math.abs(diff) < 0.25 && ai.dist > 220) k |= K.NITRO;      // nitro en ligne droite
    if (id !== g.holderId && ai.dist < 180 && Math.abs(diff) < 0.5) k |= K.NITRO;       // nitro pour s'échapper
    return k;
  }

  // =================================================================
  //  UN CALCUL DE PHYSIQUE (1/30 s, découpé en petits pas)
  // =================================================================
  function step() {
    const alive = aliveIds();
    const all = Object.keys(g.cars);

    // 1. Quelles touches pour chaque voiture ?
    const keys = {};
    for (const id of alive) {
      const s = g.cars[id];
      if (s.bot) { keys[id] = botKeys(id, s, P.TICK); continue; }
      // Un humain : on prend la prochaine touche reçue (ou la dernière connue).
      if (s.queue.length > MAX_QUEUE) s.queue.splice(0, s.queue.length - 2);
      const inp = s.queue.shift();
      if (inp) { s.lastK = inp.k; s.seq = inp.s; }
      keys[id] = s.lastK;
    }

    const dt = P.TICK / P.SUB;
    const t = now();
    for (let sub = 0; sub < P.SUB; sub++) {
      // 2. Conduite + murs. Les épaves glissent encore un peu puis s'arrêtent.
      for (const id of all) {
        const s = g.cars[id];
        P.drive(s.car, s.alive ? keys[id] : 0, dt, g.env, id === g.holderId ? P.HOLDER_BONUS : 1);
        const hit = P.collideStatic(s.car, g.env);
        if (hit > 180 && s.alive) addFx(s.car.x, s.car.y, hit, [id]);
      }
      // 3. Chocs entre voitures (les épaves sont des obstacles fixes).
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          let A = g.cars[all[i]], B = g.cars[all[j]];
          if (!A.alive && !B.alive) continue;
          let ida = all[i], idb = all[j];
          if (!A.alive) { [A, B] = [B, A]; [ida, idb] = [idb, ida]; }
          const res = P.collideCars(A.car, B.car, !B.alive);
          if (res.impact > 120) addFx(res.x, res.y, res.impact, [ida, idb]);
          if (res.touch && B.alive && g.phase === "play") tryPass(ida, idb, t);
        }
      }
    }
  }

  function addFx(x, y, s, cars) {
    const t = now();
    // Un seul effet par endroit et par instant (sinon chaque petit pas en rajoute).
    if (g.fx.some((f) => t - f.t < 150 && Math.hypot(f.x - x, f.y - y) < 40)) return;
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), s: Math.round(s), cars });
  }

  function tryPass(idA, idB, t) {
    let from, to;
    if (g.holderId === idA) { from = idA; to = idB; }
    else if (g.holderId === idB) { from = idB; to = idA; }
    else return;
    if (t - g.lastPassAt < PASS_COOLDOWN * 1000) return;
    if (to === g.prevHolder && t - g.lastPassAt < NO_PASS_BACK * 1000) return;
    g.holderId = to;
    g.prevHolder = from;
    g.lastPassAt = t;
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown") {
      // Voitures figées : on jette les touches reçues mais on note où en est chacun.
      for (const s of Object.values(g.cars)) {
        const last = s.queue.at(-1);
        if (last) { s.seq = last.s; s.lastK = 0; }
        s.queue.length = 0;
      }
      if (t >= g.phaseEnd) { g.phase = "play"; lightFuse(); }
    } else if (g.phase === "play" || g.phase === "boom") {
      step();
      if (g.phase === "play" && t >= g.fuseEnd) explode();
      else if (g.phase === "boom" && t >= g.phaseEnd) {
        nextBombOrEnd();
        if (g.phase === "roundOver") return;   // endRound a déjà tout envoyé
      }
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

  // Quelqu'un part en pleine manche : sa voiture devient une épave.
  function leave(id) {
    const s = g.cars[id];
    if (!s?.alive || !["countdown", "play", "boom"].includes(g.phase)) return;
    eliminate(id);
    const alive = aliveIds();
    if (alive.length <= 1) { endRound(); return; }
    if (g.holderId === id) giveBomb(pick(alive));
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      if (settings.fuse && (!FUSES[settings.fuse])) delete settings.fuse;
      g.settings = { ...g.settings, ...settings };
      ctx.saveSettings({ ...g.settings });
      ctx.update();
    },

    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase)) return;
      const n = ctx.players().filter((p) => p.connected).length;
      if (n < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startRound();
      ctx.update();
    },

    // Touches du joueur : { s: numéro, k: touches combinées } (30 fois/s).
    in(pid, { s, k }) {
      const st = g.cars[pid];
      if (!st || st.bot || typeof s !== "number") return;
      st.queue.push({ s, k: k & 63 });
    },

    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "roundOver") return;
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
    onDisconnect(pid) { leave(pid); ctx.update(); },
    canJoin: () => g.phase === "setup" || g.phase === "roundOver",
    destroy: stopLoop,
  };
}
