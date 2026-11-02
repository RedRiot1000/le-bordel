// ===================================================================
//  2 VÉRITÉS, 1 MENSONGE — Moteur du jeu (module du hub Le Bordel)
//  Une manche = un thème tiré au sort (« Mes vacances ») :
//  1. Chacun écrit 3 phrases sur lui, dont UNE fausse (il la coche).
//  2. Un joueur à la fois : ses 3 phrases (mélangées), les autres votent
//     pour le mensonge.
//  3. Révélation : +1 si tu as trouvé, l'auteur +1 par joueur piégé.
// ===================================================================

import { THEMES } from "./themes.js";

export const meta = {
  id: "deuxverites",
  name: "2 vérités, 1 mensonge",
  emoji: "🤥",
  family: "Ambiance",
  minPlayers: 3,
  maxPlayers: 8,
  description: "3 phrases sur toi, une est fausse. Tes potes te connaissent vraiment ?",
  pausable: true,      // jeu de réflexion : l'hôte (ou la moitié des joueurs) peut mettre en pause
};

const REVEAL_MS = 9000;
const FINISH_DELAY = 15000;
const MAX_LEN = 110;
const THEME_LEN = 60;

function defaultSettings() {
  // themes : "joueurs" = chacun peut choisir son propre thème (défaut) · "banque" = le même thème tiré au sort pour tous
  return { rounds: 2, writeTime: 90, guessTime: 25, themes: "joueurs" };
}

