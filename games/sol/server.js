// ===================================================================
//  SOL QUI S'EFFONDRE — Moteur du jeu (module du hub Le Bordel)
//  Des bonshommes sur une arène de dalles. Chaque dalle sur laquelle on
//  marche se fissure puis tombe 0,8 s plus tard. Dash pour bousculer.
//  Tomber dans le vide = éliminé. Dernier debout = gagnant de la manche.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";

const H = globalThis.Pieton;
const K = H.K;

export const meta = {
  id: "sol",
  name: "Sol qui s'effondre",
  emoji: "🌋",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Chaque dalle où tu marches tombe derrière toi. Pousse les autres dans le vide !",
};

const TICK_MS = 1000 / 30;
export const TILE = 40, COLS = 32, ROWS = 19;   // petites dalles : la traînée de trous est fine
export const W = COLS * TILE, HGT = ROWS * TILE;
export const CRACK_MS = 900;       // une dalle tombe 0,9 s après qu'on a marché dessus
const FALL_MS = 700;               // la chute (on rétrécit en tournant) avant d'être éliminé
const COUNTDOWN_MS = 3000;
const END_DELAY = 1500;            // on voit la dernière chute avant les scores
const ROUND_OVER_MS = 6000;
const FINISH_DELAY = 15000;
const COLLAPSE_AFTER = 60000;      // après 60 s, le bord de l'arène s'effrite tout seul
export const HEAVY_MS = 5000;      // bonus de la dalle dorée
const SHAPES = ["carré", "rond", "croix", "anneau", "îlots", "gruyère"];

// floor : "solides" = une dalle se fissure au 1er passage et tombe au 2e (défaut) · "fragiles" = elle tombe dès le 1er passage
function defaultSettings() {
  return { rounds: 3, floor: "solides" };
}
const STAY_MS = 1100;              // rester planté sur une dalle la fait tomber (il faut bouger)

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
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ===================================================================
//  LES ARÈNES : une grille de 24 x 15 dalles (1 = dalle, 0 = vide)
// ===================================================================
export function makeArena(shape, nPlayers) {
  const g = new Uint8Array(COLS * ROWS);
  const big = nPlayers >= 5 ? 1 : 0;          // un peu plus grand à beaucoup
  // On dessine en proportions (u, v de 0 à 1) : ça marche quelle que soit la taille de la grille.
  const each = (fn) => { for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (fn((c + 0.5) / COLS, (r + 0.5) / ROWS, c, r)) g[r * COLS + c] = 1; };
  if (shape === "carré") {
    const mu = 0.2 - big * 0.06, mv = 0.12 - big * 0.05;
    each((u, v) => u > mu && u < 1 - mu && v > mv && v < 1 - mv);
  } else if (shape === "rond" || shape === "anneau") {
    const ru = 0.3 + big * 0.05, rv = 0.43 + big * 0.04;
    each((u, v) => { const d = Math.hypot((u - 0.5) / ru, (v - 0.5) / rv); return d <= 1 && (shape !== "anneau" || d > 0.42); });
  } else if (shape === "croix") {
    const tv = 0.14 + big * 0.04, tu = 0.09 + big * 0.025;
    each((u, v) => (Math.abs(v - 0.5) <= tv && u > 0.04 && u < 0.96) || (Math.abs(u - 0.5) <= tu && v > 0.02 && v < 0.98));
  } else if (shape === "îlots") {
    // 4 ou 5 îlots reliés par des ponts de 2 dalles.
    const isl = [[0.2, 0.24], [0.8, 0.24], [0.2, 0.76], [0.8, 0.76]];
    if (big || Math.random() < 0.5) isl.push([0.5, 0.5]);
    const hu = 0.12 + big * 0.02, hv = 0.17 + big * 0.02;
    each((u, v) => isl.some(([x, y]) => Math.abs(u - x) <= hu && Math.abs(v - y) <= hv));
    const bridge = ([ax, ay], [bx, by]) => {
      const n = 80;
      for (let i = 0; i <= n; i++) {
        const c = Math.round((ax + ((bx - ax) * i) / n) * COLS - 0.5), r = Math.round((ay + ((by - ay) * i) / n) * ROWS - 0.5);
        for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) if (c + dc < COLS && r + dr < ROWS) g[(r + dr) * COLS + c + dc] = 1;
      }
    };
    bridge(isl[0], isl[1]); bridge(isl[2], isl[3]); bridge(isl[0], isl[2]); bridge(isl[1], isl[3]);
    if (isl[4]) for (let i = 0; i < 4; i++) bridge(isl[i], isl[4]);
  } else {
    // « Gruyère » : un grand rectangle avec des trous au hasard.
    const mu = 0.12 - big * 0.05, mv = 0.07;
    each((u, v) => u > mu && u < 1 - mu && v > mv && v < 1 - mv);
    for (let i = 0; i < 34; i++) {
      const c = Math.floor(rand(COLS * mu + 2, COLS * (1 - mu) - 3)), r = Math.floor(rand(ROWS * mv + 2, ROWS * (1 - mv) - 3));
      if (Math.abs(c - COLS / 2) < 3 && Math.abs(r - ROWS / 2) < 3) continue;
      const w = 1 + Math.floor(Math.random() * 2), h = 1 + Math.floor(Math.random() * 2);
      for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) g[(r + dr) * COLS + c + dc] = 0;
    }
  }
  return g;
}

