// ===================================================================
//  CAR-FOOT — Moteur du jeu (module du hub Le Bordel)
//  Du foot avec les petites voitures : 2 équipes, un ballon, 2 cages.
//  Le SERVEUR fait foi : voitures + ballon calculés 30 fois par seconde
//  avec la physique partagée (physics.js + ball.js).
// ===================================================================

import "../../public/games/patate/physics.js";
import "../../public/games/carfoot/ball.js";

const P = globalThis.PatatePhysics;
const B = globalThis.CarFootBall;
const K = P.K;

export const meta = {
  id: "carfoot",
  name: "Car-foot",
  emoji: "⚽",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Du foot avec les petites voitures : 2 équipes, un gros ballon, nitro !",
};

const TICK_MS = 1000 / 30;
const KICKOFF_MS = 3000;       // compte à rebours de remise en jeu
const GOAL_MS = 3000;          // célébration d'un but
const OVERTIME_MAX = 90000;    // but en or : 90 s max, sinon match nul
const FINISH_DELAY = 15000;    // playlist : temps pour lire le résultat

export const TEAMS = { blue: { name: "Bleus", emoji: "🔵", color: "#3a8bff" }, red: { name: "Rouges", emoji: "🔴", color: "#ff4d5a" } };

function defaultSettings() {
  return { duration: 3, golden: true };
}

