// ===================================================================
//  CAR-FOOT — Le terrain et le ballon (partagés serveur + navigateur)
//  Le terrain : un rectangle avec une cage au milieu de chaque petit
//  côté. Les voitures peuvent entrer dans les cages. Le ballon rebondit
//  sur les murs et se fait frapper par les voitures.
// ===================================================================

(function (root) {
  const P = root.PatatePhysics;
  const B = {};

  // --- Terrain ---
  B.FW = 1500;          // longueur du terrain (sans les cages)
  B.FH = 900;           // largeur
  B.GD = 70;            // profondeur des cages
  B.GH = 260;           // ouverture des cages
  B.W = B.FW + 2 * B.GD;  // tout le monde (terrain + 2 cages)
  B.H = B.FH;
  B.goalTop = (B.H - B.GH) / 2;
  B.goalBot = (B.H + B.GH) / 2;

  // Les blocs à côté des cages (ce qui fait que les cages sont des "trous" dans les murs).
  B.obstacles = [
    { x: 0, y: 0, w: B.GD, h: B.goalTop },
    { x: 0, y: B.goalBot, w: B.GD, h: B.H - B.goalBot },
    { x: B.GD + B.FW, y: 0, w: B.GD, h: B.goalTop },
    { x: B.GD + B.FW, y: B.goalBot, w: B.GD, h: B.H - B.goalBot },
  ];
  B.env = () => ({ w: B.W, h: B.H, grip: 1, oils: [], obstacles: B.obstacles, nitro: true });

  // --- Ballon ---
  B.R = 22;             // rayon
  B.MASS = 0.45;        // une voiture pèse 1
  B.DRAG = 0.45;        // ralentit tout seul (par seconde)
  B.WALL_E = 0.75;      // rebond sur les murs
  B.CAR_E = 0.6;        // rebond sur les voitures
  B.KICK = 0.25;        // petit bonus de frappe (une voiture qui fonce tire fort)
  B.MAX = 1100;         // vitesse max du ballon

  B.newBall = () => ({ x: B.W / 2, y: B.H / 2, vx: 0, vy: 0 });

  // Rebond contre un point fixe (mur / coin d'un bloc) : n = direction qui repousse.
  function bounce(b, nx, ny, pen) {
    b.x += nx * pen; b.y += ny * pen;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) { b.vx -= (1 + B.WALL_E) * vn * nx; b.vy -= (1 + B.WALL_E) * vn * ny; }
  }

  // Le ballon avance de dt (murs + blocs, pas les voitures).
  B.move = function (b, dt) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    const k = Math.exp(-B.DRAG * dt);
    b.vx *= k; b.vy *= k;
    const R = B.R;
    if (b.x < R) bounce(b, 1, 0, R - b.x);
    if (b.x > B.W - R) bounce(b, -1, 0, b.x - (B.W - R));
    if (b.y < R) bounce(b, 0, 1, R - b.y);
    if (b.y > B.H - R) bounce(b, 0, -1, b.y - (B.H - R));
    for (const o of B.obstacles) {
      const qx = Math.max(o.x, Math.min(b.x, o.x + o.w)), qy = Math.max(o.y, Math.min(b.y, o.y + o.h));
      const dx = b.x - qx, dy = b.y - qy, d = Math.hypot(dx, dy);
      if (d < R && d > 0) bounce(b, dx / d, dy / d, R - d);
    }
    // Dans un coin : une petite pente le ramène vers le milieu (sinon il s'y coince).
    const cx = Math.min(b.x - B.GD, B.GD + B.FW - b.x), cy = Math.min(b.y, B.H - b.y);
    if (cx < 70 && cy < 70) {
      b.vx += Math.sign(B.W / 2 - b.x) * 250 * dt;
      b.vy += Math.sign(B.H / 2 - b.y) * 250 * dt;
    }
  };

  // Choc ballon <-> voiture (la voiture est un rectangle). Renvoie true s'ils se touchent.
  B.hitCar = function (b, c) {
    const V = P.VEHICLES[c.type] || P.VEHICLES.sport;
    const fx = Math.cos(c.a), fy = Math.sin(c.a);
    const dx = b.x - c.x, dy = b.y - c.y;
    const lx = dx * fx + dy * fy, ly = -dx * fy + dy * fx;     // ballon dans le repère de la voiture
    const hl = V.L / 2, hw = V.W / 2;
    const qx = Math.max(-hl, Math.min(hl, lx)), qy = Math.max(-hw, Math.min(hw, ly));
    let nlx = lx - qx, nly = ly - qy;
    let d = Math.hypot(nlx, nly), pen;
    if (d >= B.R) return false;
    if (d > 0) { nlx /= d; nly /= d; pen = B.R - d; }
    else {
      // Le centre du ballon est dans la voiture : on le sort par le côté le plus proche.
      const ex = hl - Math.abs(lx), ey = hw - Math.abs(ly);
      if (ex < ey) { nlx = Math.sign(lx) || 1; nly = 0; pen = ex + B.R; }
      else { nlx = 0; nly = Math.sign(ly) || 1; pen = ey + B.R; }
    }
    // Retour dans le repère du monde.
    const nx = nlx * fx - nly * fy, ny = nlx * fy + nly * fx;
    const mc = V.mass, mb = B.MASS;
    // On les sépare (le plus léger bouge le plus).
    b.x += nx * pen * (mc / (mc + mb)); b.y += ny * pen * (mc / (mc + mb));
    c.x -= nx * pen * (mb / (mc + mb)); c.y -= ny * pen * (mb / (mc + mb));
    // Vitesse du point touché de la voiture (avance + rotation).
    const px = b.x - nx * B.R - c.x, py = b.y - ny * B.R - c.y;
    const cvx = c.vx - c.w * py, cvy = c.vy + c.w * px;
    const vn = (b.vx - cvx) * nx + (b.vy - cvy) * ny;
    if (vn < 0) {
      const j = (-(1 + B.CAR_E) * vn) / (1 / mb + 1 / mc);
      b.vx += (j / mb) * nx * (1 + B.KICK); b.vy += (j / mb) * ny * (1 + B.KICK);
      c.vx -= (j / mc) * nx; c.vy -= (j / mc) * ny;
    }
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > B.MAX) { b.vx *= B.MAX / sp; b.vy *= B.MAX / sp; }
    return true;
  };

  // Le ballon est-il entré dans une cage ? "left" / "right" / null.
  B.goal = function (b) {
    if (b.y > B.goalTop && b.y < B.goalBot) {
      if (b.x < B.GD - B.R) return "left";
      if (b.x > B.GD + B.FW + B.R) return "right";
    }
    return null;
  };

  // Où sera le ballon dans t secondes (pour l'afficher "au présent").
  B.extrapolate = function (b, t) {
    const k = (1 - Math.exp(-B.DRAG * t)) / B.DRAG;
    return { ...b, x: b.x + b.vx * k, y: b.y + b.vy * k };
  };

  root.CarFootBall = B;
})(typeof window !== "undefined" ? window : globalThis);
