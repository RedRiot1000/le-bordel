// ===================================================================
//  LE BORDEL — Dessin des personnages vus de dessus (partagé)
//    window.HeroArt.paint(c, h, color, opts)
//  h = { x, y, face, walk, vx, vy, dashT } · color = couleur du joueur
//  opts = { hair, isMe, heavy, alpha, scale, item }
// ===================================================================

(() => {
  const SKIN = ["#f1c27d", "#e0ac69", "#c68642", "#8d5524", "#ffdbac"];
  const HAIR = ["#2b1b12", "#5a3825", "#a0522d", "#d6b370", "#1a1a1a", "#8b2e1f"];

  // Une apparence stable par joueur (peau, cheveux) tirée de son id.
  function looks(id = "") {
    let n = 0;
    for (const ch of String(id)) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
    return { skin: SKIN[n % SKIN.length], hair: HAIR[(n >> 3) % HAIR.length] };
  }

  function shade(hex, f) {
    const v = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, Math.round(((v >> 16) & 255) * f)));
    const g = Math.min(255, Math.max(0, Math.round(((v >> 8) & 255) * f)));
    const b = Math.min(255, Math.max(0, Math.round((v & 255) * f)));
    return `rgb(${r},${g},${b})`;
  }

  // Vu de dessus, regard vers la droite (on tourne selon h.face) :
  // épaules (ovale à la couleur du joueur), bras qui balancent, mains, tête + cheveux.
  function paint(c, h, color, opts = {}) {
    const { skin, hair } = opts.looks || looks(opts.id);
    const s = opts.scale ?? 1;
    const speed = Math.hypot(h.vx || 0, h.vy || 0);
    const swing = Math.sin(h.walk || 0) * Math.min(1, speed / 150) * 7;   // balancement des bras
    c.save();
    c.translate(h.x, h.y);
    if (opts.alpha != null) c.globalAlpha = opts.alpha;
    // Ombre.
    c.fillStyle = "rgba(0,0,0,0.3)";
    c.beginPath(); c.ellipse(3 * s, 5 * s, 15 * s, 13 * s, 0, 0, Math.PI * 2); c.fill();
    c.rotate(h.face || 0);
    c.scale(s, s);
    // Traînée de dash.
    if (h.dashT > 0) {
      const gr = c.createLinearGradient(-34, 0, 0, 0);
      gr.addColorStop(0, "rgba(255,255,255,0)"); gr.addColorStop(1, "rgba(255,255,255,0.55)");
      c.fillStyle = gr; c.beginPath(); c.ellipse(-16, 0, 20, 12, 0, 0, Math.PI * 2); c.fill();
    }
    // Aura « lourd » (bonus).
    if (opts.heavy) {
      c.strokeStyle = "rgba(255,207,64,0.9)"; c.lineWidth = 3;
      c.beginPath(); c.arc(0, 0, 21, 0, Math.PI * 2); c.stroke();
    }
    // Bras + mains (de chaque côté, ils balancent en opposition).
    const pushing = h.pushT > 0;
    for (const side of [-1, 1]) {
      const fx = pushing ? 0 : swing * side;
      if (pushing) {
        // Bras tendus devant (la poussée).
        c.fillStyle = shade(color, 0.75);
        c.beginPath(); c.ellipse(8, side * 9, 9, 4, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = skin;
        c.beginPath(); c.arc(18, side * 8, 4.5, 0, Math.PI * 2); c.fill();
        continue;
      }
      c.fillStyle = shade(color, 0.75);
      c.beginPath(); c.ellipse(fx * 0.5, side * 13, 6, 4.5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = skin;
      c.beginPath(); c.arc(fx + 2, side * 15, 4, 0, Math.PI * 2); c.fill();
    }
    // Objet tenu (lampe, pistolet à peinture…) : dessiné par le jeu.
    if (opts.item) opts.item(c);
    // Épaules (le corps).
    c.fillStyle = color;
    c.beginPath(); c.ellipse(0, 0, 9, 14, 0, 0, Math.PI * 2); c.fill();
    c.lineWidth = 1.5; c.strokeStyle = "rgba(0,0,0,0.45)"; c.stroke();
    // Tête : visage un peu vers l'avant, cheveux sur l'arrière.
    c.fillStyle = skin;
    c.beginPath(); c.arc(1.5, 0, 7.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = hair;
    c.beginPath(); c.arc(1.5, 0, 7.8, Math.PI * 0.62, Math.PI * 1.38); c.closePath(); c.fill();   // cheveux : seulement l'arrière
    c.beginPath(); c.ellipse(-2.5, 0, 4, 6.8, 0, 0, Math.PI * 2); c.fill();
    // Les yeux (on voit vers où il regarde).
    c.fillStyle = "#1b1b1b";
    c.beginPath(); c.arc(5.5, -2.6, 1.2, 0, Math.PI * 2); c.arc(5.5, 2.6, 1.2, 0, Math.PI * 2); c.fill();
    // Nez (pour voir où il regarde).
    c.fillStyle = shade(skin.startsWith("#") ? skin : "#f1c27d", 0.85);
    c.beginPath(); c.arc(8.5, 0, 1.8, 0, Math.PI * 2); c.fill();
    // Contour blanc autour de MOI.
    if (opts.isMe) { c.lineWidth = 2; c.strokeStyle = "#fff"; c.beginPath(); c.arc(0, 0, 19, 0, Math.PI * 2); c.stroke(); }
    c.restore();
  }

  window.HeroArt = { paint, looks };
})();
