// ===================================================================
//  BOULES DE NEIGE — Moteur du jeu (module du hub Le Bordel)
//  Bataille de boules de neige vue de dessus : on vise à la souris,
//  on maintient le clic pour charger, on fabrique ses boules (clic droit)
//  et on se cache derrière des murets qui fondent. 3 cœurs = 3 touches.
//  Dernier debout (ou dernière équipe) = gagnant de la manche.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";

const H = globalThis.Pieton;
const K = H.K;
export const MAKE = 64;              // touche « fabriquer une boule » (clic droit / R)

export const meta = {
  id: "neige",
  name: "Boules de neige",
  emoji: "❄️",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Charge, vise, lance… et cache-toi derrière les murets avant qu'ils fondent !",
};

const TICK_MS = 1000 / 30;
export const W = 1280, HGT = 800;
export const HEARTS = 3, MAX_BALLS = 3;
export const MAKE_S = 1;             // fabriquer une boule (immobile)
export const CHARGE_S = 1;           // charge complète
export const BALL_R = 7;
export const speedOf = (c) => 520 + 480 * c;   // vitesse d'une boule selon la charge (0 à 1)
export const rangeOf = (c) => 230 + 400 * c;   // portée
const INVULN_MS = 600;               // invincible juste après une touche
const WALL_HP = 4;
const COUNTDOWN_MS = 3000;
const SUDDEN_MS = 75000;             // mort subite : tout le monde à 1 cœur
const END_DELAY = 1500;
const ROUND_OVER_MS = 6000;
const FINISH_DELAY = 15000;
const TEAMS = { 1: { name: "Rouges", emoji: "🔴", color: "#ff4d5a" }, 2: { name: "Bleus", emoji: "🔵", color: "#3a8bff" } };

function defaultSettings() {
  return { rounds: 5, mode: "auto" };   // mode : auto (alterné, équipes dès 4 joueurs en nombre pair) · solo · equipes
}

