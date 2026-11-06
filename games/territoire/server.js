// ===================================================================
//  TERRITOIRE — Moteur du jeu (module du hub Le Bordel)
//  Des bonshommes peignent le sol de leur couleur : en marchant (traînée)
//  et avec des jets de peinture (clic gauche, vers la souris). À la fin
//  du chrono, la plus grande surface gagne. Chacun pour soi ou 2 équipes.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";

const H = globalThis.Pieton;
const K = H.K;

export const meta = {
  id: "territoire",
  name: "Territoire",
  emoji: "🎨",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Peins le sol de ta couleur (en marchant et en tirant) : la plus grande surface gagne !",
};

const TICK_MS = 1000 / 30;
export const W = 1280, HGT = 800;
export const CELL = 16, GW = W / CELL, GH = HGT / CELL;   // la grille de peinture : 80 x 50 cases
export const WALL = 255;                                  // case d'obstacle (ne se peint pas)
export const TRAIL_R = 20;          // largeur de la traînée (rayon, px)
export const ROLLER_R = 46;         // traînée avec le gros rouleau
export const SPLAT_R = 42;          // tache d'un jet de peinture
export const BOMB_R = 115;          // bombe de peinture
export const SHOT_RANGE = 180;      // portée d'un jet
export const SHOT_CD = 0.6;         // recharge d'un jet (s)
const SHOT_TIME = 0.35;             // temps de vol d'un jet (s)
const COUNTDOWN_MS = 3000;
const BONUS_EVERY = [7000, 10000];  // une caisse toutes les 7 à 10 s (2 en même temps au maximum)
export const ROLLER_S = 6, FAST_S = 5, FAST_MUL = 1.4;
const FINISH_DELAY = 15000;
const TEAMS = { 1: { name: "Rouges", emoji: "🔴", color: "#ff4d5a" }, 2: { name: "Bleus", emoji: "🔵", color: "#3a8bff" } };

function defaultSettings() {
  // mode : "auto" (équipes à partir de 4 joueurs) · "solo" · "equipes"
  return { duration: 90, mode: "auto" };
}

