// ===================================================================
//  SUMO — Moteur du jeu (module du hub Le Bordel)
//  Les petites voitures de Patate chaude, mais autour c'est le VIDE.
//  À chaque manche, tirés au hasard :
//   - la version : Arène (rond qui rétrécit) ou Îles (zone sûre à rejoindre)
//   - le mode : FFA (chacun pour soi) ou 2 équipes (si nombre pair)
//  Le serveur calcule tout 30 fois par seconde (même physique que le navigateur).
// ===================================================================

import "../../public/games/patate/physics.js";
import "../../public/games/sumo/ground.js";
import { arenaMap, islandsMap } from "./maps.js";

const P = globalThis.PatatePhysics;
const G = globalThis.SumoGround;
const K = P.K;

export const meta = {
  id: "sumo",
  name: "Sumo",
  emoji: "🤼",
  family: "Action",
  minPlayers: 3,
  maxPlayers: 6,
  description: "Pousse les autres voitures dans le vide !",
};

// --- Rythme ---
const TICK_MS = 1000 / 30;
const COUNTDOWN_MS = 3000;
const FALL_MS = 1000;          // durée de la chute avant d'être éliminé
const EJECT_WINDOW = 3000;     // dernier contact compté comme une éjection (ms)
const END_DELAY = 1500;        // on regarde encore la fin (la chute, le gagnant) avant le tableau des scores
const ARENA_DELAY = 10000;     // l'arène commence à rétrécir après 10 s
const ARENA_MIN_R = 40;        // ...jusqu'à presque rien (la manche finit forcément)
const ZONE_PAUSE = 5000;       // pause entre deux zones sûres
const FIRST_ZONE = 3000;       // première zone 3 s après le départ
const FINISH_DELAY = 15000;    // playlist : temps pour lire les résultats
const TEAM_COLORS = { red: "#ff4d4d", blue: "#3d8bff" };
const SHRINK = { lent: 90000, normal: 60000, rapide: 40000 };   // durée du rétrécissement
const PICK_MS = 10000;         // temps pour choisir sa carte de véhicule
const POWER_FIRST = 5000;      // premier power-up 5 s après le départ
const POWER_RESPAWN = 10000;   // un nouveau réapparaît 10 s après avoir été pris
const POWER_COOLDOWN = 35000;  // un joueur ne peut en reprendre un qu'après 35 s
const POWER_REACH = 18;        // distance de ramassage (en plus de la demi-longueur du véhicule)

function defaultSettings() {
  return { variant: "random", mode: "auto", shrink: "normal", zoneTime: 15, nitro: true, cards: "same" };
}

