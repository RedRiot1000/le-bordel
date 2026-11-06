// ===================================================================
//  CAVALE — Le quartier (partagé serveur + navigateur)
//  Un quartier tiré d'une seed : le serveur et le navigateur construisent
//  EXACTEMENT le même. Rues, ruelles, immeubles, maisons à traverser,
//  cours clôturées, parcs. La prison est au milieu, sur une grande place.
//  Tout est rangé dans une grille de cases de 32 px.
//    globalThis.Quartier
// ===================================================================

(function (root) {
  const Q = {};
  Q.T = 32;                 // taille d'une case
  Q.COLS = 80; Q.ROWS = 54;
  Q.W = Q.T * Q.COLS; Q.H = Q.T * Q.ROWS;
  Q.PW = 14; Q.PH = 10;     // la prison, en cases
  const CELL = 128;         // case de la grille de recherche des murs

  // Ce qui bloque (t.cells) : 1 mur, 2 clôture (on tire à travers), 3 arbre, 4 caisse, 5 mur de prison, 6 toit.
  // Le sol (t.ground) : 0 route, 1 trottoir, 2 plancher, 3 herbe, 4 place, 5 prison.
  Q.ROAD = 0; Q.WALK = 1; Q.FLOOR = 2; Q.GRASS = 3; Q.PLAZA = 4; Q.JAIL = 5;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  Q.build = function (seed) {
    const rnd = seeded(seed);
    const irand = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const mix = (arr) => { const q = [...arr]; for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; } return q; };
    const C = Q.COLS, R = Q.ROWS;
    const cells = new Uint8Array(C * R), ground = new Uint8Array(C * R);
    const at = (c, r) => r * C + c;
    const inside = (c, r) => c >= 0 && r >= 0 && c < C && r < R;
    const put = (a, x0, y0, x1, y1, v) => { for (let r = y0; r < y1; r++) for (let c = x0; c < x1; c++) if (inside(c, r)) a[at(c, r)] = v; };

    // Les rues : des bandes de 4 cases, qui découpent le quartier en pâtés.
    const splits = (n) => {
      const out = [];
      let c = 4;
      for (;;) {
        const w = irand(10, 15);
        if (n - 4 - (c + w + 4) < 10) { out.push([c, n - 4]); break; }
        out.push([c, c + w]);
        c += w + 4;
      }
      return out;
    };
    const xs = splits(C), ys = splits(R);

    // Une ouverture de 3 cases dans un mur.
    const door = (x0, y0, x1, y1, side) => {
      if (side === 0 || side === 1) { const c = irand(x0 + 1, x1 - 4), r = side === 0 ? y0 : y1 - 1; put(cells, c, r, c + 3, r + 1, 0); }
      else { const r = irand(y0 + 1, y1 - 4), c = side === 2 ? x0 : x1 - 1; put(cells, c, r, c + 1, r + 3, 0); }
    };
    // Un pâté : coupé par une ruelle s'il est grand, sinon un immeuble, une maison, une cour ou un parc.
    function block(x0, y0, x1, y1) {
      const w = x1 - x0, h = y1 - y0;
      if (w >= 17 || h >= 17 || (Math.max(w, h) >= 12 && rnd() < 0.6)) {
        if (w >= h) { const m = x0 + irand(Math.floor(w * 0.35), Math.ceil(w * 0.6)); block(x0, y0, m, y1); block(m + 3, y0, x1, y1); }
        else { const m = y0 + irand(Math.floor(h * 0.35), Math.ceil(h * 0.6)); block(x0, y0, x1, m); block(x0, m + 3, x1, y1); }
        return;
      }
      put(ground, x0, y0, x1, y1, Q.WALK);
      const a = x0 + 1, b = y0 + 1, c = x1 - 1, d = y1 - 1, iw = c - a, ih = d - b;
      if (iw < 4 || ih < 4) return;
      const u = rnd();
      if (iw >= 6 && ih >= 6 && u < 0.42) {
        // La maison à traverser : des murs, un plancher, des portes.
        put(cells, a, b, c, d, 1); put(cells, a + 1, b + 1, c - 1, d - 1, 0); put(ground, a, b, c, d, Q.FLOOR);
        for (const side of mix([0, 1, 2, 3]).slice(0, irand(2, 4))) door(a, b, c, d, side);
        if (iw >= 11) { const m = a + Math.floor(iw / 2); put(cells, m, b + 1, m + 1, d - 1, 1); const r = irand(b + 2, d - 5); put(cells, m, r, m + 1, r + 3, 0); }
      } else if (iw >= 6 && ih >= 6 && u < 0.6) {
        // La cour : une clôture, de l'herbe, quelques caisses.
        put(cells, a, b, c, d, 2); put(cells, a + 1, b + 1, c - 1, d - 1, 0); put(ground, a, b, c, d, Q.GRASS);
        for (const side of mix([0, 1, 2, 3]).slice(0, 2)) door(a, b, c, d, side);
        for (let k = irand(1, 3); k > 0; k--) { const p = irand(a + 2, c - 5), q = irand(b + 2, d - 5); put(cells, p, q, p + 2, q + 2, 4); }
      } else if (iw >= 6 && ih >= 6 && u < 0.7) {
        // Le parc : de l'herbe et des arbres, bien espacés.
        put(ground, a, b, c, d, Q.GRASS);
        for (let q = b + 1; q < d - 2; q += 6) for (let p = a + 1; p < c - 2; p += 6) {
          if (rnd() < 0.7) { const tx = p + irand(0, 1), ty = q + irand(0, 1); put(cells, tx, ty, tx + 2, ty + 2, 3); }
        }
      } else {
        // L'immeuble : plein, parfois en L.
        put(cells, a, b, c, d, 6);
        if (rnd() < 0.45 && iw >= 6 && ih >= 6) {
          const fx = rnd() < 0.5, fy = rnd() < 0.5, cw = Math.floor(iw / 2), ch = Math.floor(ih / 2);
          put(cells, fx ? a : c - cw, fy ? b : d - ch, fx ? a + cw : c, fy ? b + ch : d, 0);
        }
      }
    }
    for (const [y0, y1] of ys) for (const [x0, x1] of xs) block(x0, y0, x1, y1);

    // La place et la prison, au milieu.
    const px = Math.floor((C - Q.PW) / 2), py = Math.floor((R - Q.PH) / 2), P = 5;
    put(cells, px - P, py - P, px + Q.PW + P, py + Q.PH + P, 0);
    put(ground, px - P, py - P, px + Q.PW + P, py + Q.PH + P, Q.PLAZA);
    put(cells, px, py, px + Q.PW, py + Q.PH, 5);
    put(cells, px + 1, py + 1, px + Q.PW - 1, py + Q.PH - 1, 0);
    put(ground, px, py, px + Q.PW, py + Q.PH, Q.JAIL);

    const T = Q.T, cx = (px + Q.PW / 2) * T, cy = (py + Q.PH / 2) * T;
    const t = { seed, cells, ground, xs, ys, prison: { x: px * T, y: py * T, w: Q.PW * T, h: Q.PH * T, cx, cy } };
    // Les 2 boutons d'ouverture, de chaque côté de la prison.
    t.buttons = [{ id: 0, x: (px - 3) * T, y: cy }, { id: 1, x: (px + Q.PW + 3) * T, y: cy }];
    t.jailSpots = []; for (let i = 0; i < 8; i++) t.jailSpots.push({ x: (px + 3 + (i % 4) * 2.8) * T, y: (py + 3 + Math.floor(i / 4) * 4) * T });
    t.freeSpots = []; for (let i = 0; i < 8; i++) t.freeSpots.push({ x: (px + 1 + (i % 4) * 4) * T, y: i < 4 ? (py - 3) * T : (py + Q.PH + 3) * T });
    t.copSpots = []; for (let i = 0; i < 4; i++) t.copSpots.push({ x: (px + 3 + i * 3) * T, y: i % 2 ? (py - 2) * T : (py + Q.PH + 2) * T });

    // Les murs en rectangles (pour la physique), rangés dans une grille.
    const used = new Uint8Array(C * R);
    t.rects = [];
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
      if (!cells[at(c, r)] || used[at(c, r)]) continue;
      let w = 0;
      while (c + w < C && cells[at(c + w, r)] && !used[at(c + w, r)]) w++;
      let h = 1;
      up: while (r + h < R) { for (let k = 0; k < w; k++) if (!cells[at(c + k, r + h)] || used[at(c + k, r + h)]) break up; h++; }
      for (let j = r; j < r + h; j++) for (let k = c; k < c + w; k++) used[at(k, j)] = 1;
      t.rects.push({ x: c * T, y: r * T, w: w * T, h: h * T });
    }
    t.gw = Math.ceil(Q.W / CELL); t.gh = Math.ceil(Q.H / CELL);
    t.grid = Array.from({ length: t.gw * t.gh }, () => []);
    for (const o of t.rects) {
      const a0 = Math.max(0, Math.floor((o.x - 40) / CELL)), a1 = Math.min(t.gw - 1, Math.floor((o.x + o.w + 40) / CELL));
      const b0 = Math.max(0, Math.floor((o.y - 40) / CELL)), b1 = Math.min(t.gh - 1, Math.floor((o.y + o.h + 40) / CELL));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) t.grid[b * t.gw + a].push(o);
    }

    // Où peut-on marcher ? Une case sans mur autour, reliée à la place (pour les bots et les points de départ).
    const clear = new Uint8Array(C * R);
    for (let r = 1; r < R - 1; r++) for (let c = 1; c < C - 1; c++) {
      let ok = ground[at(c, r)] !== Q.JAIL;
      for (let j = -1; j <= 1 && ok; j++) for (let k = -1; k <= 1; k++) if (cells[at(c + k, r + j)]) { ok = false; break; }
      clear[at(c, r)] = ok ? 1 : 0;
    }
    t.walk = new Uint8Array(C * R);
    const start = at(px - 3, py + 2), stack = [start];
    t.walk[start] = 1;
    while (stack.length) {
      const i = stack.pop(), c = i % C, r = (i - c) / C;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = at(c + dx, r + dy);
        if (inside(c + dx, r + dy) && clear[n] && !t.walk[n]) { t.walk[n] = 1; stack.push(n); }
      }
    }
    // Les départs des runners (loin de la prison) et les emplacements des gadgets (carrefours, cours, parcs, maisons).
    const far = [], spots = [];
    for (let r = 2; r < R - 2; r += 2) for (let c = 2; c < C - 2; c += 2) {
      if (!t.walk[at(c, r)]) continue;
      const d = Math.hypot(c * T - cx, r * T - cy), g = ground[at(c, r)];
      if (d > 800) far.push({ x: c * T + 16, y: r * T + 16 });
      if (d > 380 && g !== Q.PLAZA) spots.push({ x: c * T + 16, y: r * T + 16 });
    }
    t.runSpots = mix(far);
    t.boxSpots = [];
    for (const s of mix(spots)) { if (t.boxSpots.every((o) => Math.hypot(o.x - s.x, o.y - s.y) > 300)) t.boxSpots.push(s); if (t.boxSpots.length >= 26) break; }
    t.flows = new Map();
    return t;
  };

  // Les murs proches d'un point.
  Q.near = function (t, x, y) {
    const a = Math.floor(x / CELL), b = Math.floor(y / CELL);
    return a < 0 || b < 0 || a >= t.gw || b >= t.gh ? [] : t.grid[b * t.gw + a];
  };
  // Y a-t-il un obstacle pour un tir sur ce point ? (les clôtures laissent passer)
  Q.blocksShot = function (t, x, y) {
    const c = Math.floor(x / Q.T), r = Math.floor(y / Q.T);
    if (c < 0 || r < 0 || c >= Q.COLS || r >= Q.ROWS) return true;
    const v = t.cells[r * Q.COLS + c];
    return v !== 0 && v !== 2;
  };
  // Jusqu'où va un tir ? Renvoie la distance parcourue avant un mur (au plus max).
  Q.ray = function (t, x, y, a, max) {
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let d = 8; d < max; d += 8) if (Q.blocksShot(t, x + dx * d, y + dy * d)) return d;
    return max;
  };
  Q.sees = function (t, a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    return Q.ray(t, a.x, a.y, Math.atan2(b.y - a.y, b.x - a.x), d) >= d;
  };

  // Pour les bots : la carte des distances vers un but, puis la prochaine case à viser.
  Q.flow = function (t, x, y) {
    const C = Q.COLS, R = Q.ROWS, T = Q.T;
    const goal = nearestWalk(t, Math.floor(x / T), Math.floor(y / T));
    if (goal < 0) return null;
    let f = t.flows.get(goal);
    if (f) return f;
    f = new Int16Array(C * R).fill(-1);
    f[goal] = 0;
    let q = [goal];
    while (q.length) {
      const nx = [];
      for (const i of q) {
        const c = i % C, r = (i - c) / C;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = c + dx, b = r + dy;
          if (a < 0 || b < 0 || a >= C || b >= R) continue;
          const n = b * C + a;
          if (t.walk[n] && f[n] < 0) { f[n] = f[i] + 1; nx.push(n); }
        }
      }
      q = nx;
    }
    if (t.flows.size > 80) t.flows.clear();
    t.flows.set(goal, f);
    return f;
  };
  function nearestWalk(t, c, r) {
    const C = Q.COLS, R = Q.ROWS;
    for (let d = 0; d < 8; d++) for (let j = -d; j <= d; j++) for (let k = -d; k <= d; k++) {
      if (Math.max(Math.abs(j), Math.abs(k)) !== d) continue;
      const a = c + k, b = r + j;
      if (a >= 0 && b >= 0 && a < C && b < R && t.walk[b * C + a]) return b * C + a;
    }
    return -1;
  }
  // Le point à viser pour descendre la carte des distances (3 cases plus loin).
  Q.next = function (t, f, x, y) {
    const C = Q.COLS, T = Q.T;
    let i = nearestWalk(t, Math.floor(x / T), Math.floor(y / T));
    if (i < 0 || !f) return null;
    for (let s = 0; s < 3; s++) {
      const c = i % C, r = (i - c) / C;
      let best = i;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = (r + dy) * C + c + dx;
        if (f[n] >= 0 && f[n] < f[best === i ? i : best]) best = n;
      }
      if (best === i) break;
      i = best;
    }
    const c = i % C, r = (i - c) / C;
    return { x: c * T + 16, y: r * T + 16, left: f[i] };
  };

  root.Quartier = Q;
})(typeof window !== "undefined" ? window : globalThis);
