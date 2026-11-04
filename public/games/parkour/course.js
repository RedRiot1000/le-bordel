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
  P.H_STAND = 50;           // hauteur debout (et en l'air)
  P.H_LOW = 26;             // accroupi / en glissade
  P.JUMP_V = 900;           // vitesse du saut (vif et court)
  P.G = 4200, P.G_HOLD = 2400, P.G_DIVE = 7500;   // gravité (normale, saut maintenu, plongeon vers le sol)
  P.HOLD = 0.15;            // on peut « porter » le saut un moment en gardant la touche
  P.SLIDE = 0.55;           // durée d'une glissade
  P.START = 900;            // départ : les premiers mètres sont libres

  // Vitesse (px/s) selon le temps de course, et selon la distance (pour placer les obstacles).
  // 1) 0 → 40 s : de 420 à 1060 ; 2) ensuite ça continue de monter (+14 px/s chaque seconde) jusqu'à 1700.
  P.speedAt = (t) => (t < 40 ? 420 + 16 * t : Math.min(1700, 1060 + 14 * (t - 40)));
  const D40 = 420 * 40 + 8 * 40 * 40;   // distance parcourue à 40 s
  P.speedAtDist = (d) => (d < D40 ? Math.sqrt(420 * 420 + 32 * d) : Math.min(1700, Math.sqrt(1060 * 1060 + 28 * (d - D40))));

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
        const lvl = Math.min(1, x / 30000);           // 0 au début → 1 vers 3000 m (10 px = 1 m)
        const lvl2 = Math.min(1, Math.max(0, (x - 30000) / 50000));    // 3000 m → 8000 m : ça devient vraiment dur
        const r = rnd();
        // Ce qu'on pose (de plus en plus varié et serré).
        let span = 0;
        const combo = lvl > 0.15 && r >= 0.82 - 0.3 * lvl2;   // les enchaînements deviennent fréquents
        if (combo) {
          const v2 = v, close = (k) => Math.round(v2 * (0.36 - 0.06 * lvl - 0.04 * lvl2) + 40 + k);
          const pick = rnd();
          if (lvl2 > 0.2 && pick < 0.3) {
            // Triple : haie → barre → haie.
            const d1 = close(0), d2 = d1 + close(0) + KINDS.barre.w;
            c.obs.push({ x, kind: "haie" }, { x: x + d1, kind: "barre" }, { x: x + d2, kind: "haie" });
            span = d2 + KINDS.haie.w;
          } else if (lvl2 > 0.1 && pick < 0.55) {
            // Un trou puis un oiseau bas juste après l'atterrissage (sauter puis resauter).
            const w = Math.round(100 + rnd() * 60);
            c.gaps.push({ x, w });
            const dx = w + Math.round(v2 * 0.42) + 40;
            c.obs.push({ x: x + dx, kind: "oiseau_bas" });
            span = dx + KINDS.oiseau_bas.w;
          } else if (lvl2 > 0.1 && pick < 0.75) {
            // Deux caisses (double saut).
            const dx = Math.round(v2 * 0.48) + 60;
            c.obs.push({ x, kind: "caisse" }, { x: x + dx, kind: "caisse" });
            span = dx + KINDS.caisse.w;
          } else {
            const a = rnd() < 0.5 ? "haie" : "barre", b2 = a === "haie" ? "barre" : "haie";
            const dx = close(0);
            c.obs.push({ x, kind: a }, { x: x + dx, kind: b2 });
            span = dx + KINDS[b2].w;
          }
        }
        else if (r < 0.22) c.obs.push({ x, kind: "haie" });
        else if (r < 0.38) c.obs.push({ x, kind: "barre" });
        else if (r < 0.54) { const w = Math.round(90 + rnd() * (60 + 90 * lvl + 40 * lvl2)); c.gaps.push({ x, w }); span = w; }
        else if (r < 0.66) c.obs.push({ x, kind: "caisse" });
        else if (r < 0.82) c.obs.push({ x, kind: rnd() < 0.5 ? "oiseau_haut" : "oiseau_bas" });
        else c.obs.push({ x, kind: "haie" });
        // L'espace avant le suivant : du temps de réaction (de moins en moins, jusqu'à ~0,4 s).
        const gapT = 1.1 - 0.55 * lvl - 0.2 * lvl2 + rnd() * (0.5 - 0.25 * lvl - 0.12 * lvl2);
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
      const prevY = r.y;
      r.vy -= g * dt; r.y += r.vy * dt;
      const ground = !overGap(c, r.d);
      if (r.y <= 0 && ground) {
        // On retombe sur le sol : même si on descend très vite (on ne « passe » jamais à travers).
        if (prevY >= 0) { r.y = 0; r.vy = 0; r.air = false; }
        // On était déjà dans le trou et on arrive contre son bord : perdu.
        else { r.alive = false; r.fall = true; r.pk = k; return "trou"; }
      }
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
