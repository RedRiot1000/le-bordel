// ===================================================================
//  CLASSEMENT — Moteur du jeu (module du hub Le Bordel)
//  Une manche = un « juge » :
//  1. Le juge choisit un thème parmi 3 (« Un fast-food »)
//  2. 5 choses s'affichent. Le juge les classe selon SES goûts,
//     les autres essaient de deviner SON classement.
//  3. Révélation : 2 pts par place exacte, 1 pt à une place près.
//  Les thèmes viennent de Sur 10 (5 exemples par thème).
// ===================================================================

import { THEMES } from "../sur10/themes.js";

export const meta = {
  id: "classement",
  name: "Classement",
  emoji: "📊",
  family: "Ambiance",
  minPlayers: 3,
  maxPlayers: 8,
  description: "Devine comment ton pote classe 5 trucs. Tu le connais si bien que ça ?",
  pausable: true,      // jeu de réflexion : l'hôte (ou la moitié des joueurs) peut mettre en pause
};

const PICK_MS = 30000;        // le juge choisit le thème
const REVEAL_MS = 14000;      // révélation d'une manche
const FINISH_DELAY = 15000;   // playlist : temps pour lire le classement
export const N = 5;           // nombre de choses à classer

// Points d'un devineur : 2 par chose à la bonne place, 1 si à une place près.
export function scoreOf(guess, truth) {
  let pts = 0;
  guess.forEach((item, i) => {
    const d = Math.abs(truth.indexOf(item) - i);
    pts += d === 0 ? 2 : d === 1 ? 1 : 0;
  });
  return pts;
}

// « 0 = nul · 10 = génial » -> { top: "génial", bottom: "nul" }
export function endsOf(scale) {
  const m = /0\s*=\s*(.+?)\s*·\s*10\s*=\s*(.+)$/.exec(scale || "");
  return m ? { top: m[2], bottom: m[1] } : { top: "génial", bottom: "nul" };
}

function defaultSettings() {
  return { laps: 1, rankTime: 90 };
}

