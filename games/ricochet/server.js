// ===================================================================
//  RICOCHET — Moteur du jeu (module du hub Le Bordel)
//  Arène vue de dessus. Chacun a UNE balle : elle rebondit 3 fois sur les
//  murs puis disparaît, et on peut retirer. Une touche = mort (ta propre
//  balle aussi). Le bouclier (clic droit) renvoie une balle là où on vise.
//  Une manche chacun pour soi, une manche en équipes (mode Alterné).
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/ricochet/arena.js";

const H = globalThis.Pieton;
const A = globalThis.Ricochet;
const K = H.K;
export const SHIELD = 64;            // touche « bouclier » (clic droit)

export const meta = {
  id: "ricochet",
  name: "Ricochet",
  emoji: "🎯",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Une balle, trois rebonds, une touche = mort. Vise les angles, renvoie leurs tirs !",
};

const TICK_MS = 1000 / 30;
export const SPEED = 1.1;            // les bonshommes courent un peu plus vite que la normale
export const SHIELD_MS = 300, SHIELD_CD = 4000;
export const SAFE_OWN = 0.25;        // sa propre balle ne touche pas pendant 0,25 s (le temps qu'elle parte)
export const SUDDEN_AT = 30000;      // après 30 s : l'arène rétrécit
export const SHRINK_MS = 15000;      // … en 15 s
export const SHRINK_MAX = 0.36;      // jusqu'à ne laisser qu'un tiers de l'arène environ
const COUNTDOWN_MS = 3000, END_DELAY = 1500, ROUND_OVER_MS = 6000, FINISH_DELAY = 15000, MAX_MS = 60000;
const TEAMS = { 1: { name: "Cyans", emoji: "🔷", color: "#21e6ff" }, 2: { name: "Magentas", emoji: "🔶", color: "#ff3fd8" } };

function defaultSettings() { return { rounds: 8, mode: "auto" }; }

