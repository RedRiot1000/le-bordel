// ===================================================================
//  FOULE — Moteur du jeu (module du hub Le Bordel)
//  Une place la nuit, pleine de passants (des bots). À chaque manche, UN
//  joueur est le sniper : il voit la place d'en haut et tire avec son fusil.
//  Son laser est visible par tous. Les autres sont cachés parmi les passants
//  et doivent imiter leurs comportements (marcher, trottiner, discuter en
//  groupe, s'asseoir sur un banc, regarder autour…). Chacun son tour au fusil.
//  L'état public ne dit JAMAIS qui est un joueur : chacun reçoit en privé
//  (ctx.sendTo) quel personnage est le sien.
// ===================================================================

import "../../public/games/pieton/engine.js";

const H = globalThis.Pieton;
const K = H.K;

export const meta = {
  id: "foule",
  name: "Foule",
  emoji: "🕴️",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Un sniper, une foule. Fonds-toi parmi les passants… ou trouve les joueurs avec ton laser.",
};

const TICK_MS = 1000 / 30;
export const W = 1280, HGT = 800;
export const WALK = 0.42, JOG = 0.66;   // vitesses (× la normale) des joueurs : marche, et trottiner (Espace / Shift)
export const HIT_R = 20;                // le tir touche ce qui est sous le viseur
export const RELOAD = 1600;
export const ROUND_MS = 90000;
export const SURVIVE_EVERY = 15000;     // +1 point toutes les 15 s en vie
export const NEST = { x: W / 2, y: -60 }; // d'où part le laser (le toit, en haut)
const COUNTDOWN_MS = 4000, END_DELAY = 1800, ROUND_OVER_MS = 7000, FINISH_DELAY = 15000, BODY_MS = 9000;
export const COATS = ["#6b6f7a", "#8a6f5a", "#5f6f5f", "#7a5f6f", "#a39a88", "#4f5a6e"];
export const HATS = [null, "#1d1d22", "#3a2f28", "#5a5560"];

function defaultSettings() { return { laps: 1 }; }
export const playlist = {
  options: [{ key: "laps", label: "Tours", default: "1", choices: [{ v: "1", label: "Chacun sniper 1 fois" }, { v: "2", label: "Chacun sniper 2 fois" }] }],
  settingsFor(c) { return { laps: [1, 2].includes(Number(c.laps)) ? Number(c.laps) : 1 }; },
};

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// La place : une fontaine au milieu, des bancs, des kiosques, des arbres en bac, des lampadaires,
// et des endroits où les gens se retrouvent pour discuter.
export function buildPlaza() {
  const rects = [{ x: W / 2 - 70, y: HGT / 2 - 70, w: 140, h: 140, kind: "fontaine" }];
  for (let i = 0; i < 60 && rects.length < 15; i++) {
    const kind = pick(["banc", "banc", "banc", "kiosque", "arbre"]);
    const horiz = Math.random() < 0.5;
    const w = kind === "banc" ? (horiz ? 90 : 26) : kind === "kiosque" ? 70 : 34, h = kind === "banc" ? (horiz ? 26 : 90) : kind === "kiosque" ? 70 : 34;
    const o = { x: rand(70, W - 70 - w), y: rand(70, HGT - 70 - h), w, h, kind, horiz };
    if (rects.some((p) => o.x < p.x + p.w + 80 && o.x + o.w + 80 > p.x && o.y < p.y + p.h + 80 && o.y + o.h + 80 > p.y)) continue;
    rects.push(o);
  }
  const lamps = Array.from({ length: 7 }, () => ({ x: rand(80, W - 80), y: rand(80, HGT - 80) }));
  return { rects, lamps };
}

