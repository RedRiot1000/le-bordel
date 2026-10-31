// ===================================================================
//  PATATE CHAUDE — Moteur du jeu (module du hub Le Bordel)
//  Arène vue de dessus. Un joueur a la bombe et la refile en touchant
//  quelqu'un. Quand la mèche (cachée) arrive au bout : BOUM, éliminé.
//  Dernier debout = gagnant. C'est le SERVEUR qui calcule les
//  déplacements (30 fois par seconde) : personne ne peut tricher.
// ===================================================================

export const meta = {
  id: "patate",
  name: "Patate chaude",
  emoji: "💣",
  family: "Action",
  minPlayers: 3,
  maxPlayers: 6,
  description: "Refile la bombe avant qu'elle explose !",
};

// --- Réglages de la physique ---
const W = 960, H = 600;        // taille de l'arène (en pixels "virtuels")
const R = 22;                  // rayon d'un joueur
const TICK_MS = 1000 / 30;     // 30 calculs par seconde
const SPEED = 260;             // pixels par seconde
const HOLDER_BONUS = 1.12;     // le porteur de bombe va 12 % plus vite
const DASH_MULT = 2.6;         // vitesse pendant le sprint
const DASH_TIME = 0.16;        // durée du sprint (s)
const DASH_COOLDOWN = 2.5;     // recharge du sprint (s)
const NO_PASS_BACK = 1.0;      // pas de renvoi immédiat au précédent (s)
const PASS_COOLDOWN = 0.25;    // délai mini entre deux passes (s)
const COUNTDOWN_MS = 3000;     // compte à rebours en début de manche
const RESPAWN_MS = 2000;       // pause avant la bombe suivante
const BOOM_MS = 1800;          // durée de l'explosion à l'écran

// Durée de la mèche (en secondes, tirée au hasard dans l'intervalle).
// ("test" = mèche éclair utilisée seulement par le test automatique.)
const FUSES = { courte: [10, 18], normale: [15, 28], longue: [25, 40], test: [2, 3] };

// Dispositions d'obstacles (rectangles), une tirée au hasard par manche.
const LAYOUTS = [
  [ // 4 piliers
    { x: 220, y: 140, w: 90, h: 90 }, { x: 650, y: 140, w: 90, h: 90 },
    { x: 220, y: 370, w: 90, h: 90 }, { x: 650, y: 370, w: 90, h: 90 },
  ],
  [ // bloc central + 2 barres
    { x: 420, y: 245, w: 120, h: 110 },
    { x: 140, y: 280, w: 170, h: 40 }, { x: 650, y: 280, w: 170, h: 40 },
  ],
  [ // couloirs
    { x: 300, y: 0, w: 40, h: 200 }, { x: 620, y: 400, w: 40, h: 200 },
    { x: 300, y: 400, w: 40, h: 110 }, { x: 620, y: 90, w: 40, h: 110 },
  ],
  [ // croix
    { x: 455, y: 150, w: 50, h: 300 }, { x: 330, y: 275, w: 300, h: 50 },
  ],
];

