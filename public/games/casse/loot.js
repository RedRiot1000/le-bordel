// ===================================================================
//  CAMBRIOLEURS — Le butin (partagé serveur + navigateur)
//  Plus un objet vaut cher, plus on est lent en le portant.
//    globalThis.Casse
// ===================================================================

(function (root) {
  const C = {};
  C.FREE_SPEED = 1.15;       // les mains vides (× la vitesse de marche)
  C.GUARD_SPEED = 0.82;      // un gardien
  C.LOOT = {
    argenterie: { name: "Argenterie", emoji: "🥄", value: 100, speed: 1.05 },
    vase: { name: "Vase", emoji: "🏺", value: 300, speed: 0.9 },
    tableau: { name: "Tableau", emoji: "🖼️", value: 600, speed: 0.72 },
    coffre: { name: "Coffre-fort", emoji: "💎", value: 1500, speed: 0.5 },
  };
  C.speedOf = (carry) => (carry ? C.LOOT[carry].speed : C.FREE_SPEED);
  root.Casse = C;
})(typeof window !== "undefined" ? window : globalThis);
