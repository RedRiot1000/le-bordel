// ===================================================================
//  DEVINE LA MAP (CS2) — Moteur du jeu (module du hub Le Bordel)
//  Un screenshot s'affiche chez tout le monde, très zoomé sur un détail,
//  et se dézoome petit à petit. Chacun clique sur la map qu'il reconnaît
//  (une seule réponse). Plus tu réponds tôt, plus tu gagnes de points.
//  La bonne réponse ne quitte jamais le serveur avant la révélation.
// ===================================================================

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const meta = {
  id: "cs2map",
  name: "Devine la map",
  emoji: "🗺️",
  family: "Quiz",
  minPlayers: 2,
  maxPlayers: 6,
  description: "Un screenshot de CS2 : de quelle map vient-il ?",
};

// Toutes les maps connues (dans l'ordre d'affichage) et leur nom.
export const MAPS = {
  mirage: "Mirage", inferno: "Inferno", nuke: "Nuke", ancient: "Ancient", anubis: "Anubis",
  dust2: "Dust2", train: "Train", overpass: "Overpass", vertigo: "Vertigo", cache: "Cache", office: "Office", italy: "Italy",
};
const mapName = (id) => MAPS[id] || id.charAt(0).toUpperCase() + id.slice(1);

// --- Rythme ---
const REVEAL_MS = 5000;        // durée de la révélation entre deux images
const FINISH_DELAY = 15000;    // playlist : temps pour lire le classement avant de passer
const MIN_FACTOR = 0.4;        // une bonne réponse à la dernière seconde rapporte 40 %

function defaultSettings() {
  return { images: 10, time: 20, zoom: 4 };
}

// ===================================================================
//  MODE PLAYLIST : options votables
// ===================================================================
export const playlist = {
  options: [
    {
      key: "difficulty", label: "Zoom de départ", default: "normal",
      choices: [
        { v: "facile", label: "😌 Facile", hint: "Zoom ×2" },
        { v: "normal", label: "🙂 Normal", hint: "Zoom ×4" },
        { v: "difficile", label: "😈 Difficile", hint: "Zoom ×6" },
      ],
    },
    {
      key: "rounds", label: "Nombre d'images", default: "5",
      choices: [{ v: "5", label: "5" }, { v: "10", label: "10" }, { v: "15", label: "15" }],
    },
  ],
  settingsFor(c) {
    const s = defaultSettings();
    s.zoom = c.difficulty === "facile" ? 2 : c.difficulty === "difficile" ? 6 : 4;
    s.images = Number(c.rounds) || 5;
    return s;
  },
};

// La liste des screenshots (créée par  npm run images).
const MANIFEST = path.join(path.dirname(fileURLToPath(import.meta.url)), "manifest.json");
function loadImages() {
  try { return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : []; }
  catch { return []; }
}

