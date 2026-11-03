// ===================================================================
//  LA NUIT DU TUEUR — Moteur du jeu (module du hub Le Bordel)
//  Le manoir de Lampe torche, dans le noir. Un joueur est le TUEUR (chacun
//  son tour : autant de manches que de joueurs), les autres sont des humains
//  avec une lampe. Ils doivent rapporter les fusibles au tableau électrique
//  pour ouvrir le portail du jardin et s'échapper. Le tueur tue en 2 coups
//  de couteau ; il ne voit que dans son cône de regard, mais voit les lampes
//  allumées et entend les bruits. Cachettes, portes, pièges, pétards, soins.
//  Le SERVEUR fait foi (30 calculs/s, même moteur que le navigateur).
// ===================================================================

import "../../public/games/pieton/engine.js";
import "../../public/games/lampe/manor.js";

const H = globalThis.Pieton;
const M = globalThis.Manoir;
const K = H.K;
export const USE = 64;                // clic droit : utiliser son objet

export const meta = {
  id: "tueur",
  name: "La Nuit du Tueur",
  emoji: "🔪",
  family: "Action",
  minPlayers: 2,
  maxPlayers: 8,
  description: "Un tueur rôde dans le manoir. Rapportez les fusibles, ouvrez le portail… et chacun sera le tueur à son tour.",
};

const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
export const WAKE_MS = 4000;          // le tueur attend 4 s avant de partir en chasse
export const KILLER_SPEED = 1;         // aussi rapide qu'un humain...
export const RUSH_MS = 2000, RUSH = 1.35;  // ... mais un humain blessé a un coup d'adrénaline (2 s plus vite)
export const WOUND_SLOW = 0.85;       // blessé : plus lent
export const KNIFE_REACH = 44, KNIFE_ANGLE = 0.85, KNIFE_CD = 1000, WIPE_MS = 1500;
export const SEARCH_MS = 1000;        // fouiller une cachette
export const TRAP_MS = 3000;          // pris dans un piège à loup
export const PETARD_DELAY = 1200, PETARD_RANGE = 230;
export const DRAIN = 1 / 25, PILE = 0.45;
export const FORCE_S = 2;             // le tueur défonce une porte fermée en 2 s
export const REACH = 52, HIDE_REACH = 44, SWITCH_REACH = 46;
export const LUSTRE_MS = 20000, LUSTRE_CD = 15000;
export const PER_FUSE = 1, ESCAPE = 4, KILL = 1, WOUND = 1;
const TP_CD = 1200, FLASH_MS = 260, ITEM_RESPAWN = 25000, PILE_RESPAWN = 8000;
const END_DELAY = 1500, ROUND_OVER_MS = 7000, FINISH_DELAY = 15000;
const ITEMS = ["piege", "petard", "trousse"];

function defaultSettings() {
  return { duration: 180 };
}

