// ===================================================================
//  LAMPE TORCHE — Moteur du jeu (module du hub Le Bordel)
//  Un manoir hanté plongé dans le noir. Les humains n'ont qu'une lampe
//  (qui se vide). Un fantôme invisible les chasse : chaque humain touché
//  devient fantôme à son tour (contagion). La lumière le révèle, et 2 s
//  de lumière d'affilée l'étourdissent. Tenir jusqu'au bout = gagner.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/lampe/manor.js";

const H = globalThis.Pieton;
const M = globalThis.Manoir;
const K = H.K;

export const meta = {
  id: "lampe",
  name: "Lampe torche",
  emoji: "👻",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Un manoir dans le noir, une lampe qui se vide… et un fantôme invisible qui contamine tout le monde.",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
export const WAKE_MS = 3000;          // le fantôme se réveille 3 s après le départ
export const GHOST_SPEED = 1;         // aussi rapide que les humains...
export const LIT_SLOW = 0.55;         // ... mais ralenti dans la lumière
export const LIGHT_STUN = 1.5;        // 1,5 s de lumière d'affilée = étourdi
export const STUN_MS = 2500;          // étourdi : il ne bouge plus, il recule
export const IMMUNE_MS = 2000;        // puis insensible à la lumière un moment
export const CONVERT_FREEZE = 1500;   // un nouveau fantôme est figé 1,5 s
export const DRAIN = 1 / 25;          // batterie vidée en 25 s de lampe allumée
export const PILE = 0.45;             // une pile ramassée
const PILE_RESPAWN = 8000;
export const TOUCH = H.R * 2 + 2;     // distance pour toucher un humain
export const GHOST_SIGHT = 420;       // vision de nuit du fantôme (les lampes allumées se voient de partout)
export const PER_15S = 1, SURVIVE_BONUS = 3, CATCH = 2;
const END_DELAY = 1500;
const ROUND_OVER_MS = 6000;
const FINISH_DELAY = 15000;

function defaultSettings() {
  return { rounds: 3, duration: 90 };
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
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    round: 0,
    manor: null,
    heroes: {},           // id -> { h, ghost, lamp, bat, litT, dazedUntil, immuneUntil, frozenUntil, caughtAt, catches, bot, seq, lastInputAt, ai, prevK, aim }
    firstGhosts: [],      // ceux qui ont déjà commencé fantôme
    startGhost: null,
    piles: [],            // { id, x, y, back (réapparition) }
    pileId: 0,
    feed: [],
    playAt: 0,
    timeUpAt: 0,
    endAt: 0,
    phaseEnd: 0,
    lastRound: null,
    loop: null,
    lastTickAt: 0,
    fields: {}, fieldsAt: 0, ghostField: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const humans = () => Object.keys(g.heroes).filter((id) => !g.heroes[id].ghost);
  const ghosts = () => Object.keys(g.heroes).filter((id) => g.heroes[id].ghost);
  const durationMs = () => g.settings.duration * 1000;
  const envOf = (s) => ({ walls: true, w: g.manor.w, h: g.manor.h, rects: g.manor.rects, push: !s.ghost, noDash: true, speedMul: s.ghost ? GHOST_SPEED * (s.seen && now() >= s.immuneUntil ? LIT_SLOW : 1) : 1 });

  // =================================================================
  //  ÉTAT PUBLIC (30 fois/s) — le manoir n'est pas envoyé : juste sa seed.
  // =================================================================
  function publicState() {
    const t = now();
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      round: g.round,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      manor: g.manor && { seed: g.manor.seed, n: g.manor.nPlayers },
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, ghost: s.ghost, lamp: s.lamp && s.bat > 0, bat: Math.round(s.bat * 100) / 100,
        seen: !!s.seen, dazed: t < s.dazedUntil, frozen: t < s.frozenUntil, immune: t < s.immuneUntil, lit: Math.round(Math.min(1, s.litT / LIGHT_STUN) * 100) / 100,
        aim: s.aim ?? s.h.face,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: s.h.dash, dashT: 0, pushT: s.h.pushT, heavy: 0,
      })),
      piles: g.piles.filter((p) => !p.back).map(({ id, x, y }) => ({ id, x, y })),
      startGhost: g.startGhost,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.phase === "countdown" ? durationMs() : 0,
      wakeIn: g.phase === "play" ? Math.max(0, g.playAt + WAKE_MS - t) : WAKE_MS,
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 500).map(({ id, x, y, kind }) => ({ id, x, y, kind })),
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
    g.firstGhosts = [];
    for (const p of players().filter((p) => p.connected)) g.scores[p.id] = 0;
    startRound();
  }

  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    g.manor = M.build(Math.floor(Math.random() * 1e9), list.length);
    g.manor.nPlayers = list.length;
    const nav = g.manor.nav;
    // Le fantôme de départ : quelqu'un qui ne l'a pas encore été.
    let cand = list.filter((p) => !g.firstGhosts.includes(p.id));
    if (!cand.length) { g.firstGhosts = []; cand = list; }
    const ghostId = pick(cand).id;
    g.firstGhosts.push(ghostId);
    g.startGhost = ghostId;
    // Les humains : chacun dans une pièce différente ; le fantôme dans la pièce la plus loin d'eux.
    const roomSpot = (r) => M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, r.x + r.w / 2 + rand(-40, 40), r.y + r.h / 2 + rand(-30, 30))));
    const rooms = shuffle(g.manor.rooms);
    const spots = [];
    const humansList = list.filter((p) => p.id !== ghostId);
    humansList.forEach((p, i) => spots.push({ id: p.id, ...roomSpot(rooms[i % rooms.length]) }));
    const humanCells = spots.map((s) => M.cellOf(nav, s.x, s.y));
    const d = M.field(nav, humanCells);
    let far = rooms[0], fd = -1;
    for (const r of g.manor.rooms) {
      const p = roomSpot(r), dd = d[M.cellOf(nav, p.x, p.y)];
      if (dd > fd) { fd = dd; far = r; }
    }
    spots.push({ id: ghostId, ...roomSpot(far) });
    g.heroes = {};
    for (const sp of spots) {
      const p = list.find((x) => x.id === sp.id);
      const ghost = sp.id === ghostId;
      g.heroes[sp.id] = {
        h: H.newHero(sp.x, sp.y, rand(-Math.PI, Math.PI)), ghost, lamp: !ghost, bat: 1, litT: 0, seen: false,
        dazedUntil: 0, immuneUntil: 0, frozenUntil: 0, caughtAt: 0, catches: 0,
        bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, prevK: 0, aim: null,
      };
      g.scores[sp.id] = g.scores[sp.id] || 0;
    }
    // Les piles, éparpillées.
    g.piles = [];
    const nPiles = list.length + 2;
    for (let k = 0; k < nPiles; k++) g.piles.push({ id: ++g.pileId, ...pileSpot(), back: 0 });
    g.feed = [];
    g.fx = [];
    g.fields = {}; g.fieldsAt = 0; g.ghostField = null;
    g.endAt = 0;
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    say(`👻 ${pseudo(ghostId)} est le fantôme !`);
    startLoop();
  }

  function pileSpot() {
    const nav = g.manor.nav;
    let best = null, bd = -1;
    for (let k = 0; k < 30; k++) {
      const c = Math.floor(Math.random() * nav.free.length);
      if (!nav.free[c]) continue;
      const p = M.centerOf(nav, c);
      const dd = Math.min(1e9, ...g.piles.filter((q) => !q.back).map((q) => dist(q, p)));
      if (dd > bd) { bd = dd; best = p; }
    }
    return best || { x: g.manor.w / 2, y: g.manor.h / 2 };
  }

  function say(text) {
    g.feed.push({ id: ++g.fxId, text });
    if (g.feed.length > 10) g.feed.shift();
  }
  function addFx(x, y, kind) {
    g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(x), y: Math.round(y), kind });
    if (g.fx.length > 40) g.fx.shift();
  }

  // Un humain touché devient fantôme (et celui qui l'a touché marque des points).
  function convert(id, by) {
    const s = g.heroes[id], t = now();
    s.ghost = true;
    s.lamp = false;
    s.caughtAt = t;
    s.frozenUntil = t + CONVERT_FREEZE;
    s.litT = 0;
    if (by && g.heroes[by]) g.heroes[by].catches++;
    addFx(s.h.x, s.h.y, "catch");
    say(by ? `👻 ${pseudo(by)} a attrapé ${pseudo(id)} !` : `👻 ${pseudo(id)} est devenu un fantôme`);
    if (humans().length === 0 && !g.endAt) g.endAt = t + END_DELAY;
  }

  function endRound() {
    stopLoop();
    const gains = {};
    const survivors = humans();
    const timePts = (ms) => Math.floor(Math.min(ms, durationMs()) / 15000) * PER_15S;
    for (const [id, s] of Object.entries(g.heroes)) {
      let n = s.catches * CATCH;
      if (id !== g.startGhost) n += s.ghost ? timePts(s.caughtAt - g.playAt) : timePts(durationMs()) + SURVIVE_BONUS;
      gains[id] = n;
    }
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = {
      gains, survivors, startGhost: g.startGhost,
      caught: Object.fromEntries(Object.entries(g.heroes).filter(([id, s]) => s.ghost && id !== g.startGhost).map(([id, s]) => [id, s.caughtAt - g.playAt])),
      catches: Object.fromEntries(Object.entries(g.heroes).map(([id, s]) => [id, s.catches])),
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
  //  UN JOUEUR AGIT : marcher, viser la lampe, l'allumer/éteindre, pousser
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    // Figé (fantôme pas encore réveillé, ou tout juste transformé) ou étourdi : on ne bouge plus.
    const still = t < s.frozenUntil || t < s.dazedUntil;
    const move = still ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH);
    // Clic = allumer / éteindre la lampe.
    if (!s.ghost && g.phase === "play" && (k & K.FIRE) && !(s.prevK & K.FIRE)) s.lamp = !s.lamp;
    s.prevK = k;
    const env = envOf(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, move, s.ghost ? null : s.aim, dt, env);
      // Poussée (humains seulement) : repousse ce qui est juste devant, fantômes compris.
      if (s.h.pushed) {
        s.h.pushed = false;
        const others = Object.entries(g.heroes).filter(([oid]) => oid !== id).map(([, o]) => o.h);
        for (const hh of H.applyPush(s.h, others)) addFx((s.h.x + hh.x) / 2, (s.h.y + hh.y) / 2, "push");
      }
      H.collideWalls(s.h, env);
      // Les humains se bousculent entre eux ; les fantômes traversent tout le monde.
      if (!s.ghost) for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && !o.ghost) H.collideHeroes(s.h, o.h);
    }
  }

  // =================================================================
  //  LUMIÈRE, CONTACTS, BATTERIES, PILES
  // =================================================================
  function stepWorld(dt) {
    const t = now();
    const lamps = humans().map((id) => g.heroes[id]).filter((s) => s.lamp && s.bat > 0);
    // Batteries.
    for (const id of humans()) {
      const s = g.heroes[id];
      if (s.lamp) { s.bat = Math.max(0, s.bat - DRAIN * dt); if (s.bat <= 0) s.lamp = false; }
    }
    // Les fantômes dans la lumière.
    for (const id of ghosts()) {
      const s = g.heroes[id];
      let by = null;
      for (const L of lamps) if (M.inCone(g.manor, L.h.x, L.h.y, L.aim ?? L.h.face, s.h.x, s.h.y, 12)) { by = L; break; }
      s.seen = !!by;
      const sleeping = t < s.frozenUntil;
      if (by && t >= s.immuneUntil && t >= s.dazedUntil && !sleeping) {
        s.litT += dt;
        if (s.litT >= LIGHT_STUN) {
          // Étourdi : il recule, ne bouge plus, puis devient insensible un moment.
          s.litT = 0;
          s.dazedUntil = t + STUN_MS;
          s.immuneUntil = t + STUN_MS + IMMUNE_MS;
          const d = Math.max(1, dist(s.h, by.h));
          s.h.vx = ((s.h.x - by.h.x) / d) * 420; s.h.vy = ((s.h.y - by.h.y) / d) * 420; s.h.stun = 0.5;
          addFx(s.h.x, s.h.y, "daze");
          say(`💡 Un fantôme est étourdi !`);
        }
      } else s.litT = Math.max(0, s.litT - dt);
    }
    // Contacts : un fantôme réveillé touche un humain = contagion.
    for (const gid of ghosts()) {
      const G = g.heroes[gid];
      if (t < G.frozenUntil || t < G.dazedUntil) continue;
      for (const hid of humans()) {
        if (dist(G.h, g.heroes[hid].h) < TOUCH) convert(hid, gid);
      }
    }
    // Piles : ramassées par les humains, elles réapparaissent ailleurs.
    for (const p of g.piles) {
      if (p.back) { if (t >= p.back) Object.assign(p, pileSpot(), { back: 0, id: ++g.pileId }); continue; }
      for (const id of humans()) {
        const s = g.heroes[id];
        if (dist(s.h, p) < H.R + 14 && s.bat < 0.98) {
          s.bat = Math.min(1, s.bat + PILE);
          p.back = t + PILE_RESPAWN;
          addFx(p.x, p.y, "pile");
          break;
        }
      }
    }
  }

  // =================================================================
  //  BOTS
  // =================================================================
  const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
  const keyToward = (h, p) => {
    if (Math.hypot(p.x - h.x, p.y - h.y) < 6) return 0;
    const ang = Math.atan2(p.y - h.y, p.x - h.x);
    return KEYS[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  };
  function updateFields(t) {
    if (t - g.fieldsAt < 300) return;
    g.fieldsAt = t;
    const nav = g.manor.nav;
    g.fields = {};
    for (const id of humans()) { const h = g.heroes[id].h; g.fields[id] = M.field(nav, [M.nearestFree(nav, M.cellOf(nav, h.x, h.y))]); }
    const gs = ghosts().map((id) => g.heroes[id].h);
    g.ghostField = gs.length ? M.field(nav, gs.map((h) => M.nearestFree(nav, M.cellOf(nav, h.x, h.y)))) : null;
  }

  // Un humain bot : il « sent » les fantômes proches (ou éclairés), fuit, braque sa lampe dessus, ramasse des piles.
  function humanBot(id, s) {
    const h = s.h, ai = s.ai, nav = g.manor.nav, t = now();
    let threat = null, td = 1e9;
    for (const gid of ghosts()) {
      const G = g.heroes[gid], d = dist(G.h, h);
      const known = G.seen || d < 230;
      if (known && d < td && t >= G.frozenUntil) { td = d; threat = G; }
    }
    let k = 0, aim = ai.aim ?? h.face;
    // La lampe : sur le fantôme s'il est là ; éteinte pour économiser si la batterie est basse et qu'il n'y a personne.
    // (sans menace : allumée de temps en temps seulement, pour ne pas se faire repérer de loin)
    if (!ai.lampAt || t > ai.lampAt) { ai.lampAt = t + rand(3000, 7000); ai.lampPref = Math.random() < 0.4; }
    let want = threat ? s.bat > 0.02 : ai.lampPref && s.bat > 0.3;
    if (threat) aim = Math.atan2(threat.h.y - h.y, threat.h.x - h.x) + (Math.random() - 0.5) * 0.15;
    if (want !== s.lamp && !(s.prevK & K.FIRE)) k |= K.FIRE;
    // Où aller : fuir (si menacé), une pile (si batterie basse), sinon se balader de pièce en pièce.
    ai.think = (ai.think || 0) - H.TICK;
    if (threat && td < 170 && !ai.panic) ai.think = 0;
    if (ai.think <= 0 || (ai.goal && dist(ai.goal, h) < 24)) {
      ai.think = 1.2 + Math.random() * 1.2;
      ai.panic = !!threat && td < 170;
      let goal = null;
      const pile = g.piles.filter((p) => !p.back).sort((a, b) => dist(a, h) - dist(b, h))[0];
      if (!threat && s.bat < 0.45 && pile && dist(pile, h) < 700) goal = pile;
      else {
        let best = -1e9;
        for (let n = 0; n < 24; n++) {
          const c = Math.floor(Math.random() * nav.free.length);
          if (!nav.free[c]) continue;
          const p = M.centerOf(nav, c);
          const danger = g.ghostField && g.ghostField[c] >= 0 ? g.ghostField[c] : 40;
          const sc = (threat ? danger * 3 : danger) - dist(p, h) / M.NAV * 0.4 + rand(0, 8);
          if (sc > best) { best = sc; goal = p; }
        }
      }
      ai.goal = goal;
      ai.goalField = goal ? M.field(nav, [M.nearestFree(nav, M.cellOf(nav, goal.x, goal.y))]) : null;
    }
    if (threat && td < 260 && g.ghostField) k |= keyToward(h, awayFrom(h));   // il est tout près : on s'éloigne au plus vite
    else if (ai.goalField) k |= keyToward(h, M.lookAhead(nav, ai.goalField, h.x, h.y, 2));
    if (!threat) aim = Math.hypot(h.vx, h.vy) > 40 ? Math.atan2(h.vy, h.vx) : aim;
    // Poussée si le fantôme est collé devant.
    if (threat && td < 46) k |= K.DASH;
    ai.aim = aim;
    return { k, aim };
  }

  // Le point où aller pour s'éloigner des fantômes (on monte le champ de distance).
  function awayFrom(h) {
    const nav = g.manor.nav, f = g.ghostField;
    let c = M.nearestFree(nav, M.cellOf(nav, h.x, h.y));
    for (let k = 0; k < 3; k++) {
      const q = c % nav.cols;
      let best = c, bd = f[c];
      for (const n of [q > 0 ? c - 1 : -1, q < nav.cols - 1 ? c + 1 : -1, c - nav.cols, c + nav.cols, c - nav.cols - 1, c - nav.cols + 1, c + nav.cols - 1, c + nav.cols + 1]) {
        if (n < 0 || n >= f.length || !nav.free[n] || f[n] < 0) continue;
        if (f[n] > bd) { bd = f[n]; best = n; }
      }
      if (best === c) break;
      c = best;
    }
    return M.centerOf(nav, c);
  }

  // Un fantôme bot : il voit dans le noir, mais repère surtout les lampes allumées.
  function ghostBot(id, s) {
    const h = s.h, ai = s.ai, nav = g.manor.nav;
    let target = null, best = 1e9;
    for (const hid of humans()) {
      const o = g.heroes[hid], f = g.fields[hid];
      if (!f) continue;
      const c = M.nearestFree(nav, M.cellOf(nav, h.x, h.y));
      const d = f[c] < 0 ? 1e6 : f[c];
      // Comme un vrai joueur fantôme : il voit les lampes allumées de partout, et les autres humains seulement de près.
      if (!((o.lamp && o.bat > 0) || dist(o.h, h) < GHOST_SIGHT)) continue;
      const score = d;
      if (score < best) { best = score; target = hid; }
    }
    if (!target) {
      // Personne en vue : il rôde de pièce en pièce.
      if (!ai.roam || dist(ai.roam, h) < 30 || Math.random() < 0.003) {
        const r = pick(g.manor.rooms);
        ai.roam = M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, r.x + r.w / 2, r.y + r.h / 2)));
        ai.roamField = M.field(nav, [M.cellOf(nav, ai.roam.x, ai.roam.y)]);
      }
      return { k: keyToward(h, M.lookAhead(nav, ai.roamField, h.x, h.y, 2)), aim: null };
    }
    const o = g.heroes[target];
    const goal = dist(o.h, h) < 70 ? o.h : M.lookAhead(nav, g.fields[target], h.x, h.y, 2);
    // Un peu de flottement (sinon c'est trop parfait).
    ai.wob = (ai.wob || 0) + H.TICK;
    let k = keyToward(h, goal);
    if (Math.sin(ai.wob * 1.3 + id.length) > 0.93) k = 0;
    return { k, aim: null };
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
        g.timeUpAt = t + durationMs();
        g.heroes[g.startGhost].frozenUntil = t + WAKE_MS;
      }
    } else if (g.phase === "play") {
      updateFields(t);
      for (const [id, s] of Object.entries(g.heroes)) {
        if (s.bot) { const b = s.ghost ? ghostBot(id, s) : humanBot(id, s); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);   // onglet en pause : on ne bouge plus
      }
      if (!g.endAt) stepWorld(dt);
      if (!g.endAt && t >= g.timeUpAt) g.endAt = t + END_DELAY;
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    if (!g.heroes[id] || !["countdown", "play"].includes(g.phase)) return;
    delete g.heroes[id];
    if (g.phase === "play" && (humans().length === 0 || ghosts().length === 0) && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5, 8].includes(s.rounds)) s.rounds = 3;
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
    // Touches + visée : { s, k, a (angle de la lampe) }
    in(pid, { s, k, a }) {
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (typeof a === "number" && isFinite(a)) st.aim = a;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, k & 63, st.aim);
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