function defaultSettings() {
  return { fuse: "normale", obstacles: true, dash: true };
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// ===================================================================
//  CRÉATION D'UNE PARTIE (appelée par le hub)
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | countdown | play | boom | roundOver
    settings: ctx.savedSettings ? { ...ctx.savedSettings } : defaultSettings(),
    scores: {},           // points Patate (classement final)
    roundNum: 0,
    obstacles: [],
    bodies: {},           // id -> { x, y, alive, input, dir, dashT, dashCd }
    holderId: null,
    prevHolder: null,
    lastPassAt: 0,
    fuseStart: 0,
    fuseEnd: 0,
    phaseEnd: 0,
    elimOrder: [],        // ordre d'élimination de la manche
    lastBoom: null,       // { id, x, y }
    lastRound: null,      // résultats de la dernière manche
    loop: null,
  };

  const now = () => Date.now();
  const aliveIds = () => Object.keys(g.bodies).filter((id) => g.bodies[id].alive);

  // =================================================================
  //  ÉTAT PUBLIC (envoyé 30 fois par seconde pendant le jeu)
  // =================================================================
  function publicState() {
    const t = now();
    let heat = 0;
    if (g.phase === "play" && g.fuseEnd > g.fuseStart) {
      heat = Math.min(1, (t - g.fuseStart) / (g.fuseEnd - g.fuseStart));
    }
    return {
      phase: g.phase,
      settings: g.settings,
      roundNum: g.roundNum,
      players: ctx.players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      arena: { w: W, h: H, r: R, obstacles: g.obstacles },
      bodies: Object.entries(g.bodies).map(([id, b]) => ({
        id, x: Math.round(b.x), y: Math.round(b.y), alive: b.alive,
        dashing: b.dashT > 0, dashReady: b.dashCd <= 0,
      })),
      holderId: g.holderId,
      heat,                                   // 0 -> 1 : la bombe clignote de plus en plus vite
      phaseLeft: Math.max(0, g.phaseEnd - t), // ms restantes (compte à rebours, explosion)
      lastBoom: g.lastBoom,
      lastRound: g.lastRound,
      elimOrder: g.elimOrder,
    };
  }

  // =================================================================
  //  DÉROULÉ D'UNE MANCHE
  // =================================================================
  function startRound() {
    const players = ctx.players().filter((p) => p.connected);
    g.roundNum++;
    g.obstacles = g.settings.obstacles ? pick(LAYOUTS) : [];
    g.bodies = {};
    g.elimOrder = [];
    g.lastBoom = null;
    g.lastRound = null;

    // Placement en cercle autour du centre.
    players.forEach((p, i) => {
      const a = (i / players.length) * Math.PI * 2 + Math.PI / 2;
      const b = {
        x: W / 2 + Math.cos(a) * 380, y: H / 2 + Math.sin(a) * 230,
        alive: true, input: {}, dir: { x: 0, y: -1 }, dashT: 0, dashCd: 0,
      };
      pushOutOfObstacles(b);
      g.bodies[p.id] = b;
      g.scores[p.id] = g.scores[p.id] || 0;   // il apparaît au classement
    });

    giveBomb(pick(players).id);
    g.phase = "countdown";
    g.phaseEnd = now() + COUNTDOWN_MS;
    startLoop();
  }

  function giveBomb(id) {
    g.holderId = id;
    g.prevHolder = null;
    g.lastPassAt = 0;
  }

  function lightFuse() {
    const [a, b] = FUSES[g.settings.fuse] || FUSES.normale;
    g.fuseStart = now();
    g.fuseEnd = g.fuseStart + rand(a, b) * 1000;
  }

  // Un joueur est éliminé (explosion ou départ).
  function eliminate(id) {
    const b = g.bodies[id];
    if (!b || !b.alive) return;
    b.alive = false;
    g.elimOrder.push(id);
  }

  function explode() {
    const id = g.holderId;
    const b = g.bodies[id];
    g.lastBoom = { id, x: Math.round(b.x), y: Math.round(b.y) };
    eliminate(id);
    g.holderId = null;
    g.phase = "boom";
    g.phaseEnd = now() + BOOM_MS;
  }

  // Après une explosion (ou un départ) : manche finie ou bombe suivante ?
  function nextBombOrEnd() {
    const alive = aliveIds();
    if (alive.length <= 1) return endRound();
    giveBomb(pick(alive));
    g.phase = "countdown";
    g.phaseEnd = now() + RESPAWN_MS;
  }

  // Points : 1 par joueur éliminé avant toi, le gagnant a n-1.
  function endRound() {
    const ids = Object.keys(g.bodies);
    const order = [...g.elimOrder, ...aliveIds()];   // du 1er éliminé au gagnant
    g.lastRound = order.map((id, i) => ({ id, points: i, place: ids.length - i })).reverse();
    for (const r of g.lastRound) g.scores[r.id] = (g.scores[r.id] || 0) + r.points;
    g.holderId = null;
    g.phase = "roundOver";
    stopLoop();
    ctx.update();
  }

  // =================================================================
  //  PHYSIQUE
  // =================================================================
  function pushOutOfObstacles(b) {
    // Murs de l'arène.
    b.x = Math.max(R, Math.min(W - R, b.x));
    b.y = Math.max(R, Math.min(H - R, b.y));
    // Rectangles : on repousse le rond hors du point le plus proche.
    for (const o of g.obstacles) {
      const cx = Math.max(o.x, Math.min(b.x, o.x + o.w));
      const cy = Math.max(o.y, Math.min(b.y, o.y + o.h));
      let dx = b.x - cx, dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      if (d2 === 0) {
        // Centre à l'intérieur du rectangle : on sort par le côté le plus proche.
        const exits = [
          { d: b.x - o.x, x: o.x - R, y: b.y }, { d: o.x + o.w - b.x, x: o.x + o.w + R, y: b.y },
          { d: b.y - o.y, x: b.x, y: o.y - R }, { d: o.y + o.h - b.y, x: b.x, y: o.y + o.h + R },
        ].sort((p, q) => p.d - q.d)[0];
        b.x = exits.x; b.y = exits.y;
      } else {
        const d = Math.sqrt(d2);
        b.x = cx + (dx / d) * R;
        b.y = cy + (dy / d) * R;
      }
    }
  }

  function step(dt) {
    const alive = aliveIds();

    // 1. Déplacements selon les touches.
    for (const id of alive) {
      const b = g.bodies[id];
      const i = b.input;
      let mx = (i.r ? 1 : 0) - (i.l ? 1 : 0);
      let my = (i.d ? 1 : 0) - (i.u ? 1 : 0);
      const len = Math.hypot(mx, my);
      if (len) { mx /= len; my /= len; b.dir = { x: mx, y: my }; }

      b.dashCd = Math.max(0, b.dashCd - dt);
      let speed = SPEED * (id === g.holderId ? HOLDER_BONUS : 1);
      if (b.dashT > 0) {
        b.dashT -= dt;
        speed *= DASH_MULT;
        if (!len) { mx = b.dir.x; my = b.dir.y; }   // le sprint part tout droit
      }
      b.x += mx * speed * dt;
      b.y += my * speed * dt;
      pushOutOfObstacles(b);
    }

    // 2. Les joueurs se repoussent entre eux + passe de la bombe.
    const t = now();
    for (let a = 0; a < alive.length; a++) {
      for (let c = a + 1; c < alive.length; c++) {
        const A = g.bodies[alive[a]], B = g.bodies[alive[c]];
        const dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < R * 2 + 2) tryPass(alive[a], alive[c], t);
        if (d < R * 2) {
          const push = (R * 2 - d) / 2;
          A.x -= (dx / d) * push; A.y -= (dy / d) * push;
          B.x += (dx / d) * push; B.y += (dy / d) * push;
          pushOutOfObstacles(A); pushOutOfObstacles(B);
        }
      }
    }
  }

  function tryPass(idA, idB, t) {
    let from, to;
    if (g.holderId === idA) { from = idA; to = idB; }
    else if (g.holderId === idB) { from = idB; to = idA; }
    else return;
    if (t - g.lastPassAt < PASS_COOLDOWN * 1000) return;
    if (to === g.prevHolder && t - g.lastPassAt < NO_PASS_BACK * 1000) return;
    g.holderId = to;
    g.prevHolder = from;
    g.lastPassAt = t;
  }

  // =================================================================
  //  BOUCLE DE JEU (30 fois par seconde)
  // =================================================================
  function tick() {
    const t = now();
    if (g.phase === "countdown" && t >= g.phaseEnd) {
      g.phase = "play";
      lightFuse();
    } else if (g.phase === "play") {
      step(TICK_MS / 1000);
      if (t >= g.fuseEnd) explode();
    } else if (g.phase === "boom" && t >= g.phaseEnd) {
      nextBombOrEnd();
      if (g.phase === "roundOver") return;   // endRound a déjà tout envoyé
    }
    ctx.update();
  }

  function startLoop() { stopLoop(); g.loop = setInterval(tick, TICK_MS); }
  function stopLoop() { clearInterval(g.loop); g.loop = null; }

  // Classement final (pour les points de soirée) : par score Patate.
  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // Quelqu'un part en pleine manche : il est éliminé (sans explosion).
  function leave(id) {
    const b = g.bodies[id];
    if (!b?.alive || !["countdown", "play", "boom"].includes(g.phase)) return;
    eliminate(id);
    const alive = aliveIds();
    if (alive.length <= 1) { endRound(); return; }
    if (g.holderId === id) giveBomb(pick(alive));   // la bombe saute sur un autre
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      if (settings.fuse && !FUSES[settings.fuse]) delete settings.fuse;
      g.settings = { ...g.settings, ...settings };
      ctx.saveSettings({ ...g.settings });
      ctx.update();
    },

    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase)) return;
      const n = ctx.players().filter((p) => p.connected).length;
      if (n < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startRound();
      ctx.update();
    },

    // Touches enfoncées : { u, d, l, r } (haut, bas, gauche, droite).
    input(pid, data) {
      const b = g.bodies[pid];
      if (!b) return;
      b.input = { u: !!data.u, d: !!data.d, l: !!data.l, r: !!data.r };
    },

    dash(pid) {
      const b = g.bodies[pid];
      if (!b?.alive || g.phase !== "play" || !g.settings.dash || b.dashCd > 0) return;
      b.dashT = DASH_TIME;
      b.dashCd = DASH_COOLDOWN;
    },

    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "roundOver") return;
      g.phase = "setup";
      ctx.update();
    },

    finish(pid) {
      if (!ctx.isHost(pid) || !["setup", "roundOver"].includes(g.phase)) return;
      ctx.finish(ranking());
    },
  };

  // =================================================================
  //  CE QUE LE HUB APPELLE
  // =================================================================
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
    destroy: stopLoop,
  };
}
