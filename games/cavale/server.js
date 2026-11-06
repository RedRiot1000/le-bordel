// ===================================================================
//  CAVALE — Moteur du jeu (module du hub Le Bordel)
//  Flics contre runners, à pied, dans un quartier tiré au hasard.
//  Un gardien pose la prison où il veut au début de la manche.
//  Le flic tire au taser (le runner est sonné) puis le touche : en prison.
//  La prison est un simple cercle : un prisonnier ne peut pas en sortir,
//  les autres y entrent comme ils veulent. Un runner libre touche un prisonnier : il est libre.
//  Les flics gagnent si tous les runners sont en prison, les runners s'ils
//  tiennent jusqu'à la fin du chrono. Les rôles tournent à chaque manche.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/cavale/quartier.js";

const H = globalThis.Pieton;
const Q = globalThis.Quartier;
const K = H.K;

export const meta = {
  id: "cavale",
  name: "Cavale",
  emoji: "🚨",
  family: "Action",
  minPlayers: 3,
  maxPlayers: 8,
  description: "Flics contre runners : mets-les en prison, ou touche tes potes pour les libérer !",
};

const TICK_MS = 1000 / 30;
export const ROUND_MS = 120000;        // une manche : 2 min
export const HEAD_START = 5000;        // les runners partent 5 s avant les flics
export const PLACE_MS = 10000;         // le gardien a 10 s pour poser la prison (sinon elle se pose toute seule)
export const RANGE = 340;              // portée du taser
export const TASER_CD = 5000;          // recharge du taser
export const RECOIL_MS = 400;          // le flic ne bouge plus juste après un tir (un tir de loin ne suffit pas)
export const RAPID_CD = 1500;          // recharge avec le gadget
export const STUN_MS = 1500;           // runner sonné
export const CUFF_R = 42;              // distance pour menotter
export const SAFE_MS = 1500;           // protégé juste après une évasion
export const FREE_R = 40;               // distance pour libérer un prisonnier (on se touche)
export const SPEED = 1.8;              // tout le monde court bien plus vite que dans les autres jeux
export const SPRINT = 1.4, SPRINT_MS = 3000;
export const CAMP_R = 340, CAMP_S = 8, CAMP_SLOW = 0.65;   // un flic qui reste près de la prison ralentit
export const AIM = 64;                 // touche « viser » (clic droit, pour lancer un fumigène)
export const THROW_MAX = 320;          // portée d'un lancer
const FLY_MS = 350;                    // temps de vol
const SMOKE_MS = 5000, SMOKE_R = 120;
const BANANA_MS = 30000, SLIP_MS = 1000;
const BAR_MS = 8000, BAR_LEN = 128, BAR_W = 26;
const RAPID_MS = 10000;
const BOXES = 9, BOX_BACK = 20000;
const COUNTDOWN_MS = 3000, END_DELAY = 1800, ROUND_OVER_MS = 7000, FINISH_DELAY = 15000;
export const GADGETS = { runner: ["sprint", "fumi", "banane"], cop: ["sprint", "barrage", "rapide"] };
export const copCount = (n) => (n <= 4 ? 1 : n <= 6 ? 2 : 3);

function defaultSettings() { return { rounds: 4 }; }