// ===================================================================
//  MODE PLAYLIST (« rounds » = nombre de fois où chacun est juge)
// ===================================================================
export const playlist = {
  options: [
    {
      key: "rounds", label: "Chacun est juge", default: "1",
      choices: [{ v: "1", label: "1 fois" }, { v: "2", label: "2 fois" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), laps: Number(c.rounds) || 1 };
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const validRanking = (list) => Array.isArray(list) && list.length === N && new Set(list).size === N && list.every((i) => Number.isInteger(i) && i >= 0 && i < N);

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | pick | rank | reveal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    who: [],
    judges: [],           // ordre des juges pour toute la partie
    round: 0,             // manche en cours (1 = premier juge)
    usedThemes: new Set(),
    choices: [],          // 3 thèmes proposés au juge
    theme: null,
    items: [],            // les 5 choses (textes), dans l'ordre d'affichage
    notes: [],            // les notes Sur 10 des choses (pour les bots)
    ranks: {},            // id -> [indices des choses, du 1er au 5e]
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
  const judge = () => g.judges[g.round - 1];
  const later = (fn, ms) => g.botTimers.push(ctx.setTimeout(fn, ms));

  // =================================================================
  //  ÉTAT PUBLIC (aucun classement n'est envoyé avant la révélation)
  // =================================================================
  function publicState() {
    const t = now();
    const base = {
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      who: g.who,
      round: g.round,
      rounds: g.judges.length,
      judge: judge(),
      left: Math.max(0, g.deadline - t),
      playlist: ctx.playlist && { rounds: ctx.playlist.rounds, final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
    };
    if (g.phase === "pick") base.choices = g.choices.map((th) => ({ title: th.title, ...endsOf(th.scale) }));
    if (g.theme) base.theme = { title: g.theme.title, ...endsOf(g.theme.scale) };
    if (g.phase === "rank") { base.items = g.items; base.doneIds = Object.keys(g.ranks); }
    if (g.phase === "reveal") {
      base.items = g.items;
      base.ranks = g.ranks;
      base.gains = g.gains;
      base.elapsed = t - g.stepAt;
      base.duration = REVEAL_MS;
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
    g.judges = [];
    for (let i = 0; i < g.settings.laps; i++) g.judges.push(...shuffle(g.who));
    g.round = 0;
    g.usedThemes = new Set();
    g.history = [];
    nextRound();
  }

  function nextRound() {
    clearTimers();
    g.round++;
    // Juge parti entre-temps : on passe au suivant.
    while (g.round <= g.judges.length && !online().includes(judge())) g.round++;
    if (g.round > g.judges.length) return endGame();
    let free = THEMES.filter((th) => !g.usedThemes.has(th.title));
    if (free.length < 3) free = THEMES;
    g.choices = shuffle(free).slice(0, 3);
    g.theme = null;
    g.phase = "pick";
    g.deadline = now() + PICK_MS;
    g.timer = ctx.setTimeout(() => choose(Math.floor(Math.random() * 3)), PICK_MS);
    if (isBot(judge())) later(() => { if (g.phase === "pick") choose(Math.floor(Math.random() * 3)); }, 2000 + Math.random() * 3000);
    ctx.update();
  }

  // Le juge a choisi : on mélange les 5 choses et tout le monde classe.
  function choose(idx) {
    if (g.phase !== "pick") return;
    clearTimers();
    g.theme = g.choices[idx];
    g.usedThemes.add(g.theme.title);
    const ex = shuffle(g.theme.examples).slice(0, N);
    g.items = ex.map((e) => e.text);
    g.notes = ex.map((e) => e.note);
    g.ranks = {};
    g.gains = {};
    g.phase = "rank";
    g.deadline = now() + g.settings.rankTime * 1000;
    g.timer = ctx.setTimeout(startReveal, g.settings.rankTime * 1000);
    // Les bots : le juge suit les notes de Sur 10 (avec un peu de fantaisie), les autres classent au pif.
    const byNote = (noise) => [0, 1, 2, 3, 4]
      .map((i) => [i, g.notes[i] + Math.random() * noise])
      .sort((a, b) => b[1] - a[1]).map(([i]) => i);
    for (const id of g.who.filter(isBot)) {
      const list = id === judge() ? byNote(3) : Math.random() < 0.6 ? byNote(6) : shuffle([0, 1, 2, 3, 4]);
      later(() => { if (g.phase === "rank") rank(id, list); }, 4000 + Math.random() * Math.min(15000, g.settings.rankTime * 400));
    }
    ctx.update();
  }

  function rank(pid, list) {
    if (g.phase !== "rank" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment." };
    if (!validRanking(list)) return { error: "Classe les 5 choses (chacune une seule fois)." };
    g.ranks[pid] = [...list];   // on peut renvoyer pour corriger
    if (online().every((id) => g.ranks[id])) startReveal();
    else ctx.update();
    return { ok: true };
  }

  function startReveal() {
    if (g.phase !== "rank") return;
    clearTimers();
    const jid = judge(), truth = g.ranks[jid];
    g.gains = {};
    if (truth) {
      // Le juge gagne la moyenne de ce que marquent les autres : il a intérêt à être sincère.
      const guessers = Object.keys(g.ranks).filter((id) => id !== jid);
      for (const id of guessers) g.gains[id] = scoreOf(g.ranks[id], truth);
      const sum = guessers.reduce((s, id) => s + g.gains[id], 0);
      g.gains[jid] = guessers.length ? Math.round(sum / guessers.length) : 0;
      for (const [id, n] of Object.entries(g.gains)) g.scores[id] = (g.scores[id] || 0) + n;
    }
    g.history.push({ round: g.round, judge: jid, theme: g.theme.title, items: g.items, truth: truth || null, gains: { ...g.gains } });
    g.phase = "reveal";
    g.stepAt = now();
    g.deadline = g.stepAt + REVEAL_MS;
    g.timer = ctx.setTimeout(nextRound, REVEAL_MS);
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
      if (![1, 2].includes(s.laps)) s.laps = 1;
      if (![60, 90, 120].includes(s.rankTime)) s.rankTime = 90;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startGame();
    },
    theme(pid, { index }) {
      if (g.phase !== "pick" || pid !== judge()) return { error: "C'est le juge qui choisit." };
      if (![0, 1, 2].includes(index)) return { error: "Thème inconnu." };
      choose(index);
    },
    rank(pid, { list }) { return rank(pid, list); },
    next(pid) { if (ctx.isHost(pid) && g.phase === "reveal") nextRound(); },
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
      // Un joueur part : on ne l'attend plus (si c'est le juge, la manche saute).
      if ((g.phase === "pick" || g.phase === "rank") && !online().includes(judge())) nextRound();
      else if (g.phase === "rank" && online().every((id) => g.ranks[id])) startReveal();
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