// ===================================================================
//  MODE PLAYLIST : options votables
// ===================================================================
export const playlist = {
  options: [
    {
      key: "difficulty", label: "Difficulté", default: "normal",
      choices: [
        { v: "facile", label: "😌 Facile", hint: "Arène lente, chrono 20 s" },
        { v: "normal", label: "🙂 Normal", hint: "Arène normale, chrono 15 s" },
        { v: "difficile", label: "😈 Difficile", hint: "Arène rapide, chrono 10 s" },
      ],
    },
    {
      key: "rounds", label: "Nombre de manches", default: "3",
      choices: [{ v: "3", label: "3" }, { v: "5", label: "5" }, { v: "7", label: "7" }],
    },
    {
      key: "nitro", label: "Nitro", default: "oui",
      choices: [{ v: "oui", label: "Oui" }, { v: "non", label: "Non" }],
    },
    {
      key: "cards", label: "Cartes véhicules", default: "same",
      choices: [{ v: "same", label: "Les mêmes pour tous" }, { v: "different", label: "Différentes" }],
    },
  ],
  settingsFor(c) {
    const s = defaultSettings();
    if (c.difficulty === "facile") { s.shrink = "lent"; s.zoneTime = 20; }
    if (c.difficulty === "difficile") { s.shrink = "rapide"; s.zoneTime = 10; }
    s.nitro = c.nitro !== "non";
    s.cards = c.cards === "different" ? "different" : "same";
    return s;
  },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | pick (cartes) | countdown | play | roundOver
    cards: {},            // id -> les 3 véhicules proposés
    picks: {},            // id -> véhicule choisi
    power: null,          // power-up sur la map : { id, x, y }
    powerId: 0,
    powerNextAt: 0,
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    roundNum: 0,
    map: null,
    env: null,
    mode: "ffa",          // "ffa" | "teams"
    cars: {},             // id -> { car, alive, falling, fallAt, team, bot, seq, lastInputAt, lastHit, ejections, ai }
    playStart: 0,
    phaseEnd: 0,
    zone: null,           // { island, start, end }
    zonePauseUntil: 0,
    elimOrder: [],
    feed: [],             // fil d'info : "Bob a éjecté Michel !"
    feedId: 0,
    fx: [],
    fxId: 0,
    lastRound: null,
    loop: null,
    roundsPlayed: 0,
    final: false,
    finishAt: 0,
    finishTimer: null,
  };

  const now = () => Date.now();
  const pseudo = (id) => ctx.players().find((p) => p.id === id)?.pseudo || "?";
  // "Vivant" = encore sur la piste et pas en train de tomber.
  const standing = () => Object.keys(g.cars).filter((id) => g.cars[id].alive && !g.cars[id].falling);
  const enemies = (a, b) => g.mode === "ffa" || g.cars[a].team !== g.cars[b].team;

  // Rayon actuel de l'arène.
  function arenaR(t = now()) {
    if (g.map?.kind !== "arena") return 0;
    if (g.phase !== "play") return g.map.r0;
    const p = Math.min(1, Math.max(0, (t - g.playStart - ARENA_DELAY) / SHRINK[g.settings.shrink]));
    return g.map.r0 - (g.map.r0 - ARENA_MIN_R) * p;
  }

  // =================================================================
  //  ÉTAT PUBLIC
  // =================================================================
  function publicState() {
    const t = now();
    g.fx = g.fx.filter((f) => t - f.t < 700);
    g.feed = g.feed.filter((f) => t - f.t < 5000);
    return {
      t,
      phase: g.phase,
      settings: g.settings,
      roundNum: g.roundNum,
      playlist: ctx.playlist && {
        rounds: ctx.playlist.rounds, played: g.roundsPlayed, final: g.final,
        finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0,
      },
      players: ctx.players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      map: g.map && { ...g.map, spawns: undefined },
      mode: g.mode,
      teamColors: TEAM_COLORS,
      arenaR: arenaR(t),
      shrinking: g.map?.kind === "arena" && g.phase === "play" && t - g.playStart > ARENA_DELAY,
      zone: g.zone && { island: g.zone.island, left: Math.max(0, g.zone.end - t), total: g.zone.end - g.zone.start },
      zoneNextIn: !g.zone && g.map?.kind === "islands" && g.phase === "play" ? Math.max(0, g.zonePauseUntil - t) : null,
      // Phase "cartes" : les véhicules proposés à chacun et ceux déjà choisis.
      cards: g.phase === "pick" ? g.cards : null,
      picks: g.phase === "pick" ? g.picks : null,
      power: g.power,
      powerCooldown: POWER_COOLDOWN,
      cars: Object.entries(g.cars).map(([id, s]) => ({
        id, alive: s.alive, seq: s.seq, team: s.team, type: s.car.type,
        powerIn: Math.max(0, (s.powerReadyAt || 0) - t),   // ms avant de pouvoir reprendre un power-up
        falling: s.falling, fall: s.falling ? Math.min(1, (t - s.fallAt) / FALL_MS) : 0,
        x: s.car.x, y: s.car.y, a: s.car.a, vx: s.car.vx, vy: s.car.vy, w: s.car.w,
        nitro: s.car.nitro, slide: s.car.slide, st: s.car.st, boost: s.car.boost,
      })),
      phaseLeft: Math.max(0, g.phaseEnd - t),
      feed: g.feed.map(({ id, text }) => ({ id, text })),
      fx: g.fx.map(({ id, x, y, s, kind, cars }) => ({ id, x, y, s, kind, cars })),
      lastRound: g.lastRound,
    };
  }

  // =================================================================
  //  DÉROULÉ D'UNE MANCHE
  // =================================================================
  function startRound() {
    const players = ctx.players().filter((p) => p.connected);
    const n = players.length;
    g.roundNum++;

    // Version de la manche (au hasard sauf si l'hôte l'a forcée).
    const variant = g.settings.variant === "random" ? pick(["arena", "islands"]) : g.settings.variant;
    g.map = variant === "arena" ? arenaMap(n) : islandsMap(n);
    g.env = { w: g.map.w, h: g.map.h, grip: 1, oils: [], obstacles: [], nitro: g.settings.nitro, walls: false };

    // Mode : impair = toujours FFA ; pair = au hasard (ou forcé par l'hôte).
    const even = n % 2 === 0;
    g.mode = !even || g.settings.mode === "ffa" ? "ffa"
      : g.settings.mode === "teams" ? "teams"
      : Math.random() < 0.5 ? "teams" : "ffa";
    const teamOf = {};
    if (g.mode === "teams") shuffle(players.map((p) => p.id)).forEach((id, i) => { teamOf[id] = i % 2 ? "blue" : "red"; });

    g.cars = {};
    shuffle(players).forEach((p, i) => {
      const s = g.map.spawns[i];
      g.cars[p.id] = {
        car: P.newCar(s.x, s.y, s.a), alive: true, falling: false, fallAt: 0, team: teamOf[p.id] || null,
        bot: !!p.bot, seq: 0, lastInputAt: 0, lastHit: null, ejections: 0, ai: {},
      };
      g.scores[p.id] = g.scores[p.id] || 0;
    });
    g.elimOrder = [];
    g.endAt = 0;
    g.feed = [];
    g.fx = [];
    g.zone = null;
    g.power = null;
    g.lastRound = null;

    // Les cartes : 3 véhicules au hasard (les mêmes pour tous, ou différents par joueur).
    g.cards = {};
    g.picks = {};
    const draw3 = () => shuffle(P.TYPES).slice(0, 3);
    const shared = draw3();
    for (const p of players) {
      g.cards[p.id] = g.settings.cards === "different" ? draw3() : shared;
      if (p.bot) g.picks[p.id] = pick(g.cards[p.id]);   // les bots choisissent tout de suite
    }
    g.phase = "pick";
    g.phaseEnd = now() + PICK_MS;
    startLoop();
  }

  // Fin du choix des cartes : chacun reçoit son véhicule, puis compte à rebours.
  function endPick() {
    for (const [id, s] of Object.entries(g.cars)) {
      const type = g.picks[id] || pick(g.cards[id] || P.TYPES);   // pas choisi : au hasard parmi ses cartes
      g.picks[id] = type;
      s.car.type = type;
    }
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
  }

  // =================================================================
  //  POWER-UP 🎁 : change de véhicule au hasard (recharge 35 s par joueur)
  // =================================================================
  function randomGroundPoint() {
    if (g.map.kind === "arena") {
      const r = arenaR() * 0.65 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
      return { x: g.map.cx + Math.cos(a) * r, y: g.map.cy + Math.sin(a) * r };
    }
    const I = pick(g.map.islands);
    const r = I.r * 0.7 * Math.sqrt(Math.random()), a = Math.random() * Math.PI * 2;
    return { x: I.x + Math.cos(a) * r, y: I.y + Math.sin(a) * r };
  }

  function powerTick(t) {
    if (!g.power) {
      if (t >= g.powerNextAt) g.power = { id: ++g.powerId, ...randomGroundPoint() };
      return;
    }
    // L'arène a rétréci sous lui ? Il réapparaît ailleurs.
    if (!G.onGround(g.map, g.power.x, g.power.y, arenaR(t) - 25)) { g.power = { id: ++g.powerId, ...randomGroundPoint() }; return; }
    for (const id of standing()) {
      const s = g.cars[id];
      if (t < (s.powerReadyAt || 0)) continue;                           // encore en recharge
      if (Math.hypot(s.car.x - g.power.x, s.car.y - g.power.y) > P.spec(s.car).L / 2 + POWER_REACH) continue;
      const old = s.car.type;
      const type = pick(P.TYPES.filter((ty) => ty !== old));             // toujours un AUTRE véhicule
      s.car.type = type;
      s.powerReadyAt = t + POWER_COOLDOWN;
      addFx(s.car.x, s.car.y, 0, "swap", [id]);
      const V = P.VEHICLES[type];
      say(`🎁 ${pseudo(id)} devient ${V.emoji} ${V.name} !`);
      g.power = null;
      g.powerNextAt = t + POWER_RESPAWN;
      return;
    }
  }

  function say(text) { g.feed.push({ id: ++g.feedId, t: now(), text }); }
  function addFx(x, y, s, kind, cars = []) {
    const t = now();
    if (kind === "spark" && g.fx.some((f) => t - f.t < 150 && Math.hypot(f.x - x, f.y - y) < 40)) return;
    g.fx.push({ id: ++g.fxId, t, x: Math.round(x), y: Math.round(y), s: Math.round(s), kind, cars });
  }

  // La voiture n'a plus de sol sous elle : elle tombe (1 s), puis éliminée.
  function startFall(id) {
    const s = g.cars[id];
    s.falling = true;
    s.fallAt = now();
    s.car.boost = false;
  }

  // Élimination (chute ou explosion de zone).
  function eliminate(id, cause) {
    const s = g.cars[id];
    if (!s.alive) return;
    s.alive = false;
    s.falling = false;
    g.elimOrder.push(id);
    const hit = s.lastHit;
    if (cause === "fall" && hit && now() - hit.t <= EJECT_WINDOW && g.cars[hit.by] && enemies(hit.by, id)) {
      g.cars[hit.by].ejections++;
      say(`💥 ${pseudo(hit.by)} a éjecté ${pseudo(id)} !`);
    } else if (cause === "fall") {
      say(`🌊 ${pseudo(id)} est tombé dans le vide`);
    } else {
      say(`💣 ${pseudo(id)} a explosé (hors de la zone)`);
    }
    checkEnd();
  }

  function explode(id) {
    const c = g.cars[id].car;
    addFx(c.x, c.y, 300, "boom", [id]);
    eliminate(id, "zone");
  }

  // Encore plusieurs voitures (ou équipes) en jeu ?
  function checkEnd() {
    if (g.phase !== "play") return;
    const alive = Object.keys(g.cars).filter((id) => g.cars[id].alive);
    const sides = new Set(alive.map((id) => (g.mode === "teams" ? g.cars[id].team : id)));
    if (sides.size <= 1 && !g.endAt) g.endAt = now() + END_DELAY;
  }

  // Points de la manche.
  function endRound() {
    const ids = Object.keys(g.cars);
    const alive = ids.filter((id) => g.cars[id].alive);
    let rows;
    if (g.mode === "ffa") {
      // 1 point par joueur éliminé avant toi (+ éjections).
      const order = [...g.elimOrder, ...alive];
      rows = order.map((id, i) => ({ id, base: i, place: ids.length - i }));
    } else {
      // Équipe gagnante : 3 points chacun, +1 si encore en vie (+ éjections).
      const winTeam = alive.length ? g.cars[alive[0]].team : null;
      rows = ids.map((id) => {
        const win = g.cars[id].team === winTeam;
        return { id, base: win ? 3 + (g.cars[id].alive ? 1 : 0) : 0, place: win ? 1 : 2, win };
      });
    }
    const list = rows.map((r) => {
      const ej = g.cars[r.id].ejections;
      return { id: r.id, place: r.place, points: r.base + ej, ejections: ej, team: g.cars[r.id].team, alive: g.cars[r.id].alive };
    }).sort((a, b) => a.place - b.place || b.points - a.points);
    for (const r of list) g.scores[r.id] = (g.scores[r.id] || 0) + r.points;
    g.lastRound = {
      mode: g.mode,
      variant: g.map.kind,
      winnerTeam: g.mode === "teams" && alive.length ? g.cars[alive[0]].team : null,
      rows: list,
    };
    g.zone = null;
    g.phase = "roundOver";
    stopLoop();

    g.roundsPlayed++;
    if (ctx.playlist && g.roundsPlayed >= ctx.playlist.rounds) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  // =================================================================
  //  ZONE SÛRE (version Îles)
  // =================================================================
  function zoneTick(t) {
    if (g.map.kind !== "islands" || g.phase !== "play") return;
    if (!g.zone) {
      if (t >= g.zonePauseUntil) {
        const island = Math.floor(Math.random() * g.map.islands.length);   // au hasard parmi TOUTES les îles
        g.zone = { island, start: t, end: t + g.settings.zoneTime * 1000 };
      }
      return;
    }
    // On n'élimine qu'à la FIN du chrono : tous ceux qui ne sont pas sur l'île explosent.
    if (t < g.zone.end) return;
    const isl = g.map.islands[g.zone.island];
    const outside = standing().filter((id) => Math.hypot(g.cars[id].car.x - isl.x, g.cars[id].car.y - isl.y) > isl.r);
    g.zone = null;
    g.zonePauseUntil = t + ZONE_PAUSE;
    for (const id of outside) if (g.phase === "play") explode(id);
  }

  // =================================================================
  //  BOTS AU VOLANT
  // =================================================================
  // Clés pour aller vers (tx, ty) sans tomber.
  function driveTo(s, tx, ty, safe, opts = {}) {
    const c = s.car, ai = s.ai;
    const speed = Math.hypot(c.vx, c.vy);
    ai.reverse = Math.max(0, (ai.reverse || 0) - P.TICK);
    if (ai.wantGo && speed < 25) ai.stuck = (ai.stuck || 0) + P.TICK; else ai.stuck = 0;
    if (ai.stuck > 0.9) { ai.reverse = 0.7; ai.stuck = 0; ai.revSteer = Math.random() < 0.5 ? K.LEFT : K.RIGHT; }
    if (ai.reverse > 0) { ai.wantGo = false; return K.DOWN | ai.revSteer; }

    // Danger : dans 0,45 s on serait dans le vide ? On freine et on vise le point sûr.
    const lx = c.x + c.vx * 0.45, ly = c.y + c.vy * 0.45;
    const danger = !G.onGround(g.map, lx, ly, arenaR() - 25);
    if (danger) { tx = safe.x; ty = safe.y; }

    const diff = angDiff(Math.atan2(ty - c.y, tx - c.x), c.a);
    let k = 0;
    if (diff > 0.1) k |= K.RIGHT; else if (diff < -0.1) k |= K.LEFT;
    const maxSpeed = opts.careful ? 230 : 999;
    if (danger && speed > 120) k |= K.DOWN;
    else if (Math.abs(diff) < 1.6 || speed < 100) { if (speed < maxSpeed) k |= K.UP; ai.wantGo = true; }
    else { k |= K.DOWN; ai.wantGo = false; }
    if (opts.ram && !danger && Math.abs(diff) < 0.2 && Math.random() < 0.06) k |= K.NITRO;
    return k;
  }

  // Cible : la voiture ennemie la plus proche (en visant un peu "à travers" elle).
  function nearestEnemy(id, maxD = Infinity, filter = () => true) {
    const c = g.cars[id].car;
    let best = null, bestD = maxD;
    for (const oid of standing()) {
      if (oid === id || !enemies(id, oid) || !filter(oid)) continue;
      const o = g.cars[oid].car;
      const d = Math.hypot(o.x - c.x, o.y - c.y);
      if (d < bestD) { bestD = d; best = o; }
    }
    return best;
  }

  // Distance (en nombre de couloirs) de chaque île jusqu'à l'île cible.
  function hopsTo(target) {
    const d = g.map.islands.map(() => Infinity);
    d[target] = 0;
    const queue = [target];
    while (queue.length) {
      const a = queue.shift();
      for (const c of g.map.corridors) {
        const b = c.a === a ? c.b : c.b === a ? c.a : -1;
        if (b >= 0 && d[b] === Infinity) { d[b] = d[a] + 1; queue.push(b); }
      }
    }
    return d;
  }

  // Le bot va-t-il chercher le power-up ? (proche, disponible, et pas de zone à rejoindre)
  function botWantsPower(s) {
    const pw = g.power, c = s.car;
    if (!pw || now() < (s.powerReadyAt || 0)) return false;
    if (Math.hypot(pw.x - c.x, pw.y - c.y) > 380) return false;
    if (g.map.kind === "islands") {
      const here = G.islandAt(g.map, c.x, c.y);
      if (here < 0 || here !== G.islandAt(g.map, pw.x, pw.y)) return false;   // seulement sur la même île
      if (g.zone && g.zone.island !== here) return false;                       // la zone d'abord !
    }
    return true;
  }

  function botKeys(id, s) {
    const c = s.car;
    if (botWantsPower(s)) {
      const safe = g.map.kind === "arena" ? { x: g.map.cx, y: g.map.cy } : g.map.islands[G.islandAt(g.map, c.x, c.y)];
      return driveTo(s, g.power.x, g.power.y, safe, { careful: true });
    }
    if (g.map.kind === "arena") {
      const R = arenaR();
      const center = { x: g.map.cx, y: g.map.cy };
      const fromC = Math.hypot(c.x - center.x, c.y - center.y);
      if (fromC > R - 80) return driveTo(s, center.x, center.y, center, { careful: true });
      const e = nearestEnemy(id);
      if (!e) return driveTo(s, center.x, center.y, center, { careful: true });
      // On vise l'ennemi en le poussant vers l'extérieur.
      const ex = e.x - center.x, ey = e.y - center.y, ed = Math.hypot(ex, ey) || 1;
      return driveTo(s, e.x + (ex / ed) * 25 + e.vx * 0.25, e.y + (ey / ed) * 25 + e.vy * 0.25, center, { ram: true });
    }

    // --- Îles ---
    const isls = g.map.islands;
    const here = G.islandAt(g.map, c.x, c.y);
    const zone = g.zone?.island;
    const goal = zone ?? (here >= 0 ? here : null);
    const hops = goal != null ? hopsTo(goal) : null;

    if (here >= 0) {
      const I = isls[here];
      const safe = { x: I.x, y: I.y };
      if (zone == null || here === zone) {
        // Sur la bonne île : on chasse les ennemis de l'île, sinon on reste au centre.
        const e = nearestEnemy(id, 420, (oid) => G.islandAt(g.map, g.cars[oid].car.x, g.cars[oid].car.y) === here);
        if (e) {
          const ex = e.x - I.x, ey = e.y - I.y, ed = Math.hypot(ex, ey) || 1;
          return driveTo(s, e.x + (ex / ed) * 25, e.y + (ey / ed) * 25, safe, { ram: true });
        }
        if (Math.hypot(c.x - I.x, c.y - I.y) < 90) return 0;
        return driveTo(s, I.x, I.y, safe, { careful: true });
      }
      // Il faut rejoindre la zone : île voisine la plus proche du but, en passant par l'entrée du couloir.
      let next = null;
      for (const cor of g.map.corridors) {
        const b = cor.a === here ? cor.b : cor.b === here ? cor.a : -1;
        if (b >= 0 && (next === null || hops[b] < hops[next])) next = b;
      }
      if (next === null) return driveTo(s, I.x, I.y, safe, { careful: true });
      const B = isls[next];
      const ux = B.x - I.x, uy = B.y - I.y, ud = Math.hypot(ux, uy);
      const ex = I.x + (ux / ud) * (I.r - 30), ey = I.y + (uy / ud) * (I.r - 30);
      if (Math.hypot(c.x - ex, c.y - ey) > 60) return driveTo(s, ex, ey, safe, { careful: true });
      return driveTo(s, B.x, B.y, safe, { careful: true });
    }

    // Dans un couloir : on file vers le bout le plus proche du but.
    let best = null, bestD = Infinity;
    for (const cor of g.map.corridors) {
      const A = isls[cor.a], B = isls[cor.b];
      const d = G.distToSegment(c.x, c.y, A.x, A.y, B.x, B.y);
      if (d < bestD) { bestD = d; best = cor; }
    }
    if (!best) return 0;
    const A = isls[best.a], B = isls[best.b];
    let to = B;
    if (hops) to = hops[best.a] <= hops[best.b] ? A : B;
    else to = Math.hypot(c.x - A.x, c.y - A.y) < Math.hypot(c.x - B.x, c.y - B.y) ? A : B;
    // Point sûr = le milieu du couloir le plus proche (pour se recentrer).
    const dx = B.x - A.x, dy = B.y - A.y, len2 = dx * dx + dy * dy;
    const tt = Math.max(0, Math.min(1, ((c.x - A.x) * dx + (c.y - A.y) * dy) / len2));
    const safe = { x: A.x + dx * tt, y: A.y + dy * tt };
    // On vise un point du couloir un peu plus loin dans la bonne direction (reste bien au milieu).
    const dir = to === B ? 1 : -1;
    const ahead = Math.max(0, Math.min(1, tt + dir * (160 / Math.sqrt(len2))));
    return driveTo(s, A.x + dx * ahead, A.y + dy * ahead, safe, { careful: true });
  }

  // =================================================================
  //  PHYSIQUE : faire avancer une voiture de 1/30 s
  // =================================================================
  function advanceCar(id, k) {
    const s = g.cars[id];
    if (!s.alive) return;
    const dt = P.TICK / P.SUB;
    const t = now();
    for (let sub = 0; sub < P.SUB; sub++) {
      P.drive(s.car, s.falling ? 0 : k, dt, g.env, 1);
      if (s.falling) continue;   // une voiture qui tombe ne touche plus personne
      for (const oid in g.cars) {
        if (oid === id) continue;
        const o = g.cars[oid];
        if (!o.alive || o.falling) continue;
        const res = P.collideCars(s.car, o.car, false);
        if (res.touch) { o.lastHit = { by: id, t }; s.lastHit = { by: oid, t }; }
        if (res.impact > 120) addFx(res.x, res.y, res.impact, "spark", [id, oid]);
      }
    }
    // Plus de sol sous le centre de la voiture ? Elle tombe.
    if (!s.falling && g.phase === "play" && !G.onGround(g.map, s.car.x, s.car.y, arenaR(t))) startFall(id);
  }

  function step() {
    const t = now();
    for (const [id, s] of Object.entries(g.cars)) {
      if (!s.alive) continue;
      if (s.falling) {
        advanceCar(id, 0);
        if (t - s.fallAt >= FALL_MS) eliminate(id, "fall");
      } else if (s.bot) advanceCar(id, botKeys(id, s));
      else if (t - s.lastInputAt > 200) advanceCar(id, 0);    // onglet en pause : roue libre
      // Une voiture restée hors du sol (ex. arène qui rétrécit sous elle) tombe aussi.
      if (s.alive && !s.falling && g.phase === "play" && !G.onGround(g.map, s.car.x, s.car.y, arenaR(t))) startFall(id);
      if (g.phase !== "play") return;
    }
    zoneTick(t);
    if (g.phase === "play") powerTick(t);
  }

  function tick() {
    const t = now();
    if (g.phase === "pick") {
      // Fin des 10 s, ou tous les humains connectés ont choisi : on y va.
      const humans = ctx.players().filter((p) => p.connected && !p.bot && g.cards[p.id]);
      if (t >= g.phaseEnd || humans.every((p) => g.picks[p.id])) endPick();
    } else if (g.phase === "countdown") {
      if (t >= g.phaseEnd) {
        g.phase = "play"; g.playStart = t; g.zonePauseUntil = t + FIRST_ZONE; g.powerNextAt = t + POWER_FIRST;
        checkEnd();   // quelqu'un est parti pendant le compte à rebours ?
        if (g.phase === "roundOver") return;
      }
    } else if (g.phase === "play") {
      step();
      if (g.phase === "roundOver") return;   // endRound a déjà tout envoyé
      if (g.endAt && t >= g.endAt) return endRound();
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // Quelqu'un part en pleine manche : il est éliminé.
  function leave(id) {
    const s = g.cars[id];
    if (!s?.alive || !["pick", "countdown", "play"].includes(g.phase)) return;
    if (g.phase !== "play") { s.alive = false; g.elimOrder.push(id); return; }
    eliminate(id, "left");
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (!["random", "arena", "islands"].includes(s.variant)) s.variant = "random";
      if (!["auto", "ffa", "teams"].includes(s.mode)) s.mode = "auto";
      if (!SHRINK[s.shrink]) s.shrink = "normal";
      if (![10, 15, 20].includes(s.zoneTime)) s.zoneTime = 15;
      if (!["same", "different"].includes(s.cards)) s.cards = "same";
      s.nitro = !!s.nitro;
      g.settings = s;
      ctx.saveSettings({ ...g.settings });
      ctx.update();
    },

    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase) || g.final) return;
      const n = ctx.players().filter((p) => p.connected).length;
      if (n < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startRound();
      ctx.update();
    },

    // Choix d'une carte de véhicule (pendant les 10 s du début).
    pick(pid, { type }) {
      if (g.phase !== "pick" || !g.cards[pid]?.includes(type)) return { error: "Carte invalide." };
      g.picks[pid] = type;
      ctx.update();
    },

    // Touches : { s: numéro, k: touches } — chaque message = 1/30 s de conduite.
    in(pid, { s, k }) {
      const st = g.cars[pid];
      if (!st || st.bot || typeof s !== "number" || s <= st.seq) return;
      const t = now();
      st.seq = s;
      st.lastInputAt = t;
      if (!st.alive || st.falling || g.phase !== "play") return;
      st.budget = Math.min(6, (st.budget ?? 6) + (t - (st.budgetAt || t)) * 0.036);
      st.budgetAt = t;
      if (st.budget < 1) return;
      st.budget -= 1;
      advanceCar(pid, k & 63);
    },

    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "roundOver" || ctx.playlist) return;
      g.phase = "setup";
      ctx.update();
    },

    finish(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase)) return;
      ctx.finish(ranking());
    },
  };

  return {
    publicState,
    onAction(pid, type, data) {
      const fn = actions[type];
      if (!fn) return { error: "Action inconnue." };
      return fn(pid, data) || { ok: true };
    },
    onReconnect() { ctx.update(); },
    onDisconnect(pid) { leave(pid); ctx.update(); },
    canJoin: () => g.phase === "setup" || g.phase === "roundOver",
    autoStart() {
      if (ctx.players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startRound();
      ctx.update();
    },
    destroy() { stopLoop(); clearTimeout(g.finishTimer); },
  };
}