export const playlist = {
  options: [],
  settingsFor() { return defaultSettings(); },
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
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | roundOver | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    round: 0, rounds: 0,
    order: [],            // l'ordre des tueurs
    killer: null,
    manor: null, spots: [],
    heroes: {},           // id -> { h, killer, alive, wounded, escaped, hidden, carry, item, bat, lamp, seen, exp, ... }
    doors: [], rectsNow: [], blockNow: [],
    lit: {}, creakCd: [], webs: [],
    fuses: [],            // { id, x, y, carrier, done }
    box: null,            // le tableau électrique { x, y }
    gateOpen: false, gate: null, exitZone: null,
    items: [], itemId: 0, traps: [], petards: [],
    piles: [], pileId: 0,
    flashUntil: 0, nextFlash: 0, flashId: 0,
    stats: {},            // id -> { fuses, kills, wounds }
    feed: [],
    playAt: 0, timeUpAt: 0, endAt: 0, phaseEnd: 0,
    lastRound: null,
    loop: null, lastTickAt: 0,
    fields: {}, fieldsAt: 0, killerField: null,
    fx: [], fxId: 0,
    final: false, finishAt: 0, finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const survivors = () => Object.keys(g.heroes).filter((id) => !g.heroes[id].killer && g.heroes[id].alive && !g.heroes[id].escaped);
  const K_ = () => g.heroes[g.killer];
  const durationMs = () => g.settings.duration * 1000;
  const roomLit = (r, t = now()) => !!r && r.lamp !== undefined && (g.lit[r.id]?.until || 0) > t;
  const envOf = (s) => ({
    walls: true, w: g.manor.w, h: g.manor.h, rects: g.rectsNow, push: !s.killer, noDash: true,
    speedMul: s.killer ? KILLER_SPEED : now() < s.rushUntil ? RUSH : s.web >= 0 ? 0.6 : s.wounded ? WOUND_SLOW : 1,
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
      round: g.round, rounds: g.rounds,
      killer: g.killer,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      manor: g.manor && { seed: g.manor.seed, n: g.manor.nPlayers },
      heroes: Object.entries(g.heroes).map(([id, s]) => ({
        id, seq: s.seq, killer: s.killer, alive: s.alive, wounded: s.wounded, escaped: s.escaped, hidden: s.hidden,
        carry: s.carry != null, item: s.item, lamp: s.lamp && s.bat > 0, bat: Math.round(s.bat * 100) / 100, exp: !!s.exp, web: s.web,
        rush: t < s.rushUntil, frozen: t < s.frozenUntil, trapped: t < s.trappedUntil, searching: t < s.searchUntil, wipe: t < s.wipeUntil,
        aim: Math.round((s.aim ?? s.h.face) * 100) / 100,
        x: s.h.x, y: s.h.y, vx: s.h.vx, vy: s.h.vy, face: s.h.face, walk: s.h.walk, stun: s.h.stun, dash: s.h.dash, dashT: 0, pushT: s.h.pushT, heavy: 0,
      })),
      doors: g.doors.map((d) => (d.open ? "1" : "0")).join(""),
      lit: Object.entries(g.lit).filter(([, v]) => v.until > t).map(([id, v]) => [Number(id), v.until - t]),
      webs: g.webs.map((w) => (w ? "1" : "0")).join(""),
      fuses: g.fuses.map((f) => ({ id: f.id, x: Math.round(f.x), y: Math.round(f.y), carrier: f.carrier, done: f.done })),
      box: g.box, gateOpen: g.gateOpen, gate: g.gate,
      items: g.items.filter((i) => !i.back).map(({ id, x, y, type }) => ({ id, x, y, type })),
      traps: g.traps.map(({ id, x, y }) => ({ id, x, y })),
      petards: g.petards.map(({ id, x, y, at }) => ({ id, x, y, left: Math.max(0, at - t) })),
      piles: g.piles.filter((p) => !p.back).map(({ id, x, y }) => ({ id, x, y })),
      flashLeft: Math.max(0, g.flashUntil - t), flashId: g.flashId,
      phaseLeft: Math.max(0, g.phaseEnd - t),
      timeLeft: g.phase === "play" ? Math.max(0, g.timeUpAt - t) : g.phase === "countdown" ? durationMs() : 0,
      wakeIn: g.phase === "play" ? Math.max(0, g.playAt + WAKE_MS - t) : WAKE_MS,
      feed: g.feed.slice(-4),
      lastRound: g.lastRound,
      fx: g.fx.filter((f) => t - f.t < 900).map(({ id, x, y, kind }) => ({ id, x, y, kind })),
      playlist: ctx.playlist && { final: g.final },
      finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
    };
  }

  // =================================================================
  //  DÉROULÉ : autant de manches que de joueurs, chacun tueur une fois
  // =================================================================
  function startGame() {
    g.scores = {};
    g.round = 0;
    const list = players().filter((p) => p.connected);
    g.order = shuffle(list.map((p) => p.id));
    g.rounds = g.order.length;
    for (const p of list) g.scores[p.id] = 0;
    startRound();
  }

  function startRound() {
    const list = shuffle(players().filter((p) => p.connected));
    g.round++;
    // Le tueur de cette manche (s'il est parti, le suivant dans l'ordre).
    let kid = g.order[g.round - 1];
    if (!list.some((p) => p.id === kid)) kid = g.order.find((id) => list.some((p) => p.id === id)) || list[0].id;
    g.killer = kid;
    g.manor = M.build(Math.floor(Math.random() * 1e9), list.length);
    g.manor.nPlayers = list.length;
    const m = g.manor, nav = m.nav;
    g.spots = M.hideSpots(m).map((s) => ({ ...s, who: null }));
    g.doors = m.doors.map((d) => ({ open: !d.ext, force: 0, touched: false }));
    refreshDoors();
    g.lit = {};
    g.creakCd = m.creaks.map(() => 0);
    g.webs = m.webs.map(() => true);
    const freeCell = (filter) => { for (let k = 0; k < 200; k++) { const c = Math.floor(Math.random() * nav.free.length); if (!nav.free[c]) continue; const p = M.centerOf(nav, c); if (!filter || filter(p)) return p; } return M.centerOf(nav, nav.free.findIndex((v) => v)); };
    // Le portail du jardin (la sortie) et le tableau électrique (dans la cave ou une pièce du fond).
    const portail = m.deco.find((d) => d.kind === "portail");
    g.gate = { x: portail.x, y: portail.y, w: portail.w };
    g.exitZone = { x: portail.x - 10, y: portail.y - 70, w: portail.w + 20, h: 70 };
    const boxRooms = m.rooms.filter((r) => r.cave || r.cy === 0);
    const br = pick(boxRooms);
    const bp = M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, br.x + br.w / 2, br.y + br.h / 2)));
    g.box = { x: bp.x, y: bp.y };
    g.gateOpen = false;
    // Les fusibles, éparpillés loin les uns des autres.
    const nF = list.length >= 5 ? 4 : 3;
    g.fuses = [];
    for (let k = 0; k < nF; k++) {
      let best = null, bd = -1;
      for (let t = 0; t < 30; t++) {
        const p = freeCell((q) => dist(q, g.box) > 500);
        const dd = Math.min(dist(p, g.box), ...g.fuses.map((f) => dist(f, p)));
        if (dd > bd) { bd = dd; best = p; }
      }
      g.fuses.push({ id: k, x: best.x, y: best.y, carrier: null, done: false });
    }
    // Les humains : chacun dans une pièce du manoir ; le tueur dans la pièce la plus loin d'eux.
    const manorRooms = m.rooms.filter((r) => !r.cave && r.kind !== "couloir");
    const roomSpot = (r) => M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, r.x + r.w / 2 + rand(-30, 30), r.y + r.h / 2 + rand(-20, 20))));
    const rooms = shuffle(manorRooms);
    const spots = [];
    list.filter((p) => p.id !== kid).forEach((p, i) => spots.push({ id: p.id, ...roomSpot(rooms[i % rooms.length]) }));
    const d = M.field(nav, spots.map((s) => M.cellOf(nav, s.x, s.y)));
    let far = rooms[0], fd = -1;
    for (const r of manorRooms) { const p = roomSpot(r), dd = d[M.cellOf(nav, p.x, p.y)]; if (dd > fd) { fd = dd; far = r; } }
    spots.push({ id: kid, ...roomSpot(far) });
    g.heroes = {};
    g.stats = {};
    for (const sp of spots) {
      const p = list.find((x) => x.id === sp.id);
      const killer = sp.id === kid;
      g.heroes[sp.id] = {
        h: H.newHero(sp.x, sp.y, rand(-Math.PI, Math.PI)), killer, alive: true, wounded: false, escaped: false, hidden: -1,
        carry: null, item: null, lamp: !killer, bat: 1, exp: false, web: -1, creakUntil: 0, tpUntil: 0,
        rushUntil: 0, frozenUntil: 0, trappedUntil: 0, searchUntil: 0, searchSpot: -1, wipeUntil: 0, knifeAt: 0,
        bot: !!p.bot, seq: 0, lastInputAt: 0, ai: {}, prevK: 0, aim: null,
      };
      g.stats[sp.id] = { fuses: 0, kills: 0, wounds: 0 };
      g.scores[sp.id] = g.scores[sp.id] || 0;
    }
    // Objets et piles.
    g.items = [];
    for (let k = 0; k < list.length + 3; k++) g.items.push({ id: ++g.itemId, type: ITEMS[k % 3], ...freeCell(), back: 0 });
    g.traps = []; g.petards = [];
    g.piles = [];
    for (let k = 0; k < list.length + 2; k++) g.piles.push({ id: ++g.pileId, ...freeCell(), back: 0 });
    g.feed = []; g.fx = [];
    g.fields = {}; g.fieldsAt = 0; g.killerField = null;
    g.flashUntil = 0; g.endAt = 0; g.lastRound = null;
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    g.lastTickAt = now();
    say(`🔪 ${pseudo(kid)} est le tueur !`);
    startLoop();
  }

  function say(text) { g.feed.push({ id: ++g.fxId, text }); if (g.feed.length > 10) g.feed.shift(); }
  function addFx(x, y, kind) { g.fx.push({ id: ++g.fxId, t: now(), x: Math.round(x), y: Math.round(y), kind }); if (g.fx.length > 50) g.fx.shift(); }
  // Un bruit : le tueur le voit (une onde) de partout.
  const noise = (x, y) => addFx(x, y, "noise");

  function checkEnd() {
    if (!g.endAt && survivors().length === 0) g.endAt = now() + END_DELAY;
  }

  // Un coup de couteau : blessé, puis mort.
  function stab(id) {
    const v = g.heroes[id], t = now();
    if (!v.alive) return;
    if (!v.wounded) {
      v.wounded = true;
      v.rushUntil = t + RUSH_MS;
      g.stats[g.killer].wounds++;
      v.h.stun = 0.3;
      addFx(v.h.x, v.h.y, "blood");
      say(`🩸 ${pseudo(id)} est blessé !`);
    } else {
      v.alive = false;
      v.lamp = false;
      g.stats[g.killer].kills++;
      addFx(v.h.x, v.h.y, "kill");
      say(`💀 ${pseudo(g.killer)} a tué ${pseudo(id)} !`);
      if (v.carry != null) { const f = g.fuses[v.carry]; f.carrier = null; f.x = v.h.x; f.y = v.h.y; v.carry = null; }
      if (v.hidden >= 0) { g.spots[v.hidden].who = null; v.hidden = -1; }
      checkEnd();
    }
  }

  function endRound() {
    stopLoop();
    const gains = {};
    for (const [id, s] of Object.entries(g.heroes)) {
      const st = g.stats[id];
      gains[id] = s.killer ? st.kills * KILL + st.wounds * WOUND : st.fuses * PER_FUSE + (s.escaped ? ESCAPE : 0);
    }
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.lastRound = {
      gains, killer: g.killer,
      escaped: Object.keys(g.heroes).filter((id) => g.heroes[id].escaped),
      dead: Object.keys(g.heroes).filter((id) => !g.heroes[id].alive),
      caught: Object.keys(g.heroes).filter((id) => !g.heroes[id].killer && g.heroes[id].alive && !g.heroes[id].escaped),
      stats: g.stats, fusesDone: g.fuses.filter((f) => f.done).length, fusesTotal: g.fuses.length,
    };
    const last = g.round >= g.rounds;
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
  //  ESPACE : porte, cachette, interrupteur (sinon : pousser)
  // =================================================================
  function interactable(s) {
    let best = null, bd = 1e9;
    g.manor.doors.forEach((d, i) => { const dd = distRect(s.h, d); if (dd < REACH - H.R && dd < bd) { bd = dd; best = { door: i }; } });
    for (const sp of g.spots) { const dd = dist(s.h, sp); if (dd < HIDE_REACH && dd < bd) { bd = dd; best = { spot: sp.id }; } }
    if (!s.killer) for (const sw of g.manor.switches) { const dd = dist(s.h, sw); if (dd < SWITCH_REACH && dd < bd) { bd = dd; best = { sw }; } }
    return best;
  }
  function useThing(id, s, it) {
    const t = now();
    if (it.door !== undefined) {
      if (s.killer) return;   // (le tueur ne rouvre pas : il défonce)
      const st = g.doors[it.door], d = g.manor.doors[it.door];
      if (st.open) {
        if (Object.values(g.heroes).some((o) => o.alive && o.hidden < 0 && !o.escaped && distRect(o.h, d) < H.R)) return;
        st.open = false;
        addFx(d.x + d.w / 2, d.y + d.h / 2, "door");
        noise(d.x + d.w / 2, d.y + d.h / 2);
      } else { st.open = true; st.force = 0; }
      refreshDoors();
    } else if (it.spot !== undefined) {
      const sp = g.spots[it.spot];
      if (s.killer) {
        // Le tueur fouille la cachette (1 s, il ne bouge plus).
        s.searchUntil = t + SEARCH_MS; s.searchSpot = sp.id;
        addFx(sp.x, sp.y, "search");
      } else if (!sp.who) {
        s.hidden = sp.id; sp.who = id; s.lamp = false;
        s.h.x = sp.x; s.h.y = sp.y; s.h.vx = 0; s.h.vy = 0;
      }
    } else if (it.sw) {
      const L = (g.lit[it.sw.room] ||= { until: 0, cd: 0 });
      if (L.until > t || t < L.cd) return;
      L.until = t + LUSTRE_MS; L.cd = L.until + LUSTRE_CD;
      addFx(it.sw.x, it.sw.y, "switch");
    }
  }

  // Clic droit : utiliser son objet.
  function useItem(id, s) {
    const t = now();
    if (!s.item) return;
    if (s.item === "trousse") { if (!s.wounded) return; s.wounded = false; addFx(s.h.x, s.h.y, "heal"); }
    else if (s.item === "piege") { g.traps.push({ id: ++g.itemId, x: s.h.x, y: s.h.y }); addFx(s.h.x, s.h.y, "trapset"); }
    else if (s.item === "petard") {
      const a = s.aim ?? s.h.face;
      let x = s.h.x + Math.cos(a) * PETARD_RANGE, y = s.h.y + Math.sin(a) * PETARD_RANGE;
      // (il s'arrête sur le premier mur)
      for (let k = 1; k <= 10; k++) { const px = s.h.x + Math.cos(a) * PETARD_RANGE * k / 10, py = s.h.y + Math.sin(a) * PETARD_RANGE * k / 10; if (g.rectsNow.some((o) => px > o.x && px < o.x + o.w && py > o.y && py < o.y + o.h)) { x = s.h.x + Math.cos(a) * PETARD_RANGE * (k - 1) / 10; y = s.h.y + Math.sin(a) * PETARD_RANGE * (k - 1) / 10; break; } }
      g.petards.push({ id: ++g.itemId, x, y, at: t + PETARD_DELAY });
    }
    s.item = null;
  }

  // =================================================================
  //  UN JOUEUR AGIT
  // =================================================================
  function act(id, k, aim) {
    const s = g.heroes[id];
    if (!s.alive || s.escaped) return;
    const t = now();
    if (typeof aim === "number") s.aim = aim;
    const press = (bit) => (k & bit) && !(s.prevK & bit);
    // Caché : on ne bouge pas ; Espace pour ressortir.
    if (s.hidden >= 0) {
      if (g.phase === "play" && press(K.DASH)) { g.spots[s.hidden].who = null; s.hidden = -1; }
      s.prevK = k;
      return;
    }
    const still = t < s.frozenUntil || t < s.trappedUntil || t < s.searchUntil || (s.killer && t < s.wipeUntil);
    let move = still ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH);
    if (g.phase === "play" && !still) {
      if (s.killer) {
        // Clic : coup de couteau devant soi.
        if (press(K.FIRE) && t - s.knifeAt > KNIFE_CD) {
          s.knifeAt = t;
          addFx(s.h.x + Math.cos(s.aim ?? s.h.face) * 30, s.h.y + Math.sin(s.aim ?? s.h.face) * 30, "swing");
          for (const vid of survivors()) {
            const v = g.heroes[vid];
            if (v.hidden >= 0) continue;
            const dx = v.h.x - s.h.x, dy = v.h.y - s.h.y, d = Math.hypot(dx, dy);
            if (d > KNIFE_REACH + H.R || Math.abs(angDiff(Math.atan2(dy, dx), s.aim ?? s.h.face)) > KNIFE_ANGLE) continue;
            stab(vid);
            s.wipeUntil = t + WIPE_MS;
            break;
          }
        }
      } else {
        if (press(K.FIRE)) s.lamp = !s.lamp;
        if (press(USE)) useItem(id, s);
      }
      if (press(K.DASH)) { const it = interactable(s); if (it) { useThing(id, s, it); move &= ~K.DASH; } }
      else if ((k & K.DASH) && interactable(s)) move &= ~K.DASH;
    }
    s.prevK = k;
    if (s.hidden >= 0) return;
    const env = envOf(s), dt = H.TICK / H.SUB;
    for (let sub = 0; sub < H.SUB; sub++) {
      H.drive(s.h, move, s.aim, dt, env);
      if (s.h.pushed) {
        s.h.pushed = false;
        const others = Object.entries(g.heroes).filter(([oid, o]) => oid !== id && o.alive && o.hidden < 0 && !o.escaped).map(([, o]) => o.h);
        for (const hh of H.applyPush(s.h, others)) addFx((s.h.x + hh.x) / 2, (s.h.y + hh.y) / 2, "push");
      }
      H.collideWalls(s.h, env);
      for (const [oid, o] of Object.entries(g.heroes)) if (oid !== id && o.alive && o.hidden < 0 && !o.escaped) H.collideHeroes(s.h, o.h);
    }
    // Le tueur qui pousse contre une porte fermée la défonce.
    if (s.killer && (move & (K.UP | K.DOWN | K.LEFT | K.RIGHT))) {
      g.manor.doors.forEach((d, i) => {
        const st = g.doors[i];
        if (st.open || distRect(s.h, d) > H.R + 4) return;
        st.force += H.TICK; st.touched = true;
        if (st.force >= FORCE_S) { st.open = true; st.force = 0; refreshDoors(); addFx(d.x + d.w / 2, d.y + d.h / 2, "bang"); noise(d.x + d.w / 2, d.y + d.h / 2); }
      });
      for (const sw of g.manor.switches) { const L = g.lit[sw.room]; if (L && L.until > t && dist(s.h, sw) < 34) { L.until = t; L.cd = t + LUSTRE_CD; } }
    }
  }

  // =================================================================
  //  LE MONDE : fouilles, pièges, pétards, fusibles, portail, lumières…
  // =================================================================
  function stepWorld(dt) {
    const t = now(), m = g.manor, Kh = K_();
    if (t >= g.nextFlash) { g.flashUntil = t + FLASH_MS; g.flashId++; g.nextFlash = t + rand(15000, 30000); }
    const flash = t < g.flashUntil;
    // Fin d'une fouille.
    if (Kh && Kh.searchSpot >= 0 && t >= Kh.searchUntil) {
      const sp = g.spots[Kh.searchSpot];
      Kh.searchSpot = -1;
      if (sp.who) {
        const vid = sp.who, v = g.heroes[vid];
        sp.who = null; v.hidden = -1;
        v.h.x = sp.x + (Kh.h.x < sp.x ? 20 : -20); v.h.y = sp.y;
        stab(vid);
        Kh.wipeUntil = t + WIPE_MS;
        say(`🔦 ${pseudo(vid)} a été trouvé dans sa cachette !`);
      }
    }
    // Pièges à loup.
    if (Kh) for (const tr of [...g.traps]) if (dist(Kh.h, tr) < 22) { Kh.trappedUntil = t + TRAP_MS; Kh.h.vx = 0; Kh.h.vy = 0; g.traps = g.traps.filter((x) => x !== tr); addFx(tr.x, tr.y, "trap"); say("🪤 Le tueur est pris dans un piège !"); noise(tr.x, tr.y); }
    // Pétards.
    for (const p of [...g.petards]) if (t >= p.at) { g.petards = g.petards.filter((x) => x !== p); addFx(p.x, p.y, "boom"); noise(p.x, p.y); }
    // Batteries.
    for (const id of survivors()) { const s = g.heroes[id]; if (s.lamp) { s.bat = Math.max(0, s.bat - DRAIN * dt); if (s.bat <= 0) s.lamp = false; } }
    // Les humains : planches qui craquent, toiles, objets, fusibles, piles, sortie, « repérables » par le tueur.
    for (const id of survivors()) {
      const s = g.heroes[id];
      if (s.hidden >= 0) { s.exp = false; continue; }
      m.creaks.forEach((c, i) => { if (t >= g.creakCd[i] && M.inRect(s.h.x, s.h.y, c)) { g.creakCd[i] = t + 1500; s.creakUntil = t + 2000; noise(c.x + c.w / 2, c.y + c.h / 2); } });
      const w = m.webs.findIndex((wb, i) => g.webs[i] && M.inRect(s.h.x, s.h.y, wb));
      if (s.web >= 0 && w !== s.web) g.webs[s.web] = false;
      s.web = w;
      for (const it of g.items) if (!it.back && !s.item && dist(s.h, it) < H.R + 14) { s.item = it.type; it.back = t + ITEM_RESPAWN; addFx(it.x, it.y, "pick"); }
      for (const f of g.fuses) if (!f.done && f.carrier == null && s.carry == null && dist(s.h, f) < H.R + 14) { f.carrier = id; s.carry = f.id; addFx(f.x, f.y, "pick"); }
      if (s.carry != null && dist(s.h, g.box) < 46) {
        const f = g.fuses[s.carry];
        f.done = true; f.carrier = null; f.x = g.box.x; f.y = g.box.y; s.carry = null;
        g.stats[id].fuses++;
        addFx(g.box.x, g.box.y, "fuse");
        const left = g.fuses.filter((x) => !x.done).length;
        say(left ? `⚡ ${pseudo(id)} a branché un fusible ! (encore ${left})` : "🚨 Tous les fusibles sont branchés : LE PORTAIL EST OUVERT !");
        if (!left) { g.gateOpen = true; noise(g.box.x, g.box.y); }
      }
      for (const p of g.piles) if (!p.back && dist(s.h, p) < H.R + 14 && s.bat < 0.98) { s.bat = Math.min(1, s.bat + PILE); p.back = t + PILE_RESPAWN; }
      if (g.gateOpen && M.inRect(s.h.x, s.h.y, g.exitZone)) {
        s.escaped = true; s.lamp = false;
        if (s.carry != null) { const f = g.fuses[s.carry]; f.carrier = null; s.carry = null; }
        addFx(s.h.x, s.h.y, "escape");
        say(`🏃 ${pseudo(id)} s'est échappé !`);
        checkEnd();
        continue;
      }
      const zone = M.zoneOf(m, s.h.x, s.h.y);
      s.exp = (s.lamp && s.bat > 0) || t < s.creakUntil || roomLit(M.roomAt(m, s.h.x, s.h.y), t) || (flash && zone !== "cave");
    }
    // Les fusibles portés suivent leur porteur.
    for (const f of g.fuses) if (f.carrier) { const c = g.heroes[f.carrier]; f.x = c.h.x; f.y = c.h.y; }
    for (const p of g.items) if (p.back && t >= p.back) { Object.assign(p, M.centerOf(m.nav, randomFree()), { back: 0, id: ++g.itemId }); }
    for (const p of g.piles) if (p.back && t >= p.back) { Object.assign(p, M.centerOf(m.nav, randomFree()), { back: 0, id: ++g.pileId }); }
    // Escaliers et passages secrets.
    for (const s of Object.values(g.heroes)) {
      if (!s.alive || s.escaped || s.hidden >= 0 || t < s.tpUntil) continue;
      for (const p of m.portals) {
        for (const [a, b] of [[p.a, p.b], [p.b, p.a]]) {
          if (Math.hypot(s.h.x - a.x, s.h.y - a.y) > M.PAD) continue;
          const nx = (a.ex - a.x) / 46, ny = (a.ey - a.y) / 46;
          if (s.h.vx * nx + s.h.vy * ny > -40) continue;
          addFx(s.h.x, s.h.y, p.kind);
          s.h.x = b.ex; s.h.y = b.ey; s.h.vx = 0; s.h.vy = 0;
          s.tpUntil = t + TP_CD;
          break;
        }
        if (t < s.tpUntil) break;
      }
    }
    for (const st of g.doors) { if (!st.touched) st.force = Math.max(0, st.force - dt * 0.5); st.touched = false; }
  }
  function randomFree() { const nav = g.manor.nav; for (let k = 0; k < 200; k++) { const c = Math.floor(Math.random() * nav.free.length); if (nav.free[c]) return c; } return nav.free.findIndex((v) => v); }

  // Le tueur voit-il cet humain ? (cône de regard sans mur, ou repérable de partout)
  function killerSees(Kh, o) {
    if (o.hidden >= 0) return false;
    if (o.exp) return true;
    return M.inCone(g.blockNow, Kh.h.x, Kh.h.y, Kh.aim ?? Kh.h.face, o.h.x, o.h.y, M.SIGHT_RANGE, M.SIGHT_HALF, 10) || dist(Kh.h, o.h) < 50;
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
  const space = (s) => (s.prevK & K.DASH ? 0 : K.DASH);
  function updateFields(t) {
    if (t - g.fieldsAt < 300) return;
    g.fieldsAt = t;
    const nav = g.manor.nav;
    g.fields = {};
    for (const id of survivors()) { const h = g.heroes[id].h; g.fields[id] = M.field(nav, [M.nearestFree(nav, M.cellOf(nav, h.x, h.y))]); }
    const Kh = K_();
    g.killerField = Kh ? M.field(nav, [M.nearestFree(nav, M.cellOf(nav, Kh.h.x, Kh.h.y))]) : null;
  }
  function awayFrom(h) {
    const nav = g.manor.nav, f = g.killerField;
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
  const goTo = (s, p) => {
    const ai = s.ai, nav = g.manor.nav;
    if (!ai.goTo || dist(ai.goTo, p) > 30) { ai.goTo = { x: p.x, y: p.y }; ai.goField = M.field(nav, [M.nearestFree(nav, M.cellOf(nav, p.x, p.y))]); }
    return dist(s.h, p) < 30 ? keyToward(s.h, p) : keyToward(s.h, M.lookAhead(nav, ai.goField, s.h.x, s.h.y, 2));
  };

  // Un humain bot : fusibles → tableau → portail ; fuit / se cache / pose un piège quand le tueur approche.
  function survivorBot(id, s) {
    const h = s.h, ai = s.ai, t = now(), Kh = K_();
    if (s.hidden >= 0) {
      // Il ressort quand le tueur est loin depuis un moment.
      const far = !Kh || dist(Kh.h, h) > 350;
      ai.hideT = far ? (ai.hideT || 0) + H.TICK : 0;
      return { k: ai.hideT > 3 ? space(s) : 0, aim: null };
    }
    const kd = Kh ? dist(Kh.h, h) : 1e9;
    const threat = Kh && t >= Kh.frozenUntil && (kd < 230 || (s.lamp && kd < 400));
    let k = 0, aim = ai.aim ?? h.face;
    // Lampe : allumée un peu, éteinte quand le tueur est là (on se cache dans le noir).
    if (!ai.lampAt || t > ai.lampAt) { ai.lampAt = t + rand(3000, 7000); ai.lampPref = Math.random() < 0.35; }
    const want = !threat && ai.lampPref && s.bat > 0.3;
    if (want !== s.lamp && !(s.prevK & K.FIRE)) k |= K.FIRE;
    if (s.item === "trousse" && s.wounded && !(s.prevK & USE)) k |= USE;
    if (threat) {
      // Se cacher si une cachette est tout près et que le tueur ne le voit pas encore ; sinon fuir (et poser un piège).
      const sp = g.spots.find((p) => !p.who && dist(p, h) < HIDE_REACH);
      if (sp && kd > 120 && !killerSees(Kh, s) && Math.random() < 0.5) return { k: space(s), aim };
      if (s.item === "piege" && kd < 200 && !(s.prevK & USE)) k |= USE;
      if (s.item === "petard" && kd < 260 && !(s.prevK & USE)) { k |= USE; aim = Math.atan2(h.y - Kh.h.y, h.x - Kh.h.x) + Math.PI / 2; }
      k |= keyToward(h, awayFrom(h));
      if (kd < 46) k |= space(s);
    } else {
      let goal = null;
      if (g.gateOpen) goal = { x: g.exitZone.x + g.exitZone.w / 2, y: g.exitZone.y + g.exitZone.h / 2 };
      else if (s.carry != null) goal = g.box;
      else {
        const f = g.fuses.filter((x) => !x.done && x.carrier == null).sort((a, b) => dist(a, h) - dist(b, h))[0];
        if (f) goal = f;
        else {
          const it = g.items.filter((i) => !i.back).sort((a, b) => dist(a, h) - dist(b, h))[0];
          if (!s.item && it && dist(it, h) < 500) goal = it;
          else { if (!ai.wander || dist(ai.wander, h) < 30) ai.wander = M.centerOf(g.manor.nav, randomFree()); goal = ai.wander; }
        }
      }
      k |= goTo(s, goal);
      aim = Math.hypot(h.vx, h.vy) > 40 ? Math.atan2(h.vy, h.vx) : aim;
      // Une porte fermée qui bloque : on l'ouvre.
      const it = interactable(s);
      const sp = Math.hypot(h.vx, h.vy);
      ai.stuck = (k & 15) && sp < 25 ? (ai.stuck || 0) + H.TICK : 0;
      if (it?.door !== undefined && !g.doors[it.door].open && ai.stuck > 0.3) k |= space(s);
    }
    ai.aim = aim;
    return { k, aim };
  }

  // Le tueur bot : il ne voit que ce que voit un vrai tueur, va voir les bruits, fouille les cachettes.
  function killerBot(id, s) {
    const h = s.h, ai = s.ai, t = now(), nav = g.manor.nav;
    let target = null, best = 1e9;
    const c = M.nearestFree(nav, M.cellOf(nav, h.x, h.y));
    for (const vid of survivors()) {
      const o = g.heroes[vid], f = g.fields[vid];
      if (!f || !killerSees(s, o)) continue;
      const d = f[c] < 0 ? 1e6 : f[c];
      if (d < best) { best = d; target = vid; }
    }
    // Les bruits récents : il va voir.
    const heard = g.fx.filter((f) => f.kind === "noise" && t - f.t < 1500).sort((a, b) => b.t - a.t)[0];
    if (heard && (!ai.clue || ai.clueId !== heard.id)) { ai.clue = { x: heard.x, y: heard.y }; ai.clueAt = t; ai.clueId = heard.id; ai.clueField = null; }
    if (target) { const o = g.heroes[target].h; if (!ai.clue || dist(ai.clue, o) > 80) { ai.clue = { x: o.x, y: o.y }; ai.clueField = null; } ai.clueAt = t; }
    let k = 0, goal;
    if (target) {
      const o = g.heroes[target];
      goal = dist(o.h, h) < 70 ? o.h : M.lookAhead(nav, g.fields[target], h.x, h.y, 2);
      if (dist(o.h, h) < KNIFE_REACH + H.R - 4 && !(s.prevK & K.FIRE)) k |= K.FIRE;
    } else if (ai.clue && t - ai.clueAt < 7000 && dist(ai.clue, h) > 40) {
      ai.clueField ||= M.field(nav, [M.nearestFree(nav, M.cellOf(nav, ai.clue.x, ai.clue.y))]);
      goal = M.lookAhead(nav, ai.clueField, h.x, h.y, 2);
    } else {
      // Il patrouille : les fusibles pas encore branchés, le tableau, des pièces au hasard ; il fouille les cachettes croisées.
      const sp = g.spots.find((p) => dist(p, h) < HIDE_REACH - 4 && !(ai.searched || []).includes(p.id));
      if (sp && Math.random() < 0.35) { (ai.searched ||= []).push(sp.id); if (ai.searched.length > 6) ai.searched.shift(); return { k: space(s), aim: Math.atan2(sp.y - h.y, sp.x - h.x) }; }
      if (!ai.roam || dist(ai.roam, h) < 40 || Math.random() < 0.002) {
        const pool = [g.box, ...g.fuses.filter((f) => !f.done && !f.carrier)];
        ai.roam = Math.random() < 0.4 ? pick(pool) : M.centerOf(nav, randomFree());
        ai.roamField = M.field(nav, [M.nearestFree(nav, M.cellOf(nav, ai.roam.x, ai.roam.y))]);
      }
      goal = M.lookAhead(nav, ai.roamField, h.x, h.y, 2);
    }
    if (!target && g.gateOpen && Math.random() < 0.02) ai.roam = { x: g.exitZone.x + g.exitZone.w / 2, y: g.exitZone.y - 60 };
    k |= keyToward(h, goal);
    ai.wob = (ai.wob || 0) + H.TICK;
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
        if (K_()) K_().frozenUntil = t + WAKE_MS;
      }
    } else if (g.phase === "play") {
      updateFields(t);
      for (const [id, s] of Object.entries(g.heroes)) {
        if (!s.alive || s.escaped) continue;
        if (s.bot) { const b = s.killer ? killerBot(id, s) : survivorBot(id, s); act(id, b.k, b.aim); }
        else if (t - s.lastInputAt > 200) act(id, 0, s.aim);
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
    const s = g.heroes[id];
    if (s.hidden >= 0) g.spots[s.hidden].who = null;
    if (s.carry != null) { const f = g.fuses[s.carry]; f.carrier = null; }
    delete g.heroes[id];
    if (g.phase === "play" && (id === g.killer || survivors().length === 0) && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![120, 180, 240].includes(s.duration)) s.duration = 180;
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
    // Touches + visée : { s, k, a }
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
