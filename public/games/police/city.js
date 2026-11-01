// ===================================================================
//  AVIS DE RECHERCHE — Générateur de ville (partagé serveur + navigateur)
//  Une ville en quadrillage : des rues, des pâtés d'immeubles, des places,
//  des ruelles et quelques rues barrées.
//  Tirée à partir d'un nombre (seed) : le serveur n'envoie que ce nombre,
//  le navigateur refait exactement la même ville.
//    globalThis.PoliceCity.build(seed, nPlayers) -> ville
// ===================================================================

(function (root) {
  const C = {};
  C.CELL = 400;     // un pâté de maisons + sa moitié de rue de chaque côté
  C.ROAD = 150;     // largeur d'une rue
  C.ALLEY = 80;     // largeur d'une ruelle
  C.NAV = 40;       // taille d'une case de la grille de navigation (IA)

  // Hasard "rejouable" : la même seed donne toujours la même suite de nombres.
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  C.build = function (seed, nPlayers) {
    const rnd = seeded(seed);
    const nx = 6 + Math.ceil(nPlayers / 3);           // 2 joueurs : 7 pâtés de large, 8 joueurs : 9
    const ny = Math.round(nx * 0.62);
    const W = nx * C.CELL + C.ROAD, H = ny * C.CELL + C.ROAD;
    const half = C.ROAD / 2;
    const buildings = [];   // { x, y, w, h, tone } : on ne passe pas à travers
    const parks = [];       // places (décor : herbe, arbres)
    const barriers = [];    // rues barrées (comptent comme des obstacles)

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x0 = i * C.CELL + C.ROAD, y0 = j * C.CELL + C.ROAD;
        const bw = C.CELL - C.ROAD, bh = C.CELL - C.ROAD;   // 250 x 250
        const r = rnd();
        if (r < 0.12) {
          // Une place : on peut la traverser, avec une fontaine au milieu.
          parks.push({ x: x0, y: y0, w: bw, h: bh });
          buildings.push({ x: x0 + bw / 2 - 22, y: y0 + bh / 2 - 22, w: 44, h: 44, tone: -1 });
        } else if (r < 0.4) {
          // Coupé en deux par une ruelle.
          const vertical = rnd() < 0.5;
          const cut = 70 + rnd() * (bw - 2 * 70 - C.ALLEY);
          const tone = Math.floor(rnd() * 5);
          if (vertical) {
            buildings.push({ x: x0, y: y0, w: cut, h: bh, tone });
            buildings.push({ x: x0 + cut + C.ALLEY, y: y0, w: bw - cut - C.ALLEY, h: bh, tone: (tone + 2) % 5 });
          } else {
            buildings.push({ x: x0, y: y0, w: bw, h: cut, tone });
            buildings.push({ x: x0, y: y0 + cut + C.ALLEY, w: bw, h: bh - cut - C.ALLEY, tone: (tone + 2) % 5 });
          }
        } else {
          buildings.push({ x: x0, y: y0, w: bw, h: bh, tone: Math.floor(rnd() * 5) });
        }
      }
    }

    // Quelques rues barrées (entre deux carrefours, à l'intérieur de la ville).
    const nBar = Math.floor(nx * ny * 0.08);
    for (let k = 0; k < nBar; k++) {
      if (rnd() < 0.5 && nx > 2) {
        // Rue verticale (entre deux pâtés côte à côte) barrée horizontalement.
        const i = 1 + Math.floor(rnd() * (nx - 1)), j = Math.floor(rnd() * ny);
        const cx = i * C.CELL + half, cy = j * C.CELL + C.ROAD + (C.CELL - C.ROAD) / 2;
        barriers.push({ x: cx - half, y: cy - 12, w: C.ROAD, h: 24 });
      } else if (ny > 2) {
        const i = Math.floor(rnd() * nx), j = 1 + Math.floor(rnd() * (ny - 1));
        const cx = i * C.CELL + C.ROAD + (C.CELL - C.ROAD) / 2, cy = j * C.CELL + half;
        barriers.push({ x: cx - 12, y: cy - half, w: 24, h: C.ROAD });
      }
    }

    // Décor : arbres dans les places, voitures garées le long des immeubles (sans collision).
    const trees = [];
    for (const p of parks) for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd();
      trees.push({ x: p.x + p.w / 2 + Math.cos(a) * 85, y: p.y + p.h / 2 + Math.sin(a) * 85, r: 16 + rnd() * 8 });
    }

    const city = { seed, nx, ny, w: W, h: H, buildings, parks, barriers, trees };
    city.obstacles = buildings.concat(barriers);
    city.nav = navGrid(city);
    return city;
  };

  // ===================================================================
  //  GRILLE DE NAVIGATION : 1 = on peut rouler, 0 = immeuble (avec une
  //  petite marge pour que l'IA ne frotte pas les murs).
  // ===================================================================
  function navGrid(city) {
    const N = C.NAV, cols = Math.ceil(city.w / N), rows = Math.ceil(city.h / N);
    const free = new Uint8Array(cols * rows);
    const M = 14;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = q * N + N / 2, y = r * N + N / 2;
      let ok = x > M && y > M && x < city.w - M && y < city.h - M;
      if (ok) for (const o of city.obstacles) {
        if (x > o.x - M && x < o.x + o.w + M && y > o.y - M && y < o.y + o.h + M) { ok = false; break; }
      }
      free[r * cols + q] = ok ? 1 : 0;
    }
    return { cols, rows, free };
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
    for (let rad = 1; rad < 6; rad++) {
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
