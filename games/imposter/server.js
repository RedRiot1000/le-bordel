// ===================================================================
//  IMPOSTER — Moteur du jeu (module du hub Le Bordel)
//  Chacun a un mot secret ; les imposteurs ont un mot proche
//  (Undercover) ou aucun mot (Mr White). Indices puis vote.
//  Le jeu enchaîne autant de manches que l'hôte veut, puis l'hôte
//  clique "Terminer le jeu" -> classement envoyé au hub.
// ===================================================================

import { getPairs, CATEGORIES } from "./words.js";

export const meta = {
  id: "imposter",
  name: "Imposter",
  emoji: "🕵️",
  family: "Bluff",
  minPlayers: 3,
  maxPlayers: 6,
  description: "Un mot secret, un intrus. Démasquez-le !",
};

function defaultSettings() {
  return {
    undercoverCount: 1,
    mrWhiteEnabled: false,        // désactivé par défaut (l'hôte peut l'activer)
    mrWhiteCount: 1,
    roleReveal: "hidden",         // "hidden" (rôle caché) ou "announced"
    impostorsKnowEachOther: false,
    clueRounds: 3,
    chaosMode: false,
    categories: [...CATEGORIES],   // toutes actives par défaut
    timers: {
      enabled: true,
      clue: 60,   // secondes par indice
      vote: 60,   // secondes pour voter
      guess: 30,  // secondes pour la devinette de Mr White
    },
    scoring: {
      civilWin: 2,
      undercoverWin: 6,
      mrWhiteGuess: 8,
      mrWhiteSurvive: 6,
      voteBonus: 1,
    },
  };
}

const THEMES = ["theme-violet", "theme-ocean", "theme-sunset", "theme-forest", "theme-candy"];

