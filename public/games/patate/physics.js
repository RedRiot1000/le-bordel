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

  // --- Arène ---
  P.W = 1280;                 // largeur de l'arène
  P.H = 800;                  // hauteur de l'arène
  P.TICK = 1 / 30;            // un calcul = 1/30 s...
  P.SUB = 3;                  // ...découpé en 3 petits pas (évite de traverser)

  // ===================================================================
  //  LES VÉHICULES : chacun sa taille, son poids et sa conduite.
  //  (la Sportive = la voiture d'origine, utilisée par Patate chaude)
  //   L, W     : longueur, largeur (px)        mass   : poids (1 = sportive)
  //   engine   : accélération                  drag   : frottement -> vitesse max ≈ engine / drag
  //   brake    : freinage    reverse : marche arrière
  //   steer    : braquage (rad/s)              steerLoss : braquage perdu à pleine vitesse (0 à 1)
  //   grip     : adhérence     slideIn : glisse latérale avant de décrocher
  //   stars    : les étoiles affichées sur les cartes (1 à 5)
  // ===================================================================
  P.VEHICLES = {
    sport: {
      name: "Sportive", emoji: "🚗", desc: "L'équilibrée : bonne en tout.",
      L: 44, W: 24, mass: 1, engine: 520, drag: 1.35, brake: 950, reverse: 320,
      steer: 3.3, steerLoss: 0.3, grip: 10, slideIn: 115,
      stars: { speed: 4, accel: 4, weight: 3, handling: 4, push: 3 },
    },
    f1: {
      name: "Formule 1", emoji: "🏎️", desc: "La plus rapide, colle à la route… mais légère.",
      L: 52, W: 22, mass: 0.9, engine: 650, drag: 1.35, brake: 1150, reverse: 300,
      steer: 3.0, steerLoss: 0.12, grip: 15, slideIn: 160,
      stars: { speed: 5, accel: 4, weight: 2, handling: 3, push: 2 },
    },
    minivan: {
      name: "Minivan", emoji: "🚐", desc: "Lourd et costaud, mais lent à tourner.",
      L: 50, W: 28, mass: 1.7, engine: 400, drag: 1.25, brake: 800, reverse: 280,
      steer: 2.6, steerLoss: 0.35, grip: 9, slideIn: 110,
      stars: { speed: 3, accel: 3, weight: 4, handling: 2, push: 4 },
    },
    truck: {
      name: "Camion", emoji: "🚚", desc: "Un bulldozer : lent, mais rien ne l'arrête.",
      L: 66, W: 32, mass: 3, engine: 300, drag: 1.15, brake: 600, reverse: 220,
      steer: 2.0, steerLoss: 0.35, grip: 8.5, slideIn: 105,
      stars: { speed: 2, accel: 1, weight: 5, handling: 1, push: 5 },
    },
    moto: {
      name: "Moto", emoji: "🏍️", desc: "Vire très court, esquive tout… mais ne pousse rien.",
      L: 34, W: 12, mass: 0.4, engine: 700, drag: 1.65, brake: 1000, reverse: 250,
      steer: 4.6, steerLoss: 0.25, grip: 13, slideIn: 145,
      stars: { speed: 4, accel: 5, weight: 1, handling: 5, push: 1 },
    },
    // Réservée à la police d'Avis de recherche (pas proposée dans la Patate ni au Sumo).
    supercar: {
      name: "Supercar", emoji: "🏎️", desc: "Plus rapide qu'une Sportive, colle à la route.", special: true,
      L: 48, W: 24, mass: 1.1, engine: 590, drag: 1.35, brake: 1100, reverse: 300,
      steer: 3.2, steerLoss: 0.2, grip: 13, slideIn: 140,
      stars: { speed: 5, accel: 5, weight: 3, handling: 4, push: 3 },
    },
  };
  // Réservée aux joueurs devenus flics dans Avis de recherche : rapide, et lourde comme un van (elle pousse fort).
  // Largeur 24 : elle passe sous les portiques des ruelles (pas les vans ni les camions).
  P.VEHICLES.lambo = {
    name: "Lamborghini de police", emoji: "🚓", desc: "Puissante, lourde, elle pousse fort.", special: true,
    L: 50, W: 24, mass: 1.75, engine: 640, drag: 1.32, brake: 1150, reverse: 300,
    steer: 3.15, steerLoss: 0.2, grip: 13.5, slideIn: 145,
    stars: { speed: 5, accel: 5, weight: 4, handling: 4, push: 4 },
  };
  // Les 3 supersportives du Grand Prix (réservées à la course).
  P.VEHICLES.eclair = {
    name: "ÉCLAIR", emoji: "⚡", desc: "La plus rapide en ligne droite… mais elle glisse en virage.", special: true,
    L: 54, W: 24, mass: 1.1, engine: 735, drag: 1.14, brake: 1100, reverse: 300,
    steer: 2.9, steerLoss: 0.28, grip: 11, slideIn: 130,
    stars: { speed: 5, accel: 3, weight: 3, handling: 2, push: 3 },
  };
  P.VEHICLES.vipere = {
    name: "VIPÈRE", emoji: "🐍", desc: "Accélère et tourne le mieux… mais légère, elle se fait pousser.", special: true,
    L: 44, W: 22, mass: 0.8, engine: 840, drag: 1.38, brake: 1250, reverse: 300,
    steer: 3.7, steerLoss: 0.15, grip: 15, slideIn: 165,
    stars: { speed: 4, accel: 5, weight: 1, handling: 5, push: 1 },
  };
  P.VEHICLES.titan = {
    name: "TITAN", emoji: "🦏", desc: "Lourde, pousse très fort et colle à la route… mais moins rapide.", special: true,
    L: 54, W: 30, mass: 2.1, engine: 790, drag: 1.35, brake: 1000, reverse: 280,
    steer: 2.9, steerLoss: 0.2, grip: 14, slideIn: 160,
    stars: { speed: 3, accel: 4, weight: 5, handling: 4, push: 5 },
  };
  P.RACE_TYPES = ["eclair", "vipere", "titan"];
  P.TYPES = Object.keys(P.VEHICLES).filter((t) => !P.VEHICLES[t].special);
  for (const v of Object.values(P.VEHICLES)) {
    // Résistance à la rotation (volontairement faible : les chocs font bien tourner).
    v.inertia = 0.55 * v.mass * (v.L * v.L + v.W * v.W) / 12;
  }
  const spec = (c) => P.VEHICLES[c.type] || P.VEHICLES.sport;
  P.spec = spec;

  // Valeurs de la Sportive (gardées pour le code qui dessine / Patate chaude).
  P.CAR_L = P.VEHICLES.sport.L;
  P.CAR_W = P.VEHICLES.sport.W;

  // --- Réglages communs à tous les véhicules ---
  const ROLL = 110;           // ralentissement quand on lâche tout
  const HANDBRAKE = 260;      // ralentissement du frein à main
  const GRIP_SLIDE = 2.4;     // adhérence pendant un dérapage
  const GRIP_HB = 1.1;        // adhérence au frein à main
  const SLIDE_OUT = 55;       // on se rattrape d'un dérapage en dessous de cette glisse
  const NITRO_MULT = 1.9;     // puissance du nitro
  const NITRO_USE = 0.45;     // jauge consommée par seconde
  const NITRO_REGEN = 0.12;   // jauge rechargée par seconde
  const E_WALL = 0.3;         // rebond contre les murs / obstacles
  P.HOLDER_BONUS = 1.08;      // le porteur de bombe a un moteur un poil plus fort
  const HOLDER_NITRO_USE = 0.6;   // réglage "nitro du porteur" : sa jauge dure ~1,7× plus longtemps…
  const HOLDER_NITRO_REGEN = 2.5; // … et se recharge 2,5× plus vite

  // Touches (combinées en un seul nombre).
  P.K = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, HB: 16, NITRO: 32 };

  P.newCar = (x, y, a, type = "sport") => ({ x, y, a, vx: 0, vy: 0, w: 0, nitro: 1, slide: false, st: 0, boost: false, type, regen: 1 });
  P.copyCar = (c) => ({ x: c.x, y: c.y, a: c.a, vx: c.vx, vy: c.vy, w: c.w, nitro: c.nitro, slide: c.slide, st: c.st, boost: c.boost, type: c.type, regen: c.regen ?? 1 });

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
    const V = spec(c);                                // la fiche du véhicule
    const fx = Math.cos(c.a), fy = Math.sin(c.a);   // direction avant
    const rx = -fy, ry = fx;                          // direction droite
    let vF = c.vx * fx + c.vy * fy;                   // vitesse avant
    let vR = c.vx * rx + c.vy * ry;                   // vitesse de côté (glisse)
    // Hors piste (Grand Prix) : aucune adhérence dans l'herbe, on glisse comme sur de la glace.
    const off = env.offAt ? env.offAt(c.x, c.y) : 0;
    const surf = gripAt(env, c.x, c.y) * (1 - 0.96 * off);
    const up = k & P.K.UP, down = k & P.K.DOWN, hb = k & P.K.HB;
    const steer = (k & P.K.RIGHT ? 1 : 0) - (k & P.K.LEFT ? 1 : 0);
    c.st = steer;

    // Nitro : se vide quand on l'utilise, se recharge sinon.
    // (bonus > 1 = c'est le porteur de la bombe : avec env.holderNitro, son nitro est boosté)
    const hn = env.holderNitro && bonus > 1;
    c.boost = !!(env.nitro && (k & P.K.NITRO) && up && c.nitro > 0.02);
    // Recharge : normale, ou (Grand Prix) un peu avec le temps + beaucoup en dérapant, × c.regen (rattrapage des derniers).
    let regen = NITRO_REGEN * (hn ? HOLDER_NITRO_REGEN : 1);
    if (env.nitroRegen !== undefined) regen = (env.nitroRegen + (c.slide && Math.abs(vF) > 150 ? env.driftRegen : 0)) * (c.regen ?? 1);
    c.nitro = c.boost ? Math.max(0, c.nitro - NITRO_USE * (hn ? HOLDER_NITRO_USE : 1) * dt)
                      : Math.min(1, c.nitro + regen * dt);

    // Moteur / freins (moins de motricité sur sol glissant).
    const tract = (0.55 + 0.45 * Math.min(1, surf)) * (1 - 0.55 * off);
    let acc = 0;
    if (up) acc += V.engine * bonus * (c.boost ? NITRO_MULT : 1) * tract;
    if (down) acc -= vF > 20 ? V.brake * tract : V.reverse * tract;
    if (!up && !down) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, ROLL);
    if (hb) acc -= Math.sign(vF) * Math.min(Math.abs(vF) / dt, HANDBRAKE);
    vF += acc * dt;
    vF -= vF * (V.drag + 0.9 * off) * dt;

    // Adhérence latérale : c'est ici que naît le dérapage.
    const absR = Math.abs(vR);
    if (absR > V.slideIn) c.slide = true;
    else if (absR < SLIDE_OUT) c.slide = false;
    const grip = (hb ? GRIP_HB : c.slide ? GRIP_SLIDE : V.grip) * surf;
    vR *= Math.exp(-grip * dt);

    // Direction : il faut rouler pour tourner, et on tourne moins vite à fond.
    const speed = Math.abs(vF);
    const steerFactor = Math.min(1, speed / 110) * (1 - V.steerLoss * Math.min(1, speed / 650));
    let targetW = steer * V.steer * steerFactor * (vF < -5 ? -1 : 1);
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

  // Les 2 ronds qui servent aux chocs contre les murs (avant et arrière).
  // Rayon = demi-largeur, placés pour couvrir toute la longueur.
  P.circles = function (c) {
    const V = spec(c), R = V.W / 2, off = V.L / 2 - R;
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    return [
      { x: c.x + fx * off, y: c.y + fy * off, r: R },
      { x: c.x - fx * off, y: c.y - fy * off, r: R },
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
    const V = spec(c);
    const j = -(1 + E_WALL) * vn / (1 / V.mass + (rn * rn) / V.inertia);
    c.vx += (j * nx) / V.mass;
    c.vy += (j * ny) / V.mass;
    c.w += (rn * j) / V.inertia;
    if (-vn > 160) c.slide = true;                          // gros choc = on perd l'adhérence
    return -vn;
  }

  P.collideStatic = function (c, env) {
    let impact = 0;
    for (const s of P.circles(c)) {
      const R = s.r;
      // Barrières en segments (Grand Prix) : on reste du côté où on est.
      if (env.rails) {
        for (const g of env.rails(s.x, s.y)) {
          const dx = g[2] - g[0], dy = g[3] - g[1], L2 = dx * dx + dy * dy || 1;
          const f = Math.max(0, Math.min(1, ((s.x - g[0]) * dx + (s.y - g[1]) * dy) / L2));
          const qx = g[0] + dx * f, qy = g[1] + dy * f;
          const ex = s.x - qx, ey = s.y - qy, d = Math.hypot(ex, ey);
          if (d >= R || d === 0) continue;
          impact = Math.max(impact, hitStatic(c, qx, qy, ex / d, ey / d, R - d));
        }
      }
      // Murs de l'arène (pas de murs au Sumo : autour, c'est le vide !).
      if (env.walls !== false) {
        if (s.x < R) impact = Math.max(impact, hitStatic(c, s.x - R, s.y, 1, 0, R - s.x));
        if (s.x > env.w - R) impact = Math.max(impact, hitStatic(c, s.x + R, s.y, -1, 0, s.x - (env.w - R)));
        if (s.y < R) impact = Math.max(impact, hitStatic(c, s.x, s.y - R, 0, 1, R - s.y));
        if (s.y > env.h - R) impact = Math.max(impact, hitStatic(c, s.x, s.y + R, 0, -1, s.y - (env.h - R)));
      }
      // Obstacles rectangulaires.
      for (const o of env.obstacles) {
        // Portique (Avis de recherche) : seuls les véhicules étroits passent dessous (pas les vans ni les camions).
        if (o.gate && spec(c).W < 26) continue;
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
  //
  //  Les voitures sont de vrais RECTANGLES (exactement la forme dessinée).
  //  On cherche l'axe où elles se chevauchent le moins (méthode "SAT"),
  //  on les sépare le long de cet axe, puis on applique le choc au point
  //  de contact, avec du FROTTEMENT (pour pousser au lieu de glisser).
  // ===================================================================
  const E_CAR_BOX = 0.3;      // rebond entre voitures (bas = on reste au contact pour pousser)
  const FRICTION = 0.45;      // frottement carrosserie contre carrosserie

  // Les 4 coins d'un véhicule (selon sa taille).
  P.corners = function (c) {
    const V = spec(c);
    const fx = Math.cos(c.a), fy = Math.sin(c.a), rx = -fy, ry = fx;
    const hl = V.L / 2, hw = V.W / 2;
    return [
      [c.x + fx * hl + rx * hw, c.y + fy * hl + ry * hw],
      [c.x + fx * hl - rx * hw, c.y + fy * hl - ry * hw],
      [c.x - fx * hl - rx * hw, c.y - fy * hl - ry * hw],
      [c.x - fx * hl + rx * hw, c.y - fy * hl + ry * hw],
    ];
  };

  // Le point (x, y) est-il dans la voiture c (avec une marge) ?
  function insideCar(c, x, y, margin = 0) {
    const V = spec(c);
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    const dx = x - c.x, dy = y - c.y;
    return Math.abs(dx * fx + dy * fy) <= V.L / 2 + margin && Math.abs(-dx * fy + dy * fx) <= V.W / 2 + margin;
  }

  // maxPush : séparation maximale par petit pas (utilisé par la prédiction
  // du navigateur pour éviter les sauts brusques si on se chevauche beaucoup).
  P.collideCars = function (A, B, bStatic = false, maxPush = Infinity) {
    const none = { touch: false, impact: 0, x: 0, y: 0 };
    // Trop loin pour se toucher : on ne calcule rien.
    const SA = spec(A), SB = spec(B);
    if (Math.hypot(B.x - A.x, B.y - A.y) > (SA.L + SB.L) / 2 + 6) return none;

    // 1. Sur quel axe se chevauchent-elles le moins ?
    const ca = P.corners(A), cb = P.corners(B);
    let pen = Infinity, nx = 0, ny = 0;
    for (const ang of [A.a, A.a + Math.PI / 2, B.a, B.a + Math.PI / 2]) {
      const ax = Math.cos(ang), ay = Math.sin(ang);
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const [x, y] of ca) { const d = x * ax + y * ay; if (d < aMin) aMin = d; if (d > aMax) aMax = d; }
      for (const [x, y] of cb) { const d = x * ax + y * ay; if (d < bMin) bMin = d; if (d > bMax) bMax = d; }
      const o = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (o < pen) { pen = o; nx = ax; ny = ay; }
    }
    if (pen < -3) return none;                       // séparées (même pas frôlées)
    if (pen <= 0) return { ...none, touch: true };   // elles se frôlent (assez pour passer la bombe)
    if ((B.x - A.x) * nx + (B.y - A.y) * ny < 0) { nx = -nx; ny = -ny; }   // normale de A vers B

    // 2. Point de contact : les coins de l'une qui sont rentrés dans l'autre.
    let px = 0, py = 0, n = 0;
    for (const [x, y] of ca) if (insideCar(B, x, y, 0.5)) { px += x; py += y; n++; }
    for (const [x, y] of cb) if (insideCar(A, x, y, 0.5)) { px += x; py += y; n++; }
    if (n) { px /= n; py /= n; } else { px = (A.x + B.x) / 2; py = (A.y + B.y) / 2; }

    // 3. On les sépare complètement (plus jamais à moitié l'une dans l'autre).
    //    Le plus léger recule plus (c'est ici que le camion "gagne").
    const invMA = 1 / SA.mass, invIA = 1 / SA.inertia;
    const invMB = bStatic ? 0 : 1 / SB.mass, invIB = bStatic ? 0 : 1 / SB.inertia;
    const share = invMA / (invMA + invMB);
    const push = Math.min(pen, maxPush);
    A.x -= nx * push * share; A.y -= ny * push * share;
    B.x += nx * push * (1 - share); B.y += ny * push * (1 - share);

    // 4. Le choc au point de contact.
    const rAx = px - A.x, rAy = py - A.y, rBx = px - B.x, rBy = py - B.y;
    const vAx = A.vx - A.w * rAy, vAy = A.vy + A.w * rAx;
    const vBx = B.vx - B.w * rBy, vBy = B.vy + B.w * rBx;
    const rvx = vBx - vAx, rvy = vBy - vAy;
    const vn = rvx * nx + rvy * ny;
    if (vn >= 0) return { touch: true, impact: 0, x: px, y: py };   // déjà en train de s'écarter
    const rAn = rAx * ny - rAy * nx, rBn = rBx * ny - rBy * nx;
    const j = -(1 + E_CAR_BOX) * vn / (invMA + invMB + rAn * rAn * invIA + rBn * rBn * invIB);
    A.vx -= j * nx * invMA; A.vy -= j * ny * invMA; A.w -= rAn * j * invIA;
    B.vx += j * nx * invMB; B.vy += j * ny * invMB; B.w += rBn * j * invIB;

    // 5. Frottement : les carrosseries "accrochent" au lieu de glisser l'une sur l'autre.
    const tx = -ny, ty = nx;
    const vt = rvx * tx + rvy * ty;
    const rAt = rAx * ty - rAy * tx, rBt = rBx * ty - rBy * tx;
    let jt = -vt / (invMA + invMB + rAt * rAt * invIA + rBt * rBt * invIB);
    jt = Math.max(-FRICTION * j, Math.min(FRICTION * j, jt));
    A.vx -= jt * tx * invMA; A.vy -= jt * ty * invMA; A.w -= rAt * jt * invIA;
    B.vx += jt * tx * invMB; B.vy += jt * ty * invMB; B.w += rBt * jt * invIB;

    if (-vn > 150) { A.slide = true; if (!bStatic) B.slide = true; }
    return { touch: true, impact: -vn, x: px, y: py };
  };

  // Un calcul complet (1/30 s) pour UNE voiture seule (utilisé par le
  // navigateur pour prédire sa propre voiture). "others" = les autres
  // voitures telles qu'on les voit : ma voiture bute dessus au lieu de
  // passer à travers en attendant la réponse du serveur.
  P.simulate = function (c, k, env, bonus = 1, others = null) {
    const dt = P.TICK / P.SUB;
    for (let i = 0; i < P.SUB; i++) {
      P.drive(c, k, dt, env, bonus);
      P.collideStatic(c, env);
      if (others) for (const o of others) P.collideCars(c, o, true, 6);
    }
  };

  // Où sera une voiture dans t secondes si elle garde sa vitesse ?
  // (le navigateur s'en sert pour voir les autres voitures "au présent")
  P.extrapolate = function (c, t) {
    return { ...c, x: c.x + c.vx * t, y: c.y + c.vy * t, a: c.a + c.w * t };
  };

  root.PatatePhysics = P;
})(typeof window !== "undefined" ? window : globalThis);
