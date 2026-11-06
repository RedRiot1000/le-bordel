// ===================================================================
//  GRAND PRIX — Le circuit (partagé serveur + navigateur)
//  Un circuit fermé tiré d'une seed : le serveur et le navigateur
//  construisent EXACTEMENT le même (mêmes virages, mêmes obstacles).
//    globalThis.CourseTrack
// ===================================================================

(function (root) {
  const T = {};
  T.WIDTH = 240;          // largeur de la piste (3 voies de 80 px)
  T.LANES = 3;
  T.STEP = 24;            // distance entre deux points de la ligne du milieu
  T.LEN = 13000;          // longueur visée d'un tour (px)
  T.MARGIN = 700;         // herbe autour du circuit jusqu'aux bords du monde
  T.CELL = 200;           // taille des cases de la grille de recherche
  T.RAIL = 60;            // les barrières sont à WIDTH/2 + RAIL du milieu (une bande d'herbe entre la piste et elles)
  T.TYRE = 26;            // une pile de pneus (carré)
  T.BALE = 34;            // une botte de paille (carré)

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Courbe lisse qui passe par tous les points de contrôle (Catmull-Rom, boucle fermée).
  function smooth(ctrl, per) {
    const out = [], n = ctrl.length;
    for (let i = 0; i < n; i++) {
      const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
      for (let k = 0; k < per; k++) {
        const t = k / per, t2 = t * t, t3 = t2 * t;
        out.push({
          x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    return out;
  }
  const loopLen = (pts) => { let L = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; L += Math.hypot(b.x - a.x, b.y - a.y); } return L; };

  // Points régulièrement espacés (tous les STEP px) le long de la boucle.
  function resample(pts, step) {
    const L = loopLen(pts), n = Math.round(L / step), d = L / n, out = [];
    let i = 0, acc = 0, segA = pts[0], segB = pts[1], segL = Math.hypot(segB.x - segA.x, segB.y - segA.y);
    for (let k = 0; k < n; k++) {
      const target = k * d;
      while (acc + segL < target && i < pts.length * 2) { acc += segL; i++; segA = pts[i % pts.length]; segB = pts[(i + 1) % pts.length]; segL = Math.hypot(segB.x - segA.x, segB.y - segA.y); }
      const f = segL ? (target - acc) / segL : 0;
      out.push({ x: segA.x + (segB.x - segA.x) * f, y: segA.y + (segB.y - segA.y) * f });
    }
    return out;
  }

  // Un essai de circuit. Renvoie null s'il ne convient pas (virage trop serré, piste qui se touche).
  // sharp : un circuit avec de vraies épingles (virages très serrés).
  function attempt(rnd, sharp) {
    const n = 12 + Math.floor(rnd() * 6);
    const R = 1500, ctrl = [];
    for (let i = 0; i < n; i++) {
      const a = ((i + (rnd() - 0.5) * 0.55) / n) * Math.PI * 2;
      let r = R * (0.7 + 0.3 * rnd());
      const u = rnd();
      if (u < (sharp ? 0.4 : 0.3)) r *= sharp ? 0.42 : 0.5;   // un point rentré = une épingle ou une chicane
      else if (u < 0.42) r *= 1.18;                    // un point sorti = une grande courbe
      ctrl.push({ x: Math.cos(a) * r * 1.35, y: Math.sin(a) * r * 0.9 });
    }
    let pts = smooth(ctrl, 30);
    const k = T.LEN / loopLen(pts);
    pts = pts.map((p) => ({ x: p.x * k, y: p.y * k }));
    pts = resample(pts, T.STEP);
    const N = pts.length;
    // Courbure (1 / rayon du virage) en chaque point.
    const ang = pts.map((p, i) => { const q = pts[(i + 1) % N]; return Math.atan2(q.y - p.y, q.x - p.x); });
    const curv = pts.map((p, i) => {
      const a0 = ang[(i - 2 + N) % N], a1 = ang[(i + 2) % N];
      return Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) / (4 * T.STEP);
    });
    if (curv.some((c) => Math.abs(c) > 1 / (sharp ? 125 : 150))) return null;         // virage impossible à prendre
    // Circuit « sec » : il faut au moins 2 vraies épingles.
    if (sharp) {
      let hair = 0, inside = false;
      for (const c of curv) { const t = Math.abs(c) > 1 / 165; if (t && !inside) hair++; inside = t; }
      if (hair < 2) return null;
    }
    // La piste ne doit jamais toucher une autre partie d'elle-même.
    const W = T.WIDTH;
    for (let i = 0; i < N; i += 2) for (let j = i + 2; j < N; j += 2) {
      const along = Math.min(j - i, N - (j - i)) * T.STEP;
      if (along < W * 2.6) continue;
      if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < W * 1.7) return null;
    }
    return { pts, ang, curv };
  }

  // ===================================================================
  //  LE CIRCUIT COMPLET
  // ===================================================================
  T.build = function (seed) {
    // Un circuit sur deux a de vraies épingles (s'il n'en trouve pas, un circuit normal).
    const sharp = seeded(seed ^ 0x5eed)() < 0.5;
    let a = null, tries = 0;
    while (!a) { a = attempt(seeded(seed + tries * 7919), sharp && tries < 200); tries++; if (tries > 500) throw new Error("circuit introuvable"); }
    let { pts, ang, curv } = a;
    let N = pts.length;
    // Départ : au milieu de la ligne droite la plus longue (là où ça tourne le moins).
    let best = 0, bestScore = Infinity;
    const win = 30;
    for (let i = 0; i < N; i++) { let s = 0; for (let k = -win; k <= win; k++) s += Math.abs(curv[(i + k + N) % N]); if (s < bestScore) { bestScore = s; best = i; } }
    const rot = (arr) => arr.slice(best).concat(arr.slice(0, best));
    pts = rot(pts); ang = rot(ang); curv = rot(curv);
    // On décale tout pour que le monde commence à (0, 0).
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    pts = pts.map((p) => ({ x: Math.round((p.x - minX + T.MARGIN) * 100) / 100, y: Math.round((p.y - minY + T.MARGIN) * 100) / 100 }));
    const t = {
      seed, pts, ang, curv, N, len: N * T.STEP,
      w: Math.ceil(maxX - minX + 2 * T.MARGIN), h: Math.ceil(maxY - minY + 2 * T.MARGIN),
      obstacles: [], cones: [],
    };
    const rnd = seeded(seed ^ 0x51ed);
    placeObstacles(t, rnd);
    placeNarrows(t, seeded(seed ^ 0x7a11));
    // (à l'intérieur d'un virage serré, la ligne décalée se croiserait : on retire les points trop près de la piste)
    const RD = T.WIDTH / 2 + T.RAIL;
    t.rails = [-1, 1].map((side) => t.pts.map((p, i) => { const n = normal(t, i); return { x: p.x + n.x * RD * side, y: p.y + n.y * RD * side }; })
      .filter((q) => { for (let j = 0; j < t.N; j += 2) if (Math.hypot(t.pts[j].x - q.x, t.pts[j].y - q.y) < RD - 6) return false; return true; }));
    t.segs = [];
    for (const line of t.rails) for (let i = 0; i < line.length; i++) { const a = line[i], b = line[(i + 1) % line.length]; t.segs.push([a.x, a.y, b.x, b.y]); }
    buildGrid(t);
    return t;
  };

  const normal = (t, i) => ({ x: -Math.sin(t.ang[i]), y: Math.cos(t.ang[i]) });   // vers la droite du sens de course
  T.normal = normal;

  // Murs de pneus à l'extérieur des virages serrés, bottes de paille sur certaines lignes droites,
  // plots (qu'on renverse) à la corde des virages.
  function placeObstacles(t, rnd) {
    const { N, pts, curv } = t, W = T.WIDTH;
    const tight = (i) => Math.abs(curv[i]) > 1 / 330;
    // Virages serrés : une rangée de pneus à l'extérieur.
    for (let i = 0; i < N; i++) {
      if (!tight(i) || i % 3) continue;
      const n = normal(t, i), side = curv[i] > 0 ? -1 : 1;       // l'extérieur du virage
      const d = W / 2 + T.RAIL + 20;
      const x = pts[i].x + n.x * d * side, y = pts[i].y + n.y * d * side;
      if (tooCloseToTrack(t, x, y, W / 2 + T.RAIL + 10)) continue;
      t.obstacles.push({ x: Math.round(x - T.TYRE / 2), y: Math.round(y - T.TYRE / 2), w: T.TYRE, h: T.TYRE, kind: "pneus" });
    }
    // Plots à la corde (intérieur) des virages.
    for (let i = 0; i < N; i++) {
      if (!tight(i) || i % 4) continue;
      const n = normal(t, i), side = curv[i] > 0 ? 1 : -1;        // l'intérieur
      const d = W / 2 - 10;
      t.cones.push({ id: t.cones.length, x: Math.round(pts[i].x + n.x * d * side), y: Math.round(pts[i].y + n.y * d * side) });
    }
    // Bottes de paille sur les longues lignes droites (jamais près du départ).
    let run = 0;
    for (let i = 0; i < N; i++) {
      if (Math.abs(curv[i]) < 1 / 900) run++; else run = 0;
      const s = i * T.STEP;
      if (run === 30 && s > 900 && s < t.len - 600 && rnd() < 0.7) {
        const j = i - 12, n = normal(t, j), side = rnd() < 0.5 ? -1 : 1;
        const d = W * (0.15 + rnd() * 0.15);
        t.obstacles.push({ x: Math.round(pts[j].x + n.x * d * side - T.BALE / 2), y: Math.round(pts[j].y + n.y * d * side - T.BALE / 2), w: T.BALE, h: T.BALE, kind: "paille", s: j * T.STEP, lat: d * side });
        run = 0;
      }
    }
  }
  // Sur certains circuits, une portion de piste passe à 2 voies ou à 1 seule, puis revient à 3.
  // t.hw[i] = demi-largeur de la piste au point i. Sur les côtés de la portion : de l'herbe.
  function placeNarrows(t, rnd) {
    const FULL = T.WIDTH / 2, TAPER = 9;       // 9 points (~215 px) pour se resserrer
    t.hw = new Array(t.N).fill(FULL);
    t.narrows = [];
    if (rnd() > 0.65) return;
    const count = 1 + Math.floor(rnd() * 3);
    for (let k = 0, tries = 0; k < count && tries < 40; tries++) {
      const lanes = rnd() < 0.65 ? 2 : 1;
      const len = 20 + Math.floor(rnd() * 22);                  // 480 à 1000 px à largeur réduite
      const i0 = Math.floor(rnd() * t.N), total = len + 2 * TAPER;
      if (i0 * T.STEP < 900 || (i0 + total) * T.STEP > t.len - 700) continue;     // jamais près du départ
      if (t.narrows.some((n) => i0 < n.i0 + n.total + 45 && n.i0 < i0 + total + 45)) continue;
      let bend = false;                                         // jamais dans un virage serré
      for (let q = -6; q < total + 6; q++) if (Math.abs(t.curv[i0 + q]) > 1 / 330) bend = true;
      if (bend) continue;
      const hw = (T.WIDTH / T.LANES) * lanes / 2;
      for (let q = 0; q < total; q++) {
        const f = q < TAPER ? q / TAPER : q >= total - TAPER ? (total - 1 - q) / TAPER : 1;
        const e = f * f * (3 - 2 * f);                          // un resserrement en douceur
        t.hw[i0 + q] = Math.min(t.hw[i0 + q], FULL + (hw - FULL) * e);
      }
      t.narrows.push({ i0, total, lanes, hw });
      k++;
    }
    // Rien sur la piste ni dans l'herbe de ces portions : ni paille, ni plots à la corde…
    const inside = (s) => t.narrows.some((n) => s > (n.i0 - 8) * T.STEP && s < (n.i0 + n.total + 8) * T.STEP);
    t.obstacles = t.obstacles.filter((o) => !(o.kind === "paille" && inside(o.s)));
    t.cones = t.cones.filter((c) => { const j = nearestPoint(t, c.x, c.y); return !inside(j * T.STEP); });
    // … mais des plots qui annoncent le rétrécissement, le long du bord.
    for (const n of t.narrows) for (const [a, b] of [[n.i0, n.i0 + TAPER], [n.i0 + n.total - TAPER, n.i0 + n.total]]) {
      for (let i = a; i < b; i += 3) for (const side of [-1, 1]) {
        const nn = normal(t, i), d = (t.hw[i] + 6) * side;
        t.cones.push({ x: Math.round(t.pts[i].x + nn.x * d), y: Math.round(t.pts[i].y + nn.y * d) });
      }
    }
    t.cones.forEach((c, i) => (c.id = i));
  }
  function nearestPoint(t, x, y) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < t.N; i++) { const d = Math.hypot(t.pts[i].x - x, t.pts[i].y - y); if (d < bd) { bd = d; best = i; } }
    return best;
  }
  // La demi-largeur de la piste au point i.
  T.halfAt = (t, i) => t.hw[((i % t.N) + t.N) % t.N];

  function tooCloseToTrack(t, x, y, d) {
    for (let i = 0; i < t.N; i += 2) if (Math.hypot(t.pts[i].x - x, t.pts[i].y - y) < d) return true;
    return false;
  }

  // ===================================================================
  //  GRILLE DE RECHERCHE (pour trouver vite le bout de piste le plus proche)
  // ===================================================================
  function buildGrid(t) {
    const C = T.CELL, gw = Math.ceil(t.w / C), gh = Math.ceil(t.h / C), reach = T.WIDTH * 1.6;
    t.gw = gw; t.gh = gh;
    t.grid = new Array(gw * gh);
    for (let k = 0; k < t.grid.length; k++) t.grid[k] = [];
    for (let i = 0; i < t.N; i++) {
      const a = t.pts[i], b = t.pts[(i + 1) % t.N];
      const x0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - reach) / C)), x1 = Math.min(gw - 1, Math.floor((Math.max(a.x, b.x) + reach) / C));
      const y0 = Math.max(0, Math.floor((Math.min(a.y, b.y) - reach) / C)), y1 = Math.min(gh - 1, Math.floor((Math.max(a.y, b.y) + reach) / C));
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) t.grid[gy * gw + gx].push(i);
    }
    t.segGrid = new Array(gw * gh);
    for (let k = 0; k < t.segGrid.length; k++) t.segGrid[k] = [];
    for (const g of t.segs) {
      const x0 = Math.max(0, Math.floor((Math.min(g[0], g[2]) - 40) / C)), x1 = Math.min(gw - 1, Math.floor((Math.max(g[0], g[2]) + 40) / C));
      const y0 = Math.max(0, Math.floor((Math.min(g[1], g[3]) - 40) / C)), y1 = Math.min(gh - 1, Math.floor((Math.max(g[1], g[3]) + 40) / C));
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) t.segGrid[gy * gw + gx].push(g);
    }
    t.obsGrid = new Array(gw * gh);
    for (let k = 0; k < t.obsGrid.length; k++) t.obsGrid[k] = [];
    for (const o of t.obstacles) {
      const x0 = Math.max(0, Math.floor((o.x - 80) / C)), x1 = Math.min(gw - 1, Math.floor((o.x + o.w + 80) / C));
      const y0 = Math.max(0, Math.floor((o.y - 80) / C)), y1 = Math.min(gh - 1, Math.floor((o.y + o.h + 80) / C));
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) t.obsGrid[gy * gw + gx].push(o);
    }
  }
  const cellOf = (t, x, y) => {
    const gx = Math.floor(x / T.CELL), gy = Math.floor(y / T.CELL);
    if (gx < 0 || gy < 0 || gx >= t.gw || gy >= t.gh) return -1;
    return gy * t.gw + gx;
  };

  // Où est-on sur la piste ? { s : distance depuis le départ, dist : écart au milieu, i } — ou null si loin de tout.
  T.locate = function (t, x, y) {
    const k = cellOf(t, x, y);
    if (k < 0) return null;
    let best = null, bestD = Infinity;
    for (const i of t.grid[k]) {
      const a = t.pts[i], b = t.pts[(i + 1) % t.N];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
      const f = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / L2));
      const px = a.x + dx * f, py = a.y + dy * f;
      const d = Math.hypot(x - px, y - py);
      if (d < bestD) { bestD = d; best = { i, s: (i + f) * T.STEP, dist: d }; }
    }
    return best;
  };

  // Hors piste ? 0 = sur la piste, 1 = en plein dans l'herbe.
  T.offAt = function (t, x, y) {
    const l = T.locate(t, x, y);
    if (!l) return 1;
    const e = l.dist - t.hw[l.i] - 11;                 // (le vibreur est encore de la piste)
    return e <= 0 ? 0 : Math.min(1, e / 8);
  };

  // Les obstacles proches d'un point (pour la physique).
  T.nearObs = function (t, x, y) {
    const k = cellOf(t, x, y);
    return k < 0 ? [] : t.obsGrid[k];
  };

  // Un point du milieu de la piste à la distance s (avec son angle).
  T.at = function (t, s) {
    const L = t.len;
    s = ((s % L) + L) % L;
    const f = s / T.STEP, i = Math.floor(f) % t.N, j = (i + 1) % t.N, u = f - Math.floor(f);
    const a = t.pts[i], b = t.pts[j];
    return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, a: t.ang[i], i };
  };

  // L'environnement pour la physique des voitures (PatatePhysics).
  T.env = function (t) {
    const env = {
      w: t.w, h: t.h, grip: 1, oils: [], obstacles: [], nitro: true,
      nitroRegen: 0.05, driftRegen: 0.22,
      offAt: (x, y) => T.offAt(t, x, y),
      rails: (x, y) => { const k = cellOf(t, x, y); return k < 0 ? [] : t.segGrid[k]; },
    };
    return env;
  };

  // Les places sur la grille de départ (2 colonnes, derrière la ligne).
  T.startGrid = function (t, n) {
    const out = [];
    for (let k = 0; k < n; k++) {
      // 3 colonnes (une par voie), un peu décalées.
      const col = k % 3, row = Math.floor(k / 3), s = -60 - row * 64 - col * 14, lat = (col - 1) * (T.WIDTH / 3);
      const p = T.at(t, s), nn = normal(t, p.i);
      out.push({ x: p.x + nn.x * lat, y: p.y + nn.y * lat, a: p.a, s });
    }
    return out;
  };

  root.CourseTrack = T;
})(typeof window !== "undefined" ? window : globalThis);
