// ===================================================================
//  LAMPE TORCHE — Générateur de manoir hanté (partagé serveur + navigateur)
//  - Le manoir : une grille de petites cases regroupées en pièces de toutes
//    tailles (hall d'entrée, salle de bal, long couloir, placards…), reliées
//    par des portes (qu'on peut fermer). Tout est toujours accessible.
//  - Le jardin tout autour (haies, fontaine, cimetière), éclairé par la lune.
//  - La cave, à part, reliée par des escaliers. Des passages secrets.
//  - Fenêtres (rayons de lune), interrupteurs (lustres), planches qui
//    craquent, toiles d'araignée.
//  Tiré à partir d'une seed : le serveur n'envoie que ce nombre.
//    globalThis.Manoir.build(seed, nPlayers) -> manoir (manoir.seed peut changer : c'est lui qu'on envoie)
// ===================================================================

(function (root) {
  const M = {};
  M.CW = 180;          // largeur d'une case (mur compris)
  M.CH = 156;          // hauteur d'une case
  M.T = 14;            // épaisseur des murs
  M.DOOR = 70;         // largeur d'une porte
  M.NAV = 20;          // case de la grille de navigation (bots)
  M.LAMP_RANGE = 340;  // portée de la lampe
  M.LAMP_HALF = 0.42;  // demi-angle du cône de lumière (rad)
  M.SIGHT_RANGE = 520; // portée du regard d'un fantôme
  M.SIGHT_HALF = 0.96; // demi-angle (≈ 110° en tout)
  M.PAD = 20;          // rayon d'un passage secret / d'un escalier

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  M.seeded = seeded;
  // Mélange « rejouable » (le même partout : sort() avec un hasard ne donne pas le même résultat selon le navigateur).
  const shuffle = (arr, rnd) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const overlap = (a, b, gap = 0) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
  const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  M.inRect = inRect;

  // Les meubles de chaque type de pièce : [nom, longueur le long du mur, profondeur].
  const KINDS = {
    hall: { wall: [["armure", 26, 26], ["armure", 26, 26], ["console", 90, 26], ["plante", 28, 28], ["horloge", 34, 30]], center: [], chandelier: true },
    bal: { wall: [["piano", 96, 60], ["buffet", 130, 30], ["armure", 26, 26], ["plante", 28, 28], ["armure", 26, 26]], center: [], chandelier: true },
    couloir: { wall: [["console", 80, 24], ["armure", 26, 26], ["plante", 28, 28], ["console", 70, 24], ["armure", 26, 26]], center: [] },
    salon: { wall: [["canape", 120, 42], ["cheminee", 90, 26], ["buffet", 100, 30], ["plante", 28, 28]], center: [["table_basse", 80, 50]], rug: true },
    chambre: { wall: [["lit", 74, 104], ["armoire", 90, 34], ["commode", 70, 30]], center: [] },
    cuisine: { wall: [["comptoir", 160, 32], ["four", 50, 34], ["frigo", 44, 40]], center: [["table", 96, 60]] },
    bibliotheque: { wall: [["etagere", 150, 28], ["etagere", 130, 28], ["bureau", 90, 44]], center: [["table", 90, 56]] },
    manger: { wall: [["buffet", 120, 30], ["horloge", 34, 30], ["plante", 28, 28]], center: [["table", 150, 64]], chandelier: true },
    bain: { wall: [["baignoire", 56, 104], ["lavabo", 50, 30]], center: [] },
    placard: { wall: [["etagere", 70, 26], ["caisse", 40, 40]], center: [] },
    bureau: { wall: [["bureau", 90, 44], ["etagere", 80, 26]], center: [] },
    cave: { wall: [["tonneau", 44, 44], ["casier", 120, 30], ["tonneau", 44, 44], ["casier", 100, 30], ["caisse", 44, 44]], center: [["tonneau", 44, 44]] },
    chaufferie: { wall: [["chaudiere", 70, 60], ["caisse", 44, 44], ["tonneau", 44, 44]], center: [] },
  };
  const SMALL = ["placard", "bain", "bureau"];
  const BIG = ["salon", "chambre", "cuisine", "bibliotheque", "manger"];

  // ===================================================================
  //  Découpe une grille gx × gy en pièces. specials : pièces imposées.
  // ===================================================================
  function partition(gx, gy, rnd, specials, fillKinds) {
    const owner = new Int16Array(gx * gy).fill(-1);
    const rooms = [];
    const free = (x, y, w, h) => { if (x < 0 || y < 0 || x + w > gx || y + h > gy) return false; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (owner[j * gx + i] >= 0) return false; return true; };
    const place = (x, y, w, h, kind) => { const id = rooms.length; rooms.push({ id, cx: x, cy: y, cw: w, ch: h, kind }); for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) owner[j * gx + i] = id; return id; };
    for (const s of specials) {
      if (s.at) { if (free(s.at[0], s.at[1], s.w, s.h)) place(s.at[0], s.at[1], s.w, s.h, s.kind); continue; }
      for (let t = 0; t < 60; t++) {
        const x = Math.floor(rnd() * (gx - s.w + 1)), y = Math.floor(rnd() * (gy - s.h + 1));
        if (free(x, y, s.w, s.h)) { place(x, y, s.w, s.h, s.kind); break; }
      }
    }
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      if (owner[j * gx + i] >= 0) continue;
      let w = 1 + Math.floor(rnd() * 3), h = 1 + Math.floor(rnd() * 2);
      while (w > 1 && !free(i, j, w, 1)) w--;
      if (h > 1 && !free(i, j, w, h)) h = 1;
      const size = w * h;
      const kind = fillKinds ? fillKinds[Math.floor(rnd() * fillKinds.length)] : size === 1 ? SMALL[Math.floor(rnd() * SMALL.length)] : BIG[Math.floor(rnd() * BIG.length)];
      place(i, j, w, h, kind);
    }
    return { owner, rooms };
  }

  // ===================================================================
  //  Murs + portes d'une zone découpée en pièces (origine ox, oy).
  //  exits : portes vers l'extérieur [{ side, cell }] (side 0 haut, 1 droite, 2 bas, 3 gauche).
  // ===================================================================
  function buildWalls(gx, gy, P, ox, oy, rnd, exits, out) {
    const { CW, CH, T, DOOR } = M;
    const { owner, rooms } = P;
    const own = (i, j) => (i < 0 || j < 0 || i >= gx || j >= gy ? -2 : owner[j * gx + i]);
    // Les bords entre deux pièces : on choisit lesquels auront une porte.
    const edges = new Map();   // "a-b" -> [{ vert, i, j }]
    for (let j = 0; j < gy; j++) for (let i = 0; i < gx; i++) {
      const a = own(i, j);
      for (const [di, dj, vert] of [[1, 0, true], [0, 1, false]]) {
        const b = own(i + di, j + dj);
        if (b < 0 || b === a) continue;
        const key = Math.min(a, b) + "-" + Math.max(a, b);
        if (!edges.has(key)) edges.set(key, []);
        edges.get(key).push({ vert, i: i + di, j: j + dj });   // vert : ligne x = i ; sinon ligne y = j
      }
    }
    // Arbre couvrant (tout est relié) + des portes en plus (beaucoup autour des couloirs).
    const parent = rooms.map((r) => r.id);
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const keys = shuffle([...edges.keys()], rnd);
    const doorEdges = new Set();
    for (const k of keys) {
      const [a, b] = k.split("-").map(Number);
      if (find(a) !== find(b)) { parent[find(a)] = find(b); doorEdges.add(k); }
    }
    for (const k of keys) {
      if (doorEdges.has(k)) continue;
      const [a, b] = k.split("-").map(Number);
      const hub = ["couloir", "hall", "bal"].includes(rooms[a].kind) || ["couloir", "hall", "bal"].includes(rooms[b].kind);
      if (rnd() < (hub ? 0.55 : 0.25)) doorEdges.add(k);
    }
    const doorAt = new Map();   // "v:i:j" -> centre de la porte
    const doors = [];
    const addDoor = (vert, i, j, ext) => {
      const c = vert ? oy + j * CH + T + (CH - T) / 2 : ox + i * CW + T + (CW - T) / 2;
      doorAt.set((vert ? "v" : "h") + ":" + i + ":" + j, c);
      const d = vert ? { x: ox + i * CW, y: c - DOOR / 2, w: T, h: DOOR, vert } : { x: c - DOOR / 2, y: oy + j * CH, w: DOOR, h: T, vert };
      d.ext = !!ext;
      doors.push(d);
    };
    for (const k of doorEdges) { const list = edges.get(k); const e = list[Math.floor(rnd() * list.length)]; addDoor(e.vert, e.i, e.j); }
    for (const e of exits) {
      if (e.side === 0) addDoor(false, e.cell, 0, true);
      else if (e.side === 2) addDoor(false, e.cell, gy, true);
      else if (e.side === 3) addDoor(true, 0, e.cell, true);
      else addDoor(true, gx, e.cell, true);
    }
    // Les murs : sur chaque ligne de la grille, les bords qui séparent deux pièces (ou l'extérieur), moins les portes.
    const windows = [];
    const line = (vert, k, n, walled) => {
      const runs = [];
      for (let m = 0; m < n; m++) {
        if (!walled(m)) continue;
        const a = (vert ? oy + m * CH : ox + m * CW), b = a + (vert ? CH : CW) + T;
        const dc = doorAt.get((vert ? "v" : "h") + ":" + (vert ? k : m) + ":" + (vert ? m : k));
        if (dc !== undefined) { runs.push([a, dc - DOOR / 2], [dc + DOOR / 2, b]); }
        else {
          runs.push([a, b]);
          // Fenêtre sur les murs extérieurs (pas dans la cave).
          if (out.windows && (k === 0 || k === (vert ? gx : gy)) && rnd() < 0.45) windows.push({ vert, at: vert ? ox + k * CW : oy + k * CH, c: a + (b - a) / 2, outer: k === 0 ? -1 : 1 });
        }
      }
      const merged = [];
      for (const r of runs) { const last = merged[merged.length - 1]; if (last && r[0] <= last[1] + 0.5) last[1] = Math.max(last[1], r[1]); else merged.push([...r]); }
      for (const [a, b] of merged) if (b - a > 0.5) out.walls.push(vert ? { x: ox + k * CW, y: a, w: T, h: b - a } : { x: a, y: oy + k * CH, w: b - a, h: T });
    };
    for (let i = 0; i <= gx; i++) line(true, i, gy, (j) => own(i - 1, j) !== own(i, j));
    for (let j = 0; j <= gy; j++) line(false, j, gx, (i) => own(i, j - 1) !== own(i, j));
    // Les pièces en vrai (pixels), avec leurs côtés.
    for (const r of rooms) {
      r.x = ox + r.cx * CW + T; r.y = oy + r.cy * CH + T;
      r.w = r.cw * CW - T; r.h = r.ch * CH - T;
    }
    out.doors.push(...doors);
    return windows;
  }

  // Les meubles d'une pièce : contre les murs (loin des portes) et au milieu si la pièce est grande.
  function furnish(r, rnd, doors, furniture) {
    const K = KINDS[r.kind] || KINDS.salon;
    const placed = [];
    const ok = (o, gap) => placed.every((p) => !overlap(o, p, gap)) && doors.every((d) => !overlap(o, d, 52));
    const pieces = [...K.wall];
    if (r.kind === "couloir") for (let k = 0; k < r.cw; k++) pieces.push(pieces[k % 5]);
    for (const [name, len, depth] of pieces) {
      for (let t = 0; t < 6; t++) {
        const s = Math.floor(rnd() * 4);
        const along = s % 2 === 0 ? r.w : r.h;
        if (len > along - 40 || depth > (s % 2 === 0 ? r.h : r.w) - 75) continue;   // (il faut pouvoir passer devant)
        // (dans un couloir, jamais sur les petits côtés : on bloquerait le passage)
        if (r.kind === "couloir" && (r.w > r.h ? s % 2 === 1 : s % 2 === 0)) continue;
        const pos = 20 + rnd() * (along - 40 - len);
        const o = s === 0 ? { x: r.x + pos, y: r.y, w: len, h: depth } : s === 2 ? { x: r.x + pos, y: r.y + r.h - depth, w: len, h: depth }
          : s === 3 ? { x: r.x, y: r.y + pos, w: depth, h: len } : { x: r.x + r.w - depth, y: r.y + pos, w: depth, h: len };
        if (!ok(o, 50)) continue;
        placed.push({ ...o, name, side: s, kind: r.kind });
        break;
      }
    }
    if (r.w >= 250 && r.h >= 200) for (const [name, w, h] of K.center) {
      if (rnd() < 0.25) continue;
      const rot = r.h > r.w ? true : rnd() < 0.3;
      const ww = rot ? h : w, hh = rot ? w : h;
      const o = { x: r.x + (r.w - ww) / 2 + (rnd() - 0.5) * 30, y: r.y + (r.h - hh) / 2 + (rnd() - 0.5) * 24, w: ww, h: hh };
      if (!ok(o, 56)) continue;
      placed.push({ ...o, name, side: rot ? 1 : 0, kind: r.kind });
    }
    if (K.rug && r.w >= 200 && r.h >= 160) r.rug = true;
    furniture.push(...placed);
  }

  M.build = function (seed, nPlayers, opts = {}) {
    const rnd = seeded(seed);
    const { CW, CH, T } = M;
    const out = { walls: [], doors: [], windows: true };
    // ---------------- Le manoir ----------------
    // Le jardin : devant (en bas) + sur UN côté (gauche ou droite). Derrière et de l'autre côté : rien.
    const sideLeft = rnd() < 0.5;
    const SD = opts.small ? 300 : 460, FD = opts.small ? 380 : 520;   // largeur du jardin de côté, profondeur du jardin de devant
    // opts.small : un manoir plus petit, où l'on se croise tout le temps.
    const gx = opts.small ? 7 + Math.ceil(nPlayers * 0.4) : 8 + Math.ceil(nPlayers * 0.9), gy = opts.small ? 5 : nPlayers >= 5 ? 7 : 6;
    const MWp = gx * CW + T, MHp = gy * CH + T;
    const MX = sideLeft ? SD : 0, MY = 0;
    const cr = 2 + Math.floor(rnd() * (gy - 4));                  // la rangée du long couloir
    const hallX = Math.floor(gx / 2) - 1;
    const specials = [
      { kind: "hall", w: 3, h: 2, at: [hallX, gy - 2] },
      { kind: "couloir", w: gx - 2, h: 1, at: [1, cr === gy - 2 ? gy - 3 : cr] },
      { kind: "bal", w: 4, h: 2 + (gy >= 7 ? 1 : 0) },
    ];
    if (rnd() < 0.6) specials.push({ kind: "couloir", w: 1, h: Math.max(2, cr), at: [rnd() < 0.5 ? 1 + Math.floor(rnd() * 2) : gx - 2 - Math.floor(rnd() * 2), 0] });
    const P = partition(gx, gy, rnd, specials, null);
    // Portes vers le jardin : la grande porte (bas du hall) et 1 ou 2 portes sur le côté jardin.
    const gSide = sideLeft ? 3 : 1;
    const exits = [{ side: 2, cell: hallX + 1 }, { side: gSide, cell: 1 + Math.floor(rnd() * (gy - 2)) }];
    if (rnd() < 0.5) { const c2 = Math.floor(rnd() * gy); if (c2 !== exits[1].cell) exits.push({ side: gSide, cell: c2 }); }
    // Petit manoir (Cambrioleurs) : des sorties tout du long, pour qu'on ne puisse pas attendre les autres à une seule porte.
    if (opts.small) {
      for (const cell of [1, Math.floor(gx * 0.25), Math.floor(gx * 0.75), gx - 2]) if (!exits.some((e) => e.side === 2 && e.cell === cell)) exits.push({ side: 2, cell });
      for (const cell of [1, gy - 2]) if (!exits.some((e) => e.side === gSide && e.cell === cell)) exits.push({ side: gSide, cell });
    }
    const winRaw = buildWalls(gx, gy, P, MX, MY, rnd, exits, out);
    const rooms = P.rooms;
    const manorRect = { x: MX, y: MY, w: MWp, h: MHp };
    const GW = MWp + SD, H = MHp + FD;
    const gardenRect = { x: 0, y: 0, w: GW, h: H };
    const front = { x: MX, y: MHp, w: MWp, h: FD };
    const sideR = { x: sideLeft ? 0 : MWp, y: 0, w: SD, h: H };

    // ---------------- La cave (à droite, à part) ----------------
    const cgx = 5 + (nPlayers >= 5 ? 1 : 0), cgy = 4;
    const CX = GW + 200, CY = Math.max(T, (MHp - (cgy * CH + T)) / 2);
    out.windows = false;
    const PC = partition(cgx, cgy, rnd, [{ kind: "chaufferie", w: 2, h: 1 }], ["cave", "cave", "cave", "chaufferie"]);
    buildWalls(cgx, cgy, PC, CX, CY, rnd, [], out);
    const caveRooms = PC.rooms.map((r) => ({ ...r, id: P.rooms.length + r.id, cave: true }));
    const caveRect = { x: CX, y: CY, w: cgx * CW + T, h: cgy * CH + T };
    const W = caveRect.x + caveRect.w + 60;

    const walls = out.walls, doors = out.doors;
    // Le mur d'enceinte du domaine.
    walls.push({ x: 0, y: 0, w: GW, h: T, fence: true }, { x: 0, y: H - T, w: GW, h: T, fence: true }, { x: 0, y: 0, w: T, h: H, fence: true }, { x: GW - T, y: 0, w: T, h: H, fence: true });
    // Le vide entre le domaine et la cave : de gros blocs.
    walls.push({ x: GW, y: 0, w: W - GW, h: caveRect.y, void: true }, { x: GW, y: caveRect.y + caveRect.h, w: W - GW, h: H - caveRect.y - caveRect.h, void: true },
      { x: GW, y: caveRect.y, w: caveRect.x - GW, h: caveRect.h, void: true }, { x: caveRect.x + caveRect.w, y: caveRect.y, w: W - caveRect.x - caveRect.w, h: caveRect.h, void: true });

    // ---------------- Meubles ----------------
    const furniture = [];
    for (const r of rooms) furnish(r, rnd, doors, furniture);
    for (const r of caveRooms) furnish(r, rnd, doors, furniture);

    // ---------------- Le jardin ----------------
    const garden = [];   // obstacles { x, y, w, h, name }
    const deco = [];     // décor sans collision { kind, ... }
    const extDoors = doors.filter((d) => d.ext);
    const inside = (o, part, m = 30) => o.x >= part.x + m && o.y >= part.y + m && o.x + o.w <= part.x + part.w - m && o.y + o.h <= part.y + part.h - m;
    const gOk = (o, gap = 50, doorGap = 110) => (inside(o, front) || inside(o, sideR)) && !overlap(o, manorRect, 50)
      && garden.every((p) => !overlap(o, p, gap)) && extDoors.every((d) => !overlap(o, { x: d.x - doorGap, y: d.y - doorGap, w: d.w + 2 * doorGap, h: d.h + 2 * doorGap }, 0));
    const paths = [];
    const put = (o, gap, doorGap) => { if (gOk(o, gap, doorGap) && paths.every((p) => !overlap(o, p, 24))) { garden.push(o); return true; } return false; };

    // DEVANT : jardin à la française. Une allée de la grande porte au portail, la fontaine au milieu,
    // des parterres fleuris de chaque côté, des bancs, des statues, des lanternes.
    const fd = extDoors[0], fx = fd.x + fd.w / 2;
    deco.push({ kind: "path", x: fx - 40, y: front.y, w: 80, h: front.h });
    paths.push({ x: fx - 40, y: front.y, w: 80, h: front.h }, { x: front.x, y: front.y, w: front.w, h: 40 });
    deco.push({ kind: "portail", x: fx - 60, y: H - T, w: 120 });
    const fy = front.y + front.h * 0.52;
    deco.push({ kind: "ring", x: fx, y: fy, r: 110 });
    garden.push({ x: fx - 46, y: fy - 46, w: 92, h: 92, name: "fontaine" });
    for (const sx of [-1, 1]) {
      for (const [dy, ph] of [[90, 120], [front.h - 210, 120]]) {
        const pw = 170 + rnd() * 50;
        const o = { x: sx < 0 ? fx - 150 - pw : fx + 150, y: front.y + dy, w: pw, h: ph, name: "parterre", flowers: Math.floor(rnd() * 4) };
        put(o, 60, 90);
      }
      put({ x: fx + sx * 160 - 30, y: fy - 10, w: 60, h: 20, name: "banc" }, 30, 60);
      put({ x: fx + sx * 100 - 14, y: front.y + 40, w: 28, h: 28, name: "statue" }, 20, 20);
      for (let k = 0; k < 3; k++) deco.push({ kind: "lanterne", x: fx + sx * 58, y: front.y + 120 + k * (front.h - 200) / 2 });
    }
    // Des buis taillés en boule le long de l'allée.
    for (const sx of [-1, 1]) for (let y = front.y + 70; y < front.y + front.h - 60; y += 95) put({ x: fx + sx * 82 - 15, y, w: 30, h: 30, name: "buis" }, 30, 70);
    // Plus loin de chaque côté : un kiosque (d'un côté), d'autres parterres, des statues, des bancs, des haies.
    const far = [fx - 520, fx + 420];
    const kSide = rnd() < 0.5 ? 0 : 1;
    put({ x: far[kSide] - 10, y: front.y + front.h * 0.3, w: 120, h: 120, name: "kiosque" }, 60, 110);
    for (let t = 0; t < 40; t++) {
      const big = rnd() < 0.5;
      const o = big ? { x: front.x + rnd() * front.w, y: front.y + 60 + rnd() * (front.h - 200), w: 150 + rnd() * 60, h: 100, name: "parterre", flowers: Math.floor(rnd() * 4) }
        : { x: front.x + rnd() * front.w, y: front.y + 60 + rnd() * (front.h - 160), w: 30, h: 30, name: rnd() < 0.5 ? "statue" : "buis" };
      put(o, 70, 110);
      if (garden.filter((g) => g.name === "parterre").length >= 8) break;
    }
    for (let t = 0; t < 20 && garden.filter((g) => g.name === "banc").length < 5; t++) put({ x: front.x + rnd() * front.w, y: front.y + 60 + rnd() * (front.h - 160), w: 60, h: 20, name: "banc" }, 50, 90);
    for (let t = 0; t < 30 && garden.filter((g) => g.name === "haie").length < 4; t++) {
      const horiz = rnd() < 0.6, len = 120 + rnd() * 120;
      put(horiz ? { x: front.x + rnd() * front.w, y: front.y + 60 + rnd() * (front.h - 140), w: len, h: 24, name: "haie" } : { x: front.x + rnd() * front.w, y: front.y + 60 + rnd() * (front.h - 200), w: 24, h: len, name: "haie" }, 80, 120);
    }
    // Rangée d'arbres le long du mur du fond.
    for (let x = front.x + 60; x < front.x + front.w - 60; x += 110 + rnd() * 50) put({ x, y: H - 90, w: 30, h: 30, name: "arbre" }, 40, 80);

    // CÔTÉ : le cimetière (clôturé, avec une crypte), la serre, le puits, le potager, des arbres morts.
    const sx0 = sideR.x, sw = sideR.w;
    // (on laisse un large passage entre le cimetière et le manoir)
    const cem = { x: sideLeft ? sx0 + 40 : sx0 + 120, y: 40, w: sw - 160, h: Math.min(320, MHp * 0.45) };
    const F = 8, gapW = 80, gate = cem.x + cem.w / 2 - gapW / 2;
    garden.push({ x: cem.x, y: cem.y, w: cem.w, h: F, name: "grille" }, { x: cem.x, y: cem.y, w: F, h: cem.h, name: "grille" }, { x: cem.x + cem.w - F, y: cem.y, w: F, h: cem.h, name: "grille" },
      { x: cem.x, y: cem.y + cem.h - F, w: gate - cem.x, h: F, name: "grille" }, { x: gate + gapW, y: cem.y + cem.h - F, w: cem.x + cem.w - gate - gapW, h: F, name: "grille" });
    deco.push({ kind: "cimetiere", ...cem });
    garden.push({ x: cem.x + cem.w / 2 - 50, y: cem.y + 24, w: 100, h: 70, name: "crypte" });
    for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) {
      const o = { x: cem.x + 40 + k * ((cem.w - 110) / 3), y: cem.y + 130 + r * 80, w: 26, h: 36, name: "tombe" };
      if (o.y + o.h < cem.y + cem.h - 40 && rnd() < 0.85 && !(o.x + o.w > gate - 20 && o.x < gate + gapW + 20 && r === 1)) garden.push(o);
    }
    const midY = cem.y + cem.h + 60;
    const serre = { x: sx0 + 60 + rnd() * (sw - 280), y: midY + rnd() * 120, w: 160, h: 100, name: "serre" };
    put(serre, 60, 110);
    put({ x: sx0 + 60 + rnd() * (sw - 160), y: midY + 260 + rnd() * 120, w: 44, h: 44, name: "puits" }, 60, 110);
    const pot = { kind: "potager", x: sx0 + 50 + rnd() * (sw - 260), y: H - 260 - rnd() * 100, w: 180, h: 110 };
    if (!garden.some((p) => overlap(pot, p, 30)) && !overlap(pot, manorRect, 40)) deco.push(pot);
    for (let t = 0; t < 60 && garden.filter((g) => g.name === "arbre_mort").length < 7; t++) put({ x: sx0 + rnd() * sw, y: rnd() * H, w: 26, h: 26, name: "arbre_mort" }, 70, 110);
    for (let t = 0; t < 30 && garden.filter((g) => g.name === "haie").length < 3; t++) {
      const horiz = rnd() < 0.5, len = 110 + rnd() * 90;
      put(horiz ? { x: sx0 + rnd() * sw, y: rnd() * H, w: len, h: 24, name: "haie" } : { x: sx0 + rnd() * sw, y: rnd() * H, w: 24, h: len, name: "haie" }, 80, 120);
    }

    // ---------------- Fenêtres + rayons de lune ----------------
    const windows = winRaw.map((w) => {
      // Le rayon de lune entre dans la pièce (du côté intérieur du mur).
      const inside = w.outer < 0 ? 1 : -1;
      const patch = w.vert ? { x: inside > 0 ? w.at + T : w.at - 90, y: w.c - 34, w: 90, h: 68 } : { x: w.c - 34, y: inside > 0 ? w.at + T : w.at - 90, w: 68, h: 90 };
      return { ...w, patch };
    });

    const allRooms = rooms.concat(caveRooms);
    // Point libre au hasard dans une pièce (pas sur un meuble, ni devant une porte).
    const solid = walls.concat(furniture, garden);
    const spotIn = (r, pad = 26, avoid = []) => {
      for (let t = 0; t < 40; t++) {
        const x = r.x + pad + rnd() * (r.w - 2 * pad), y = r.y + pad + rnd() * (r.h - 2 * pad);
        const box = { x: x - pad, y: y - pad, w: 2 * pad, h: 2 * pad };
        if (solid.some((o) => overlap(box, o)) || doors.some((d) => overlap(box, d, 20)) || avoid.some((o) => overlap(box, o, 30))) continue;
        return { x, y };
      }
      return null;
    };
    // Un point contre un mur de la pièce (pour un passage secret / un escalier / un interrupteur), et la sortie un peu devant.
    const wallSpot = (r, avoid) => {
      for (let t = 0; t < 40; t++) {
        const s = Math.floor(rnd() * 4), along = s % 2 === 0 ? r.w : r.h;
        const p = 40 + rnd() * (along - 80);
        const x = s === 0 || s === 2 ? r.x + p : s === 3 ? r.x + 24 : r.x + r.w - 24;
        const y = s === 1 || s === 3 ? r.y + p : s === 0 ? r.y + 24 : r.y + r.h - 24;
        const nx = s === 3 ? 1 : s === 1 ? -1 : 0, ny = s === 0 ? 1 : s === 2 ? -1 : 0;
        const box = { x: x - 16, y: y - 16, w: 32, h: 32 };
        const exitP = { x: x + nx * 46, y: y + ny * 46 };
        const ebox = { x: exitP.x - 20, y: exitP.y - 20, w: 40, h: 40 };
        if (solid.some((o) => overlap(box, o) || overlap(ebox, o)) || doors.some((d) => overlap(box, d, 30)) || avoid.some((o) => overlap(box, o, 30))) continue;
        return { x, y, ex: exitP.x, ey: exitP.y, side: s };
      }
      return null;
    };
    const used = [];
    const mark = (p) => { if (p) used.push({ x: p.x - 30, y: p.y - 30, w: 60, h: 60 }); return p; };

    // ---------------- Escaliers (manoir ↔ cave) et passages secrets ----------------
    const portals = [];
    const nStairs = nPlayers >= 5 ? 2 : 1;
    const manorRooms = rooms.filter((r) => r.kind !== "couloir");
    for (let k = 0; k < nStairs; k++) {
      for (let t = 0; t < 20; t++) {
        const a = mark(wallSpot(manorRooms[Math.floor(rnd() * manorRooms.length)], used));
        const b = a && mark(wallSpot(caveRooms[Math.floor(rnd() * caveRooms.length)], used));
        if (a && b) { portals.push({ kind: "stairs", a, b }); break; }
      }
    }
    const nSecret = nPlayers >= 5 ? 3 : 2;
    for (let k = 0; k < nSecret; k++) {
      for (let t = 0; t < 30; t++) {
        const ra = manorRooms[Math.floor(rnd() * manorRooms.length)], rb = manorRooms[Math.floor(rnd() * manorRooms.length)];
        if (Math.abs(ra.cx - rb.cx) + Math.abs(ra.cy - rb.cy) < 4) continue;
        const a = mark(wallSpot(ra, used)), b = a && mark(wallSpot(rb, used));
        if (a && b) { portals.push({ kind: "secret", a, b }); break; }
      }
    }

    // ---------------- Interrupteurs (lustres), planches qui craquent, toiles d'araignée ----------------
    const switches = [];
    rooms.forEach((r) => {
      const big = r.cw * r.ch >= 2 || KINDS[r.kind]?.chandelier;
      if (r.kind === "couloir" || !big || (!KINDS[r.kind]?.chandelier && rnd() > 0.55)) return;
      const p = mark(wallSpot(r, used));
      if (p) { switches.push({ id: switches.length, room: r.id, x: p.x, y: p.y, side: p.side }); r.lamp = switches.length - 1; }
    });
    const creaks = [], webs = [];
    const nCreak = Math.round(rooms.length * 0.45), nWeb = Math.round(allRooms.length * 0.3);
    for (let k = 0; k < nCreak; k++) { const r = allRooms[Math.floor(rnd() * allRooms.length)]; const p = spotIn(r, 24, used); if (p) { creaks.push({ id: k, x: p.x - 22, y: p.y - 22, w: 44, h: 44 }); used.push(creaks[creaks.length - 1]); } }
    for (let k = 0; k < nWeb; k++) {
      const r = allRooms[Math.floor(rnd() * allRooms.length)];
      const p = spotIn(r, 28, used);
      if (p) { webs.push({ id: k, x: p.x - 28, y: p.y - 28, w: 56, h: 56 }); used.push(webs[webs.length - 1]); }
    }

    // Petit manoir : dehors, un parking vide ; pas de lustres, d'interrupteurs ni de pièges.
    if (opts.small) {
      garden.length = 0; deco.length = 0; switches.length = 0; creaks.length = 0; webs.length = 0;
      for (const r of allRooms) delete r.lamp;
    }
    const m = {
      parking: !!opts.small, seed, w: W, h: H, gx, gy, walls, doors, rooms: allRooms, furniture, garden, windows, portals, switches, creaks, webs,
      manorRect, caveRect, gardenRect, gardenParts: [front, sideR], deco,
    };
    m.rects = walls.concat(furniture, garden);   // ce qui bloque toujours (les portes fermées s'ajoutent)
    m.rects.forEach((r, i) => (r.i = i));
    m.nav = navGrid(m);
    // Pas d'escalier utilisable (la cave serait inaccessible) : on tire un autre manoir.
    if (!m.portals.some((p) => p.kind === "stairs")) return M.build((seed + 7919) >>> 0, nPlayers, opts);
    return m;
  };

  // Les cachettes (La Nuit du Tueur) : devant chaque armoire, lit, buffet, commode ou casier posé contre un mur.
  M.HIDE = ["armoire", "lit", "buffet", "commode", "casier"];
  M.hideSpots = function (m) {
    const out = [];
    for (const f of m.furniture) {
      if (!M.HIDE.includes(f.name)) continue;
      const n = [[0, 1], [-1, 0], [0, -1], [1, 0]][f.side];
      const depth = f.side % 2 === 0 ? f.h : f.w;
      const x = f.x + f.w / 2 + n[0] * (depth / 2 + 22), y = f.y + f.h / 2 + n[1] * (depth / 2 + 22);
      if (m.nav && !m.nav.free[M.cellOf(m.nav, x, y)]) continue;
      out.push({ id: out.length, x, y, f });
    }
    return out;
  };

  // Zone d'un point : "cave", "manoir" ou "jardin".
  M.zoneOf = (m, x, y) => (inRect(x, y, m.caveRect) ? "cave" : inRect(x, y, m.manorRect) ? "manoir" : "jardin");
  // Sous la lune ? (jardin, ou rayon de lune d'une fenêtre)
  M.moonAt = (m, x, y) => M.zoneOf(m, x, y) === "jardin" || m.windows.some((w) => inRect(x, y, w.patch));
  // La pièce d'un point (ou null).
  M.roomAt = (m, x, y) => m.rooms.find((r) => x >= r.x - 2 && x <= r.x + r.w + 2 && y >= r.y - 2 && y <= r.y + r.h + 2) || null;

  // ===================================================================
  //  GRILLE DE NAVIGATION (bots) : 1 = on peut marcher. Les portes comptent
  //  comme ouvertes ; les escaliers et passages secrets relient deux cases.
  // ===================================================================
  function navGrid(m) {
    const N = M.NAV, cols = Math.ceil(m.w / N), rows = Math.ceil(m.h / N);
    const free = new Uint8Array(cols * rows);
    const R = 17;
    // Les obstacles par paquets de 200 px (sinon c'est long).
    const B = 200, bc = Math.ceil(m.w / B), br = Math.ceil(m.h / B);
    const bk = Array.from({ length: bc * br }, () => []);
    for (const o of m.rects) for (let r = Math.max(0, Math.floor((o.y - 30) / B)); r <= Math.min(br - 1, Math.floor((o.y + o.h + 30) / B)); r++)
      for (let q = Math.max(0, Math.floor((o.x - 30) / B)); q <= Math.min(bc - 1, Math.floor((o.x + o.w + 30) / B)); q++) bk[r * bc + q].push(o);
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      const x = q * N + N / 2, y = r * N + N / 2;
      let ok = true;
      for (const o of bk[Math.floor(y / B) * bc + Math.floor(x / B)] || []) {
        const qx = Math.max(o.x, Math.min(x, o.x + o.w)), qy = Math.max(o.y, Math.min(y, o.y + o.h));
        if ((x - qx) ** 2 + (y - qy) ** 2 < R * R) { ok = false; break; }
      }
      free[r * cols + q] = ok ? 1 : 0;
    }
    const nav = { cols, rows, free, links: new Map() };
    // (un passage dont la sortie tombe sur un meuble est retiré)
    const near = (x, y) => { const c = M.centerOf(nav, M.nearestFree(nav, M.cellOf(nav, x, y))); return Math.hypot(c.x - x, c.y - y) <= 30; };
    m.portals = m.portals.filter((p) => near(p.a.ex, p.a.ey) && near(p.b.ex, p.b.ey) && near(p.a.x, p.a.y) && near(p.b.x, p.b.y));
    for (const p of m.portals) {
      const a = M.nearestFree(nav, M.cellOf(nav, p.a.x, p.a.y)), b = M.nearestFree(nav, M.cellOf(nav, p.b.x, p.b.y));
      nav.links.set(a, b); nav.links.set(b, a);
    }
    const r0 = m.rooms[0];
    const start = M.nearestFree(nav, M.cellOf(nav, r0.x + r0.w / 2, r0.y + r0.h / 2));
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

  // Distance (en cases) de chaque case vers les cases de départ (escaliers et passages compris).
  M.field = function (nav, sources) {
    const dist = new Int16Array(nav.cols * nav.rows).fill(-1);
    const queue = new Int32Array(nav.cols * nav.rows);
    let head = 0, tail = 0;
    for (const s of sources) if (s >= 0 && dist[s] < 0 && nav.free[s]) { dist[s] = 0; queue[tail++] = s; }
    while (head < tail) {
      const c = queue[head++], q = c % nav.cols, d = dist[c] + 1;
      const next = [q > 0 ? c - 1 : -1, q < nav.cols - 1 ? c + 1 : -1, c - nav.cols, c + nav.cols];
      const l = nav.links.get(c);
      if (l !== undefined) next.push(l);
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
  // (On ne « saute » pas par un escalier : on s'arrête dessus, et c'est le jeu qui téléporte.)
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
  //  LUMIÈRE ET REGARD : les murs (et les portes fermées) les arrêtent.
  // ===================================================================
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
  // Ce qui arrête la lumière : les murs + les portes fermées (closed : liste de portes).
  M.blockers = (m, closed = []) => m.walls.concat(closed);
  M.los = function (blk, ax, ay, bx, by) {
    for (const w of blk) if (rayRect(ax, ay, bx - ax, by - ay, w) < 1) return false;
    return true;
  };
  // Le point (x, y) est-il dans le cône (portée R, demi-angle half) vu depuis (hx, hy) vers l'angle a ?
  M.inCone = function (blk, hx, hy, a, x, y, R = M.LAMP_RANGE, half = M.LAMP_HALF, pad = 0) {
    const dx = x - hx, dy = y - hy, d = Math.hypot(dx, dy);
    if (d > R + pad) return false;
    if (d > pad + 4) {
      const diff = Math.atan2(Math.sin(Math.atan2(dy, dx) - a), Math.cos(Math.atan2(dy, dx) - a));
      if (Math.abs(diff) > half + Math.atan2(pad, d)) return false;
    }
    return M.los(blk, hx, hy, x, y);
  };
  // Le contour du cône (arrêté par les murs) : une liste de points.
  M.cone = function (blk, hx, hy, a, R = M.LAMP_RANGE, half = M.LAMP_HALF, n = 36) {
    const pts = [{ x: hx, y: hy }];
    const near = blk.filter((w) => w.x < hx + R && w.x + w.w > hx - R && w.y < hy + R && w.y + w.h > hy - R);
    for (let k = 0; k <= n; k++) {
      const ang = a - half + (2 * half * k) / n;
      const dx = Math.cos(ang) * R, dy = Math.sin(ang) * R;
      let t = 1;
      for (const w of near) { const tt = rayRect(hx, hy, dx, dy, w); if (tt < t) t = tt; }
      pts.push({ x: hx + dx * t, y: hy + dy * t });
    }
    return pts;
  };

  root.Manoir = M;
})(typeof window !== "undefined" ? window : globalThis);