export const playlist = {
  options: [{ key: "rounds", label: "Manches", default: "4", choices: [{ v: "3", label: "3" }, { v: "4", label: "4" }, { v: "6", label: "6" }] }],
  settingsFor(c) { return { ...defaultSettings(), rounds: [3, 4, 6].includes(Number(c.rounds)) ? Number(c.rounds) : 4 }; },
};

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Le segment traverse-t-il ce rectangle ?
function segHitsRect(x0, y0, x1, y1, r) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0, turn: [],
    seed: 0, map: null, warden: null, prison: null,
    heroes: {},           // id -> { h, role, jailed, stunUntil, safeUntil, taserAt, rapidUntil, sprintUntil, gadget, camp, gains… }
    boxes: [], bananas: [], smokes: [], bars: [], itemId: 0,
    playAt: 0, endAt: 0, phaseEnd: 0, win: null,
    lastRound: null, loop: null, lastTickAt: 0,
    fx: [], fxId: 0, feed: [],
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const all = (role) => Object.entries(g.heroes).filter(([, s]) => s.role === role);
  const freeRunners = () => all("runner").filter(([, s]) => !s.jailed);
  const jailedCount = () => all("runner").filter(([, s]) => s.jailed).length;
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };

  // Les bonshommes ne peuvent pas bouger pendant ces moments-là.
  const locked = (s, t) => t < s.stunUntil || (s.role === "cop" && (t < s.recoilUntil || (!s.warden && t < g.playAt + HEAD_START)));
  // Le taser ne marche qu'une fois la prison posée et les 5 s passées.
  const huntOn = (t) => !!g.prison && t >= g.playAt + HEAD_START;
  const speedOf = (s, t) => SPEED * (t < s.sprintUntil ? SPRINT : 1) * (s.role === "cop" && s.camp >= CAMP_S ? CAMP_SLOW : 1);
  const envOf = (s, t) => ({ walls: true, w: Q.W, h: Q.H, noDash: true, speedMul: speedOf(s, t), rects: [...Q.near(g.map, s.h.x, s.h.y), ...g.bars], circle: s.jailed ? { x: g.map.prison.cx, y: g.map.prison.cy, r: Q.JAIL_R } : null });

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s)
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, seed: g.seed, prison: g.prison, warden: g.warden,
      placeLeft: g.phase === "play" && !g.prison ? Math.max(0, g.playAt + PLACE_MS - t) : 0,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, role: s.role, jailed: s.jailed, stun: Math.max(0, s.stunUntil - t), safe: t < s.safeUntil,
        lock: locked(s, t), spd: speedOf(s, t), gadget: s.gadget, camp: Math.round(s.camp * 10) / 10,
        taser: Math.max(0, s.taserAt - t), taserCd: t < s.rapidUntil ? RAPID_CD : TASER_CD, sprint: t < s.sprintUntil,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, dash: 0, dashT: 0, pushT: 0, heavy: 0, stunH: 0,
      })),
      boxes: g.boxes.filter((b) => t >= b.backAt).map((b) => ({ id: b.id, x: b.x, y: b.y })),
      bananas: g.bananas.map((b) => ({ id: b.id, x: b.x, y: b.y })),
      smokes: g.smokes.map((b) => ({ id: b.id, x: b.x, y: b.y, fx: b.fx, fy: b.fy, fly: Math.max(0, b.landAt - t) })),
      bars: g.bars.map((b) => ({ id: b.id, x: b.x, y: b.y, w: b.w, h: b.h })),
      timeLeft: g.phase === "play" ? Math.max(0, ROUND_MS - (t - g.playAt)) : ROUND_MS,
      copWait: g.phase === "play" ? Math.max(0, g.playAt + HEAD_START - t) : HEAD_START,
      hunting: huntOn(t),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 400).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {}; g.round = 0;
    const list = players().filter((p) => p.connected);
    for (const p of list) g.scores[p.id] = 0;
    g.turn = shuffle(list.map((p) => p.id));
    startRound();
  }

  function startRound() {
    const list = players().filter((p) => p.connected);
    for (const p of list) if (!g.turn.includes(p.id)) g.turn.push(p.id);
    const order = g.turn.filter((id) => list.some((p) => p.id === id));
    const n = order.length, nc = copCount(n);
    // Les rôles tournent : à chaque manche, les suivants dans la liste sont flics.
    const cops = new Set(Array.from({ length: nc }, (_, i) => order[(g.round * nc + i) % n]));
    g.round++;
    g.seed = (Math.random() * 2 ** 31) >>> 0;
    g.map = Q.build(g.seed);
    g.heroes = {};
    g.prison = null;
    g.warden = order[(((g.round - 1) * nc) % n)];       // le premier flic de la manche pose la prison
    const spots = [...g.map.runSpots], copSpots = g.map.copSpots;
    // Des runners bien éparpillés.
    const taken = [];
    let ci = 0;
    for (const p of list) {
      const role = cops.has(p.id) ? "cop" : "runner";
      let sp;
      if (role === "cop") sp = copSpots[ci++ % copSpots.length];
      else { sp = spots.find((o) => taken.every((q) => dist(o, q) > 420)) || spots[0]; taken.push(sp); }
      g.heroes[p.id] = {
        h: H.newHero(sp.x, sp.y, 0), role, warden: p.id === g.warden, jailed: false, stunUntil: 0, recoilUntil: 0, safeUntil: 0, taserAt: 0, rapidUntil: 0, sprintUntil: 0,
        gadget: null, camp: 0, bot: !!p.bot, seq: 0, lastInputAt: 0, prevK: 0, aim: null, ai: { brave: Math.random() < 0.7 }, arrests: 0, frees: 0, gain: 0,
      };
      g.scores[p.id] = g.scores[p.id] || 0;
    }
    g.boxes = shuffle(g.map.boxSpots).slice(0, BOXES).map((b, i) => ({ id: i + 1, x: b.x, y: b.y, backAt: 0 }));
    g.bananas = []; g.smokes = []; g.bars = []; g.itemId = 100;
    g.endAt = 0; g.win = null; g.feed = []; g.fx = []; g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }

  function finishRound(win) {
    if (g.win) return;
    g.win = win;
    g.endAt = now() + END_DELAY;
    say(win === "cops" ? "🚓 Tous les runners sont en prison !" : "🏃 Les runners ont tenu jusqu'au bout !");
  }

  function endRound() {
    stopLoop();
    const gains = {};
    for (const [id, s] of Object.entries(g.heroes)) {
      let n = s.arrests * 2 + s.frees * 2;
      if (s.role === "runner" && !s.jailed) n += 3;
      if ((g.win === "cops") === (s.role === "cop")) n += 2;
      gains[id] = n;
      g.scores[id] = (g.scores[id] || 0) + n;
    }
    const ids = Object.keys(g.heroes).sort((a, b) => gains[b] - gains[a]);
    g.lastRound = {
      win: g.win, gains, order: ids,
      role: Object.fromEntries(ids.map((id) => [id, g.heroes[id].role])),
      arrests: Object.fromEntries(ids.map((id) => [id, g.heroes[id].arrests])),
      frees: Object.fromEntries(ids.map((id) => [id, g.heroes[id].frees])),
      jailed: Object.fromEntries(ids.map((id) => [id, g.heroes[id].jailed])),
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
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  UN JOUEUR AGIT
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s) return;
    const t = now();
    const move = locked(s, t) ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT);
    const env = envOf(s, t), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, move, aim, dt, env);
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id) H.collideHeroes(s.h, o.h);
    }
    if (g.phase === "play" && !g.prison && s.warden && k & (K.FIRE | K.DASH) && !(s.prevK & (K.FIRE | K.DASH))) { placePrison(id, s); s.prevK = k; return; }
    if (g.phase === "play" && !locked(s, t) && !s.jailed) {
      if (s.role === "cop" && huntOn(t) && k & K.FIRE && !(s.prevK & K.FIRE)) shoot(id, s, aim ?? s.h.face, t);
      // Le fumigène : clic gauche. Si on vise (clic droit maintenu), il part là où on vise ; sinon il tombe à nos pieds.
      if (s.gadget === "fumi" && k & K.FIRE && !(s.prevK & K.FIRE)) useGadget(id, s, t, k & AIM ? { a: aim ?? s.h.face, d: s.aimD ?? THROW_MAX } : null);
      else if (k & K.DASH && !(s.prevK & K.DASH)) useGadget(id, s, t);
    }
    s.prevK = k;
  }

  // Le gardien pose la prison à ses pieds : une place est dégagée, ceux qui s'y trouvent sont mis dehors.
  function placePrison(id, s) {
    const { c, r } = Q.prisonSpot(s.h.x, s.h.y);
    Q.prisonAt(g.map, c, r);
    g.prison = { c, r };
    const P = g.map.prison;
    // Les caisses recouvertes disparaissent.
    g.boxes = g.boxes.filter((b) => dist(b, { x: P.cx, y: P.cy }) > Q.JAIL_R + 50);
    addFx({ kind: "place", x: Math.round(P.cx), y: Math.round(P.cy) });
    say(`🔒 ${pseudo(id)} a posé la prison !`);
  }

  // Le tir : en ligne droite jusqu'au premier mur, barrage ou fumigène. Il touche le premier runner sur la ligne.
  function shoot(id, s, a, t) {
    if (t < s.taserAt) return;
    s.taserAt = t + (t < s.rapidUntil ? RAPID_CD : TASER_CD);
    s.recoilUntil = t + RECOIL_MS;
    const { x, y } = s.h, dx = Math.cos(a), dy = Math.sin(a);
    let reach = Q.ray(g.map, x, y, a, RANGE);
    for (const b of g.bars) if (segHitsRect(x, y, x + dx * reach, y + dy * reach, b)) { for (let d = 8; d < reach; d += 8) if (x + dx * d > b.x && x + dx * d < b.x + b.w && y + dy * d > b.y && y + dy * d < b.y + b.h) { reach = d; break; } }
    for (const m of g.smokes) { if (t < m.landAt) continue; const along = (m.x - x) * dx + (m.y - y) * dy, off = Math.abs((m.x - x) * dy - (m.y - y) * dx); if (along > 0 && off < SMOKE_R) reach = Math.min(reach, Math.max(10, along - Math.sqrt(SMOKE_R * SMOKE_R - off * off))); }
    let hit = null, best = reach;
    for (const [oid, o] of freeRunners()) {
      if (t < o.safeUntil) continue;
      const along = (o.h.x - x) * dx + (o.h.y - y) * dy, off = Math.abs((o.h.x - x) * dy - (o.h.y - y) * dx);
      if (along > 0 && along < best && off < H.R + 8) { best = along; hit = oid; }
    }
    addFx({ kind: "zap", x: Math.round(x), y: Math.round(y), x2: Math.round(x + dx * best), y2: Math.round(y + dy * best), hit: !!hit });
    if (!hit) return;
    const o = g.heroes[hit];
    o.stunUntil = t + STUN_MS;
    o.h.vx = 0; o.h.vy = 0;
    say(`⚡ ${pseudo(id)} a tasé ${pseudo(hit)} !`);
  }

  function useGadget(id, s, t, target = null) {
    const gd = s.gadget;
    if (!gd) return;
    s.gadget = null;
    const { x, y, face } = s.h;
    if (gd === "sprint") s.sprintUntil = t + SPRINT_MS;
    else if (gd === "fumi") {
      // Il s'arrête au premier mur sur son chemin.
      const d = target ? Q.ray(g.map, x, y, target.a, Math.min(THROW_MAX, target.d)) : 0;
      const tx = x + Math.cos(target?.a ?? 0) * d, ty = y + Math.sin(target?.a ?? 0) * d;
      g.smokes.push({ id: ++g.itemId, x: Math.round(tx), y: Math.round(ty), fx: Math.round(x), fy: Math.round(y), landAt: t + (target ? FLY_MS : 0), until: t + SMOKE_MS + (target ? FLY_MS : 0) });
    }
    else if (gd === "banane") g.bananas.push({ id: ++g.itemId, x: Math.round(x), y: Math.round(y), until: t + BANANA_MS });
    else if (gd === "rapide") { s.rapidUntil = t + RAPID_MS; s.taserAt = Math.min(s.taserAt, t); }
    else if (gd === "barrage") {
      const horiz = Math.abs(Math.cos(face)) < Math.abs(Math.sin(face));   // perpendiculaire à là où il regarde
      const bx = x + Math.cos(face) * 70, by = y + Math.sin(face) * 70;
      const w = horiz ? BAR_LEN : BAR_W, h = horiz ? BAR_W : BAR_LEN;
      g.bars.push({ id: ++g.itemId, x: Math.round(bx - w / 2), y: Math.round(by - h / 2), w, h, until: t + BAR_MS });
    }
    addFx({ kind: "use", x: Math.round(x), y: Math.round(y), g: gd });
  }

  function arrest(copId, cop, runId, r) {
    r.jailed = true;
    r.stunUntil = 0;
    const sp = g.map.jailSpots[all("runner").filter(([, s]) => s.jailed).length % g.map.jailSpots.length];   // (sa place dans la cellule)
    addFx({ kind: "cuff", x: Math.round(r.h.x), y: Math.round(r.h.y) });
    r.h.x = sp.x; r.h.y = sp.y; r.h.vx = 0; r.h.vy = 0;
    r.gadget = null; r.sprintUntil = 0;
    cop.arrests++;
    say(`🚔 ${pseudo(copId)} a arrêté ${pseudo(runId)} !`);
    if (!freeRunners().length) finishRound("cops");
  }

  // Un runner libre touche un prisonnier : il est libre, et protégé un court instant.
  function freeOne(id, s, rid, r, t) {
    r.jailed = false;
    r.safeUntil = t + SAFE_MS;
    s.frees++;
    addFx({ kind: "free", x: Math.round(r.h.x), y: Math.round(r.h.y) });
    say(`🔓 ${pseudo(id)} a libéré ${pseudo(rid)} !`);
  }

  // Ce qui se passe tout seul à chaque calcul.
  function world(dt, t) {
    // Le gardien a trop attendu : la prison se pose là où il est.
    if (!g.prison) {
      if (t >= g.playAt + PLACE_MS) { const w = g.heroes[g.warden]; if (w) placePrison(g.warden, w); }
      if (!g.prison) return;
    }
    g.smokes = g.smokes.filter((m) => t < m.until);
    g.bananas = g.bananas.filter((m) => t < m.until);
    g.bars = g.bars.filter((m) => t < m.until);
    const P = g.map.prison;
    for (const [id, s] of Object.entries(g.heroes)) {
      if (s.jailed) continue;
      // Ramasser un gadget en passant dessus.
      if (!s.gadget) for (const b of g.boxes) {
        if (t >= b.backAt && dist(b, s.h) < 34) { s.gadget = pick(GADGETS[s.role]); b.backAt = t + BOX_BACK; break; }
      }
      if (s.role === "cop") {
        // Camper la prison fatigue.
        const near = dist({ x: P.cx, y: P.cy }, s.h) < CAMP_R;
        s.camp = near ? Math.min(CAMP_S + 1, s.camp + dt) : Math.max(0, s.camp - dt * 2);
        // Glisser sur une peau de banane.
        for (const b of g.bananas) if (dist(b, s.h) < 26) { s.stunUntil = t + SLIP_MS; g.bananas = g.bananas.filter((o) => o !== b); say(`🍌 ${pseudo(id)} a glissé !`); break; }
        // Menotter un runner sonné.
        if (!locked(s, t)) for (const [rid, r] of freeRunners()) if (t < r.stunUntil && dist(r.h, s.h) < CUFF_R) arrest(id, s, rid, r);
      }
    }
    // Toucher un prisonnier le libère.
    const prisoners = all("runner").filter(([, s]) => s.jailed);
    for (const [id, s] of freeRunners()) {
      if (t < s.stunUntil) continue;
      for (const [rid, r] of prisoners) if (r.jailed && dist(r.h, s.h) < FREE_R) freeOne(id, s, rid, r, t);
    }
  }

  g.__world = world;      // (pour les tests)

  // =================================================================
  //  BOTS
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const keyTo = (h, p) => (dist(h, p) < 8 ? 0 : KEYS[Math.round(((Math.atan2(p.y - h.y, p.x - h.x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]);
  function go(s, goal, t) {
    const h = s.h, ai = s.ai;
    // Coincé ? Il part un instant dans une direction au hasard.
    if (t >= (ai.checkAt || 0)) { if (ai.px !== undefined && Math.hypot(h.x - ai.px, h.y - ai.py) < 18) ai.jitUntil = t + 350; ai.px = h.x; ai.py = h.y; ai.checkAt = t + 700; if (t < (ai.jitUntil || 0)) ai.jit = pick(KEYS); }
    if (t < (ai.jitUntil || 0)) return ai.jit;
    if (dist(h, goal) < 90 && Q.sees(g.map, h, goal)) return keyTo(h, goal);
    const p = Q.next(g.map, Q.flow(g.map, goal.x, goal.y), h.x, h.y);
    return p ? keyTo(h, p) : 0;
  }
  const nearBox = (s, t, r) => { let best = null, bd = r; for (const b of g.boxes) { if (t < b.backAt) continue; const d = dist(b, s.h); if (d < bd) { bd = d; best = b; } } return best; };

  function copBot(s, t) {
    if (locked(s, t)) return { k: 0, aim: null };
    const h = s.h, ai = s.ai;
    // Le gardien bot court un peu, puis pose la prison.
    if (!g.prison) {
      if (!s.warden) return { k: 0, aim: null };
      if (!ai.placeAt) { ai.placeAt = t + 1800 + Math.random() * 3000; ai.goal = pick(g.map.boxSpots); }
      if (t >= ai.placeAt) return { k: K.DASH, aim: null };
      return { k: go(s, ai.goal, t), aim: null };
    }
    if (!huntOn(t)) return { k: 0, aim: null };
    // Il ne poursuit que ceux qu'il voit (ou qu'il vient de voir) : on peut lui échapper.
    const free = freeRunners().map(([, o]) => o).filter((o) => t >= o.safeUntil && dist(o.h, h) < 520 && Q.sees(g.map, h, o.h));
    if (free.length) { ai.lastSeen = { x: free[0].h.x, y: free[0].h.y }; ai.lastAt = t; }
    if (!free.length) {
      // Personne en vue : il va voir là où il l'a perdu, surveille un bouton, ou fait sa ronde.
      if (ai.lastSeen && t - ai.lastAt < 2500) return { k: go(s, ai.lastSeen, t), aim: null };
      if (!ai.goal || dist(ai.goal, h) < 70 || t >= (ai.goalAt || 0)) { ai.goal = jailedCount() && Math.random() < 0.75 ? pick(g.map.freeSpots) : pick(g.map.runSpots); ai.goalAt = t + 8000; }
      const b0 = !s.gadget ? nearBox(s, t, 300) : null;
      return { k: go(s, b0 || ai.goal, t), aim: null };
    }
    // D'abord celui qui est sonné, sinon le plus proche.
    const stunned = free.filter((o) => t < o.stunUntil).sort((a, b) => dist(a.h, h) - dist(b.h, h))[0];
    const foe = stunned || free.sort((a, b) => dist(a.h, h) - dist(b.h, h))[0];
    const d = dist(foe.h, h), sees = true;
    let k, aim = null;
    const box = !s.gadget && !stunned ? nearBox(s, t, 180) : null;
    k = go(s, box && d > 340 ? box : foe.h, t);
    if (sees && d < RANGE - 60 && !stunned) {
      const lead = d / 1800;
      aim = Math.atan2(foe.h.y + foe.h.vy * lead - h.y, foe.h.x + foe.h.vx * lead - h.x) + (Math.random() - 0.5) * 0.42;
      if (!ai.seenAt) ai.seenAt = t + 300 + Math.random() * 600;   // il met un instant à réagir
      if (t >= ai.seenAt && t >= s.taserAt && !(s.prevK & K.FIRE)) { k |= K.FIRE; ai.seenAt = 0; }
    } else ai.seenAt = 0;
    if (s.gadget && !(s.prevK & K.DASH)) {
      if (s.gadget === "sprint" ? d > 180 : s.gadget === "rapide" ? sees : d > 120 && d < 340) k |= K.DASH;
    }
    return { k, aim };
  }

  function runnerBot(s, t) {
    if (t < s.stunUntil) return { k: 0, aim: null };
    const h = s.h, ai = s.ai;
    // Un prisonnier va vers le bord du cercle, du côté d'un copain libre.
    if (s.jailed) {
      const f = freeRunners().map(([, o]) => o).sort((a, b) => dist(a.h, h) - dist(b.h, h))[0];
      return { k: f ? keyTo(h, f.h) : 0, aim: null };
    }
    const cops = all("cop").map(([, o]) => o);
    const close = cops.slice().sort((a, b) => dist(a.h, h) - dist(b.h, h))[0];
    const dc = close ? dist(close.h, h) : 9999;
    const threat = dc < 460 && close && Q.sees(g.map, h, close.h);
    let k = 0;
    // Libérer les autres, si aucun flic ne garde la prison.
    if (g.prison && (ai.brave || jailedCount() >= freeRunners().length) && jailedCount() > 0) {
      const P = { x: g.map.prison.cx, y: g.map.prison.cy };
      const guarded = cops.some((c) => dist(c.h, P) < Q.JAIL_R + 120);
      if (!guarded || dist(P, h) < Q.JAIL_R) {
        const r = all("runner").map(([, o]) => o).filter((o) => o.jailed).sort((a, b) => dist(a.h, h) - dist(b.h, h))[0];
        if (r && (!threat || dist(r.h, h) < 260)) return { k: go(s, r.h, t), aim: null };
      }
    }
    if (threat) {
      // Il fuit vers l'endroit le plus loin du flic.
      if (t >= (ai.fleeAt || 0) || !ai.goal) {
        let best = null, bs = -1e9;
        for (let i = 0; i < 8; i++) { const p = pick(g.map.runSpots), v = dist(p, close.h) - 0.5 * dist(p, h); if (v > bs) { bs = v; best = p; } }
        ai.goal = best; ai.fleeAt = t + 1500;
      }
      k = go(s, ai.goal, t);
      if (s.gadget && !(s.prevK & K.DASH) && dc < 280) k |= K.DASH;
      return { k, aim: null };
    }
    const box = !s.gadget ? nearBox(s, t, 500) : null;
    if (box) return { k: go(s, box, t), aim: null };
    if (!ai.goal || dist(ai.goal, h) < 60 || t >= (ai.goalAt || 0)) { ai.goal = pick(g.map.runSpots); ai.goalAt = t + 9000; }
    return { k: go(s, ai.goal, t), aim: null };
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
        if (s.bot) { const b = s.role === "cop" ? copBot(s, t) : runnerBot(s, t); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);    // onglet en pause : on ne bouge plus
      }
      if (!g.win) world(dt, t);
      if (!g.win && t - g.playAt >= ROUND_MS) finishRound("runners");
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    if (!g.heroes[id] || !["countdown", "play"].includes(g.phase)) return;
    delete g.heroes[id];
    if (g.phase !== "play" || g.win) return;
    if (!all("cop").length) finishRound("runners");
    else if (!g.prison && !g.heroes[g.warden]) g.warden = all("cop")[0][0], g.heroes[g.warden].warden = true;
    else if (!freeRunners().length) finishRound("cops");
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 4, 6].includes(s.rounds)) s.rounds = 4;
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
    // Touches + visée : { s, k, a (angle) }
    in(pid, { s, k, a, d }) {
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      st.aim = typeof a === "number" && isFinite(a) ? a : null;
      st.aimD = typeof d === "number" && isFinite(d) ? Math.max(0, Math.min(THROW_MAX, d)) : null;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, k & 127, st.aim);
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