const rand = (a, b) => a + Math.random() * (b - a);
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// ===================================================================
//  CRÉATION D'UNE PARTIE
// ===================================================================
export function createGame(ctx) {
  const images = loadImages();
  const maps = Object.keys(MAPS).filter((m) => images.some((i) => i.map === m))
    .concat([...new Set(images.map((i) => i.map))].filter((m) => !MAPS[m]));   // maps "hors liste" à la fin

  const g = {
    phase: "setup",       // setup | question | reveal | over
    settings: ctx.savedSettings ? { ...defaultSettings(), ...ctx.savedSettings } : defaultSettings(),
    scores: {},
    series: 0,            // nombre de séries jouées
    queue: [],            // images de la série (dans l'ordre)
    index: -1,
    q: null,              // question en cours : { img, map, fx, fy, start, end, answers }
    history: [],          // résultats de chaque image de la série
    timer: null,
    botTimers: [],
    final: false,
    finishAt: 0,
    finishTimer: null,
  };

  const now = () => Date.now();
  const nPlayers = () => ctx.players().filter((p) => p.connected).length;
  // Si on se resert de la même partie en playlist, "rounds" = nombre d'images.
  const total = () => (ctx.playlist ? ctx.playlist.rounds : g.settings.images);

  // =================================================================
  //  ÉTAT PUBLIC (la bonne réponse n'est envoyée qu'à la révélation)
  // =================================================================
  function publicState() {
    const t = now();
    const q = g.q;
    const reveal = g.phase === "reveal" || g.phase === "over";
    return {
      phase: g.phase,
      settings: g.settings,
      imageCount: images.length,
      perMap: Object.fromEntries(maps.map((m) => [m, images.filter((i) => i.map === m).length])),
      maps: maps.map((id) => ({ id, name: mapName(id) })),
      // Pendant une question, on cache les points de cette image (sinon on devinerait qui a trouvé).
      players: ctx.players().map((p) => ({
        ...p, score: (g.scores[p.id] || 0) - (g.phase === "question" ? q?.answers[p.id]?.points || 0 : 0),
      })),
      index: g.index,
      total: g.queue.length || total(),
      playlist: ctx.playlist && { rounds: ctx.playlist.rounds, final: g.final, finishLeft: g.final ? Math.max(0, g.finishAt - t) : 0 },
      q: q && {
        img: "games/cs2map/img/" + q.img,
        zoom: g.settings.zoom, fx: q.fx, fy: q.fy,
        left: Math.max(0, q.end - t), totalMs: q.end - q.start,
        answered: Object.keys(q.answers),                   // QUI a répondu (pas quoi)
        // À la révélation seulement : la bonne map et ce que chacun a répondu.
        map: reveal ? q.map : null,
        mapName: reveal ? mapName(q.map) : null,
        answers: reveal ? Object.fromEntries(Object.entries(q.answers).map(([id, a]) =>
          [id, { map: a.map, mapName: mapName(a.map), correct: a.correct, points: a.points, secs: a.secs }])) : null,
      },
      history: g.phase === "over" ? g.history : null,
    };
  }

  // =================================================================
  //  DÉROULÉ
  // =================================================================
  function startSeries() {
    if (!images.length) return "Aucun screenshot pour l'instant : ajoute-en avec  npm run images.";
    // On pioche au hasard, sans répéter (si pas assez d'images, on en prend moins).
    g.queue = shuffle(images).slice(0, Math.min(total(), images.length));
    g.index = -1;
    g.history = [];
    g.series++;
    for (const p of ctx.players()) g.scores[p.id] = g.scores[p.id] || 0;
    nextImage();
    return null;
  }

  function nextImage() {
    clearTimers();
    g.index++;
    if (g.index >= g.queue.length) return endSeries();
    const im = g.queue[g.index];
    const t = now();
    g.q = {
      img: im.file, map: im.map,
      fx: rand(0.2, 0.8), fy: rand(0.25, 0.75),   // le détail sur lequel on zoome (le même pour tous)
      start: t, end: t + g.settings.time * 1000,
      answers: {},
    };
    g.phase = "question";
    g.timer = setTimeout(reveal, g.settings.time * 1000);
    botsAnswer();
    ctx.update();
  }

  function reveal() {
    if (g.phase !== "question") return;
    clearTimers();
    const q = g.q;
    g.history.push({
      map: q.map, mapName: mapName(q.map), img: "games/cs2map/img/" + q.img,
      found: Object.entries(q.answers).filter(([, a]) => a.correct).map(([id]) => id),
    });
    g.phase = "reveal";
    g.timer = setTimeout(nextImage, REVEAL_MS);
    ctx.update();
  }

  function endSeries() {
    g.phase = "over";
    if (ctx.playlist) {
      g.final = true;
      g.finishAt = now() + FINISH_DELAY;
      g.finishTimer = setTimeout(() => ctx.finish(ranking()), FINISH_DELAY);
    }
    ctx.update();
  }

  // Tout le monde (connecté) a répondu ? On révèle tout de suite.
  function checkAllAnswered() {
    const online = ctx.players().filter((p) => p.connected).map((p) => p.id);
    if (online.every((id) => g.q.answers[id])) reveal();
  }

  function answer(pid, map) {
    const q = g.q;
    if (g.phase !== "question" || q.answers[pid]) return { error: "Tu as déjà répondu." };
    if (!maps.includes(map)) return { error: "Map inconnue." };
    const t = now();
    const progress = Math.min(1, (t - q.start) / (q.end - q.start));
    const correct = map === q.map;
    // 100 points si on répond tout de suite, 40 à la dernière seconde.
    const points = correct ? Math.round(100 * (1 - (1 - MIN_FACTOR) * progress)) : 0;
    q.answers[pid] = { map, correct, points, secs: Math.round((t - q.start) / 100) / 10 };
    g.scores[pid] = (g.scores[pid] || 0) + points;
    checkAllAnswered();
    if (g.phase === "question") ctx.update();
    return { ok: true };
  }

  // Les bots répondent après un délai au hasard, justes environ une fois sur deux.
  function botsAnswer() {
    for (const p of ctx.players().filter((x) => x.bot)) {
      const delay = rand(2500, g.settings.time * 1000 * 0.8);
      g.botTimers.push(setTimeout(() => {
        if (g.phase !== "question") return;
        const guess = Math.random() < 0.5 ? g.q.map : maps[Math.floor(Math.random() * maps.length)];
        answer(p.id, guess);
      }, delay));
    }
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
      if (![5, 10, 15, 20].includes(s.images)) s.images = 10;
      if (![15, 20, 30].includes(s.time)) s.time = 20;
      if (![2, 4, 6].includes(s.zoom)) s.zoom = 4;
      g.settings = s;
      ctx.saveSettings({ ...s });
      ctx.update();
    },
    start(pid) {
      if (!ctx.isHost(pid) || !["setup", "over"].includes(g.phase) || g.final) return;
      if (nPlayers() < meta.minPlayers) return { error: `Il faut au moins ${meta.minPlayers} joueurs connectés.` };
      const err = startSeries();
      if (err) return { error: err };
    },
    answer(pid, { map }) { return answer(pid, map); },
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
    onDisconnect() { if (g.phase === "question") checkAllAnswered(); ctx.update(); },
    canJoin: () => true,   // on peut arriver en cours : on joue à partir de l'image suivante
    autoStart() {
      if (nPlayers() < meta.minPlayers || startSeries()) { ctx.finish([]); return; }
    },
    destroy() { clearTimers(); clearTimeout(g.finishTimer); },
  };
}
