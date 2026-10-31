// ===================================================================
//  SUMO — Y a-t-il du sol sous la voiture ?
//  Utilisé par le serveur (qui décide des chutes) ET par le navigateur
//  (pour dessiner et pour la mini-carte). Même code des deux côtés.
//
//  Deux sortes de maps :
//   - "arena"   : un grand rond (centre cx,cy) dont le rayon rétrécit
//   - "islands" : des îles rondes reliées par des couloirs droits
// ===================================================================

(function (root) {
  const G = {};

  // Distance d'un point au segment [A,B].
  function distToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }
  G.distToSegment = distToSegment;

  // Numéro de l'île sous ce point (ou -1).
  G.islandAt = function (map, x, y) {
    if (map.kind !== "islands") return -1;
    return map.islands.findIndex((i) => Math.hypot(x - i.x, y - i.y) <= i.r);
  };

  // Le point (x, y) est-il sur du sol ? (arenaR = rayon actuel de l'arène)
  G.onGround = function (map, x, y, arenaR) {
    if (map.kind === "arena") return Math.hypot(x - map.cx, y - map.cy) <= arenaR;
    if (G.islandAt(map, x, y) >= 0) return true;
    for (const c of map.corridors) {
      const A = map.islands[c.a], B = map.islands[c.b];
      if (distToSegment(x, y, A.x, A.y, B.x, B.y) <= c.w / 2) return true;
    }
    return false;
  };

  root.SumoGround = G;
})(typeof window !== "undefined" ? window : globalThis);
