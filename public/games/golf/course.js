// ===================================================================
//  GOLF DE COMBAT — Le trou et les balles (partagés serveur + navigateur)
//  Un trou tiré d'une seed : un parcours en couloirs (des rectangles mis
//  bout à bout, avec des virages), des blocs, des barrières, des bumpers,
//  de l'eau, du sable, des tapis qui poussent la balle. Du trou très court au très long.
//  Les balles roulent, rebondissent sur les bords et se cognent entre elles.
//    globalThis.Golf
// ===================================================================

(function (root) {
  const G = {};
  G.W = 1280; G.H = 800;
  G.BALL_R = 9;
  G.CUP_R = 15;
  G.ROLL = 0.75;            // la balle perd 75 % de sa vitesse par seconde sur le gazon
  G.SAND = 3.2;             // … beaucoup plus dans le sable
  G.WALL_BOUNCE = 0.72;
  G.BUMP = 1.25;            // un bumper renvoie la balle plus fort
  G.SINK_V = 560;           // au-delà de cette vitesse, la balle saute par-dessus le trou
  G.REST = 8;               // en dessous, la balle est arrêtée
  G.PUSH = 700;             // la poussée d'un tapis (px/s²)

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const inRect = (r, x, y, m = 0) => x >= r.x + m && x <= r.x + r.w - m && y >= r.y + m && y <= r.y + r.h - m;

  // Le trou : 3 à 5 couloirs, chacun part du bout du précédent en tournant.
  G.build = function (seed) {
    // La longueur du trou est tirée une fois (de 1 à 7 couloirs) ; si ça ne rentre pas, on raccourcit peu à peu.
    const want = 1 + Math.floor(seeded(seed ^ 0x601f)() * 7);
    for (let tries = 0; tries < 400; tries++) {
      const h = attempt(seeded(seed + tries * 7919), Math.max(1, want - Math.floor(tries / 80)));
      if (h) return { seed, ...h };
    }
    throw new Error("trou introuvable");
  };
  function attempt(rnd, n) {
    const M = 40, segs = [];
    const width = 125 + Math.floor(rnd() * 115);
    // (x, y) = le centre du carré de départ du couloir : chaque couloir part du carré de virage du précédent.
    let x = M + 20 + rnd() * 120 + width / 2, y = M + 80 + rnd() * 500, dir = 0;    // on part vers la droite
    for (let i = 0; i < n; i++) {
      const L = (n === 1 ? 700 : n <= 2 ? 380 : 220) + rnd() * (n <= 2 ? 420 : 380);
      let r;
      if (dir === 0) r = { x: x - width / 2, y: y - width / 2, w: L, h: width };
      else if (dir === 1) r = { x: x - width / 2, y: y - width / 2, w: width, h: L };
      else r = { x: x - width / 2, y: y + width / 2 - L, w: width, h: L };
      if (r.x < M || r.y < M || r.x + r.w > G.W - M || r.y + r.h > G.H - M) return null;
      // (pas de chevauchement avec un couloir plus ancien, sauf le précédent)
      for (let j = 0; j < segs.length - 1; j++) { const o = segs[j]; if (r.x < o.x + o.w - 2 && r.x + r.w > o.x + 2 && r.y < o.y + o.h - 2 && r.y + r.h > o.y + 2) return null; }
      segs.push(r);
      // Le carré au bout de ce couloir, et le prochain sens (on ne revient jamais en arrière).
      if (dir === 0) x = r.x + r.w - width / 2;
      else if (dir === 1) y = r.y + r.h - width / 2;
      else y = r.y + width / 2;
      dir = dir === 0 ? (rnd() < 0.5 ? 1 : 2) : 0;
    }
    const first = segs[0], last = segs[segs.length - 1];
    const tee = { x: first.x + 50, y: first.y + first.h / 2 };
    // Le trou, au bout du dernier couloir.
    const ld = last.w > last.h ? 0 : last.y + last.h / 2 > (segs.length > 1 ? segs[segs.length - 2].y : 0) + 0 ? 1 : 2;
    let cup;
    if (last.w >= last.h) cup = { x: last.x + last.w - 60, y: last.y + last.h / 2 };
    else {
      const prev = segs[segs.length - 2], goingDown = !prev || last.y >= prev.y;
      cup = { x: last.x + last.w / 2, y: goingDown ? last.y + last.h - 60 : last.y + 60 };
    }
    void ld;
    // Les obstacles : dans les couloirs, jamais sur le départ ni sur le trou.
    const blocks = [], bumpers = [], water = [], sand = [], boosts = [];
    const inside = (x2, y2, m) => segs.some((s) => inRect(s, x2, y2, m));
    const farFrom = (x2, y2, d) => Math.hypot(x2 - tee.x, y2 - tee.y) > d && Math.hypot(x2 - cup.x, y2 - cup.y) > d;
    const clear = (o) => [...blocks, ...water, ...sand, ...boosts].every((p) => o.x > p.x + p.w + 40 || o.x + o.w < p.x - 40 || o.y > p.y + p.h + 40 || o.y + o.h < p.y - 40) && bumpers.every((b) => Math.hypot(b.x - (o.x + o.w / 2), b.y - (o.y + o.h / 2)) > 90);
    // Plus le trou est long, plus il y a d'obstacles.
    const area = segs.reduce((a, s) => a + s.w * s.h, 0);
    const want = Math.round(area / 42000) + 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < 220 && blocks.length + bumpers.length + water.length + sand.length + boosts.length < want; k++) {
      const s = segs[Math.floor(rnd() * segs.length)], u = rnd();
      const cx = s.x + 30 + rnd() * (s.w - 60), cy = s.y + 30 + rnd() * (s.h - 60);
      if (!farFrom(cx, cy, 130)) continue;
      if (u < 0.18) { const o = { x: cx - 18, y: cy - 18, w: 36, h: 36 }; if (inside(cx, cy, 50) && clear(o)) blocks.push(o); }
      else if (u < 0.32) {
        // Une barrière : un mur fin en travers d'une partie du couloir (jamais tout le couloir).
        const across = s.w > s.h, L = Math.min(across ? s.h : s.w, 200) * (0.35 + rnd() * 0.25);
        const o = across ? { x: cx - 7, y: (rnd() < 0.5 ? s.y : s.y + s.h - L), w: 14, h: L } : { x: (rnd() < 0.5 ? s.x : s.x + s.w - L), y: cy - 7, w: L, h: 14 };
        if (clear(o) && farFrom(o.x + o.w / 2, o.y + o.h / 2, 120)) blocks.push(o);
      } else if (u < 0.42) {
        // Un tapis qui pousse la balle (dans le sens du couloir, ou à rebours).
        const along = s.w > s.h, w = along ? 90 + rnd() * 80 : s.w - 20, hh = along ? s.h - 20 : 90 + rnd() * 80;
        const o = { x: along ? cx - w / 2 : s.x + 10, y: along ? s.y + 10 : cy - hh / 2, w, h: hh };
        const sign = rnd() < 0.7 ? 1 : -1, dirx = along ? sign : 0, diry = along ? 0 : sign;
        if (clear(o)) boosts.push({ ...o, dx: dirx, dy: diry });
      } else if (u < 0.6) { const o = { x: cx - 22, y: cy - 22, w: 44, h: 44 }; if (inside(cx, cy, 45) && clear(o)) bumpers.push({ x: cx, y: cy, r: 22 }); }
      else if (u < 0.8) { const w = 70 + rnd() * 60, hh = 50 + rnd() * 40, o = { x: cx - w / 2, y: cy - hh / 2, w, h: hh }; if (inside(o.x, o.y, 0) && inside(o.x + o.w, o.y + o.h, 0) && clear(o)) water.push(o); }
      else { const w = 80 + rnd() * 70, hh = 60 + rnd() * 50, o = { x: cx - w / 2, y: cy - hh / 2, w, h: hh }; if (inside(o.x, o.y, 0) && inside(o.x + o.w, o.y + o.h, 0) && clear(o)) sand.push(o); }
    }
    // Le par : selon la longueur du chemin.
    const len = segs.reduce((a, s) => a + Math.max(s.w, s.h), 0);
    return { segs, tee, cup, blocks, bumpers, water, sand, boosts, par: Math.max(2, Math.min(7, Math.round(len / 420) + 1 + (n >= 5 ? 1 : 0))) };
  }

  // Est-on sur le gazon (dans un couloir, hors d'un bloc) ?
  G.onCourse = (h, x, y) => h.segs.some((s) => inRect(s, x, y, G.BALL_R)) && !h.blocks.some((b) => x > b.x - G.BALL_R && x < b.x + b.w + G.BALL_R && y > b.y - G.BALL_R && y < b.y + b.h + G.BALL_R);
  G.inWater = (h, x, y) => h.water.some((w) => inRect(w, x, y));

  // Une balle roule de dt. Renvoie "eau", "trou" ou null.
  G.roll = function (h, b, dt) {
    const SUB = 4, d = dt / SUB;
    for (let k = 0; k < SUB; k++) {
      const f = Math.pow(1 - (h.sand.some((s) => inRect(s, b.x, b.y)) ? Math.min(0.97, G.ROLL * G.SAND) : G.ROLL), d);
      b.vx *= f; b.vy *= f;
      // Un tapis pousse la balle qui roule dessus (une balle arrêtée y reste, on peut la rejouer).
      for (const t of h.boosts || []) if (inRect(t, b.x, b.y)) { b.vx += t.dx * G.PUSH * d; b.vy += t.dy * G.PUSH * d; }
      if (Math.hypot(b.vx, b.vy) < G.REST * ((h.boosts || []).some((t) => inRect(t, b.x, b.y)) ? 4 : 1)) { b.vx = 0; b.vy = 0; break; }
      // On avance sur chaque axe : si on sort du gazon, on rebondit sur ce bord.
      const nx = b.x + b.vx * d;
      if (G.onCourse(h, nx, b.y)) b.x = nx; else { b.vx = -b.vx * G.WALL_BOUNCE; b.hitWall = true; }
      const ny = b.y + b.vy * d;
      if (G.onCourse(h, b.x, ny)) b.y = ny; else { b.vy = -b.vy * G.WALL_BOUNCE; b.hitWall = true; }
      // Les bumpers.
      for (const p of h.bumpers) {
        const dx = b.x - p.x, dy = b.y - p.y, dist = Math.hypot(dx, dy), min = p.r + G.BALL_R;
        if (dist >= min || dist === 0) continue;
        const nx2 = dx / dist, ny2 = dy / dist, vn = b.vx * nx2 + b.vy * ny2;
        b.x = p.x + nx2 * (min + 0.5); b.y = p.y + ny2 * (min + 0.5);
        if (vn < 0) { b.vx -= (1 + G.BUMP) * vn * nx2; b.vy -= (1 + G.BUMP) * vn * ny2; b.bumped = true; }
      }
      if (G.inWater(h, b.x, b.y)) return "eau";
      const dc = Math.hypot(b.x - h.cup.x, b.y - h.cup.y);
      if (dc < G.CUP_R && Math.hypot(b.vx, b.vy) < G.SINK_V) return "trou";
      // Un peu trop vite : le trou dévie quand même la balle.
      if (dc < G.CUP_R + 4) { b.vx += (h.cup.x - b.x) * 2; b.vy += (h.cup.y - b.y) * 2; }
    }
    return null;
  };
  // Deux balles se cognent (même masse).
  G.collide = function (a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = G.BALL_R * 2;
    if (d >= min || d === 0) return false;
    const nx = dx / d, ny = dy / d, over = (min - d) / 2;
    a.x -= nx * over; a.y -= ny * over; b.x += nx * over; b.y += ny * over;
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) { const j = -0.92 * rv; a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny; }
    return true;
  };

  root.Golf = G;
})(typeof window !== "undefined" ? window : globalThis);
