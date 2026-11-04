// ===================================================================
//  PARKOUR — Parcours + physique du coureur (partagé serveur + navigateur)
//  Un parcours infini tiré d'une seed (le même pour tout le monde) :
//  haies, caisses, barres, oiseaux, trous. Le coureur avance tout seul de
//  plus en plus vite ; on saute, on s'accroupit, on glisse.
//  Le serveur et le navigateur font EXACTEMENT les mêmes calculs.
//    globalThis.Parkour
// ===================================================================

(function (root) {
  const P = {};
  P.TICK = 1 / 30;
  P.K = { JUMP: 1, DOWN: 2 };
  P.W = 28;                 // largeur du coureur
  P.H_STAND = 58;           // hauteur debout (et en l'air)
  P.H_LOW = 28;             // accroupi / en glissade
  P.JUMP_V = 820;           // vitesse du saut
  P.G = 2700, P.G_HOLD = 1500, P.G_DIVE = 5200;   // gravité (normale, saut maintenu, plongeon vers le sol)
  P.HOLD = 0.2;             // on peut « porter » le saut un moment en gardant la touche
  P.SLIDE = 0.55;           // durée d'une glissade
  P.START = 900;            // départ : les premiers mètres sont libres

  // Vitesse (px/s) selon le temps de course, et selon la distance (pour placer les obstacles).
  P.speedAt = (t) => Math.min(980, 380 + 13 * t);
  P.speedAtDist = (d) => Math.min(980, Math.sqrt(380 * 380 + 26 * d));

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Les obstacles : x = début (px depuis le départ), largeur, et la zone qui bloque (y0..y1 au-dessus du sol).
  const KINDS = {
    haie: { w: 28, y0: 0, y1: 38 },
    caisse: { w: 46, y0: 0, y1: 72 },
    barre: { w: 42, y0: 40, y1: 220 },
    oiseau_haut: { w: 40, y0: 40, y1: 72 },
    oiseau_bas: { w: 40, y0: 10, y1: 40 },
  };
  P.KINDS = KINDS;

  // ===================================================================
  //  LE PARCOURS (généré au fur et à mesure, toujours dans le même ordre)
  // ===================================================================
  P.course = function (seed) {
    const rnd = seeded(seed);
    const c = { seed, obs: [], gaps: [], lastX: P.START };
    c.ensure = (d) => {
      while (c.lastX < d + 4000) {
        const x = c.lastX, v = P.speedAtDist(x);
        const lvl = Math.min(1, x / 40000);           // 0 au début → 1 vers 400 m
        const r = rnd();
        // Ce qu'on pose (de plus en plus varié et serré).
        let span = 0;
        if (r < 0.24) c.obs.push({ x, kind: "haie" });
        else if (r < 0.42) c.obs.push({ x, kind: "barre" });
        else if (r < 0.58) { const w = Math.round(90 + rnd() * (60 + 90 * lvl)); c.gaps.push({ x, w }); span = w; }
        else if (r < 0.7) c.obs.push({ x, kind: "caisse" });
        else if (r < 0.82) c.obs.push({ x, kind: rnd() < 0.5 ? "oiseau_haut" : "oiseau_bas" });
        else if (lvl > 0.25) {
          // Un enchaînement : deux obstacles rapprochés (il faut enchaîner les gestes).
          const a = rnd() < 0.5 ? "haie" : "barre", b = a === "haie" ? "barre" : "haie";
          c.obs.push({ x, kind: a });
          const dx = Math.round(v * (0.42 - 0.08 * lvl) + 40);
          c.obs.push({ x: x + dx, kind: b });
          span = dx + KINDS[b].w;
        } else c.obs.push({ x, kind: "haie" });
        // L'espace avant le suivant : du temps de réaction (de moins en moins).
        const gapT = 1.25 - 0.6 * lvl + rnd() * (0.55 - 0.25 * lvl);
        c.lastX = x + span + Math.round(v * gapT) + 60;
      }
    };
    c.ensure(0);
    return c;
  };

  // ===================================================================
  //  LE COUREUR
  // ===================================================================
  P.newRunner = () => ({ d: 0, y: 0, vy: 0, t: 0, hold: 0, slide: 0, crouch: false, air: false, alive: true, fall: false, pk: 0 });
  P.copy = (r) => ({ d: r.d, y: r.y, vy: r.vy, t: r.t, hold: r.hold, slide: r.slide, crouch: r.crouch, air: r.air, alive: r.alive, fall: r.fall, pk: r.pk });

  const overGap = (c, d) => c.gaps.some((g) => d > g.x + 6 && d < g.x + g.w - 6);
  P.height = (r) => (r.crouch ? P.H_LOW : P.H_STAND);

  // Un calcul (1/30 s). Renvoie "obstacle" / "trou" si le coureur vient de tomber, sinon null.
  P.step = function (r, k, c) {
    const dt = P.TICK;
    if (!r.alive) { if (r.fall) { r.vy -= P.G * dt; r.y = Math.max(-400, r.y + r.vy * dt); } return null; }
    const v = P.speedAt(r.t);
    r.t += dt; r.d += v * dt;
    c.ensure(r.d);
    const jump = k & P.K.JUMP, down = k & P.K.DOWN;
    const press = (bit) => (k & bit) && !(r.pk & bit);
    const hole = overGap(c, r.d);
    const grounded = r.y <= 0 && r.vy <= 0 && !hole;
    if (grounded) {
      r.y = 0; r.vy = 0; r.air = false;
      if (press(P.K.JUMP)) { r.vy = P.JUMP_V; r.hold = P.HOLD; r.slide = 0; r.air = true; }
      else if (press(P.K.DOWN)) r.slide = P.SLIDE;
    }
    if (!grounded || r.vy > 0) {
      r.air = true;
      const g = down ? P.G_DIVE : jump && r.hold > 0 && r.vy > 0 ? P.G_HOLD : P.G;
      r.hold = Math.max(0, r.hold - dt);
      r.vy -= g * dt; r.y += r.vy * dt;
      // On retombe sur le sol (s'il y en a).
      if (r.y <= 0 && !overGap(c, r.d) && r.y > -14) { r.y = 0; r.vy = 0; r.air = false; }
    }
    r.slide = Math.max(0, r.slide - dt);
    r.crouch = !r.air && (down || r.slide > 0);
    r.pk = k;
    // Tombé dans un trou.
    if (r.y < -14) { r.alive = false; r.fall = true; return "trou"; }
    // Un obstacle touché.
    const h = P.height(r), x0 = r.d - P.W / 2, x1 = r.d + P.W / 2;
    for (const o of c.obs) {
      if (o.x > x1 + 2) break;
      const K = KINDS[o.kind];
      if (o.x + K.w < x0) continue;
      if (r.y < K.y1 && r.y + h > K.y0) { r.alive = false; return "obstacle"; }
    }
    return null;
  };

  // Les obstacles et trous visibles entre deux distances (pour le dessin et les bots).
  P.near = (c, d0, d1) => ({ obs: c.obs.filter((o) => o.x + KINDS[o.kind].w > d0 && o.x < d1), gaps: c.gaps.filter((g) => g.x + g.w > d0 && g.x < d1) });

  root.Parkour = P;
})(typeof window !== "undefined" ? window : globalThis);
