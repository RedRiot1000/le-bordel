// ===================================================================
//  PARKOUR — Parcours + physique du coureur (partagé serveur + navigateur)
//  Un parcours infini tiré d'une seed (le même pour tout le monde), sur
//  3 étages : le sol, des toits, des passerelles. Le coureur avance tout
//  seul de plus en plus vite ; on saute, on s'accroupit, on glisse.
//  Un choc ne tue pas : il ralentit. Le mur qui suit la course, lui, élimine.
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
  P.G = 4200, P.G_HOLD = 2400, P.G_DIVE = 7500;   // gravité (normale, saut maintenu, plongeon)
  P.HOLD = 0.15;            // on peut « porter » le saut un moment en gardant la touche
  P.SLIDE = 0.55;           // durée d'une glissade
  P.START = 900;            // départ : les premiers mètres sont libres
  P.Y1 = 118, P.Y2 = 236;   // les étages (le 1er s'atteint avec un saut maintenu)
  P.SPRING = 1120;          // le tremplin : il envoie un étage plus haut
  P.HIT_SLOW = 0.9, P.HIT_MUL = 0.35, P.HIT_SAFE = 1.4;   // un choc : ralenti, puis protégé un instant
  P.FALL_STALL = 0.8;       // tombé dans un trou : le temps de remonter
  P.BOOST = 1.3, P.BOOST_MUL = 1.35, P.MUD_MUL = 0.72;    // tapis rapide, tapis lent
  P.CRUMBLE = 0.24;         // on ne reste pas plus longtemps sur une dalle qui s'effondre
  P.WALL_GAP = 1100, P.WALL_CLOSE = 7;  // le mur part 110 m derrière et gagne 0,7 m par seconde sur une course parfaite

  // Vitesse (px/s) selon le temps de course : 420 → 996 en 36 s, puis ça monte doucement jusqu'à 1400.
  P.speedAt = (t) => (t < 36 ? 420 + 16 * t : Math.min(1400, 996 + 6 * (t - 36)));
  const D36 = 420 * 36 + 8 * 36 * 36, U = (1400 - 996) / 6;
  // La distance d'une course parfaite au bout de t secondes.
  P.distAt = (t) => (t < 36 ? 420 * t + 8 * t * t : t < 36 + U ? D36 + 996 * (t - 36) + 3 * (t - 36) ** 2 : D36 + 996 * U + 3 * U * U + 1400 * (t - 36 - U));
  P.speedAtDist = (d) => (d < D36 ? Math.sqrt(420 * 420 + 32 * d) : Math.min(1400, Math.sqrt(996 * 996 + 12 * (d - D36))));
  // Où est le mur ?
  P.wallAt = (t) => P.distAt(t) - (P.WALL_GAP - P.WALL_CLOSE * t);

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Les obstacles : largeur, et la zone qui bloque (y0..y1 au-dessus de leur étage).
  const KINDS = {
    haie: { w: 28, y0: 0, y1: 38 },
    caisse: { w: 46, y0: 0, y1: 72 },
    barre: { w: 42, y0: 40, y1: 220 },
    oiseau_haut: { w: 40, y0: 40, y1: 72 },
    oiseau_bas: { w: 40, y0: 10, y1: 40 },
    pique: { w: 48, y0: 0, y1: 34 },          // sort et rentre en rythme
    laser: { w: 16, y0: 0, y1: 0 },           // en bas (il faut sauter) ou en haut (il faut glisser)
    scie: { w: 46, y0: 0, y1: 0 },            // monte et descend
    rapide: { w: 200, pad: true },            // tapis qui accélère
    lent: { w: 300, pad: true },              // tapis qui ralentit
    tremplin: { w: 56, pad: true },           // envoie un étage plus haut
  };
  P.KINDS = KINDS;
  const wOf = (o) => o.w || KINDS[o.kind].w;
  P.wOf = wOf;

  // La zone dangereuse d'un obstacle à l'instant t (au-dessus de son étage), ou null si elle est éteinte.
  P.zone = function (o, t) {
    const K = KINDS[o.kind];
    if (K.pad) return null;
    const u = t + (o.ph || 0);
    if (o.kind === "pique") return u % 1.6 < 0.9 ? [0, 34] : null;
    if (o.kind === "laser") return Math.floor(u / 1.1) % 2 ? [40, o.b ? 110 : 210] : [0, 40];
    if (o.kind === "scie") { const y = 30 + 62 * (0.5 + 0.5 * Math.sin(u * 4.2)); return [y - 22, y + 22]; }
    if (o.kind === "barre" && o.b) return [40, 110];
    return [K.y0, K.y1];
  };

  // ===================================================================
  //  LE PARCOURS (généré au fur et à mesure, toujours dans le même ordre)
  // ===================================================================
  const B = 1024;   // taille d'une tranche de recherche
  P.course = function (seed) {
    const rnd = seeded(seed);
    const c = { seed, obs: [], gaps: [], plats: [], bk: new Map(), lastX: P.START, lastFork: 0 };
    const slot = (i) => { let s = c.bk.get(i); if (!s) { s = { o: [], g: [], p: [] }; c.bk.set(i, s); } return s; };
    const file = (key, it, x, w) => { for (let i = Math.floor(x / B); i <= Math.floor((x + w) / B); i++) slot(i)[key].push(it); };
    const addO = (o) => { o.b = o.b || 0; c.obs.push(o); file("o", o, o.x, wOf(o)); return o; };
    const addG = (x, w) => { const g = { x, w }; c.gaps.push(g); file("g", g, x, w); return g; };
    const addP = (x, w, y, cr) => { const p = { id: c.plats.length + 1, x, w, y, cr: !!cr }; c.plats.push(p); file("p", p, x, w); return p; };
    c.add = { addO, addG, addP };
    const ph = () => Math.round(rnd() * 16) / 10;

    // Un danger à cet endroit. Renvoie la place qu'il prend.
    function one(x, b, lvl) {
      const r = rnd(), kinds = [["haie", 3], ["caisse", 2], ["oiseau_bas", 1.5], ["oiseau_haut", 1.5], [b ? "pique" : "barre", 2.5]];
      if (x > 1500) kinds.push(["pique", 3]);
      if (x > 3000) kinds.push(["laser", 3]);
      if (x > 5000) kinds.push(["scie", 3]);
      const total = kinds.reduce((a, k) => a + k[1], 0);
      let u = r * total, kind = "haie";
      for (const [k, n] of kinds) { if (u < n) { kind = k; break; } u -= n; }
      addO({ x, kind, b, ph: ph() });
      return KINDS[kind].w;
    }

    // Une fourche : un toit au-dessus du sol. En haut, plus rapide et plus de pièges ; en bas, plus sûr et plus lent.
    function fork(x, v, lvl) {
      const L = Math.round(v * (3.4 + rnd() * 1.8)), end = x + L;
      // Le toit, percé de trous.
      let px = x, q = x + Math.round(v * 0.75);
      const holes = [];
      const step = () => Math.round(v * (0.62 - 0.14 * lvl + rnd() * 0.3));
      let upAt = null;
      const wantUp = rnd() < 0.75, upFrom = x + Math.round(L * 0.2);     // souvent, un tremplin vers le 3e étage
      while (q < end - v * 0.7) {
        const u = rnd();
        if (wantUp && upAt === null && q >= upFrom && q < end - v * 1.8) { addO({ x: q, kind: "tremplin", b: P.Y1 }); upAt = q; q += KINDS.tremplin.w; }
        else if (u < 0.3) { const w = Math.round(110 + rnd() * 90); holes.push([q, w]); q += w; }
        else if (u < 0.5) { addO({ x: q, kind: "rapide", b: P.Y1 }); q += KINDS.rapide.w; }
        else q += one(q, P.Y1, lvl);
        q += step();
      }
      for (const [hx, hw] of holes) { addP(px, hx - px, P.Y1); px = hx + hw; }
      addP(px, end - px, P.Y1);
      // La passerelle du 3e étage, après un tremplin.
      if (upAt !== null) {
        const a = upAt + Math.round(v * 0.25), w = Math.min(end - a - 100, Math.round(v * (1.3 + rnd() * 0.8)));
        if (w > 200) {
          addP(a, w, P.Y2);
          addO({ x: a + Math.round(w * 0.3), kind: "rapide", b: P.Y2 });
          if (w > 700) one(a + Math.round(w * 0.7), P.Y2, lvl);
        }
      }
      // En bas : des tapis lents et quelques obstacles simples.
      for (let g = x + 200; g < end - 300;) {
        if (rnd() < 0.55) { const w = Math.round(280 + rnd() * 240); addO({ x: g, kind: "lent", b: 0, w }); g += w + Math.round(v * 0.5); }
        else { addO({ x: g, kind: rnd() < 0.6 ? "haie" : "oiseau_bas", b: 0 }); g += Math.round(v * (0.9 + rnd() * 0.4)); }
      }
      return L + Math.round(v * 0.8);
    }

    c.ensure = (d) => {
      while (c.lastX < d + 4000) {
        const x = c.lastX, v = P.speedAtDist(x);
        const lvl = Math.min(1, x / 25000);
        const r = rnd();
        let span = 0;
        if (x > 2200 && x - c.lastFork > v * 3.5 && r < 0.3) { span = fork(x, v, lvl); c.lastFork = x + span; c.lastX = x + span; continue; }
        if (r < 0.46) {
          // Un trou dans le sol.
          const w = Math.round(90 + rnd() * (70 + 110 * lvl));
          addG(x, w); span = w;
        } else if (r < 0.54 && x > 2000) {
          // Des dalles qui s'effondrent : il faut sauter de l'une à l'autre.
          const w = Math.round(v * (0.55 + rnd() * 0.4));
          addG(x, w); addP(x, w, 0, true); span = w;
        } else if (r < 0.59 && x > 1800) {
          addO({ x, kind: "rapide", b: 0 }); span = KINDS.rapide.w;
        } else if (r < 0.72 && lvl > 0.1) {
          // Deux dangers de suite.
          const w1 = one(x, 0, lvl), dx = w1 + Math.round(v * (0.42 - 0.08 * lvl));
          span = dx + one(x + dx, 0, lvl);
        } else span = one(x, 0, lvl);
        // L'espace avant le suivant : du temps de réaction, de moins en moins.
        const gapT = 0.95 - 0.45 * lvl + rnd() * (0.45 - 0.2 * lvl);
        c.lastX = x + span + Math.round(v * gapT) + 60;
      }
    };
    c.ensure(0);
    return c;
  };
  // Un parcours fait à la main (pour les tests).
  P.flat = function (obs = [], gaps = [], plats = []) {
    const c = P.course(1);
    c.ensure = () => {};
    c.obs = []; c.gaps = []; c.plats = []; c.bk = new Map();
    for (const o of obs) c.add.addO({ ...o });
    for (const g of gaps) c.add.addG(g.x, g.w);
    for (const p of plats) c.add.addP(p.x, p.w, p.y, p.cr);
    return c;
  };

  // ===================================================================
  //  LE COUREUR
  // ===================================================================
  P.newRunner = () => ({ d: 0, y: 0, vy: 0, t: 0, hold: 0, slide: 0, crouch: false, air: false, alive: true, pk: 0, slow: 0, safe: 0, boost: 0, stall: 0, cr: 0, cx: 0, mud: false, hits: 0 });
  P.copy = (r) => ({ d: r.d, y: r.y, vy: r.vy, t: r.t, hold: r.hold, slide: r.slide, crouch: r.crouch, air: r.air, alive: r.alive, pk: r.pk, slow: r.slow, safe: r.safe, boost: r.boost, stall: r.stall, cr: r.cr, cx: r.cx, mud: r.mud, hits: r.hits });
  P.height = (r) => (r.crouch ? P.H_LOW : P.H_STAND);

  const cell = (c, d) => c.bk.get(Math.floor(d / B));
  function overGap(c, d) {
    const s = cell(c, d);
    return !!s && s.g.some((g) => d > g.x + 6 && d < g.x + g.w - 6);
  }
  const GROUND = { y: 0 };
  // Ce qui porte le coureur à cette distance, sous la hauteur top (une plateforme, le sol, ou rien).
  function support(c, r, d, top) {
    let best = null;
    const s = cell(c, d);
    if (s) for (const p of s.p) {
      if (d < p.x || d > p.x + p.w || p.y > top + 0.01 || (p.cr && p.id === r.cx)) continue;
      if (!best || p.y > best.y) best = p;
    }
    if (!best && top >= -0.01 && !overGap(c, d)) return GROUND;
    return best;
  }
  P.support = support;
  // La vitesse du coureur en ce moment.
  P.speedOf = (r) => (r.stall > 0 ? 0 : P.speedAt(r.t) * (r.slow > 0 ? P.HIT_MUL : 1) * (r.boost > 0 ? P.BOOST_MUL : 1) * (r.mud ? P.MUD_MUL : 1));

  // Un calcul (1/30 s). Renvoie "mur" (éliminé), "choc", "trou" ou null.
  P.step = function (r, k, c) {
    const dt = P.TICK;
    if (!r.alive) return null;
    r.t += dt;
    r.safe = Math.max(0, r.safe - dt);
    r.slow = Math.max(0, r.slow - dt);
    r.boost = Math.max(0, r.boost - dt);
    r.pk = r.pk || 0;
    if (r.stall > 0) {
      r.stall = Math.max(0, r.stall - dt);
      r.pk = k;
      if (r.d < P.wallAt(r.t)) { r.alive = false; return "mur"; }
      return null;
    }
    r.d += P.speedOf(r) * dt;
    c.ensure(r.d);
    const jump = k & P.K.JUMP, down = k & P.K.DOWN;
    const press = (bit) => (k & bit) && !(r.pk & bit);
    const under = support(c, r, r.d, r.y);
    let grounded = !!under && under.y === r.y && r.vy <= 0;
    r.mud = false;
    if (grounded) {
      r.vy = 0; r.air = false;
      // Une dalle qui s'effondre : il ne faut pas y rester.
      if (under.cr) { r.cr += dt; if (r.cr > P.CRUMBLE) { r.cx = under.id; r.cr = 0; grounded = false; } }
      else { r.cr = 0; r.cx = 0; }
    }
    if (grounded) {
      if (press(P.K.JUMP)) { r.vy = P.JUMP_V; r.hold = P.HOLD; r.slide = 0; r.air = true; }
      else if (press(P.K.DOWN)) r.slide = P.SLIDE;
      // Les tapis et les tremplins sous les pieds.
      const s = cell(c, r.d);
      if (s) for (const o of s.o) {
        if (!KINDS[o.kind].pad || o.b !== r.y || r.d < o.x || r.d > o.x + wOf(o)) continue;
        if (o.kind === "rapide") r.boost = P.BOOST;
        else if (o.kind === "lent") r.mud = true;
        else if (o.kind === "tremplin" && r.vy <= 0) { r.vy = P.SPRING; r.hold = 0; r.slide = 0; r.air = true; }
      }
    }
    if (!grounded || r.vy > 0) {
      r.air = true;
      const g = down ? P.G_DIVE : jump && r.hold > 0 && r.vy > 0 ? P.G_HOLD : P.G;
      r.hold = Math.max(0, r.hold - dt);
      const prevY = r.y;
      r.vy -= g * dt; r.y += r.vy * dt;
      if (r.vy <= 0) {
        // On se pose sur ce qu'on rencontre en descendant (on ne passe jamais à travers).
        const land = support(c, r, r.d, prevY);
        if (land && r.y <= land.y) { r.y = land.y; r.vy = 0; r.air = false; if (!land.cr) r.cx = 0; }
      }
    }
    r.slide = Math.max(0, r.slide - dt);
    r.crouch = !r.air && (down || r.slide > 0);
    r.pk = k;
    if (r.d < P.wallAt(r.t)) { r.alive = false; return "mur"; }
    // Tombé dans un trou : on remonte plus loin, ça coûte du temps.
    if (r.y < -30) {
      let d = r.d;
      for (let i = 0; i < 40 && overGap(c, d); i++) d += 30;
      r.d = d + 24; r.y = 0; r.vy = 0; r.air = false; r.crouch = false; r.cx = 0; r.cr = 0;
      r.stall = P.FALL_STALL; r.safe = P.HIT_SAFE; r.hits++;
      return "trou";
    }
    // Un obstacle touché : on est ralenti, puis protégé un instant.
    if (r.safe > 0) return null;
    const h = P.height(r), x0 = r.d - P.W / 2, x1 = r.d + P.W / 2;
    const s = cell(c, r.d);
    if (s) for (const o of s.o) {
      if (o.x > x1 || o.x + wOf(o) < x0) continue;
      const z = P.zone(o, r.t);
      if (!z) continue;
      if (r.y < o.b + z[1] && r.y + h > o.b + z[0]) { r.slow = P.HIT_SLOW; r.safe = P.HIT_SAFE; r.boost = 0; r.hits++; return "choc"; }
    }
    return null;
  };

  // Ce qu'il y a entre deux distances (pour le dessin et les bots).
  P.near = function (c, d0, d1) {
    const obs = new Set(), gaps = new Set(), plats = new Set();
    for (let i = Math.floor(d0 / B); i <= Math.floor(d1 / B); i++) {
      const s = c.bk.get(i);
      if (!s) continue;
      for (const o of s.o) obs.add(o);
      for (const g of s.g) gaps.add(g);
      for (const p of s.p) plats.add(p);
    }
    return {
      obs: [...obs].filter((o) => o.x + wOf(o) > d0 && o.x < d1),
      gaps: [...gaps].filter((g) => g.x + g.w > d0 && g.x < d1),
      plats: [...plats].filter((p) => p.x + p.w > d0 && p.x < d1),
    };
  };

  root.Parkour = P;
})(typeof window !== "undefined" ? window : globalThis);
