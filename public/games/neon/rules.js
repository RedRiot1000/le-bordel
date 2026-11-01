// ===================================================================
//  NÉON — Règles partagées (serveur ET navigateur, comme physics.js)
//  - La moto avance toute seule (vitesse de croisière), Z accélère,
//    S ralentit mais jamais sous la vitesse minimum.
//  - Saut (Espace) : 0,5 s au-dessus des murs, recharge 5 s.
//  - Les murs de lumière : une suite de points [x, y, heure, coupure].
// ===================================================================

(function (root) {
  const P = root.PatatePhysics;
  const K = P.K;
  const N = {};

  N.MIN = 160;          // vitesse minimum (S ne descend pas en dessous)
  N.CRUISE = 250;       // vitesse quand on ne touche à rien
  N.DIE = 100;          // en dessous (après un choc) : la moto explose
  N.JUMP = 0.5;         // durée d'un saut (s)
  N.JUMP_CD = 5;        // recharge du saut (s)
  N.STEP = 8;           // un point de mur tous les 8 px
  N.WALL_R = 3;         // demi-épaisseur d'un mur
  N.HIT_R = 6;          // l'avant de la moto touche un mur à moins de 6 px (+ épaisseur)
  N.SKIP_OWN = 4;       // on ne se cogne pas aux 4 derniers points de son propre mur

  // Vitesse vers l'avant.
  N.speed = (c) => c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);

  // Une copie complète de la moto (la physique + le saut).
  N.copy = (c) => ({ ...P.copyCar(c), jump: c.jump || 0, jumpCd: c.jumpCd || 0 });
  N.newMoto = (x, y, a) => ({ ...P.newCar(x, y, a, "moto"), vx: Math.cos(a) * N.CRUISE, vy: Math.sin(a) * N.CRUISE, jump: 0, jumpCd: 0 });

  // Les touches du joueur -> les touches réellement appliquées (+ le saut).
  // Appelé une fois par calcul (1/30 s), à l'identique des deux côtés.
  N.prep = function (c, k, env) {
    c.jump = Math.max(0, (c.jump || 0) - P.TICK);
    c.jumpCd = Math.max(0, (c.jumpCd || 0) - P.TICK);
    if ((k & K.HB) && env.jump && c.jumpCd <= 0) { c.jump = N.JUMP; c.jumpCd = N.JUMP_CD; }
    const v = N.speed(c);
    let out = k & (K.LEFT | K.RIGHT);
    if (k & K.UP) out |= K.UP;
    // (le frein de la moto enlève ~40 px/s par calcul : on freine seulement s'il reste de la marge)
    else if (k & K.DOWN) out |= v > N.MIN + 45 ? K.DOWN : v < N.MIN + 10 ? K.UP : 0;
    else if (v < N.CRUISE) out |= K.UP;
    return out;
  };

  // Un calcul complet pour MA moto (prédiction dans le navigateur).
  N.simulate = function (c, k, env, others) {
    P.simulate(c, N.prep(c, k, env), env, 1, others);
  };

  // L'avant de la moto (c'est lui qui touche les murs).
  N.nose = function (c) {
    const L = P.VEHICLES.moto.L / 2;
    return { x: c.x + Math.cos(c.a) * L, y: c.y + Math.sin(c.a) * L };
  };
  N.tail = function (c) {
    const L = P.VEHICLES.moto.L / 2 - 2;
    return { x: c.x - Math.cos(c.a) * L, y: c.y - Math.sin(c.a) * L };
  };

  // Distance d'un point à un segment.
  N.distSeg = function (px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  };

  // ===================================================================
  //  GRILLE DES MURS (pour chercher vite les murs proches d'un point)
  //  trails = { id: [x, y, t, b, x, y, t, b, ...] } (b = 1 : coupure avant ce point)
  //  live = { id: { x, y } } : le bout du mur, entre le dernier point et la moto.
  // ===================================================================
  const CELL = 40;
  N.buildGrid = function (trails, live) {
    const grid = new Map();
    const add = (seg) => {
      const x0 = Math.floor((Math.min(seg[0], seg[2]) - 10) / CELL), x1 = Math.floor((Math.max(seg[0], seg[2]) + 10) / CELL);
      const y0 = Math.floor((Math.min(seg[1], seg[3]) - 10) / CELL), y1 = Math.floor((Math.max(seg[1], seg[3]) + 10) / CELL);
      for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
        const key = gx * 10000 + gy;
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(seg);
      }
    };
    for (const [id, p] of Object.entries(trails)) {
      const n = p.length / 4;
      for (let i = 1; i < n; i++) {
        if (p[i * 4 + 3]) continue;   // coupure (saut)
        add([p[i * 4 - 4], p[i * 4 - 3], p[i * 4], p[i * 4 + 1], id, n - i]);   // n - i = combien de points depuis le bout
      }
      const l = live && live[id];
      if (l && n) add([p[n * 4 - 4], p[n * 4 - 3], l.x, l.y, id, 0]);
    }
    return grid;
  };

  // Le point touche-t-il un mur ? Renvoie l'id du propriétaire du mur, ou null.
  N.hitWall = function (grid, x, y, r, selfId) {
    const list = grid.get(Math.floor(x / CELL) * 10000 + Math.floor(y / CELL));
    if (!list) return null;
    for (const s of list) {
      if (s[4] === selfId && s[5] < N.SKIP_OWN) continue;   // le bout de mon propre mur
      if (N.distSeg(x, y, s[0], s[1], s[2], s[3]) < r) return s[4];
    }
    return null;
  };

  root.NeonRules = N;
})(typeof window !== "undefined" ? window : globalThis);
