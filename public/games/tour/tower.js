// ===================================================================
//  LA TOUR — La tour + la physique du perso (partagé serveur + navigateur)
//  Un labyrinthe vertical sans fin tiré d'une seed (le même pour tout le monde).
//  Étage après étage : un hall, puis 2 ou 3 routes qui montent à l'étage suivant :
//  - le PUITS : direct, au saut mural, avec des piques sur les murs (rapide, risqué) ;
//  - le ZIGZAG : couloirs et rebords, plus long, presque sans piques (lent, sûr).
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
  P.FROWS = 18;              // hauteur d'un étage (en cases)
  P.FH = P.TILE * P.FROWS;
  P.K = { LEFT: 1, RIGHT: 2, JUMP: 4, DOWN: 8 };
  P.PW = 26;                 // largeur du perso
  P.H_STAND = 46, P.H_LOW = 26;
  P.RUN = 340, P.CROUCH = 190;
  P.ACC_G = 2800, P.ACC_A = 1700;
  P.JUMP_V = 760, P.G = 2200, P.G_HOLD = 1300, P.HOLD = 0.18, P.G_DOWN = 3900;
  P.MAX_FALL = 1000;
  P.WALL_SLIDE = 120, P.WJ_V = 720, P.WJ_X = 380, P.WJ_LOCK = 0.14;
  P.COYOTE = 0.08, P.BUFFER = 0.1;
  P.CRUMBLE = 0.6, P.CRUMBLE_BACK = 1.5;   // s'effrite 0,6 s après ; revient 1,5 s plus tard (pour ceux qui sont derrière)
  const BK = 200;            // hauteur d'une tranche de recherche

  // La lave : démarre sous le sol, monte de plus en plus vite.
  P.lavaAt = (t) => -300 + 30 * t + 1.2 * t * t;

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

    function floor(n) {
      const y0 = n * P.FH;
      const g = Array.from({ length: R }, (_, r) => new Uint8Array(C).fill(r < 4 ? 0 : 1));
      for (let r = 0; r < R; r++) g[r][0] = g[r][C - 1] = 1;
      const carve = (c0, c1, r0, r1) => { for (let r = r0; r <= r1; r++) for (let q = c0; q <= c1; q++) g[r][q] = 0; };
      const ledge = (col, yr, risky) => addPlat({ x: col * T, y: y0 + yr, w: 4 * T, kind: !risky && yr % P.FH !== 0 && yr !== 280 && yr !== 480 && rnd() < 0.2 ? "crumble" : "fix" });
      const routes = [];
      // Où sont les routes : un puits + 2 zigzags.
      const layout = Math.floor(rnd() * 3);
      const regions = layout === 0 ? [["z", 1, 10], ["p", 12, 15], ["z", 17, 26]]
        : layout === 1 ? [["p", 1, 4], ["z", 6, 15], ["z", 17, 26]]
        : [["z", 1, 10], ["z", 12, 21], ["p", 23, 26]];
      for (const [kind, a0, b0] of regions) {
        if (kind === "p") {
          // Le puits : tout droit jusqu'à l'étage du dessus, piques sur les murs.
          carve(a0, b0, 4, R - 1);
          const left = a0 * T, right = (b0 + 1) * T, cx = (left + right) / 2;
          let side = rnd() < 0.5 ? 1 : -1;
          for (let yr = 340; yr < 560; yr += 200 + Math.round(rnd() * 70)) {
            if (rnd() < 0.8) spike({ x: side > 0 ? left : right - 14, y: y0 + yr, w: 14, h: 44, faces: side });
            side = -side;
          }
          ledge(a0, P.FH, true);
          const wallSide = rnd() < 0.5 ? -1 : 1;
          routes.push({ kind: "puits", way: [
            { x: wallSide < 0 ? left + 22 : right - 22, y: y0, tol: 10 },
            { x: cx, y: y0 + P.FH, shaft: true, side: wallSide },
          ] });
        } else {
          // Le zigzag : monter d'un côté, couloir, monter de l'autre, couloir, monter.
          const leftFirst = rnd() < 0.5;
          const A = leftFirst ? a0 : b0 - 3, B = leftFirst ? b0 - 3 : a0;
          carve(A, A + 3, 4, 9); carve(a0, b0, 7, 9); carve(B, B + 3, 7, 14); carve(a0, b0, 12, 14); carve(A, A + 3, 12, R - 1);
          for (const [col, yr] of [[A, 140], [A, 280], [B, 380], [B, 480], [A, 600], [A, P.FH]]) ledge(col, yr, false);
          const cA = (A + 2) * T, cB = (B + 2) * T;
          // Dans les couloirs : un plafond bas (à passer accroupi), ou de rares piques au sol.
          const lo = Math.min(cA, cB) + 2.6 * T, hi = Math.max(cA, cB) - 2.6 * T;
          for (const yr of [280, 480]) {
            const u = rnd(), x = Math.round(lo + rnd() * Math.max(0, hi - lo - 2 * T));
            if (hi - lo < 2 * T) continue;
            if (u < 0.34) solid({ x, y: y0 + yr + 34, w: 2 * T, h: 86, low: true });
            else if (u < 0.42) spike({ x, y: y0 + yr, w: T, h: 16, up: true });
          }
          routes.push({ kind: "zigzag", way: [
            { x: cA, y: y0, tol: 60 }, { x: cA, y: y0 + 140, tol: 60 }, { x: cA, y: y0 + 280, tol: 60 }, { x: cB, y: y0 + 280, tol: 40 },
            { x: cB, y: y0 + 380, tol: 60 }, { x: cB, y: y0 + 480, tol: 60 }, { x: cA, y: y0 + 480, tol: 40 }, { x: cA, y: y0 + 600, tol: 60 }, { x: cA, y: y0 + P.FH, tol: 60 },
          ] });
        }
      }
      // Des passages entre les routes (on peut changer d'avis en route).
      for (let i = 0; i + 1 < regions.length; i++) {
        if (rnd() < 0.55) {
          const r0 = rnd() < 0.5 ? 7 : 12;
          carve(regions[i][2], regions[i + 1][1], r0, r0 + 2);
        }
      }
      // Un plafond bas dans le hall, loin des entrées.
      if (n > 0 && rnd() < 0.6) {
        const x = Math.round(2 * T + rnd() * (P.W - 6 * T));
        if (routes.every((q) => Math.abs(q.way[0].x - x - T) > 130)) solid({ x, y: y0 + 34, w: 2 * T, h: 126, low: true });
      }
      // Les murs : des rectangles (pour la physique) + les cases (pour le dessin).
      const used = g.map((row) => new Uint8Array(row.length));
      for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
        if (!g[r][q] || used[r][q]) continue;
        let w = 0;
        while (q + w < C && g[r][q + w] && !used[r][q + w]) w++;
        let h = 1;
        up: while (r + h < R) { for (let k = 0; k < w; k++) if (!g[r + h][q + k] || used[r + h][q + k]) break up; h++; }
        for (let j = r; j < r + h; j++) for (let k = q; k < q + w; k++) used[j][k] = 1;
        solid({ x: q * T, y: y0 + r * T, w: w * T, h: h * T });
      }
      for (let r = 0; r < R; r++) c.rows.push(g[r]);
      c.secs.push({ y0, routes });
      c.top = y0 + P.FH;
    }
    c.ensure = (y) => { while (c.top < y + 2000) floor(c.secs.length); };
    c.ensure(0);
    return c;
  };
  // Cette case est-elle un mur ? (sous le sol : oui)
  P.tileAt = (c, row, col) => (row < 0 || col < 0 || col >= P.COLS ? 1 : c.rows[row] ? c.rows[row][col] : 1);

  // ===================================================================
  //  LE PERSO
  // ===================================================================
  P.newRunner = (x) => ({ x, y: 0, vx: 0, vy: 0, t: 0, air: false, crouch: false, wall: 0, lastW: 0, hold: 0, coy: 0, buf: 0, lock: 0, on: 0, pk: 0, face: 1, alive: true, best: 0 });
  P.copy = (r) => ({ x: r.x, y: r.y, vx: r.vx, vy: r.vy, t: r.t, air: r.air, crouch: r.crouch, wall: r.wall, lastW: r.lastW, hold: r.hold, coy: r.coy, buf: r.buf, lock: r.lock, on: r.on, pk: r.pk, face: r.face, alive: r.alive, best: r.best });
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
    for (const s of near(c, r.y - 10, r.y + h + 10, "s")) if (hits(r.x + d, r.y, h, s)) return true;
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

  // Un calcul (1/30 s). Renvoie "lave" / "pique" si le perso vient d'être éliminé, sinon null.
  P.step = function (r, k, c) {
    if (!r.alive) return null;
    const dt = P.TICK;
    const t0 = r.t;
    r.t += dt;
    c.ensure(r.y);
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
    // Sauter (au sol, juste après avoir quitté le bord, ou contre un mur).
    if (r.buf > 0) {
      if ((!r.air || r.coy > 0) && !(r.crouch && blockedAbove(r, c))) {
        r.vy = P.JUMP_V; r.hold = P.HOLD; r.air = true; r.on = -1; r.coy = 0; r.buf = 0; r.crouch = false;
      } else if (r.air && r.wall && r.wall !== r.lastW) {
        r.vy = P.WJ_V; r.vx = -r.wall * P.WJ_X; r.lock = P.WJ_LOCK; r.lastW = r.wall; r.hold = 0; r.buf = 0; r.face = -r.wall;
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
    r.wall = r.air ? (wallAt(r, c, -2) ? -1 : wallAt(r, c, 2) ? 1 : 0) : 0;
    r.pk = k;
    r.best = Math.max(r.best, r.y);
    // Piques, lave.
    const h = P.height(r);
    for (const s of near(c, r.y - 4, r.y + h + 4, "k")) {
      if (r.x + HW - 3 > s.x && r.x - HW + 3 < s.x + s.w && r.y + h - 3 > s.y && r.y + 2 < s.y + s.h) { r.alive = false; return "pique"; }
    }
    if (r.y < P.lavaAt(r.t)) { r.alive = false; return "lave"; }
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
    const si = Math.max(0, Math.floor((r.y + 2) / P.FH));
    if (!r.air && ai.sec !== si && c.secs[si]) {
      ai.sec = si;
      if (!ai.forced) {
        const rs = c.secs[si].routes, pz = rs.filter((q) => q.kind === "puits"), zz = rs.filter((q) => q.kind !== "puits");
        ai.route = rnd() < ai.bold && pz.length ? pz[0] : zz.sort((a, b) => Math.abs(a.way[0].x - r.x) - Math.abs(b.way[0].x - r.x))[0];
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
    if (w.shaft) {
      // Le puits : on saute sur un mur, puis on rebondit de l'un à l'autre.
      if (!r.air) { ai.hold = 7; return (w.side < 0 ? K.LEFT : K.RIGHT) | (noJump ? 0 : K.JUMP); }
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
    return dk;
  };

  // Ce qui est visible entre deux hauteurs (pour le dessin).
  P.view = (c, y0, y1) => ({ plats: near(c, y0 - 20, y1 + 20, "p"), solids: near(c, y0, y1, "s"), spikes: near(c, y0, y1, "k") });

  root.Tower = P;
})(typeof window !== "undefined" ? window : globalThis);
