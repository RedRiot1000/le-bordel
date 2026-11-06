// ===================================================================
//  SUR 10 — Moteur du jeu (module du hub Le Bordel)
//  Une manche :
//  1. Vote du thème (3 proposés, le plus voté gagne)
//  2. Chacun choisit sa note de 0 à 10 en secret + écrit un indice
//     (« Un jeu vidéo » + 10 -> « Rust »)
//  3. Un joueur à la fois : les autres devinent sa note
//  4. Révélation : points selon la proximité
// ===================================================================

import { THEMES } from "./themes.js";

export const meta = {
  id: "sur10",
  name: "Sur 10",
  emoji: "🔟",
  family: "Ambiance",
  minPlayers: 3,
  maxPlayers: 8,
  description: "Ta note est secrète, ton indice la trahit. Les autres devinent.",
  pausable: true,      // jeu de réflexion : l'hôte (ou la moitié des joueurs) peut mettre en pause
};

const THEME_MS = 30000;        // vote du thème
const REVEAL_MS = 10000;       // révélation d'un joueur
const FINISH_DELAY = 15000;    // playlist : temps pour lire le classement
const MAX_LEN = 80;            // longueur max d'un indice

// Points : écart 0 -> 3, écart 1 -> 2, écart 2 -> 1. L'auteur : +1 par joueur à 1 près.
export const pointsFor = (diff) => (diff === 0 ? 3 : diff === 1 ? 2 : diff === 2 ? 1 : 0);

function defaultSettings() {
  return { rounds: 3, writeTime: 120, guessTime: 40 };
}

