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
  pausable: true,      // jeu de réflexion : l'hôte (ou la moitié des joueurs) peut mettre en pause
};

const REVEAL_MS = 20000;       // révélation (l'hôte peut passer, ou fusionner des réponses)
const MERGE_EXTRA = 8000;      // après une fusion, on laisse au moins 8 s pour voir le résultat
const FINISH_DELAY = 15000;
const MAX_LEN = 40;
const THEME_LEN = 60;
// Réponses des bots sur un thème inventé par un joueur (ils ne le connaissent pas : ils tentent leur chance).
const GUESSES = ["Je sais pas", "Aucune idée", "Pizza", "Chat", "Rouge", "Paris", "Mario", "Le soleil", "Mon lit", "Une banane"];

function defaultSettings() {
  // themes : "joueurs" = chacun écrit ses thèmes au début (défaut) · "banque" = thèmes tout prêts
  return { rounds: 8, answerTime: 60, themes: "joueurs" };
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
    phase: "setup",       // setup | propose | answer | reveal | over
    proposals: {},        // mode « joueurs » : id -> [thèmes écrits]
    perPlayer: 1,         // thèmes à écrire par joueur
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
  const now = () => ctx.now();
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
      promptBy: prompt()?.by || null,   // qui a écrit le thème (mode « joueurs »)
      left: Math.max(0, g.deadline - t),
      playlist: ctx.playlist && { final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
    };
    if (g.phase === "propose") { base.doneIds = Object.keys(g.proposals); base.perPlayer = g.perPlayer; }
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
    g.round = 0;
    g.history = [];
    if (g.settings.themes === "banque") {
      g.prompts = shuffle(PROMPTS).slice(0, g.settings.rounds);
      return nextPrompt();
    }
    startPropose();
  }

  // --- Mode « joueurs » : chacun écrit ses thèmes (🎲 pour en piocher un) ---
  function startPropose() {
    g.proposals = {};
    g.perPlayer = Math.max(1, Math.min(3, Math.ceil(g.settings.rounds / g.who.length)));
    g.phase = "propose";
    const ms = (60 + 40 * g.perPlayer) * 1000;
    g.deadline = now() + ms;
    g.timer = ctx.setTimeout(endPropose, ms);
    for (const id of g.who.filter(isBot)) {
      g.botTimers.push(ctx.setTimeout(() => {
        if (g.phase !== "propose") return;
        g.proposals[id] = shuffle(PROMPTS).slice(0, g.perPlayer).map((p) => p.text);
        checkAllProposed();
        if (g.phase === "propose") ctx.update();
      }, 3000 + Math.random() * 6000));
    }
    ctx.update();
  }

  function checkAllProposed() {
    if (online().every((id) => g.proposals[id])) endPropose();
  }

  // Les thèmes de la partie : un de chaque joueur à tour de rôle, complétés par la banque s'il en manque.
  function endPropose() {
    if (g.phase !== "propose") return;
    clearTimers();
    const list = [], used = new Set();
    const authors = shuffle(Object.keys(g.proposals));
    for (let k = 0; k < g.perPlayer; k++) {
      for (const id of authors) {
        const text = g.proposals[id][k];
        if (!text || used.has(text.toLowerCase())) continue;
        used.add(text.toLowerCase());
        const known = PROMPTS.find((p) => p.text.toLowerCase() === text.toLowerCase());
        list.push({ text, answers: known?.answers || null, by: id });
      }
    }
    for (const p of shuffle(PROMPTS)) {
      if (list.length >= g.settings.rounds) break;
      if (!used.has(p.text.toLowerCase())) list.push(p);
    }
    g.prompts = list.slice(0, g.settings.rounds);
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
    g.timer = ctx.setTimeout(startReveal, g.settings.answerTime * 1000);
    // Les bots : souvent la réponse la plus évidente, parfois une autre.
    for (const id of g.who.filter(isBot)) {
      const list = prompt().answers;
      if (!list) {
        // Thème inventé : le bot tente de copier la réponse de quelqu'un… ou répond au pif.
        g.botTimers.push(ctx.setTimeout(() => {
          if (g.phase !== "answer") return;
          const others = Object.entries(g.answers).filter(([oid]) => oid !== id).map(([, t]) => t);
          answer(id, others.length && Math.random() < 0.6 ? others[Math.floor(Math.random() * others.length)] : GUESSES[Math.floor(Math.random() * GUESSES.length)]);
        }, g.settings.answerTime * 1000 * (0.4 + Math.random() * 0.45)));
        continue;
      }
      const w = list.map((_, i) => 1 / (i + 1) ** 1.3);
      let r = Math.random() * w.reduce((a, b) => a + b, 0), pickI = 0;
      for (let i = 0; i < w.length; i++) { if ((r -= w[i]) < 0) { pickI = i; break; } }
      g.botTimers.push(ctx.setTimeout(() => { if (g.phase === "answer") answer(id, list[pickI]); }, 2500 + Math.random() * Math.min(12000, g.settings.answerTime * 400)));
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
    g.timer = ctx.setTimeout(endReveal, REVEAL_MS);
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
      if (![5, 8, 12].includes(s.rounds)) s.rounds = 8;
      if (![45, 60, 90].includes(s.answerTime)) s.answerTime = 60;
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
    answer(pid, { text }) { return answer(pid, text); },
    // Mes thèmes (mode « joueurs ») : on peut renvoyer pour corriger.
    propose(pid, { texts }) {
      if (g.phase !== "propose" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment." };
      const list = (Array.isArray(texts) ? texts : []).map((t) => String(t || "").replace(/\s+/g, " ").trim().slice(0, THEME_LEN)).filter(Boolean);
      if (list.length < g.perPlayer) return { error: g.perPlayer > 1 ? `Écris tes ${g.perPlayer} thèmes (ou 🎲).` : "Écris ton thème (ou 🎲)." };
      g.proposals[pid] = list.slice(0, g.perPlayer);
      checkAllProposed();
      if (g.phase === "propose") ctx.update();
    },
    // 🎲 Un thème de la banque, au hasard (juste pour celui qui demande).
    random() { return { ok: true, text: PROMPTS[Math.floor(Math.random() * PROMPTS.length)].text }; },
    // L'hôte fusionne deux paquets (« Chaton » dans « Chat »).
    merge(pid, { from, into }) {
      if (!ctx.isHost(pid) || g.phase !== "reveal") return { error: "Seul l'hôte peut fusionner, pendant la révélation." };
      const keys = groups().map((gr) => gr.key);
      if (!keys.includes(from) || !keys.includes(into) || from === into) return { error: "Réponses inconnues." };
      g.alias[from] = into;
      if (g.deadline - now() < MERGE_EXTRA) {
        ctx.clearTimeout(g.timer);
        g.deadline = now() + MERGE_EXTRA;
        g.timer = ctx.setTimeout(endReveal, MERGE_EXTRA);
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
      if (g.phase === "propose") checkAllProposed();
      else if (g.phase === "answer" && online().every((id) => g.answers[id])) startReveal();
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