// ===================================================================
//  MODE PLAYLIST
// ===================================================================
export const playlist = {
  options: [
    {
      key: "duration", label: "Durée du match", default: "3",
      choices: [{ v: "2", label: "2 min" }, { v: "3", label: "3 min" }, { v: "5", label: "5 min" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), duration: [2, 3, 5].includes(Number(c.duration)) ? Number(c.duration) : 3 };
  },
};

const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Places de remise en jeu (côté gauche ; le côté droit est le miroir).
const SPOTS = {
  1: [[0.28, 0.5]],
  2: [[0.24, 0.32], [0.24, 0.68]],
  3: [[0.3, 0.5], [0.16, 0.26], [0.16, 0.74]],
  4: [[0.32, 0.36], [0.32, 0.64], [0.14, 0.24], [0.14, 0.76]],
};

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | kickoff | play | goal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    teams: { blue: [], red: [] },
    teamOf: {},
    score: { blue: 0, red: 0 },
    goals: [],            // { team, by, own, at } (at = minute du match)
    stats: {},            // id -> { goals, own }
    cars: {},
    ball: B.newBall(),
    lastTouch: null,      // dernier à avoir touché le ballon (le buteur)
    clock: 0,             // temps de jeu écoulé (ms), arrêté pendant les célébrations
    overtime: false,
    phaseEnd: 0,
    lastGoal: null,
    result: null,
    loop: null,
    lastTickAt: 0,
    fx: [],
    fxId: 0,
    final: false,
    finishAt: 0,
    finishTimer: null,
  };
  const env = B.env();
  const now = () => Date.now();
  const players = () => ctx.players();
  const duration = () => g.settings.duration * 60000;

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s)
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p, team: g.teamOf[p.id] || null })),
      teams: g.teams,
      teamInfo: TEAMS,
      score: g.score,
      goals: g.goals,
      stats: g.stats,
      clockLeft: Math.max(0, duration() - g.clock),
      overtime: g.overtime,
      overtimeLeft: g.overtime ? Math.max(0, OVERTIME_MAX - (g.clock - duration())) : 0,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      cars: Object.entries(g.cars).map(([id, s]) => ({
        id, seq: s.seq, team: g.teamOf[id], type: "sport", alive: true,
        x: s.car.x, y: s.car.y, a: s.car.a, vx: s.car.vx, vy: s.car.vy, w: s.car.w,
        nitro: s.car.nitro, slide: s.car.slide, st: s.car.st, boost: s.car.boost,
      })),
      ball: g.ball,
      lastGoal: g.lastGoal,
      result: g.result,
      fx: g.fx.filter((f) => t - f.t < 600),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startMatch() {
    const list = shuffle(players().filter((p) => p.connected));
    g.teams = { blue: [], red: [] };
    g.teamOf = {};
    list.forEach((p, i) => { const tm = i % 2 ? "red" : "blue"; g.teams[tm].push(p.id); g.teamOf[p.id] = tm; });
    g.score = { blue: 0, red: 0 };
    g.goals = [];
    g.stats = Object.fromEntries(list.map((p) => [p.id, { goals: 0, own: 0 }]));
    g.clock = 0;
    g.overtime = false;
    g.result = null;
    g.cars = {};
    for (const p of list) g.cars[p.id] = { car: null, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {} };
    kickoff();
    g.lastTickAt = now();
    startLoop();
  }

  // Remise en jeu : chacun dans son camp, ballon au centre, compte à rebours.
  function kickoff() {
    for (const tm of ["blue", "red"]) {
      const ids = g.teams[tm].filter((id) => g.cars[id]);
      const spots = SPOTS[Math.min(4, ids.length)] || [];
      ids.forEach((id, i) => {
        const [fx, fy] = spots[i] || [0.2, (i + 1) / (ids.length + 1)];
        const x = tm === "blue" ? B.GD + B.FW * fx : B.GD + B.FW * (1 - fx);
        const y = B.FH * fy;
        const a = Math.atan2(B.H / 2 - y, B.W / 2 - x);
        const old = g.cars[id].car;
        g.cars[id].car = { ...P.newCar(x, y, a), nitro: old ? old.nitro : 1 };
      });
    }
    // Gardien : dans une équipe d'au moins 2, un bot reste devant la cage.
    g.keeper = {};
    for (const tm of ["blue", "red"]) {
      const ids = g.teams[tm].filter((id) => g.cars[id]);
      const bots = ids.filter((id) => g.cars[id].bot);
      g.keeper[tm] = ids.length >= 2 && bots.length ? bots[bots.length - 1] : null;
    }
    g.ball = B.newBall();
    g.lastTouch = null;
    g.phase = "kickoff";
    g.phaseEnd = now() + KICKOFF_MS;
  }

  function scoreGoal(side) {
    // Ballon dans la cage de gauche = but pour les Rouges (les Bleus défendent à gauche).
    const team = side === "left" ? "red" : "blue";
    const by = g.lastTouch;
    const own = !!by && g.teamOf[by] !== team;
    g.score[team]++;
    if (by && g.stats[by]) { if (own) g.stats[by].own++; else g.stats[by].goals++; }
    g.lastGoal = { team, by, own, n: g.goals.length + 1 };
    g.goals.push({ team, by, own, min: Math.floor(g.clock / 60000) + 1, overtime: g.overtime });
    g.phase = "goal";
    g.phaseEnd = now() + GOAL_MS;
  }

  function endMatch() {
    stopLoop();
    const { blue, red } = g.score;
    g.result = blue > red ? "blue" : red > blue ? "red" : "draw";
    g.phase = "over";
    if (ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  // Points de soirée : l'équipe gagnante devant, match nul = tous ex æquo.
  function ranking() {
    const all = [...g.teams.blue, ...g.teams.red];
    if (!g.result || g.result === "draw") return all.length ? [all] : [];
    const lose = g.result === "blue" ? "red" : "blue";
    return [g.teams[g.result], g.teams[lose]].filter((x) => x.length);
  }

  // =================================================================
  //  PHYSIQUE : une voiture avance de 1/30 s (murs, autres voitures, ballon)
  // =================================================================
  function advanceCar(id, k) {
    const s = g.cars[id];
    const dt = P.TICK / P.SUB;
    const t = now();
    for (let sub = 0; sub < P.SUB; sub++) {
      P.drive(s.car, k, dt, env, 1);
      const hit = P.collideStatic(s.car, env);
      if (hit > 180) addFx(s.car.x, s.car.y, hit);
      for (const oid in g.cars) {
        if (oid === id) continue;
        const res = P.collideCars(s.car, g.cars[oid].car);
        if (res.impact > 120) addFx(res.x, res.y, res.impact);
      }
      if (g.phase === "play" && B.hitCar(g.ball, s.car)) g.lastTouch = id;
    }
    s.lastAdvance = t;
  }

  function stepBall() {
    const dt = P.TICK / P.SUB;
    for (let sub = 0; sub < P.SUB; sub++) {
      B.move(g.ball, dt);
      for (const [id, s] of Object.entries(g.cars)) if (B.hitCar(g.ball, s.car)) g.lastTouch = id;
      const side = B.goal(g.ball);
      if (side) return scoreGoal(side);
    }
  }

  function addFx(x, y, s) {
    const t = now();
    if (g.fx.some((f) => t - f.t < 150 && Math.hypot(f.x - x, f.y - y) < 40)) return;
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), s: Math.round(s) });
    if (g.fx.length > 30) g.fx.shift();
  }

  // =================================================================
  //  BOTS : derrière le ballon (côté de leur cage), puis on fonce dedans.
  // =================================================================
  function botKeys(id, s) {
    const c = s.car, ai = s.ai, b = g.ball;
    const speed = Math.hypot(c.vx, c.vy);
    ai.reverse = Math.max(0, (ai.reverse || 0) - P.TICK);
    if (ai.wantGo && speed < 30) ai.stuck = (ai.stuck || 0) + P.TICK; else ai.stuck = 0;
    if (ai.stuck > 0.8) { ai.reverse = 0.8; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? K.LEFT : K.RIGHT; }
    if (ai.reverse > 0) { ai.wantGo = false; return K.DOWN | ai.revSteer; }

    const tm = g.teamOf[id];
    // Gardien : il se place entre le ballon et sa cage, et ne sort que si le ballon approche.
    if (g.keeper?.[tm] === id) {
      const ownX = tm === "blue" ? B.GD : B.GD + B.FW, ownY = B.H / 2;
      if (Math.hypot(b.x - ownX, b.y - ownY) > 330) {
        const toBall = Math.atan2(b.y - ownY, b.x - ownX);
        const spot = {
          x: ownX + Math.cos(toBall) * 110,
          y: Math.max(B.goalTop - 30, Math.min(B.goalBot + 30, ownY + Math.sin(toBall) * 110)),
        };
        const d = Math.hypot(spot.x - c.x, spot.y - c.y);
        if (d < 30) { ai.wantGo = false; return speed > 40 ? K.DOWN : 0; }   // en place : on attend
        const want = Math.atan2(spot.y - c.y, spot.x - c.x);
        const diff = angDiff(want, c.a);
        let k = diff > 0.12 ? K.RIGHT : diff < -0.12 ? K.LEFT : 0;
        // Pas besoin de foncer : on ralentit en approchant.
        if (Math.abs(diff) < 1.9 || speed < 100) { if (d > 90 || speed < 120) k |= K.UP; ai.wantGo = true; }
        else { k |= K.DOWN; ai.wantGo = false; }
        return k;
      }
    }
    // La cage à attaquer.
    const gx = tm === "blue" ? B.W - B.GD / 2 : B.GD / 2, gy = B.H / 2;
    const toGoal = Math.atan2(gy - b.y, gx - b.x);
    // Point derrière le ballon, dans l'axe de la cage adverse.
    const behind = { x: b.x - Math.cos(toGoal) * 70, y: b.y - Math.sin(toGoal) * 70 };
    // Suis-je du bon côté du ballon ? (entre le ballon et ma cage)
    const myGoalX = tm === "blue" ? 0 : B.W;
    const goodSide = Math.abs(c.x - myGoalX) < Math.abs(b.x - myGoalX) + 20;
    ai.side = ai.side ?? (Math.random() < 0.5 ? 1 : -1);
    let target;
    if (!goodSide) {
      // On contourne le ballon par le côté pour revenir derrière.
      target = { x: b.x + (myGoalX - b.x > 0 ? 1 : -1) * 120, y: b.y + ai.side * 110 };
    } else if (Math.hypot(c.x - behind.x, c.y - behind.y) > 60 && Math.abs(angDiff(Math.atan2(b.y - c.y, b.x - c.x), toGoal)) > 0.6) {
      target = behind;
    } else {
      target = { x: b.x + b.vx * 0.15, y: b.y + b.vy * 0.15 };   // on frappe !
    }
    target.x = Math.max(40, Math.min(B.W - 40, target.x));
    target.y = Math.max(40, Math.min(B.H - 40, target.y));
    const want = Math.atan2(target.y - c.y, target.x - c.x);
    const diff = angDiff(want, c.a);
    let k = 0;
    if (diff > 0.12) k |= K.RIGHT; else if (diff < -0.12) k |= K.LEFT;
    if (Math.abs(diff) < 1.9 || speed < 120) { k |= K.UP; ai.wantGo = true; } else { k |= K.DOWN; ai.wantGo = false; }
    if (Math.abs(diff) > 1.1 && speed > 240 && Math.random() < 0.3) k |= K.HB;
    const dist = Math.hypot(target.x - c.x, target.y - c.y);
    if (Math.abs(diff) < 0.2 && dist > 250 && c.nitro > 0.4) k |= K.NITRO;
    return k;
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    const dt = t - g.lastTickAt;
    g.lastTickAt = t;
    if (g.phase === "kickoff") {
      if (t >= g.phaseEnd) g.phase = "play";
    } else if (g.phase === "play" || g.phase === "goal") {
      for (const [id, s] of Object.entries(g.cars)) {
        if (s.bot) advanceCar(id, g.phase === "play" ? botKeys(id, s) : 0);
        else if (t - s.lastInputAt > 200) advanceCar(id, 0);   // onglet en pause : roue libre
      }
      if (g.phase === "play") {
        stepBall();
        g.clock += dt;
        if (g.phase === "play") {
          if (!g.overtime && g.clock >= duration()) {
            if (g.score.blue === g.score.red && g.settings.golden) g.overtime = true;
            else return endMatch();
          } else if (g.overtime && g.clock >= duration() + OVERTIME_MAX) return endMatch();
        }
      } else if (t >= g.phaseEnd) {
        // Fin de la célébration : but en or = fin du match, sinon remise en jeu.
        if (g.overtime) return endMatch();
        if (g.clock >= duration() && g.score.blue !== g.score.red) return endMatch();
        kickoff();
      }
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![2, 3, 5].includes(s.duration)) s.duration = 3;
      s.golden = !!s.golden;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startMatch();
      ctx.update();
    },
    in(pid, { s, k }) {
      const st = g.cars[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (!["play", "goal"].includes(g.phase)) return;   // figé pendant la remise en jeu
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      advanceCar(pid, k & 63);
    },
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "over" || ctx.playlist) return;
      g.phase = "setup";
      ctx.update();
    },
    finish(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase)) return;
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
    onDisconnect() { ctx.update(); },
    canJoin: () => g.phase === "setup" || g.phase === "over",
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startMatch();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