// Distance (en dalles) de chaque dalle jusqu'au vide le plus proche (0 = le vide).
function voidDistance(tiles) {
  const d = new Int16Array(COLS * ROWS).fill(-1), q = [];
  for (let i = 0; i < d.length; i++) if (!tiles[i]) { d[i] = 0; q.push(i); }
  // Le bord de la grille compte comme du vide.
  for (let c = 0; c < COLS; c++) for (const r of [0, ROWS - 1]) { const i = r * COLS + c; if (d[i] < 0) { d[i] = 1; q.push(i); } }
  for (let r = 0; r < ROWS; r++) for (const c of [0, COLS - 1]) { const i = r * COLS + c; if (d[i] < 0) { d[i] = 1; q.push(i); } }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], c = i % COLS, r = (i / COLS) | 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const n = nr * COLS + nc;
      if (d[n] < 0) { d[n] = d[i] + 1; q.push(n); }
    }
  }
  return d;
}

export const tileAt = (x, y) => {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  return c < 0 || r < 0 || c >= COLS || r >= ROWS ? -1 : r * COLS + c;
};

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    round: 0,
    shape: null,
    tiles: null,          // 0 = vide, 1 = dalle
    crackAt: null,        // quand la dalle tombe (0 = pas en train de tomber)
    hp: null,             // passages restants avant qu'elle tombe (2 = intacte, 1 = fissurée)
    gold: -1,             // dalle dorée (indice) ou -1
    nextGold: 0,
    heroes: {},           // id -> { h, alive, falling, fallAt, bot, seq, lastInputAt, ai }
    order: [],            // ordre d'élimination
    lastHits: {},         // id -> { by, t } (dernier qui l'a poussé)
    feed: [],
    playAt: 0,
    endAt: 0,
    nextCollapse: 0,
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
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const alive = () => Object.keys(g.heroes).filter((id) => g.heroes[id].alive);
  // On marche un peu moins vite ici (sinon l'arène fond trop vite) ; Espace = POUSSÉE (pas de dash).
  const ENV = { walls: false, speedMul: 0.85, push: true };

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s)
  // =================================================================
  // Les dalles en une chaîne : 0 vide, 1 dalle, a = fissurée (tient encore), 2 à 9 = en train de tomber (9 = va tomber).
  function tileString() {
    const t = now();
    let s = "";
    for (let i = 0; i < g.tiles.length; i++) {
      if (!g.tiles[i]) s += "0";
      else if (!g.crackAt[i]) s += g.hp[i] < g.maxHp ? "a" : "1";
      else s += String(2 + Math.min(7, Math.floor((1 - Math.max(0, g.crackAt[i] - t) / CRACK_MS) * 8)));
    }
    return s;
  }
  function publicState() {
    const t = now();
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      arena: g.tiles && { shape: g.shape, cols: COLS, rows: ROWS, tile: TILE, tiles: tileString(), gold: g.gold },
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, alive: s.alive, falling: s.falling ? Math.min(1, (t - s.fallAt) / FALL_MS) : 0,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, dash: s.h.dash, dashT: s.h.dashT, pushT: s.h.pushT, stun: s.h.stun, heavy: s.h.heavy, walk: s.h.walk,
      })),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
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
    g.shape = pick(SHAPES);
    g.tiles = makeArena(g.shape, list.length);
    g.crackAt = new Float64Array(g.tiles.length);
    g.maxHp = g.settings.floor === "fragiles" ? 1 : 2;
    g.hp = new Uint8Array(g.tiles.length).fill(g.maxHp);
    g.gold = -1;
    g.heroes = {};
    g.order = [];
    g.lastHits = {};
    g.feed = [];
    g.fx = [];
    g.endAt = 0;
    g.lastRound = null;
    // Départs : des dalles loin du vide et loin les unes des autres.
    const vd = voidDistance(g.tiles);
    const good = [];
    for (let i = 0; i < g.tiles.length; i++) if (g.tiles[i] && vd[i] >= 2) good.push(i);
    if (!good.length) for (let i = 0; i < g.tiles.length; i++) if (g.tiles[i]) good.push(i);
    const spots = [];
    for (let k = 0; k < list.length; k++) {
      let best = good[0], bestD = -1;
      for (const i of shuffle(good).slice(0, 60)) {
        const c = i % COLS, r = (i / COLS) | 0;
        const dd = spots.length ? Math.min(...spots.map(([sc, sr]) => Math.hypot(sc - c, sr - r))) : 99;
        if (dd > bestD) { bestD = dd; best = i; }
      }
      spots.push([best % COLS, (best / COLS) | 0]);
    }
    list.forEach((p, k) => {
      const [c, r] = spots[k];
      const x = (c + 0.5) * TILE, y = (r + 0.5) * TILE;
      g.heroes[p.id] = { h: H.newHero(x, y, Math.atan2(HGT / 2 - y, W / 2 - x)), alive: true, falling: false, fallAt: 0, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {} };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function eliminate(id) {
    const s = g.heroes[id];
    if (!s?.alive) return;
    s.alive = false;
    g.order.push(id);
    const hit = g.lastHits[id];
    if (hit && now() - hit.t < 2500 && g.heroes[hit.by]) say(`💥 ${pseudo(hit.by)} a poussé ${pseudo(id)} dans le vide !`);
    else say(`🕳️ ${pseudo(id)} est tombé`);
    if (alive().length <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  function say(text) {
    g.feed.push({ id: ++g.fxId, text });
    if (g.feed.length > 10) g.feed.shift();
  }

  // Points : 1 par joueur tombé avant toi (le dernier debout a le maximum).
  function endRound() {
    stopLoop();
    const ids = Object.keys(g.heroes);
    const order = [...g.order, ...alive()];
    const gains = {};
    order.forEach((id, i) => { gains[id] = i; });
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = { order: order.slice().reverse(), gains, winner: alive()[0] || order[order.length - 1] || null, total: ids.length };
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
  //  PHYSIQUE + DALLES
  // =================================================================
  function advance(id, k) {
    const s = g.heroes[id];
    if (!s.alive || s.falling) return;
    const dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, k, null, dt, ENV);
      // Il vient d'appuyer sur Espace : ceux qui sont juste devant lui sont repoussés.
      if (s.h.pushed) {
        s.h.pushed = false;
        const others = Object.entries(g.heroes).filter(([oid, o]) => oid !== id && o.alive && !o.falling);
        const hits = H.applyPush(s.h, others.map(([, o]) => o.h));
        for (const hh of hits) {
          const oid = others.find(([, o]) => o.h === hh)[0];
          g.lastHits[oid] = { by: id, t: now() };
          addFx((s.h.x + hh.x) / 2, (s.h.y + hh.y) / 2, true);
        }
      }
      for (const [oid, o] of Object.entries(g.heroes)) {
        if (oid === id || !o.alive || o.falling) continue;
        H.collideHeroes(s.h, o.h);
      }
    }
  }

  // Chaque calcul : les dalles sous les pieds se fissurent, celles qui sont à bout tombent, on tombe si plus de sol.
  function floorTick(t) {
    for (const [id, s] of Object.entries(g.heroes)) {
      if (!s.alive) continue;
      if (s.falling) { if (t - s.fallAt >= FALL_MS) eliminate(id); continue; }
      if (g.endAt) continue;   // manche gagnée : le dernier debout ne peut plus tomber
      const i = tileAt(s.h.x, s.h.y);
      if (i < 0 || !g.tiles[i]) { s.falling = true; s.fallAt = t; s.h.vx *= 0.3; s.h.vy *= 0.3; continue; }
      // On entre sur une dalle : un passage de moins (au dernier, elle tombe). Rester planté la fait tomber aussi.
      if (i !== s.tile) { s.tile = i; s.since = t; if (!g.crackAt[i] && --g.hp[i] <= 0) g.crackAt[i] = t + CRACK_MS; }
      else if (!g.crackAt[i] && t - s.since > STAY_MS) g.crackAt[i] = t + CRACK_MS;
      // La dalle dorée : on devient lourd 5 s.
      if (i === g.gold) { s.h.heavy = HEAVY_MS / 1000; g.gold = -1; g.nextGold = t + rand(7000, 11000); say(`🟨 ${pseudo(id)} devient LOURD pendant 5 s !`); addFx(s.h.x, s.h.y, true, "gold"); }
    }
    for (let i = 0; i < g.tiles.length; i++) if (g.crackAt[i] && t >= g.crackAt[i]) { g.tiles[i] = 0; g.crackAt[i] = 0; if (g.gold === i) g.gold = -1; }
    // Une nouvelle dalle dorée de temps en temps (sur une dalle intacte).
    if (g.gold < 0 && t >= g.nextGold) {
      const free = [];
      for (let i = 0; i < g.tiles.length; i++) if (g.tiles[i] && !g.crackAt[i]) free.push(i);
      if (free.length) g.gold = pick(free);
      g.nextGold = t + 1e9;
    }
    // Manche trop longue : le bord s'effrite tout seul.
    if (t - g.playAt > COLLAPSE_AFTER && t >= g.nextCollapse) {
      const vd = voidDistance(g.tiles), edge = [];
      for (let i = 0; i < g.tiles.length; i++) if (g.tiles[i] && !g.crackAt[i] && vd[i] === 1) edge.push(i);
      for (const i of shuffle(edge).slice(0, 3)) g.crackAt[i] = t + CRACK_MS;
      g.nextCollapse = t + 600;
    }
  }

  function addFx(x, y, big = false, kind = "hit") {
    const t = now();
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), big, kind });
    if (g.fx.length > 30) g.fx.shift();
  }

  // =================================================================
  //  BOTS : ils restent sur les dalles intactes loin du vide, bougent
  //  sans arrêt, et foncent (dash) sur un voisin proche du bord.
  // =================================================================
  const DIRS = Array.from({ length: 8 }, (_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  const DIRKEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  // Le chemin : de dalle intacte en dalle intacte (8 directions, sans couper un coin au-dessus du vide),
  // vers la dalle la plus loin du vide qu'on peut atteindre en ~12 pas.
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const okTile = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS && g.tiles[r * COLS + c] && !g.crackAt[r * COLS + c];
  function planPath(cur, vd) {
    const prev = new Int32Array(g.tiles.length).fill(-2), depth = new Int16Array(g.tiles.length);
    prev[cur] = -1;
    const q = [cur];
    let best = -1, bestScore = -1e9;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], c = i % COLS, r = (i / COLS) | 0;
      if (i !== cur) {
        const sc = Math.min(6, vd[i]) * 4 - depth[i] * 0.4 + (i === g.gold ? 40 : 0) - (g.hp[i] < g.maxHp ? 6 : 0) + Math.random() * 2;
        if (sc > bestScore) { bestScore = sc; best = i; }
      }
      if (depth[i] >= 12) continue;
      for (const [dc, dr] of NB) {
        const nc = c + dc, nr = r + dr, n = nr * COLS + nc;
        if (!okTile(nc, nr) || prev[n] !== -2) continue;
        if (dc && dr && (!okTile(c + dc, r) || !okTile(c, r + dr))) continue;   // pas de coin coupé
        prev[n] = i; depth[n] = depth[i] + 1; q.push(n);
      }
    }
    if (best < 0) return null;
    let step = best;
    while (prev[step] !== cur && prev[step] >= 0) step = prev[step];
    return { next: step, goal: best };
  }

  function botKeys(id, s, vd, t) {
    const h = s.h, ai = s.ai;
    ai.think = (ai.think || 0) - H.TICK;
    const cur = tileAt(h.x, h.y);
    if (ai.think <= 0 || ai.next == null || ai.next === cur || !g.tiles[ai.next] || g.crackAt[ai.next]) {
      ai.think = 0.25;
      const p = cur >= 0 ? planPath(cur, vd) : null;
      ai.next = p ? p.next : null;
    }
    // Vers le centre de la prochaine dalle (sinon : on avance tout droit, il faut bouger).
    let ang;
    if (ai.next != null) ang = Math.atan2(((ai.next / COLS) | 0) * TILE + TILE / 2 - h.y, (ai.next % COLS) * TILE + TILE / 2 - h.x);
    else ang = h.face;
    ai.dir = Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    let k = DIRKEYS[ai.dir];
    // Poussée : un voisin juste devant nous, près du bord → on le pousse (on se tourne vers lui).
    if (h.dash <= 0) {
      for (const [oid, o] of Object.entries(g.heroes)) {
        if (oid === id || !o.alive || o.falling) continue;
        const dx = o.h.x - h.x, dy = o.h.y - h.y, d = Math.hypot(dx, dy);
        const oi = tileAt(o.h.x, o.h.y);
        if (d < H.R * 2 + H.PUSH_REACH - 4 && oi >= 0 && vd[oi] <= 3 && Math.random() < 0.3) {
          const a = Math.round(((Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
          // On ne s'avance vers lui que si la dalle devant nous est sûre.
          const [ux, uy] = DIRS[a];
          const li = tileAt(h.x + ux * 30, h.y + uy * 30);
          if (li < 0 || !g.tiles[li] || g.crackAt[li]) continue;
          h.face = Math.atan2(dy, dx);
          k = DIRKEYS[a] | K.DASH;
          break;
        }
      }
    }
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
        g.nextGold = t + rand(5000, 8000);
        g.nextCollapse = t + COLLAPSE_AFTER;
      }
    } else if (g.phase === "play") {
      const vd = voidDistance(g.tiles);
      for (const [id, s] of Object.entries(g.heroes)) {
        if (!s.alive) continue;
        if (s.bot) advance(id, botKeys(id, s, vd, t));
        else if (t - s.lastInputAt > 200) advance(id, 0);   // onglet en pause : on s'arrête
      }
      floorTick(t);
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    const s = g.heroes[id];
    if (!s || !["countdown", "play"].includes(g.phase)) return;
    if (s.alive) eliminate(id);
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5, 7].includes(s.rounds)) s.rounds = 3;
      if (!["solides", "fragiles"].includes(s.floor)) s.floor = "solides";
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
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      advance(pid, k & 63);
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
