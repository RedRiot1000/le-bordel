// ===================================================================
//  LE BORDEL — Moteur « bonhomme » (partagé serveur + navigateur)
//  Les personnages à pied vus de dessus : déplacement 8 directions avec
//  un peu d'inertie, dash, chocs entre joueurs (on se pousse), murs.
//  Comme physics.js pour les voitures : le serveur et le navigateur font
//  EXACTEMENT les mêmes calculs (prédiction sans retard).
//    globalThis.Pieton
// ===================================================================

(function (root) {
  const H = {};
  H.TICK = 1 / 30;          // un calcul = 1/30 s (comme les voitures)
  H.SUB = 2;                // découpé en 2 petits pas (chocs plus justes)
  H.R = 16;                 // rayon d'un bonhomme (px)
  H.SPEED = 230;            // vitesse de marche (px/s)
  H.ACCEL = 1900;           // pour atteindre la vitesse / s'arrêter (px/s²)
  H.DASH_SPEED = 680;       // vitesse pendant un dash
  H.DASH_TIME = 0.16;       // durée d'un dash (s)
  H.DASH_CD = 2;            // recharge du dash (s)
  H.KNOCK = 560;            // force d'un coup de dash
  H.STUN = 0.35;            // temps où on contrôle mal après un coup (s)
  H.HEAVY_MASS = 3;         // masse quand on est « lourd » (bonus)
  // Poussée (env.push : Espace = on tend les bras, sans bouger ; ceux qui sont juste devant sont repoussés)
  H.PUSH_CD = 0.9;          // recharge (s)
  H.PUSH_TIME = 0.2;        // bras tendus (pour le dessin)
  H.PUSH_REACH = 30;        // portée devant soi (en plus des deux corps)
  H.PUSH_ANGLE = 1.25;      // demi-angle devant soi (rad, ~70°)
  H.PUSH_FORCE = 540;       // vitesse donnée à celui qu'on pousse

  // Touches (les mêmes bits pour tous les jeux à pied).
  H.K = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, DASH: 16, FIRE: 32 };

  H.newHero = (x, y, face = 0) => ({ x, y, vx: 0, vy: 0, face, dash: 0, dashT: 0, pushT: 0, stun: 0, heavy: 0, walk: 0 });
  H.copy = (h) => ({ x: h.x, y: h.y, vx: h.vx, vy: h.vy, face: h.face, dash: h.dash, dashT: h.dashT, pushT: h.pushT || 0, stun: h.stun, heavy: h.heavy, walk: h.walk });
  H.mass = (h) => (h.heavy > 0 ? H.HEAVY_MASS : 1);

  // Direction voulue d'après les touches (vecteur de longueur 1, ou 0).
  function wish(k) {
    let x = (k & H.K.RIGHT ? 1 : 0) - (k & H.K.LEFT ? 1 : 0);
    let y = (k & H.K.DOWN ? 1 : 0) - (k & H.K.UP ? 1 : 0);
    const l = Math.hypot(x, y);
    return l ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  // ===================================================================
  //  DÉPLACEMENT d'un petit pas de temps (sans les chocs)
  //  aim : angle visé à la souris (ou null : on regarde où on marche)
  // ===================================================================
  H.drive = function (h, k, aim, dt, env = {}) {
    const w = wish(k);
    const speed = H.SPEED * (env.speedMul || 1);
    h.dash = Math.max(0, h.dash - dt);
    h.heavy = Math.max(0, h.heavy - dt);
    h.pushT = Math.max(0, (h.pushT || 0) - dt);
    // Mode « poussée » : Espace = bras tendus (on ne bouge pas plus vite). Le jeu applique la poussée (H.applyPush).
    if (env.push && k & H.K.DASH && h.dash <= 0) { h.pushT = H.PUSH_TIME; h.dash = H.PUSH_CD; h.pushed = true; }
    if (h.dashT > 0) {
      h.dashT = Math.max(0, h.dashT - dt);          // en plein dash : on file tout droit
    } else {
      // Dash : dans la direction où on va (sinon devant soi).
      if (k & H.K.DASH && h.dash <= 0 && !env.noDash && !env.push) {
        const d = w.x || w.y ? w : { x: Math.cos(h.face), y: Math.sin(h.face) };
        h.vx = d.x * H.DASH_SPEED; h.vy = d.y * H.DASH_SPEED;
        h.dashT = H.DASH_TIME; h.dash = H.DASH_CD;
      } else {
        // Marche : on va vers la vitesse voulue avec un peu d'inertie (moins de contrôle si on vient d'être poussé).
        const acc = H.ACCEL * (h.stun > 0 ? 0.22 : 1) * dt;
        const dx = w.x * speed - h.vx, dy = w.y * speed - h.vy, l = Math.hypot(dx, dy);
        if (l <= acc) { h.vx += dx; h.vy += dy; } else { h.vx += (dx / l) * acc; h.vy += (dy / l) * acc; }
      }
    }
    h.stun = Math.max(0, h.stun - dt);
    h.x += h.vx * dt; h.y += h.vy * dt;
    const v = Math.hypot(h.vx, h.vy);
    h.walk = (h.walk + v * dt * 0.06) % (Math.PI * 2);
    if (typeof aim === "number") h.face = aim;
    else if (v > 30) h.face = Math.atan2(h.vy, h.vx);
  };

  // ===================================================================
  //  MURS : le bord de la carte (si env.walls) et des rectangles
  // ===================================================================
  H.collideWalls = function (h, env = {}) {
    const R = H.R;
    if (env.walls) {
      if (h.x < R) { h.x = R; h.vx = Math.max(0, h.vx); }
      if (h.y < R) { h.y = R; h.vy = Math.max(0, h.vy); }
      if (h.x > env.w - R) { h.x = env.w - R; h.vx = Math.min(0, h.vx); }
      if (h.y > env.h - R) { h.y = env.h - R; h.vy = Math.min(0, h.vy); }
    }
    for (const o of env.rects || []) {
      const qx = Math.max(o.x, Math.min(h.x, o.x + o.w)), qy = Math.max(o.y, Math.min(h.y, o.y + o.h));
      let dx = h.x - qx, dy = h.y - qy, d = Math.hypot(dx, dy);
      if (d >= R) continue;
      if (d === 0) { dx = 0; dy = -1; d = 1; }
      const nx = dx / d, ny = dy / d;
      h.x = qx + nx * R; h.y = qy + ny * R;
      const vn = h.vx * nx + h.vy * ny;
      if (vn < 0) { h.vx -= vn * nx; h.vy -= vn * ny; }
    }
  };

  // ===================================================================
  //  CHOC entre deux bonshommes : on se sépare, et un dash projette l'autre.
  //  fixedB : b ne bouge pas (sert à la prédiction : les autres sont « au présent »)
  // ===================================================================
  H.collideHeroes = function (a, b, fixedB = false) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let d = Math.hypot(dx, dy);
    const min = H.R * 2;
    if (d >= min) return { touch: false };
    if (d === 0) d = 0.01;
    const nx = dx / d, ny = dy / d, over = min - d;
    const ma = H.mass(a), mb = fixedB ? 1e9 : H.mass(b);
    const ta = mb / (ma + mb), tb = ma / (ma + mb);
    a.x -= nx * over * ta; a.y -= ny * over * ta;
    if (!fixedB) { b.x += nx * over * tb; b.y += ny * over * tb; }
    let hit = null;
    // Un dash qui touche : l'autre est projeté (moins s'il est lourd), et le dash s'arrête.
    if (a.dashT > 0 && !(b.dashT > 0)) hit = { from: a, to: b, n: 1 };
    else if (b.dashT > 0 && !(a.dashT > 0)) hit = { from: b, to: a, n: -1 };
    if (hit) {
      const f = H.KNOCK * Math.min(2, H.mass(hit.from) / H.mass(hit.to));
      if (!(fixedB && hit.to === b)) {
        hit.to.vx += nx * hit.n * f; hit.to.vy += ny * hit.n * f;
        hit.to.stun = H.STUN;
      }
      hit.from.dashT = 0;
      hit.from.vx *= 0.3; hit.from.vy *= 0.3;
      return { touch: true, dash: true, by: hit.from === a ? "a" : "b", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    // Simple bousculade : on échange un peu de vitesse le long du choc.
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv < 0) {
      const j = (-1.3 * rv) / (1 / ma + 1 / mb);
      a.vx -= (j / ma) * nx; a.vy -= (j / ma) * ny;
      if (!fixedB) { b.vx += (j / mb) * nx; b.vy += (j / mb) * ny; }
    }
    return { touch: true, dash: false, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  };

  // La poussée de « a » : tous ceux qui sont juste devant lui sont repoussés (moins s'ils sont lourds).
  // Renvoie la liste des bonshommes touchés.
  H.applyPush = function (a, others) {
    const hits = [];
    for (const b of others) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d > H.R * 2 + H.PUSH_REACH || d < 0.01) continue;
      const diff = Math.atan2(Math.sin(Math.atan2(dy, dx) - a.face), Math.cos(Math.atan2(dy, dx) - a.face));
      if (Math.abs(diff) > H.PUSH_ANGLE) continue;
      const f = H.PUSH_FORCE * Math.min(2, H.mass(a) / H.mass(b));
      b.vx += (dx / d) * f; b.vy += (dy / d) * f;
      b.stun = H.STUN;
      hits.push(b);
    }
    return hits;
  };

  // Un calcul complet (1/30 s) pour UN bonhomme : déplacement, murs, chocs avec les autres.
  H.simulate = function (h, k, aim, env, others = null) {
    const dt = H.TICK / H.SUB;
    for (let i = 0; i < H.SUB; i++) {
      H.drive(h, k, aim, dt, env);
      H.collideWalls(h, env);
      if (others) for (const o of others) H.collideHeroes(h, o, true);
    }
  };

  // Où sera un bonhomme dans t secondes s'il garde sa vitesse ?
  H.extrapolate = (h, t) => ({ ...h, x: h.x + h.vx * t, y: h.y + h.vy * t });

  root.Pieton = H;
})(typeof window !== "undefined" ? window : globalThis);
