// ===================================================================
//  PUCK — La patinoire et le palet (partagés serveur + navigateur)
//  Une patinoire aux coins arrondis, un but de chaque côté. Le palet glisse,
//  rebondit sur les bandes, et entre dans les buts par leur ouverture.
//    globalThis.Rink
// ===================================================================

(function (root) {
  const R = {};
  R.W = 1280; R.H = 800;
  R.X0 = 50; R.X1 = 1230; R.Y0 = 70; R.Y1 = 770;   // les bandes
  R.CORNER = 110;                                  // rayon des coins
  R.GOAL = 190;                                    // largeur de l'ouverture du but
  R.DEPTH = 44;                                    // profondeur du but
  R.PUCK_R = 11;
  R.FRICTION = 0.55;                               // le palet perd 55 % de sa vitesse par seconde
  R.CX = (R.X0 + R.X1) / 2; R.CY = (R.Y0 + R.Y1) / 2;
  const gy0 = R.CY - R.GOAL / 2, gy1 = R.CY + R.GOAL / 2;
  R.inMouth = (y) => y > gy0 && y < gy1;

  // Les murs pour les bonshommes (ils n'entrent pas dans les buts).
  R.heroRects = [
    { x: 0, y: 0, w: R.W, h: R.Y0 }, { x: 0, y: R.Y1, w: R.W, h: R.H - R.Y1 },
    { x: 0, y: 0, w: R.X0, h: R.H }, { x: R.X1, y: 0, w: R.W - R.X1, h: R.H },
  ];
  // Les coins arrondis : un bonhomme (ou le palet) reste dans le cercle du coin.
  const corners = [[R.X0 + R.CORNER, R.Y0 + R.CORNER], [R.X1 - R.CORNER, R.Y0 + R.CORNER], [R.X0 + R.CORNER, R.Y1 - R.CORNER], [R.X1 - R.CORNER, R.Y1 - R.CORNER]];
  R.keepIn = function (o, r) {
    for (const [cx, cy] of corners) {
      if ((o.x < cx) !== (cx < R.CX) || (o.y < cy) !== (cy < R.CY)) continue;
      const dx = o.x - cx, dy = o.y - cy, d = Math.hypot(dx, dy), max = R.CORNER - r;
      if (d <= max) continue;
      const nx = dx / d, ny = dy / d;
      o.x = cx + nx * max; o.y = cy + ny * max;
      const vn = o.vx * nx + o.vy * ny;
      if (vn > 0) { o.vx -= 2 * vn * nx * (o.bounce ?? 1); o.vy -= 2 * vn * ny * (o.bounce ?? 1); }
      return true;
    }
    return false;
  };

  // Le palet avance de dt. Renvoie 1 (but à gauche : pour l'équipe 2), 2 (but à droite : pour l'équipe 1) ou 0.
  R.movePuck = function (p, dt) {
    const SUB = 4, d = dt / SUB, r = R.PUCK_R;
    const f = Math.pow(1 - R.FRICTION, dt);
    p.vx *= f; p.vy *= f;
    for (let k = 0; k < SUB; k++) {
      p.x += p.vx * d; p.y += p.vy * d;
      // Dans un but : il rebondit au fond et sur les côtés du but, et c'est but quand il a passé la ligne.
      const mouth = R.inMouth(p.y);
      if (p.x < R.X0 + r && mouth) { if (p.x < R.X0 - r) return 1; }
      else if (p.x > R.X1 - r && mouth) { if (p.x > R.X1 + r) return 2; }
      else {
        if (p.x < R.X0 + r) { p.x = R.X0 + r; p.vx = Math.abs(p.vx) * 0.85; }
        if (p.x > R.X1 - r) { p.x = R.X1 - r; p.vx = -Math.abs(p.vx) * 0.85; }
      }
      if (p.y < R.Y0 + r) { p.y = R.Y0 + r; p.vy = Math.abs(p.vy) * 0.85; }
      if (p.y > R.Y1 - r) { p.y = R.Y1 - r; p.vy = -Math.abs(p.vy) * 0.85; }
      p.bounce = 0.85;
      R.keepIn(p, r);
    }
    return 0;
  };

  root.Rink = R;
})(typeof window !== "undefined" ? window : globalThis);
