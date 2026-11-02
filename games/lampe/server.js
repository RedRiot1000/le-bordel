// ===================================================================
//  LAMPE TORCHE — Moteur du jeu (module du hub Le Bordel)
//  Un manoir hanté (avec son jardin et sa cave) plongé dans le noir.
//  Les humains n'ont qu'une lampe (qui se vide). Un fantôme les chasse :
//  chaque humain touché devient fantôme à son tour (contagion).
//  - Le fantôme ne voit que dans son cône de regard (pas à travers les murs),
//    mais il voit les lampes allumées, la lune, les lustres, les éclairs.
//  - La lumière d'une lampe le révèle et le ralentit ; 1,5 s d'affilée l'étourdit.
//  - Portes à claquer, lustres à allumer, escaliers, passages secrets,
//    planches qui craquent, toiles d'araignée, éclairs.
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
export const GHOST_SPEED = 1.1;       // un peu plus rapide que les humains dans le noir...
export const LIT_SLOW = 0.55;         // ... mais ralenti dans la lumière (lampe ou lustre)
export const LIGHT_STUN = 1.5;        // 1,5 s de lampe d'affilée = étourdi
export const STUN_MS = 2500;          // étourdi : il ne bouge plus, il recule
export const IMMUNE_MS = 2000;        // puis insensible à la lumière un moment
export const CONVERT_FREEZE = 1500;   // un nouveau fantôme est figé 1,5 s
export const DRAIN = 1 / 25;          // batterie vidée en 25 s de lampe allumée
export const PILE = 0.45;             // une pile ramassée
const PILE_RESPAWN = 8000;
export const TOUCH = H.R * 2 + 2;     // distance pour toucher un humain
export const REACH = 52;              // Espace : portée pour une porte
export const SWITCH_REACH = 46;       // ... ou un interrupteur
export const FORCE_S = 2;             // un fantôme défonce une porte fermée en 2 s
export const LUSTRE_MS = 20000;       // un lustre reste allumé 20 s...
export const LUSTRE_CD = 15000;       // ... puis 15 s avant de pouvoir le rallumer
export const CREAK_MS = 2000;         // planche qui craque : repéré 2 s
export const WEB_SLOW = 0.6;          // toile d'araignée : humains ralentis
const TP_CD = 1200;                   // après un escalier / passage, 1,2 s avant le suivant
const FLASH_MS = 260;                 // un éclair
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
const distRect = (p, r) => Math.hypot(p.x - Math.max(r.x, Math.min(p.x, r.x + r.w)), p.y - Math.max(r.y, Math.min(p.y, r.y + r.h)));
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

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
    heroes: {},           // id -> { h, ghost, lamp, bat, litT, seen, slow, moon, exp, dazedUntil, immuneUntil, frozenUntil, caughtAt, catches, creakUntil, web, tpUntil, bot, seq, lastInputAt, ai, prevK, aim }
    firstGhosts: [],
    startGhost: null,
    doors: [],            // { open, force, touched } (même ordre que manor.doors)
    rectsNow: [], blockNow: [],   // obstacles et « murs pour la lumière » avec les portes fermées
    lit: {},              // salle -> { until, cd } (lustres)
    creakCd: [],
    webs: [],             // vivante ou déchirée
    piles: [], pileId: 0,
    flashUntil: 0, nextFlash: 0, flashId: 0,
    feed: [],
    playAt: 0, timeUpAt: 0, endAt: 0, phaseEnd: 0,
    lastRound: null,
    loop: null, lastTickAt: 0,
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
  const roomLit = (r, t = now()) => !!r && r.lamp !== undefined && (g.lit[r.id]?.until || 0) > t;
  const envOf = (s) => ({
    walls: true, w: g.manor.w, h: g.manor.h, rects: g.rectsNow, push: !s.ghost, noDash: true,
    speedMul: s.ghost ? GHOST_SPEED * (s.slow && now() >= s.immuneUntil ? LIT_SLOW : 1) : s.web >= 0 ? WEB_SLOW : 1,
  });
  function refreshDoors() {
    const closed = g.manor.doors.filter((d, i) => !g.doors[i].open);
    g.rectsNow = g.manor.rects.concat(closed);
    g.blockNow = M.blockers(g.manor, closed);
  }

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
        seen: !!s.seen, slow: !!s.slow, moon: !!s.moon, exp: !!s.exp, web: s.web,
        dazed: t < s.dazedUntil, frozen: t < s.frozenUntil, immune: t < s.immuneUntil, lit: Math.round(Math.min(1, s.litT / LIGHT_STUN) * 100) / 100,
        aim: Math.round((s.aim ?? s.h.face) * 100) / 100,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: s.h.dash, dashT: 0, pushT: s.h.pushT, heavy: 0,
      })),
      doors: g.doors.map((d) => (d.open ? "1" : "0")).join(""),
      lit: Object.entries(g.lit).filter(([, v]) => v.until > t).map(([id, v]) => [Number(id), v.until - t]),
      webs: g.webs.map((w) => (w ? "1" : "0")).join(""),
      flashLeft: Math.max(0, g.flashUntil - t), flashId: g.flashId,
      piles: g.piles.filter((p) => !p.back).map(({ id, x, y }) => ({ id, x, y })),
      startGhost: g.startGhost,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.phase === "countdown" ? durationMs() : 0,
      wakeIn: g.phase === "play" ? Math.max(0, g.playAt + WAKE_MS - t) : WAKE_MS,
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 700).map(({ id, x, y, kind }) => ({ id, x, y, kind })),
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
    // Portes : toutes ouvertes, sauf celles qui donnent sur le jardin.
    g.doors = g.manor.doors.map((d) => ({ open: !d.ext, force: 0, touched: false }));
    refreshDoors();
    g.lit = {};
    g.creakCd = g.manor.creaks.map(() => 0);
    g.webs = g.manor.webs.map(() => true);
    // Le fantôme de départ : quelqu'un qui ne l'a pas encore été.
    let cand = list.filter((p) => !g.firstGhosts.includes(p.id));
    if (!cand.length) { g.firstGhosts = []; cand = list; }
    const ghostId = pick(cand).id;
    g.firstGhosts.push(ghostId);
    g.startGhost = ghostId;
    // Les humains : chacun dans une pièce du manoir ; le fantôme dans la pièce la plus loin d'eux.
    const manorRooms = g.manor.rooms.filter((r) => !r.cave && r.kind !== "couloir");
    const roomSpot = (r) => M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, r.x + r.w / 2 + rand(-30, 30), r.y + r.h / 2 + rand(-20, 20))));
    const rooms = shuffle(manorRooms);
    const spots = [];
    list.filter((p) => p.id !== ghostId).forEach((p, i) => spots.push({ id: p.id, ...roomSpot(rooms[i % rooms.length]) }));
    const d = M.field(nav, spots.map((s) => M.cellOf(nav, s.x, s.y)));
    let far = rooms[0], fd = -1;
    for (const r of manorRooms) { const p = roomSpot(r), dd = d[M.cellOf(nav, p.x, p.y)]; if (dd > fd) { fd = dd; far = r; } }
    spots.push({ id: ghostId, ...roomSpot(far) });
    g.heroes = {};
    for (const sp of spots) {
      const p = list.find((x) => x.id === sp.id);
      const ghost = sp.id === ghostId;
      g.heroes[sp.id] = {
        h: H.newHero(sp.x, sp.y, rand(-Math.PI, Math.PI)), ghost, lamp: !ghost, bat: 1, litT: 0,
        seen: false, slow: false, moon: false, exp: false, web: -1, creakUntil: 0, tpUntil: 0,
        dazedUntil: 0, immuneUntil: 0, frozenUntil: 0, caughtAt: 0, catches: 0,
        bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, prevK: 0, aim: null,
      };
      g.scores[sp.id] = g.scores[sp.id] || 0;
    }
    g.piles = [];
    for (let k = 0; k < list.length + 3; k++) g.piles.push({ id: ++g.pileId, ...pileSpot(), back: 0 });
    g.feed = []; g.fx = [];
    g.fields = {}; g.fieldsAt = 0; g.ghostField = null;
    g.flashUntil = 0;
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
    return best || center(g.manor.manorRect);
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
    s.web = -1;
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
  //  ESPACE : claquer / rouvrir une porte, allumer un lustre (sinon : pousser)
  // =================================================================
  // Ce qui est à portée d'Espace (porte ou interrupteur), ou null.
  function interactable(s) {
    let best = null, bd = 1e9;
    g.manor.doors.forEach((d, i) => { const dd = distRect(s.h, d); if (dd < REACH - H.R && dd < bd) { bd = dd; best = { door: i }; } });
    for (const sw of g.manor.switches) { const dd = dist(s.h, sw); if (dd < SWITCH_REACH && dd < bd) { bd = dd; best = { sw }; } }
    return best;
  }
  function useThing(s, it) {
    const t = now();
    if (it.door !== undefined) {
      const st = g.doors[it.door], d = g.manor.doors[it.door];
      if (st.open) {
        // On ne claque pas une porte sur quelqu'un.
        if (Object.values(g.heroes).some((o) => distRect(o.h, d) < H.R)) return;
        st.open = false;
        addFx(d.x + d.w / 2, d.y + d.h / 2, "door");
      } else { st.open = true; st.force = 0; }
      refreshDoors();
    } else {
      const L = (g.lit[it.sw.room] ||= { until: 0, cd: 0 });
      if (L.until > t || t < L.cd) return;
      L.until = t + LUSTRE_MS;
      L.cd = L.until + LUSTRE_CD;
      addFx(it.sw.x, it.sw.y, "switch");
    }
  }

  // =================================================================
  //  UN JOUEUR AGIT : marcher, viser (lampe ou regard), lampe on/off, Espace
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    const still = t < s.frozenUntil || t < s.dazedUntil;
    let move = still ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH);
    if (g.phase === "play" && !s.ghost && !still) {
      // Clic = allumer / éteindre la lampe.
      if ((k & K.FIRE) && !(s.prevK & K.FIRE)) s.lamp = !s.lamp;
      // Espace près d'une porte / d'un interrupteur : on s'en sert (au lieu de pousser).
      if ((k & K.DASH) && !(s.prevK & K.DASH)) { const it = interactable(s); if (it) { useThing(s, it); move &= ~K.DASH; } }
      else if (k & K.DASH && interactable(s)) move &= ~K.DASH;
    }
    s.prevK = k;
    const env = envOf(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, move, s.aim, dt, env);
      if (s.h.pushed) {
        s.h.pushed = false;
        const others = Object.entries(g.heroes).filter(([oid]) => oid !== id).map(([, o]) => o.h);
        for (const hh of H.applyPush(s.h, others)) addFx((s.h.x + hh.x) / 2, (s.h.y + hh.y) / 2, "push");
      }
      H.collideWalls(s.h, env);
      if (!s.ghost) for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && !o.ghost) H.collideHeroes(s.h, o.h);
    }
    // Un fantôme qui pousse contre une porte fermée finit par la défoncer.
    if (s.ghost && (move & (K.UP | K.DOWN | K.LEFT | K.RIGHT))) {
      g.manor.doors.forEach((d, i) => {
        const st = g.doors[i];
        if (st.open || distRect(s.h, d) > H.R + 4) return;
        st.force += H.TICK; st.touched = true;
        if (st.force >= FORCE_S) { st.open = true; st.force = 0; refreshDoors(); addFx(d.x + d.w / 2, d.y + d.h / 2, "bang"); say("💥 Une porte a été défoncée !"); }
      });
      // Il touche un interrupteur : il éteint le lustre.
      for (const sw of g.manor.switches) {
        const L = g.lit[sw.room];
        if (L && L.until > t && dist(s.h, sw) < 34) { L.until = t; L.cd = t + LUSTRE_CD; addFx(sw.x, sw.y, "switch"); }
      }
    }
  }

  // =================================================================
  //  LUMIÈRES, REGARDS, CONTACTS, PIÈGES, PASSAGES, PILES
  // =================================================================
  function stepWorld(dt) {
    const t = now();
    const m = g.manor;
    // Éclairs (le manoir et le jardin, pas la cave).
    if (t >= g.nextFlash) { g.flashUntil = t + FLASH_MS; g.flashId++; g.nextFlash = t + rand(15000, 30000); }
    const flash = t < g.flashUntil;
    const lamps = humans().map((id) => g.heroes[id]).filter((s) => s.lamp && s.bat > 0);
    // Batteries.
    for (const id of humans()) {
      const s = g.heroes[id];
      if (s.lamp) { s.bat = Math.max(0, s.bat - DRAIN * dt); if (s.bat <= 0) s.lamp = false; }
    }
    // Les fantômes : dans une lampe (révélé + ralenti + étourdi au bout de 1,5 s), un lustre (révélé + ralenti), la lune (à moitié), un éclair.
    for (const id of ghosts()) {
      const s = g.heroes[id];
      let by = null;
      for (const L of lamps) if (M.inCone(g.blockNow, L.h.x, L.h.y, L.aim ?? L.h.face, s.h.x, s.h.y, M.LAMP_RANGE, M.LAMP_HALF, 12)) { by = L; break; }
      const zone = M.zoneOf(m, s.h.x, s.h.y);
      const inLustre = roomLit(M.roomAt(m, s.h.x, s.h.y), t);
      s.slow = !!by || inLustre;
      s.seen = s.slow || (flash && zone !== "cave");
      s.moon = !s.seen && M.moonAt(m, s.h.x, s.h.y);
      const sleeping = t < s.frozenUntil;
      if (by && t >= s.immuneUntil && t >= s.dazedUntil && !sleeping) {
        s.litT += dt;
        if (s.litT >= LIGHT_STUN) {
          s.litT = 0;
          s.dazedUntil = t + STUN_MS;
          s.immuneUntil = t + STUN_MS + IMMUNE_MS;
          const d = Math.max(1, dist(s.h, by.h));
          s.h.vx = ((s.h.x - by.h.x) / d) * 420; s.h.vy = ((s.h.y - by.h.y) / d) * 420; s.h.stun = 0.5;
          addFx(s.h.x, s.h.y, "daze");
          say("💡 Un fantôme est étourdi !");
        }
      } else s.litT = Math.max(0, s.litT - dt);
    }
    // Les humains : repérables de partout par les fantômes ? (lampe, lune, lustre, planche qui craque, éclair)
    for (const id of humans()) {
      const s = g.heroes[id];
      const zone = M.zoneOf(m, s.h.x, s.h.y);
      // Planches qui craquent.
      m.creaks.forEach((c, i) => {
        if (t >= g.creakCd[i] && M.inRect(s.h.x, s.h.y, c)) { g.creakCd[i] = t + 1500; s.creakUntil = t + CREAK_MS; addFx(c.x + c.w / 2, c.y + c.h / 2, "creak"); }
      });
      // Toiles d'araignée : ralenti dedans, elle se déchire quand on en sort.
      const w = m.webs.findIndex((wb, i) => g.webs[i] && M.inRect(s.h.x, s.h.y, wb));
      if (s.web >= 0 && w !== s.web) { g.webs[s.web] = false; addFx(m.webs[s.web].x + 28, m.webs[s.web].y + 28, "web"); }
      s.web = w;
      s.exp = (s.lamp && s.bat > 0) || t < s.creakUntil || M.moonAt(m, s.h.x, s.h.y) || roomLit(M.roomAt(m, s.h.x, s.h.y), t) || (flash && zone !== "cave");
    }
    // Contacts : un fantôme réveillé touche un humain = contagion.
    for (const gid of ghosts()) {
      const G = g.heroes[gid];
      if (t < G.frozenUntil || t < G.dazedUntil) continue;
      for (const hid of humans()) if (dist(G.h, g.heroes[hid].h) < TOUCH) convert(hid, gid);
    }
    // Escaliers et passages secrets : on ressort à l'autre bout.
    for (const s of Object.values(g.heroes)) {
      if (t < s.tpUntil) continue;
      for (const p of m.portals) {
        for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) {
          if (Math.hypot(s.h.x - a.x, s.h.y - a.y) > M.PAD) continue;
          // (seulement si on « rentre » dedans : on marche vers le mur)
          const nx = (a.ex - a.x) / 46, ny = (a.ey - a.y) / 46;
          if (s.h.vx * nx + s.h.vy * ny > -40) continue;
          addFx(s.h.x, s.h.y, p.kind);
          s.h.x = b.ex; s.h.y = b.ey; s.h.vx = 0; s.h.vy = 0;
          s.tpUntil = t + TP_CD;
          addFx(b.ex, b.ey, p.kind);
          break;
        }
        if (t < s.tpUntil) break;
      }
    }
    // Les portes qu'aucun fantôme ne pousse plus se « remettent ».
    for (const st of g.doors) { if (!st.touched) st.force = Math.max(0, st.force - dt * 0.5); st.touched = false; }
    // Piles.
    for (const p of g.piles) {
      if (p.back) { if (t >= p.back) Object.assign(p, pileSpot(), { back: 0, id: ++g.pileId }); continue; }
      for (const id of humans()) {
        const s = g.heroes[id];
        if (dist(s.h, p) < H.R + 14 && s.bat < 0.98) { s.bat = Math.min(1, s.bat + PILE); p.back = t + PILE_RESPAWN; addFx(p.x, p.y, "pile"); break; }
      }
    }
  }

  // Un fantôme voit-il cet humain ? (dans son cône de regard sans mur entre eux, ou repérable de partout)
  function ghostSees(G, o) {
    if (o.exp) return true;
    return M.inCone(g.blockNow, G.h.x, G.h.y, G.aim ?? G.h.face, o.h.x, o.h.y, M.SIGHT_RANGE, M.SIGHT_HALF, 10) || dist(G.h, o.h) < 50;
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
  // Coincé (on veut avancer mais on ne bouge pas) ?
  function stuck(s, wants) {
    const sp = Math.hypot(s.h.vx, s.h.vy);
    s.ai.stuck = wants && sp < 25 ? (s.ai.stuck || 0) + H.TICK : 0;
    return s.ai.stuck > 0.35;
  }
  // Appuyer sur Espace (un appui, pas maintenu).
  const space = (s) => (s.prevK & K.DASH ? 0 : K.DASH);

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

  // Un humain bot : il « sent » les fantômes proches (ou visibles), fuit, braque sa lampe dessus,
  // allume un lustre s'il passe à côté, ouvre les portes, ramasse des piles.
  function humanBot(id, s) {
    const h = s.h, ai = s.ai, nav = g.manor.nav, t = now();
    let threat = null, td = 1e9;
    for (const gid of ghosts()) {
      const G = g.heroes[gid], d = dist(G.h, h);
      if ((G.seen || G.moon || d < 230) && d < td && t >= G.frozenUntil) { td = d; threat = G; }
    }
    let k = 0, aim = ai.aim ?? h.face;
    if (!ai.lampAt || t > ai.lampAt) { ai.lampAt = t + rand(3000, 7000); ai.lampPref = Math.random() < 0.4; }
    const want = threat ? s.bat > 0.02 : ai.lampPref && s.bat > 0.3;
    if (threat) aim = Math.atan2(threat.h.y - h.y, threat.h.x - h.x) + (Math.random() - 0.5) * 0.15;
    if (want !== s.lamp && !(s.prevK & K.FIRE)) k |= K.FIRE;
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
    let mv = 0;
    if (threat && td < 260 && g.ghostField) mv = keyToward(h, awayFrom(h));
    else if (ai.goalField) mv = keyToward(h, M.lookAhead(nav, ai.goalField, h.x, h.y, 2));
    k |= mv;
    if (!threat) aim = Math.hypot(h.vx, h.vy) > 40 ? Math.atan2(h.vy, h.vx) : aim;
    // Espace : ouvrir la porte qui bloque, allumer le lustre quand un fantôme approche, ou le repousser.
    const it = interactable(s);
    if (it?.door !== undefined && !g.doors[it.door].open && stuck(s, !!mv)) k |= space(s);
    else if (it?.sw && threat && td < 300 && !roomLit(g.manor.rooms.find((r) => r.id === it.sw.room), t)) k |= space(s);
    else if (threat && td < 46) k |= space(s);
    ai.aim = aim;
    return { k, aim };
  }

  // Un fantôme bot : il regarde où il va (en balayant), et ne repère que ce que voit un vrai fantôme.
  function ghostBot(id, s) {
    const h = s.h, ai = s.ai, nav = g.manor.nav, t = now();
    let target = null, best = 1e9;
    const c = M.nearestFree(nav, M.cellOf(nav, h.x, h.y));
    for (const hid of humans()) {
      const o = g.heroes[hid], f = g.fields[hid];
      if (!f || !ghostSees(s, o)) continue;
      const d = f[c] < 0 ? 1e6 : f[c];
      if (d < best) { best = d; target = hid; }
    }
    // On se souvient un peu de la dernière cible vue.
    // On se souvient de l'endroit où on l'a vu (ou entendu) en dernier : on va y jeter un œil.
    if (target) {
      const o = g.heroes[target].h;
      if (!ai.clue || dist(ai.clue, o) > 80) { ai.clue = { x: o.x, y: o.y }; ai.clueField = null; }
      ai.clueAt = t;
    }
    let goal;
    if (target) {
      const o = g.heroes[target];
      goal = dist(o.h, h) < 70 ? o.h : M.lookAhead(nav, g.fields[target], h.x, h.y, 2);
    } else if (ai.clue && t - ai.clueAt < 6000 && dist(ai.clue, h) > 40) {
      ai.clueField ||= M.field(nav, [M.nearestFree(nav, M.cellOf(nav, ai.clue.x, ai.clue.y))]);
      goal = M.lookAhead(nav, ai.clueField, h.x, h.y, 2);
    } else {
      // Personne en vue : il rôde de pièce en pièce.
      if (!ai.roam || dist(ai.roam, h) < 30 || Math.random() < 0.003) {
        const r = pick(g.manor.rooms);
        ai.roam = M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, r.x + r.w / 2, r.y + r.h / 2)));
        ai.roamField = M.field(nav, [M.cellOf(nav, ai.roam.x, ai.roam.y)]);
      }
      goal = M.lookAhead(nav, ai.roamField, h.x, h.y, 2);
    }
    ai.wob = (ai.wob || 0) + H.TICK;
    let k = keyToward(h, goal);
    if (Math.sin(ai.wob * 1.3 + id.length) > 0.93) k = 0;
    // Le regard : vers la cible, sinon là où il va, en balayant un peu.
    const look = target ? Math.atan2(g.heroes[target].h.y - h.y, g.heroes[target].h.x - h.x) : Math.atan2(goal.y - h.y, goal.x - h.x) + Math.sin(ai.wob * 1.7) * 0.8;
    return { k, aim: look };
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
        g.nextFlash = t + rand(12000, 22000);
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
    // Touches + visée : { s, k, a (angle de la lampe, ou du regard du fantôme) }
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
