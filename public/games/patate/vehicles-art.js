// ===================================================================
//  DESSIN DES 5 VÉHICULES (partagé par Patate chaude et Sumo)
//  window.VehicleArt.paint(c, type, couleur, toit, volant, estMoi, nitro, ombre)
// ===================================================================

(() => {
  const P = window.PatatePhysics;

  // Vus de dessus, l'avant vers la droite.
  // c = où dessiner (l'arène ou une carte), color = couleur du joueur,
  // roof = couleur du toit en équipe, steer = volant (-1/0/1).
  function paintVehicle(c, type, color, roof, steer, isMe, boost, shadow = true) {
    const V = P.VEHICLES[type] || P.VEHICLES.sport;
    const L = V.L, W = V.W, hl = L / 2, hw = W / 2;
    const glass = "rgba(20,30,50,0.85)", tire = "#111", light = "#fff6b0";
    const wheel = (x, y, w, h, turn = 0) => { c.save(); c.translate(x, y); c.rotate(turn * 0.45); c.fillStyle = tire; c.fillRect(-w / 2, -h / 2, w, h); c.restore(); };

    // Flamme du nitro.
    if (boost) {
      const len = 18 + Math.random() * 14;
      const gr = c.createLinearGradient(-hl, 0, -hl - len, 0);
      gr.addColorStop(0, "rgba(120,200,255,0.95)"); gr.addColorStop(0.4, "rgba(255,170,40,0.9)"); gr.addColorStop(1, "rgba(255,60,20,0)");
      c.fillStyle = gr;
      c.beginPath(); c.moveTo(-hl + 2, -5); c.lineTo(-hl - len, 0); c.lineTo(-hl + 2, 5); c.fill();
    }
    // Ombre.
    if (shadow) { c.fillStyle = "rgba(0,0,0,0.35)"; rr(c, -hl + 3, -hw + 4, L, W, 6); c.fill(); }

    if (type === "moto") {
      // Deux roues dans l'axe, un cadre fin, le pilote au milieu.
      wheel(hl - 7, 0, 12, 5, steer); wheel(-hl + 7, 0, 12, 5);
      c.fillStyle = color; rr(c, -hl + 6, -4, L - 12, 8, 4); c.fill();
      c.strokeStyle = "#222"; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(hl - 11, -hw - 1); c.lineTo(hl - 11, hw + 1); c.stroke();      // guidon
      c.fillStyle = "#333"; c.beginPath(); c.ellipse(-2, 0, 6, hw + 1, 0, 0, Math.PI * 2); c.fill();   // épaules
      c.fillStyle = roof || "#f2f2f2"; c.beginPath(); c.arc(1, 0, 4.5, 0, Math.PI * 2); c.fill();     // casque
      c.fillStyle = light; c.fillRect(hl - 3, -1.5, 3, 3);
    } else if (type === "f1") {
      // Grosses roues à l'air, nez pointu, ailerons, cockpit ouvert.
      for (const s of [-1, 1]) { wheel(hl - 12, s * (hw + 1), 11, 7, steer); wheel(-hl + 9, s * (hw + 1), 13, 8); }
      c.fillStyle = "#1b1b1b"; c.fillRect(hl - 5, -hw - 4, 5, W + 8);            // aileron avant
      c.fillRect(-hl, -hw - 2, 6, W + 4);                                          // aileron arrière
      c.fillStyle = color;
      c.beginPath(); c.moveTo(hl - 2, 0); c.lineTo(hl - 18, -5); c.lineTo(-hl + 8, -hw + 2); c.lineTo(-hl + 8, hw - 2); c.lineTo(hl - 18, 5); c.closePath(); c.fill();
      c.lineWidth = 1.5; c.strokeStyle = "rgba(0,0,0,0.45)"; c.stroke();
      c.fillStyle = "#111"; c.beginPath(); c.ellipse(-3, 0, 7, 4.5, 0, 0, Math.PI * 2); c.fill();   // cockpit
      c.fillStyle = roof || "#ffd23f"; c.beginPath(); c.arc(-3, 0, 3.2, 0, Math.PI * 2); c.fill();  // casque
    } else if (type === "truck") {
      // Cabine à l'avant, grande remorque à l'arrière.
      const cab = 18;
      for (const s of [-1, 1]) { wheel(hl - 9, s * hw, 11, 6, steer); wheel(-hl + 8, s * hw, 12, 6); wheel(-hl + 22, s * hw, 12, 6); }
      c.fillStyle = "#c9ced8"; rr(c, -hl, -hw, L - cab - 2, W, 3); c.fill();      // remorque
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.4)"; c.stroke();
      c.fillStyle = color; c.fillRect(-hl + 2, -hw + 3, L - cab - 6, 5); c.fillRect(-hl + 2, hw - 8, L - cab - 6, 5);   // bandes
      if (roof) { c.fillStyle = roof; c.fillRect(-hl + 10, -5, L - cab - 22, 10); }
      c.fillStyle = color; rr(c, hl - cab, -hw + 1, cab, W - 2, 4); c.fill();      // cabine
      c.strokeStyle = "rgba(0,0,0,0.45)"; c.stroke();
      c.fillStyle = glass; rr(c, hl - 7, -hw + 4, 5, W - 8, 2); c.fill();
      c.fillStyle = light; c.fillRect(hl - 2, -hw + 3, 2, 5); c.fillRect(hl - 2, hw - 8, 2, 5);
    } else if (type === "minivan") {
      // Grosse boîte arrondie, long pare-brise, barres de toit.
      for (const s of [-1, 1]) { wheel(hl - 11, s * hw, 11, 6, steer); wheel(-hl + 10, s * hw, 11, 6); }
      c.fillStyle = color; rr(c, -hl, -hw, L, W, 6); c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.45)"; c.stroke();
      c.fillStyle = roof || "rgba(255,255,255,0.15)"; rr(c, -hl + 9, -hw + 5, L - 24, W - 10, 3); c.fill();   // toit
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 1.5;
      c.beginPath(); c.moveTo(-hl + 9, -hw + 4); c.lineTo(hl - 15, -hw + 4); c.moveTo(-hl + 9, hw - 4); c.lineTo(hl - 15, hw - 4); c.stroke();
      c.fillStyle = glass; rr(c, hl - 14, -hw + 4, 9, W - 8, 2); c.fill(); rr(c, -hl + 3, -hw + 5, 4, W - 10, 2); c.fill();
      c.fillStyle = light; c.fillRect(hl - 3, -hw + 3, 3, 5); c.fillRect(hl - 3, hw - 8, 3, 5);
    } else {
      // Sportive (la voiture d'origine).
      for (const s of [-1, 1]) { wheel(-hl + 10.5, s * hw, 11, 6); wheel(hl - 10, s * hw, 11, 6, steer); }
      c.fillStyle = color; rr(c, -hl, -hw, L, W, 7); c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.45)"; c.stroke();
      c.fillStyle = roof || "rgba(255,255,255,0.18)"; c.fillRect(-8, -hw + 4, 14, W - 8);
      c.fillStyle = glass; rr(c, hl - 18, -hw + 4, 8, W - 8, 2); c.fill(); rr(c, -hl + 6, -hw + 5, 5, W - 10, 2); c.fill();
      c.fillStyle = light; c.fillRect(hl - 3, -hw + 3, 3, 5); c.fillRect(hl - 3, hw - 8, 3, 5);
    }
    // Contour blanc autour de MA voiture.
    if (isMe) { c.lineWidth = 2; c.strokeStyle = "#fff"; rr(c, -hl - 3, -hw - 3, L + 6, W + 6, 8); c.stroke(); }
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  window.VehicleArt = { paint: paintVehicle };
})();
