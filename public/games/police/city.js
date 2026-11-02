// ===================================================================
//  AVIS DE RECHERCHE — Générateur de ville (partagé serveur + navigateur)
//  Une ville en quadrillage avec :
//   - 3 quartiers : centre-ville (tours, ruelles), zone industrielle
//     (entrepôts, parkings), banlieue (maisons, jardins) ;
//   - 3 zones séparées par 2 larges rivières (de longs ponts) ;
//   - 1 ou 2 boulevards (rues 2 fois plus larges), des ronds-points,
//     une avenue en diagonale ;
//   - un périphérique tout autour, la campagne au-delà, et 2 sorties
//     (fermées par une barrière jusqu'à la fin du chrono) ;
//   - le commissariat (d'où partent les flics) ;
//   - des raccourcis protégés par un portique : les F1 / sportives / motos
//     passent, les vans et camions NON.
//  Tirée à partir d'un nombre (seed) : le serveur n'envoie que ce nombre,
//  le navigateur refait exactement la même ville.
//    globalThis.PoliceCity.build(seed, nPlayers) -> ville
// ===================================================================

(function (root) {
  const C = {};
  C.CELL = 400;       // un pâté de maisons + une rue
  C.ROAD = 150;       // largeur d'une rue
  C.ALLEY = 80;       // largeur d'une ruelle
  C.NAV = 40;         // taille d'une case de la grille de navigation (IA)
  C.RING = 110;       // le périphérique : la rue du bord est élargie de 110 px vers l'extérieur
  C.OUT = 240;        // la campagne autour (on n'y roule pas, sauf sur les 2 bretelles de sortie)
  C.BLVD = 50;        // un boulevard : la rue est élargie de 50 px de chaque côté
  C.WALK = 18;       // largeur des trottoirs (ils font partie des pâtés : on ne roule pas dessus)
  C.RIVER = 600;     // largeur d une colonne de rivière (quais compris) : de longs ponts
  C.GATE_W = 26;      // portique : les véhicules plus larges que ça (van 28, camion 32) sont bloqués
  const O = C.OUT + C.RING;   // où commence le quadrillage
  C.O = O;

  // Hasard "rejouable" : la même seed donne toujours la même suite de nombres.
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  C.seeded = seeded;

  C.build = function (seed, nPlayers) {
    const rnd = seeded(seed);
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));       // entier entre a et b (inclus)
    const SW = C.WALK;

    // ---------------- Les 3 zones, séparées par 2 rivières ----------------
    // Colonnes de pâtés : [zone gauche] [rivière] [centre-ville] [rivière] [zone droite]
    const side = nPlayers <= 4 ? 2 : 3, mid = 3;
    const rA = side, rB = side + 1 + mid;                   // les 2 colonnes remplies d'eau
    const nx = side * 2 + mid + 2;
    const ny = nPlayers <= 4 ? 5 : 6;
    const isRiverCol = (i) => i === rA || i === rB;
    const isRiver = (i) => isRiverCol(i);
    const leftIsIndus = rnd() < 0.5;
    const districtOf = (i) => (i < rA ? (leftIsIndus ? "usine" : "banlieue") : i > rB ? (leftIsIndus ? "banlieue" : "usine") : "centre");
    // Des pâtés de tailles différentes (et les rivières bien larges : de longs ponts).
    const colW = [], rowH = [];
    for (let i = 0; i < nx; i++) colW.push(isRiverCol(i) ? C.RIVER : 380 + Math.round(rnd() * 140));
    for (let j = 0; j < ny; j++) rowH.push(380 + Math.round(rnd() * 140));
    const xs = [O], ys = [O];
    for (let i = 0; i < nx; i++) xs.push(xs[i] + colW[i]);
    for (let j = 0; j < ny; j++) ys.push(ys[j] + rowH[j]);
    const W = xs[nx] + C.ROAD + O, H = ys[ny] + C.ROAD + O;
    const lineX = (i) => xs[i];   // bord gauche de la rue verticale n° i
    const lineY = (j) => ys[j];

    // ---------------- Les ponts (+ le périphérique, en haut et en bas) ----------------
    const crossLines = [];
    for (let k = 1; k < ny; k++) crossLines.push(k);
    const pickTwo = () => { const s = new Set(); while (s.size < Math.min(2, crossLines.length)) s.add(crossLines[Math.floor(rnd() * crossLines.length)]); return s; };
    const bridgesA = pickTwo(), bridgesB = pickTwo();

    // ---------------- Les boulevards ----------------
    const bvX = new Set(), bvY = new Set();
    // Un boulevard horizontal qui traverse toute la ville (il passe sur un pont de chaque rivière).
    const across = [...bridgesA][Math.floor(rnd() * bridgesA.size)];
    bvY.add(across); bridgesB.add(across);
    // Peut-être un 2e, vertical, dans le centre-ville.
    if (rnd() < 0.6) bvX.add(ri(rA + 2, rB - 1));
    const blvdX = (i) => (bvX.has(i) ? C.BLVD : 0), blvdY = (j) => (bvY.has(j) ? C.BLVD : 0);
    const roadX = (i) => ({ x0: i === 0 ? C.OUT : lineX(i) - blvdX(i), x1: i === nx ? W - C.OUT : lineX(i) + C.ROAD + blvdX(i) });
    const roadY = (j) => ({ y0: j === 0 ? C.OUT : lineY(j) - blvdY(j), y1: j === ny ? H - C.OUT : lineY(j) + C.ROAD + blvdY(j) });
    function blockRect(i, j) {
      const x = lineX(i) + C.ROAD + blvdX(i), y = lineY(j) + C.ROAD + blvdY(j);
      return { x, y, w: lineX(i + 1) - blvdX(i + 1) - x, h: lineY(j + 1) - blvdY(j + 1) - y };
    }

    const buildings = [];   // tout ce qui est "posé" : { x, y, w, h, kind, d, tone, hgt }
    const gates = [];       // portiques (bloquent seulement les gros véhicules)
    const parks = [];       // places (herbe, arbres)
    const plazas = [];      // esplanades de l'avenue en diagonale { x, y, w, h, dir }
    const lots = [];        // parkings et lotissements (décor du sol)
    const blocks = [];      // tous les pâtés (pour les couleurs et la mini-carte)
    const add = (o) => { buildings.push(o); return o; };
    const gate = (x, y, w, h) => gates.push({ x, y, w, h, gate: true, kind: "gate" });

    // ---------------- Le commissariat : le plus grand pâté au cœur du centre-ville ----------------
    const station = {};
    {
      let best = null, bs = -1e9;
      const ci = (rA + rB) / 2, cj = (ny - 1) / 2;
      for (let i = rA + 1; i < rB; i++) for (let j = 0; j < ny; j++) {
        const b = blockRect(i, j);
        // Assez grand pour un bâtiment en U autour du garage.
        const sc = b.w * b.h / 10000 - Math.hypot(i - ci, j - cj) * 1.5 + rnd() - (Math.min(b.w, b.h) < 240 ? 100 : 0);
        if (sc > bs) { bs = sc; best = [i, j]; }
      }
      Object.assign(station, { i: best[0], j: best[1], side: Math.floor(rnd() * 4) });
    }

    // ---------------- L'avenue en diagonale : 3 esplanades en escalier (dans le centre) ----------------
    const diag = new Map();   // "i,j" -> direction (+1 = descend vers la droite, -1 = monte)
    for (let tries = 0; tries < 30 && !diag.size; tries++) {
      const dj = rnd() < 0.5 ? 1 : -1;
      const i0 = rA + 1, j0 = dj > 0 ? ri(0, ny - 3) : ri(2, ny - 1);
      const chain = [0, 1, 2].map((k) => [i0 + k, j0 + k * dj]);
      if (chain.some(([i, j]) => i === station.i && j === station.j)) continue;
      for (const [i, j] of chain) diag.set(i + "," + j, dj);
    }
    const diagCross = new Set();
    for (const [key, dj] of diag) {
      const [i, j] = key.split(",").map(Number);
      if (diag.has(i + 1 + "," + (j + dj))) diagCross.add(i + 1 + "," + (dj > 0 ? j + 1 : j));
    }

    // ---------------- Les pâtés ----------------
    // Coupé en deux par une ruelle (avec portiques aux 2 bouts si gated).
    function split(b, d, tone, hgt, gated, kind) {
      const vert = b.w > b.h ? rnd() < 0.7 : rnd() < 0.3;
      const len = vert ? b.w : b.h;
      const cut = 70 + rnd() * Math.max(1, len - 2 * 70 - C.ALLEY);
      if (vert) {
        add({ x: b.x, y: b.y, w: cut, h: b.h, kind, d, tone, hgt });
        add({ x: b.x + cut + C.ALLEY, y: b.y, w: b.w - cut - C.ALLEY, h: b.h, kind, d, tone: tone + 1, hgt: hgt * (0.8 + rnd() * 0.4) });
        if (gated) { gate(b.x + cut, b.y, C.ALLEY, 10); gate(b.x + cut, b.y + b.h - 10, C.ALLEY, 10); }
      } else {
        add({ x: b.x, y: b.y, w: b.w, h: cut, kind, d, tone, hgt });
        add({ x: b.x, y: b.y + cut + C.ALLEY, w: b.w, h: b.h - cut - C.ALLEY, kind, d, tone: tone + 1, hgt: hgt * (0.8 + rnd() * 0.4) });
        if (gated) { gate(b.x, b.y + cut, 10, C.ALLEY); gate(b.x + b.w - 10, b.y + cut, 10, C.ALLEY); }
      }
    }

    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      if (isRiver(i)) continue;
      const b = blockRect(i, j);
      const d = districtOf(i);
      const tone = Math.floor(rnd() * 4);
      const r = rnd();
      blocks.push({ ...b, d });

      if (i === station.i && j === station.j) {
        // Le commissariat : un bâtiment en U autour d'un garage ouvert sur la rue (les flics en sortent).
        const s = station.side, GW = 100, D = Math.min(170, (s % 2 ? b.w : b.h) - 70);
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        let bay;
        if (s === 0) bay = { x: cx - GW / 2, y: b.y, w: GW, h: D };
        else if (s === 2) bay = { x: cx - GW / 2, y: b.y + b.h - D, w: GW, h: D };
        else if (s === 1) bay = { x: b.x + b.w - D, y: cy - GW / 2, w: D, h: GW };
        else bay = { x: b.x, y: cy - GW / 2, w: D, h: GW };
        // Les 3 morceaux du bâtiment autour du garage.
        const parts = s % 2 === 0
          ? [{ x: b.x, y: b.y, w: bay.x - b.x, h: b.h }, { x: bay.x + GW, y: b.y, w: b.x + b.w - bay.x - GW, h: b.h },
             s === 0 ? { x: bay.x, y: bay.y + D, w: GW, h: b.h - D } : { x: bay.x, y: b.y, w: GW, h: b.h - D }]
          : [{ x: b.x, y: b.y, w: b.w, h: bay.y - b.y }, { x: b.x, y: bay.y + GW, w: b.w, h: b.y + b.h - bay.y - GW },
             s === 1 ? { x: b.x, y: bay.y, w: b.w - D, h: GW } : { x: b.x + D, y: bay.y, w: b.w - D, h: GW }];
        for (const p of parts) add({ ...p, kind: "station", d, tone: 0, hgt: 0.7 });
        const out = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][s];
        const ox = Math.cos(out), oy = Math.sin(out);
        const bcx = bay.x + bay.w / 2, bcy = bay.y + bay.h / 2, depth = (s % 2 ? bay.w : bay.h);
        // 2 places dans le garage + 1 juste devant la porte.
        const spots = [-0.28, 0.12, 0.62].map((k) => ({ x: bcx + ox * k * depth, y: bcy + oy * k * depth, a: out }));
        Object.assign(station, b, { bay, out, spots });
        continue;
      }
      const dj = diag.get(i + "," + j);
      if (dj) {
        // Esplanade : on la traverse en diagonale ; 2 kiosques dans les coins.
        const q = 84;
        plazas.push({ ...b, dir: dj });
        if (dj > 0) {
          add({ x: b.x + b.w - q, y: b.y, w: q, h: q, kind: "kiosk", d, tone, hgt: 0.25 });
          add({ x: b.x, y: b.y + b.h - q, w: q, h: q, kind: "kiosk", d, tone: tone + 1, hgt: 0.25 });
        } else {
          add({ x: b.x, y: b.y, w: q, h: q, kind: "kiosk", d, tone, hgt: 0.25 });
          add({ x: b.x + b.w - q, y: b.y + b.h - q, w: q, h: q, kind: "kiosk", d, tone: tone + 1, hgt: 0.25 });
        }
        continue;
      }

      if (d === "centre") {
        if (r < 0.1) {
          parks.push({ ...b, d });
          add({ x: b.x + b.w / 2 - 22, y: b.y + b.h / 2 - 22, w: 44, h: 44, kind: "fountain", d, tone: 0, hgt: 0 });
        } else if (r < 0.45) split(b, d, tone, 0.7 + rnd() * 0.3, rnd() < 0.5, "tower");
        else add({ ...b, kind: "tower", d, tone, hgt: 0.6 + rnd() * 0.4 });
      } else if (d === "usine") {
        if (r < 0.26) {
          // Parking clôturé : la clôture est sur le trottoir, on le traverse par le milieu (portiques), camions garés.
          const vert = rnd() < 0.5, F = SW, G = 88;
          lots.push({ ...b, kind: "parking", vert, d });
          if (vert) {
            const gx = b.x + (b.w - G) / 2;
            add({ x: b.x, y: b.y, w: F, h: b.h, kind: "fence", d });
            add({ x: b.x + b.w - F, y: b.y, w: F, h: b.h, kind: "fence", d });
            add({ x: b.x + F, y: b.y, w: gx - b.x - F, h: F, kind: "fence", d });
            add({ x: gx + G, y: b.y, w: b.x + b.w - F - gx - G, h: F, kind: "fence", d });
            add({ x: b.x + F, y: b.y + b.h - F, w: gx - b.x - F, h: F, kind: "fence", d });
            add({ x: gx + G, y: b.y + b.h - F, w: b.x + b.w - F - gx - G, h: F, kind: "fence", d });
            gate(gx, b.y, G, 10); gate(gx, b.y + b.h - 10, G, 10);
            const nRow = Math.max(2, Math.floor((b.h - 2 * F - 20) / 70));
            for (let k = 0; k < nRow; k++) {
              const y = b.y + F + 14 + k * ((b.h - 2 * F - 28 - 32) / Math.max(1, nRow - 1));
              add({ x: b.x + F + 10, y, w: gx - b.x - F - 22, h: 32, kind: "parked", d, tone: (tone + k) % 4 });
              add({ x: gx + G + 12, y, w: b.x + b.w - F - gx - G - 22, h: 32, kind: "parked", d, tone: (tone + k + 1) % 4 });
            }
          } else {
            const gy = b.y + (b.h - G) / 2;
            add({ x: b.x, y: b.y, w: b.w, h: F, kind: "fence", d });
            add({ x: b.x, y: b.y + b.h - F, w: b.w, h: F, kind: "fence", d });
            add({ x: b.x, y: b.y + F, w: F, h: gy - b.y - F, kind: "fence", d });
            add({ x: b.x, y: gy + G, w: F, h: b.y + b.h - F - gy - G, kind: "fence", d });
            add({ x: b.x + b.w - F, y: b.y + F, w: F, h: gy - b.y - F, kind: "fence", d });
            add({ x: b.x + b.w - F, y: gy + G, w: F, h: b.y + b.h - F - gy - G, kind: "fence", d });
            gate(b.x, gy, 10, G); gate(b.x + b.w - 10, gy, 10, G);
            const nCol = Math.max(2, Math.floor((b.w - 2 * F - 20) / 70));
            for (let k = 0; k < nCol; k++) {
              const x = b.x + F + 14 + k * ((b.w - 2 * F - 28 - 32) / Math.max(1, nCol - 1));
              add({ x, y: b.y + F + 10, w: 32, h: gy - b.y - F - 22, kind: "parked", d, tone: (tone + k) % 4 });
              add({ x, y: gy + G + 12, w: 32, h: b.y + b.h - F - gy - G - 22, kind: "parked", d, tone: (tone + k + 1) % 4 });
            }
          }
        } else if (r < 0.48) split(b, d, tone, 0.35 + rnd() * 0.15, rnd() < 0.4, "warehouse");
        else add({ ...b, kind: "warehouse", d, tone, hgt: 0.3 + rnd() * 0.25 });
      } else {
        if (r < 0.12) parks.push({ ...b, d });
        else if (r < 0.52) {
          // Lotissement : 4 maisons, 2 allées en croix entre les jardins (portiques aux 4 bouts).
          const G = 64, hw = (b.w - G) / 2, hh = (b.h - G) / 2;
          lots.push({ ...b, kind: "lotissement", d });
          for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            add({ x: b.x + qx * (hw + G), y: b.y + qy * (hh + G), w: hw, h: hh, kind: "house", d, tone: (tone + qx + qy * 2) % 4, hgt: 0.2 + rnd() * 0.1 });
          }
          gate(b.x + hw, b.y, G, 10); gate(b.x + hw, b.y + b.h - 10, G, 10);
          gate(b.x, b.y + hh, 10, G); gate(b.x + b.w - 10, b.y + hh, 10, G);
        } else if (r < 0.62) add({ ...b, kind: "tower", d, tone, hgt: 0.4 + rnd() * 0.2 });   // petit immeuble
        else add({ ...b, kind: "houses", d, tone, hgt: 0.22 + rnd() * 0.1 });
      }
    }

    // ---------------- L'eau (les morceaux de rivière entre les ponts) ----------------
    const water = [], bridgeRects = [], rivers = [];
    for (const [rk, set] of [[rA, bridgesA], [rB, bridgesB]]) {
      const x0 = lineX(rk) + C.ROAD, x1 = lineX(rk + 1);
      rivers.push({ x: x0, y: 0, w: x1 - x0, h: H, vertical: true });
      let y = lineY(0) + C.ROAD;
      for (let j = 1; j <= ny; j++) {
        if (j === ny || set.has(j)) {
          const r = roadY(j);
          water.push({ x: x0, y, w: x1 - x0, h: r.y0 - y, kind: "water" });
          y = r.y1;
        }
      }
      for (const j of [0, ...set, ny]) { const r = roadY(j); bridgeRects.push({ x: x0, y: r.y0, w: x1 - x0, h: r.y1 - r.y0, vertical: true }); }
    }

    // ---------------- Terre-pleins des boulevards (avec des arbres) ----------------
    const medians = [];
    for (const i of bvX) for (let j = 0; j < ny; j++) {
      const y0 = lineY(j) + C.ROAD + blvdY(j) + 30, y1 = lineY(j + 1) - blvdY(j + 1) - 30;
      medians.push({ x: lineX(i) + C.ROAD / 2 - 8, y: y0, w: 16, h: y1 - y0, kind: "median" });
    }
    for (const j of bvY) for (let i = 0; i < nx; i++) {
      const x0 = lineX(i) + C.ROAD + blvdX(i) + 30, x1 = lineX(i + 1) - blvdX(i + 1) - 30;
      medians.push({ x: x0, y: lineY(j) + C.ROAD / 2 - 8, w: x1 - x0, h: 16, kind: "median" });
    }

    // ---------------- Ronds-points ----------------
    const islands = [], rounds = [];
    const cand = [];
    for (let i = 1; i < nx; i++) for (let j = 1; j < ny; j++) {
      if (isRiverCol(i) || isRiverCol(i - 1)) continue;   // pas sur les quais
      if (diagCross.has(i + "," + j)) continue;
      cand.push({ i, j, big: bvX.has(i) && bvY.has(j), w: (bvX.has(i) ? 3 : 0) + (bvY.has(j) ? 3 : 0) + rnd() * 4 });
    }
    cand.sort((a, b) => b.w - a.w);
    for (const k of cand.slice(0, Math.min(cand.length, 3))) {
      const cx = lineX(k.i) + C.ROAD / 2, cy = lineY(k.j) + C.ROAD / 2;
      const a = k.big ? 110 : 56, b2 = k.big ? 66 : 32;
      rounds.push({ x: cx, y: cy, r: a / 2 + 2, i: k.i, j: k.j });
      islands.push({ x: cx - a / 2, y: cy - b2 / 2, w: a, h: b2, kind: "island" });
      islands.push({ x: cx - b2 / 2, y: cy - a / 2, w: b2, h: a, kind: "island" });
    }
    const roundAt = new Set(rounds.map((r) => r.i + "," + r.j));

    // ---------------- Quelques rues barrées (travaux) ----------------
    const barriers = [];
    const nBar = Math.floor(nx * ny * 0.05);
    // (jamais devant le commissariat)
    const nearStation = (o) => o.x + o.w > station.x - C.ROAD && o.x < station.x + station.w + C.ROAD && o.y + o.h > station.y - C.ROAD && o.y < station.y + station.h + C.ROAD;
    for (let k = 0, tries = 0; k < nBar && tries < 60; tries++) {
      if (rnd() < 0.5) {
        const i = ri(1, nx - 1), j = ri(0, ny - 1);
        if (bvX.has(i)) continue;
        const cy = (lineY(j) + C.ROAD + lineY(j + 1)) / 2;
        const o = { x: lineX(i), y: cy - 12, w: C.ROAD, h: 24, kind: "barrier" };
        if (nearStation(o)) continue;
        barriers.push(o);
      } else {
        const i = ri(0, nx - 1), j = ri(1, ny - 1);
        if (bvY.has(j) || isRiverCol(i)) continue;
        const cx = (lineX(i) + C.ROAD + lineX(i + 1)) / 2;
        const o = { x: cx - 12, y: lineY(j), w: 24, h: C.ROAD, kind: "barrier" };
        if (nearStation(o)) continue;
        barriers.push(o);
      }
      k++;
    }

    // ---------------- La campagne et les 2 sorties ----------------
    const eside = Math.floor(rnd() * 4);            // 0 haut, 1 droite, 2 bas, 3 gauche
    let lines;
    if (eside % 2 === 0) {
      // En haut ou en bas : une sortie de chaque côté du centre-ville (pas au bord d'une rivière).
      const okL = []; for (let k = 1; k < rA; k++) okL.push(k);
      const okR = []; for (let k = rB + 2; k < nx; k++) okR.push(k);
      lines = [okL.length ? okL[Math.floor(rnd() * okL.length)] : 1, okR.length ? okR[Math.floor(rnd() * okR.length)] : nx - 1];
    } else {
      const half = Math.max(1, Math.floor(ny / 2) - 1);
      lines = [1 + Math.floor(rnd() * half), ny - 1 - Math.floor(rnd() * half)];
    }
    const exits = lines.map((k) => {
      const R = C.ROAD, OUT = C.OUT;
      let ramp, gateR, zone, spawn;
      if (eside === 0 || eside === 2) {
        const x = lineX(k);
        const top = eside === 0;
        ramp = { x, y: top ? 0 : H - OUT, w: R, h: OUT };
        gateR = { x, y: top ? OUT - 24 : H - OUT, w: R, h: 24 };
        zone = { x, y: top ? 0 : H - OUT * 0.5, w: R, h: OUT * 0.5 };
        spawn = { x: x + R / 2, y: top ? OUT + 70 : H - OUT - 70, a: top ? Math.PI / 2 : -Math.PI / 2 };
      } else {
        const y = lineY(k);
        const left = eside === 3;
        ramp = { x: left ? 0 : W - OUT, y, w: OUT, h: R };
        gateR = { x: left ? OUT - 24 : W - OUT, y, w: 24, h: R };
        zone = { x: left ? 0 : W - OUT * 0.5, y, w: OUT * 0.5, h: R };
        spawn = { x: left ? OUT + 70 : W - OUT - 70, y: y + R / 2, a: left ? 0 : Math.PI };
      }
      return { line: k, side: eside, ramp, gate: { ...gateR, exitGate: true, kind: "exitgate" }, zone, spawn };
    });
    const country = [];
    const bands = [
      { x: 0, y: 0, w: W, h: C.OUT }, { x: W - C.OUT, y: C.OUT, w: C.OUT, h: H - 2 * C.OUT },
      { x: 0, y: H - C.OUT, w: W, h: C.OUT }, { x: 0, y: C.OUT, w: C.OUT, h: H - 2 * C.OUT },
    ];
    bands.forEach((band, s) => {
      if (s !== eside) { country.push({ ...band, kind: "country" }); return; }
      const horiz = s % 2 === 0;
      let p = horiz ? band.x : band.y;
      const cuts = exits.map((e) => (horiz ? [e.ramp.x, e.ramp.x + e.ramp.w] : [e.ramp.y, e.ramp.y + e.ramp.h])).sort((a, b) => a[0] - b[0]);
      for (const [a, b] of [...cuts, [horiz ? band.x + band.w : band.y + band.h, 0]]) {
        if (a > p) country.push(horiz ? { x: p, y: band.y, w: a - p, h: band.h, kind: "country" } : { x: band.x, y: p, w: band.w, h: a - p, kind: "country" });
        p = b;
      }
    });

    // Décor : arbres dans les places.
    const trees = [];
    for (const p of parks) for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + rnd();
      const rr = Math.min(p.w, p.h) * 0.33;
      trees.push({ x: p.x + p.w / 2 + Math.cos(a) * rr, y: p.y + p.h / 2 + Math.sin(a) * rr, r: 16 + rnd() * 8 });
    }

    const city = {
      seed, nx, ny, w: W, h: H, lineX, lineY, roadX, roadY, bvX: [...bvX], bvY: [...bvY],
      buildings, gates, parks, plazas, lots, blocks, barriers, trees, water, rivers, bridges: bridgeRects,
      medians, islands, rounds, roundAt, country, exits, station,
    };
    // Tout ce qui bloque. Les barrières des sorties (exitgate) sautent à la fin du chrono.
    const solid = buildings.concat(barriers, gates, medians, islands, water, country);
    city.obstaclesOpen = solid;
    city.obstacles = solid.concat(exits.map((e) => e.gate));
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
  // Dans la ville (pas sur une bretelle de sortie) ?
  C.inCity = (city, x, y) => x > C.OUT && y > C.OUT && x < city.w - C.OUT && y < city.h - C.OUT;
  const inRect = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
  C.inRect = inRect;

  // ===================================================================
  //  GRILLE DE NAVIGATION : 1 = on peut rouler, 0 = obstacle (avec une
  //  petite marge pour que l'IA ne frotte pas les murs). Les portiques
  //  comptent comme des murs : l'IA ne connaît pas les raccourcis.
  //  Les barrières des sorties, elles, ne comptent pas (on file vers la sortie).
  //  Seule la grande zone reliée au périphérique est gardée.
  // ===================================================================
  function navGrid(city) {
    const N = C.NAV, cols = Math.ceil(city.w / N), rows = Math.ceil(city.h / N);
    const free = new Uint8Array(cols * rows);
    const M = 14;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = q * N + N / 2, y = r * N + N / 2;
      let ok = x > M && y > M && x < city.w - M && y < city.h - M;
      if (ok) for (const o of C.near(city, x, y, true)) {
        if (x > o.x - M && x < o.x + o.w + M && y > o.y - M && y < o.y + o.h + M) { ok = false; break; }
      }
      free[r * cols + q] = ok ? 1 : 0;
    }
    const nav = { cols, rows, free };
    // On garde seulement ce qui est relié au périphérique (haut de la ville, au milieu).
    const start = C.nearestFree(nav, C.cellOf(nav, city.w / 2, C.OUT + C.RING / 2));
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
    for (let rad = 1; rad < 8; rad++) {
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
