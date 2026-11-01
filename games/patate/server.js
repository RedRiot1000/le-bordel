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
const VEHICLE_VOTE_MS = 10000; // vote du véhicule avant la manche

// Durée de la mèche (en secondes, tirée au hasard dans l'intervalle).
// ("test" = mèche éclair utilisée seulement par les tests automatiques.)
const FUSES = { courte: [12, 20], normale: [18, 30], longue: [28, 42], test: [4, 6] };

function defaultSettings() {
  // vehicle : "vote" (on vote entre 2 véhicules) ou "hasard" (tiré au sort) — le même pour tout le monde.
  // holderNitro : celui qui a la bombe a plus de nitro, qui se recharge plus vite (pour l'aider).
  return { fuse: "normale", nitro: true, slippery: true, vehicle: "vote", holderNitro: true };
}

// ===================================================================
//  MODE PLAYLIST : ce que les joueurs peuvent voter, et ce que ça donne.
// ===================================================================
export const playlist = {
  options: [
    {
      key: "difficulty", label: "Difficulté", default: "normal",
      choices: [
        { v: "facile", label: "😌 Facile", hint: "Mèche longue, sol normal" },
        { v: "normal", label: "🙂 Normal", hint: "Mèche normale, sols variés" },
        { v: "difficile", label: "😈 Difficile", hint: "Mèche courte, sols glissants" },
      ],
    },
    {
      key: "rounds", label: "Nombre de manches", default: "3",
      choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }, { v: "7", label: "7" }],
    },
    {
      key: "nitro", label: "Nitro", default: "oui",
      choices: [{ v: "oui", label: "Oui" }, { v: "non", label: "Non" }],
    },
    {
      key: "vehicle", label: "Véhicule", default: "vote",
      choices: [
        { v: "vote", label: "🗳️ Vote", hint: "On vote entre 2 véhicules avant chaque manche" },
        { v: "hasard", label: "🎲 Hasard", hint: "Un véhicule tiré au sort à chaque manche" },
      ],
    },
  ],
  settingsFor(c) {
    const s = defaultSettings();
    s.vehicle = c.vehicle === "hasard" ? "hasard" : "vote";
    if (c.difficulty === "facile") { s.fuse = "longue"; s.slippery = false; }
    if (c.difficulty === "difficile") { s.fuse = "courte"; s.slippery = true; }
    s.nitro = c.nitro !== "non";
    return s;
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ===================================================================
//  CRÉATION D'UNE PARTIE (appelée par le hub)
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | vehicle | countdown | play | boom | roundOver
    vehicle: "sport",     // le véhicule de la manche (le même pour tous)
    vv: null,             // vote du véhicule : { choices: [a, b], votes: { id: type } }
    botTimers: [],
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
    // Mode playlist : nombre de manches limité, puis fin automatique.
    roundsPlayed: 0,
    final: false,
    finishAt: 0,
    finishTimer: null,
  };
  const FINISH_DELAY = 15000;   // temps pour lire les résultats avant le classement

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
      t,                                      // heure du serveur (pour lisser l'affichage)
      phase: g.phase,
      settings: g.settings,
      roundNum: g.roundNum,
      playlist: ctx.playlist && {
        rounds: ctx.playlist.rounds, played: g.roundsPlayed, final: g.final,
        finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
      },
      players: ctx.players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      vehicle: g.vehicle,
      vehicleVote: g.phase === "vehicle" ? g.vv : null,
      map: g.map && {
        id: g.map.id, surface: g.map.surface, grip: g.map.grip, seed: g.map.seed,
        obstacles: g.map.obstacles, oils: g.map.oils, w: P.W, h: P.H,
      },
      // Valeurs EXACTES (pas d'arrondi) : le navigateur refait les mêmes calculs
      // à partir d'elles, le moindre arrondi finirait en petite saccade.
      cars: Object.entries(g.cars).map(([id, s]) => ({
        id, alive: s.alive, seq: s.seq, type: s.car.type,
        x: s.car.x, y: s.car.y, a: s.car.a, vx: s.car.vx, vy: s.car.vy, w: s.car.w,
        nitro: s.car.nitro, slide: s.car.slide, st: s.car.st, boost: s.car.boost,
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
    g.env = { w: P.W, h: P.H, grip: g.map.grip, oils: g.map.oils, obstacles: g.map.obstacles, nitro: g.settings.nitro, holderNitro: g.settings.holderNitro };
    g.cars = {};
    g.elimOrder = [];
    g.lastBoom = null;
    g.lastRound = null;
    g.fx = [];

    players.forEach((p, i) => {
      const s = g.map.spawns[i];
      g.cars[p.id] = { car: P.newCar(s.x, s.y, s.a), alive: true, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {} };
      g.scores[p.id] = g.scores[p.id] || 0;   // il apparaît au classement
    });

    giveBomb(pick(players).id);
    startLoop();
    if (g.settings.vehicle === "hasard") return setVehicle(pick(P.TYPES));

    // Vote : 2 véhicules différents tirés au sort, 10 s pour choisir.
    const a = pick(P.TYPES);
    g.vv = { choices: [a, pick(P.TYPES.filter((t) => t !== a))], votes: {} };
    setVehicle(g.vv.choices[0], "vehicle");
    g.phaseEnd = now() + VEHICLE_VOTE_MS;
    for (const p of players.filter((p) => p.bot)) {
      g.botTimers.push(setTimeout(() => voteVehicle(p.id, pick(g.vv?.choices || [])), 1500 + Math.random() * 4000));
    }
  }

  // Tout le monde prend le même véhicule, puis compte à rebours.
  function setVehicle(type, phase = "countdown") {
    g.vehicle = type;
    for (const s of Object.values(g.cars)) s.car.type = type;
    g.phase = phase;
    g.phaseEnd = now() + COUNTDOWN_MS;
  }

  function voteVehicle(pid, type) {
    if (g.phase !== "vehicle" || !g.cars[pid] || !g.vv.choices.includes(type)) return { error: "Vote impossible." };
    g.vv.votes[pid] = type;
    // Tout le monde a voté : on n'attend pas la fin du chrono.
    const voters = ctx.players().filter((p) => p.connected && g.cars[p.id]);
    if (voters.every((p) => g.vv.votes[p.id])) g.phaseEnd = Math.min(g.phaseEnd, now() + 800);
    return { ok: true };
  }

  // Fin du vote : le plus voté gagne (égalité ou aucun vote = au hasard).
  function endVehicleVote() {
    const counts = Object.fromEntries(g.vv.choices.map((t) => [t, 0]));
    for (const t of Object.values(g.vv.votes)) counts[t]++;
    const max = Math.max(...Object.values(counts));
    g.vv.winner = pick(g.vv.choices.filter((t) => counts[t] === max));
    setVehicle(g.vv.winner);
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

    // Playlist : c'était la dernière manche ? Classement automatique dans 15 s.
    g.roundsPlayed++;
    if (ctx.playlist && g.roundsPlayed >= ctx.playlist.rounds) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
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
  //  FAIRE AVANCER UNE VOITURE de 1/30 s (en 3 petits pas), avec les
  //  murs et les chocs contre les autres voitures.
  //  Pour un humain, on l'appelle À CHAQUE TOUCHE REÇUE : le serveur fait
  //  donc exactement le même calcul que son navigateur (aucune correction
  //  sauf en cas de choc), d'où une conduite bien fluide.
  // =================================================================
  function advanceCar(id, k) {
    const s = g.cars[id];
    const dt = P.TICK / P.SUB;
    const t = now();
    const bonus = id === g.holderId ? P.HOLDER_BONUS : 1;
    for (let sub = 0; sub < P.SUB; sub++) {
      P.drive(s.car, s.alive ? k : 0, dt, g.env, bonus);
      const hit = P.collideStatic(s.car, g.env);
      if (hit > 180 && s.alive) addFx(s.car.x, s.car.y, hit, [id]);
      if (!s.alive) continue;
      for (const oid in g.cars) {
        if (oid === id) continue;
        const o = g.cars[oid];
        const res = P.collideCars(s.car, o.car, !o.alive);   // les épaves ne bougent pas
        if (res.impact > 120) addFx(res.x, res.y, res.impact, [id, oid]);
        if (res.touch && o.alive && g.phase === "play") tryPass(id, oid, t);
      }
    }
  }

  // Un calcul de la boucle : bots, épaves, et humains silencieux.
  function step() {
    const t = now();
    for (const [id, s] of Object.entries(g.cars)) {
      if (!s.alive) advanceCar(id, 0);                         // l'épave finit de glisser
      else if (s.bot) advanceCar(id, botKeys(id, s, P.TICK));
      else if (t - s.lastInputAt > 200) advanceCar(id, 0);     // onglet en pause : la voiture roule en roue libre
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
    if (g.phase === "vehicle") {
      if (t >= g.phaseEnd) endVehicleVote();
    } else if (g.phase === "countdown") {
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
  function stopLoop() {
    clearInterval(g.loop); g.loop = null;
    g.botTimers.forEach(clearTimeout); g.botTimers = [];
  }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // Quelqu'un part en pleine manche : sa voiture devient une épave.
  function leave(id) {
    const s = g.cars[id];
    if (!s?.alive || !["vehicle", "countdown", "play", "boom"].includes(g.phase)) return;
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
      if (settings.vehicle && !["vote", "hasard"].includes(settings.vehicle)) delete settings.vehicle;
      g.settings = { ...g.settings, ...settings };
      ctx.saveSettings({ ...g.settings });
      ctx.update();
    },

    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase) || g.final) return;
      const n = ctx.players().filter((p) => p.connected).length;
      if (n < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startRound();
      ctx.update();
    },

    // Touches du joueur : { s: numéro, k: touches combinées } (30 fois/s).
    // Chaque message = la voiture avance de 1/30 s tout de suite.
    in(pid, { s, k }) {
      const st = g.cars[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (!st.alive || !["play", "boom"].includes(g.phase)) return;   // figé (compte à rebours)
      // Anti-triche simple : pas plus de ~36 calculs par seconde.
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      advanceCar(pid, k & 63);
    },

    // Vote du véhicule avant la manche.
    vehicle(pid, { type }) { return voteVehicle(pid, type); },

    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "roundOver" || ctx.playlist) return;   // en playlist, pas de réglages
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

    // Mode playlist : on saute l'écran de réglages et on lance la 1re manche.
    autoStart() {
      if (ctx.players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startRound();
      ctx.update();
    },

    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
