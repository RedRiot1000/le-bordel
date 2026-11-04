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
    } else if (type === "lambo") {
      // Lamborghini : en coin très pointu, à facettes, deux bandes blanches, gros aileron.
      for (const s of [-1, 1]) { wheel(-hl + 11, s * hw, 13, 7); wheel(hl - 12, s * hw, 11, 6, steer); }
      c.fillStyle = color;
      c.beginPath(); c.moveTo(hl, -3); c.lineTo(hl - 6, -hw + 2); c.lineTo(hl - 18, -hw); c.lineTo(-hl + 6, -hw); c.lineTo(-hl, -hw + 5);
      c.lineTo(-hl, hw - 5); c.lineTo(-hl + 6, hw); c.lineTo(hl - 18, hw); c.lineTo(hl - 6, hw - 2); c.lineTo(hl, 3); c.closePath(); c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.55)"; c.stroke();
      c.fillStyle = "#f2f2f2"; c.fillRect(-hl + 4, -hw + 2, L - 14, 3); c.fillRect(-hl + 4, hw - 5, L - 14, 3);   // bandes « police »
      c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 1; c.beginPath(); c.moveTo(hl - 4, 0); c.lineTo(-hl + 6, 0); c.stroke();   // arête du capot
      c.fillStyle = glass; c.beginPath(); c.moveTo(hl - 14, -hw + 6); c.lineTo(hl - 22, 0); c.lineTo(hl - 14, hw - 6); c.lineTo(-6, hw - 6); c.lineTo(-10, 0); c.lineTo(-6, -hw + 6); c.closePath(); c.fill();
      c.fillStyle = roof || "rgba(255,255,255,0.2)"; c.fillRect(-16, -hw + 7, 8, W - 14);
      c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(-4, -hw, 10, 3); c.fillRect(-4, hw - 3, 10, 3);          // entrées d'air
      c.fillStyle = "#101010"; c.fillRect(-hl - 2, -hw - 2, 6, W + 4);                                      // aileron
      c.fillStyle = light; c.beginPath(); c.moveTo(hl - 2, -6); c.lineTo(hl - 8, -hw + 3); c.lineTo(hl - 5, -hw + 3); c.closePath(); c.fill();
      c.beginPath(); c.moveTo(hl - 2, 6); c.lineTo(hl - 8, hw - 3); c.lineTo(hl - 5, hw - 3); c.closePath(); c.fill();
    } else if (type === "eclair") {
      // ÉCLAIR : très longue et basse, nez en flèche, éclair jaune sur le capot, long aileron.
      for (const s of [-1, 1]) { wheel(-hl + 12, s * hw, 14, 7); wheel(hl - 14, s * hw, 11, 6, steer); }
      c.fillStyle = color;
      c.beginPath(); c.moveTo(hl + 2, 0); c.lineTo(hl - 10, -hw + 3); c.lineTo(hl - 22, -hw); c.lineTo(-hl + 4, -hw + 1); c.lineTo(-hl, -hw + 5);
      c.lineTo(-hl, hw - 5); c.lineTo(-hl + 4, hw - 1); c.lineTo(hl - 22, hw); c.lineTo(hl - 10, hw - 3); c.closePath(); c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.55)"; c.stroke();
      // L'éclair jaune.
      c.fillStyle = "#ffe14d"; c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(hl - 4, -1); c.lineTo(hl - 14, -5); c.lineTo(hl - 13, -1); c.lineTo(hl - 24, -4); c.lineTo(hl - 15, 2); c.lineTo(hl - 16, -1); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = glass; c.beginPath(); c.moveTo(hl - 24, -hw + 5); c.lineTo(hl - 30, 0); c.lineTo(hl - 24, hw - 5); c.lineTo(-8, hw - 5); c.lineTo(-12, 0); c.lineTo(-8, -hw + 5); c.closePath(); c.fill();
      c.fillStyle = roof || "rgba(255,255,255,0.2)"; c.fillRect(-18, -hw + 6, 8, W - 12);
      c.fillStyle = "#0d0d0d"; c.fillRect(-hl - 3, -hw - 3, 6, W + 6);                       // grand aileron
      c.fillStyle = "#ff3b3b"; c.fillRect(-hl, -hw + 2, 2, 5); c.fillRect(-hl, hw - 7, 2, 5);   // feux arrière
      c.fillStyle = light; c.fillRect(hl - 9, -hw + 4, 4, 3); c.fillRect(hl - 9, hw - 7, 4, 3);
    } else if (type === "vipere") {
      // VIPÈRE : petite et ronde, deux bandes de course, gros pots d'échappement, écailles sur le toit.
      for (const s of [-1, 1]) { wheel(-hl + 10, s * hw, 12, 6); wheel(hl - 10, s * hw, 10, 6, steer); }
      c.fillStyle = color; rr(c, -hl, -hw, L, W, 9); c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.55)"; c.stroke();
      c.fillStyle = "rgba(20,20,20,0.75)"; c.fillRect(-hl + 2, -3.5, L - 4, 2.5); c.fillRect(-hl + 2, 1, L - 4, 2.5);   // bandes
      c.fillStyle = glass; rr(c, hl - 19, -hw + 4, 9, W - 8, 3); c.fill();
      c.fillStyle = roof || "rgba(255,255,255,0.22)"; rr(c, -9, -hw + 4, 12, W - 8, 3); c.fill();
      c.fillStyle = "rgba(0,0,0,0.25)"; for (let k = 0; k < 3; k++) { c.beginPath(); c.arc(-6 + k * 4, -2 + (k % 2) * 4, 2, 0, Math.PI * 2); c.fill(); }   // écailles
      c.fillStyle = "#9aa0a8"; c.beginPath(); c.arc(-hl - 1, -4, 2.5, 0, Math.PI * 2); c.arc(-hl - 1, 4, 2.5, 0, Math.PI * 2); c.fill();   // pots
      c.fillStyle = "#3dff7a"; c.beginPath(); c.moveTo(hl - 1, -hw + 4); c.lineTo(hl - 6, -hw + 3); c.lineTo(hl - 3, -hw + 7); c.fill();   // phares « yeux de serpent »
      c.beginPath(); c.moveTo(hl - 1, hw - 4); c.lineTo(hl - 6, hw - 3); c.lineTo(hl - 3, hw - 7); c.fill();
    } else if (type === "titan") {
      // TITAN : large et carrée, pare-buffle à l'avant, gros pneus, capot nervuré.
      for (const s of [-1, 1]) { wheel(-hl + 12, s * (hw + 1), 15, 8); wheel(hl - 13, s * (hw + 1), 14, 8, steer); }
      c.fillStyle = color; rr(c, -hl, -hw, L, W, 5); c.fill();
      c.lineWidth = 2.5; c.strokeStyle = "rgba(0,0,0,0.6)"; c.stroke();
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 1.5;
      for (const y of [-6, 0, 6]) { c.beginPath(); c.moveTo(hl - 4, y); c.lineTo(hl - 16, y); c.stroke(); }   // nervures du capot
      c.fillStyle = glass; rr(c, hl - 25, -hw + 5, 8, W - 10, 2); c.fill();
      c.fillStyle = roof || "rgba(255,255,255,0.18)"; rr(c, -16, -hw + 5, 18, W - 10, 3); c.fill();
      c.fillStyle = "#2a2a2a"; c.fillRect(hl - 1, -hw + 1, 5, W - 2);                     // pare-buffle
      c.fillStyle = "#777"; for (let k = -hw + 4; k < hw - 3; k += 5) c.fillRect(hl, k, 4, 2);
      c.fillStyle = "#111"; c.fillRect(-hl - 2, -hw + 3, 4, W - 6);                        // pare-chocs arrière
      c.fillStyle = light; c.fillRect(hl - 4, -hw + 2, 3, 6); c.fillRect(hl - 4, hw - 8, 3, 6);
    } else if (type === "supercar") {
      // Basse et pointue, grosses entrées d'air, aileron arrière.
      for (const s of [-1, 1]) { wheel(-hl + 11, s * hw, 12, 7); wheel(hl - 11, s * hw, 11, 6, steer); }
      c.fillStyle = color;
      c.beginPath(); c.moveTo(hl, -hw + 6); c.lineTo(hl - 10, -hw); c.lineTo(-hl + 4, -hw); c.lineTo(-hl, -hw + 4);
      c.lineTo(-hl, hw - 4); c.lineTo(-hl + 4, hw); c.lineTo(hl - 10, hw); c.lineTo(hl, hw - 6); c.closePath(); c.fill();
      c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.5)"; c.stroke();
      c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(-6, -hw + 1, 12, 4); c.fillRect(-6, hw - 5, 12, 4);   // entrées d'air
      c.fillStyle = glass; c.beginPath(); c.moveTo(hl - 12, -hw + 5); c.lineTo(hl - 20, 0); c.lineTo(hl - 12, hw - 5); c.lineTo(-4, hw - 5); c.lineTo(-4, -hw + 5); c.closePath(); c.fill();
      c.fillStyle = roof || "rgba(255,255,255,0.15)"; c.fillRect(-12, -hw + 6, 8, W - 12);
      c.fillStyle = "#151515"; c.fillRect(-hl - 1, -hw - 1, 5, W + 2);                                   // aileron
      c.fillStyle = light; c.fillRect(hl - 3, -hw + 5, 3, 4); c.fillRect(hl - 3, hw - 9, 3, 4);
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
  // ===================================================================
  //  REPÈRE « C'EST TOI » (début de manche) : des ondes qui partent de
  //  ton véhicule, un anneau à ta couleur et une grosse flèche « TOI ».
  //  alpha : 1 = bien visible, 0 = caché (il s'efface après le départ).
  //  size : agrandissement (pour garder la même taille à l'écran quelle que soit l'arène).
  // ===================================================================
  function markMe(c, x, y, ts, color, alpha = 1, size = 1) {
    if (alpha <= 0) return;
    c.save();
    c.translate(x, y); c.scale(size, size); x = 0; y = 0;
    c.globalAlpha = alpha;
    const t = ts / 1000;
    // Ondes qui s'agrandissent (2 décalées).
    for (let i = 0; i < 2; i++) {
      const f = (t * 0.9 + i / 2) % 1;
      c.beginPath(); c.arc(x, y, 26 + f * 80, 0, Math.PI * 2);
      c.strokeStyle = color; c.lineWidth = 5 * (1 - f);
      c.globalAlpha = alpha * (1 - f) * 0.9;
      c.stroke();
    }
    c.globalAlpha = alpha;
    // Anneau fixe : blanc + couleur du joueur.
    c.beginPath(); c.arc(x, y, 34, 0, Math.PI * 2);
    c.lineWidth = 6; c.strokeStyle = "rgba(255,255,255,0.95)"; c.stroke();
    c.lineWidth = 3; c.strokeStyle = color; c.stroke();
    // Flèche qui rebondit + étiquette « TOI ».
    const bob = Math.sin(t * 6) * 6;
    const ay = y - 60 + bob;   // (au-dessus du pseudo)
    c.fillStyle = "#ffe14d"; c.strokeStyle = "rgba(0,0,0,0.8)"; c.lineWidth = 3;
    c.beginPath(); c.moveTo(x - 14, ay - 16); c.lineTo(x + 14, ay - 16); c.lineTo(x, ay); c.closePath();
    c.stroke(); c.fill();
    c.font = "900 20px Segoe UI, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    const ly = ay - 32;
    c.fillStyle = "#ffe14d"; rr(c, x - 32, ly - 14, 64, 28, 14); c.fill();
    c.lineWidth = 2; c.strokeStyle = "rgba(0,0,0,0.8)"; c.stroke();
    c.fillStyle = "#1a1a1a"; c.fillText("TOI", x, ly + 1);
    c.restore();
  }

  // Visibilité du repère : plein pendant le compte à rebours et 2 s après le départ, puis s'efface en 1 s.
  function markAlpha(phase, playSeenAt) {
    if (phase === "countdown") return 1;
    if (phase !== "play" || !playSeenAt) return 0;
    return Math.max(0, Math.min(1, 1 - (performance.now() - playSeenAt - 2000) / 1000));
  }

  // ===================================================================
  //  BARRE DE RECHARGE (nitro, taser…) — dessinée à l'écran, sous une mini-carte.
  //  v : 0 → 1. kind : "nitro" (bleu, orange quand ça pousse, rouge si presque vide)
  //  ou "cd" (jaune qui se remplit, « PRÊT » qui clignote quand c'est plein).
  // ===================================================================
  function bar(c, x, y, w, h, v, label, kind = "nitro", on = false, right = "") {
    const t = performance.now() / 1000;
    v = Math.max(0, Math.min(1, v));
    c.save();
    c.fillStyle = "rgba(0,0,0,0.65)"; rr(c, x, y, w, h, h / 2); c.fill();
    let col;
    if (kind === "nitro") col = on ? (Math.floor(t * 12) % 2 ? "#ffb020" : "#ff6a00") : v < 0.25 ? (Math.floor(t * 4) % 2 ? "#ff4d4d" : "#b01e1e") : "#3bb8ff";
    else col = v >= 1 ? (Math.floor(t * 3) % 2 ? "#ffe14d" : "#ffc400") : "rgba(255,225,77,0.75)";
    if (v > 0.01) { c.fillStyle = col; rr(c, x + 3, y + 3, Math.max(h - 6, (w - 6) * v), h - 6, (h - 6) / 2); c.fill(); }
    c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 2; rr(c, x, y, w, h, h / 2); c.stroke();
    c.font = `900 ${Math.round(h * 0.6)}px Segoe UI, sans-serif`; c.textBaseline = "middle";
    c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.85)"; c.fillStyle = "#fff";
    c.textAlign = "left"; c.strokeText(label, x + 12, y + h / 2 + 1); c.fillText(label, x + 12, y + h / 2 + 1);
    if (right) { c.textAlign = "right"; c.strokeText(right, x + w - 12, y + h / 2 + 1); c.fillText(right, x + w - 12, y + h / 2 + 1); }
    c.restore();
  }

  window.VehicleArt = { paint: paintVehicle, markMe, markAlpha, bar };
})();