export const playlist = {
  options: [
    {
      key: "mode", label: "Mode", default: "auto",
      choices: [{ v: "auto", label: "🔁 Alterné", hint: "Une manche en équipes, une manche chacun pour soi" }, { v: "solo", label: "⛄ Chacun pour soi" }, { v: "equipes", label: "🔴🔵 2 équipes" }],
    },
    {
      key: "rounds", label: "Manches", default: "5",
      choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }, { v: "8", label: "8" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), mode: ["auto", "solo", "equipes"].includes(c.mode) ? c.mode : "auto", rounds: [3, 5, 8].includes(Number(c.rounds)) ? Number(c.rounds) : 5 };
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Un muret qui fond : il rétrécit autour de son centre selon ses points de vie.
export function wallRect(w) {
  const f = 0.35 + 0.65 * (w.hp / WALL_HP);
  const cw = w.w * f, ch = w.h * f;
  return { x: w.x + (w.w - cw) / 2, y: w.y + (w.h - ch) / 2, w: cw, h: ch };
}

// Le segment (x0,y0)-(x1,y1) traverse-t-il ce rectangle ? (pour les bots : « je le vois ? »)
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
    scores: {},
    round: 0,
    teamsMode: false,
    teamOf: {},           // id -> 1 / 2 (équipes) ; en chacun pour soi : pas d'équipe
    walls: [],            // { id, x, y, w, h, hp }
    heroes: {},           // id -> { h, alive, hearts, balls, make, charging, invulnUntil, bot, seq, lastInputAt, ai, prevK, elims }
    balls: [],            // { id, by, team, x, y, vx, vy, left }
    ballId: 0,
    order: [],            // ordre d'élimination
    lastHitBy: {},
    feed: [],
    playAt: 0,
    sudden: false,
    endAt: 0,
    phaseEnd: 0,
    lastRound: null,
    loop: null,
    lastTickAt: 0,
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
  const sideOf = (id) => (g.teamsMode ? g.teamOf[id] : id);
  const enemies = (a, b) => a !== b && (!g.teamsMode || g.teamOf[a] !== g.teamOf[b]);
  const rects = () => g.walls.map(wallRect);
  const ENV = () => ({ walls: true, w: W, h: HGT, rects: rects(), noDash: true });

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
      teamsMode: g.teamsMode,
      teamOf: g.teamOf,
      teams: TEAMS,
      walls: g.walls.map((w) => ({ id: w.id, x: w.x, y: w.y, w: w.w, h: w.h, hp: w.hp })),
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, alive: s.alive, hearts: s.hearts, balls: s.balls,
        make: Math.round(s.make * 100) / 100, charge: s.charging ? Math.min(1, (t - s.charging) / (CHARGE_S * 1000)) : 0,
        hurt: t < s.invulnUntil,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: 0, dashT: 0, pushT: 0, heavy: 0,
      })),
      balls: g.balls.map((b) => ({ id: b.id, x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy), team: b.team })),
      sudden: g.sudden,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 400).map(({ id, x, y, kind }) => ({ id, x, y, kind })),
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
    const list = shuffle(players().filter((p) => p.connected));
    const n = list.length;
    g.round++;
    g.teamsMode = g.settings.mode === "equipes" || (g.settings.mode === "auto" && n >= 4 && n % 2 === 0 && g.round % 2 === 0);
    g.teamOf = {};
    if (g.teamsMode) list.forEach((p, i) => { g.teamOf[p.id] = (i % 2) + 1; });
    // Départs : en équipes, chacune de son côté ; sinon en cercle.
    const spots = list.map((p, i) => {
      if (g.teamsMode) {
        const tm = g.teamOf[p.id], k = Math.floor(i / 2), cnt = Math.ceil(n / 2);
        const x = tm === 1 ? 120 : W - 120, y = HGT * ((k + 1) / (cnt + 1));
        return { x, y, a: tm === 1 ? 0 : Math.PI };
      }
      const t = (i / n) * Math.PI * 2 + Math.PI / 4;
      const x = W / 2 + Math.cos(t) * (W / 2 - 130), y = HGT / 2 + Math.sin(t) * (HGT / 2 - 110);
      return { x, y, a: Math.atan2(HGT / 2 - y, W / 2 - x) };
    });
    // Les murets (loin des départs, pas collés entre eux).
    g.walls = [];
    const want = Math.floor(rand(6, 10));
    for (let tries = 0; tries < 300 && g.walls.length < want; tries++) {
      const horiz = Math.random() < 0.5;
      const w = horiz ? rand(110, 190) : rand(34, 44), h = horiz ? rand(34, 44) : rand(110, 190);
      const o = { x: rand(150, W - 150 - w), y: rand(90, HGT - 90 - h), w, h };
      if (g.walls.some((p) => o.x < p.x + p.w + 70 && o.x + o.w + 70 > p.x && o.y < p.y + p.h + 70 && o.y + o.h + 70 > p.y)) continue;
      if (spots.some((s) => s.x > o.x - 80 && s.x < o.x + o.w + 80 && s.y > o.y - 80 && s.y < o.y + o.h + 80)) continue;
      g.walls.push({ id: g.walls.length + 1, ...o, hp: WALL_HP });
    }
    g.heroes = {};
    list.forEach((p, i) => {
      const sp = spots[i];
      g.heroes[p.id] = { h: H.newHero(sp.x, sp.y, sp.a), alive: true, hearts: HEARTS, balls: MAX_BALLS, make: 0, charging: 0, invulnUntil: 0, bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, prevK: 0, elims: 0 };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.balls = [];
    g.order = [];
    g.lastHitBy = {};
    g.feed = [];
    g.fx = [];
    g.sudden = false;
    g.endAt = 0;
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    startLoop();
  }

  function say(text) {
    g.feed.push({ id: ++g.fxId, text });
    if (g.feed.length > 10) g.feed.shift();
  }

  function eliminate(id) {
    const s = g.heroes[id];
    if (!s?.alive) return;
    s.alive = false;
    s.charging = 0;
    g.order.push(id);
    const by = g.lastHitBy[id];
    if (by && g.heroes[by]) { g.heroes[by].elims++; say(`❄️ ${pseudo(by)} a éliminé ${pseudo(id)} !`); }
    else say(`☃️ ${pseudo(id)} est éliminé`);
    const sides = new Set(alive().map(sideOf));
    if (sides.size <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // Points : chacun pour soi = 1 par joueur éliminé avant toi ; équipes = 3 pour l'équipe gagnante.
  // + 1 par élimination faite dans les deux cas.
  function endRound() {
    stopLoop();
    const gains = {};
    const ids = Object.keys(g.heroes);
    const winners = alive();
    if (g.teamsMode) {
      const winTeam = winners.length ? g.teamOf[winners[0]] : null;
      for (const id of ids) gains[id] = (winTeam && g.teamOf[id] === winTeam ? 3 : 0) + g.heroes[id].elims;
    } else {
      [...g.order, ...winners].forEach((id, i) => { gains[id] = i + g.heroes[id].elims; });
    }
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    const winTeam = g.teamsMode && winners.length ? g.teamOf[winners[0]] : null;
    g.lastRound = {
      gains, winner: g.teamsMode ? null : winners[0] || g.order[g.order.length - 1] || null, winTeam,
      order: [...winners, ...g.order.slice().reverse()], elims: Object.fromEntries(ids.map((id) => [id, g.heroes[id].elims])),
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
  //  UN JOUEUR AGIT : marcher, charger / lancer, fabriquer une boule
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s.alive) return;
    const t = now();
    const making = g.phase === "play" && (k & MAKE) && s.balls < MAX_BALLS;
    // Fabriquer une boule : on se baisse, on ne bouge plus.
    if (making) { s.make += H.TICK; s.charging = 0; if (s.make >= MAKE_S) { s.balls++; s.make = 0; } }
    else s.make = 0;
    const move = making ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT);
    const env = ENV(), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, move, aim, dt, env);
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && o.alive) H.collideHeroes(s.h, o.h);
    }
    if (g.phase !== "play") { s.prevK = k; return; }
    // Charger : on maintient le clic. On lâche : la boule part (plus elle était chargée, plus loin et plus vite).
    const fire = !making && (k & K.FIRE);
    if (fire && !s.charging && s.balls > 0) s.charging = t;
    if (!fire && s.charging) {
      const c = Math.min(1, (t - s.charging) / (CHARGE_S * 1000));
      s.charging = 0;
      throwBall(id, s, aim ?? s.h.face, c);
    }
    s.prevK = k;
  }

  function throwBall(id, s, angle, c) {
    if (s.balls <= 0) return;
    s.balls--;
    const sp = speedOf(c);
    const x = s.h.x + Math.cos(angle) * (H.R + BALL_R + 2), y = s.h.y + Math.sin(angle) * (H.R + BALL_R + 2);
    g.balls.push({ id: ++g.ballId, by: id, team: g.teamOf[id] || 0, x, y, vx: Math.cos(angle) * sp, vy: Math.sin(angle) * sp, left: rangeOf(c) });
  }

  // Les boules volent : murets (qui fondent), joueurs (un cœur de moins), portée.
  function stepBalls(dt) {
    const t = now();
    const SUB = 3, d = dt / SUB;
    for (const b of [...g.balls]) {
      let gone = false;
      for (let i = 0; i < SUB && !gone; i++) {
        b.x += b.vx * d; b.y += b.vy * d;
        b.left -= Math.hypot(b.vx, b.vy) * d;
        if (b.left <= 0 || b.x < 0 || b.y < 0 || b.x > W || b.y > HGT) { addFx(b.x, b.y, "puff"); gone = true; break; }
        for (const w of g.walls) {
          const r = wallRect(w);
          if (b.x > r.x - BALL_R && b.x < r.x + r.w + BALL_R && b.y > r.y - BALL_R && b.y < r.y + r.h + BALL_R) {
            w.hp--;
            addFx(b.x, b.y, "wall");
            gone = true;
            break;
          }
        }
        if (gone) break;
        for (const [oid, o] of Object.entries(g.heroes)) {
          if (!o.alive || oid === b.by || !enemies(b.by, oid)) continue;
          if (Math.hypot(o.h.x - b.x, o.h.y - b.y) > H.R + BALL_R) continue;
          gone = true;
          addFx(b.x, b.y, "hit");
          if (t < o.invulnUntil) break;
          o.hearts--;
          o.invulnUntil = t + INVULN_MS;
          g.lastHitBy[oid] = b.by;
          const sp = Math.hypot(b.vx, b.vy) || 1;
          o.h.vx += (b.vx / sp) * 220; o.h.vy += (b.vy / sp) * 220; o.h.stun = 0.2;
          if (o.hearts <= 0) eliminate(oid);
          break;
        }
      }
      if (gone) g.balls = g.balls.filter((x) => x !== b);
    }
    g.walls = g.walls.filter((w) => w.hp > 0);
  }

  function addFx(x, y, kind) {
    g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(x), y: Math.round(y), kind });
    if (g.fx.length > 40) g.fx.shift();
  }

  // =================================================================
  //  BOTS : ils visent un peu devant leur cible, rechargent à l'abri
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const seeClear = (a, b) => !rects().some((r) => segHitsRect(a.x, a.y, b.x, b.y, r));
  const blocked = (x, y) => x < 30 || y < 30 || x > W - 30 || y > HGT - 30 || rects().some((r) => x > r.x - 22 && x < r.x + r.w + 22 && y > r.y - 22 && y < r.y + r.h + 22);

  function botInput(id, s) {
    const h = s.h, ai = s.ai, t = now();
    // La cible : l'ennemi le plus proche (de préférence visible).
    let foe = null, bestD = 1e9;
    for (const [oid, o] of Object.entries(g.heroes)) {
      if (!o.alive || !enemies(id, oid)) continue;
      const d = Math.hypot(o.h.x - h.x, o.h.y - h.y) * (seeClear(h, o.h) ? 1 : 1.6);
      if (d < bestD) { bestD = d; foe = o; }
    }
    if (!foe) return { k: 0, aim: null };
    const dist = Math.hypot(foe.h.x - h.x, foe.h.y - h.y);
    const sees = seeClear(h, foe.h);
    // Plus de boules : on se cache (derrière le muret le plus proche, côté opposé à l'ennemi) et on recharge.
    if (s.balls === 0 || (s.balls < MAX_BALLS && !sees && dist > 350)) {
      let hide = null, hb = 1e9;
      for (const r of rects()) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, a = Math.atan2(cy - foe.h.y, cx - foe.h.x);
        const px = cx + Math.cos(a) * (Math.max(r.w, r.h) / 2 + 26), py = cy + Math.sin(a) * (Math.max(r.w, r.h) / 2 + 26);
        const dd = Math.hypot(px - h.x, py - h.y);
        if (dd < hb && !blocked(px, py)) { hb = dd; hide = { x: px, y: py }; }
      }
      if (!hide || hb < 24 || !sees) return { k: MAKE, aim: null };   // à l'abri (ou rien pour se cacher) : on fabrique
      return { k: steer(h, ai, hide), aim: null };
    }
    // Visée : un peu devant l'ennemi (selon sa vitesse et le temps de vol).
    const c = Math.max(0.15, Math.min(1, (dist - 200) / 400));
    const tof = dist / speedOf(c);
    const tx = foe.h.x + foe.h.vx * tof * 0.8, ty = foe.h.y + foe.h.vy * tof * 0.8;
    const aim = Math.atan2(ty - h.y, tx - h.x) + (Math.random() - 0.5) * 0.12;
    // Déplacement : on garde une distance moyenne en tournant autour.
    ai.orbit = ai.orbit || (Math.random() < 0.5 ? 1 : -1);
    if (Math.random() < 0.01) ai.orbit = -ai.orbit;
    const want = dist > 420 ? 0 : dist < 230 ? Math.PI : Math.PI / 2 * ai.orbit;
    const base = Math.atan2(foe.h.y - h.y, foe.h.x - h.x) + want;
    let k = steer(h, ai, { x: h.x + Math.cos(base) * 80, y: h.y + Math.sin(base) * 80 });
    // Lancer : on charge selon la distance, puis on lâche.
    if (sees && dist < rangeOf(1) + 20) {
      if (!ai.chargeUntil) ai.chargeUntil = t + c * CHARGE_S * 1000 + rand(0, 120);
      if (t < ai.chargeUntil) k |= K.FIRE;
      else ai.chargeUntil = 0;   // on lâche (le clic n'est plus maintenu)
    } else if (s.charging) {
      ai.chargeUntil = 0;        // plus de cible : on lâche quand même
    }
    return { k, aim };
  }

  function steer(h, ai, goal) {
    let ang = Math.atan2(goal.y - h.y, goal.x - h.x);
    if (blocked(h.x + Math.cos(ang) * 36, h.y + Math.sin(ang) * 36)) {
      ai.side = ai.side || (Math.random() < 0.5 ? 1 : -1);
      ang += ai.side * 1.3;
      if (blocked(h.x + Math.cos(ang) * 36, h.y + Math.sin(ang) * 36)) { ai.side = -ai.side; ang -= ai.side * 2.6; }
    }
    if (Math.hypot(goal.x - h.x, goal.y - h.y) < 12) return 0;
    return KEYS[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
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
        else if (t - s.lastInputAt > 200) act(id, s.prevK & (K.FIRE | MAKE), s.aim ?? null);   // onglet en pause : on ne bouge plus
      }
      stepBalls(dt);
      if (!g.sudden && t - g.playAt > SUDDEN_MS) {
        g.sudden = true;
        for (const s of Object.values(g.heroes)) if (s.alive) s.hearts = Math.min(s.hearts, 1);
        say("⚠️ MORT SUBITE : tout le monde à 1 cœur !");
      }
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    const s = g.heroes[id];
    if (s?.alive && ["countdown", "play"].includes(g.phase)) eliminate(id);
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5, 8].includes(s.rounds)) s.rounds = 5;
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
      st.aim = typeof a === "number" && isFinite(a) ? a : null;
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
