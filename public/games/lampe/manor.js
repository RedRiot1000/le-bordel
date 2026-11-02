// ===================================================================
//  LAMPE TORCHE — Générateur de manoir hanté (partagé serveur + navigateur)
//  Une grille de pièces reliées par des portes (un labyrinthe : tout est
//  toujours accessible), quelques grandes salles (murs abattus), et des
//  meubles le long des murs ou au milieu des pièces.
//  Tiré à partir d'une seed : le serveur n'envoie que ce nombre.
//    globalThis.Manoir.build(seed, nPlayers) -> manoir
// ===================================================================

(function (root) {
  const M = {};
  M.RW = 300;          // largeur d'une case de pièce (mur compris)
  M.RH = 260;          // hauteur
  M.T = 16;            // épaisseur des murs
  M.DOOR = 74;         // largeur d'une porte
  M.NAV = 20;          // case de la grille de navigation (bots)
  M.LAMP_RANGE = 340;  // portée de la lampe
  M.LAMP_HALF = 0.42;  // demi-angle du cône de lumière (rad)

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  M.seeded = seeded;

  // Les types de pièces et leurs meubles (w × h quand ils sont contre un mur du haut : w le long du mur, h la profondeur).
  const KINDS = {
    salon: { wall: [["canape", 120, 42], ["cheminee", 90, 26], ["buffet", 100, 30]], center: [["table_basse", 80, 50], ["tapis", 0, 0]] },
    chambre: { wall: [["lit", 74, 104], ["armoire", 90, 34], ["commode", 70, 30]], center: [] },
    cuisine: { wall: [["comptoir", 160, 32], ["four", 50, 34], ["frigo", 44, 40]], center: [["table", 96, 60]] },
    bibliotheque: { wall: [["etagere", 150, 28], ["etagere", 130, 28], ["bureau", 90, 44]], center: [["table", 90, 56]] },
    bain: { wall: [["baignoire", 56, 104], ["lavabo", 50, 30]], center: [] },
    salle: { wall: [["piano", 90, 60], ["buffet", 120, 30], ["horloge", 34, 30]], center: [["table", 130, 64]] },
  };
  const KIND_LIST = Object.keys(KINDS);

  M.build = function (seed, nPlayers) {
    const rnd = seeded(seed);
    const { RW, RH, T, DOOR } = M;
    const nx = 4 + Math.ceil(nPlayers / 2), ny = nPlayers >= 5 ? 4 : 3;
    const W = nx * RW + T, H = ny * RH + T;
    const id = (i, j) => j * nx + i;
    // Liens entre pièces voisines : 0 = mur, 1 = porte, 2 = grande ouverture (salle commune).
    const linkR = new Uint8Array(nx * ny), linkD = new Uint8Array(nx * ny);
    // Labyrinthe (chaque pièce est reliée), puis quelques portes en plus.
    const seen = new Uint8Array(nx * ny);
    const stack = [id(Math.floor(rnd() * nx), Math.floor(rnd() * ny))];
    seen[stack[0]] = 1;
    while (stack.length) {
      const c = stack[stack.length - 1], i = c % nx, j = Math.floor(c / nx);
      const nb = [];
      if (i > 0 && !seen[id(i - 1, j)]) nb.push([id(i - 1, j), () => (linkR[id(i - 1, j)] = 1)]);
      if (i < nx - 1 && !seen[id(i + 1, j)]) nb.push([id(i + 1, j), () => (linkR[c] = 1)]);
      if (j > 0 && !seen[id(i, j - 1)]) nb.push([id(i, j - 1), () => (linkD[id(i, j - 1)] = 1)]);
      if (j < ny - 1 && !seen[id(i, j + 1)]) nb.push([id(i, j + 1), () => (linkD[c] = 1)]);
      if (!nb.length) { stack.pop(); continue; }
      const [n, link] = nb[Math.floor(rnd() * nb.length)];
      link(); seen[n] = 1; stack.push(n);
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (i < nx - 1) { if (!linkR[id(i, j)] && rnd() < 0.35) linkR[id(i, j)] = 1; else if (linkR[id(i, j)] && rnd() < 0.14) linkR[id(i, j)] = 2; }
      if (j < ny - 1) { if (!linkD[id(i, j)] && rnd() < 0.35) linkD[id(i, j)] = 1; else if (linkD[id(i, j)] && rnd() < 0.14) linkD[id(i, j)] = 2; }
    }

    // ---------------- Les murs (piliers à chaque croisement + segments) ----------------
    const walls = [], doors = [];
    for (let i = 0; i <= nx; i++) for (let j = 0; j <= ny; j++) walls.push({ x: i * RW, y: j * RH, w: T, h: T });
    const seg = (vert, i, j, state) => {
      // vert : mur vertical sur la ligne x = i*RW, entre j*RH et (j+1)*RH
      const a = (vert ? j * RH : i * RW) + T, b = vert ? (j + 1) * RH : (i + 1) * RW;
      const at = vert ? i * RW : j * RH;
      const mk = (p0, p1) => { if (p1 - p0 > 0.5) walls.push(vert ? { x: at, y: p0, w: T, h: p1 - p0 } : { x: p0, y: at, w: p1 - p0, h: T }); };
      if (state === 0) mk(a, b);
      else if (state === 1) {
        const c = (a + b) / 2 + (rnd() - 0.5) * (b - a - DOOR - 60);
        mk(a, c - DOOR / 2); mk(c + DOOR / 2, b);
        doors.push(vert ? { x: at, y: c - DOOR / 2, w: T, h: DOOR, vert } : { x: c - DOOR / 2, y: at, w: DOOR, h: T, vert });
      } else doors.push(vert ? { x: at, y: a, w: T, h: b - a, vert, open: true } : { x: a, y: at, w: b - a, h: T, vert, open: true });
    };
    for (let j = 0; j < ny; j++) for (let i = 0; i <= nx; i++) seg(true, i, j, i === 0 || i === nx ? 0 : linkR[id(i - 1, j)]);
    for (let i = 0; i < nx; i++) for (let j = 0; j <= ny; j++) seg(false, i, j, j === 0 || j === ny ? 0 : linkD[id(i, j - 1)]);

    // ---------------- Les pièces et leurs meubles ----------------
    const rooms = [], furniture = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const kind = KIND_LIST[Math.floor(rnd() * KIND_LIST.length)];
      const r = { i, j, x: i * RW + T, y: j * RH + T, w: RW - T, h: RH - T, kind, floor: Math.floor(rnd() * 4) };
      rooms.push(r);
      // Les côtés sans porte (on y pose les meubles) : 0 haut, 1 droite, 2 bas, 3 gauche.
      const closed = [
        j === 0 || linkD[id(i, j - 1)] === 0, i === nx - 1 || linkR[id(i, j)] === 0,
        j === ny - 1 || linkD[id(i, j)] === 0, i === 0 || linkR[id(i - 1, j)] === 0,
      ];
      const placed = [];
      const free = (o, gap) => placed.every((p) => o.x + o.w + gap <= p.x || p.x + p.w + gap <= o.x || o.y + o.h + gap <= p.y || p.y + p.h + gap <= o.y)
        && doors.every((d) => o.x + o.w + 50 <= d.x || d.x + d.w + 50 <= o.x || o.y + o.h + 50 <= d.y || d.y + d.h + 50 <= o.y);
      const K = KINDS[kind];
      const sides = [0, 1, 2, 3].filter((s) => closed[s]).sort(() => rnd() - 0.5);
      for (const [name, len, depth] of K.wall) {
        const s = sides.shift();
        if (s === undefined) break;
        if (rnd() < 0.2) continue;
        const along = s % 2 === 0 ? r.w : r.h;
        if (len > along * 0.6) continue;
        const pos = along * 0.2 + rnd() * (along * 0.6 - len);
        const o = s === 0 ? { x: r.x + pos, y: r.y, w: len, h: depth } : s === 2 ? { x: r.x + pos, y: r.y + r.h - depth, w: len, h: depth }
          : s === 3 ? { x: r.x, y: r.y + pos, w: depth, h: len } : { x: r.x + r.w - depth, y: r.y + pos, w: depth, h: len };
        if (!free(o, 50)) continue;
        placed.push({ ...o, name, side: s, kind });
      }
      for (const [name, w, h] of K.center) {
        if (name === "tapis") { r.rug = true; continue; }
        if (rnd() < 0.3) continue;
        const rot = rnd() < 0.5;
        const ww = rot ? h : w, hh = rot ? w : h;
        const o = { x: r.x + (r.w - ww) / 2 + (rnd() - 0.5) * 30, y: r.y + (r.h - hh) / 2 + (rnd() - 0.5) * 24, w: ww, h: hh };
        if (!free(o, 56)) continue;
        placed.push({ ...o, name, side: rot ? 1 : 0, kind });
      }
      furniture.push(...placed);
    }

    const m = { seed, nx, ny, w: W, h: H, walls, doors, rooms, furniture };
    m.rects = walls.concat(furniture);
    m.nav = navGrid(m);
    return m;
  };

  // ===================================================================
  //  GRILLE DE NAVIGATION (bots) : 1 = on peut marcher.
  //  Seule la grande zone reliée est gardée.
  // ===================================================================
  function navGrid(m) {
    const N = M.NAV, cols = Math.ceil(m.w / N), rows = Math.ceil(m.h / N);
    const free = new Uint8Array(cols * rows);
    const R = 17;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = q * N + N / 2, y = r * N + N / 2;
      let ok = x > M.T + R - 2 && y > M.T + R - 2 && x < m.w - M.T - R + 2 && y < m.h - M.T - R + 2;
      if (ok) for (const o of m.rects) {
        const qx = Math.max(o.x, Math.min(x, o.x + o.w)), qy = Math.max(o.y, Math.min(y, o.y + o.h));
        if ((x - qx) ** 2 + (y - qy) ** 2 < R * R) { ok = false; break; }
      }
      free[r * cols + q] = ok ? 1 : 0;
    }
    const nav = { cols, rows, free };
    const r0 = m.rooms[0];
    const start = M.nearestFree(nav, M.cellOf(nav, r0.x + 30, r0.y + 30));
    const d = M.field(nav, [start]);
    for (let i = 0; i < free.length; i++) if (d[i] < 0) free[i] = 0;
    return nav;
  }

  M.cellOf = (nav, x, y) => {
    const q = Math.max(0, Math.min(nav.cols - 1, Math.floor(x / M.NAV)));
    const r = Math.max(0, Math.min(nav.rows - 1, Math.floor(y / M.NAV)));
    return r * nav.cols + q;
  };
  M.centerOf = (nav, cell) => ({ x: (cell % nav.cols) * M.NAV + M.NAV / 2, y: Math.floor(cell / nav.cols) * M.NAV + M.NAV / 2 });

  // Distance (en cases, 8 directions) de chaque case vers les cases de départ.
  M.field = function (nav, sources) {
    const dist = new Int16Array(nav.cols * nav.rows).fill(-1);
    const queue = new Int32Array(nav.cols * nav.rows);
    let head = 0, tail = 0;
    for (const s of sources) if (s >= 0 && dist[s] < 0 && nav.free[s]) { dist[s] = 0; queue[tail++] = s; }
    while (head < tail) {
      const c = queue[head++], q = c % nav.cols, d = dist[c] + 1;
      const next = [q > 0 ? c - 1 : -1, q < nav.cols - 1 ? c + 1 : -1, c - nav.cols, c + nav.cols];
      for (const n of next) {
        if (n < 0 || n >= dist.length || dist[n] >= 0 || !nav.free[n]) continue;
        dist[n] = d;
        queue[tail++] = n;
      }
    }
    return dist;
  };

  M.nearestFree = function (nav, cell) {
    if (nav.free[cell]) return cell;
    const q0 = cell % nav.cols, r0 = Math.floor(cell / nav.cols);
    for (let rad = 1; rad < 10; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dq = -rad; dq <= rad; dq++) {
        const q = q0 + dq, r = r0 + dr;
        if (q < 0 || r < 0 || q >= nav.cols || r >= nav.rows) continue;
        const c = r * nav.cols + q;
        if (nav.free[c]) return c;
      }
    }
    return cell;
  };

  // En suivant le champ de distance, le point où viser (quelques cases plus loin).
  M.lookAhead = function (nav, dist, x, y, steps = 3) {
    let c = M.nearestFree(nav, M.cellOf(nav, x, y));
    for (let k = 0; k < steps; k++) {
      const q = c % nav.cols;
      let best = c, bd = dist[c] < 0 ? 1e9 : dist[c];
      for (const n of [q > 0 ? c - 1 : -1, q < nav.cols - 1 ? c + 1 : -1, c - nav.cols, c + nav.cols]) {
        if (n < 0 || n >= dist.length || dist[n] < 0) continue;
        if (dist[n] < bd) { bd = dist[n]; best = n; }
      }
      if (best === c) break;
      c = best;
    }
    return M.centerOf(nav, c);
  };

  // ===================================================================
  //  LUMIÈRE : les murs arrêtent la lumière (pas les meubles, trop bas).
  // ===================================================================
  // Distance (0 à 1 le long du rayon) où le segment entre dans le rectangle, ou Infinity.
  function rayRect(x0, y0, dx, dy, r) {
    let t0 = 0, t1 = 1;
    for (const [p, q] of [[-dx, x0 - r.x], [dx, r.x + r.w - x0], [-dy, y0 - r.y], [dy, r.y + r.h - y0]]) {
      if (p === 0) { if (q < 0) return Infinity; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return Infinity; if (t > t0) t0 = t; }
      else { if (t < t0) return Infinity; if (t < t1) t1 = t; }
    }
    return t0;
  }
  // Rien (aucun mur) entre a et b ?
  M.los = function (m, ax, ay, bx, by) {
    for (const w of m.walls) if (rayRect(ax, ay, bx - ax, by - ay, w) < 1) return false;
    return true;
  };
  // Le point (x, y) est-il dans le cône de la lampe tenue en (hx, hy) vers l'angle a ?
  M.inCone = function (m, hx, hy, a, x, y, pad = 0) {
    const dx = x - hx, dy = y - hy, d = Math.hypot(dx, dy);
    if (d > M.LAMP_RANGE + pad) return false;
    if (d > pad + 4) {
      const diff = Math.atan2(Math.sin(Math.atan2(dy, dx) - a), Math.cos(Math.atan2(dy, dx) - a));
      if (Math.abs(diff) > M.LAMP_HALF + Math.atan2(pad, d)) return false;
    }
    return M.los(m, hx, hy, x, y);
  };
  // Le contour du cône de lumière (arrêté par les murs) : une liste de points.
  M.cone = function (m, hx, hy, a, n = 36) {
    const R = M.LAMP_RANGE, pts = [{ x: hx, y: hy }];
    const near = m.walls.filter((w) => w.x < hx + R && w.x + w.w > hx - R && w.y < hy + R && w.y + w.h > hy - R);
    for (let k = 0; k <= n; k++) {
      const ang = a - M.LAMP_HALF + (2 * M.LAMP_HALF * k) / n;
      const dx = Math.cos(ang) * R, dy = Math.sin(ang) * R;
      let t = 1;
      for (const w of near) { const tt = rayRect(hx, hy, dx, dy, w); if (tt < t) t = tt; }
      pts.push({ x: hx + dx * t, y: hy + dy * t });
    }
    return pts;
  };

  root.Manoir = M;
})(typeof window !== "undefined" ? window : globalThis);