export const playlist = {
  options: [
    {
      key: "mode", label: "Mode", default: "auto",
      choices: [{ v: "auto", label: "🔁 Alterné" }, { v: "solo", label: "🎨 Chacun pour soi" }, { v: "equipes", label: "🔴🔵 2 équipes" }],
    },
    {
      key: "duration", label: "Durée", default: "90",
      choices: [{ v: "60", label: "60 s" }, { v: "90", label: "90 s" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), mode: ["auto", "solo", "equipes"].includes(c.mode) ? c.mode : "auto", duration: Number(c.duration) === 60 ? 60 : 90 };
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Des obstacles au hasard (blocs, murets, piliers), loin des départs.
export function makeObstacles(spawns) {
  const rects = [];
  const want = Math.floor(rand(5, 9));
  for (let tries = 0; tries < 300 && rects.length < want; tries++) {
    const kind = pick(["bloc", "bloc", "mur-h", "mur-v", "pilier"]);
    let w, h;
    if (kind === "bloc") { w = rand(80, 150); h = rand(80, 140); }
    else if (kind === "mur-h") { w = rand(180, 300); h = 32; }
    else if (kind === "mur-v") { w = 32; h = rand(160, 260); }
    else { w = h = 48; }
    const o = { x: Math.round(rand(110, W - 110 - w) / CELL) * CELL, y: Math.round(rand(90, HGT - 90 - h) / CELL) * CELL, w: Math.round(w / CELL) * CELL, h: Math.round(h / CELL) * CELL };
    if (rects.some((p) => o.x < p.x + p.w + 90 && o.x + o.w + 90 > p.x && o.y < p.y + p.h + 90 && o.y + o.h + 90 > p.y)) continue;
    if (spawns.some((s) => s.x > o.x - 70 && s.x < o.x + o.w + 70 && s.y > o.y - 70 && s.y < o.y + o.h + 70)) continue;
    rects.push(o);
  }
  return rects;
}

// Départs : en cercle, tournés vers le centre.
function spawnPoints(n) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2 + Math.PI / 4;
    const x = W / 2 + Math.cos(t) * (W / 2 - 130), y = HGT / 2 + Math.sin(t) * (HGT / 2 - 110);
    return { x, y, a: Math.atan2(HGT / 2 - y, W / 2 - x) };
  });
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    teamsMode: false,
    owners: {},           // numéro de couleur -> { color, name, ids }
    ownerOf: {},          // id joueur -> numéro de couleur
    grid: null,           // la peinture (0 = rien, 1-8 = couleur, 255 = obstacle)
    paintable: 0,
    counts: {},           // numéro de couleur -> cases peintes
    adds: [],             // cases changées depuis le dernier envoi [i, couleur, i, couleur…]
    tickN: 0,
    rects: [],
    heroes: {},           // id -> { h, bot, seq, lastInputAt, ai, fireCd, roller, fast, aim }
    shots: [],            // jets en vol { id, owner, by, x0, y0, x1, y1, t0 }
    shotId: 0,
    bonuses: [],          // caisses { id, kind, x, y }
    bonusId: 0,
    nextBonus: 0,
    playAt: 0,
    endAt: 0,
    phaseEnd: 0,
    result: null,
    loop: null,
    fx: [],
    fxId: 0,
    final: false,
    finishAt: 0,
    finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const envFor = (s) => ({ walls: true, w: W, h: HGT, rects: g.rects, speedMul: s.fast > 0 ? FAST_MUL : 1, noDash: true });

  // =================================================================
  //  LA PEINTURE
  // =================================================================
  function paintCircle(x, y, r, owner) {
    const c0 = Math.max(0, Math.floor((x - r) / CELL)), c1 = Math.min(GW - 1, Math.floor((x + r) / CELL));
    const r0 = Math.max(0, Math.floor((y - r) / CELL)), r1 = Math.min(GH - 1, Math.floor((y + r) / CELL));
    for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) {
      const cx = (cc + 0.5) * CELL - x, cy = (rr + 0.5) * CELL - y;
      if (cx * cx + cy * cy > r * r) continue;
      const i = rr * GW + cc, old = g.grid[i];
      if (old === WALL || old === owner) continue;
      if (old) g.counts[old]--;
      g.grid[i] = owner;
      g.counts[owner] = (g.counts[owner] || 0) + 1;
      g.adds.push(i, owner);
    }
  }
  const gridString = () => { let s = ""; for (const v of g.grid) s += v === WALL ? "#" : String(v); return s; };

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s) — la peinture : seulement ce qui a changé
  //  (+ toute la grille 1 fois par seconde, pour ceux qui arrivent)
  // =================================================================
  function publicState() {
    const t = now();
    const pct = {};
    for (const [o, n] of Object.entries(g.counts)) pct[o] = g.paintable ? Math.round((n / g.paintable) * 1000) / 1000 : 0;
    // Ce qui ne change pas (obstacles, équipes) : seulement avec la grille complète (1 fois/s), le navigateur le garde.
    const full = g.tickN % 30 === 0 || g.phase !== "play";
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p })),
      static: full ? { teamsMode: g.teamsMode, owners: g.owners, ownerOf: g.ownerOf, rects: g.rects } : null,
      paint: g.grid && { tick: g.tickN, adds: g.adds, full: full ? gridString() : null },
      pct,
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun,
        dash: 0, dashT: 0, pushT: 0, heavy: 0, fireCd: Math.round(s.fireCd * 100) / 100, roller: Math.round(s.roller * 10) / 10, fast: Math.round(s.fast * 10) / 10,
      })),
      shots: g.shots.map((sh) => ({ id: sh.id, owner: sh.owner, x0: Math.round(sh.x0), y0: Math.round(sh.y0), x1: Math.round(sh.x1), y1: Math.round(sh.y1), age: Math.round(t - sh.t0) / 1000 })),
      bonuses: g.bonuses,
      timeLeft: g.phase === "play" ? Math.max(0, g.endAt - t) : g.settings.duration * 1000,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      result: g.result,
      fx: g.fx.filter((f) => t - f.t < 350).map(({ id, x, y, kind, owner }) => ({ id, x, y, kind, owner })),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startMatch() {
    const list = shuffle(players().filter((p) => p.connected));
    const n = list.length;
    // Alterné : d'une partie à l'autre (en équipes dès 4 joueurs en nombre pair).
    g.plays = (g.plays || 0) + 1;
    g.teamsMode = g.settings.mode === "equipes" || (g.settings.mode === "auto" && n >= 4 && n % 2 === 0 && g.plays % 2 === 1);
    g.owners = {};
    g.ownerOf = {};
    if (g.teamsMode) {
      for (const k of [1, 2]) g.owners[k] = { ...TEAMS[k], ids: [] };
      list.forEach((p, i) => { const k = (i % 2) + 1; g.ownerOf[p.id] = k; g.owners[k].ids.push(p.id); });
    } else {
      list.forEach((p, i) => { g.ownerOf[p.id] = i + 1; g.owners[i + 1] = { color: p.color, name: p.pseudo, ids: [p.id] }; });
    }
    // Départs : en équipes, chaque équipe d'un côté.
    let spots = spawnPoints(n);
    if (g.teamsMode) spots = [...spots].sort((a, b) => a.x - b.x);
    const order = g.teamsMode ? [...list].sort((a, b) => g.ownerOf[a.id] - g.ownerOf[b.id]) : list;
    g.rects = makeObstacles(spots);
    g.grid = new Uint8Array(GW * GH);
    g.paintable = 0;
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      const x = (c + 0.5) * CELL, y = (r + 0.5) * CELL;
      if (g.rects.some((o) => x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h)) g.grid[r * GW + c] = WALL;
      else g.paintable++;
    }
    g.counts = {};
    g.adds = [];
    g.heroes = {};
    order.forEach((p, i) => {
      const sp = spots[i];
      g.heroes[p.id] = { h: H.newHero(sp.x, sp.y, sp.a), bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, fireCd: 0, roller: 0, fast: 0, aim: null };
      paintCircle(sp.x, sp.y, 50, g.ownerOf[p.id]);   // une petite tache de départ
    });
    g.shots = [];
    g.bonuses = [];
    g.fx = [];
    g.result = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }

  function endMatch() {
    stopLoop();
    // Le classement : par surface (en équipes : l'équipe gagnante devant).
    const scores = Object.entries(g.owners).map(([k, o]) => ({ k: Number(k), ids: o.ids, n: g.counts[k] || 0 }))
      .sort((a, b) => b.n - a.n);
    g.result = { scores: scores.map((s) => ({ owner: s.k, ids: s.ids, pct: g.paintable ? s.n / g.paintable : 0 })) };
    g.phase = "over";
    if (ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  // Points de soirée : par surface (égalité = même place).
  function ranking() {
    if (!g.result) return [];
    const groups = [];
    let last = null;
    for (const s of g.result.scores) {
      const pct = Math.round(s.pct * 1000);
      if (last && last.pct === pct) last.ids.push(...s.ids);
      else { last = { pct, ids: [...s.ids] }; groups.push(last); }
    }
    return groups.map((gr) => gr.ids);
  }

  // =================================================================
  //  PHYSIQUE + PEINTURE + JETS
  // =================================================================
  function advance(id, k, aim, target) {
    const s = g.heroes[id];
    const env = envFor(s);
    const dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, k & ~K.DASH, aim, dt, env);
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id) H.collideHeroes(s.h, o.h);
    }
    if (g.phase !== "play") return;
    paintCircle(s.h.x, s.h.y, s.roller > 0 ? ROLLER_R : TRAIL_R, g.ownerOf[id]);
    // Jet de peinture (clic gauche) vers la cible (limité à la portée).
    if (k & K.FIRE && s.fireCd <= 0 && target) {
      let dx = target.x - s.h.x, dy = target.y - s.h.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = Math.min(SHOT_RANGE, d);
      const x1 = Math.max(4, Math.min(W - 4, s.h.x + (dx / d) * reach)), y1 = Math.max(4, Math.min(HGT - 4, s.h.y + (dy / d) * reach));
      g.shots.push({ id: ++g.shotId, owner: g.ownerOf[id], by: id, x0: s.h.x, y0: s.h.y, x1, y1, t0: now() });
      s.fireCd = SHOT_CD;
    }
    // Ramasser une caisse.
    for (const b of [...g.bonuses]) {
      if (Math.hypot(b.x - s.h.x, b.y - s.h.y) > 30) continue;
      g.bonuses = g.bonuses.filter((x) => x !== b);
      if (b.kind === "bombe") { paintCircle(b.x, b.y, BOMB_R, g.ownerOf[id]); addFx(b.x, b.y, "bombe", g.ownerOf[id]); }
      else if (b.kind === "rouleau") { s.roller = ROLLER_S; addFx(b.x, b.y, "bonus", g.ownerOf[id]); }
      else { s.fast = FAST_S; addFx(b.x, b.y, "bonus", g.ownerOf[id]); }
    }
  }

  function addFx(x, y, kind, owner) {
    g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(x), y: Math.round(y), kind, owner });
    if (g.fx.length > 40) g.fx.shift();
  }

  function spawnBonus() {
    for (let tries = 0; tries < 30; tries++) {
      const x = rand(80, W - 80), y = rand(80, HGT - 80);
      if (g.rects.some((o) => x > o.x - 30 && x < o.x + o.w + 30 && y > o.y - 30 && y < o.y + o.h + 30)) continue;
      if (Object.values(g.heroes).some((s) => Math.hypot(s.h.x - x, s.h.y - y) < 120)) continue;
      g.bonuses.push({ id: ++g.bonusId, kind: pick(["bombe", "rouleau", "chaussures"]), x: Math.round(x), y: Math.round(y) });
      return;
    }
  }

  // =================================================================
  //  BOTS : ils vont vers les zones pas encore à eux, et tirent sur la
  //  plus grosse zone adverse à portée.
  // =================================================================
  // Combien de cases « pas à moi » autour d'un point (rayon ~3 cases).
  function interest(x, y, owner) {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    let n = 0;
    for (let dr = -3; dr <= 3; dr++) for (let dc = -3; dc <= 3; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= GW || rr >= GH) continue;
      const v = g.grid[rr * GW + cc];
      if (v === WALL || v === owner) continue;
      n += v ? 1.6 : 1;   // repeindre l'adversaire vaut un peu plus que du vide
    }
    return n;
  }
  const blocked = (x, y) => x < 30 || y < 30 || x > W - 30 || y > HGT - 30 || g.rects.some((o) => x > o.x - 22 && x < o.x + o.w + 22 && y > o.y - 22 && y < o.y + o.h + 22);

  function botInput(id, s) {
    const h = s.h, ai = s.ai, owner = g.ownerOf[id];
    ai.think = (ai.think || 0) - H.TICK;
    const speed = Math.hypot(h.vx, h.vy);
    if (ai.wantGo && speed < 25) ai.stuck = (ai.stuck || 0) + H.TICK; else ai.stuck = 0;
    if (ai.think <= 0 || !ai.goal || Math.hypot(ai.goal.x - h.x, ai.goal.y - h.y) < 30 || ai.stuck > 0.5) {
      ai.think = 1.2 + Math.random();
      ai.stuck = 0;
      let best = null, bestScore = -1e9;
      for (let n = 0; n < 14; n++) {
        const x = rand(50, W - 50), y = rand(50, HGT - 50);
        if (blocked(x, y)) continue;
        const sc = interest(x, y, owner) - Math.hypot(x - h.x, y - h.y) * 0.04 + Math.random() * 6;
        if (sc > bestScore) { bestScore = sc; best = { x, y }; }
      }
      // Une caisse pas trop loin ? On y va.
      for (const b of g.bonuses) if (Math.hypot(b.x - h.x, b.y - h.y) < 260) best = { x: b.x, y: b.y };
      ai.goal = best || { x: W / 2, y: HGT / 2 };
    }
    // Contourner un obstacle droit devant : on décale l'objectif de côté.
    let gx = ai.goal.x, gy = ai.goal.y;
    const ang = Math.atan2(gy - h.y, gx - h.x);
    if (blocked(h.x + Math.cos(ang) * 40, h.y + Math.sin(ang) * 40)) {
      ai.side = ai.side || (Math.random() < 0.5 ? 1 : -1);
      gx = h.x + Math.cos(ang + ai.side * 1.3) * 60; gy = h.y + Math.sin(ang + ai.side * 1.3) * 60;
    }
    const a2 = Math.atan2(gy - h.y, gx - h.x);
    const dir = Math.round(((a2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
    let k = KEYS[dir];
    ai.wantGo = true;
    // Tir : le meilleur endroit à portée.
    let target = null;
    if (s.fireCd <= 0 && Math.random() < 0.5) {
      let best = 0;
      for (let n = 0; n < 8; n++) {
        const a = Math.random() * Math.PI * 2, d = rand(90, SHOT_RANGE);
        const x = h.x + Math.cos(a) * d, y = h.y + Math.sin(a) * d;
        if (x < 0 || y < 0 || x > W || y > HGT) continue;
        const sc = interest(x, y, owner);
        if (sc > best) { best = sc; target = { x, y }; }
      }
      if (target && best > 12) k |= K.FIRE; else target = null;
    }
    return { k, target, aim: target ? Math.atan2(target.y - h.y, target.x - h.x) : null };
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
        g.endAt = t + g.settings.duration * 1000;
        g.nextBonus = t + rand(...BONUS_EVERY) * 0.6;
      }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.heroes)) {
        s.fireCd = Math.max(0, s.fireCd - dt);
        s.roller = Math.max(0, s.roller - dt);
        s.fast = Math.max(0, s.fast - dt);
        if (s.bot) { const b = botInput(id, s); advance(id, b.k, b.aim, b.target); }
        else if (t - s.lastInputAt > 200) advance(id, 0, s.aim, null);   // onglet en pause : on s'arrête
      }
      // Les jets qui atterrissent font une tache.
      for (const sh of [...g.shots]) {
        if (t - sh.t0 < SHOT_TIME * 1000) continue;
        g.shots = g.shots.filter((x) => x !== sh);
        paintCircle(sh.x1, sh.y1, SPLAT_R, sh.owner);
        addFx(sh.x1, sh.y1, "splat", sh.owner);
      }
      if (t >= g.nextBonus) {
        if (g.bonuses.length < 2) spawnBonus();
        g.nextBonus = t + rand(...BONUS_EVERY);
      }
      if (t >= g.endAt) { ctx.update(); g.adds = []; g.tickN++; return endMatch(); }
    }
    ctx.update();
    g.adds = [];
    g.tickN++;
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
      if (![60, 90, 120].includes(s.duration)) s.duration = 90;
      if (!["auto", "solo", "equipes"].includes(s.mode)) s.mode = "auto";
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
    // Touches + visée : { s, k, a (angle), tx, ty (cible du jet) }
    in(pid, { s, k, a, tx, ty }) {
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      st.aim = typeof a === "number" && isFinite(a) ? a : null;
      if (!["play", "countdown"].includes(g.phase) || g.phase === "countdown") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      const target = typeof tx === "number" && typeof ty === "number" && isFinite(tx) && isFinite(ty) ? { x: tx, y: ty } : null;
      advance(pid, k & 63, st.aim, target);
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
    onDisconnect() { ctx.update(); },
    canJoin: () => ["setup", "over"].includes(g.phase),
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startMatch();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