// ===================================================================
//  MODE PLAYLIST
// ===================================================================
export const playlist = {
  options: [
    {
      key: "rounds", label: "Manches", default: "2",
      choices: [{ v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3", label: "3" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: Number(c.rounds) || 2 };
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const clamp10 = (n) => Math.max(0, Math.min(10, Math.round(n)));
const clean = (text) => String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | theme | write | guess | reveal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    who: [],              // joueurs de la partie (ids)
    round: 0,
    usedThemes: new Set(),
    choices: [],          // vote du thème : 3 thèmes proposés
    themeVotes: {},       // id -> index du thème
    theme: null,          // thème de la manche
    entries: {},          // id -> { note, clue }
    order: [],            // ordre de passage (ids qui ont un indice)
    index: 0,             // joueur en cours dans `order`
    guesses: {},          // devineur -> note devinée (joueur en cours)
    gains: {},            // révélation : id -> points gagnés
    history: [],          // { round, theme, id, note, clue, guesses, gains }
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
  const target = () => g.order[g.index];
  const addPts = (id, n) => { g.scores[id] = (g.scores[id] || 0) + n; };

  function later(fn, ms) { g.botTimers.push(ctx.setTimeout(fn, ms)); }

  // =================================================================
  //  ÉTAT PUBLIC (la note de quelqu'un n'est jamais envoyée avant sa révélation)
  // =================================================================
  function publicState() {
    const t = now();
    const base = {
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      who: g.who,
      round: g.round,
      left: Math.max(0, g.deadline - t),
      theme: g.theme && { title: g.theme.title, scale: g.theme.scale },
      playlist: ctx.playlist && { rounds: ctx.playlist.rounds, final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
    };
    if (g.phase === "theme") {
      base.themeVote = { choices: g.choices.map((th) => ({ title: th.title, scale: th.scale })), votes: g.themeVotes };
    }
    if (g.phase === "write") base.doneIds = Object.keys(g.entries);
    if (g.phase === "guess" || g.phase === "reveal") {
      const id = target();
      base.turn = { id, clue: g.entries[id].clue, num: g.index + 1, total: g.order.length };
      if (g.phase === "guess") base.turn.guessedIds = Object.keys(g.guesses);
      else Object.assign(base.turn, { note: g.entries[id].note, guesses: g.guesses, gains: g.gains, elapsed: t - g.stepAt, duration: REVEAL_MS });
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
    startThemeVote();
  }

  // --- 1. Vote du thème ---
  function startThemeVote() {
    clearTimers();
    g.round++;
    let free = THEMES.filter((th) => !g.usedThemes.has(th.title));
    if (free.length < 3) free = THEMES;
    g.choices = shuffle(free).slice(0, 3);
    g.themeVotes = {};
    g.theme = null;
    g.phase = "theme";
    g.deadline = now() + THEME_MS;
    g.timer = ctx.setTimeout(endThemeVote, THEME_MS);
    for (const id of g.who.filter(isBot)) {
      later(() => { if (g.phase === "theme") voteTheme(id, Math.floor(Math.random() * 3)); }, 1500 + Math.random() * 4000);
    }
    ctx.update();
  }

  function voteTheme(pid, idx) {
    if (g.phase !== "theme" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment." };
    if (![0, 1, 2].includes(idx)) return { error: "Thème inconnu." };
    g.themeVotes[pid] = idx;   // on peut changer d'avis
    if (online().every((id) => g.themeVotes[id] !== undefined)) endThemeVote();
    else ctx.update();
    return { ok: true };
  }

  function endThemeVote() {
    if (g.phase !== "theme") return;
    clearTimers();
    const counts = [0, 0, 0];
    for (const i of Object.values(g.themeVotes)) counts[i]++;
    const max = Math.max(...counts);
    const best = [0, 1, 2].filter((i) => counts[i] === max);   // égalité -> au sort
    g.theme = g.choices[pick(best)];
    g.usedThemes.add(g.theme.title);
    startWrite();
  }

  // --- 2. Note + indice ---
  function startWrite() {
    g.entries = {};
    g.phase = "write";
    g.deadline = now() + g.settings.writeTime * 1000;
    g.timer = ctx.setTimeout(endWrite, g.settings.writeTime * 1000);
    // Les bots piochent un exemple du thème (avec la note qui va avec).
    for (const id of g.who.filter(isBot)) {
      later(() => {
        if (g.phase !== "write") return;
        const taken = new Set(Object.values(g.entries).map((e) => e.clue));
        const free = g.theme.examples.filter((e) => !taken.has(e.text));
        const ex = pick(free.length ? free : g.theme.examples);
        g.entries[id] = { note: ex.note, clue: ex.text };
        checkAllWritten();
        if (g.phase === "write") ctx.update();
      }, 3000 + Math.random() * 6000);
    }
    ctx.update();
  }

  function checkAllWritten() {
    if (online().every((id) => g.entries[id])) endWrite();
  }

  function endWrite() {
    if (g.phase !== "write") return;
    clearTimers();
    // Ceux qui n'ont rien envoyé ne passent pas (personne n'a d'indice à deviner).
    g.order = shuffle(g.who.filter((id) => g.entries[id]));
    if (g.order.length === 0) return endRound();
    g.index = -1;
    nextTurn();
  }

  // --- 3. On devine un joueur ---
  function guessers() { return online().filter((id) => id !== target()); }

  function nextTurn() {
    clearTimers();
    g.index++;
    if (g.index >= g.order.length) return endRound();
    g.guesses = {};
    g.gains = {};
    g.phase = "guess";
    g.deadline = now() + g.settings.guessTime * 1000;
    g.timer = ctx.setTimeout(startReveal, g.settings.guessTime * 1000);
    const tid = target(), entry = g.entries[tid];
    // Les bots devinent : bien si l'indice vient de la liste du thème, au pif sinon.
    const known = g.theme.examples.find((e) => e.text.toLowerCase() === entry.clue.toLowerCase());
    for (const id of g.who.filter((i) => isBot(i) && i !== tid)) {
      const n = known ? known.note + Math.round((Math.random() - 0.5) * 3) : 5 + Math.round((Math.random() - 0.5) * 7);
      later(() => { if (g.phase === "guess" && target() === tid) guess(id, clamp10(n)); }, 2000 + Math.random() * Math.min(8000, g.settings.guessTime * 400));
    }
    ctx.update();
  }

  function guess(pid, value) {
    if (g.phase !== "guess" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment." };
    if (pid === target()) return { error: "C'est ton indice, tu ne devines pas !" };
    if (g.guesses[pid] !== undefined) return { error: "Tu as déjà validé." };
    const v = Number(value);
    if (!Number.isInteger(v) || v < 0 || v > 10) return { error: "Choisis une note entre 0 et 10." };
    g.guesses[pid] = v;
    if (guessers().every((id) => g.guesses[id] !== undefined)) startReveal();
    else ctx.update();
    return { ok: true };
  }

  // --- 4. Révélation de ce joueur ---
  function startReveal() {
    if (g.phase !== "guess") return;
    clearTimers();
    const tid = target(), { note, clue } = g.entries[tid];
    g.gains = { [tid]: 0 };
    for (const [id, v] of Object.entries(g.guesses)) {
      const diff = Math.abs(v - note);
      g.gains[id] = pointsFor(diff);
      if (diff <= 1) g.gains[tid]++;   // bon indice : l'auteur gagne aussi
    }
    for (const [id, n] of Object.entries(g.gains)) addPts(id, n);
    g.history.push({ round: g.round, theme: g.theme.title, id: tid, note, clue, guesses: { ...g.guesses }, gains: { ...g.gains } });
    g.phase = "reveal";
    g.stepAt = now();
    g.deadline = g.stepAt + REVEAL_MS;
    g.timer = ctx.setTimeout(nextTurn, REVEAL_MS);
    ctx.update();
  }

  function endRound() {
    if (g.round >= g.settings.rounds) endGame();
    else startThemeVote();
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
      if (![1, 2, 3, 5].includes(s.rounds)) s.rounds = 3;
      if (![90, 120, 180].includes(s.writeTime)) s.writeTime = 120;
      if (![30, 40, 60].includes(s.guessTime)) s.guessTime = 40;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startGame();
    },
    theme(pid, { index }) { return voteTheme(pid, index); },
    // Note + indice (on peut renvoyer pour corriger tant que tout le monde n'a pas fini).
    write(pid, { note, clue }) {
      if (g.phase !== "write" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment d'écrire." };
      const n = Number(note);
      if (!Number.isInteger(n) || n < 0 || n > 10) return { error: "Choisis ta note (0 à 10)." };
      const c = clean(clue);
      if (!c) return { error: "Écris ton indice." };
      g.entries[pid] = { note: n, clue: c };
      checkAllWritten();
      if (g.phase === "write") ctx.update();
    },
    guess(pid, { value }) { return guess(pid, value); },
    next(pid) { if (ctx.isHost(pid) && g.phase === "reveal") nextTurn(); },
    setup(pid) {
      if (!ctx.isHost(pid) || g.phase !== "over" || ctx.playlist) return;
      g.phase = "setup";
      ctx.update();
    },
    finish(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase)) return;
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
      // Un joueur part : on ne l'attend plus.
      if (g.phase === "theme" && online().every((id) => g.themeVotes[id] !== undefined)) endThemeVote();
      else if (g.phase === "write") checkAllWritten();
      else if (g.phase === "guess" && guessers().every((id) => g.guesses[id] !== undefined)) startReveal();
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
