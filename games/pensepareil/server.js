// ===================================================================
//  PENSE PAREIL — Moteur du jeu (module du hub Le Bordel)
//  Un thème (« Un truc rouge »), chacun écrit UNE réponse en secret.
//  On marque 1 point par autre joueur qui a écrit la même chose.
//  Les réponses proches sont fusionnées toutes seules (majuscules, accents,
//  « le/la/un », pluriels) ; l'hôte peut en fusionner d'autres à la main.
// ===================================================================

import { PROMPTS } from "./prompts.js";

export const meta = {
  id: "pensepareil",
  name: "Pense pareil",
  emoji: "🧠",
  family: "Ambiance",
  minPlayers: 3,
  maxPlayers: 8,
  description: "Un thème, une réponse : marque en pensant comme les autres !",
};

const REVEAL_MS = 20000;       // révélation (l'hôte peut passer, ou fusionner des réponses)
const MERGE_EXTRA = 8000;      // après une fusion, on laisse au moins 8 s pour voir le résultat
const FINISH_DELAY = 15000;
const MAX_LEN = 40;

function defaultSettings() {
  return { rounds: 8, answerTime: 30 };
}

export const playlist = {
  options: [
    {
      key: "rounds", label: "Thèmes", default: "5",
      choices: [{ v: "5", label: "5" }, { v: "8", label: "8" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), rounds: Number(c.rounds) === 8 ? 8 : 5 };
  },
};

const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
const clean = (t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

// « Les Chats ! » -> « chat » : majuscules, accents, ponctuation, articles et pluriels ne comptent pas.
export function normalize(text) {
  let t = String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/œ/g, "oe").replace(/æ/g, "ae").replace(/[^a-z0-9]+/g, " ").trim();
  t = t.replace(/^(le|la|les|l|un|une|des|du|de la|de|d|mon|ma|mes|ton|ta|tes|son|sa|ses)\s+/, "");
  t = t.split(" ").map((w) => (w.length > 4 && /aux$/.test(w) ? w.slice(0, -3) + "al"            // chevaux -> cheval
    : w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w)).join(" ");
  return t.trim();
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | answer | reveal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    who: [],
    prompts: [],          // les thèmes de la partie
    round: 0,
    answers: {},          // id -> réponse (texte)
    alias: {},            // fusions à la main : clé -> clé
    history: [],          // { prompt, groups: [{ label, ids }], gains }
    deadline: 0,
    timer: null,
    botTimers: [],
    final: false,
    finishAt: 0,
    finishTimer: null,
  };
  const now = () => Date.now();
  const players = () => ctx.players();
  const isBot = (id) => !!players().find((p) => p.id === id)?.bot;
  const online = () => players().filter((p) => p.connected && g.who.includes(p.id)).map((p) => p.id);
  const prompt = () => g.prompts[g.round - 1];

  // Les paquets de réponses identiques (après fusions), du plus gros au plus petit.
  const root = (k) => { let n = 0; while (g.alias[k] && n++ < 20) k = g.alias[k]; return k; };
  function groups() {
    const map = {};
    for (const [id, text] of Object.entries(g.answers)) {
      const key = root(normalize(text));
      if (!key) continue;
      (map[key] ||= { key, ids: [], texts: [] });
      map[key].ids.push(id);
      map[key].texts.push(text);
    }
    return Object.values(map).map((gr) => {
      // Le texte affiché : celui qui revient le plus… parmi ceux du paquet d'origine
      // (après une fusion « Chaton » -> « Chat », le paquet garde le nom « Chat »).
      const own = gr.texts.filter((t) => normalize(t) === gr.key);
      const count = {};
      for (const t of own.length ? own : gr.texts) count[t] = (count[t] || 0) + 1;
      const label = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
      return { key: gr.key, label, ids: gr.ids, answers: Object.fromEntries(gr.ids.map((id) => [id, g.answers[id]])) };
    }).sort((a, b) => b.ids.length - a.ids.length || a.label.localeCompare(b.label));
  }
  function gainsOf(grs) {
    const gains = {};
    for (const id of g.who) gains[id] = 0;
    for (const gr of grs) for (const id of gr.ids) gains[id] = gr.ids.length - 1;
    return gains;
  }

  // =================================================================
  //  ÉTAT PUBLIC (les réponses restent secrètes jusqu'à la révélation)
  // =================================================================
  function publicState() {
    const t = now();
    const base = {
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      who: g.who,
      round: g.round,
      rounds: g.prompts.length,
      prompt: prompt()?.text || null,
      left: Math.max(0, g.deadline - t),
      playlist: ctx.playlist && { final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
    };
    if (g.phase === "answer") base.doneIds = Object.keys(g.answers);
    if (g.phase === "reveal") {
      base.groups = groups();
      base.gains = gainsOf(base.groups);
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
    g.prompts = shuffle(PROMPTS).slice(0, g.settings.rounds);
    g.round = 0;
    g.history = [];
    nextPrompt();
  }

  function nextPrompt() {
    clearTimers();
    g.round++;
    if (g.round > g.prompts.length) return endGame();
    g.answers = {};
    g.alias = {};
    g.phase = "answer";
    g.deadline = now() + g.settings.answerTime * 1000;
    g.timer = setTimeout(startReveal, g.settings.answerTime * 1000);
    // Les bots : souvent la réponse la plus évidente, parfois une autre.
    for (const id of g.who.filter(isBot)) {
      const list = prompt().answers;
      const w = list.map((_, i) => 1 / (i + 1) ** 1.3);
      let r = Math.random() * w.reduce((a, b) => a + b, 0), pickI = 0;
      for (let i = 0; i < w.length; i++) { if ((r -= w[i]) < 0) { pickI = i; break; } }
      g.botTimers.push(setTimeout(() => { if (g.phase === "answer") answer(id, list[pickI]); }, 2500 + Math.random() * Math.min(12000, g.settings.answerTime * 400)));
    }
    ctx.update();
  }

  function answer(pid, text) {
    if (g.phase !== "answer" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment." };
    const t = clean(text);
    if (!normalize(t)) return { error: "Écris une réponse." };
    g.answers[pid] = t;   // on peut corriger tant que tout le monde n'a pas fini
    if (online().every((id) => g.answers[id])) startReveal();
    else ctx.update();
    return { ok: true };
  }

  function startReveal() {
    if (g.phase !== "answer") return;
    clearTimers();
    g.phase = "reveal";
    g.deadline = now() + REVEAL_MS;
    g.timer = setTimeout(endReveal, REVEAL_MS);
    ctx.update();
  }

  // Fin de la révélation : les points (avec les fusions) sont gardés.
  function endReveal() {
    if (g.phase !== "reveal") return;
    clearTimers();
    const grs = groups();
    const gains = gainsOf(grs);
    for (const [id, n] of Object.entries(gains)) g.scores[id] = (g.scores[id] || 0) + n;
    g.history.push({ prompt: prompt().text, groups: grs.map((gr) => ({ label: gr.label, ids: gr.ids })), gains });
    nextPrompt();
  }

  function endGame() {
    clearTimers();
    g.phase = "over";
    g.deadline = 0;
    if (ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  function clearTimers() {
    clearTimeout(g.timer);
    g.botTimers.forEach(clearTimeout);
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
      if (![5, 8, 12].includes(s.rounds)) s.rounds = 8;
      if (![20, 30, 45].includes(s.answerTime)) s.answerTime = 30;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startGame();
    },
    answer(pid, { text }) { return answer(pid, text); },
    // L'hôte fusionne deux paquets (« Chaton » dans « Chat »).
    merge(pid, { from, into }) {
      if (!ctx.isHost(pid) || g.phase !== "reveal") return { error: "Seul l'hôte peut fusionner, pendant la révélation." };
      const keys = groups().map((gr) => gr.key);
      if (!keys.includes(from) || !keys.includes(into) || from === into) return { error: "Réponses inconnues." };
      g.alias[from] = into;
      if (g.deadline - now() < MERGE_EXTRA) {
        clearTimeout(g.timer);
        g.deadline = now() + MERGE_EXTRA;
        g.timer = setTimeout(endReveal, MERGE_EXTRA);
      }
      ctx.update();
    },
    next(pid) { if (ctx.isHost(pid) && g.phase === "reveal") endReveal(); },
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
      if (g.phase === "answer" && online().every((id) => g.answers[id])) startReveal();
      ctx.update();
    },
    canJoin: () => g.phase === "setup" || g.phase === "over",
    autoStart() {
      if (players().filter((p) => p.connected).length < meta.minPlayers) { ctx.finish([]); return; }
      startGame();
    },
    destroy() { clearTimers(); clearTimeout(g.finishTimer); },
  };
}