// Indices bidons des bots (ils ne comprennent pas les mots, c'est pour tester).
const BOT_CLUES = [
  "Hmm…", "Classique", "Ça dépend", "Souvent", "Rond", "Coloré", "Utile", "Bof",
  "Évident", "Mystère", "Partout", "Grand", "Petit", "Doux", "Bizarre", "Chez moi",
];
const IMPOSTOR_ROLES = ["undercover", "mrwhite"];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ===================================================================
//  CRÉATION D'UNE PARTIE (appelée par le hub)
// ===================================================================
export function createGame(ctx) {
  const saved = ctx.savedSettings;
  const g = {
    phase: "setup",               // réglages avant la 1re manche
    settings: saved ? structuredClone(saved) : defaultSettings(),
    scores: {},                   // points Imposter (servent au classement final)
    usedPairs: new Set(),
    roundCounter: 0,
    theme: THEMES[0],
    round: null,
    timer: null,
    timerCtx: null,
    botTimers: [],          // actions programmées des bots
    botPending: new Set(),  // pour ne pas programmer deux fois la même action
  };

  const findPlayer = (id) => ctx.players().find((p) => p.id === id);
  const isBot = (id) => !!findPlayer(id)?.bot;
  const addScore = (id, pts) => { g.scores[id] = (g.scores[id] || 0) + pts; };

  // =================================================================
  //  PROJECTION PUBLIQUE (jamais les mots secrets ni les rôles cachés)
  // =================================================================
  function publicState() {
    const base = {
      phase: g.phase,
      settings: g.settings,
      allCategories: CATEGORIES,
      theme: g.theme,
      players: ctx.players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
    };
    const r = g.round;
    if (r) {
      base.round = {
        number: r.number,
        seating: r.seating,
        alive: r.alive,
        eliminated: r.eliminated,
        clueRoundNum: r.clueRoundNum,
        clueRoundsTarget: r.clueRoundsTarget,
        currentPlayerId: r.currentPlayerId,
        clues: r.clues,
        voteCounts: g.phase === "vote" ? null : r.lastVoteCounts || null,
        votedIds: g.phase === "vote" ? Object.keys(r.votes || {}) : null,
        result: r.result || null,
        guesserId: r.guesserId || null,
        outcome: r.outcome || null,
        deadline: r.deadline || null,
      };
    }
    return base;
  }

  function broadcast() {
    armTimer();     // (ré)arme le minuteur selon la phase courante
    ctx.update();
    botsThink();    // les bots réagissent à la nouvelle situation
  }

  // =================================================================
  //  BOTS : ils jouent après un petit délai, comme s'ils réfléchissaient
  // =================================================================
  function botLater(key, fn) {
    if (g.botPending.has(key)) return;
    g.botPending.add(key);
    g.botTimers.push(setTimeout(fn, 1200 + Math.random() * 1800));
  }

  function botsThink() {
    const r = g.round;
    if (!r) return;
    if (g.phase === "clues" && isBot(r.currentPlayerId)) {
      const pid = r.currentPlayerId;
      botLater(`clue:${r.number}:${r.clues.length}`, () => {
        if (g.phase !== "clues" || g.round?.currentPlayerId !== pid) return;
        const used = new Set(g.round.clues.map((c) => c.text.toLowerCase()));
        const free = BOT_CLUES.filter((c) => !used.has(c.toLowerCase()));
        const text = free.length ? free[Math.floor(Math.random() * free.length)] : "Bip " + g.round.clues.length;
        actions.clue(pid, { text });
      });
    }
    if (g.phase === "vote") {
      for (const pid of r.alive.filter((id) => isBot(id) && !r.votes[id])) {
        botLater(`vote:${r.number}:${r.voteSession}:${pid}`, () => {
          const rr = g.round;
          if (g.phase !== "vote" || !rr.alive.includes(pid) || rr.votes[pid]) return;
          const targets = rr.alive.filter((id) => id !== pid);
          actions.vote(pid, { targetId: targets[Math.floor(Math.random() * targets.length)] });
        });
      }
    }
    if (g.phase === "mrwhite_guess" && isBot(r.guesserId)) {
      const pid = r.guesserId;
      botLater(`guess:${r.number}:${pid}`, () => {
        if (g.phase === "mrwhite_guess" && g.round.guesserId === pid) actions.guess(pid, { guess: "???" });
      });
    }
  }

  // =================================================================
  //  MINUTEUR
  //  On ne le ré-arme QUE si le "contexte" (phase + joueur + tour) a
  //  changé, pour ne pas le remettre à zéro à chaque mise à jour.
  // =================================================================
  function armTimer() {
    const r = g.round;
    let tctx = null, seconds = 0, onExpire = null;

    if (r && g.settings.timers?.enabled) {
      const t = g.settings.timers;
      if (g.phase === "clues" && r.currentPlayerId) {
        tctx = `clue:${r.currentPlayerId}:${r.clueRoundNum}:${r.number}:${r.clues.length}`;
        seconds = t.clue; onExpire = autoSkipClue;
      } else if (g.phase === "vote") {
        tctx = `vote:${r.number}:${r.eliminated.length}:${r.voteSession}`;
        seconds = t.vote; onExpire = () => { if (g.phase === "vote") resolveVotes(); };
      } else if (g.phase === "mrwhite_guess" && r.guesserId) {
        tctx = `guess:${r.guesserId}:${r.number}`;
        seconds = t.guess; onExpire = autoGuessTimeout;
      }
    }

    if (tctx === g.timerCtx) return;
    clearTimeout(g.timer); g.timer = null;
    g.timerCtx = tctx;
    if (r) r.deadline = null;
    if (!tctx) return;

    r.deadline = Date.now() + seconds * 1000;
    g.timer = setTimeout(() => {
      g.timer = null; g.timerCtx = null;
      onExpire();
      broadcast();
    }, seconds * 1000);
  }

  // Temps écoulé pendant un indice : on pose un tiret et on passe.
  function autoSkipClue() {
    const r = g.round;
    if (g.phase !== "clues" || !r.currentPlayerId) return;
    r.clues.push({ playerId: r.currentPlayerId, text: "—", cycle: r.number, round: r.clueRoundNum, absent: true });
    r.turnIndex++;
    r.currentPlayerId = null;
    beginClueTurn();
  }

  // Temps écoulé pour Mr White : compté comme une mauvaise réponse.
  function autoGuessTimeout() {
    if (g.phase !== "mrwhite_guess") return;
    g.round.guesserId = null;
    afterResolution();
  }

  // Envoie à un joueur (ou à tous) SA carte secrète.
  function sendPrivateRoles(onlyId = null) {
    const r = g.round;
    if (!r) return;
    const impostorPseudos = r.seating
      .filter((id) => IMPOSTOR_ROLES.includes(r.assignments[id]?.role))
      .map((id) => findPlayer(id)?.pseudo || "?");

    for (const id of r.seating) {
      if (onlyId && id !== onlyId) continue;
      const a = r.assignments[id];
      ctx.sendTo(id, "yourRole", {
        word: a.word,                                   // null pour Mr White
        isMrWhite: a.role === "mrwhite",
        role: g.settings.roleReveal === "announced" ? a.role : null,
        allies: g.settings.impostorsKnowEachOther && IMPOSTOR_ROLES.includes(a.role)
          ? impostorPseudos : null,
      });
    }
  }

  // =================================================================
  //  DÉROULÉ D'UNE MANCHE
  // =================================================================

  // Choisit une paire non encore utilisée pendant la soirée, et tire au
  // hasard le sens : un coup "Jour" pour les civils et "Nuit" pour
  // l'Undercover, un coup l'inverse.
  function pickPair() {
    const pool = getPairs(g.settings.categories);
    const key = (p) => p.a + "|" + p.b;
    const available = pool.filter((p) => !g.usedPairs.has(key(p)));
    const list = available.length ? available : pool;   // si épuisé, on recycle
    if (available.length === 0) g.usedPairs.clear();
    const pair = list[Math.floor(Math.random() * list.length)];
    g.usedPairs.add(key(pair));
    return Math.random() < 0.5
      ? { civil: pair.a, undercover: pair.b }
      : { civil: pair.b, undercover: pair.a };
  }

  // Vérifie que la manche peut démarrer avec les joueurs présents.
  function checkStart() {
    const n = ctx.players().length;
    const s = g.settings;
    const impostors = s.undercoverCount + (s.mrWhiteEnabled ? s.mrWhiteCount : 0);
    if (n < meta.minPlayers) return `Il faut au moins ${meta.minPlayers} joueurs.`;
    if (impostors < 1) return "Il faut au moins 1 imposteur.";
    if (impostors >= n) return "Trop d'imposteurs pour le nombre de joueurs.";
    return null;
  }

  function startRound() {
    const pair = pickPair();
    const s = g.settings;
    const players = ctx.players();

    // Construit la liste des rôles à distribuer.
    const roles = [];
    for (let i = 0; i < s.undercoverCount; i++) roles.push("undercover");
    if (s.mrWhiteEnabled) for (let i = 0; i < s.mrWhiteCount; i++) roles.push("mrwhite");
    while (roles.length < players.length) roles.push("civil");
    const shuffledRoles = shuffle(roles);

    const assignments = {};
    players.forEach((p, i) => {
      const role = shuffledRoles[i];
      assignments[p.id] = {
        role,
        word: role === "mrwhite" ? null : role === "undercover" ? pair.undercover : pair.civil,
      };
      g.scores[p.id] = g.scores[p.id] || 0;   // il apparaît au classement
    });

    // Ordre des places : il tourne à chaque manche. Mr White ne commence jamais.
    let seating = players.map((p) => p.id);
    const rot = g.roundCounter % seating.length;
    seating = seating.slice(rot).concat(seating.slice(0, rot));
    if (assignments[seating[0]].role === "mrwhite" && seating.length > 1) {
      seating.push(seating.shift());
    }

    g.roundCounter++;
    g.theme = THEMES[(g.roundCounter - 1) % THEMES.length];
    g.round = {
      number: g.roundCounter,
      pair,
      assignments,
      seating,
      alive: [...seating],
      eliminated: [],
      clueRoundsTarget: s.clueRounds,
      clueRoundNum: 1,
      clues: [],
      turnIndex: 0,
      currentPlayerId: null,
      votes: {},
      voteSession: 0,
      result: null,
      guesserId: null,
      outcome: null,
      scoresAtStart: { ...g.scores },   // pour calculer les points gagnés pendant la manche
    };

    g.phase = "clues";
    beginClueTurn();
    broadcast();
    sendPrivateRoles();
  }

  // Positionne le joueur qui doit parler, en sautant les absents.
  function beginClueTurn() {
    const r = g.round;
    const order = r.seating.filter((id) => r.alive.includes(id));
    if (r.turnIndex >= order.length) { finishClueRound(); return; }
    const pid = order[r.turnIndex];
    if (!findPlayer(pid)?.connected) {
      r.clues.push({ playerId: pid, text: "—", cycle: r.number, round: r.clueRoundNum, absent: true });
      r.turnIndex++;
      return beginClueTurn();
    }
    r.currentPlayerId = pid;
  }

  // Fin d'un tour d'indices : on enchaîne ou on passe au vote.
  function finishClueRound() {
    const r = g.round;
    if (r.clueRoundNum < r.clueRoundsTarget) {
      r.clueRoundNum++;
      r.turnIndex = 0;
      // Mode Chaos : on rebat les places entre chaque tour d'indices.
      if (g.settings.chaosMode) {
        r.seating = shuffle(r.seating);
        const alive = r.seating.filter((id) => r.alive.includes(id));
        if (r.assignments[alive[0]]?.role === "mrwhite" && alive.length > 1) {
          r.seating = r.seating.filter((id) => id !== alive[0]).concat(alive[0]);
        }
      }
      beginClueTurn();
    } else {
      r.currentPlayerId = null;
      r.votes = {};
      r.voteSession++;
      g.phase = "vote";
    }
  }

  // Tous les vivants connectés ont voté ? -> dépouillement.
  function checkAllVoted() {
    const r = g.round;
    const voters = r.alive.filter((id) => findPlayer(id)?.connected);
    if (voters.every((id) => r.votes[id])) resolveVotes();
  }

  // Dépouille les votes et applique l'élimination (ou l'égalité).
  function resolveVotes() {
    const r = g.round;
    const counts = {};
    for (const targetId of Object.values(r.votes)) counts[targetId] = (counts[targetId] || 0) + 1;
    r.lastVoteCounts = counts;

    const max = Math.max(0, ...Object.values(counts));
    const top = Object.keys(counts).filter((id) => counts[id] === max);

    // Égalité (ou personne n'a voté) -> personne éliminé, +1 tour d'indices.
    if (top.length !== 1 || max === 0) {
      r.result = { tie: true };
      g.phase = "result";
      return;
    }

    const eliminatedId = top[0];
    const role = r.assignments[eliminatedId].role;
    r.alive = r.alive.filter((id) => id !== eliminatedId);
    r.eliminated.push({ playerId: eliminatedId, role });
    r.result = { tie: false, eliminatedId, role };

    // Bonus : ceux qui ont visé un imposteur démasqué.
    if (IMPOSTOR_ROLES.includes(role)) {
      for (const [voterId, targetId] of Object.entries(r.votes)) {
        if (targetId === eliminatedId) addScore(voterId, g.settings.scoring.voteBonus);
      }
    }

    // Mr White démasqué : il a droit à une devinette.
    if (role === "mrwhite") {
      r.guesserId = eliminatedId;
      g.phase = "mrwhite_guess";
      return;
    }
    g.phase = "result";
  }

  // Après une élimination : la manche est-elle finie ? Sinon on continue.
  function afterResolution() {
    const r = g.round;
    const impN = r.alive.filter((id) => IMPOSTOR_ROLES.includes(r.assignments[id].role)).length;
    const civN = r.alive.length - impN;

    if (impN === 0) return endRound("civils");
    if (impN >= civN) return endRound("impostors");

    // On continue : nouveau cycle d'indices.
    r.clueRoundsTarget = g.settings.clueRounds;
    r.clueRoundNum = 1;
    r.turnIndex = 0;
    r.votes = {};
    r.result = null;
    r.lastVoteCounts = null;
    g.phase = "clues";
    beginClueTurn();
  }

  // Fin de manche : attribue les points et affiche le bilan.
  function endRound(winnerSide, mrWhiteWinnerId = null) {
    const r = g.round;
    const s = g.settings.scoring;
    const winners = [];

    if (mrWhiteWinnerId) {
      addScore(mrWhiteWinnerId, s.mrWhiteGuess);
      winners.push(mrWhiteWinnerId);
      winnerSide = "mrwhite";
    } else {
      for (const id of r.seating) {
        const role = r.assignments[id].role;
        if (winnerSide === "civils" && role === "civil") { addScore(id, s.civilWin); winners.push(id); }
        if (winnerSide === "impostors") {
          if (role === "undercover") { addScore(id, s.undercoverWin); winners.push(id); }
          else if (role === "mrwhite" && r.alive.includes(id)) { addScore(id, s.mrWhiteSurvive); winners.push(id); }
        }
      }
    }

    // Points gagnés pendant la manche (victoire + bonus de bons votes).
    const gains = {};
    for (const id of r.seating) gains[id] = (g.scores[id] || 0) - (r.scoresAtStart[id] || 0);

    r.outcome = {
      winnerSide,
      winners,
      gains,
      pair: r.pair,
      roles: r.seating.map((id) => ({ playerId: id, role: r.assignments[id].role, word: r.assignments[id].word })),
    };
    g.phase = "gameOver";
  }

  // Classement final (pour les points de soirée) : par score Imposter.
  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  ACTIONS DES JOUEURS (reçues via le hub)
  // =================================================================
  const actions = {
    // --- Réglages (hôte, avant une manche) ---
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      g.settings = {
        ...g.settings, ...settings,
        timers: { ...g.settings.timers, ...(settings.timers || {}) },
        scoring: { ...g.settings.scoring, ...(settings.scoring || {}) },
      };
      if (!g.settings.categories?.length) g.settings.categories = [...CATEGORIES];
      // Minuteurs : nombres entiers entre 5 s et 10 min, quoi qu'on envoie.
      for (const k of ["clue", "vote", "guess"]) {
        const v = Math.round(Number(g.settings.timers[k]));
        g.settings.timers[k] = Number.isFinite(v) ? Math.max(5, Math.min(600, v)) : defaultSettings().timers[k];
      }
      ctx.saveSettings(structuredClone(g.settings));
      broadcast();
    },

    // --- Lancer une manche (hôte) ---
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "gameOver"].includes(g.phase)) return;
      const err = checkStart();
      if (err) return { error: err };
      startRound();
    },

    // --- Donner un indice ---
    clue(pid, { text }) {
      const r = g.round;
      if (g.phase !== "clues") return;
      if (r.currentPlayerId !== pid) return { error: "Ce n'est pas ton tour." };
      text = (text || "").trim().slice(0, 40);
      if (!text) return { error: "Écris un indice." };
      if (r.clues.some((c) => c.text.toLowerCase() === text.toLowerCase())) {
        return { error: "Cet indice a déjà été donné." };
      }
      r.clues.push({ playerId: pid, text, cycle: r.number, round: r.clueRoundNum });
      r.turnIndex++;
      r.currentPlayerId = null;
      beginClueTurn();
      broadcast();
    },

    // --- Voter ---
    vote(pid, { targetId }) {
      const r = g.round;
      if (g.phase !== "vote") return;
      if (!r.alive.includes(pid)) return { error: "Les éliminés ne votent pas." };
      if (!r.alive.includes(targetId) || targetId === pid) return { error: "Cible invalide." };
      r.votes[pid] = targetId;
      checkAllVoted();
      broadcast();
    },

    // --- Mr White tente de deviner le mot ---
    guess(pid, { guess }) {
      const r = g.round;
      if (g.phase !== "mrwhite_guess" || r.guesserId !== pid) return;
      const correct = (guess || "").trim().toLowerCase() === r.pair.civil.toLowerCase();
      if (correct) endRound("mrwhite", pid);
      else { r.guesserId = null; afterResolution(); }
      broadcast();
      return { ok: true, correct };
    },

    // --- L'hôte fait avancer après un résultat ---
    continue(pid) {
      if (!ctx.isHost(pid) || g.phase !== "result") return;
      afterResolution();
      broadcast();
    },

    // --- Retour aux réglages entre deux manches (hôte) ---
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "gameOver") return;
      g.round = null;
      g.phase = "setup";
      broadcast();
    },

    // --- Terminer le jeu -> points de soirée (hôte) ---
    finish(pid) {
      if (!ctx.isHost(pid) || !["setup", "gameOver"].includes(g.phase)) return;
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

    onReconnect(pid) {
      if (g.round) sendPrivateRoles(pid);
      broadcast();
    },

    onDisconnect(pid) {
      const r = g.round;
      if (r && g.phase === "clues" && r.currentPlayerId === pid) {
        // C'était son tour de parler : on débloque.
        r.clues.push({ playerId: pid, text: "—", cycle: r.number, round: r.clueRoundNum, absent: true });
        r.turnIndex++;
        r.currentPlayerId = null;
        beginClueTurn();
      } else if (r && g.phase === "vote") {
        checkAllVoted();
      } else if (r && g.phase === "mrwhite_guess" && r.guesserId === pid) {
        autoGuessTimeout();   // Mr White parti : devinette ratée
      }
      broadcast();
    },

    // On peut rejoindre seulement entre les manches.
    canJoin: () => g.phase === "setup" || g.phase === "gameOver",

    destroy() {
      clearTimeout(g.timer);
      g.botTimers.forEach(clearTimeout);
    },
  };
}
