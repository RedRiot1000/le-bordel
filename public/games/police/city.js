// ===================================================================
//  AVIS DE RECHERCHE — Générateur de ville (partagé serveur + navigateur)
//  Une seule ville (centre-ville) au milieu de la campagne. Les rues partent
//  d'une grille, puis on en retire beaucoup : des pâtés fusionnent, il faut
//  tourner pour traverser la ville (seules la grande rue et la grande avenue
//  vont tout droit d'un bout à l'autre). Jamais de cul-de-sac.
//  Le monde est une grille de tuiles de 30 px : ce qui ressemble à du bitume
//  ou du pavé se roule (trottoirs compris), le reste bloque. Les bâtiments
//  sont posés uniquement sur les tuiles qui bloquent.
//  Tiré à partir d'un nombre (seed) : le serveur n'envoie que ce nombre.
//    globalThis.PoliceCity.build(seed, nPlayers) -> ville
// ===================================================================

(function (root) {
  const C = {};
  const T = 30;
  C.TILE = T;
  C.NAV = T;          // la grille de navigation (IA) = les tuiles
  C.ROAD = 150;       // (largeur d'une rue « normale », pour info)
  C.GATE_W = 26;      // portique : les véhicules plus larges (van 28, camion 32) sont bloqués

  // Les sortes de tuiles.
  const K = C.KIND = {
    GROUND: 0,      // terrain (bâtiments, jardins, parcs, champs) : bloque
    ROAD: 1, SIDEWALK: 2, WATER: 3, PLAZA: 4, BRIDGE: 5, HIGHWAY: 6,
    ALLEY: 9,       // ruelle / allée de jardin (raccourci à portique)
    YARD: 11,       // cour d'usine (raccourci à portique)
    ISLAND: 12,     // îlot de rond-point : bloque
    FENCE: 13,      // clôture : bloque
    RAMP: 14,       // bretelle de sortie
    BAY: 15,        // garage du commissariat
  };
  const DRIVE = new Set([K.ROAD, K.SIDEWALK, K.PLAZA, K.BRIDGE, K.HIGHWAY, K.ALLEY, K.YARD, K.RAMP, K.BAY]);
  C.drivable = (k) => DRIVE.has(k);

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  C.seeded = seeded;

  C.build = function (seed, nPlayers) {
    const rnd = seeded(seed);
    const R = 3, M = 7;                                   // largeur d'une rue (tuiles), campagne autour
    const nc = nPlayers <= 4 ? 7 : 8, nr = nPlayers <= 4 ? 5 : 6;   // pâtés en largeur / hauteur
    // Des pâtés de tailles différentes.
    const xs = [M], ys = [M];
    for (let i = 0; i < nc; i++) xs.push(xs[i] + R + 9 + Math.floor(rnd() * 5));
    for (let j = 0; j < nr; j++) ys.push(ys[j] + R + 8 + Math.floor(rnd() * 4));
    const TW = xs[nc] + R + M, TH = ys[nr] + R + M;
    const grid = new Uint8Array(TW * TH);
    const at = (x, y) => (x < 0 || y < 0 || x >= TW || y >= TH ? K.GROUND : grid[y * TW + x]);
    const set = (x, y, w, h, k) => { for (let j = Math.max(0, y); j < Math.min(TH, y + h); j++) for (let i = Math.max(0, x); i < Math.min(TW, x + w); i++) grid[j * TW + i] = k; };

    // ---------------- Le réseau de rues ----------------
    // Toutes les rues d'une grille, puis on en retire beaucoup (des pâtés fusionnent) :
    // - jamais de cul-de-sac (un carrefour garde 0 ou au moins 2 rues),
    // - tout reste relié,
    // - sur chaque ligne de la grille, au moins un tronçon disparaît (on ne traverse pas la ville tout droit),
    //   sauf la grande rue et la grande avenue.
    const nid = (i, j) => j * (nc + 1) + i;
    const edges = [];   // { a, b, vert, i, j, on }
    for (let j = 0; j <= nr; j++) for (let i = 0; i < nc; i++) edges.push({ a: nid(i, j), b: nid(i + 1, j), vert: false, i, j, on: true });
    for (let i = 0; i <= nc; i++) for (let j = 0; j < nr; j++) edges.push({ a: nid(i, j), b: nid(i, j + 1), vert: true, i, j, on: true });
    const deg = new Array((nc + 1) * (nr + 1)).fill(0);
    for (const e of edges) { deg[e.a]++; deg[e.b]++; }
    const mainRow = 1 + Math.floor(rnd() * (nr - 1)), mainCol = 1 + Math.floor(rnd() * (nc - 1));
    const isMain = (e) => (!e.vert && e.j === mainRow) || (e.vert && e.i === mainCol);
    const connected = () => {
      const adj = new Map();
      for (const e of edges) if (e.on) { (adj.get(e.a) || adj.set(e.a, []).get(e.a)).push(e.b); (adj.get(e.b) || adj.set(e.b, []).get(e.b)).push(e.a); }
      const start = adj.keys().next().value;
      const seen = new Set([start]), q = [start];
      while (q.length) for (const n of adj.get(q.pop())) if (!seen.has(n)) { seen.add(n); q.push(n); }
      return seen.size === adj.size;
    };
    const tryRemove = (e) => {
      if (!e.on || isMain(e)) return false;
      if (deg[e.a] - 1 === 1 || deg[e.b] - 1 === 1) return false;
      e.on = false; deg[e.a]--; deg[e.b]--;
      if (!connected()) { e.on = true; deg[e.a]++; deg[e.b]++; return false; }
      return true;
    };
    // D'abord, couper chaque ligne (horizontale et verticale) au moins une fois.
    for (let j = 0; j <= nr; j++) { if (j === mainRow) continue; const line = edges.filter((e) => !e.vert && e.j === j).sort(() => rnd() - 0.5); for (const e of line) if (tryRemove(e)) break; }
    for (let i = 0; i <= nc; i++) { if (i === mainCol) continue; const line = edges.filter((e) => e.vert && e.i === i).sort(() => rnd() - 0.5); for (const e of line) if (tryRemove(e)) break; }
    // Puis d'autres au hasard (≈ 35 % des rues en moins).
    const target = Math.floor(edges.length * 0.35);
    for (const e of [...edges].sort(() => rnd() - 0.5)) { if (edges.filter((x) => !x.on).length >= target) break; tryRemove(e); }
    // On creuse les rues.
    const roads = [];
    for (const e of edges) {
      if (!e.on) continue;
      const r = e.vert ? { x: xs[e.i], y: ys[e.j], w: R, h: ys[e.j + 1] - ys[e.j] + R } : { x: xs[e.i], y: ys[e.j], w: xs[e.i + 1] - xs[e.i] + R, h: R };
      set(r.x, r.y, r.w, r.h, K.ROAD);
      roads.push({ ...r, horiz: !e.vert, kind: isMain(e) ? "avenue" : "street" });
    }

    // ---------------- Les pâtés ----------------
    const cityRect = { x: xs[0], y: ys[0], w: xs[nc] + R - xs[0], h: ys[nr] + R - ys[0] };
    const cells = [];
    const edgeOn = (vert, i, j) => edges.find((e) => e.vert === vert && e.i === i && e.j === j)?.on;
    for (let j = 0; j < nr; j++) for (let i = 0; i < nc; i++) {
      cells.push({ i, j, x: xs[i] + R, y: ys[j] + R, w: xs[i + 1] - xs[i] - R, h: ys[j + 1] - ys[j] - R,
        left: edgeOn(true, i, j), right: edgeOn(true, i + 1, j), top: edgeOn(false, i, j), bottom: edgeOn(false, i, j + 1) });
    }
    // Trottoirs : toutes les tuiles de terrain qui touchent une rue (diagonales comprises).
    const isRoad = (k) => k === K.ROAD;
    const walk = [];
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      if (grid[j * TW + i] !== K.GROUND) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (isRoad(at(i + di, j + dj))) { near = true; break; }
      if (near) walk.push(j * TW + i);
    }
    for (const c of walk) grid[c] = K.SIDEWALK;

    // ---------------- Contenu des pâtés ----------------
    const lots = [];        // de quoi dessiner : { x, y, w, h (tuiles, que du terrain), type }
    const gates = [];
    const gateAt = (x, y, w, h) => gates.push({ x: x * T, y: y * T, w: w * T, h: h * T, gate: true, kind: "gate" });
    // Le terrain d'une case : la case moins son trottoir (seulement là où il y a une rue).
    const inner = (c) => ({ x: c.x + (c.left ? 1 : 0), y: c.y + (c.top ? 1 : 0), w: c.w - (c.left ? 1 : 0) - (c.right ? 1 : 0), h: c.h - (c.top ? 1 : 0) - (c.bottom ? 1 : 0) });
    // (un coin de trottoir qui déborde en diagonale dans un pâté redevient du terrain : le pâté reste un rectangle)
    for (const c of cells) { const I = inner(c); for (let j = I.y; j < I.y + I.h; j++) for (let i = I.x; i < I.x + I.w; i++) if (grid[j * TW + i] === K.SIDEWALK) grid[j * TW + i] = K.GROUND; }
    // Le commissariat : une case entière (4 rues autour), près du centre.
    const cx0 = (nc - 1) / 2, cy0 = (nr - 1) / 2;
    const stCell = cells.filter((c) => c.left && c.right && c.top && c.bottom).sort((a, b) => Math.hypot(a.i - cx0, a.j - cy0) - Math.hypot(b.i - cx0, b.j - cy0))[0]
      || cells.filter((c) => c.left || c.right).sort((a, b) => Math.hypot(a.i - cx0, a.j - cy0) - Math.hypot(b.i - cx0, b.j - cy0))[0];
    let station = null;
    for (const c of cells) {
      const I = inner(c);
      const r = rnd();
      if (c === stCell) {
        const side = c.right ? 1 : 3;
        const BW = 4, BD = 6;
        const by = I.y + Math.floor((I.h - BW) / 2);
        const bay = side === 3 ? { x: c.x, y: by, w: BD + 1, h: BW } : { x: c.x + c.w - BD - 1, y: by, w: BD + 1, h: BW };
        set(bay.x, bay.y, bay.w, bay.h, K.BAY);
        const out = side === 3 ? Math.PI : 0;
        const bx = (bay.x + bay.w / 2) * T, byy = (bay.y + bay.h / 2) * T, depth = bay.w * T;
        const spots = [-0.28, 0.12, 0.62].map((k) => ({ x: bx + Math.cos(out) * k * depth, y: byy, a: out }));
        station = { x: I.x * T, y: I.y * T, w: I.w * T, h: I.h * T, bay: { x: bay.x * T, y: bay.y * T, w: bay.w * T, h: bay.h * T }, side, out, spots };
        lots.push({ ...I, type: "station" });
        continue;
      }
      if (r < 0.07 && c.left && c.right && c.top && c.bottom) {
        // Une place pavée (on y roule), avec une fontaine au milieu.
        set(I.x, I.y, I.w, I.h, K.PLAZA);
        const fx = I.x + Math.floor(I.w / 2) - 1, fy = I.y + Math.floor(I.h / 2) - 1;
        set(fx, fy, 2, 2, K.GROUND);
        lots.push({ ...I, type: "plaza" }, { x: fx, y: fy, w: 2, h: 2, type: "fountain" });
      } else if (r < 0.15) lots.push({ ...I, type: "park" });
      else if (r < 0.4 && ((c.left && c.right && I.w >= 9) || (c.top && c.bottom && I.h >= 9))) {
        // Une ruelle qui coupe le pâté d'une rue à l'autre (raccourci : portiques aux deux bouts).
        const vert = c.top && c.bottom && (!(c.left && c.right) || rnd() < 0.5);
        if (vert) {
          const cut = 3 + Math.floor(rnd() * (I.w - 9));
          set(I.x + cut, c.y, 3, c.h, K.ALLEY);
          gateAt(I.x + cut, c.y, 3, 0.34); gateAt(I.x + cut, c.y + c.h - 0.34, 3, 0.34);
          lots.push({ x: I.x, y: I.y, w: cut, h: I.h, type: "block" }, { x: I.x + cut + 3, y: I.y, w: I.w - cut - 3, h: I.h, type: "block" });
        } else {
          const cut = 3 + Math.floor(rnd() * (I.h - 9));
          set(c.x, I.y + cut, c.w, 3, K.ALLEY);
          gateAt(c.x, I.y + cut, 0.34, 3); gateAt(c.x + c.w - 0.34, I.y + cut, 0.34, 3);
          lots.push({ x: I.x, y: I.y, w: I.w, h: cut, type: "block" }, { x: I.x, y: I.y + cut + 3, w: I.w, h: I.h - cut - 3, type: "block" });
        }
      } else lots.push({ ...I, type: r < 0.78 ? "block" : "towers" });
    }
    // Les rues retirées : la bande reste du terrain, on y construit (façade continue entre deux pâtés).
    const nodeDeg = (i, j) => deg[nid(i, j)];
    for (const e of edges) {
      if (e.on) continue;
      // La bande sans les carrefours (s'ils existent encore) ; avec, si le carrefour a disparu.
      const a0 = nodeDeg(e.i, e.j) > 0, b0 = e.vert ? nodeDeg(e.i, e.j + 1) > 0 : nodeDeg(e.i + 1, e.j) > 0;
      let r = e.vert ? { x: xs[e.i], y: ys[e.j] + (a0 ? R : 0), w: R, h: ys[e.j + 1] - ys[e.j] - (a0 ? R : 0) + (b0 ? 0 : R) }
        : { x: xs[e.i] + (a0 ? R : 0), y: ys[e.j], w: xs[e.i + 1] - xs[e.i] - (a0 ? R : 0) + (b0 ? 0 : R), h: R };
      // (sans les tuiles devenues trottoir)
      const g = [];
      for (let jj = r.y; jj < r.y + r.h; jj++) for (let ii = r.x; ii < r.x + r.w; ii++) if (at(ii, jj) === K.GROUND) g.push([ii, jj]);
      if (!g.length) continue;
      const gx0 = Math.min(...g.map((p) => p[0])), gx1 = Math.max(...g.map((p) => p[0])), gy0 = Math.min(...g.map((p) => p[1])), gy1 = Math.max(...g.map((p) => p[1]));
      r = { x: gx0, y: gy0, w: gx1 - gx0 + 1, h: gy1 - gy0 + 1 };
      // Que du terrain dedans ? Alors on y met un immeuble (sinon, un jardin).
      let full = true;
      for (let jj = r.y; jj < r.y + r.h && full; jj++) for (let ii = r.x; ii < r.x + r.w; ii++) if (at(ii, jj) !== K.GROUND) { full = false; break; }
      if (full) lots.push({ ...r, type: "fill" });
    }

    // ---------------- Les 2 sorties : des routes qui quittent la ville (gauche et droite) ----------------
    const exits = [];
    for (const side of [3, 1]) {
      const i = side === 3 ? 0 : nc;
      const rows = []; for (let j = 0; j <= nr; j++) if (nodeDeg(i, j) > 0) rows.push(j);
      const j = rows[Math.floor(rnd() * rows.length)];
      const y = ys[j];
      const x0 = side === 3 ? 0 : xs[nc] + R, w = side === 3 ? xs[0] : TW - xs[nc] - R;
      set(x0, y, w, R, K.RAMP);
      // (le trottoir à côté de la sortie)
      const ramp = { x: x0 * T, y: y * T, w: w * T, h: R * T };
      const gate = side === 3 ? { x: xs[0] * T - 24, y: y * T, w: 24, h: R * T } : { x: (xs[nc] + R) * T, y: y * T, w: 24, h: R * T };
      const zone = side === 3 ? { x: 0, y: y * T, w: (xs[0] * T) / 2, h: R * T } : { x: TW * T - (M * T) / 2, y: y * T, w: (M * T) / 2, h: R * T };
      const spawn = { x: (xs[i] + R / 2) * T, y: (y + R / 2) * T, a: side === 3 ? 0 : Math.PI };
      exits.push({ side, ramp, gate: { ...gate, exitGate: true, kind: "exitgate" }, zone, spawn });
    }

    // ---------------- Obstacles : les tuiles qui bloquent, regroupées en rectangles ----------------
    const solid = [];
    const used = new Uint8Array(TW * TH);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = grid[j * TW + i];
      if (used[j * TW + i] || DRIVE.has(k)) continue;
      let w = 0;
      while (i + w < TW && !used[j * TW + i + w] && grid[j * TW + i + w] === k) w++;
      let h = 1;
      outer: while (j + h < TH) {
        for (let q = 0; q < w; q++) { const c = (j + h) * TW + i + q; if (used[c] || grid[c] !== k) break outer; }
        h++;
      }
      for (let jj = j; jj < j + h; jj++) for (let q = 0; q < w; q++) used[jj * TW + i + q] = 1;
      solid.push({ x: i * T, y: j * T, w: w * T, h: h * T, kind: k });
    }

    const city = {
      seed, w: TW * T, h: TH * T, TW, TH, grid, roads, lots, cityRect: { x: cityRect.x * T, y: cityRect.y * T, w: cityRect.w * T, h: cityRect.h * T },
      rounds: [], gates, exits, station,
    };
    city.obstaclesOpen = solid.concat(gates);
    city.obstacles = city.obstaclesOpen.concat(exits.map((e) => e.gate));
    city.buckets = bucketize(city, city.obstacles);
    city.bucketsOpen = bucketize(city, city.obstaclesOpen);
    city.nav = navGrid(city);
    return city;
  };

  // Les obstacles rangés par zones de 200 px (le serveur ne teste que ceux autour d'une voiture).
  const BK = 200;
  function bucketize(city, list) {
    const cols = Math.ceil(city.w / BK), rows = Math.ceil(city.h / BK);
    const b = Array.from({ length: cols * rows }, () => []);
    for (const o of list) {
      const q0 = Math.max(0, Math.floor((o.x - 70) / BK)), q1 = Math.min(cols - 1, Math.floor((o.x + o.w + 70) / BK));
      const r0 = Math.max(0, Math.floor((o.y - 70) / BK)), r1 = Math.min(rows - 1, Math.floor((o.y + o.h + 70) / BK));
      for (let r = r0; r <= r1; r++) for (let q = q0; q <= q1; q++) b[r * cols + q].push(o);
    }
    return { cols, rows, b };
  }
  C.near = function (city, x, y, open) {
    const B = open ? city.bucketsOpen : city.buckets;
    const q = Math.max(0, Math.min(B.cols - 1, Math.floor(x / BK))), r = Math.max(0, Math.min(B.rows - 1, Math.floor(y / BK)));
    return B.b[r * B.cols + q];
  };
  const inRect = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  C.inRect = inRect;
  // Dans la ville (pas sur une bretelle de sortie) ?
  C.inCity = (city, x, y) => !city.exits.some((e) => inRect({ x, y }, e.ramp));
  C.kindAt = (city, x, y) => { const i = Math.floor(x / T), j = Math.floor(y / T); return i < 0 || j < 0 || i >= city.TW || j >= city.TH ? K.GROUND : city.grid[j * city.TW + i]; };

  // ===================================================================
  //  GRILLE DE NAVIGATION (IA) : une case par tuile. On roule sur les
  //  tuiles « roulables » qui ne touchent pas un obstacle (marge), sauf
  //  les raccourcis à portique (l'IA ne les connaît pas).
  //  Seule la grande zone reliée au périphérique est gardée.
  // ===================================================================
  function navGrid(city) {
    const { TW, TH, grid } = city;
    const free = new Uint8Array(TW * TH);
    const blocks = (k) => !DRIVE.has(k);
    for (let j = 1; j < TH - 1; j++) for (let i = 1; i < TW - 1; i++) {
      const k = grid[j * TW + i];
      if (blocks(k) || k === K.ALLEY || k === K.YARD) continue;
      if (blocks(grid[j * TW + i - 1]) || blocks(grid[j * TW + i + 1]) || blocks(grid[(j - 1) * TW + i]) || blocks(grid[(j + 1) * TW + i])) continue;
      free[j * TW + i] = 1;
    }
    const nav = { cols: TW, rows: TH, free };
    const r = city.roads[0];
    const start = C.nearestFree(nav, C.cellOf(nav, (r.x + r.w / 2) * T, (r.y + r.h / 2) * T));
    const d = C.field(nav, [start]);
    for (let i = 0; i < free.length; i++) if (d[i] < 0) free[i] = 0;
    return nav;
  }

  C.cellOf = (nav, x, y) => {
    const q = Math.max(0, Math.min(nav.cols - 1, Math.floor(x / C.NAV)));
    const r = Math.max(0, Math.min(nav.rows - 1, Math.floor(y / C.NAV)));
    return r * nav.cols + q;
  };
  C.centerOf = (nav, cell) => ({ x: (cell % nav.cols) * C.NAV + C.NAV / 2, y: Math.floor(cell / nav.cols) * C.NAV + C.NAV / 2 });

  // Distance (en cases) de chaque case vers les cases de départ, en suivant les rues.
  C.field = function (nav, sources) {
    const dist = new Int16Array(nav.cols * nav.rows).fill(-1);
    const queue = new Int32Array(nav.cols * nav.rows);
    let head = 0, tail = 0;
    for (const s of sources) if (dist[s] < 0) { dist[s] = 0; queue[tail++] = s; }
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

  // Case libre la plus proche (si une voiture est collée à un mur).
  C.nearestFree = function (nav, cell) {
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
  C.lookAhead = function (nav, dist, x, y, steps = 3) {
    let c = C.nearestFree(nav, C.cellOf(nav, x, y));
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
    return C.centerOf(nav, c);
  };

  root.PoliceCity = C;
})(typeof window !== "undefined" ? window : globalThis);