export const playlist = {
  options: [
    {
      key: "rounds", label: "Manches", default: "1",
      choices: [{ v: "1", label: "1" }, { v: "2", label: "2" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: Number(c.rounds) === 2 ? 2 : 1 };
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | write | guess | reveal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    who: [],
    round: 0,
    usedThemes: new Set(),
    theme: null,
    entries: {},          // id -> { lines: [3 phrases], lie: indice du mensonge, theme }
    order: [],            // ordre de passage
    index: 0,
    shown: [],            // ordre d'affichage des 3 phrases du joueur en cours (mélangé)
    votes: {},            // votant -> indice AFFICHÉ (0 à 2)
    gains: {},
    history: [],
    stepAt: 0,
    deadline: 0,
    timer: null,
    botTimers: [],
    final: false,
    finishAt: 0,
    finishTimer: null,
  };
  const now = () => ctx.now();
  const players = () => ctx.players();
  const isBot = (id) => !!players().find((p) => p.id === id)?.bot;
  const online = () => players().filter((p) => p.connected && g.who.includes(p.id)).map((p) => p.id);
  const author = () => g.order[g.index];
  const voters = () => online().filter((id) => id !== author());
  const later = (fn, ms) => g.botTimers.push(ctx.setTimeout(fn, ms));
  // Indice AFFICHÉ du mensonge du joueur en cours.
  const lieShown = () => g.shown.indexOf(g.entries[author()].lie);

  // =================================================================
  //  ÉTAT PUBLIC (le mensonge reste secret jusqu'à la révélation)
  // =================================================================
  function publicState() {
    const t = now();
    const base = {
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      who: g.who,
      round: g.round,
      theme: g.theme && { title: g.theme.title, hint: g.theme.hint },
      left: Math.max(0, g.deadline - t),
      playlist: ctx.playlist && { final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
    };
    if (g.phase === "write") base.doneIds = Object.keys(g.entries);
    if (g.phase === "guess" || g.phase === "reveal") {
      const id = author();
      base.turn = { id, num: g.index + 1, total: g.order.length, theme: g.entries[id].theme, lines: g.shown.map((i) => g.entries[id].lines[i]) };
      if (g.phase === "guess") base.turn.votedIds = Object.keys(g.votes);
      else Object.assign(base.turn, { lie: lieShown(), votes: g.votes, gains: g.gains, elapsed: t - g.stepAt, duration: REVEAL_MS });
    }
    if (g.phase === "over") base.history = g.history;
    return base;
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    clearTimers();
    g.who = players().filter((p) => p.connected).map((p) => p.id);
    g.scores = {};
    for (const id of g.who) g.scores[id] = 0;
    g.round = 0;
    g.usedThemes = new Set();
    g.history = [];
    nextRound();
  }

  function nextRound() {
    clearTimers();
    g.round++;
    if (g.round > g.settings.rounds) return endGame();
    let free = THEMES.filter((th) => !g.usedThemes.has(th.title));
    if (!free.length) free = THEMES;
    g.theme = pick(free);
    g.usedThemes.add(g.theme.title);
    g.entries = {};
    g.phase = "write";
    g.deadline = now() + g.settings.writeTime * 1000;
    g.timer = ctx.setTimeout(endWrite, g.settings.writeTime * 1000);
    // Les bots piochent 3 phrases du thème et en déclarent une fausse.
    for (const id of g.who.filter(isBot)) {
      later(() => {
        if (g.phase !== "write") return;
        g.entries[id] = { lines: shuffle(g.theme.bot).slice(0, 3), lie: Math.floor(Math.random() * 3), theme: g.theme.title };
        checkAllWritten();
        if (g.phase === "write") ctx.update();
      }, 4000 + Math.random() * 8000);
    }
    ctx.update();
  }

  function checkAllWritten() {
    if (online().every((id) => g.entries[id])) endWrite();
  }

  function endWrite() {
    if (g.phase !== "write") return;
    clearTimers();
    // Ceux qui n'ont pas fini ne passent pas.
    g.order = shuffle(g.who.filter((id) => g.entries[id]));
    g.index = -1;
    nextTurn();
  }

  function nextTurn() {
    clearTimers();
    g.index++;
    if (g.index >= g.order.length) return nextRound();
    g.shown = shuffle([0, 1, 2]);
    g.votes = {};
    g.gains = {};
    g.phase = "guess";
    g.deadline = now() + g.settings.guessTime * 1000;
    g.timer = ctx.setTimeout(startReveal, g.settings.guessTime * 1000);
    const aid = author();
    for (const id of g.who.filter((i) => isBot(i) && i !== aid)) {
      // Un bot trouve le mensonge une fois sur trois… à peu près au hasard.
      later(() => { if (g.phase === "guess" && author() === aid) vote(id, Math.random() < 0.34 ? lieShown() : Math.floor(Math.random() * 3)); },
        3000 + Math.random() * Math.min(15000, g.settings.guessTime * 500));
    }
    ctx.update();
  }

  function vote(pid, index) {
    if (g.phase !== "guess" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment." };
    if (pid === author()) return { error: "Ce sont tes phrases, tu ne votes pas !" };
    if (![0, 1, 2].includes(index)) return { error: "Choisis une des 3 phrases." };
    g.votes[pid] = index;   // on peut changer d'avis jusqu'à la fin du chrono
    if (voters().every((id) => g.votes[id] !== undefined)) startReveal();
    else ctx.update();
    return { ok: true };
  }

  function startReveal() {
    if (g.phase !== "guess") return;
    clearTimers();
    const aid = author(), lie = lieShown();
    g.gains = { [aid]: 0 };
    for (const [id, v] of Object.entries(g.votes)) {
      if (v === lie) g.gains[id] = 1;     // trouvé !
      else { g.gains[id] = 0; g.gains[aid]++; }   // piégé : un point pour l'auteur
    }
    for (const [id, n] of Object.entries(g.gains)) g.scores[id] = (g.scores[id] || 0) + n;
    const e = g.entries[aid];
    g.history.push({ round: g.round, theme: e.theme, id: aid, lines: e.lines, lie: e.lie, fooled: g.gains[aid], voters: Object.keys(g.votes).length });
    g.phase = "reveal";
    g.stepAt = now();
    g.deadline = g.stepAt + REVEAL_MS;
    g.timer = ctx.setTimeout(nextTurn, REVEAL_MS);
    ctx.update();
  }

  function endGame() {
    clearTimers();
    g.phase = "over";
    g.deadline = 0;
    if (ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = ctx.setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  function clearTimers() {
    ctx.clearTimeout(g.timer);
    g.botTimers.forEach((id) => ctx.clearTimeout(id));
    g.botTimers = [];
  }

  function ranking() {
    const byScore = {};
    for (const [id, score] of Object.entries(g.scores)) (byScore[score] ||= []).push(id);
    return Object.keys(byScore).map(Number).sort((a, b) => b - a).map((s) => byScore[s]);
  }

  // =================================================================
  //  ACTIONS DES JOUEURS
  // =================================================================
  const actions = {
    settings(pid, { settings }) {
      if (!ctx.isHost(pid) || g.phase !== "setup" || !settings) return;
      const s = { ...g.settings, ...settings };
      if (![1, 2, 3].includes(s.rounds)) s.rounds = 2;
      if (![60, 90, 120].includes(s.writeTime)) s.writeTime = 90;
      if (![20, 25, 35].includes(s.guessTime)) s.guessTime = 25;
      if (!["joueurs", "banque"].includes(s.themes)) s.themes = "joueurs";
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startGame();
    },
    // Mes 3 phrases + laquelle est fausse (on peut renvoyer pour corriger).
    write(pid, { lines, lie, theme }) {
      if (g.phase !== "write" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment d'écrire." };
      const l = (Array.isArray(lines) ? lines : []).map(clean);
      if (l.length !== 3 || l.some((x) => !x)) return { error: "Écris tes 3 phrases." };
      if (![0, 1, 2].includes(lie)) return { error: "Coche laquelle est le mensonge." };
      // Mode « joueurs » : son propre thème (sinon celui tiré au sort).
      const own = g.settings.themes === "joueurs" ? String(theme || "").replace(/\s+/g, " ").trim().slice(0, THEME_LEN) : "";
      g.entries[pid] = { lines: l, lie, theme: own || g.theme.title };
      checkAllWritten();
      if (g.phase === "write") ctx.update();
    },
    vote(pid, { index }) { return vote(pid, index); },
    // 🎲 Un autre thème au hasard (juste pour celui qui demande).
    random() { const th = THEMES[Math.floor(Math.random() * THEMES.length)]; return { ok: true, title: th.title, hint: th.hint }; },
    next(pid) { if (ctx.isHost(pid) && g.phase === "reveal") nextTurn(); },
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "over" || ctx.playlist) return;
      g.phase = "setup";
      ctx.update();
    },
    finish(pid) {
      if (!ctx.isHost(pid)) return;
      clearTimers();
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
    onDisconnect() {
      if (g.phase === "write") checkAllWritten();
      else if (g.phase === "guess" && voters().every((id) => g.votes[id] !== undefined)) startReveal();
      ctx.update();
    },
    canJoin: () => g.phase === "setup" || g.phase === "over",
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startGame();
    },
    destroy() { clearTimers(); ctx.clearTimeout(g.finishTimer); },
  };
}
