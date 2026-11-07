// ===================================================================
//  DONJON — Données et calculs partagés (serveur + navigateur)
//  Les salles, les classes, les ennemis, les pièges, les boss, et les
//  calculs que les deux côtés doivent faire pareil (les murs du donjon,
//  l'arène des hordes, le chemin des ennemis).
//    globalThis.Donjon
// ===================================================================

(function (root) {
  const D = {};

  // ---- Le donjon : une grille de 5 × 4 salles de 400 × 300 px ----
  D.CW = 400; D.CH = 300; D.COLS = 5; D.ROWS = 4;
  D.WW = D.CW * D.COLS; D.WH = D.CH * D.ROWS;       // 2000 × 1200
  D.WALL = 24; D.DOOR = 100;                         // épaisseur des murs, largeur des portes
  D.ENTRY = { c: 0, r: 1 };                          // la salle d'entrée (fixe)

  // ---- L'arène des hordes (phase 1) ----
  D.HW = 1280; D.HH = 800;

  // Les salles toutes faites (obstacles en coordonnées de la salle). Elles laissent toujours les 4 portes libres.
  D.TEMPLATES = {
    vide:    { name: "Salle vide", emoji: "⬜", rects: [] },
    piliers: { name: "Piliers", emoji: "🏛️", rects: [[95, 70, 40, 40], [265, 70, 40, 40], [95, 190, 40, 40], [265, 190, 40, 40]] },
    croix:   { name: "Couloirs en croix", emoji: "➕", rects: [[12, 12, 118, 80], [270, 12, 118, 80], [12, 208, 118, 80], [270, 208, 118, 80]] },
    arene:   { name: "Arène", emoji: "⭕", rects: [[170, 120, 60, 60]] },
    dedale:  { name: "Dédale", emoji: "🌀", rects: [[70, 40, 22, 110], [308, 150, 22, 110], [160, 196, 80, 22], [160, 82, 80, 22]] },   // (passages de 68 px)
    etroit:  { name: "Passage étroit", emoji: "↔️", rects: [[60, 110, 105, 80], [235, 110, 105, 80]] },
  };
  D.TPL_IDS = Object.keys(D.TEMPLATES);

  // ---- Les 4 classes ----
  D.CLASSES = {
    mage: {
      name: "Mage", emoji: "🧙", color: "#a07bff", hp: 80, speed: 1.0, role: "Dégâts de zone, fragile",
      basic: { name: "Orbe", cd: 450, desc: "Une orbe magique." },
      skills: [
        { lvl: 2, name: "Boule de feu", cd: 5000, desc: "Explose à l'impact (zone)." },
        { lvl: 3, name: "Nova de givre", cd: 8000, desc: "Gèle et ralentit tout autour de toi." },
        { lvl: 4, name: "Téléport", cd: 7000, desc: "Saut instantané vers le viseur." },
      ],
      passive: { lvl: 5, name: "Mana vive", desc: "Toutes tes recharges −25 %." },
    },
    chevalier: {
      name: "Chevalier", emoji: "🛡️", color: "#5fb0ff", hp: 160, speed: 0.92, role: "Tank, encaisse et protège",
      basic: { name: "Épée", cd: 600, desc: "Un coup d'épée devant toi." },
      skills: [
        { lvl: 2, name: "Bouclier", cd: 10000, desc: "3 s : tu encaisses 70 % de dégâts en moins." },
        { lvl: 3, name: "Charge", cd: 7000, desc: "Fonce en frappant et repoussant." },
        { lvl: 4, name: "Défi", cd: 12000, desc: "Les ennemis proches ne visent plus que toi." },
      ],
      passive: { lvl: 5, name: "Armure", desc: "−20 % de dégâts reçus." },
    },
    archer: {
      name: "Archer", emoji: "🏹", color: "#5fe08a", hp: 95, speed: 1.08, role: "Dégâts à distance",
      basic: { name: "Flèche", cd: 380, desc: "Une flèche rapide." },
      skills: [
        { lvl: 2, name: "Tir perçant", cd: 4000, desc: "Traverse tous les ennemis." },
        { lvl: 3, name: "Pluie de flèches", cd: 9000, desc: "3 volées sur une zone devant toi." },
        { lvl: 4, name: "Piège à loups", cd: 10000, desc: "Pose un piège qui blesse et immobilise." },
      ],
      passive: { lvl: 5, name: "Œil de lynx", desc: "25 % de coups critiques (×2)." },
    },
    armes: {
      name: "Homme d'armes", emoji: "⚔️", color: "#ff8a4a", hp: 130, speed: 1.0, role: "Mêlée, gros dégâts",
      basic: { name: "Hache", cd: 750, desc: "Un grand coup de hache." },
      skills: [
        { lvl: 2, name: "Tourbillon", cd: 6000, desc: "Frappe tout autour de toi." },
        { lvl: 3, name: "Coup étourdissant", cd: 7000, desc: "Assomme les ennemis devant toi." },
        { lvl: 4, name: "Rage", cd: 15000, desc: "6 s : +50 % de dégâts, frappe plus vite." },
      ],
      passive: { lvl: 5, name: "Vol de vie", desc: "15 % des dégâts infligés te soignent." },
    },
  };
  D.CLASS_IDS = Object.keys(D.CLASSES);

  // Niveaux (expérience totale) : niveau 1 à 6.
  D.XP = [0, 110, 290, 530, 840, 1240];
  D.level = (xp) => { let l = 1; while (l < D.XP.length && xp >= D.XP[l]) l++; return l; };
  D.HP_PER_LVL = 0.12;     // +12 % de PV max par niveau
  D.DMG_PER_LVL = 0.08;    // +8 % de dégâts par niveau

  // ---- Les ennemis ----
  D.ENEMIES = {
    squelette: { name: "Squelette", emoji: "💀", hp: 64, speed: 150, r: 15, xp: 10, cost: 2, kind: "melee", range: 34, wind: 350, dmg: 13, cd: 1000, color: "#d8d2c0" },
    archer:    { name: "Archer squelette", emoji: "🏹", hp: 48, speed: 140, r: 15, xp: 12, cost: 3, kind: "tir", keep: 250, dmg: 12, cd: 1700, color: "#b9c8a0" },
    brute:     { name: "Brute", emoji: "👹", hp: 220, speed: 100, r: 22, xp: 28, cost: 5, kind: "slam", range: 72, wind: 800, dmg: 34, cd: 2200, color: "#8fae5a" },
  };
  D.ENEMY_IDS = Object.keys(D.ENEMIES);
  D.SHOT_V = 430;          // vitesse des tirs ennemis

  // ---- Les pièges (cachés aux slayers, déclenchés par le maître du jeu) ----
  D.TRAPS = {
    pics: { name: "Pics", emoji: "🔱", cost: 2, energy: 1, w: 70, h: 70, wind: 450, dmg: 22, cd: 4000 },
    rune: { name: "Rune explosive", emoji: "💥", cost: 3, energy: 2, r: 90, wind: 900, dmg: 40, cd: 8000 },
  };
  D.TRAP_IDS = Object.keys(D.TRAPS);

  // ---- Les boss (PV : base + par slayer) ----
  D.BOSSES = {
    golem:  { name: "Golem", emoji: "🗿", hpBase: 900, hpPer: 650, speed: 95, r: 34, color: "#9a8f80", basic: "Écrasement", special: "Rocher" },
    necro:  { name: "Nécromancien", emoji: "☠️", hpBase: 700, hpPer: 500, speed: 125, r: 26, color: "#7b4fb0", basic: "Orbe sombre", special: "Invocation" },
    dragon: { name: "Dragon", emoji: "🐉", hpBase: 800, hpPer: 580, speed: 115, r: 32, color: "#c0442f", basic: "Morsure", special: "Souffle de feu" },
  };
  D.BOSS_IDS = Object.keys(D.BOSSES);

  // Énergie du maître du jeu (phase 2) et renforts.
  D.ENERGY_START = 4; D.ENERGY_MAX = 12; D.ENERGY_EVERY = 2500;
  D.REINFORCE = { squelette: 2, archer: 3, brute: 5 };
  D.budgetFor = (slayers) => 16 + 12 * slayers + slayers * slayers;     // (plus que proportionnel : à 6, ils se couvrent tous)
  D.groupMul = (slayers) => 0.85 + 0.1 * slayers;                          // PV des monstres du donjon selon le nombre de slayers

  // =================================================================
  //  LES MURS
  // =================================================================
  D.cellRect = (c, r) => ({ x: c * D.CW, y: r * D.CH, w: D.CW, h: D.CH });
  D.cellOf = (x, y) => ({ c: Math.max(0, Math.min(D.COLS - 1, Math.floor(x / D.CW))), r: Math.max(0, Math.min(D.ROWS - 1, Math.floor(y / D.CH))) });
  D.cellCenter = (c, r) => ({ x: c * D.CW + D.CW / 2, y: r * D.CH + D.CH / 2 });
  D.emptyGrid = () => Array.from({ length: D.ROWS }, () => Array.from({ length: D.COLS }, () => "vide"));

  // Tous les murs du donjon (rectangles) d'après la grille des salles.
  D.walls = function (grid) {
    const out = [], T = D.WALL, half = T / 2;
    // Murs horizontaux (lignes y = r × CH) ; une porte au milieu de chaque mur intérieur.
    for (let r = 0; r <= D.ROWS; r++) for (let c = 0; c < D.COLS; c++) {
      const x0 = c * D.CW - half, x1 = (c + 1) * D.CW + half, y = r * D.CH - half;
      if (r === 0 || r === D.ROWS) out.push({ x: x0, y, w: x1 - x0, h: T });
      else { const m = c * D.CW + D.CW / 2; out.push({ x: x0, y, w: m - D.DOOR / 2 - x0, h: T }, { x: m + D.DOOR / 2, y, w: x1 - (m + D.DOOR / 2), h: T }); }
    }
    for (let c = 0; c <= D.COLS; c++) for (let r = 0; r < D.ROWS; r++) {
      const y0 = r * D.CH - half, y1 = (r + 1) * D.CH + half, x = c * D.CW - half;
      if (c === 0 || c === D.COLS) out.push({ x, y: y0, w: T, h: y1 - y0 });
      else { const m = r * D.CH + D.CH / 2; out.push({ x, y: y0, w: T, h: m - D.DOOR / 2 - y0 }, { x, y: m + D.DOOR / 2, w: T, h: y1 - (m + D.DOOR / 2) }); }
    }
    for (let r = 0; r < D.ROWS; r++) for (let c = 0; c < D.COLS; c++) {
      const tpl = D.TEMPLATES[grid?.[r]?.[c]] || D.TEMPLATES.vide;
      for (const [x, y, w, h] of tpl.rects) out.push({ x: c * D.CW + x, y: r * D.CH + y, w, h, inner: true });
    }
    return out;
  };

  // L'arène des hordes : le bord et quelques piliers.
  D.hordeWalls = function () {
    const W = D.HW, H = D.HH, T = 30;
    const out = [{ x: -T, y: -T, w: W + 2 * T, h: T }, { x: -T, y: H, w: W + 2 * T, h: T }, { x: -T, y: 0, w: T, h: H }, { x: W, y: 0, w: T, h: H }];
    for (const [x, y] of [[300, 220], [940, 220], [300, 540], [940, 540], [620, 140], [620, 620]]) out.push({ x: x - 22, y: y - 22, w: 44, h: 44, inner: true });
    return out;
  };

  // Un point est-il libre (pas dans un mur, avec une marge r) ?
  D.free = function (rects, x, y, r, W, H) {
    if (x < r || y < r || x > W - r || y > H - r) return false;
    for (const o of rects) if (x > o.x - r && x < o.x + o.w + r && y > o.y - r && y < o.y + o.h + r) return false;
    return true;
  };
  // Pousse un cercle (o.x, o.y, rayon r) hors des murs.
  D.pushOut = function (o, r, rects) {
    for (const w of rects) {
      const qx = Math.max(w.x, Math.min(o.x, w.x + w.w)), qy = Math.max(w.y, Math.min(o.y, w.y + w.h));
      let dx = o.x - qx, dy = o.y - qy, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d === 0) { // (le centre est dans le mur : on sort par le côté le plus proche)
        const l = o.x - w.x, rr = w.x + w.w - o.x, t = o.y - w.y, b = w.y + w.h - o.y, m = Math.min(l, rr, t, b);
        if (m === l) o.x = w.x - r; else if (m === rr) o.x = w.x + w.w + r; else if (m === t) o.y = w.y - r; else o.y = w.y + w.h + r;
        continue;
      }
      o.x = qx + (dx / d) * r; o.y = qy + (dy / d) * r;
    }
  };
  // Un trait (de a à b) passe-t-il à travers un mur ?
  D.los = function (rects, x1, y1, x2, y2) {
    const L = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(L / 14));
    for (let i = 1; i < n; i++) {
      const x = x1 + ((x2 - x1) * i) / n, y = y1 + ((y2 - y1) * i) / n;
      for (const o of rects) if (x > o.x && x < o.x + o.w && y > o.y && y < o.y + o.h) return false;
    }
    return true;
  };

  // =================================================================
  //  LE CHEMIN : une grille de cases de 20 px ; une « carte des distances »
  //  depuis un point permet à chacun de savoir dans quel sens avancer.
  // =================================================================
  D.TILE = 20;
  D.nav = function (rects, W, H) {
    const cols = Math.ceil(W / D.TILE), rows = Math.ceil(H / D.TILE), block = new Uint8Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = i * D.TILE + D.TILE / 2, y = j * D.TILE + D.TILE / 2;
      block[j * cols + i] = D.free(rects, x, y, 12, W, H) ? 0 : 1;
    }
    return { cols, rows, block, W, H };
  };
  D.tileOf = (nav, x, y) => Math.max(0, Math.min(nav.cols - 1, Math.floor(x / D.TILE))) + Math.max(0, Math.min(nav.rows - 1, Math.floor(y / D.TILE))) * nav.cols;
  D.field = function (nav, x, y) {
    const n = nav.cols * nav.rows, dist = new Int16Array(n).fill(-1), q = new Int32Array(n);
    let start = D.tileOf(nav, x, y);
    if (nav.block[start]) { // (le point est contre un mur : on part de la case libre la plus proche)
      const ci = start % nav.cols, cj = (start / nav.cols) | 0;
      outer: for (let rr = 1; rr < 4; rr++) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
        const i = ci + di, j = cj + dj;
        if (i >= 0 && j >= 0 && i < nav.cols && j < nav.rows && !nav.block[j * nav.cols + i]) { start = j * nav.cols + i; break outer; }
      }
    }
    let h = 0, t = 0;
    dist[start] = 0; q[t++] = start;
    while (h < t) {
      const k = q[h++], i = k % nav.cols, j = (k / nav.cols) | 0, d = dist[k] + 1;
      if (i > 0 && dist[k - 1] < 0 && !nav.block[k - 1]) { dist[k - 1] = d; q[t++] = k - 1; }
      if (i < nav.cols - 1 && dist[k + 1] < 0 && !nav.block[k + 1]) { dist[k + 1] = d; q[t++] = k + 1; }
      if (j > 0 && dist[k - nav.cols] < 0 && !nav.block[k - nav.cols]) { dist[k - nav.cols] = d; q[t++] = k - nav.cols; }
      if (j < nav.rows - 1 && dist[k + nav.cols] < 0 && !nav.block[k + nav.cols]) { dist[k + nav.cols] = d; q[t++] = k + nav.cols; }
    }
    return dist;
  };
  // Distance (en cases) jusqu'au point de départ de la carte, depuis (x, y). -1 : impossible.
  D.fieldAt = (nav, field, x, y) => field[D.tileOf(nav, x, y)];
  // Le sens où aller depuis (x, y) pour se rapprocher du point de départ de la carte.
  D.dirFrom = function (nav, field, x, y) {
    const k = D.tileOf(nav, x, y), i = k % nav.cols, j = (k / nav.cols) | 0;
    let best = -1, bd = field[k] < 0 ? 1e9 : field[k];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nav.cols || jj >= nav.rows) continue;
      const kk = jj * nav.cols + ii, v = field[kk];
      if (v < 0) continue;
      // (en diagonale : seulement si les deux cases à côté sont libres, sinon on frotte le coin)
      if (di && dj && (nav.block[j * nav.cols + ii] || nav.block[jj * nav.cols + i])) continue;
      if (v < bd) { bd = v; best = kk; }
    }
    if (best < 0) return null;
    const tx = (best % nav.cols) * D.TILE + D.TILE / 2, ty = ((best / nav.cols) | 0) * D.TILE + D.TILE / 2, dx = tx - x, dy = ty - y, l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l };
  };

  root.Donjon = D;
})(typeof window !== "undefined" ? window : globalThis);
