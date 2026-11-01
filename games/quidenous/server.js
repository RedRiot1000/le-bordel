// ===================================================================
//  QUI DE NOUS ? — Moteur du jeu (module du hub Le Bordel)
//  1. Chacun écrit des questions « Qui ... ? »
//  2. On vote pour un joueur sur chaque question (anonyme, secret)
//  3. La cérémonie : tout est dévoilé question par question (votes,
//     auteur, gagnant + son titre). +1 point si tu as voté comme la majorité.
// ===================================================================

import { QUESTIONS } from "./questions.js";

export const meta = {
  id: "quidenous",
  name: "Qui de nous ?",
  emoji: "👉",
  family: "Quiz",
  minPlayers: 3,
  maxPlayers: 8,
  description: "« Qui finirait en prison en premier ? » Votez… et assumez.",
};

const STEP_MS = 11000;         // durée d'une question pendant la cérémonie
const FINISH_DELAY = 15000;    // playlist : temps pour lire le palmarès
const MAX_LEN = 100;           // longueur max d'une question

function defaultSettings() {
  return { perPlayer: 1, writeTime: 45, voteTime: 15 };
}

// ===================================================================
//  MODE PLAYLIST : options votables ("rounds" = questions par joueur)
// ===================================================================
export const playlist = {
  options: [
    {
      key: "rounds", label: "Questions par joueur", default: "1",
      choices: [{ v: "1", label: "1" }, { v: "2", label: "2" }, { v: "3", label: "3" }],
    },
  ],
  settingsFor(c) {
    return { ...defaultSettings(), perPlayer: Number(c.rounds) || 1 };
  },
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Remet une question au propre : espaces, longueur, point d'interrogation.
function clean(text) {
  let t = String(text || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
  if (t && !t.endsWith("?")) t += " ?";
  return t;
}

// Le titre gagné : « Qui finirait en prison en premier ? » -> « finirait en prison en premier ».
export function titleOf(text) {
  const t = text.replace(/\s*\?+\s*$/, "").trim();
  const m = t.match(/^qui\s+(.+)$/i);
  return m ? m[1] : t;
}

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const g = {
    phase: "setup",       // setup | write | vote | reveal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    who: [],              // joueurs de la partie en cours (ids)
    drafts: {},           // id -> [questions écrites]
    done: {},             // id -> a envoyé ses questions
    questions: [],        // { text, author, votes: { votant: cible } }
    index: 0,             // question en cours (vote ou cérémonie)
    stepAt: 0,            // début de l'étape en cours
    deadline: 0,
    timer: null,
    botTimers: [],
    final: false,
    finishAt: 0,
    finishTimer: null,
  };

  const now = () => Date.now();
  const players = () => ctx.players();
  const pseudo = (id) => players().find((p) => p.id === id)?.pseudo || "?";
  const isBot = (id) => !!players().find((p) => p.id === id)?.bot;
  const online = () => players().filter((p) => p.connected && g.who.includes(p.id)).map((p) => p.id);

  // Une question au hasard, en évitant celles déjà prises dans la partie.
  function randomQuestion() {
    const used = new Set([...g.questions.map((q) => q.text), ...Object.values(g.drafts).flat()]);
    const free = QUESTIONS.filter((q) => !used.has(q));
    return pick(free.length ? free : QUESTIONS);
  }

  // Résultat d'une question : nombre de votes par joueur, et le(s) gagnant(s).
  function resultOf(q) {
    const counts = {};
    for (const target of Object.values(q.votes)) counts[target] = (counts[target] || 0) + 1;
    const max = Math.max(0, ...Object.values(counts));
    const winners = max ? Object.keys(counts).filter((id) => counts[id] === max) : [];
    return { counts, winners, max };
  }

  // =================================================================
  //  ÉTAT PUBLIC (rien n'est dévoilé avant la cérémonie)
  // =================================================================
  function publicState() {
    const t = now();
    const base = {
      phase: g.phase,
      settings: g.settings,
      players: players().map((p) => ({ ...p, score: g.scores[p.id] || 0 })),
      who: g.who,
      left: Math.max(0, g.deadline - t),
      playlist: ctx.playlist && { rounds: ctx.playlist.rounds, final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
    };
    if (g.phase === "write") {
      base.doneIds = Object.keys(g.done);
    }
    if (g.phase === "vote") {
      const q = g.questions[g.index];
      base.vote = { num: g.index + 1, total: g.questions.length, text: q.text, votedIds: Object.keys(q.votes) };
    }
    if (g.phase === "reveal" || g.phase === "over") {
      // Seulement les questions déjà dévoilées.
      const upTo = g.phase === "over" ? g.questions.length : g.index + 1;
      base.revealed = g.questions.slice(0, upTo).map((q) => {
        const r = resultOf(q);
        return { text: q.text, title: titleOf(q.text), author: q.author, votes: q.votes, counts: r.counts, winners: r.winners };
      });
      base.step = { num: g.index + 1, total: g.questions.length, elapsed: t - g.stepAt, duration: STEP_MS };
    }
    if (g.phase === "over") {
      // Le palmarès : les titres gagnés par chacun.
      const titles = {};
      for (const q of base.revealed) for (const id of q.winners) (titles[id] ||= []).push(q.title);
      base.titles = titles;
    }
    return base;
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startGame() {
    clearTimers();
    g.who = players().filter((p) => p.connected).map((p) => p.id);
    for (const id of g.who) g.scores[id] = g.scores[id] || 0;
    g.drafts = {};
    g.done = {};
    g.questions = [];
    g.index = 0;
    g.phase = "write";
    g.deadline = now() + g.settings.writeTime * 1000;
    g.timer = setTimeout(endWrite, g.settings.writeTime * 1000);
    // Les bots écrivent après quelques secondes.
    for (const id of g.who.filter(isBot)) {
      g.botTimers.push(setTimeout(() => {
        if (g.phase !== "write") return;
        g.drafts[id] = Array.from({ length: g.settings.perPlayer }, () => randomQuestion());
        g.done[id] = true;
        checkAllWritten();
        if (g.phase === "write") ctx.update();
      }, 2000 + Math.random() * 4000));
    }
    ctx.update();
  }

  function checkAllWritten() {
    if (online().every((id) => g.done[id])) endWrite();
  }

  function endWrite() {
    if (g.phase !== "write") return;
    clearTimers();
    // Chaque joueur a ses N questions (complétées au hasard s'il en manque).
    const list = [];
    for (const id of g.who) {
      const mine = (g.drafts[id] || []).map(clean).filter(Boolean).slice(0, g.settings.perPlayer);
      while (mine.length < g.settings.perPlayer) mine.push(randomQuestion());
      for (const text of mine) list.push({ text, author: id, votes: {} });
    }
    g.questions = shuffle(list);
    g.index = -1;
    g.phase = "vote";
    nextVote();
  }

  function nextVote() {
    clearTimers();
    g.index++;
    if (g.index >= g.questions.length) return startReveal();
    g.deadline = now() + g.settings.voteTime * 1000;
    g.timer = setTimeout(nextVote, g.settings.voteTime * 1000);
    // Les bots votent au hasard (y compris pour eux-mêmes).
    for (const id of g.who.filter(isBot)) {
      const qi = g.index;
      g.botTimers.push(setTimeout(() => {
        if (g.phase === "vote" && g.index === qi) vote(id, pick(g.who));
      }, 1200 + Math.random() * Math.min(6000, g.settings.voteTime * 600)));
    }
    ctx.update();
  }

  function vote(pid, target) {
    const q = g.questions[g.index];
    if (g.phase !== "vote" || !g.who.includes(pid)) return { error: "Tu ne joues pas cette partie." };
    if (q.votes[pid]) return { error: "Tu as déjà voté." };
    if (!g.who.includes(target)) return { error: "Joueur inconnu." };
    q.votes[pid] = target;
    if (online().every((id) => q.votes[id])) nextVote();
    else ctx.update();
    return { ok: true };
  }

  // La cérémonie : une question toutes les ~11 s (l'hôte peut accélérer).
  function startReveal() {
    g.phase = "reveal";
    g.index = -1;
    nextReveal();
  }

  function nextReveal() {
    clearTimers();
    g.index++;
    if (g.index >= g.questions.length) return endGame();
    // Points de cette question : +1 pour chaque vote donné à un des plus désignés.
    const q = g.questions[g.index];
    const { winners } = resultOf(q);
    for (const [voter, target] of Object.entries(q.votes)) if (winners.includes(target)) g.scores[voter] = (g.scores[voter] || 0) + 1;
    g.stepAt = now();
    g.deadline = g.stepAt + STEP_MS;
    g.timer = setTimeout(nextReveal, STEP_MS);
    ctx.update();
  }

  function endGame() {
    clearTimers();
    g.phase = "over";
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
      if (![1, 2, 3].includes(s.perPlayer)) s.perPlayer = 1;
      if (![30, 45, 60].includes(s.writeTime)) s.writeTime = 45;
      if (![10, 15, 20].includes(s.voteTime)) s.voteTime = 15;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (players().filter((p) => p.connected).length < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      startGame();
    },
    // Une idée de question au hasard (bouton 🎲) : seulement pour celui qui demande.
    random() { return { ok: true, text: randomQuestion() }; },
    // Envoi (ou renvoi) de ses questions pendant l'écriture.
    write(pid, { texts }) {
      if (g.phase !== "write" || !g.who.includes(pid)) return { error: "Ce n'est pas le moment d'écrire." };
      const list = (Array.isArray(texts) ? texts : []).map(clean).filter(Boolean).slice(0, g.settings.perPlayer);
      if (list.length < g.settings.perPlayer) return { error: `Écris ${g.settings.perPlayer > 1 ? "tes " + g.settings.perPlayer + " questions" : "ta question"} (ou utilise 🎲).` };
      g.drafts[pid] = list;
      g.done[pid] = true;
      checkAllWritten();
      if (g.phase === "write") ctx.update();
    },
    vote(pid, { target }) { return vote(pid, target); },
    next(pid) { if (ctx.isHost(pid) && g.phase === "reveal") nextReveal(); },
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
      return fn(pid, data) || { ok: true };
    },
    onReconnect() { ctx.update(); },
    onDisconnect() {
      // Un joueur part : on ne l'attend plus.
      if (g.phase === "write") checkAllWritten();
      else if (g.phase === "vote" && online().every((id) => g.questions[g.index].votes[id])) nextVote();
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