export function createGame(ctx) {
  const g = {
    phase: "setup",
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0, rounds: 0, turn: [],
    plaza: null, spots: [],
    ents: [], byPlayer: {}, bodies: [],
    sniper: null, aim: { x: W / 2, y: HGT / 2 }, ammo: 0, reloadAt: 0, kills: 0, prevFire: false,
    playAt: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };
  const hiders = () => g.ents.filter((x) => x.player && x.alive);

  // =================================================================
  //  ÉTAT PUBLIC (le même pour tout le monde : aucun indice sur qui est un joueur)
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, rounds: g.rounds,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      plaza: g.plaza, sniper: g.sniper,
      laser: { x: Math.round(g.aim.x), y: Math.round(g.aim.y) }, nest: NEST,
      ammo: g.ammo, reload: Math.max(0, g.reloadAt - t),
      ents: g.ents.filter((x) => x.alive).map((x) => ({
        e: x.e, x: Math.round(x.h.x * 10) / 10, y: Math.round(x.h.y * 10) / 10, vx: Math.round(x.h.vx), vy: Math.round(x.h.vy),
        face: Math.round(x.h.face * 100) / 100, walk: Math.round(x.h.walk * 100) / 100, coat: x.coat, hat: x.hat, sit: !!x.sit,
      })),
      bodies: g.bodies.map((b) => ({ x: b.x, y: b.y, coat: b.coat, hat: b.hat, face: b.face, player: b.player })),
      left: hiders().length,
      timeLeft: g.phase === "play" ? Math.max(0, ROUND_MS - (t - g.playAt)) : ROUND_MS,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 600).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }
  function sendPrivate() {
    for (const p of players()) {
      if (p.bot) continue;
      if (p.id === g.sniper) { ctx.sendTo(p.id, "me", { role: "sniper", round: g.round }); continue; }
      const x = g.byPlayer[p.id];
      if (!x) continue;
      ctx.sendTo(p.id, "me", { role: "hider", e: x.e, round: g.round, seq: x.seq, alive: x.alive, speed: x.speed, ...H.copy(x.h) });
    }
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {}; g.round = 0;
    const list = players().filter((p) => p.connected);
    for (const p of list) g.scores[p.id] = 0;
    g.turn = shuffle(list.map((p) => p.id));
    g.rounds = g.turn.length * g.settings.laps;
    startRound();
  }
  function freeSpot() {
    for (let i = 0; i < 200; i++) {
      const p = { x: rand(50, W - 50), y: rand(60, HGT - 50) };
      if (g.plaza.rects.some((o) => p.x > o.x - 30 && p.x < o.x + o.w + 30 && p.y > o.y - 30 && p.y < o.y + o.h + 30)) continue;
      if (g.ents.some((x) => dist(x.h, p) < 40)) continue;
      return p;
    }
    return { x: 60, y: 80 };
  }
  function startRound() {
    const list = players().filter((p) => p.connected);
    for (const p of list) if (!g.turn.includes(p.id)) g.turn.push(p.id);
    const order = g.turn.filter((id) => list.some((p) => p.id === id));
    g.sniper = order[g.round % order.length];
    g.round++;
    g.plaza = buildPlaza();
    g.spots = Array.from({ length: 4 }, () => freeSpot());
    g.ents = []; g.byPlayer = {}; g.bodies = [];
    const hidersList = list.filter((p) => p.id !== g.sniper);
    const npcs = 26 + hidersList.length * 3;
    const ids = shuffle(Array.from({ length: npcs + hidersList.length }, (_, i) => i + 1));
    let k = 0;
    const make = (player, bot) => {
      const p = freeSpot();
      const x = { e: ids[k++], h: H.newHero(p.x, p.y, rand(0, Math.PI * 2)), coat: pick(COATS), hat: pick(HATS), player, bot, alive: true, prevK: 0, seq: 0, lastInputAt: 0, aliveMs: 0,
        speed: player ? WALK : rand(0.34, 0.46), ai: { mode: "pause", until: 0 }, aim: null, sit: false };
      g.ents.push(x);
      return x;
    };
    for (let i = 0; i < npcs; i++) make(null, true);
    for (const p of hidersList) { g.byPlayer[p.id] = make(p.id, !!p.bot); g.scores[p.id] = g.scores[p.id] || 0; }
    g.ents = shuffle(g.ents);
    g.aim = { x: W / 2, y: HGT / 2 }; g.ammo = hidersList.length + 3; g.reloadAt = 0; g.kills = 0; g.prevFire = false;
    g.sniperAi = {};
    g.endAt = 0; g.lastRound = null; g.feed = []; g.fx = [];
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }
  function endRound() {
    stopLoop();
    const gains = {}, left = hiders();
    for (const p of players()) {
      if (p.id === g.sniper) { gains[p.id] = g.kills * 3 + (left.length === 0 && g.kills > 0 ? 2 : 0); continue; }
      const x = g.byPlayer[p.id];
      if (!x) continue;
      gains[p.id] = Math.floor(x.aliveMs / SURVIVE_EVERY) + (x.alive ? 3 : 0);
    }
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    const order = Object.keys(gains).sort((a, b) => gains[b] - gains[a]);
    g.lastRound = { gains, order, sniper: g.sniper, kills: g.kills, alive: Object.fromEntries(Object.entries(g.byPlayer).map(([id, x]) => [id, x.alive])) };
    const last = g.round >= g.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last) {          // (la manche suivante se lance toute seule)
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
  //  BOUGER (passants et joueurs cachés : exactement les mêmes règles)
  // =================================================================
  // k : touches ; aim : où il regarde quand il est arrêté ; jog : il trottine.
  function move(x, k, aim, jog) {
    const env = { walls: true, w: W, h: HGT, noDash: true, speedMul: jog ? JOG : x.speed, rects: g.plaza.rects }, dt = H.TICK / H.SUB;
    const bits = k & (K.UP | K.DOWN | K.LEFT | K.RIGHT);
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(x.h, bits, bits ? null : aim, dt, env);
      H.collideWalls(x.h, env);
      for (const o of g.ents) if (o !== x && o.alive) H.collideHeroes(x.h, o.h);
    }
    x.sit = !bits && !!x.ai.sitting;
  }

  // Les passants : ils choisissent une activité, la font, puis en changent.
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const keyTo = (h, p) => (dist(h, p) < 12 ? 0 : KEYS[Math.round(((Math.atan2(p.y - h.y, p.x - h.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]);
  const blocked = (x, y) => x < 30 || y < 30 || x > W - 30 || y > HGT - 30 || g.plaza.rects.some((o) => x > o.x - 22 && x < o.x + o.w + 22 && y > o.y - 22 && y < o.y + o.h + 22);
  function steer(h, goal, ai) {
    let k = keyTo(h, goal);
    if (!k) return 0;
    const i = KEYS.indexOf(k), ang = (i * Math.PI) / 4;
    if (blocked(h.x + Math.cos(ang) * 34, h.y + Math.sin(ang) * 34)) { ai.side = ai.side || (Math.random() < 0.5 ? 1 : -1); k = KEYS[(i + ai.side * 2 + 8) % 8]; }
    return k;
  }
  function npcBrain(x, t) {
    const ai = x.ai, h = x.h;
    if (t >= ai.until || (ai.goal && t > ai.giveUp)) {
      // Une nouvelle activité.
      const u = Math.random();
      ai.sitting = false; ai.jog = false; ai.look = null;
      if (u < 0.36) { ai.mode = "marche"; ai.goal = freeSpot(); ai.until = t + 15000; }
      else if (u < 0.46) { ai.mode = "trotte"; ai.goal = freeSpot(); ai.jog = true; ai.until = t + 8000; }
      else if (u < 0.66) { ai.mode = "groupe"; const s = pick(g.spots), a = rand(0, Math.PI * 2); ai.goal = { x: s.x + Math.cos(a) * 34, y: s.y + Math.sin(a) * 34 }; ai.center = s; ai.stay = rand(4000, 10000); ai.until = t + 22000; }
      else if (u < 0.8) {
        const benches = g.plaza.rects.filter((r) => r.kind === "banc");
        if (benches.length) { const b = pick(benches), side = Math.random() < 0.5 ? -1 : 1; ai.mode = "banc"; ai.goal = b.horiz ? { x: b.x + rand(15, b.w - 15), y: side < 0 ? b.y - 22 : b.y + b.h + 22 } : { x: side < 0 ? b.x - 22 : b.x + b.w + 22, y: b.y + rand(15, b.h - 15) }; ai.center = { x: b.x + b.w / 2, y: b.y + b.h / 2 }; ai.stay = rand(5000, 13000); ai.until = t + 22000; }
        else { ai.mode = "pause"; ai.goal = null; ai.until = t + rand(1000, 3500); }
      } else { ai.mode = "pause"; ai.goal = null; ai.until = t + rand(800, 3500); }
      ai.giveUp = t + 14000; ai.arrived = 0;
    }
    if (ai.goal && dist(h, ai.goal) > 14) return { k: steer(h, ai.goal, ai), aim: null, jog: ai.jog };
    // Arrivé (ou à l'arrêt) : selon l'activité, il discute, s'assoit, ou regarde autour.
    if (ai.goal && !ai.arrived) { ai.arrived = t; if (ai.stay) ai.until = t + ai.stay; if (ai.mode === "banc") ai.sitting = true; if (!ai.stay) ai.until = t + rand(300, 2000); ai.goal = null; }
    if (ai.mode === "groupe" && ai.center) return { k: 0, aim: Math.atan2(ai.center.y - h.y, ai.center.x - h.x) + Math.sin(t / 900 + x.e) * 0.3, jog: false };
    if (ai.mode === "banc" && ai.center) return { k: 0, aim: Math.atan2(h.y - ai.center.y, h.x - ai.center.x), jog: false };
    if (!ai.look || t > ai.lookAt) { ai.look = rand(0, Math.PI * 2); ai.lookAt = t + rand(700, 2200); }
    return { k: 0, aim: ai.look, jog: false };
  }

  g.__brain = npcBrain;      // (pour les tests)

  // =================================================================
  //  LE SNIPER
  // =================================================================
  function shoot(t) {
    if (g.ammo <= 0 || t < g.reloadAt) return;
    g.ammo--; g.reloadAt = t + RELOAD;
    let best = null, bd = HIT_R;
    for (const o of g.ents) { if (!o.alive) continue; const d = dist(o.h, g.aim); if (d < bd) { bd = d; best = o; } }
    addFx({ kind: "tir", x: Math.round(g.aim.x), y: Math.round(g.aim.y), hit: !!best });
    if (best) {
      best.alive = false;
      g.bodies.push({ x: Math.round(best.h.x), y: Math.round(best.h.y), coat: best.coat, hat: best.hat, face: best.h.face, until: t + BODY_MS, player: !!best.player });
      if (best.player) { g.kills++; say(`🎯 ${pseudo(g.sniper)} a eu ${pseudo(best.player)} !`); }
      else say("😱 Un passant innocent… une balle de perdue");
    }
    if ((hiders().length === 0 || g.ammo === 0) && !g.endAt) g.endAt = t + END_DELAY;
  }
  // Le sniper bot : il observe, choisit un suspect, amène son laser dessus doucement, et tire.
  function sniperBot(t) {
    const ai = g.sniperAi;
    if (!ai.target || !ai.target.alive || t > ai.until) {
      const all = g.ents.filter((o) => o.alive), real = all.filter((o) => o.player);
      ai.target = real.length && Math.random() < 0.3 ? pick(real) : pick(all);
      ai.until = t + rand(2500, 5000); ai.fireAt = t + rand(1500, 3200);
    }
    const tg = ai.target.h;
    g.aim.x += (tg.x - g.aim.x) * 0.12; g.aim.y += (tg.y - g.aim.y) * 0.12;
    if (t >= ai.fireAt && dist(g.aim, tg) < 10) { shoot(t); ai.target = null; }
  }

  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000);
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
      for (const x of g.ents) if (!x.player || x.bot) { const b = npcBrain(x, t); move(x, b.k, b.aim, b.jog); }
    } else if (g.phase === "play") {
      for (const x of g.ents) {
        if (!x.alive) continue;
        if (!x.player || x.bot) { const b = npcBrain(x, t); move(x, b.k, b.aim, b.jog); }
        else if (t - x.lastInputAt > 200) move(x, 0, x.aim, false);
        if (x.player) x.aliveMs += dt * 1000;
      }
      if (players().find((p) => p.id === g.sniper)?.bot) sniperBot(t);
      g.bodies = g.bodies.filter((b) => t < b.until);
      if (!g.endAt && t - g.playAt >= ROUND_MS) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    sendPrivate();
    ctx.update();
  }
  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }
  function leave(id) {
    if (!["countdown", "play"].includes(g.phase)) return;
    if (id === g.sniper && !g.endAt) { g.endAt = now(); return; }
    const x = g.byPlayer[id];
    if (x?.alive) { x.bot = true; }    // un joueur caché qui part : il devient un passant comme les autres
  }

  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![1, 2].includes(s.laps)) s.laps = 1;
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
    // Caché : { s, k, a } (a = où il regarde quand il est arrêté). Sniper : { k, p: { x, y } } (le viseur).
    in(pid, { s, k, a, p }) {
      const t = now();
      if (pid === g.sniper) {
        if (p && isFinite(p.x) && isFinite(p.y)) { g.aim.x = Math.max(0, Math.min(W, p.x)); g.aim.y = Math.max(0, Math.min(HGT, p.y)); }
        const fire = !!(k & K.FIRE);
        if (g.phase === "play" && fire && !g.prevFire) shoot(t);
        g.prevFire = fire;
        return;
      }
      const x = g.byPlayer[pid];
      if (!x || x.bot || typeof s !== "number" || s <= x.seq) return;
      x.seq = s;
      x.lastInputAt = t;
      if (typeof a === "number" && isFinite(a)) x.aim = a;
      if (g.phase !== "play" || !x.alive) return;
      x.budget = Math.min(6, (x.budget ?? 6) + (t - (x.budgetAt || t)) * 0.036);
      x.budgetAt = t;
      if (x.budget < 1) return;
      x.budget -= 1;
      move(x, k & 63, x.aim, !!(k & K.DASH));
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
    onReconnect() { sendPrivate(); ctx.update(); },
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
