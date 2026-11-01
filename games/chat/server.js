// ===================================================================
//  CHAT ET SOURIS — Moteur du jeu (module du hub Le Bordel)
//  Un chat (une Sportive boostée) chasse les souris (des motos agiles).
//  Une souris touchée devient chat à son tour. Dernière souris = gagnante ;
//  à la fin du chrono, toutes les souris encore libres gagnent.
//  Le SERVEUR fait foi (30 calculs/s, même physique que le navigateur).
// ===================================================================

import "../../public/games/patate/physics.js";
import { generateMap } from "../patate/maps.js";

const P = globalThis.PatatePhysics;
const K = P.K;

export const meta = {
  id: "chat",
  name: "Chat et souris",
  emoji: "🐱",
  family: "Action",
  minPlayers: 3,
  maxPlayers: 6,
  description: "Le chat attrape une souris ? Elle devient chat. Tiens jusqu'au bout !",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;     // compte à rebours (tout le monde figé)
export const HEAD_START = 2000; // les souris partent 2 s avant le chat
const NEW_CAT_MS = 1500;       // une souris qui vient de devenir chat ne peut pas attraper tout de suite
export const CAT_BONUS = 1.1;  // moteur du chat (+10 %) et nitro boosté
const END_DELAY = 1500;        // on voit la dernière souris se transformer avant le tableau des scores
const ROUND_OVER_MS = 6000;    // écran de fin de manche (playlist : enchaîne tout seul)
const FINISH_DELAY = 15000;

export const ROLES = { cat: { type: "sport" }, mouse: { type: "moto" } };

// La map : 2 fois plus large et plus haute que celle de la Patate (caméra qui suit sa voiture).
export const W = P.W * 2, H = P.H * 2;
export const ASPHALT_CHANCE = 0.75;   // 75 % d'asphalte, sinon terre ou neige

function defaultSettings() {
  return { rounds: 5, duration: 90 };
}

export const playlist = {
  options: [
    {
      key: "rounds", label: "Manches", default: "3",
      choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: Number(c.rounds) === 5 ? 5 : 3 };
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    catCount: {},         // combien de fois chacun a commencé chat (pour tourner)
    round: 0,
    map: null,
    env: null,
    cars: {},             // id -> { car, role, bot, seq, lastInputAt, ai, catSince }
    caught: [],           // { id, by, at } dans l'ordre
    gains: {},            // points de la manche
    starters: [],         // les chats du début de manche
    playAt: 0,            // début de la chasse
    endAt: 0,             // fin de manche décidée : on laisse tourner jusqu'à ce moment
    timeUpAt: 0,          // fin du chrono
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
  const mice = () => Object.keys(g.cars).filter((id) => g.cars[id].role === "mouse");
  const cats = () => Object.keys(g.cars).filter((id) => g.cars[id].role === "cat");

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
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      map: g.map && {
        id: g.map.id, surface: g.map.surface, grip: g.map.grip, seed: g.map.seed,
        obstacles: g.map.obstacles, oils: g.map.oils, w: W, h: H,
      },
      cars: Object.entries(g.cars).map(([id, s]) => ({
        id, role: s.role, seq: s.seq, type: s.car.type, fresh: s.role === "cat" && t - s.catSince < NEW_CAT_MS,
        x: s.car.x, y: s.car.y, a: s.car.a, vx: s.car.vx, vy: s.car.vy, w: s.car.w,
        nitro: s.car.nitro, slide: s.car.slide, st: s.car.st, boost: s.car.boost,
      })),
      starters: g.starters,
      caught: g.caught,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      // Avant la chasse : temps avant que le chat parte. Pendant : temps restant.
      catWait: g.phase === "play" ? Math.max(0, g.playAt + HEAD_START - t) : HEAD_START,
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.settings.duration * 1000,
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
    g.catCount = {};
    g.round = 0;
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }

  function startRound() {
    const list = players().filter((p) => p.connected);
    g.round++;
    g.map = generateMap({ W, H, players: list.length, slippery: true, size: 4, asphaltChance: ASPHALT_CHANCE });
    g.env = { w: W, h: H, grip: g.map.grip, oils: g.map.oils, obstacles: g.map.obstacles, nitro: true, holderNitro: true };
    // Les chats : ceux qui l'ont été le moins souvent (au hasard entre eux). 2 chats à partir de 5 joueurs.
    const nCats = list.length >= 5 ? 2 : 1;
    const order = [...list].sort((a, b) => (g.catCount[a.id] || 0) - (g.catCount[b.id] || 0) + (Math.random() - 0.5) * 0.5);
    g.starters = order.slice(0, nCats).map((p) => p.id);
    for (const id of g.starters) g.catCount[id] = (g.catCount[id] || 0) + 1;
    g.cars = {};
    list.forEach((p, i) => {
      const sp = g.map.spawns[i];
      const role = g.starters.includes(p.id) ? "cat" : "mouse";
      g.cars[p.id] = { car: P.newCar(sp.x, sp.y, sp.a, ROLES[role].type), role, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, catSince: 0 };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.caught = [];
    g.gains = {};
    g.endAt = 0;
    g.fx = [];
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  // Une souris est attrapée : elle devient chat (même position, nouvelle voiture).
  function catchMouse(mouseId, catId) {
    const m = g.cars[mouseId];
    const t = now();
    g.caught.push({ id: mouseId, by: catId, at: t - g.playAt });
    g.gains[catId] = (g.gains[catId] || 0) + 1;                    // +1 par souris attrapée
    g.gains[mouseId] = (g.gains[mouseId] || 0) + g.caught.length - 1; // +1 par souris tombée avant toi
    const c = m.car;
    m.car = { ...P.newCar(c.x, c.y, c.a, ROLES.cat.type), vx: c.vx * 0.5, vy: c.vy * 0.5 };
    m.role = "cat";
    m.catSince = t;
    addFx(c.x, c.y, 400, true);
    if (mice().length === 0) g.endAt = t + END_DELAY;
  }

  function endRound() {
    stopLoop();
    const survivors = mice();
    // Les souris encore libres : +1 par souris attrapée, +2 de bonus.
    for (const id of survivors) g.gains[id] = (g.gains[id] || 0) + g.caught.length + 2;
    for (const [id, n] of Object.entries(g.gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = { survivors, caught: g.caught, gains: { ...g.gains }, starters: g.starters, timeUp: survivors.length > 0 };
    const last = g.round >= g.settings.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last && ctx.playlist) {
      g.finishTimer = setTimeout(() => { if (g.phase === "roundOver") startRound(); }, ROUND_OVER_MS);
      g.phaseEnd = now() + ROUND_OVER_MS;
    }
    ctx.update();
  }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  PHYSIQUE
  // =================================================================
  const bonusOf = (s) => (s.role === "cat" ? CAT_BONUS : 1);
  const catReady = (s, t) => s.role === "cat" && t - s.catSince >= NEW_CAT_MS && t >= g.playAt + HEAD_START;

  function advanceCar(id, k) {
    const s = g.cars[id];
    const dt = P.TICK / P.SUB;
    const t = now();
    // Le chat attend que les souris aient pris leur avance.
    if (s.role === "cat" && t < g.playAt + HEAD_START) k = 0;
    for (let sub = 0; sub < P.SUB; sub++) {
      P.drive(s.car, k, dt, g.env, bonusOf(s));
      const hit = P.collideStatic(s.car, g.env);
      if (hit > 180) addFx(s.car.x, s.car.y, hit);
      for (const oid in g.cars) {
        if (oid === id) continue;
        const o = g.cars[oid];
        const res = P.collideCars(s.car, o.car);
        if (res.impact > 120) addFx(res.x, res.y, res.impact);
        if (!res.touch || g.phase !== "play" || g.endAt) continue;
        if (s.role === "mouse" && catReady(o, t)) catchMouse(id, oid);
        else if (o.role === "mouse" && catReady(s, t)) catchMouse(oid, id);
      }
    }
  }

  function addFx(x, y, s, big = false) {
    const t = now();
    if (!big && g.fx.some((f) => t - f.t < 150 && Math.hypot(f.x - x, f.y - y) < 40)) return;
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), s: Math.round(s), big });
    if (g.fx.length > 30) g.fx.shift();
  }

  // =================================================================
  //  BOTS : le chat vise la souris la plus proche (un peu devant elle),
  //  la souris fuit vers un point loin des chats.
  // =================================================================
  function botKeys(id, s) {
    const c = s.car, ai = s.ai;
    const speed = Math.hypot(c.vx, c.vy);
    ai.think = (ai.think || 0) - P.TICK;
    ai.reverse = Math.max(0, (ai.reverse || 0) - P.TICK);
    if (ai.wantGo && speed < 30) ai.stuck = (ai.stuck || 0) + P.TICK; else ai.stuck = 0;
    if (ai.stuck > 0.8) { ai.reverse = 0.8; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? K.LEFT : K.RIGHT; }
    if (ai.reverse > 0) { ai.wantGo = false; return K.DOWN | ai.revSteer; }

    const hunters = cats().map((i) => g.cars[i].car);
    if (ai.think <= 0) {
      ai.think = 0.2 + Math.random() * 0.2;
      if (s.role === "cat") {
        let best = null, bestD = Infinity;
        for (const mid of mice()) {
          const o = g.cars[mid].car;
          const d = Math.hypot(o.x - c.x, o.y - c.y);
          if (d < bestD) { bestD = d; best = o; }
        }
        ai.target = best && { x: best.x + best.vx * Math.min(0.6, bestD / 600), y: best.y + best.vy * Math.min(0.6, bestD / 600) };
        ai.dist = bestD;
      } else {
        let near = Infinity;
        for (const h of hunters) near = Math.min(near, Math.hypot(h.x - c.x, h.y - c.y));
        ai.flee = (ai.flee || 0) - 0.3;
        if (!ai.target || ai.flee <= 0 || near < 170 || Math.hypot(ai.target.x - c.x, ai.target.y - c.y) < 60) {
          let best = null, bestScore = -Infinity;
          for (let i = 0; i < 14; i++) {
            const p = { x: rand(90, W - 90), y: rand(90, H - 90) };
            if (g.map.obstacles.some((o) => p.x > o.x - 40 && p.x < o.x + o.w + 40 && p.y > o.y - 40 && p.y < o.y + o.h + 40)) continue;
            let danger = Infinity;
            for (const h of hunters) danger = Math.min(danger, Math.hypot(p.x - h.x, p.y - h.y));
            // Loin des chats, pas trop loin de moi, et pas en passant à côté d'un chat.
            const score = danger - 0.4 * Math.hypot(p.x - c.x, p.y - c.y)
              - (hunters.some((h) => Math.abs(angDiff(Math.atan2(p.y - c.y, p.x - c.x), Math.atan2(h.y - c.y, h.x - c.x))) < 0.6) ? 250 : 0);
            if (score > bestScore) { bestScore = score; best = p; }
          }
          if (best) ai.target = best;
          ai.flee = 1.2;
        }
        ai.dist = near;
      }
    }
    if (!ai.target) { ai.wantGo = false; return 0; }
    const want = Math.atan2(ai.target.y - c.y, ai.target.x - c.x);
    const diff = angDiff(want, c.a);
    let k = 0;
    if (diff > 0.12) k |= K.RIGHT; else if (diff < -0.12) k |= K.LEFT;
    if (Math.abs(diff) < 1.9 || speed < 120) { k |= K.UP; ai.wantGo = true; } else { k |= K.DOWN; ai.wantGo = false; }
    if (Math.abs(diff) > 1.0 && speed > 230 && Math.random() < 0.4) k |= K.HB;
    if (s.role === "cat" && Math.abs(diff) < 0.3 && ai.dist > 160) k |= K.NITRO;
    if (s.role === "mouse" && ai.dist < 200 && Math.abs(diff) < 0.5) k |= K.NITRO;
    return k;
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
        g.timeUpAt = t + HEAD_START + g.settings.duration * 1000;
      }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.cars)) {
        if (s.bot) advanceCar(id, botKeys(id, s));
        else if (t - s.lastInputAt > 200) advanceCar(id, 0);   // onglet en pause : roue libre
        if (g.phase !== "play") return;
      }
      // Fin du chrono : les souris encore libres ont gagné (on regarde encore 1,5 s).
      if (!g.endAt && t >= g.timeUpAt) g.endAt = t + END_DELAY;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  // Quelqu'un part : sa voiture disparaît.
  function leave(id) {
    if (!g.cars[id] || !["countdown", "play"].includes(g.phase)) return;
    delete g.cars[id];
    if (g.phase === "play" && (mice().length === 0 || cats().length === 0)) endRound();
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5, 7].includes(s.rounds)) s.rounds = 5;
      if (![60, 90, 120].includes(s.duration)) s.duration = 90;
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
      if (g.phase !== "play") return;   // figé pendant le compte à rebours
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
      if (!ctx.isHost(pid) || !["setup", "over", "roundOver"].includes(g.phase)) return;
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
