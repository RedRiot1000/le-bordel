// ===================================================================
//  CAMBRIOLEURS — Moteur du jeu (module du hub Le Bordel)
//  Tout le monde cambriole le même manoir, chacun pour soi : on ramasse un
//  objet, on le ramène au van, sur le parking. Plus il vaut cher, plus on est lent.
//  Dans le manoir, pousser quelqu'un lui fait lâcher son objet (dehors : on ne pousse pas).
//  Les gardiens reprennent l'objet de ceux qu'ils attrapent et le rangent ailleurs.
//  Un coffre-fort apparaît régulièrement, et l'alarme finale double le butin.
//  Le SERVEUR fait foi : même physique que le navigateur (pieton/engine.js).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/manoir/manor.js";
import "../../public/games/casse/loot.js";

const H = globalThis.Pieton;
const M = globalThis.Manoir;
const C = globalThis.Casse;
const K = H.K;

export const meta = {
  id: "casse",
  name: "Cambrioleurs",
  emoji: "💰",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Pillez le manoir, ramenez le butin au van et faites lâcher celui des autres !",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
const ROUND_OVER_MS = 8000;
const FINISH_DELAY = 15000;
export const DURATION_MS = 150000;    // une manche : 2 min 30
export const ALARM_MS = 30000;        // les 30 dernières secondes : le butin vaut double
const CHEST_EVERY = 40000;            // un coffre-fort toutes les 40 s
const VAN_R = 92;                     // on dépose en arrivant au van
const PICK_R = 34;                    // on ramasse en marchant dessus
const GRAB_CD = 1200;                 // pas de reprise juste après avoir lâché
export const SWAP_R = 62;             // touche E : portée pour échanger avec un objet par terre
const CAUGHT_MS = 1000;               // sonné par un gardien
const SAFE_MS = 3500;                 // ... puis tranquille un moment
const SIGHT = 240;                    // portée du regard d'un gardien
const TP_CD = 900;
export const POINTS = [10, 7, 5, 3, 2, 1];
const ROOM_NAMES = { hall: "le hall", bal: "la salle de bal", salon: "le salon", chambre: "une chambre", cuisine: "la cuisine", bibliotheque: "la bibliothèque", manger: "la salle à manger", bain: "la salle de bain", placard: "un placard", bureau: "le bureau" };

function defaultSettings() { return { rounds: 3 }; }

export const playlist = {
  options: [{ key: "rounds", label: "Manches", default: "3", choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }] }],
  settingsFor(c) { return { ...defaultSettings(), rounds: Number(c.rounds) === 5 ? 5 : 3 }; },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const KEYS = [K.RIGHT, K.RIGHT | K.DOWN, K.DOWN, K.DOWN | K.LEFT, K.LEFT, K.LEFT | K.UP, K.UP, K.UP | K.RIGHT];
