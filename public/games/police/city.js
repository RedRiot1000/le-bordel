// ===================================================================
//  AVIS DE RECHERCHE — Générateur de ville (partagé serveur + navigateur)
//  Trois villes séparées (centre-ville au milieu, zone industrielle et
//  banlieue de chaque côté), entourées de campagne et séparées par deux
//  rivières. Un périphérique fait le tour de loin, relié à chaque ville
//  par des voies d'accès (ronds-points aux entrées de ville).
//  Dans chaque ville : une route de ceinture, une grande avenue, puis des
//  rues découpées au hasard (pas un quadrillage) ; impasses en banlieue.
//  Le monde est une grille de tuiles de 30 px : ce qui ressemble à du
//  bitume ou du pavé se roule (trottoirs compris), le reste bloque.
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

  // Réglages des quartiers : lot max / min (tuiles), largeur des rues.
  const DIST = {
    centre: { maxLot: 14, minLot: 8, road: 3 },
    usine: { maxLot: 19, minLot: 10, road: 4 },
    banlieue: { maxLot: 13, minLot: 7, road: 3 },
  };

  C.build = function (seed, nPlayers) {
    const rnd = seeded(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const big = nPlayers > 4;
    const tw = big ? 58 : 50, th = big ? 52 : 46;              // taille d'une ville (tuiles)
    const C1 = 7, HW = 7, GIN = 8, GAP = 18, RIV = 8, AVE = 6;
    const TW = 2 * (C1 + HW + GIN) + 3 * tw + 2 * GAP, TH = 2 * (C1 + HW + GIN) + th;
    const grid = new Uint8Array(TW * TH);
    const at = (x, y) => (x < 0 || y < 0 || x >= TW || y >= TH ? K.GROUND : grid[y * TW + x]);
    const set = (x, y, w, h, k, onlyIf) => {
      for (let j = Math.max(0, y); j < Math.min(TH, y + h); j++) for (let i = Math.max(0, x); i < Math.min(TW, x + w); i++) {
        if (onlyIf && !onlyIf(grid[j * TW + i])) continue;
        grid[j * TW + i] = k;
      }
    };
    const roads = [];   // { x, y, w, h (tuiles), kind, horiz }
    const road = (x, y, w, h, kind) => { set(x, y, w, h, K.ROAD); roads.push({ x, y, w, h, kind, horiz: w > h }); };

    // ---------------- Les rivières (dans les espaces entre les villes) ----------------
    const ty = C1 + HW + GIN;
    const bY = ty + Math.floor(th * (0.35 + rnd() * 0.3)) - 3;   // la grande rue est-ouest (la même pour les 3 villes)
    const towns = [];
    const sides = rnd() < 0.5 ? ["usine", "banlieue"] : ["banlieue", "usine"];
    const order = [sides[0], "centre", sides[1]];
    for (let k = 0; k < 3; k++) towns.push({ x: C1 + HW + GIN + k * (tw + GAP), y: ty, w: tw, h: th, d: order[k] });
    const rivers = [];
    for (let k = 0; k < 2; k++) {
      const rx = towns[k].x + tw + Math.floor((GAP - RIV) / 2);
      set(rx, 0, RIV, TH, K.WATER);
      rivers.push({ x: rx, y: 0, w: RIV, h: TH });
    }
    const overWater = (k) => (k === K.WATER ? K.BRIDGE : null);
    const paveOver = (x, y, w, h, k) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { if (i < 0 || j < 0 || i >= TW || j >= TH) continue; grid[j * TW + i] = grid[j * TW + i] === K.WATER ? K.BRIDGE : k; } };

    // ---------------- Le périphérique (loin des villes) ----------------
    const hw = { x: C1, y: C1, w: TW - 2 * C1, h: TH - 2 * C1 };
    paveOver(hw.x, hw.y, hw.w, HW, K.HIGHWAY); paveOver(hw.x, hw.y + hw.h - HW, hw.w, HW, K.HIGHWAY);
    paveOver(hw.x, hw.y, HW, hw.h, K.HIGHWAY); paveOver(hw.x + hw.w - HW, hw.y, HW, hw.h, K.HIGHWAY);

    // ---------------- Les villes ----------------
    const lots = [];        // { x, y, w, h (tuiles, terrain hors trottoir), d, type, ... }
    const rounds = [];      // ronds-points { x, y (px), r }
    const gates = [];       // portiques (px)
    const accesses = [];    // voies d'accès au périphérique { x, y, w, h, top }
    const gateAt = (x, y, w, h) => gates.push({ x: x * T, y: y * T, w: w * T, h: h * T, gate: true, kind: "gate" });

    for (const town of towns) {
      const { x: tx, y: tyy, w: tw2, h: th2, d } = town;
      const P = DIST[d];
      // La grande avenue (nord-sud), prolongée jusqu'au périphérique ; la grande rue (est-ouest) qui traverse
      // les 3 villes ; un rond-point au centre, là où elles se croisent. Pas de route qui fait le tour de la ville.
      const inner = { x: tx, y: tyy, w: tw2, h: th2 };
      const ax = inner.x + Math.floor(inner.w * (0.3 + rnd() * 0.4)) - AVE / 2;
      road(ax, inner.y, AVE, inner.h, "avenue");
      road(tx, bY, tw2, AVE, "avenue");
      const topY = hw.y + HW, botY = hw.y + hw.h - HW;
      road(ax, topY, AVE, tyy - topY, "access"); road(ax, tyy + th2, AVE, botY - tyy - th2, "access");
      accesses.push({ x: ax, y: topY, w: AVE, h: tyy - topY, top: true }, { x: ax, y: tyy + th2, w: AVE, h: botY - tyy - th2, top: false });
      set(ax + 2, bY + 2, 2, 2, K.ISLAND);
      rounds.push({ x: (ax + 3) * T, y: (bY + 3) * T, r: 34 });
      town.avenue = ax;
      // Le reste : découpé au hasard (des rues en T, pas un quadrillage).
      const bsp = (r, depth) => {
        const canH = r.h - P.road >= 2 * P.minLot, canV = r.w - P.road >= 2 * P.minLot;
        if ((r.w <= P.maxLot && r.h <= P.maxLot) || (!canH && !canV)) { lots.push({ ...r, d }); return; }
        let horiz = r.h > r.w ? canH : !canV;
        if (canH && canV && Math.abs(r.w - r.h) < 4) horiz = rnd() < 0.5;
        const len = horiz ? r.h : r.w;
        const pos = P.minLot + Math.floor(rnd() * (len - 2 * P.minLot - P.road + 1));
        if (horiz) { road(r.x, r.y + pos, r.w, P.road, "street"); bsp({ x: r.x, y: r.y, w: r.w, h: pos }, depth + 1); bsp({ x: r.x, y: r.y + pos + P.road, w: r.w, h: r.h - pos - P.road }, depth + 1); }
        else { road(r.x + pos, r.y, P.road, r.h, "street"); bsp({ x: r.x, y: r.y, w: pos, h: r.h }, depth + 1); bsp({ x: r.x + pos + P.road, y: r.y, w: r.w - pos - P.road, h: r.h }, depth + 1); }
      };
      // Les 4 quartiers autour du rond-point.
      for (const [x0, x1] of [[inner.x, ax], [ax + AVE, inner.x + inner.w]]) for (const [y0, y1] of [[inner.y, bY], [bY + AVE, inner.y + inner.h]]) bsp({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, 1);
    }

    // ---------------- Routes entre les villes (avec un long pont) ----------------
    for (let k = 0; k < 2; k++) {
      const a = towns[k], b = towns[k + 1];
      const y = bY;
      for (let i = a.x + a.w; i < b.x; i++) for (let j = y; j < y + 6; j++) grid[j * TW + i] = grid[j * TW + i] === K.WATER ? K.BRIDGE : K.ROAD;
      roads.push({ x: a.x + a.w, y, w: b.x - a.x - a.w, h: 6, kind: "link", horiz: true });
    }

    // ---------------- Les pâtés : trottoir tout autour, puis leur contenu ----------------
    // Le commissariat : un grand pâté au cœur du centre-ville.
    const mid = towns[1];
    let stationLot = null, bd = 1e9;
    for (const l of lots) {
      if (l.d !== "centre" || Math.min(l.w, l.h) < 9) continue;
      const dd = Math.hypot(l.x + l.w / 2 - (mid.x + mid.w / 2), l.y + l.h / 2 - (mid.y + mid.h / 2)) + rnd() * 4;
      if (dd < bd) { bd = dd; stationLot = l; }
    }
    if (!stationLot) stationLot = lots.filter((l) => l.d === "centre").sort((a, b) => Math.min(b.w, b.h) - Math.min(a.w, a.h))[0];
    const buildings = [];   // lots « à dessiner » (le client y pose les bâtiments)
    let station = null;
    for (const l of lots) {
      set(l.x, l.y, l.w, l.h, K.SIDEWALK);
      const I = { x: l.x + 1, y: l.y + 1, w: l.w - 2, h: l.h - 2 };   // le terrain (hors trottoir)
      const r = rnd();
      if (l === stationLot) {
        // Le commissariat : un bâtiment avec un garage ouvert sur la rue la plus proche de l'avenue.
        const side = Math.abs(I.x - mid.avenue - AVE) < Math.abs(I.x + I.w - mid.avenue) ? 3 : 1;
        const BW = 4, BD = 6;
        const by = I.y + Math.floor((I.h - BW) / 2);
        const bay = side === 3 ? { x: I.x, y: by, w: BD, h: BW } : { x: I.x + I.w - BD, y: by, w: BD, h: BW };
        set(bay.x, bay.y, bay.w, bay.h, K.BAY);
        const out = side === 3 ? Math.PI : 0;
        const bx = (bay.x + bay.w / 2) * T, byy = (bay.y + bay.h / 2) * T, depth = bay.w * T;
        const spots = [-0.28, 0.12, 0.62].map((k) => ({ x: bx + Math.cos(out) * k * depth, y: byy, a: out }));
        station = { x: I.x * T, y: I.y * T, w: I.w * T, h: I.h * T, bay: { x: bay.x * T, y: bay.y * T, w: bay.w * T, h: bay.h * T }, side, out, spots };
        buildings.push({ ...I, d: l.d, type: "station" });
        continue;
      }
      if (l.d === "centre") {
        if (r < 0.08) {
          // Une place pavée (on peut y rouler) avec une fontaine.
          set(I.x, I.y, I.w, I.h, K.PLAZA);
          const fx = I.x + Math.floor(I.w / 2) - 1, fy = I.y + Math.floor(I.h / 2) - 1;
          set(fx, fy, 2, 2, K.GROUND);
          buildings.push({ x: fx, y: fy, w: 2, h: 2, d: l.d, type: "fountain" });
          buildings.push({ ...I, d: l.d, type: "plaza" });
        } else if (r < 0.13) buildings.push({ ...I, d: l.d, type: "park" });
        else if (r < 0.45 && Math.max(I.w, I.h) >= 10) {
          // Coupé par une ruelle (raccourci : portiques aux deux bouts).
          const vert = I.w >= I.h;
          const len = vert ? I.w : I.h, cut = 3 + Math.floor(rnd() * (len - 9));
          if (vert) {
            set(I.x + cut, l.y, 3, l.h, K.ALLEY);
            gateAt(I.x + cut, l.y, 3, 0.34); gateAt(I.x + cut, l.y + l.h - 0.34, 3, 0.34);
            buildings.push({ x: I.x, y: I.y, w: cut, h: I.h, d: l.d, type: "block" }, { x: I.x + cut + 3, y: I.y, w: I.w - cut - 3, h: I.h, d: l.d, type: "block" });
          } else {
            set(l.x, I.y + cut, l.w, 3, K.ALLEY);
            gateAt(l.x, I.y + cut, 0.34, 3); gateAt(l.x + l.w - 0.34, I.y + cut, 0.34, 3);
            buildings.push({ x: I.x, y: I.y, w: I.w, h: cut, d: l.d, type: "block" }, { x: I.x, y: I.y + cut + 3, w: I.w, h: I.h - cut - 3, d: l.d, type: "block" });
          }
        } else buildings.push({ ...I, d: l.d, type: r < 0.75 ? "block" : "towers" });
      } else if (l.d === "usine") {
        if (r < 0.45 && I.w >= 7 && I.h >= 7) {
          // Une cour d'usine clôturée : entrepôt d'un côté, cour (on la traverse : portiques aux 2 entrées).
          const vert = I.w >= I.h;
          set(I.x, I.y, I.w, I.h, K.FENCE);
          const yard = vert ? { x: I.x + Math.ceil(I.w * 0.45), y: I.y + 1, w: I.w - Math.ceil(I.w * 0.45) - 1, h: I.h - 2 } : { x: I.x + 1, y: I.y + Math.ceil(I.h * 0.45), w: I.w - 2, h: I.h - Math.ceil(I.h * 0.45) - 1 };
          set(yard.x, yard.y, yard.w, yard.h, K.YARD);
          const wh = vert ? { x: I.x + 1, y: I.y + 1, w: Math.ceil(I.w * 0.45) - 1, h: I.h - 2 } : { x: I.x + 1, y: I.y + 1, w: I.w - 2, h: Math.ceil(I.h * 0.45) - 1 };
          set(wh.x, wh.y, wh.w, wh.h, K.GROUND);
          // Deux entrées (en face l'une de l'autre) qui traversent la cour.
          if (vert) {
            const ex = yard.x + Math.floor((yard.w - 3) / 2);
            set(ex, I.y, 3, 1, K.YARD); set(ex, I.y + I.h - 1, 3, 1, K.YARD);
            gateAt(ex, I.y, 3, 0.34); gateAt(ex, I.y + I.h - 0.34, 3, 0.34);
          } else {
            const ey = yard.y + Math.floor((yard.h - 3) / 2);
            set(I.x, ey, 1, 3, K.YARD); set(I.x + I.w - 1, ey, 1, 3, K.YARD);
            gateAt(I.x, ey, 0.34, 3); gateAt(I.x + I.w - 0.34, ey, 0.34, 3);
          }
          // Des conteneurs empilés dans la cour (ils bloquent).
          const cont = [];
          for (let k = 0; k < 3; k++) {
            const c = vert ? { x: yard.x + 1 + Math.floor(rnd() * Math.max(1, yard.w - 4)), y: yard.y + 1 + k * Math.floor(yard.h / 3), w: 3, h: 1 } : { x: yard.x + 1 + k * Math.floor(yard.w / 3), y: yard.y + 1 + Math.floor(rnd() * Math.max(1, yard.h - 4)), w: 1, h: 3 };
            // (jamais devant les entrées)
            const mx = vert ? Math.abs(c.x + 1.5 - (yard.x + yard.w / 2)) : Math.abs(c.y + 1.5 - (yard.y + yard.h / 2));
            if (mx < 3) continue;
            set(c.x, c.y, c.w, c.h, K.GROUND); cont.push(c);
          }
          buildings.push({ ...wh, d: l.d, type: "warehouse" }, { ...I, d: l.d, type: "yard", yard, cont, vert });
        } else buildings.push({ ...I, d: l.d, type: r < 0.75 ? "warehouse" : "factory" });
      } else {
        if (r < 0.2 && I.w >= 11 && I.h >= 11) {
          // Une impasse qui entre dans le pâté, avec un rond de retournement au bout ; des maisons autour.
          const fromTop = rnd() < 0.5, vert = I.h >= I.w;
          const len = Math.floor((vert ? I.h : I.w) * 0.65);
          let cul;
          if (vert) {
            const cx = I.x + Math.floor((I.w - 4) / 2);
            const y0 = fromTop ? l.y : l.y + l.h - len;
            set(cx, y0, 4, len, K.ROAD);
            const cy = fromTop ? l.y + len - 3 : l.y + l.h - len - 3;
            set(cx - 1, cy, 6, 6, K.ROAD);
            cul = { x: cx - 1, y: cy, w: 6, h: 6, sx: cx, sy: y0, sw: 4, sh: len };
          } else {
            const cy = I.y + Math.floor((I.h - 4) / 2);
            const x0 = fromTop ? l.x : l.x + l.w - len;
            set(x0, cy, len, 4, K.ROAD);
            const cx = fromTop ? l.x + len - 3 : l.x + l.w - len - 3;
            set(cx, cy - 1, 6, 6, K.ROAD);
            cul = { x: cx, y: cy - 1, w: 6, h: 6, sx: x0, sy: cy, sw: len, sh: 4 };
          }
          roads.push({ x: cul.sx, y: cul.sy, w: cul.sw, h: cul.sh, kind: "culdesac", horiz: cul.sw > cul.sh });
          buildings.push({ ...I, d: l.d, type: "culdesac", cul });
        } else if (r < 0.27) buildings.push({ ...I, d: l.d, type: rnd() < 0.6 ? "park" : "field" });
        else if (r < 0.55 && Math.max(I.w, I.h) >= 9) {
          // Une allée entre les jardins (raccourci à portiques).
          const vert = I.w >= I.h;
          const len = vert ? I.w : I.h, cut = 3 + Math.floor(rnd() * (len - 9));
          if (vert) {
            set(I.x + cut, l.y, 3, l.h, K.ALLEY);
            gateAt(I.x + cut, l.y, 3, 0.34); gateAt(I.x + cut, l.y + l.h - 0.34, 3, 0.34);
            buildings.push({ x: I.x, y: I.y, w: cut, h: I.h, d: l.d, type: "houses" }, { x: I.x + cut + 3, y: I.y, w: I.w - cut - 3, h: I.h, d: l.d, type: "houses" });
          } else {
            set(l.x, I.y + cut, l.w, 3, K.ALLEY);
            gateAt(l.x, I.y + cut, 0.34, 3); gateAt(l.x + l.w - 0.34, I.y + cut, 0.34, 3);
            buildings.push({ x: I.x, y: I.y, w: I.w, h: cut, d: l.d, type: "houses" }, { x: I.x, y: I.y + cut + 3, w: I.w, h: I.h - cut - 3, d: l.d, type: "houses" });
          }
        } else buildings.push({ ...I, d: l.d, type: "houses" });
      }
    }
    // Les ronds-points doivent rester libres (les trottoirs des pâtés ne débordent pas dessus).
    // ---------------- Les 2 sorties (bretelles du périphérique vers l'extérieur) ----------------
    const top = rnd() < 0.5;
    const exits = [towns[0], towns[2]].map((town) => {
      const x = town.x + Math.floor(town.w / 2) - 2, w = 5;
      const ry = top ? 0 : hw.y + hw.h, rh = top ? C1 : TH - hw.y - hw.h;
      set(x, ry, w, rh, K.RAMP);
      const ramp = { x: x * T, y: ry * T, w: w * T, h: rh * T };
      const gate = top ? { x: x * T, y: C1 * T - 24, w: w * T, h: 24 } : { x: x * T, y: (hw.y + hw.h) * T, w: w * T, h: 24 };
      const zone = top ? { x: x * T, y: 0, w: w * T, h: (C1 * T) / 2 } : { x: x * T, y: TH * T - (C1 * T) / 2, w: w * T, h: (C1 * T) / 2 };
      const spawn = { x: (x + 2.5) * T, y: top ? (C1 + 3.5) * T : (hw.y + hw.h - 3.5) * T, a: 0 };
      return { side: top ? 0 : 2, ramp, gate: { ...gate, exitGate: true, kind: "exitgate" }, zone, spawn };
    });

    // ---------------- Obstacles : les tuiles qui bloquent, regroupées en rectangles ----------------
    const solid = [];
    const used = new Uint8Array(TW * TH);
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = grid[j * TW + i];
      if (used[j * TW + i] || DRIVE.has(k)) continue;
      // Bande horizontale la plus longue, puis on la descend tant que la rangée en dessous est pareille.
      let w = 0;
      while (i + w < TW && !used[j * TW + i + w] && !DRIVE.has(grid[j * TW + i + w]) && grid[j * TW + i + w] === k) w++;
      let h = 1;
      outer: while (j + h < TH) {
        for (let q = 0; q < w; q++) { const c = (j + h) * TW + i + q; if (used[c] || grid[c] !== k) break outer; }
        h++;
      }
      for (let jj = j; jj < j + h; jj++) for (let q = 0; q < w; q++) used[jj * TW + i + q] = 1;
      solid.push({ x: i * T, y: j * T, w: w * T, h: h * T, kind: k });
    }

    const city = {
      seed, w: TW * T, h: TH * T, TW, TH, grid, roads, lots: buildings, towns: towns.map((t) => ({ x: t.x * T, y: t.y * T, w: t.w * T, h: t.h * T, d: t.d, avenue: t.avenue })),
      rivers: rivers.map((r) => ({ x: r.x * T, y: r.y * T, w: r.w * T, h: r.h * T })), highway: { x: hw.x * T, y: hw.y * T, w: hw.w * T, h: hw.h * T, lane: HW * T },
      accesses: accesses.map((a) => ({ x: a.x * T, y: a.y * T, w: a.w * T, h: a.h * T, top: a.top })),
      rounds, gates, exits, station,
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
  // Dans quel quartier ? (null = campagne / périphérique)
  C.districtAt = (city, x, y) => city.towns.find((t) => x >= t.x && x < t.x + t.w && y >= t.y && y < t.y + t.h)?.d || null;

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
    const h = city.highway;
    const start = C.nearestFree(nav, C.cellOf(nav, h.x + h.w / 2, h.y + h.lane / 2));
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