export const playlist = {
  options: [
    { key: "mode", label: "Mode", default: "auto", choices: [{ v: "auto", label: "🔁 Alterné", hint: "Une manche chacun pour soi, une manche en équipes" }, { v: "solo", label: "🎯 Chacun pour soi" }, { v: "equipes", label: "🔷🔶 2 équipes" }] },
    { key: "rounds", label: "Manches", default: "8", choices: [{ v: "5", label: "5" }, { v: "8", label: "8" }, { v: "12", label: "12" }] },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), mode: ["auto", "solo", "equipes"].includes(c.mode) ? c.mode : "auto", rounds: [5, 8, 12].includes(Number(c.rounds)) ? Number(c.rounds) : 8 };
  },
};

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Le bord qui rétrécit (en px depuis chaque bord), à t ms depuis le début.
export const shrinkAt = (ms) => (ms < SUDDEN_AT ? 0 : Math.min(1, (ms - SUDDEN_AT) / SHRINK_MS) * SHRINK_MAX);

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {}, round: 0,
    teamsMode: false, teamOf: {},
    seed: 0, arena: null,
    heroes: {},           // id -> { h, alive, shieldUntil, shieldReady, bot, seq, lastInputAt, ai, prevK, elims, aim }
    bullets: [], bulletId: 0,
    order: [], feed: [],
    playAt: 0, endAt: 0, phaseEnd: 0, lastTickAt: 0,
    lastRound: null, loop: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const alive = () => Object.keys(g.heroes).filter((id) => g.heroes[id].alive);
  const sideOf = (id) => (g.teamsMode ? g.teamOf[id] : id);
  const enemies = (a, b) => a !== b && (!g.teamsMode || g.teamOf[a] !== g.teamOf[b]);
  const say = (text) => { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); };
  const addFx = (o) => { g.fx.push({ id: ++g.fxId, t: now(), ...o }); if (g.fx.length > 40) g.fx.shift(); };
  const ENV = () => ({ walls: true, w: A.W, h: A.H, noDash: true, speedMul: SPEED, segs: g.arena.walls });
  const playMs = () => (g.phase === "play" ? now() - g.playAt : 0);

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s)
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t, phase: g.phase, settings: g.settings, round: g.round, seed: g.seed,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      teamsMode: g.teamsMode, teamOf: g.teamOf, teams: TEAMS,
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, alive: s.alive, shield: t < s.shieldUntil, shieldCd: Math.max(0, s.shieldReady - t),
        hasBullet: !g.bullets.some((b) => b.by === id),
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: 0, dashT: 0, pushT: 0, heavy: 0,
      })),
      bullets: g.bullets.map((b) => ({ id: b.id, by: b.by, x: Math.round(b.x * 10) / 10, y: Math.round(b.y * 10) / 10, vx: Math.round(b.vx), vy: Math.round(b.vy), left: b.left, team: g.teamOf[b.by] || 0 })),
      shrink: shrinkAt(playMs()),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 500).map(({ t: _, ...f }) => f),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    g.scores = {}; g.round = 0;
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }

  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    const n = list.length;
    g.round++;
    g.teamsMode = g.settings.mode === "equipes" || (g.settings.mode === "auto" && n >= 4 && n % 2 === 0 && g.round % 2 === 0);
    g.teamOf = {};
    if (g.teamsMode) list.forEach((p, i) => { g.teamOf[p.id] = (i % 2) + 1; });
    g.seed = (Math.random() * 2 ** 31) >>> 0;
    g.arena = A.build(g.seed);
    g.heroes = {};
    const used = { 1: 0, 2: 0 };
    // En chacun pour soi : des places réparties autour de l'arène, bien éloignées.
    const ffa = g.arena.spawnsFFA.filter((_, i) => n <= 4 ? i % 2 === 0 : true);
    list.forEach((p, i) => {
      let sp;
      if (g.teamsMode) { const tm = g.teamOf[p.id]; sp = g.arena.spawnsTeam[tm][used[tm]++ % 4]; }
      else sp = ffa[i % ffa.length];
      const face = Math.atan2(A.H / 2 - sp.y, A.W / 2 - sp.x);
      g.heroes[p.id] = { h: H.newHero(sp.x, sp.y, face), alive: true, shieldUntil: 0, shieldReady: 0, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, prevK: 0, elims: 0, aim: face };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.bullets = []; g.order = []; g.feed = []; g.fx = [];
    g.endAt = 0; g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }

  function eliminate(id, by) {
    const s = g.heroes[id];
    if (!s?.alive) return;
    s.alive = false;
    g.order.push(id);
    g.bullets = g.bullets.filter((b) => b.by !== id);
    addFx({ kind: "mort", x: Math.round(s.h.x), y: Math.round(s.h.y), who: id });
    if (by === id) say(`💥 ${pseudo(id)} s'est pris son propre ricochet !`);
    else if (by === "zone") say(`⚡ ${pseudo(id)} a été pris par le bord`);
    else if (by && g.heroes[by]) { g.heroes[by].elims++; say(`🎯 ${pseudo(by)} a eu ${pseudo(id)} !`); }
    const sides = new Set(alive().map(sideOf));
    if (sides.size <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // Points : chacun pour soi = 1 par joueur éliminé avant toi ; équipes = 3 pour l'équipe gagnante. + 1 par élimination.
  function endRound() {
    stopLoop();
    const gains = {}, ids = Object.keys(g.heroes), winners = alive();
    if (g.teamsMode) {
      const winTeam = winners.length ? g.teamOf[winners[0]] : null;
      for (const id of ids) gains[id] = (winTeam && g.teamOf[id] === winTeam ? 3 : 0) + g.heroes[id].elims;
    } else [...g.order, ...winners].forEach((id, i) => { gains[id] = i + g.heroes[id].elims; });
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    const winTeam = g.teamsMode && winners.length ? g.teamOf[winners[0]] : null;
    g.lastRound = { gains, winTeam, winner: g.teamsMode ? null : winners[0] || null, order: [...winners, ...g.order.slice().reverse()], elims: Object.fromEntries(ids.map((id) => [id, g.heroes[id].elims])) };
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
  //  UN JOUEUR AGIT : bouger, tirer, bouclier
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s?.alive) return;
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    const env = ENV(), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, k & (K.UP | K.DOWN | K.LEFT | K.RIGHT), s.aim, dt, env);
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && o.alive) H.collideHeroes(s.h, o.h);
    }
    if (g.phase === "play") {
      if (k & K.FIRE && !(s.prevK & K.FIRE) && !g.bullets.some((b) => b.by === id)) {
        const a = s.aim, x = s.h.x + Math.cos(a) * (H.R + A.BULLET_R + 3), y = s.h.y + Math.sin(a) * (H.R + A.BULLET_R + 3);
        // (pas de tir à travers un mur collé contre soi)
        if (!g.arena.walls.some((w) => { const q = A.closest(w, x, y); return Math.hypot(q.x - x, q.y - y) < A.BULLET_R + w.t / 2; })) {
          g.bullets.push({ id: ++g.bulletId, by: id, x, y, vx: Math.cos(a) * A.BULLET_V, vy: Math.sin(a) * A.BULLET_V, left: A.BOUNCES, age: 0 });
          addFx({ kind: "tir", x: Math.round(x), y: Math.round(y), who: id });
        }
      }
      if (k & SHIELD && !(s.prevK & SHIELD) && t >= s.shieldReady) { s.shieldUntil = t + SHIELD_MS; s.shieldReady = t + SHIELD_CD; }
    }
    s.prevK = k;
  }

  // Les balles volent : murs (rebonds), bouclier (renvoi), joueurs (mort).
  function stepBullets(dt) {
    const t = now();
    for (const b of [...g.bullets]) {
      if (A.moveBullet(b, g.arena, dt)) { addFx({ kind: "fin", x: Math.round(b.x), y: Math.round(b.y), who: b.by }); g.bullets = g.bullets.filter((x) => x !== b); continue; }
      for (const [oid, o] of Object.entries(g.heroes)) {
        if (!o.alive) continue;
        const d = Math.hypot(o.h.x - b.x, o.h.y - b.y);
        if (oid === b.by && b.age < SAFE_OWN) continue;
        if (oid !== b.by && !enemies(b.by, oid)) continue;
        // Le bouclier : un peu plus grand que le bonhomme, il renvoie la balle là où on vise.
        if (t < o.shieldUntil && d < H.R + 18 + A.BULLET_R) {
          const a = o.aim;
          b.vx = Math.cos(a) * A.BULLET_V; b.vy = Math.sin(a) * A.BULLET_V;
          b.x = o.h.x + Math.cos(a) * (H.R + 20); b.y = o.h.y + Math.sin(a) * (H.R + 20);
          b.by = oid; b.left = A.BOUNCES; b.age = 0;
          o.shieldUntil = 0;
          addFx({ kind: "renvoi", x: Math.round(b.x), y: Math.round(b.y), who: oid });
          break;
        }
        if (d > H.R + A.BULLET_R) continue;
        g.bullets = g.bullets.filter((x) => x !== b);
        eliminate(oid, b.by);
        break;
      }
    }
  }

  g.__step = stepBullets;    // (pour les tests)

  // =================================================================
  //  BOTS : ils cherchent un tir direct ou en un rebond, et lèvent le bouclier quand ça arrive
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  function shotAt(from, foe) {
    // Plusieurs angles : celui dont le trajet passe le plus près de l'ennemi (sans revenir sur soi).
    let best = null, bd = 1e9;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, pts = A.trace(g.arena, from.x, from.y, a, 1, 1.1);
      for (let j = 1; j < pts.length; j++) {
        const p = pts[j - 1], q = pts[j];
        const s = { x1: p.x, y1: p.y, x2: q.x, y2: q.y }, c = A.closest(s, foe.x, foe.y), d = Math.hypot(c.x - foe.x, c.y - foe.y);
        if (d < bd) { bd = d; best = { a, d, bounce: j > 1 }; }
      }
    }
    return best;
  }
  function botInput(id, s) {
    const h = s.h, ai = s.ai, t = now();
    const foes = Object.entries(g.heroes).filter(([oid, o]) => o.alive && enemies(id, oid));
    if (!foes.length) return { k: 0, aim: null };
    foes.sort((a, b) => Math.hypot(a[1].h.x - h.x, a[1].h.y - h.y) - Math.hypot(b[1].h.x - h.x, b[1].h.y - h.y));
    const foe = foes[0][1].h;
    let k = 0, aim = s.aim;
    // Une balle arrive sur moi ? Bouclier (s'il est prêt), sinon esquive sur le côté.
    for (const b of g.bullets) {
      if (b.by === id && b.age < 0.5) continue;
      if (b.by !== id && !enemies(b.by, id)) continue;
      const rx = h.x - b.x, ry = h.y - b.y, sp = Math.hypot(b.vx, b.vy) || 1, along = (rx * b.vx + ry * b.vy) / sp, off = Math.abs(rx * b.vy - ry * b.vx) / sp;
      if (along > 0 && along < 170 && off < 34) {
        if (t >= s.shieldReady && Math.random() < 0.55) { k |= SHIELD; aim = Math.atan2(foe.y - h.y, foe.x - h.x); }
        else { const side = (rx * b.vy - ry * b.vx) > 0 ? 1 : -1; const a = Math.atan2(b.vy, b.vx) + side * Math.PI / 2; k |= KEYS[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8]; }
        return { k, aim };
      }
    }
    // Tirer : il cherche un angle de temps en temps, puis tire avec un peu d'imprécision.
    const hasBullet = !g.bullets.some((b) => b.by === id);
    if (hasBullet && t >= (ai.nextShot || 0)) {
      const sh = shotAt(h, { x: foe.x + foe.vx * 0.3, y: foe.y + foe.vy * 0.3 });
      ai.nextShot = t + 700 + Math.random() * 1100;
      if (sh && sh.d < 22) { aim = sh.a + (Math.random() - 0.5) * 0.16; k |= K.FIRE; ai.fired = t; }
    }
    // Bouger : il tourne autour de l'ennemi à distance moyenne, en évitant les murs.
    ai.orbit = ai.orbit || (Math.random() < 0.5 ? 1 : -1);
    if (Math.random() < 0.012) ai.orbit = -ai.orbit;
    const dist = Math.hypot(foe.x - h.x, foe.y - h.y);
    let a = Math.atan2(foe.y - h.y, foe.x - h.x) + (dist > 480 ? 0.4 * ai.orbit : dist < 260 ? Math.PI - 0.5 * ai.orbit : (Math.PI / 2) * ai.orbit);
    const blocked = (ang) => { const x = h.x + Math.cos(ang) * 40, y = h.y + Math.sin(ang) * 40; return x < 30 || y < 30 || x > A.W - 30 || y > A.H - 30 || g.arena.walls.some((w) => { const q = A.closest(w, x, y); return Math.hypot(q.x - x, q.y - y) < 20 + w.t / 2; }); };
    for (let i = 0; i < 6 && blocked(a); i++) a += ai.orbit * 0.7;
    // Le bord rétrécit : il revient vers le milieu.
    const m = shrinkAt(playMs());
    if (m > 0 && (h.x < A.W * m + 60 || h.x > A.W * (1 - m) - 60 || h.y < A.H * m + 60 || h.y > A.H * (1 - m) - 60)) a = Math.atan2(A.H / 2 - h.y, A.W / 2 - h.x);
    k |= KEYS[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
    if (!(k & K.FIRE) && !(k & SHIELD)) aim = Math.atan2(foe.y - h.y, foe.x - h.x);
    return { k, aim };
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    const dt = Math.min(0.1, (t - g.lastTickAt) / 1000);
    g.lastTickAt = t;
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) { g.phase = "play"; g.playAt = t; }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.heroes)) {
        if (!s.alive) continue;
        if (s.bot) { const b = botInput(id, s); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);
      }
      stepBullets(dt);
      // Le bord qui rétrécit élimine ceux qui y restent.
      const m = shrinkAt(t - g.playAt);
      if (m > 0) for (const [id, s] of Object.entries(g.heroes)) {
        if (s.alive && (s.h.x < A.W * m || s.h.x > A.W * (1 - m) || s.h.y < A.H * m || s.h.y > A.H * (1 - m))) eliminate(id, "zone");
      }
      if (!g.endAt && t - g.playAt > MAX_MS) g.endAt = t;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }
  function leave(id) { if (g.heroes[id]?.alive && ["countdown", "play"].includes(g.phase)) eliminate(id, null); }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![5, 8, 12].includes(s.rounds)) s.rounds = 8;
      if (!["auto", "solo", "equipes"].includes(s.mode)) s.mode = "auto";
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
    in(pid, { s, k, a }) {
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      const aim = typeof a === "number" && isFinite(a) ? a : null;
      if (aim !== null) st.aim = aim;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, k & 127, aim);
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
