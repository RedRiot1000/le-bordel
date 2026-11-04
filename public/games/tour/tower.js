// ===================================================================
//  LA TOUR — La tour + la physique du perso (partagé serveur + navigateur)
//  Une tour sans fin tirée d'une seed (la même pour tout le monde) :
//  plateformes fixes, qui s'effritent, qui bougent, cheminées à saut mural,
//  tunnels à passer accroupi, piques (rares). La lave monte depuis le bas.
//  Le serveur et le navigateur font EXACTEMENT les mêmes calculs.
//  y = hauteur (0 = le sol, vers le haut), x = de 0 à W.
//    globalThis.Tower
// ===================================================================

(function (root) {
  const P = {};
  P.TICK = 1 / 30;
  P.SUB = 2;                 // 2 petits pas par calcul (on ne traverse rien)
  P.W = 1280;                // largeur de la tour
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
  P.lavaAt = (t) => -420 + 34 * t + 2 * t * t;

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
  //  LA TOUR (générée au fur et à mesure, toujours dans le même ordre)
  // ===================================================================
  P.tower = function (seed) {
    const rnd = seeded(seed);
    const c = { seed, plats: [], solids: [], spikes: [], main: [], crumbles: {}, bk: new Map(), top: 0, nextChimney: 1400, chim: null };
    const slot = (b) => { let s = c.bk.get(b); if (!s) { s = { p: [], s: [], k: [] }; c.bk.set(b, s); } return s; };
    const addPlat = (o) => { o.id = c.plats.length; o.h = 18; c.plats.push(o); slot(Math.floor(o.y / BK)).p.push(o); return o; };
    const addBox = (list, key, o) => { list.push(o); for (let b = Math.floor(o.y / BK) - 1; b <= Math.floor((o.y + o.h) / BK) + 1; b++) slot(b)[key].push(o); return o; };
    const solid = (o) => addBox(c.solids, "s", o);
    const spike = (o) => addBox(c.spikes, "k", o);
    c.slot = slot;

    // Le sol de départ.
    let last = addPlat({ x: 0, y: 0, w: P.W, kind: "fix", safe: P.W / 2 });
    c.main.push(last);

    c.ensure = (y) => {
      while (c.top < y + 1800) {
        const lvl = Math.min(1, c.top / 9000);
        const yy = Math.round(last.y + 105 + rnd() * (30 + 12 * lvl));
        // Zone interdite au chemin principal (une cheminée à côté).
        let lo = 50, hi = P.W - 50;
        if (c.chim && yy < c.chim.top + 40) { if (c.chim.side < 0) lo = c.chim.edge + 60; else hi = c.chim.edge - 60; }
        const w = Math.round(210 - 90 * lvl + rnd() * 60);
        // Écart avec la plateforme d'avant (bord à bord), vers un côté puis l'autre.
        const gap = Math.round(30 + rnd() * (90 + 50 * lvl));
        const lx = P.platX(last, 0);
        let dir = rnd() < 0.5 ? -1 : 1;
        if (last.away) dir = last.away;      // (la suite part du côté sans piques)
        let x = dir > 0 ? lx + last.w + gap : lx - gap - w;
        if (!last.away && (x < lo || x + w > hi)) { dir = -dir; x = dir > 0 ? lx + last.w + gap : lx - gap - w; }
        x = Math.max(lo, Math.min(hi - w, x));
        const r = rnd();
        let p;
        if (last.y > 300 && r < 0.05 + 0.2 * lvl && !last.amp) {
          // Elle bouge.
          const amp = Math.round(50 + rnd() * 50);
          p = addPlat({ x: Math.max(lo + amp, Math.min(hi - w - amp, x)), y: yy, w, kind: "move", amp, sp: 1.1 + rnd() * 0.8, ph: rnd() * 6.28 });
          p.safe = p.w / 2;
        } else if (last.y > 300 && r < 0.17 + 0.42 * lvl) {
          p = addPlat({ x, y: yy, w, kind: "crumble", safe: w / 2 });
        } else {
          p = addPlat({ x, y: yy, w, kind: "fix", safe: w / 2 });
          const u = rnd();
          if (last.y > 700 && u < 0.08 && w >= 170 && x > 340 && x + w < P.W - 340) {
            // Des piques sur un bout de la plateforme (rare).
            const sw = Math.round(w * 0.36), left = dir < 0;   // à l'autre bout (pas du côté où on arrive)
            spike({ x: left ? x : x + w - sw, y: yy, w: sw, h: 16, up: true });
            p.safe = left ? sw + (w - sw) / 2 : (w - sw) / 2;
            p.away = left ? 1 : -1;
          } else if (last.y > 1100 && u > 0.93 && x > lo + 60 && x + w + 170 < hi) {
            // Tunnel : plateforme plus large, plafond bas hérissé de piques au milieu : on passe accroupi.
            p.w = w + 170; p.tunnel = true;
            const bx = x + Math.round((w + 170) / 2) - 55;
            p.tx = [bx - P.PW, bx + 110 + P.PW]; p.safe = (w + 170) * (dir > 0 ? 0.85 : 0.15);
            solid({ x: bx, y: yy + 34, w: 110, h: 44, low: true });
            spike({ x: bx, y: yy + 78, w: 110, h: 16, up: true });
          }
        }
        c.main.push(p);
        last = p;
        c.top = yy;
        // Une plateforme de côté, de temps en temps (autre chemin, parfois piégé).
        if (rnd() < 0.42) {
          const sw = Math.round(110 + rnd() * 70), sy = yy + Math.round(rnd() * 40 - 20);
          const sx = Math.round(lo + rnd() * (hi - lo - sw));
          const far = sx + sw < p.x - 70 || sx > p.x + p.w + 70;
          if (far) {
            const sp = addPlat({ x: sx, y: sy, w: sw, kind: rnd() < 0.3 ? "crumble" : "fix", side: true });
            if (sp.kind === "fix" && rnd() < 0.13) spike({ x: sx + 10, y: sy, w: sw - 20, h: 16, up: true });
          }
        }
        // Une cheminée (raccourci) : deux murs serrés, on grimpe au saut mural, quelques piques sur les murs.
        if (!c.chim && c.top > c.nextChimney) {
          const side = rnd() < 0.5 ? -1 : 1, H = Math.round(560 + rnd() * 340), y0 = c.top + 110;
          const gapW = 150, t = 30;
          const wx = side < 0 ? gapW : P.W - gapW - t;      // le mur intérieur (l'autre, c'est le mur de la tour)
          solid({ x: wx, y: y0, w: t, h: H, wall: true });
          for (let yy2 = y0 + 170; yy2 < y0 + H - 110; yy2 += 190 + Math.round(rnd() * 120)) {
            if (rnd() < 0.55) {
              const onTower = rnd() < 0.5;
              const sx = onTower ? (side < 0 ? 0 : P.W - 14) : side < 0 ? wx - 14 : wx + t;
              spike({ x: sx, y: yy2, w: 14, h: 54, faces: (onTower ? -side : side) });
            }
          }
          const topP = addPlat({ x: side < 0 ? 0 : wx, y: y0 + H, w: gapW + t + 60, kind: "fix", side: true });
          if (side > 0) topP.x = P.W - topP.w;
          c.chim = { side, edge: side < 0 ? wx + t : wx, top: y0 + H };
          c.nextChimney = y0 + H + 1100 + rnd() * 900;
        }
        if (c.chim && c.top > c.chim.top + 60) c.chim = null;
      }
    };
    c.ensure(0);
    return c;
  };

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

  // Ce qui est visible entre deux hauteurs (pour le dessin).
  P.view = (c, y0, y1) => ({ plats: near(c, y0 - 20, y1 + 20, "p"), solids: near(c, y0, y1, "s"), spikes: near(c, y0, y1, "k") });

  root.Tower = P;
})(typeof window !== "undefined" ? window : globalThis);