const keyToward = (h, p) => {
  if (Math.hypot(p.x - h.x, p.y - h.y) < 6) return 0;
  const ang = Math.atan2(p.y - h.y, p.x - h.x);
  return KEYS[Math.round(((ang + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
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
    manor: null, blk: null,
    heroes: {},           // id -> { h, carry, money, frozenUntil, safeUntil, tpUntil, bot, seq, lastInputAt, budget, ai }
    van: null,            // { x, y } : le van de tout le monde
    loot: [], lootId: 0,  // { id, x, y, kind, by, at }
    guards: [],           // { h, ai, chase, carry, restUntil }
    chestRoom: null, nextChest: 0, nextLoot: 0,
    feed: [],
    playAt: 0, timeUpAt: 0, phaseEnd: 0,
    lastRound: null,
    loop: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const alarm = (t = now()) => g.phase === "play" && g.timeUpAt - t <= ALARM_MS;
  const inside = (h) => M.zoneOf(g.manor, h.x, h.y) !== "jardin";     // dans le manoir ou la cave (pas sur le parking)
  const envOf = (s) => ({ walls: true, w: g.manor.w, h: g.manor.h, rects: g.manor.rects, push: inside(s.h), noDash: true, speedMul: C.speedOf(s.carry) });
  const guardEnv = () => ({ walls: true, w: g.manor.w, h: g.manor.h, rects: g.manor.rects, noDash: true, speedMul: C.GUARD_SPEED });

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
        id, seq: s.seq, carry: s.carry, money: s.money, frozen: t < s.frozenUntil, safe: t < s.safeUntil,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: s.h.dash, dashT: 0, pushT: s.h.pushT, heavy: 0,
      })),
      van: g.van,
      loot: g.loot.map(({ id, x, y, kind }) => ({ id, x, y, kind })),
      guards: g.guards.map((q) => ({ x: q.h.x, y: q.h.y, vx: q.h.vx, vy: q.h.vy, face: q.h.face, walk: q.h.walk, chase: !!q.chase, carry: q.carry })),
      chestRoom: g.chestRoom,
      alarm: alarm(t),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.phase === "countdown" ? DURATION_MS : 0,
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 700).map(({ id, x, y, kind, v }) => ({ id, x, y, kind, v })),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  function say(text) { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 8) g.feed.shift(); }
  function addFx(x, y, kind, v) { g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(x), y: Math.round(y), kind, v }); if (g.fx.length > 30) g.fx.shift(); }

  function startGame() {
    g.scores = {};
    g.round = 0;
    g.final = false;
    startRound();
  }

  // Un endroit libre dans une pièce (du manoir ou de la cave).
  const spotIn = (r) => M.centerOf(g.manor.nav, M.nearestFree(g.manor.nav, M.cellOf(g.manor.nav, r.x + rand(26, r.w - 26), r.y + rand(26, r.h - 26))));
  const lootRooms = () => g.manor.rooms.filter((r) => r.kind !== "couloir");
  function addLoot(kind, room) {
    const p = spotIn(room || pick(lootRooms()));
    g.loot.push({ id: ++g.lootId, x: p.x, y: p.y, kind, by: null, at: 0 });
  }
  function randomKind() { const u = Math.random(); return u < 0.5 ? "argenterie" : u < 0.82 ? "vase" : "tableau"; }

  function startRound() {
    clearTimeout(g.finishTimer);
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    g.manor = M.build(Math.floor(Math.random() * 1e9), list.length, { small: true });
    g.manor.nPlayers = list.length;
    const m = g.manor, nav = m.nav;
    // Un seul van, au milieu du parking ; tout le monde démarre autour.
    const R = m.manorRect, front = m.gardenParts[0];
    const c0 = M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, R.x + R.w / 2, front.y + front.h / 2)));
    g.van = { x: c0.x, y: c0.y };
    g.heroes = {};
    list.forEach((p, i) => {
      g.scores[p.id] = g.scores[p.id] || 0;
      const a = (i / list.length) * Math.PI * 2;
      const c = M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, g.van.x + Math.cos(a) * 130, g.van.y + Math.sin(a) * 90)));
      g.heroes[p.id] = {
        h: H.newHero(c.x, c.y, -Math.PI / 2), carry: null, money: 0, frozenUntil: 0, safeUntil: 0, tpUntil: 0,
        bot: !!p.bot, seq: 0, lastInputAt: 0, budget: 6, budgetAt: 0, prevK: 0, ai: { think: 0, greed: rand(0.6, 1.3) },
      };
    });
    g.loot = [];
    for (let k = 0; k < list.length * 3 + 6; k++) addLoot(randomKind());
    // Les gardiens : 2 à 4, loin des camionnettes.
    g.guards = [];
    const rooms = shuffle(lootRooms().filter((r) => !r.cave));
    for (let k = 0, n = 2 + Math.floor(list.length / 3); k < n; k++) {
      const p = spotIn(rooms[k % rooms.length]);
      g.guards.push({ h: H.newHero(p.x, p.y, 0), ai: { field: null, goal: null }, chase: null, carry: null, restUntil: 0 });
    }
    g.chestRoom = null;
    g.feed = []; g.fx = [];
    g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function endRound() {
    stopLoop();
    const order = Object.keys(g.heroes).sort((a, b) => g.heroes[b].money - g.heroes[a].money);
    const gains = {};
    let rank = 0;
    order.forEach((id, i) => {
      if (i > 0 && g.heroes[id].money < g.heroes[order[i - 1]].money) rank = i;
      gains[id] = POINTS[rank] || 0;
      g.scores[id] = (g.scores[id] || 0) + gains[id];
    });
    g.lastRound = { order, gains, money: Object.fromEntries(order.map((id) => [id, g.heroes[id].money])) };
    const last = g.round >= g.settings.rounds;
    g.phase = last ? "over" : "roundOver";
    if (last && ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    } else if (!last && ctx.playlist) {
      g.phaseEnd = now() + ROUND_OVER_MS;
      g.finishTimer = setTimeout(() => { if (g.phase === "roundOver") { startRound(); ctx.update(); } }, ROUND_OVER_MS);
    }
    ctx.update();
  }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // Lâcher ce qu'on porte (il reste par terre, tout le monde peut le ramasser).
  function drop(id, s) {
    if (!s.carry) return;
    const c = M.centerOf(g.manor.nav, M.nearestFree(g.manor.nav, M.cellOf(g.manor.nav, s.h.x, s.h.y)));
    g.loot.push({ id: ++g.lootId, x: c.x, y: c.y, kind: s.carry, by: id, at: now() });
    addFx(s.h.x, s.h.y, "drop");
    s.carry = null;
  }

  // Touche E : échanger avec l'objet le plus proche, ou poser le sien par terre.
  function swapOrDrop(id, s) {
    if (!s.carry) return;
    const t = now();
    let best = null, bd = SWAP_R;
    for (const l of g.loot) { const d = dist(l, s.h); if (d < bd) { bd = d; best = l; } }
    if (!best) return drop(id, s);
    const mine = s.carry;
    s.carry = best.kind;
    best.kind = mine; best.by = id; best.at = t;    // mon ancien objet prend sa place
    addFx(s.h.x, s.h.y, "pick");
    if (s.carry === "coffre") { say(`💎 ${pseudo(id)} a le coffre-fort !`); g.chestRoom = null; }
  }

  // =================================================================
  //  UN JOUEUR AGIT (1/30 s) : marcher, pousser, poser / échanger
  // =================================================================
  function act(id, k) {
    const s = g.heroes[id];
    const t = now();
    const move = t < s.frozenUntil ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH);
    if ((k & K.FIRE) && !(s.prevK & K.FIRE) && t >= s.frozenUntil && g.phase === "play") swapOrDrop(id, s);
    s.prevK = k;
    const env = envOf(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, move, null, dt, env);
      if (s.h.pushed) {
        s.h.pushed = false;
        // (dehors, personne ne se fait pousser)
        const others = Object.entries(g.heroes).filter(([oid, o]) => oid !== id && inside(o.h));
        for (const hh of H.applyPush(s.h, others.map(([, o]) => o.h))) {
          const [oid, o] = others.find(([, q]) => q.h === hh);
          addFx((s.h.x + hh.x) / 2, (s.h.y + hh.y) / 2, "push");
          if (o.carry) { say(`👊 ${pseudo(id)} fait lâcher ${C.LOOT[o.carry].name.toLowerCase()} à ${pseudo(oid)} !`); drop(oid, o); }
        }
      }
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id) H.collideHeroes(s.h, o.h);
    }
  }

  // Ramasser, déposer, escaliers et passages secrets.
  function stepHero(id, s) {
    const t = now();
    if (t < s.frozenUntil) return;
    if (!s.carry) {
      for (let i = 0; i < g.loot.length; i++) {
        const l = g.loot[i];
        if (dist(l, s.h) > PICK_R || (l.by === id && t - l.at < GRAB_CD)) continue;
        s.carry = l.kind;
        g.loot.splice(i, 1);
        addFx(s.h.x, s.h.y, "pick");
        if (l.kind === "coffre") { say(`💎 ${pseudo(id)} a le coffre-fort !`); g.chestRoom = null; }
        break;
      }
    } else if (dist(g.van, s.h) < VAN_R) {
      const v = C.LOOT[s.carry].value * (alarm(t) ? 2 : 1);
      s.money += v;
      addFx(s.h.x, s.h.y - 30, "cash", v);
      if (s.carry === "coffre") say(`💰 ${pseudo(id)} encaisse le coffre : ${v} $ !`);
      s.carry = null;
    }
    if (t < s.tpUntil) return;
    for (const p of g.manor.portals) {
      for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) {
        if (Math.hypot(s.h.x - a.x, s.h.y - a.y) > M.PAD) continue;
        const nx = (a.ex - a.x) / 46, ny = (a.ey - a.y) / 46;
        if (s.h.vx * nx + s.h.vy * ny > -40) continue;
        addFx(s.h.x, s.h.y, "tp");
        s.h.x = b.ex; s.h.y = b.ey; s.h.vx = 0; s.h.vy = 0;
        s.tpUntil = t + TP_CD;
        addFx(b.ex, b.ey, "tp");
        return;
      }
    }
  }

  // =================================================================
  //  LES GARDIENS : ils se promènent dans le manoir. Ils n'en veulent qu'à
  //  ceux qui portent un objet : ils le leur reprennent (1 s de sonné) et
  //  vont le poser dans une autre pièce, au hasard.
  // =================================================================
  const fieldTo = (p) => M.field(g.manor.nav, [M.nearestFree(g.manor.nav, M.cellOf(g.manor.nav, p.x, p.y))]);
  const manorRooms = () => lootRooms().filter((r) => !r.cave);
  function goTo(q, room, t) {
    q.ai.room = room;
    q.ai.goal = spotIn(room);
    q.ai.field = fieldTo(q.ai.goal);
    q.ai.until = t + 15000;
    q.ai.stuck = 0;
  }
  function stepGuard(q) {
    const t = now(), h = q.h, nav = g.manor.nav;
    const env = guardEnv(), dt = H.TICK / H.SUB;
    let k = 0;
    if (t >= q.restUntil) {
      if (q.carry) {
        // Il range l'objet.
        if (!q.ai.goal) goTo(q, pick(manorRooms()), t);
        if (dist(q.ai.goal, h) < 34 || t > q.ai.until) {
          g.loot.push({ id: ++g.lootId, x: q.ai.goal.x, y: q.ai.goal.y, kind: q.carry, by: null, at: 0 });
          if (q.carry === "coffre") { g.chestRoom = ROOM_NAMES[q.ai.room?.kind] || "le manoir"; say(`👮 Le coffre-fort est rangé dans ${g.chestRoom} !`); }
          q.carry = null; q.ai.goal = null; q.restUntil = t + 700;
        } else k = keyToward(h, M.lookAhead(nav, q.ai.field, h.x, h.y, 2));
      } else {
        // Qui porte un objet, dans le manoir, et à sa vue ?
        let target = null, best = 1e9;
        for (const [id, s] of Object.entries(g.heroes)) {
          if (!s.carry || t < s.safeUntil || M.zoneOf(g.manor, s.h.x, s.h.y) !== "manoir") continue;
          const d = dist(s.h, h);
          if (d < SIGHT && d < best && M.los(g.manor.walls, h.x, h.y, s.h.x, s.h.y)) { best = d; target = id; }
        }
        q.chase = target;
        if (target) {
          const s = g.heroes[target];
          if (best < H.R * 2 + 8) {
            // Attrapé : il reprend l'objet.
            say(`👮 Un gardien reprend ${C.LOOT[s.carry].name.toLowerCase()} à ${pseudo(target)} !`);
            q.carry = s.carry; s.carry = null;
            s.frozenUntil = t + CAUGHT_MS; s.safeUntil = t + CAUGHT_MS + SAFE_MS;
            addFx(s.h.x, s.h.y, "caught");
            q.chase = null; q.ai.goal = null;
            // Une autre pièce que celle où on est.
            const here = M.roomAt(g.manor, h.x, h.y);
            goTo(q, pick(manorRooms().filter((r) => r !== here)), t);
          } else {
            if (t >= (q.ai.chaseAt || 0)) { q.ai.chaseAt = t + 350; q.ai.field = fieldTo(s.h); q.ai.goal = null; }
            k = keyToward(h, M.lookAhead(nav, q.ai.field, h.x, h.y, 2));
          }
        } else {
          if (!q.ai.goal || dist(q.ai.goal, h) < 40 || t > (q.ai.until || 0)) goTo(q, pick(manorRooms()), t);
          k = keyToward(h, M.lookAhead(nav, q.ai.field, h.x, h.y, 2));
        }
      }
      // Coincé (un passage secret sur son chemin…) : il change d'idée.
      q.ai.stuck = k && Math.hypot(h.vx, h.vy) < 25 ? (q.ai.stuck || 0) + H.TICK : 0;
      if (q.ai.stuck > 1 && !q.chase) goTo(q, q.carry && q.ai.room ? q.ai.room : pick(manorRooms()), t);
    }
    for (let sub = 0; sub < H.SUB; sub++) { H.drive(h, k, null, dt, env); H.collideWalls(h, env); }
    // Les passages secrets lui servent aussi (pas les escaliers : il reste dans le manoir).
    if (t >= (q.tpUntil || 0)) {
      for (const p of g.manor.portals) {
        if (p.kind !== "secret") continue;
        for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) {
          if (Math.hypot(h.x - a.x, h.y - a.y) > M.PAD + 6) continue;
          h.x = b.ex; h.y = b.ey; h.vx = 0; h.vy = 0;
          q.tpUntil = t + 2500;
          addFx(b.ex, b.ey, "tp");
          return;
        }
      }
    }
  }

  // =================================================================
  //  BOTS : le meilleur objet proche, retour à la camionnette, et ils
  //  poussent ceux qui portent quelque chose à côté d'eux.
  // =================================================================
  function botKeys(id, s) {
    const h = s.h, ai = s.ai, t = now(), nav = g.manor.nav;
    ai.think -= H.TICK;
    if (ai.think <= 0 || (ai.lootId && !g.loot.some((l) => l.id === ai.lootId) && !s.carry) || ai.had !== !!s.carry) {
      ai.think = 0.5 + Math.random() * 0.4;
      ai.had = !!s.carry;
      ai.lootId = null;
      let goal = null;
      if (s.carry) goal = g.van;
      else {
        let best = -1e9;
        for (const l of g.loot) {
          if (l.by === id && t - l.at < GRAB_CD) continue;
          const sc = C.LOOT[l.kind].value * ai.greed - dist(l, h) * 0.9 - dist(l, g.van) * 0.25 + rand(0, 90);
          if (sc > best) { best = sc; goal = l; ai.lootId = l.id; }
        }
      }
      if (goal) ai.field = fieldTo(goal);
    }
    let k = ai.field ? keyToward(h, M.lookAhead(nav, ai.field, h.x, h.y, 2)) : 0;
    // Il trouve mieux sous son nez : il échange.
    if (s.carry && !(s.prevK & K.FIRE)) {
      const v = C.LOOT[s.carry].value;
      if (g.loot.some((l) => dist(l, h) < SWAP_R && C.LOOT[l.kind].value > v && !(l.by === id && t - l.at < GRAB_CD))) k |= K.FIRE;
    }
    // Quelqu'un qui porte un objet juste à côté : on lui fonce dessus et on pousse.
    if (!s.carry && inside(h)) {
      for (const [oid, o] of Object.entries(g.heroes)) {
        if (oid === id || !o.carry || dist(o.h, h) > 110 || !inside(o.h)) continue;
        k = keyToward(h, o.h);
        if (dist(o.h, h) < H.R * 2 + 20 && h.dash <= 0 && !(s.prevK & K.DASH)) k |= K.DASH;
        break;
      }
    }
    return k;
  }

  // =================================================================
  //  BOUCLE (30 fois/s)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown") {
      if (t >= g.phaseEnd) {
        g.phase = "play"; g.playAt = t; g.timeUpAt = t + DURATION_MS;
        g.nextChest = t + 25000; g.nextLoot = t + 2500;
      }
    } else if (g.phase === "play") {
      for (const [id, s] of Object.entries(g.heroes)) {
        if (s.bot) act(id, botKeys(id, s));
        else if (t - s.lastInputAt > 200) act(id, 0);     // onglet en pause : on ne bouge plus
        stepHero(id, s);
      }
      for (const q of g.guards) stepGuard(q);
      // De nouveaux objets, pour que le manoir ne soit jamais vide.
      if (t >= g.nextLoot) {
        g.nextLoot = t + 2500;
        if (g.loot.length < Object.keys(g.heroes).length * 3 + 6) addLoot(randomKind());
      }
      // Le coffre-fort, annoncé à tout le monde.
      if (t >= g.nextChest) {
        g.nextChest = t + CHEST_EVERY;
        if (!g.loot.some((l) => l.kind === "coffre") && !Object.values(g.heroes).some((s) => s.carry === "coffre") && !g.guards.some((q) => q.carry === "coffre")) {
          const r = pick(lootRooms().filter((q) => !q.cave));
          addLoot("coffre", r);
          g.chestRoom = ROOM_NAMES[r.kind] || "le manoir";
          say(`💎 Un coffre-fort dans ${g.chestRoom} !`);
        }
      }
      if (t >= g.timeUpAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function leave(id) {
    const s = g.heroes[id];
    if (!s || !["countdown", "play"].includes(g.phase)) return;
    drop(id, s);
    if (Object.keys(g.heroes).length <= 2 && g.phase === "play") g.timeUpAt = Math.min(g.timeUpAt, now() + 1500);
  }

  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![3, 5].includes(s.rounds)) s.rounds = 3;
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
      startRound();
      ctx.update();
    },
    // Touches : { s: numéro, k: touches } (30 fois/s).
    in(pid, { s, k }) {
      const st = g.heroes[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (g.phase !== "play") return;
      st.budget = Math.min(6, st.budget + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      act(pid, k & 63);
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
    _g: g,   // (pour les tests / simulations)
  };
}
