// ===================================================================
//  LA TOUR — La tour + la physique du perso (partagé serveur + navigateur)
//  Un labyrinthe vertical sans fin tiré d'une seed (le même pour tout le monde).
//  Chaque étage tire son type (jamais deux fois de suite le même) :
//  - plusieurs routes au choix, ou un PASSAGE UNIQUE (un seul zigzag ou un seul puits) ;
//  - une salle de SAUTS (des morceaux du temple qui dépassent des murs, sauts simples) ;
//  - une salle de DOUBLE SAUT (pierre polie : pas de saut mural, il faut le double saut).
//  Largeurs des puits, des cheminées, des couloirs et des salles : tirées au hasard.
//  Le PUITS : tout droit, au saut mural, avec des piques (rapide, risqué).
//  Le ZIGZAG : plusieurs montées et couloirs, plus long (lent, sûr).
//  Un pique ne tue pas : il sonne 0,5 s.
//  La lave monte depuis le bas.
//  Le serveur et le navigateur font EXACTEMENT les mêmes calculs.
//  y = hauteur (0 = le sol, vers le haut), x = de 0 à W.
//    globalThis.Tower
// ===================================================================

(function (root) {
  const P = {};
  P.TICK = 1 / 30;
  P.SUB = 2;                 // 2 petits pas par calcul (on ne traverse rien)
  P.TILE = 40;               // une case du labyrinthe
  P.COLS = 28;               // largeur de la tour (en cases)
  P.W = P.TILE * P.COLS;
  P.STUN = 0.5;              // un pique n'élimine pas : il sonne 0,5 s…
  P.SAFE = 1;                // … puis on ne peut pas être re-sonné pendant 1 s
  P.K = { LEFT: 1, RIGHT: 2, JUMP: 4, DOWN: 8 };
  P.PW = 26;                 // largeur du perso
  P.H_STAND = 46, P.H_LOW = 26;
  P.RUN = 340, P.CROUCH = 190;
  P.ACC_G = 2800, P.ACC_A = 1700;
  P.JUMP_V = 760, P.G = 2200, P.G_HOLD = 1300, P.HOLD = 0.18, P.G_DOWN = 3900;
  P.MAX_FALL = 1000;
  P.WALL_SLIDE = 120, P.WJ_V = 800, P.WJ_X = 380, P.WJ_LOCK = 0.14;
  P.DJ_V = 680;              // le double saut (une fois en l'air ; revient au sol et après un saut mural)
  P.COYOTE = 0.08, P.BUFFER = 0.1;
  P.CRUMBLE = 0.6, P.CRUMBLE_BACK = 1.5;   // s'effrite 0,6 s après ; revient 1,5 s plus tard (pour ceux qui sont derrière)
  const BK = 200;            // hauteur d'une tranche de recherche

  // La lave : démarre sous le sol, monte de plus en plus vite.
  P.lavaAt = (t) => -400 + 26 * t + 1.0 * t * t;

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Position d'une plateforme à l'instant t (celles qui bougent vont de gauche à droite).
  P.platX = (p, t) => (p.amp ? p.x + Math.sin(t * p.sp + p.ph) * p.amp : p.x);
  // Une plateforme qui s'effrite est-elle là ?
  P.platOn = (c, p, t) => {
    if (p.kind !== "crumble") return true;
    const t0 = c.crumbles[p.id];
    return t0 === undefined || t < t0 + P.CRUMBLE || t >= t0 + P.CRUMBLE + P.CRUMBLE_BACK;
  };

  // ===================================================================
  //  LE LABYRINTHE (généré étage par étage, toujours dans le même ordre)
  // ===================================================================
  P.tower = function (seed) {
    const rnd = seeded(seed);
    const T = P.TILE, C = P.COLS, R = P.FROWS;
    const c = { seed, plats: [], solids: [], spikes: [], secs: [], rows: [], crumbles: {}, bk: new Map(), top: 0 };
    const slot = (b) => { let o = c.bk.get(b); if (!o) { o = { p: [], s: [], k: [] }; c.bk.set(b, o); } return o; };
    const addPlat = (o) => { o.id = c.plats.length; o.h = 12; c.plats.push(o); slot(Math.floor(o.y / BK)).p.push(o); return o; };
    const addBox = (list, key, o) => { list.push(o); for (let b = Math.floor(o.y / BK) - 1; b <= Math.floor((o.y + o.h) / BK) + 1; b++) slot(b)[key].push(o); return o; };
    const solid = (o) => addBox(c.solids, "s", o);
    const spike = (o) => addBox(c.spikes, "k", o);
    c.slot = slot;
    addPlat({ x: 0, y: 0, w: P.W, kind: "fix", ground: true });

    const irand = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
    const mix = (arr) => { const q = [...arr]; for (let i = q.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [q[i], q[j]] = [q[j], q[i]]; } return q; };

    // Le type d'étage : tiré dans un sac, jamais deux fois de suite le même.
    let bag = [], lastKind = "multi";
    const nextKind = () => {
      let i = bag.findIndex((k) => k !== lastKind);
      if (i < 0) { bag = mix(["multi", "multi", "goulet", "puits", "sauts", "double"]); i = bag.findIndex((k) => k !== lastKind); }
      lastKind = bag.splice(i, 1)[0];
      return lastKind;
    };

    function floor(n) {
      const y0 = c.top;
      const type = n === 0 ? "multi" : nextKind();
      const R = irand(21, 29);                         // la hauteur de cet étage
      const HALL = 3;                                  // le hall
      const g = Array.from({ length: R }, (_, r) => new Uint8Array(C).fill(r < HALL ? 0 : 1));
      for (let r = 0; r < R; r++) g[r][0] = g[r][C - 1] = 1;
      const carve = (c0, c1, r0, r1) => { for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) g[r][q] = 0; };
      const top = R * T;
      // Un seul rebord par route : l'arrivée à l'étage du dessus.
      const caps = [];
      const cap = (col, risky, w = 3) => { caps.push(col * T); addPlat({ x: col * T, y: y0 + top, w: w * T, kind: !risky && rnd() < 0.3 ? "crumble" : "fix" }); };
      // Plafond bas : il faut passer accroupi.
      const low = (x, yr, w, h) => solid({ x, y: y0 + yr + 34, w, h, low: true });
      const routes = [];

      // Le découpage en routes : largeurs et ordre au hasard.
      // p = puits (3 cases), z = zigzag, s = corniches à sauts simples, d = salle du double saut (10 cases ou plus).
      const MULTI = [["p", "z", "z"], ["p", "z"], ["z", "z"], ["p", "p", "z"], ["p", "z", "s"], ["z", "s"], ["p", "s"], ["s", "s"]];
      const plan = type === "goulet" ? ["z"] : type === "puits" ? ["p"] : type === "sauts" ? ["s"] : type === "double" ? ["d"] : mix(MULTI[Math.floor(rnd() * MULTI.length)]);
      const pw = plan.map((k) => (k === "p" ? irand(2, 5) : 0));      // la largeur de chaque puits, du très serré au large
      const np = plan.filter((k) => k === "p").length, nz = plan.length - np;
      let room = C - 2 - (plan.length - 1) - pw.reduce((a, b) => a + b, 0);   // la place laissée aux zigzags et aux salles
      const regions = [];
      let zLeft = nz, at = 1;
      if (plan.length === 1) {
        // Un seul passage : il prend une largeur au hasard, n'importe où dans l'étage.
        const w = plan[0] === "p" ? pw[0] : irand(12, C - 2);
        at = irand(1, C - 1 - w);
        regions.push([plan[0], at, at + w - 1]);
      } else plan.forEach((kind, i) => {
        let w = pw[i];
        if (kind !== "p") { w = zLeft === 1 ? room : irand(10, room - 10 * (zLeft - 1)); room -= w; zLeft--; }
        regions.push([kind, at, at + w - 1]);
        at += w + 1;
      });

      // Une salle ouverte : des morceaux du temple dépassent des murs, à gauche puis à droite.
      // On monte de l'un à l'autre en les contournant ; la sortie est un trou dans le plafond.
      // Salle du double saut : 5 ou 6 cases entre deux morceaux (un saut simple monte à 4,4 cases),
      // en pierre polie (case 2) : pas de saut mural possible, il faut le double saut.
      function chamber(kind, a0, b0) {
        const dbl = kind === "d", cell = dbl ? 2 : 1, maxRise = dbl ? 6 : 4, minRise = dbl ? 5 : 3;
        carve(a0, b0, HALL, R - 2);
        if (dbl) {
          for (let r = HALL; r < R; r++) g[r][a0 - 1] = g[r][b0 + 1] = 2;
          for (let q = a0; q <= b0; q++) g[R - 1][q] = 2;
        }
        const way = [];
        // Toutes les hauteurs sont tirées d'avance, pour tomber pile sur la sortie (jamais de petit morceau qui bouche le passage).
        const can = (n) => n === 0 || (n >= minRise && (can(n - minRise) || can(n - maxRise)));
        const rises = [];
        for (let rem = R; rem > 0;) {
          const a = rises.length ? irand(minRise, maxRise) : maxRise - (dbl ? irand(0, 1) : 0), b = a === minRise ? maxRise : minRise;
          const o = can(rem - a) ? a : b;
          rises.push(o); rem -= o;
        }
        rises.pop();                                    // la dernière hauteur : celle de la sortie
        let cur = null, r = 0;
        for (const rise of rises) {
          const th = rise >= 4 ? 2 : 1, canOver = cur && rise - th >= 2, maxGap = rise >= 4 ? 2 : 3;
          const left = cur ? cur.side > 0 : rnd() < 0.5;        // accroché au mur de gauche, sinon de droite
          let t, from, land;
          if (left) {
            const u = cur ? cur.t : b0;
            const lo = cur ? Math.max(a0 + 1, u - 1 - maxGap) : a0 + 1, hi = cur ? (canOver ? b0 - 2 : u - 3) : b0 - 3;
            t = irand(lo, Math.max(lo, hi));
            if (cur && (t === u - 1 || t === u - 2)) t = u - 3;       // (un vrai trou d'au moins 2 cases, ou un vrai passage)
            t = Math.max(a0 + 1, Math.min(b0 - 2, t));
            land = (t + 1) * T - 30;
            from = cur && t < u ? u * T + 14 : (t + 1) * T + 30;
          } else {
            const u = cur ? cur.t : a0;
            const lo = cur ? (canOver ? a0 + 2 : u + 3) : a0 + 3, hi = cur ? Math.min(b0 - 1, u + 1 + maxGap) : b0 - 1;
            t = irand(Math.min(lo, hi), hi);
            if (cur && (t === u + 1 || t === u + 2)) t = u + 3;
            t = Math.max(a0 + 2, Math.min(b0 - 1, t));
            land = t * T + 30;
            from = cur && t > u ? (u + 1) * T - 14 : t * T - 30;
          }
          r += rise;
          for (let rr = r - th; rr < r; rr++) for (let q = left ? a0 : t; q <= (left ? t : b0); q++) g[rr][q] = cell;
          if (!way.length) way.push({ x: from, y: y0, tol: 30 });
          way.push({ x: land, from, edge: left ? (t + 1) * T + 15 : t * T - 15, y: y0 + r * T, hop: true, tol: 2000, dbl: dbl && rise >= 5 });
          cur = { side: left ? -1 : 1, t };
        }
        // La sortie, juste au-dessus du dernier morceau.
        const hc = cur.side < 0 ? Math.max(a0, cur.t - 2 - irand(0, 3)) : Math.min(b0 - 2, cur.t + irand(0, 3));
        carve(hc, hc + 2, R - 1, R - 1);
        cap(hc, dbl);
        way.push({ x: (hc + 1.5) * T, from: (hc + 1.5) * T, edge: (hc + 1.5) * T, y: y0 + top, hop: true, tol: 40, dbl });
        routes.push({ kind: dbl ? "double" : "sauts", way });
      }

      for (const [kind, a0, b0] of regions) {
        if (kind === "s" || kind === "d") { chamber(kind, a0, b0); continue; }
        if (kind === "p") {
          // Le puits : tout droit jusqu'à l'étage du dessus, quelques piques seuls sur les murs.
          carve(a0, b0, HALL, R - 1);
          const left = a0 * T, right = (b0 + 1) * T;
          let side = rnd() < 0.5 ? 1 : -1;
          const dense = rnd() < 0.4;                       // certains puits sont bien plus méchants
          for (let yr = 300 + irand(0, 80); yr < top - 230; yr += dense ? irand(140, 210) : irand(220, 340)) {
            if (rnd() < 0.8) spike({ x: side > 0 ? left : right - 14, y: y0 + yr, w: 14, h: 22, faces: side });
            side = rnd() < 0.7 ? -side : side;
          }
          cap(a0, true, b0 - a0 + 1);
          const ws = rnd() < 0.5 ? -1 : 1;
          routes.push({ kind: "puits", way: [{ x: ws < 0 ? left + 22 : right - 22, y: y0, tol: 10 }, { x: (left + right) / 2, y: y0 + top, shaft: true, side: ws }] });
          continue;
        }
        // Le zigzag : des montées et des couloirs tirés au hasard jusqu'en haut.
        const way = [];
        const cw = Math.min(irand(2, 4), b0 - a0 + 1 - 7), CH = irand(2, 4);   // la largeur des cheminées, la hauteur des couloirs : serrés ou larges
        // (on part d'un endroit d'où une autre cheminée est possible, au moins 7 cases plus loin)
        const starts = [];
        for (let q = a0; q <= b0 - cw + 1; q++) if (q - a0 >= 7 || b0 - cw + 1 - q >= 7) starts.push(q);
        let col = starts[Math.floor(rnd() * starts.length)], f = 0;   // la cheminée où on est, et son sol (rangée)
        carve(col, col + cw - 1, HALL, HALL);
        for (;;) {
          const F = f + (f === 0 ? irand(6, 9) : Math.max(CH + 3, irand(5, 8)));   // (assez haut pour ne pas trouer le sol du couloir)
          if (R - F < 7) break;
          // Le prochain couloir : on va à une autre cheminée, au moins 7 cases plus loin.
          const opts = [];
          for (let q = a0; q <= b0 - cw + 1; q++) if (Math.abs(q - col) >= 7) opts.push(q);
          const next = opts[Math.floor(rnd() * opts.length)];
          const dir = next > col ? 1 : -1;
          carve(col, col + cw - 1, Math.max(HALL, f), F + CH + 1);               // la montée (avec une entrée de couloir plus haute)
          carve(dir > 0 ? col + cw : col - 2, dir > 0 ? col + cw + 1 : col - 1, F + CH, F + CH + 1);
          carve(Math.min(col, next), Math.max(col, next) + cw - 1, F, F + CH - 1);    // le couloir
          const wall = dir > 0 ? col * T + 22 : (col + cw) * T - 22;
          way.push({ x: wall, y: y0 + f * T, tol: 10 }, { x: wall, y: y0 + F * T, shaft: true, side: -dir, exit: dir });
          // Dans le couloir : un plafond bas, après 2 cases de sol (on ne s'accroupit pas en l'air).
          const in0 = dir > 0 ? col + cw + 2 : next + cw, in1 = dir > 0 ? next - 1 : col - 3;
          if (in1 >= in0) {
            const w = irand(1, Math.min(4, in1 - in0 + 1)), x = irand(in0, in1 - w + 1);
            if (rnd() < 0.85) low(x * T, F * T, w * T, CH * T - 34);
            else spike({ x: x * T + 10, y: y0 + F * T, w: 18, h: 16, up: true });
          }
          col = next; f = F;
        }
        carve(col, col + cw - 1, Math.max(HALL, f), R - 1);
        cap(col, false, cw);
        const ws = rnd() < 0.5 ? -1 : 1, wx = ws < 0 ? col * T + 22 : (col + cw) * T - 22;
        way.push({ x: wx, y: y0 + f * T, tol: 10 }, { x: wx, y: y0 + top, shaft: true, side: ws });
        routes.push({ kind: "zigzag", way, cw, CH });
      }
      // Le hall : bas de plafond par endroits (loin des entrées).
      if (n > 0) {
        const hh = HALL * T - 34;
        for (let k = 0, m = irand(1, 3); k < m; k++) {
          const w = irand(2, 4), x = irand(2, C - 2 - w) * T;
          // (ni au-dessus d'une entrée de route, ni au-dessus d'une sortie de l'étage d'en dessous)
          const under = c.secs[n - 1].caps;
          // (ni dans une salle ouverte : il flotterait)
          if (regions.some(([kd, a, b]) => (kd === "s" || kd === "d") && x + w * T > a * T - 40 && x < (b + 1) * T + 40)) continue;
          if (routes.every((q) => q.way[0].x < x - 70 || q.way[0].x > x + w * T + 70) && under.every((cx) => x + w * T < cx - 40 || x > cx + 3 * T + 40) && !c.solids.some((o) => o.low && o.y === y0 + 34 && Math.abs(o.x - x) < 5 * T)) low(x, 0, w * T, hh);
        }
      }
      // Les murs : des rectangles (pour la physique) + les cases (pour le dessin).
      const used = g.map((row) => new Uint8Array(row.length));
      for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
        const v = g[r][q];
        if (!v || used[r][q]) continue;
        let w = 0;
        while (q + w < C && g[r][q + w] === v && !used[r][q + w]) w++;
        let h = 1;
        up: while (r + h < R) { for (let k = 0; k < w; k++) if (g[r + h][q + k] !== v || used[r + h][q + k]) break up; h++; }
        for (let j = r; j < r + h; j++) for (let k = q; k < q + w; k++) used[j][k] = 1;
        solid({ x: q * T, y: y0 + r * T, w: w * T, h: h * T, slick: v === 2 });
      }
      for (let r = 0; r < R; r++) c.rows.push(g[r]);
      c.secs.push({ y0, h: top, routes, caps, type });
      c.top = y0 + top;
    }
    c.ensure = (y) => { while (c.top < y + 2000) floor(c.secs.length); };
    c.ensure(0);
    return c;
  };
  // L'empreinte d'une tour : le navigateur et le serveur doivent avoir exactement la même.
  P.sig = (c) => { let h = 7; for (const s of c.solids.slice(0, 80)) h = (Math.imul(h, 31) + s.x + s.y * 3 + s.w * 5 + s.h * 7 + (s.slick ? 1 : 0)) | 0; return h; };
  // Cette case est-elle un mur ? (sous le sol : oui)
  P.tileAt = (c, row, col) => (row < 0 || col < 0 || col >= P.COLS ? 1 : c.rows[row] ? c.rows[row][col] : 1);

  // ===================================================================
  //  LE PERSO
  // ===================================================================
  P.newRunner = (x) => ({ x, y: 0, vx: 0, vy: 0, t: 0, stun: 0, safe: 0, air: false, crouch: false, wall: 0, lastW: 0, hold: 0, coy: 0, buf: 0, lock: 0, on: 0, pk: 0, face: 1, alive: true, best: 0, dj: 1 });
  P.copy = (r) => ({ x: r.x, y: r.y, vx: r.vx, vy: r.vy, t: r.t, stun: r.stun, safe: r.safe, air: r.air, crouch: r.crouch, wall: r.wall, lastW: r.lastW, hold: r.hold, coy: r.coy, buf: r.buf, lock: r.lock, on: r.on, pk: r.pk, face: r.face, alive: r.alive, best: r.best, dj: r.dj });
  P.height = (r) => (r.crouch ? P.H_LOW : P.H_STAND);

  const HW = P.PW / 2;
  const near = (c, y0, y1, key) => {
    const out = [];
    for (let b = Math.floor(y0 / BK); b <= Math.floor(y1 / BK); b++) { const s = c.bk.get(b); if (s) for (const o of s[key]) if (!out.includes(o)) out.push(o); }
    return out;
  };
  const hits = (x, y, h, s) => x + HW > s.x && x - HW < s.x + s.w && y + h > s.y && y < s.y + s.h;
  // Touche-t-on un mur en se décalant de d ?
  function wallAt(r, c, d) {
    if (r.x + d - HW <= 0 || r.x + d + HW >= P.W) return true;
    const h = P.height(r);
    for (const s of near(c, r.y - 10, r.y + h + 10, "s")) if (!s.slick && hits(r.x + d, r.y, h, s)) return true;   // (pierre polie : pas de prise)
    return false;
  }
  function blockedAbove(r, c) {
    for (const s of near(c, r.y, r.y + P.H_STAND, "s")) if (hits(r.x, r.y, P.H_STAND, s)) return true;
    return false;
  }
  // Ce qui nous porte (plateforme ou dessus d'un bloc), ou null.
  function support(r, c) {
    for (const p of near(c, r.y - 2, r.y + 2, "p")) {
      if (Math.abs(p.y - r.y) > 0.5 || !P.platOn(c, p, r.t)) continue;
      const px = P.platX(p, r.t);
      if (r.x + HW > px && r.x - HW < px + p.w) return p;
    }
    for (const s of near(c, r.y - 2, r.y + 2, "s")) if (Math.abs(s.y + s.h - r.y) < 0.5 && r.x + HW > s.x && r.x - HW < s.x + s.w) return s;
    return null;
  }

  // Un calcul (1/30 s). Renvoie "lave" si le perso vient d'être éliminé, "pique" s'il vient d'être sonné, sinon null.
  P.step = function (r, k, c) {
    if (!r.alive) return null;
    const dt = P.TICK;
    const t0 = r.t;
    r.t += dt;
    c.ensure(r.y);
    // Sonné : plus aucune commande (on retombe si on était en l'air).
    r.safe = Math.max(0, r.safe - dt);
    if (r.stun > 0) { r.stun = Math.max(0, r.stun - dt); k = 0; if (r.stun === 0) r.safe = P.SAFE; }
    const jump = k & P.K.JUMP, down = k & P.K.DOWN;
    const dir = (k & P.K.RIGHT ? 1 : 0) - (k & P.K.LEFT ? 1 : 0);
    if (dir) r.face = dir;
    r.buf = jump && !(r.pk & P.K.JUMP) ? P.BUFFER : Math.max(0, r.buf - dt);
    // S'accroupir (on reste accroupi tant qu'il y a un plafond au-dessus).
    r.crouch = !r.air && (down || (r.crouch && blockedAbove(r, c)));
    // Courir.
    if (r.lock > 0) r.lock = Math.max(0, r.lock - dt);
    else {
      const want = dir * (r.crouch ? P.CROUCH : P.RUN), a = (r.air ? P.ACC_A : P.ACC_G) * dt;
      r.vx += Math.max(-a, Math.min(a, want - r.vx));
    }
    // Porté par une plateforme qui bouge.
    if (!r.air && r.on >= 0) { const p = c.plats[r.on]; if (p && p.amp) r.x += P.platX(p, r.t) - P.platX(p, t0); }
    // Sauter (au sol, juste après avoir quitté le bord, contre un mur, ou double saut en l'air).
    if (r.buf > 0) {
      if ((!r.air || r.coy > 0) && !(r.crouch && blockedAbove(r, c))) {
        r.vy = P.JUMP_V; r.hold = P.HOLD; r.air = true; r.on = -1; r.coy = 0; r.buf = 0; r.crouch = false;
      } else if (r.air && r.wall && r.wall !== r.lastW) {
        r.vy = P.WJ_V; r.vx = -r.wall * P.WJ_X; r.lock = P.WJ_LOCK; r.lastW = r.wall; r.hold = 0; r.buf = 0; r.face = -r.wall; r.dj = 1;
      } else if (r.air && r.dj > 0) {
        r.vy = P.DJ_V; r.dj = 0; r.hold = 0; r.buf = 0;
      }
    }
    // Gravité.
    if (r.air) {
      const g = down ? P.G_DOWN : jump && r.hold > 0 && r.vy > 0 ? P.G_HOLD : P.G;
      r.hold = Math.max(0, r.hold - dt);
      r.coy = Math.max(0, r.coy - dt);
      r.vy -= g * dt;
      if (r.wall && r.vy < 0 && dir === r.wall) r.vy = Math.max(r.vy, -P.WALL_SLIDE);
      r.vy = Math.max(r.vy, -P.MAX_FALL);
    }
    // Déplacement, en petits pas.
    const sd = dt / P.SUB;
    for (let i = 0; i < P.SUB; i++) {
      const h = P.height(r);
      // Horizontal.
      let nx = r.x + r.vx * sd;
      if (nx - HW < 0) { nx = HW; r.vx = 0; }
      if (nx + HW > P.W) { nx = P.W - HW; r.vx = 0; }
      for (const s of near(c, r.y - 4, r.y + h + 4, "s")) {
        if (!hits(nx, r.y, h, s)) continue;
        nx = r.vx > 0 ? s.x - HW - 0.01 : s.x + s.w + HW + 0.01;
        r.vx = 0;
      }
      r.x = nx;
      // Vertical.
      if (!r.air) continue;
      let ny = r.y + r.vy * sd;
      if (r.vy <= 0) {
        for (const p of near(c, ny - 4, r.y + 4, "p")) {
          if (r.y < p.y - 0.01 || ny > p.y || !P.platOn(c, p, r.t)) continue;
          const px = P.platX(p, r.t);
          if (r.x + HW <= px || r.x - HW >= px + p.w) continue;
          ny = p.y; r.vy = 0; r.air = false; r.on = p.id; r.lastW = 0; r.wall = 0;
          if (p.kind === "crumble") { const c0 = c.crumbles[p.id]; if (c0 === undefined || r.t >= c0 + P.CRUMBLE + P.CRUMBLE_BACK) c.crumbles[p.id] = r.t; }
          break;
        }
      }
      for (const s of near(c, ny - 4, ny + h + 4, "s")) {
        if (!hits(r.x, ny, h, s)) continue;
        if (r.vy > 0) { ny = s.y - h - 0.01; r.vy = 0; r.hold = 0; }
        else { ny = s.y + s.h; r.vy = 0; r.air = false; r.on = -1; r.lastW = 0; r.wall = 0; }
      }
      r.y = ny;
    }
    // Au sol : encore quelque chose sous les pieds ?
    if (!r.air) {
      const sup = support(r, c);
      if (!sup) { r.air = true; r.coy = P.COYOTE; r.on = -1; r.crouch = r.crouch && blockedAbove(r, c); }
      else if (sup.kind === "crumble") { const c0 = c.crumbles[sup.id]; if (c0 === undefined || r.t >= c0 + P.CRUMBLE + P.CRUMBLE_BACK) c.crumbles[sup.id] = r.t; }
    }
    if (!r.air) r.dj = 1;
    r.wall = r.air ? (wallAt(r, c, -2) ? -1 : wallAt(r, c, 2) ? 1 : 0) : 0;
    r.pk = k;
    r.best = Math.max(r.best, r.y);
    // Piques, lave.
    const h = P.height(r);
    let hit = false;
    for (const s of near(c, r.y - 4, r.y + h + 4, "k")) {
      if (r.stun === 0 && r.safe === 0 && r.x + HW - 3 > s.x && r.x - HW + 3 < s.x + s.w && r.y + h - 3 > s.y && r.y + 2 < s.y + s.h) { hit = true; break; }
    }
    if (r.y < P.lavaAt(r.t)) { r.alive = false; return "lave"; }
    if (hit) { r.stun = P.STUN; r.vx = 0; r.lock = 0; r.hold = 0; r.buf = 0; return "pique"; }
    return null;
  };

  // ===================================================================
  //  BOT : il choisit une route à chaque étage et la suit, point par point.
  //  ai = { sec, route, i, hold, bold (goût du risque), delay (hésitation au saut mural), wait }
  // ===================================================================
  P.newBot = (bold, delay) => ({ sec: -1, route: null, i: 0, hold: 0, bold, delay, wait: 0 });
  P.bot = function (r, ai, c, rnd = Math.random) {
    const K = P.K;
    c.ensure(r.y);
    if (r.stun > 0) return 0;
    let si = c.secs.length - 1;
    while (si > 0 && c.secs[si].y0 > r.y + 2) si--;
    if (!r.air && ai.sec !== si && c.secs[si]) {
      ai.sec = si;
      if (!ai.forced) {
        const rs = c.secs[si].routes, pz = rs.filter((q) => q.kind === "puits"), zz = rs.filter((q) => q.kind !== "puits");
        ai.route = (rnd() < ai.bold || !zz.length) && pz.length ? pz[0] : zz.sort((a, b) => Math.abs(a.way[0].x - r.x) - Math.abs(b.way[0].x - r.x))[0];
      }
    }
    const R = ai.route;
    if (!R) return 0;
    const way = R.way;
    if (!r.air) {
      let j = 0;
      for (let k = 0; k < way.length; k++) if (way[k].y <= r.y + 4) j = k;
      const p = way[j];
      ai.i = Math.abs(r.x - p.x) < (p.tol || 20) && Math.abs(r.y - p.y) < 4 && j + 1 < way.length ? j + 1 : j;
    }
    const w = way[ai.i];
    const dirTo = (x) => (Math.abs(x - r.x) < 6 ? 0 : x > r.x ? K.RIGHT : K.LEFT);
    const noJump = r.pk & K.JUMP;
    if (w.hop) {
      // Une corniche : il prend son élan jusqu'au bord de la sienne, saute, et double saute au sommet si besoin.
      // (en l'air : il reste à côté du morceau de temple tant qu'il n'est pas plus haut que lui)
      const dk = dirTo(r.y > w.y - 6 ? w.x : w.edge);
      if (r.air) {
        ai.hold--;
        if (r.dj > 0 && !noJump && r.y < w.y + 4 && r.vy < (w.dbl ? 140 : -60)) { ai.hold = 0; return dk | K.JUMP; }   // (aussi pour se rattraper)
        return dk | (ai.hold > 0 && r.vy > 0 ? K.JUMP : 0);
      }
      const tx = w.from;
      if (Math.abs(r.x - tx) > 8) return tx > r.x ? K.RIGHT : K.LEFT;
      if (Math.abs(r.vx) > 120) return 0;                 // il freine : sinon il file sous le morceau d'au-dessus
      ai.hold = 8;
      return dk | (noJump ? 0 : K.JUMP);
    }
    if (w.shaft) {
      // Le puits : on saute sur un mur, puis on rebondit de l'un à l'autre.
      if (!r.air) { ai.hold = 7; ai.floorY = r.y; return noJump ? 0 : K.JUMP; }
      // D'abord tout droit (pour bien entrer dans la cheminée), puis vers le mur.
      if (!r.lastW && !r.wall && r.y < (ai.floorY ?? r.y) + 78) { ai.hold--; return dirTo(way[Math.max(0, ai.i - 1)].x) | (ai.hold > 0 && r.vy > 0 ? K.JUMP : 0); }
      // Au-dessus de l'arrivée : il se laisse retomber dessus.
      if (!w.exit && r.y > w.y + 2) return 0;
      // Assez haut : il sort dans le couloir.
      if (w.exit && r.y > w.y + 2 && (r.lastW === w.side || r.wall === w.exit)) return w.exit > 0 ? K.RIGHT : K.LEFT;
      const d = r.lastW ? (r.lastW < 0 ? K.RIGHT : K.LEFT) : w.side < 0 ? K.LEFT : K.RIGHT;
      if (r.wall && r.lock === 0 && r.wall !== r.lastW && !noJump && r.t >= ai.wait) {
        // Le rebond arrive ~118 px plus haut sur l'autre mur : s'il y a des piques là, il se laisse d'abord glisser.
        const y2 = r.y + 118;
        const danger = near(c, y2 - 80, y2 + 80, "k").some((s) => s.faces === r.wall && y2 < s.y + s.h + 14 && y2 + 46 > s.y - 14);
        const under = near(c, r.y - 70, r.y + 20, "k").some((s) => s.faces === -r.wall && r.y - 40 < s.y + s.h);
        if (!danger || under) { ai.wait = r.t + rnd() * ai.delay; ai.hold = 0; return d | K.JUMP; }
      }
      ai.hold--;
      return (r.wall && r.wall !== r.lastW ? (r.wall < 0 ? K.LEFT : K.RIGHT) : d) | (ai.hold > 0 && r.vy > 0 ? K.JUMP : 0);
    }
    const dk = dirTo(w.x);
    if (r.air) { ai.hold--; return dk | (ai.hold > 0 && r.vy > 0 ? K.JUMP : 0); }
    const dirS = w.x > r.x ? 1 : -1;
    // Plafond bas devant : s'accroupir. Piques au sol devant : sauter.
    for (const s of near(c, r.y, r.y + 60, "s")) {
      if (s.low && s.y < r.y + 50 && s.y > r.y && r.x + dirS * 60 > s.x - 14 && r.x + dirS * 60 < s.x + s.w + 80 && (dirS > 0 ? r.x < s.x + s.w + 14 : r.x > s.x - 14)) return dk | K.DOWN;
    }
    for (const s of near(c, r.y - 2, r.y + 20, "k")) {
      if (s.up && Math.abs(s.y - r.y) < 3 && (dirS > 0 ? s.x - r.x : r.x - s.x - s.w) < 46 && (dirS > 0 ? s.x + s.w > r.x : s.x < r.x)) { ai.hold = 4; return dk | (noJump ? 0 : K.JUMP); }
    }
    if (w.y > r.y + 10) { ai.hold = 8; return dk | (noJump ? 0 : K.JUMP); }
    // Un trou devant (le haut d'un puits) : sauter par-dessus.
    if (dk) {
      const ax = r.x + dirS * 34, col = Math.floor(ax / P.TILE), row = Math.round(r.y / P.TILE) - 1;
      const hole = !P.tileAt(c, row, col) && !near(c, r.y - 2, r.y + 2, "p").some((p) => Math.abs(p.y - r.y) < 1 && ax > p.x && ax < p.x + p.w);
      if (hole) { ai.hold = 6; return dk | (noJump ? 0 : K.JUMP); }
    }
    return dk;
  };

  // Ce qui est visible entre deux hauteurs (pour le dessin).
  P.view = (c, y0, y1) => ({ plats: near(c, y0 - 20, y1 + 20, "p"), solids: near(c, y0, y1, "s"), spikes: near(c, y0, y1, "k") });

  root.Tower = P;
})(typeof window !== "undefined" ? window : globalThis);
