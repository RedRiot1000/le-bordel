// ===================================================================
//  PATATE CHAUDE — Physique des voitures
//  Ce fichier est utilisé À LA FOIS par le serveur (qui fait foi) et
//  par le navigateur (qui calcule ta voiture en avance pour qu'elle
//  réagisse tout de suite). Même code = même conduite des deux côtés.
//
//  Le modèle : chaque voiture a une vitesse "avant" et une vitesse
//  "de côté". Les pneus freinent la vitesse de côté (= l'adhérence).
//  Si on glisse trop de côté, l'adhérence chute : c'est le dérapage.
//  Les chocs sont de vrais chocs entre objets qui tournent : taper
//  l'arrière d'une voiture la fait partir en tête-à-queue.
// ===================================================================

(function (root) {
  const P = {};

  // --- Arène et voiture ---
  P.W = 1280;                 // largeur de l'arène
  P.H = 800;                  // hauteur de l'arène
  P.CAR_L = 44;               // longueur d'une voiture
  P.CAR_W = 24;               // largeur d'une voiture
  P.CR = 12;                  // la voiture = 2 ronds de ce rayon (avant + arrière)
  P.COFF = 10;                // décalage des 2 ronds depuis le centre
  P.MASS = 1;
  // Résistance à la rotation (volontairement faible : les chocs font bien tourner).
P.INERTIA = 0.55 * (P.CAR_L * P.CAR_L + P.CAR_W * P.CAR_W) / 12;
  P.TICK = 1 / 30;            // un calcul = 1/30 s...
  P.SUB = 3;                  // ...découpé en 3 petits pas (évite de traverser)

  // --- Réglages de conduite (à ajuster pour le "feeling") ---
  const ENGINE = 520;         // accélération moteur
  const DRAG = 1.35;          // frottement de l'air -> vitesse max ≈ ENGINE / DRAG ≈ 385
  const BRAKE = 950;          // freinage
  const REVERSE = 320;        // marche arrière
  const ROLL = 110;           // ralentissement quand on lâche tout
  const HANDBRAKE = 260;      // ralentissement du frein à main
  const STEER = 3.3;          // vitesse de braquage (radians / s)
  const GRIP = 10;            // adhérence normale
  const GRIP_SLIDE = 2.4;     // adhérence pendant un dérapage
  const GRIP_HB = 1.1;        // adhérence au frein à main
  const SLIDE_IN = 115;       // on part en dérapage au-delà de cette glisse latérale...
  const SLIDE_OUT = 55;       // ...et on se rattrape en dessous de celle-ci
  const NITRO_MULT = 1.9;     // puissance du nitro
  const NITRO_USE = 0.45;     // jauge consommée par seconde
  const NITRO_REGEN = 0.12;   // jauge rechargée par seconde
  const E_WALL = 0.3;         // rebond contre les murs / obstacles
  const E_CAR = 0.55;         // rebond entre voitures
  P.HOLDER_BONUS = 1.08;      // le porteur de bombe a un moteur un poil plus fort

  // Touches (combinées en un seul nombre).
  P.K = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, HB: 16, NITRO: 32 };

  P.newCar = (x, y, a) => ({ x, y, a, vx: 0, vy: 0, w: 0, nitro: 1, slide: false, st: 0, boost: false });
  P.copyCar = (c) => ({ x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, w: c.w, nitro: c.nitro, slide: c.slide, st: c.st, boost: c.boost });

  // Adhérence du sol à un endroit (les flaques d'huile la divisent).
  function gripAt(env, x, y) {
    let g = env.grip;
    for (const o of env.oils) {
      const dx = x - o.x, dy = y - o.y;
      if (dx * dx + dy * dy < o.r * o.r) g *= 0.3;
    }
    return g;
  }

  // ===================================================================
  //  CONDUITE : un petit pas de temps pour une voiture (sans les chocs)
  // ===================================================================
  P.drive = function (c, k, dt, env, bonus = 1) {
    const fx = Math.cos(c.a), fy = Math.sin(c.a);   // direction avant
    const rx = -fy, ry = fx;                          // direction droite
    let vF = c.vx * fx + c.vy * fy;                   // vitesse avant
    let vR = c.vx * rx + c.vy * ry;                   // vitesse de côté (glisse)
    const surf = gripAt(env, c.x, c.y);
    const up = k & P.K.UP, down = k & P.K.DOWN, hb = k & P.K.HB;
    const steer = (k & P.K.RIGHT ? 1 : 0) - (k & P.K.LEFT ? 1 : 0);
    c.st = steer;

    // Nitro : se vide quand on l'utilise, se recharge sinon.
    c.boost = !!(env.nitro && (k & P.K.NITRO) && up && c.nitro > 0.02);
    c.nitro = c.boost ? Math.max(0, c.nitro - NITRO_USE * dt) : Math.min(1, c.nitro + NITRO_REGEN * dt);

    // Moteur / freins (moins de motricité sur sol glissant).
    const tract = 0.55 + 0.45 * Math.min(1, surf);
    let acc = 0;
    if (up) acc += ENGINE * bonus * (c.boost ? NITRO_MULT : 1) * tract;
    if (down) acc -= vF > 20 ? BRAKE * tract : REVERSE * tract;
    if (!up && !down) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, ROLL);
    if (hb) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, HANDBRAKE);
    vF += acc * dt;
    vF -= vF * DRAG * dt;

    // Adhérence latérale : c'est ici que naît le dérapage.
    const absR = Math.abs(vR);
    if (absR > SLIDE_IN) c.slide = true;
    else if (absR < SLIDE_OUT) c.slide = false;
    const grip = (hb ? GRIP_HB : c.slide ? GRIP_SLIDE : GRIP) * surf;
    vR *= Math.exp(-grip * dt);

    // Direction : il faut rouler pour tourner, et on tourne moins vite à fond.
    const speed = Math.abs(vF);
    const steerFactor = Math.min(1, speed / 110) * (1 - 0.3 * Math.min(1, speed / 650));
    let targetW = steer * STEER * steerFactor * (vF < -5 ? -1 : 1);
    // Frein à main : l'arrière pivote d'un coup.
    if (hb) targetW *= 1.8;
    // En dérapage (ou après un choc), on contrôle mal la rotation : ça part en toupie.
    const wRate = (hb ? 6 : c.slide ? 1.5 : 9) * Math.max(0.4, Math.min(1, surf));
    c.w += (targetW - c.w) * Math.min(1, wRate * dt);
    c.a += c.w * dt;

    c.vx = fx * vF + rx * vR;
    c.vy = fy * vF + ry * vR;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
  };

  // Les 2 ronds qui servent aux collisions (avant et arrière).
  P.circles = function (c) {
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    return [
      { x: c.x + fx * P.COFF, y: c.y + fy * P.COFF },
      { x: c.x - fx * P.COFF, y: c.y - fy * P.COFF },
    ];
  };

  // ===================================================================
  //  CHOCS contre les murs et obstacles (qui ne bougent pas)
  //  n = direction qui repousse la voiture, (px,py) = point de contact.
  // ===================================================================
  function hitStatic(c, px, py, nx, ny, pen) {
    c.x += nx * pen; c.y += ny * pen;
    const rx = px - c.x, ry = py - c.y;
    const vpx = c.vx - c.w * ry, vpy = c.vy + c.w * rx;   // vitesse du point touché
    const vn = vpx * nx + vpy * ny;
    if (vn >= 0) return 0;                                  // on s'éloigne déjà
    const rn = rx * ny - ry * nx;
    const j = -(1 + E_WALL) * vn / (1 / P.MASS + (rn * rn) / P.INERTIA);
    c.vx += (j * nx) / P.MASS;
    c.vy += (j * ny) / P.MASS;
    c.w += (rn * j) / P.INERTIA;
    if (-vn > 160) c.slide = true;                          // gros choc = on perd l'adhérence
    return -vn;
  }

  P.collideStatic = function (c, env) {
    let impact = 0;
    const R = P.CR;
    for (const s of P.circles(c)) {
      // Murs de l'arène (pas de murs au Sumo : autour, c'est le vide !).
      if (env.walls !== false) {
        if (s.x < R) impact = Math.max(impact, hitStatic(c, s.x - R, s.y, 1, 0, R - s.x));
        if (s.x > env.w - R) impact = Math.max(impact, hitStatic(c, s.x + R, s.y, -1, 0, s.x - (env.w - R)));
        if (s.y < R) impact = Math.max(impact, hitStatic(c, s.x, s.y - R, 0, 1, R - s.y));
        if (s.y > env.h - R) impact = Math.max(impact, hitStatic(c, s.x, s.y + R, 0, -1, s.y - (env.h - R)));
      }
      // Obstacles rectangulaires.
      for (const o of env.obstacles) {
        const qx = Math.max(o.x, Math.min(s.x, o.x + o.w));
        const qy = Math.max(o.y, Math.min(s.y, o.y + o.h));
        const dx = s.x - qx, dy = s.y - qy;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        if (d2 > 0) {
          const d = Math.sqrt(d2);
          impact = Math.max(impact, hitStatic(c, qx, qy, dx / d, dy / d, R - d));
        } else {
          // Le rond est entré dans le bloc : on le sort par le côté le plus proche.
          const exits = [
            [s.x - o.x, -1, 0], [o.x + o.w - s.x, 1, 0],
            [s.y - o.y, 0, -1], [o.y + o.h - s.y, 0, 1],
          ].sort((p, q) => p[0] - q[0])[0];
          impact = Math.max(impact, hitStatic(c, s.x, s.y, exits[1], exits[2], exits[0] + R));
        }
      }
    }
    return impact;
  };

  // ===================================================================
  //  CHOC ENTRE DEUX VOITURES
  //  bStatic = true si B est une épave (elle ne bouge plus).
  //  Renvoie { touch, impact, x, y } : touch = elles se touchent
  //  (pour passer la bombe), impact = violence du choc.
  // ===================================================================
  P.collideCars = function (A, B, bStatic = false) {
    const R = P.CR;
    let touch = false, impact = 0, ix = 0, iy = 0;
    const invMA = 1 / P.MASS, invIA = 1 / P.INERTIA;
    const invMB = bStatic ? 0 : 1 / P.MASS, invIB = bStatic ? 0 : 1 / P.INERTIA;
    for (const ca of P.circles(A)) {
      for (const cb of P.circles(B)) {
        const dx = cb.x - ca.x, dy = cb.y - ca.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < R * 2 + 3) touch = true;
        if (d >= R * 2) continue;
        const nx = dx / d, ny = dy / d;
        // On les sépare.
        const pen = R * 2 - d;
        const share = invMA / (invMA + invMB);
        A.x -= nx * pen * share; A.y -= ny * pen * share;
        B.x += nx * pen * (1 - share); B.y += ny * pen * (1 - share);
        // Choc (impulsion) au point de contact.
        const px = (ca.x + cb.x) / 2, py = (ca.y + cb.y) / 2;
        const rAx = px - A.x, rAy = py - A.y, rBx = px - B.x, rBy = py - B.y;
        const vAx = A.vx - A.w * rAy, vAy = A.vy + A.w * rAx;
        const vBx = B.vx - B.w * rBy, vBy = B.vy + B.w * rBx;
        const vn = (vBx - vAx) * nx + (vBy - vAy) * ny;
        if (vn >= 0) continue;                                // déjà en train de s'écarter
        const rAn = rAx * ny - rAy * nx, rBn = rBx * ny - rBy * nx;
        const j = -(1 + E_CAR) * vn / (invMA + invMB + rAn * rAn * invIA + rBn * rBn * invIB);
        A.vx -= j * nx * invMA; A.vy -= j * ny * invMA; A.w -= rAn * j * invIA;
        B.vx += j * nx * invMB; B.vy += j * ny * invMB; B.w += rBn * j * invIB;
        if (-vn > 150) { A.slide = true; if (!bStatic) B.slide = true; }
        if (-vn > impact) { impact = -vn; ix = px; iy = py; }
      }
    }
    return { touch, impact, x: ix, y: iy };
  };

  // Un calcul complet (1/30 s) pour UNE voiture seule (utilisé par le
  // navigateur pour prédire sa propre voiture).
  P.simulate = function (c, k, env, bonus = 1) {
    const dt = P.TICK / P.SUB;
    for (let i = 0; i < P.SUB; i++) {
      P.drive(c, k, dt, env, bonus);
      P.collideStatic(c, env);
    }
  };

  root.PatatePhysics = P;
})(typeof window !== "undefined" ? window : globalThis);
