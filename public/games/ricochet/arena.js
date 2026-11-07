// ===================================================================
//  RICOCHET — L'arène et les balles (partagé serveur + navigateur)
//  Une arène tirée d'une seed, symétrique (personne n'est avantagé) :
//  piliers, murs droits et murs en biais. Les balles rebondissent dessus.
//  Tout est rangé comme des segments épais (un rectangle = un segment
//  épais aussi), ce qui donne les mêmes rebonds partout, coins compris.
//    globalThis.Ricochet
// ===================================================================

(function (root) {
  const A = {};
  A.W = 1280; A.H = 800;
  A.BULLET_R = 6;
  A.BULLET_V = 720;          // vitesse d'une balle (px/s)
  A.BOUNCES = 3;             // elle rebondit 3 fois, puis disparaît au mur suivant
  A.LIFE = 6;                // au plus 6 s de vol

  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // Un mur = un segment épais : de (x1,y1) à (x2,y2), épaisseur t.
  const seg = (x1, y1, x2, y2, t) => ({ x1, y1, x2, y2, t });
  // Le point du segment le plus proche de (x,y).
  function closest(s, x, y) {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L2 = dx * dx + dy * dy || 1;
    const f = Math.max(0, Math.min(1, ((x - s.x1) * dx + (y - s.y1) * dy) / L2));
    return { x: s.x1 + dx * f, y: s.y1 + dy * f };
  }
  A.closest = closest;

  // L'arène : la moitié est tirée au hasard, l'autre est sa copie retournée (symétrie centrale).
  A.build = function (seed) {
    const rnd = seeded(seed);
    const W = A.W, H = A.H, cx = W / 2, cy = H / 2;
    const segs = [], kinds = [];
    const mirror = (s) => seg(W - s.x1, H - s.y1, W - s.x2, H - s.y2, s.t);
    // Les zones à laisser libres : les départs (cercle autour du centre et côtés des équipes).
    const keep = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; keep.push({ x: cx + Math.cos(a) * (W / 2 - 130), y: cy + Math.sin(a) * (H / 2 - 110) }); }
    for (let k = 0; k < 4; k++) { keep.push({ x: 110, y: H * ((k + 1) / 5) }, { x: W - 110, y: H * ((k + 1) / 5) }); }
    const clearOf = (s, d) => {
      for (const p of keep) { const q = closest(s, p.x, p.y); if (Math.hypot(q.x - p.x, q.y - p.y) < d) return false; }
      for (const o of segs) for (const [px, py] of [[s.x1, s.y1], [s.x2, s.y2], [(s.x1 + s.x2) / 2, (s.y1 + s.y2) / 2]]) { const q = closest(o, px, py); if (Math.hypot(q.x - px, q.y - py) < 70 + (o.t + s.t) / 2) return false; }
      return true;
    };
    const want = 6 + Math.floor(rnd() * 3);        // assez de murs pour se mettre à l'abri
    for (let tries = 0; tries < 400 && kinds.length < want * 2; tries++) {
      const u = rnd(), x = 160 + rnd() * (W / 2 - 160), y = 100 + rnd() * (H - 200);
      let s, kind;
      if (u < 0.35) { const r = 26 + rnd() * 14; s = seg(x, y, x + 0.01, y, r * 2); kind = "pilier"; }               // un pilier rond
      else if (u < 0.7) { const L = 110 + rnd() * 90, a = rnd() < 0.5 ? 0 : Math.PI / 2; s = seg(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 18); kind = "mur"; }
      else { const L = 110 + rnd() * 80, a = (rnd() < 0.5 ? 1 : -1) * Math.PI / 4; s = seg(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, 16); kind = "biais"; }
      if (s.x1 > W / 2 - 30 || s.x2 > W / 2 - 30 || Math.min(s.y1, s.y2) < 70 || Math.max(s.y1, s.y2) > H - 70) continue;
      if (!clearOf(s, 90)) continue;
      const m = mirror(s);
      if (!clearOf(m, 90)) continue;
      segs.push(s, m); kinds.push(kind, kind);
    }
    // Parfois, un pilier au centre.
    if (rnd() < 0.5) { const s = seg(cx, cy, cx + 0.01, cy, 56); if (clearOf(s, 60)) { segs.push(s); kinds.push("pilier"); } }
    const walls = segs.map((s, i) => ({ ...s, kind: kinds[i] }));
    // Les bords.
    // (les bords sont traités à part dans moveBullet)
    const spawnsFFA = keep.slice(0, 8), spawnsTeam = { 1: keep.filter((p) => p.x === 110), 2: keep.filter((p) => p.x === W - 110) };
    return { seed, walls, spawnsFFA, spawnsTeam };
  };

  // Une balle avance de dt : elle rebondit sur ce qu'elle touche.
  // Renvoie "fin" si elle disparaît (plus de rebonds ou trop vieille), sinon null.
  A.moveBullet = function (b, arena, dt) {
    const SUB = 4, d = dt / SUB, R = A.BULLET_R;
    b.age += dt;
    if (b.age > A.LIFE) return "fin";
    for (let k = 0; k < SUB; k++) {
      b.x += b.vx * d; b.y += b.vy * d;
      // Les bords de l'arène (jamais traversés, même très vite).
      for (const [p, v, lo, hi] of [["x", "vx", R, A.W - R], ["y", "vy", R, A.H - R]]) {
        if (b[p] >= lo && b[p] <= hi) continue;
        b[p] = b[p] < lo ? lo : hi;
        if (b.left <= 0) return "fin";
        b.left--;
        b[v] = b[p] === lo ? Math.abs(b[v]) : -Math.abs(b[v]);
        b.bounced = true;
      }
      for (const s of arena.walls) {
        const q = closest(s, b.x, b.y);
        let nx = b.x - q.x, ny = b.y - q.y;
        const dist = Math.hypot(nx, ny), min = R + s.t / 2;
        if (dist >= min) continue;
        if (dist < 1e-6) { nx = -b.vx; ny = -b.vy; } else { nx /= dist; ny /= dist; }
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) continue;                    // elle s'éloigne déjà
        if (b.left <= 0) return "fin";
        b.left--;
        b.vx -= 2 * vn * nx; b.vy -= 2 * vn * ny;
        b.x = q.x + nx * (min + 0.5); b.y = q.y + ny * (min + 0.5);
        b.bounced = true;
      }
    }
    return null;
  };

  // Une ligne entre deux points est-elle coupée par un mur ? (pour placer les joueurs à l'abri les uns des autres)
  A.blocked = function (arena, a, b) {
    const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 16);
    for (let i = 1; i < n; i++) {
      const x = a.x + ((b.x - a.x) * i) / n, y = a.y + ((b.y - a.y) * i) / n;
      for (const w of arena.walls) { const q = closest(w, x, y); if (Math.hypot(q.x - x, q.y - y) < w.t / 2 + 4) return true; }
    }
    return false;
  };
  // Des départs pour n joueurs : bien éloignés, et le plus possible cachés les uns des autres par des murs.
  A.spawns = function (arena, n, rnd = Math.random) {
    const free = (p) => p.x > 60 && p.y > 60 && p.x < A.W - 60 && p.y < A.H - 60 && arena.walls.every((w) => { const q = closest(w, p.x, p.y); return Math.hypot(q.x - p.x, q.y - p.y) > w.t / 2 + 45; });
    const cand = [];
    for (let i = 0; i < 400 && cand.length < 140; i++) { const p = { x: 70 + rnd() * (A.W - 140), y: 70 + rnd() * (A.H - 140) }; if (free(p)) cand.push(p); }
    const out = [cand[Math.floor(rnd() * cand.length)]];
    while (out.length < n) {
      let best = null, bs = -1e9;
      for (const p of cand) {
        if (out.includes(p)) continue;
        let minD = 1e9, seen = 0;
        for (const q of out) { minD = Math.min(minD, Math.hypot(p.x - q.x, p.y - q.y)); if (!A.blocked(arena, p, q)) seen++; }
        const score = Math.min(minD, 500) - seen * 260;
        if (score > bs) { bs = score; best = p; }
      }
      out.push(best || cand[0]);
    }
    return out;
  };

  // Les murs pour le moteur à pied (les bonshommes ne traversent pas les murs).
  A.heroSegs = (arena) => arena.walls;

  // Le trajet d'une balle tirée d'ici dans cette direction, jusqu'à n rebonds (pour la ligne de visée et les bots).
  // Renvoie les points du trajet (un à chaque rebond, et le dernier), avec l'heure t de passage.
  A.trace = function (arena, x, y, a, n, maxT = 3) {
    const b = { x, y, vx: Math.cos(a) * A.BULLET_V, vy: Math.sin(a) * A.BULLET_V, left: n, age: 0 };
    const pts = [{ x, y, t: 0 }];
    const dt = 1 / 60;
    for (let t = dt; t <= maxT; t += dt) {
      const before = b.left, end = A.moveBullet(b, arena, dt);
      if (end || b.left !== before) pts.push({ x: b.x, y: b.y, t });
      if (end || b.left < n - n) break;
      if (b.left < 0) break;
    }
    if (pts.length === 1 || pts.at(-1).t < maxT - 0.01) pts.push({ x: b.x, y: b.y, t: maxT });
    return pts;
  };

  root.Ricochet = A;
})(typeof window !== "undefined" ? window : globalThis);
