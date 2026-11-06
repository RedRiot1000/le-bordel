// ===================================================================
//  LE BORDEL — Dessin du manoir hanté (partagé : Lampe torche, La Nuit du Tueur)
//    window.ManoirArt.paint(manoir, seed) -> un canvas avec tout le décor fixe
//    window.ManoirArt.dynamic(c, manoir, doorsOpen, litRooms, websAlive)
//      -> portes (ouvertes / fermées), interrupteurs, toiles d'araignée
// ===================================================================

(() => {
  const M = window.Manoir;
  const FLOORS = {
    salon: ["#6b4a2f", "#5e4129"], chambre: ["#5a3a4a", "#50334a"], cuisine: ["#c9c3b4", "#8d877a"], bibliotheque: ["#7a5636", "#6d4c2f"],
    bain: ["#9fb7c0", "#86a1ab"], manger: ["#4f3a2a", "#463325"], hall: ["#d8d2c4", "#2b2622"], bal: ["#8a6a3e", "#7a5c34"],
    couloir: ["#5b3f2a", "#7a2a35"], placard: ["#4d3a2c", "#433326"], bureau: ["#6d4c2f", "#5f4229"], cave: ["#4a4744", "#3e3b38"], chaufferie: ["#3d3b39", "#2f2d2b"],
  };
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  function floor(c, r, rnd) {
    const kind = r.kind;
    const [a, b] = FLOORS[kind] || FLOORS.salon;
    c.fillStyle = a; c.fillRect(r.x, r.y, r.w, r.h);
    if (kind === "cuisine" || kind === "bain" || kind === "hall") {
      // Carrelage en damier (le hall : grand damier noir et blanc).
      const s = kind === "bain" ? 20 : kind === "hall" ? 40 : 26;
      c.fillStyle = b;
      for (let x = 0; x < r.w; x += s) for (let y = 0; y < r.h; y += s) if (((x + y) / s) % 2 === 0) c.fillRect(r.x + x, r.y + y, Math.min(s, r.w - x), Math.min(s, r.h - y));
    } else if (kind === "chambre") {
      for (let k = 0; k < (r.w * r.h) / 60; k++) { c.fillStyle = k % 2 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.04)"; c.fillRect(r.x + rnd() * r.w, r.y + rnd() * r.h, 2, 2); }
    } else if (kind === "cave" || kind === "chaufferie") {
      // Dalles de pierre.
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 2;
      for (let y = 0; y < r.h; y += 34) { c.beginPath(); c.moveTo(r.x, r.y + y); c.lineTo(r.x + r.w, r.y + y); c.stroke(); for (let x = ((y / 34) % 2) * 25; x < r.w; x += 50) { c.beginPath(); c.moveTo(r.x + x, r.y + y); c.lineTo(r.x + x, r.y + y + 34); c.stroke(); } }
      for (let k = 0; k < (r.w * r.h) / 3000; k++) { c.fillStyle = "rgba(60,80,50,0.25)"; circle(c, r.x + rnd() * r.w, r.y + rnd() * r.h, 6 + rnd() * 14); }
    } else {
      // Parquet : lames décalées (salle de bal : parquet clair en chevrons).
      c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1;
      const lh = kind === "bal" ? 18 : 14;
      for (let y = 0; y < r.h; y += lh) {
        c.beginPath(); c.moveTo(r.x, r.y + y); c.lineTo(r.x + r.w, r.y + y); c.stroke();
        for (let x = ((y / lh) % 3) * 30; x < r.w; x += 90) { c.beginPath(); c.moveTo(r.x + x, r.y + y); c.lineTo(r.x + x, r.y + y + lh); c.stroke(); }
      }
      c.fillStyle = b; c.globalAlpha = 0.25;
      for (let y = 0; y < r.h; y += lh * 2) c.fillRect(r.x, r.y + y, r.w, lh);
      c.globalAlpha = 1;
      // Le couloir : un long tapis rouge.
      if (kind === "couloir") {
        const hz = r.w > r.h;
        c.fillStyle = "#7a2a35";
        if (hz) c.fillRect(r.x + 10, r.y + r.h * 0.3, r.w - 20, r.h * 0.4); else c.fillRect(r.x + r.w * 0.3, r.y + 10, r.w * 0.4, r.h - 20);
        c.strokeStyle = "#c8a24a"; c.lineWidth = 2;
        if (hz) c.strokeRect(r.x + 14, r.y + r.h * 0.3 + 4, r.w - 28, r.h * 0.4 - 8); else c.strokeRect(r.x + r.w * 0.3 + 4, r.y + 14, r.w * 0.4 - 8, r.h - 28);
      }
    }
  }
  function furniture(c, f, rnd) {
    const { x, y, w, h } = f;
    const horiz = w >= h;
    c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(x + 4, y + 5, w, h);
    const wood = (col = "#5b3a22") => { c.fillStyle = col; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(0,0,0,0.45)"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2); };
    switch (f.name) {
      case "lit": {
        wood("#4a2f1c");
        const head = f.side;
        c.fillStyle = ["#8e2f3c", "#2f4f8e", "#3e7a4a", "#7a5a2e"][Math.floor(rnd() * 4)];
        c.fillRect(x + 4, y + 4, w - 8, h - 8);
        c.fillStyle = "#e9e4d8";
        if (head === 0) { c.fillRect(x + 8, y + 6, w / 2 - 12, 18); c.fillRect(x + w / 2 + 4, y + 6, w / 2 - 12, 18); }
        else if (head === 2) { c.fillRect(x + 8, y + h - 24, w / 2 - 12, 18); c.fillRect(x + w / 2 + 4, y + h - 24, w / 2 - 12, 18); }
        else if (head === 1) { c.fillRect(x + w - 24, y + 8, 18, h / 2 - 12); c.fillRect(x + w - 24, y + h / 2 + 4, 18, h / 2 - 12); }
        else { c.fillRect(x + 6, y + 8, 18, h / 2 - 12); c.fillRect(x + 6, y + h / 2 + 4, 18, h / 2 - 12); }
        return;
      }
      case "baignoire":
        c.fillStyle = "#eef1f2"; c.fillRect(x, y, w, h);
        c.fillStyle = "#9fc6d8"; c.fillRect(x + 7, y + 7, w - 14, h - 14);
        c.strokeStyle = "#c9cfd2"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        return;
      case "lavabo": case "frigo":
        c.fillStyle = "#e6e9ea"; c.fillRect(x, y, w, h); c.strokeStyle = "#a9b0b4"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        if (f.name === "lavabo") { c.fillStyle = "#9fc6d8"; circle(c, x + w / 2, y + h / 2, Math.min(w, h) / 3); }
        return;
      case "four": case "chaudiere":
        c.fillStyle = f.name === "four" ? "#3b3d42" : "#5a3a2a"; c.fillRect(x, y, w, h);
        c.strokeStyle = "#777"; c.lineWidth = 2; for (const [a, b] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) { c.beginPath(); c.arc(x + w * a, y + h * b, Math.min(w, h) * 0.14, 0, Math.PI * 2); c.stroke(); }
        if (f.name === "chaudiere") { c.fillStyle = "#ff6a1a"; circle(c, x + w / 2, y + h / 2, 6); }
        return;
      case "comptoir":
        c.fillStyle = "#8c8f94"; c.fillRect(x, y, w, h); c.fillStyle = "#b9bcc1"; c.fillRect(x + 3, y + 3, w - 6, h - 6);
        c.fillStyle = "#9fc6d8"; if (horiz) c.fillRect(x + w * 0.6, y + 7, 30, h - 14); else c.fillRect(x + 7, y + h * 0.6, w - 14, 30);
        return;
      case "canape": {
        c.fillStyle = ["#7a2a35", "#2a4a7a", "#4a6a3a", "#6a4a7a"][Math.floor(rnd() * 4)]; c.fillRect(x, y, w, h);
        c.fillStyle = "rgba(0,0,0,0.25)";
        if (horiz) c.fillRect(x, f.side === 0 ? y : y + h - 12, w, 12); else c.fillRect(f.side === 3 ? x : x + w - 12, y, 12, h);
        return;
      }
      case "cheminee":
        c.fillStyle = "#7a3b2a"; c.fillRect(x, y, w, h);
        c.fillStyle = "#1a1210"; c.fillRect(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5);
        c.fillStyle = "#ff8a2a"; circle(c, x + w / 2, y + h / 2, Math.min(w, h) * 0.18);
        return;
      case "etagere": case "casier": {
        wood(f.name === "casier" ? "#3a2a1c" : "#3f2716");
        const n = Math.floor((horiz ? w : h) / 7);
        for (let k = 0; k < n; k++) {
          c.fillStyle = f.name === "casier" ? ["#3d1a22", "#2a3d22", "#4a1a1a"][k % 3] : ["#8e2f3c", "#2f4f8e", "#3e7a4a", "#b08a3a", "#5a3a6a"][Math.floor(rnd() * 5)];
          if (f.name === "casier") { if (horiz) circle(c, x + 5 + k * 7, y + h / 2, 3); else circle(c, x + w / 2, y + 5 + k * 7, 3); }
          else if (horiz) c.fillRect(x + 3 + k * 7, y + 4, 5, h - 8); else c.fillRect(x + 4, y + 3 + k * 7, w - 8, 5);
        }
        return;
      }
      case "tonneau":
        c.fillStyle = "#6b4527"; circle(c, x + w / 2, y + h / 2, w / 2);
        c.strokeStyle = "#2b2420"; c.lineWidth = 3; c.beginPath(); c.arc(x + w / 2, y + h / 2, w / 2 - 3, 0, Math.PI * 2); c.stroke();
        c.beginPath(); c.arc(x + w / 2, y + h / 2, w / 4, 0, Math.PI * 2); c.stroke();
        return;
      case "caisse":
        wood("#8a6a3e"); c.strokeStyle = "rgba(0,0,0,0.4)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + w, y + h); c.moveTo(x + w, y); c.lineTo(x, y + h); c.stroke();
        return;
      case "piano":
        c.fillStyle = "#141414"; c.fillRect(x, y, w, h);
        c.fillStyle = "#f2f2f2";
        if (horiz) c.fillRect(x + 6, f.side === 0 ? y + h - 14 : y + 4, w - 12, 10); else c.fillRect(f.side === 3 ? x + w - 14 : x + 4, y + 6, 10, h - 12);
        return;
      case "horloge":
        wood("#4a2f1c"); c.fillStyle = "#e8dcb8"; circle(c, x + w / 2, y + h / 2, Math.min(w, h) * 0.32);
        return;
      case "armure":
        c.fillStyle = "#3a3d44"; c.fillRect(x, y, w, h);
        c.fillStyle = "#a9b0bc"; circle(c, x + w / 2, y + h / 2, w * 0.38);
        c.fillStyle = "#5d6470"; c.fillRect(x + w / 2 - 2, y + 3, 4, h - 6);
        return;
      case "plante":
        c.fillStyle = "#6b4527"; circle(c, x + w / 2, y + h / 2, w / 2);
        c.strokeStyle = "#5a5a3a"; c.lineWidth = 2;
        for (let k = 0; k < 6; k++) { const a = k * 1.05; c.beginPath(); c.moveTo(x + w / 2, y + h / 2); c.lineTo(x + w / 2 + Math.cos(a) * w * 0.6, y + h / 2 + Math.sin(a) * h * 0.6); c.stroke(); }
        return;
      case "console":
        wood("#4e3220"); c.fillStyle = "#e8dcb8"; circle(c, x + w * 0.3, y + h / 2, 4); circle(c, x + w * 0.7, y + h / 2, 4);
        return;
      case "table": case "table_basse": case "bureau": {
        wood(f.name === "table_basse" ? "#3a2618" : "#6b4527");
        c.fillStyle = "rgba(255,255,255,0.08)"; c.fillRect(x + 4, y + 4, w - 8, h - 8);
        if (f.name === "table") {
          c.fillStyle = "#4a2f1c";
          if (horiz) for (let k = 0; k < Math.floor(w / 36); k++) { c.fillRect(x + 10 + k * 36, y - 12, 18, 10); c.fillRect(x + 10 + k * 36, y + h + 2, 18, 10); }
          else for (let k = 0; k < Math.floor(h / 36); k++) { c.fillRect(x - 12, y + 10 + k * 36, 10, 18); c.fillRect(x + w + 2, y + 10 + k * 36, 10, 18); }
          c.fillStyle = "#e8dcb8"; circle(c, x + w / 2, y + h / 2, 5);
        }
        if (f.name === "bureau") { c.fillStyle = "#e9e4d8"; c.fillRect(x + w * 0.2, y + h * 0.25, 20, 14); }
        return;
      }
      default:   // armoire, commode, buffet…
        wood(f.name === "armoire" ? "#4e3220" : "#5b3a22");
        c.strokeStyle = "rgba(0,0,0,0.4)"; c.lineWidth = 1.5;
        c.beginPath(); if (horiz) { c.moveTo(x + w / 2, y + 3); c.lineTo(x + w / 2, y + h - 3); } else { c.moveTo(x + 3, y + h / 2); c.lineTo(x + w - 3, y + h / 2); } c.stroke();
        c.fillStyle = "#c8a24a"; if (horiz) { circle(c, x + w / 2 - 5, y + h / 2, 2); circle(c, x + w / 2 + 5, y + h / 2, 2); } else { circle(c, x + w / 2, y + h / 2 - 5, 2); circle(c, x + w / 2, y + h / 2 + 5, 2); }
    }
  }
  function gardenThing(c, o, rnd) {
    const { x, y, w, h } = o;
    const shadow = (k = 0.4) => { c.fillStyle = `rgba(0,0,0,${k})`; c.fillRect(x + 4, y + 6, w, h); };
    switch (o.name) {
      case "haie":
        shadow(0.35);
        c.fillStyle = "#1f4a22"; c.fillRect(x, y, w, h);
        c.fillStyle = "#2c6030";
        for (let k = 0; k < (w * h) / 60; k++) circle(c, x + rnd() * w, y + rnd() * h, 4 + rnd() * 4);
        return;
      case "arbre":
        c.fillStyle = "rgba(0,0,0,0.35)"; circle(c, x + w / 2 + 8, y + h / 2 + 10, 34);
        c.fillStyle = "#3a2a1c"; circle(c, x + w / 2, y + h / 2, 12);
        c.fillStyle = "rgba(40,60,35,0.9)"; circle(c, x + w / 2, y + h / 2, 32);
        c.fillStyle = "rgba(60,85,50,0.8)"; circle(c, x + w / 2 - 8, y + h / 2 - 8, 18);
        return;
      case "arbre_mort": {
        // Tronc et branches nues, tordues.
        const cx = x + w / 2, cy = y + h / 2;
        c.fillStyle = "rgba(0,0,0,0.35)"; circle(c, cx + 6, cy + 8, 16);
        c.strokeStyle = "#3b2c22"; c.lineCap = "round";
        for (let k = 0; k < 6; k++) {
          const a = k * 1.05 + rnd(), L = 26 + rnd() * 22;
          c.lineWidth = 5; c.beginPath(); c.moveTo(cx, cy);
          const mx = cx + Math.cos(a) * L * 0.6, my = cy + Math.sin(a) * L * 0.6;
          c.quadraticCurveTo(mx + rnd() * 10 - 5, my + rnd() * 10 - 5, cx + Math.cos(a) * L, cy + Math.sin(a) * L); c.stroke();
          c.lineWidth = 2; c.beginPath(); c.moveTo(mx, my); c.lineTo(mx + Math.cos(a + 0.8) * 14, my + Math.sin(a + 0.8) * 14); c.stroke();
        }
        c.lineCap = "butt";
        c.fillStyle = "#4a382c"; circle(c, cx, cy, 10);
        return;
      }
      case "tombe":
        shadow();
        c.fillStyle = "#8f8f8a"; c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, y + w / 2); c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w, y + h); c.closePath(); c.fill();
        c.fillStyle = "#5c5c58"; c.fillRect(x + w / 2 - 2, y + 8, 4, 14); c.fillRect(x + w / 2 - 6, y + 12, 12, 4);
        c.fillStyle = "rgba(60,90,50,0.5)"; c.fillRect(x - 2, y + h - 4, w + 4, 6);
        return;
      case "fontaine": {
        const cx = x + w / 2, cy = y + h / 2;
        c.fillStyle = "#8a8578"; circle(c, cx, cy, w / 2 + 6);
        c.fillStyle = "#2d5a7a"; circle(c, cx, cy, w / 2 - 4);
        c.strokeStyle = "rgba(180,210,240,0.35)"; c.lineWidth = 1.5; for (const r of [16, 26, 34]) { c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke(); }
        c.fillStyle = "#b9b4a6"; circle(c, cx, cy, 13);
        c.fillStyle = "#d8d2c4"; circle(c, cx, cy, 6);
        return;
      }
      case "parterre": {
        // Un parterre de fleurs bordé de buis taillé.
        shadow(0.3);
        c.fillStyle = "#1f4a22"; c.fillRect(x, y, w, h);
        c.fillStyle = "#3a2a1c"; c.fillRect(x + 8, y + 8, w - 16, h - 16);
        const cols = [["#a8324a", "#e0607a"], ["#5a3a9a", "#9a7ad8"], ["#c8a24a", "#f0d27a"], ["#e8e4dc", "#b8b4ac"]][o.flowers || 0];
        for (let k = 0; k < (w * h) / 70; k++) { c.fillStyle = cols[k % 2]; circle(c, x + 12 + rnd() * (w - 24), y + 12 + rnd() * (h - 24), 2.5 + rnd() * 2); }
        c.strokeStyle = "#2c6030"; c.lineWidth = 3; c.strokeRect(x + 4, y + 4, w - 8, h - 8);
        return;
      }
      case "banc":
        shadow(0.35);
        c.fillStyle = "#5b3a22"; c.fillRect(x, y, w, h);
        c.strokeStyle = "#2b1a10"; c.lineWidth = 1.5; for (let k = 1; k < 3; k++) { c.beginPath(); c.moveTo(x, y + (h * k) / 3); c.lineTo(x + w, y + (h * k) / 3); c.stroke(); }
        c.fillStyle = "#222"; c.fillRect(x + 3, y - 2, 4, h + 4); c.fillRect(x + w - 7, y - 2, 4, h + 4);
        return;
      case "statue": {
        const cx = x + w / 2, cy = y + h / 2;
        c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(x + 4, y + 6, w, h);
        c.fillStyle = "#6f6c66"; c.fillRect(x, y, w, h);
        c.fillStyle = "#b4b0a6"; circle(c, cx, cy, 9);
        c.fillStyle = "#c8c4ba"; c.beginPath(); c.ellipse(cx - 9, cy - 3, 9, 3, -0.5, 0, Math.PI * 2); c.ellipse(cx + 9, cy - 3, 9, 3, 0.5, 0, Math.PI * 2); c.fill();   // un ange (des ailes)
        return;
      }
      case "grille":
        c.fillStyle = "#1c1c1f"; c.fillRect(x, y, w, h);
        c.fillStyle = "#4a4a52";
        if (w > h) for (let k = x; k < x + w; k += 10) c.fillRect(k, y - 3, 3, h + 6); else for (let k = y; k < y + h; k += 10) c.fillRect(x - 3, k, w + 6, 3);
        return;
      case "crypte":
        shadow(0.5);
        c.fillStyle = "#6a6862"; c.fillRect(x, y, w, h);
        c.fillStyle = "#57554f"; c.beginPath(); c.moveTo(x - 6, y + h * 0.5); c.lineTo(x + w / 2, y - 8); c.lineTo(x + w + 6, y + h * 0.5); c.closePath(); c.fill();
        c.fillStyle = "#2a2826"; c.fillRect(x + w / 2 - 14, y + h - 30, 28, 30);
        c.fillStyle = "#8a8780"; c.fillRect(x + w / 2 - 2, y + 10, 4, 22); c.fillRect(x + w / 2 - 9, y + 16, 18, 4);
        return;
      case "serre":
        shadow(0.3);
        c.fillStyle = "rgba(160,200,190,0.35)"; c.fillRect(x, y, w, h);
        c.strokeStyle = "#d8e8e4"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        c.lineWidth = 1; for (let k = 20; k < w; k += 20) { c.beginPath(); c.moveTo(x + k, y); c.lineTo(x + k, y + h); c.stroke(); }
        c.beginPath(); c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.stroke();
        for (let k = 0; k < 10; k++) { c.fillStyle = "rgba(60,110,50,0.7)"; circle(c, x + 10 + rnd() * (w - 20), y + 10 + rnd() * (h - 20), 5 + rnd() * 5); }
        return;
      case "buis": {
        const cx = x + w / 2, cy = y + h / 2;
        c.fillStyle = "rgba(0,0,0,0.35)"; circle(c, cx + 5, cy + 7, w / 2);
        c.fillStyle = "#1f4a22"; circle(c, cx, cy, w / 2);
        c.fillStyle = "#2f6a32"; circle(c, cx - 4, cy - 4, w / 3);
        return;
      }
      case "kiosque": {
        // Un kiosque octogonal (toit en ardoise, avec une girouette).
        const cx = x + w / 2, cy = y + h / 2, R = w / 2;
        const oct = (r) => { c.beginPath(); for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (k) c.lineTo(px, py); else c.moveTo(px, py); } c.closePath(); };
        c.fillStyle = "rgba(0,0,0,0.45)"; c.save(); c.translate(8, 10); oct(R); c.fill(); c.restore();
        c.fillStyle = "#3d4450"; oct(R); c.fill();
        c.strokeStyle = "#5a6372"; c.lineWidth = 2;
        for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); c.stroke(); }
        oct(R); c.stroke();
        c.fillStyle = "#c8a24a"; circle(c, cx, cy, 5);
        return;
      }
      case "puits": {
        const cx = x + w / 2, cy = y + h / 2;
        c.fillStyle = "rgba(0,0,0,0.4)"; circle(c, cx + 4, cy + 6, w / 2);
        c.fillStyle = "#77736a"; circle(c, cx, cy, w / 2);
        c.fillStyle = "#0b0b0d"; circle(c, cx, cy, w / 2 - 7);
        c.fillStyle = "#4a3326"; c.fillRect(x - 4, cy - 3, w + 8, 6);
        return;
      }
      default: break;
    }
  }
  // Le décor du jardin (sans collision) : allée, cercle de gravier, portail, lanternes, potager, sol du cimetière.
  function gardenDeco(c, d, rnd) {
    if (d.kind === "path") {
      c.fillStyle = "#77715f"; c.fillRect(d.x, d.y, d.w, d.h);
      for (let k = 0; k < (d.w * d.h) / 40; k++) { c.fillStyle = k % 2 ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.08)"; c.fillRect(d.x + rnd() * d.w, d.y + rnd() * d.h, 2, 2); }
      c.fillStyle = "#4a4638"; c.fillRect(d.x - 4, d.y, 4, d.h); c.fillRect(d.x + d.w, d.y, 4, d.h);
    } else if (d.kind === "ring") {
      c.fillStyle = "#77715f"; circle(c, d.x, d.y, d.r);
      c.fillStyle = "#26402a"; circle(c, d.x, d.y, d.r - 36);
    } else if (d.kind === "portail") {
      c.fillStyle = "#1c1c1f"; c.fillRect(d.x, d.y, d.w, M.T);
      c.fillStyle = "#6a6a72"; for (let k = d.x; k < d.x + d.w; k += 8) c.fillRect(k, d.y - 6, 3, M.T + 6);
      c.fillStyle = "#57554f"; c.fillRect(d.x - 16, d.y - 10, 16, M.T + 10); c.fillRect(d.x + d.w, d.y - 10, 16, M.T + 10);
    } else if (d.kind === "lanterne") {
      c.fillStyle = "#1c1c1f"; circle(c, d.x, d.y, 5);
      c.fillStyle = "#e8b04a"; circle(c, d.x, d.y, 2.5);
    } else if (d.kind === "potager") {
      c.fillStyle = "#3a2a1c"; c.fillRect(d.x, d.y, d.w, d.h);
      c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 2;
      for (let k = 18; k < d.h; k += 22) { c.beginPath(); c.moveTo(d.x + 6, d.y + k); c.lineTo(d.x + d.w - 6, d.y + k); c.stroke(); }
      for (let k = 0; k < 9; k++) {
        const px = d.x + 18 + rnd() * (d.w - 36), py = d.y + 16 + rnd() * (d.h - 32);
        c.fillStyle = "#d8661a"; c.beginPath(); c.ellipse(px, py, 9, 7, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#8a3a0a"; c.lineWidth = 1; c.beginPath(); c.moveTo(px, py - 7); c.lineTo(px, py + 7); c.stroke();
        c.fillStyle = "#3a5a2a"; c.fillRect(px - 1, py - 10, 3, 4);
      }
    } else if (d.kind === "cimetiere") {
      c.fillStyle = "#2a3a28"; c.fillRect(d.x, d.y, d.w, d.h);
      for (let k = 0; k < (d.w * d.h) / 200; k++) { c.fillStyle = "rgba(0,0,0,0.15)"; c.fillRect(d.x + rnd() * d.w, d.y + rnd() * d.h, 3, 2); }
      c.fillStyle = "#5a5648"; c.fillRect(d.x + d.w / 2 - 25, d.y + 90, 50, d.h - 90);
    }
  }


  function paint(manor, seed) {
    const rnd = M.seeded(seed ^ 0x77aa);
    const bg = document.createElement("canvas");
    bg.width = manor.w; bg.height = manor.h;
    const c = bg.getContext("2d");
    c.fillStyle = "#020203"; c.fillRect(0, 0, manor.w, manor.h);
    // Le jardin (devant + un côté) : herbe, un chemin de gravier le long du manoir, puis le décor.
    const MR = manor.manorRect;
    for (const G of manor.gardenParts) {
      c.fillStyle = "#26402a"; c.fillRect(G.x, G.y, G.w, G.h);
      for (let k = 0; k < (G.w * G.h) / 300; k++) { c.fillStyle = k % 2 ? "rgba(0,0,0,0.12)" : "rgba(120,160,100,0.08)"; c.fillRect(G.x + rnd() * G.w, G.y + rnd() * G.h, 2, 3); }
    }
    c.fillStyle = "#6e6a5e";
    const sideG = manor.gardenParts[1];
    c.fillRect(MR.x, MR.y + MR.h, MR.w, 30);
    if (sideG.x < MR.x) c.fillRect(MR.x - 30, MR.y, 30, MR.h + 30); else c.fillRect(MR.x + MR.w, MR.y, 30, MR.h + 30);
    for (const d of manor.doors.filter((d) => d.ext && d.vert)) c.fillRect(d.x < MR.x + 5 ? MR.x - 70 : MR.x + MR.w, d.y + 8, 70, d.h - 16);
    for (const d of manor.deco) gardenDeco(c, d, rnd);
    // Les pièces (manoir + cave).
    for (const r of manor.rooms) {
      floor(c, r, rnd);
      if (r.rug) {
        const rw = r.w * 0.5, rh = r.h * 0.45;
        c.fillStyle = "#6e1f26"; c.fillRect(r.x + (r.w - rw) / 2, r.y + (r.h - rh) / 2, rw, rh);
        c.strokeStyle = "#c8a24a"; c.lineWidth = 3; c.strokeRect(r.x + (r.w - rw) / 2 + 6, r.y + (r.h - rh) / 2 + 6, rw - 12, rh - 12);
      }
    }
    for (const d of manor.doors) { c.fillStyle = "#5a4330"; c.fillRect(d.x, d.y, d.w, d.h); }
    // Planches qui craquent (un peu plus sombres, si on regarde bien).
    for (const p of manor.creaks) {
      c.fillStyle = "rgba(0,0,0,0.22)"; c.fillRect(p.x, p.y, p.w, p.h);
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x + 6, p.y + p.h * 0.4); c.lineTo(p.x + p.w - 8, p.y + p.h * 0.55); c.stroke();
    }
    // Rayons de lune près des fenêtres (bleutés).
    for (const w of manor.windows) { c.fillStyle = "rgba(140,170,230,0.12)"; c.fillRect(w.patch.x, w.patch.y, w.patch.w, w.patch.h); }
    // Ombre le long des murs (dans les pièces).
    c.fillStyle = "rgba(0,0,0,0.35)";
    for (const w of manor.walls) { if (w.void) continue; if (w.w > w.h) c.fillRect(w.x, w.y + w.h, w.w, 6); else c.fillRect(w.x + w.w, w.y, 6, w.h); }
    // Lustres (au plafond, au milieu des pièces qui ont un interrupteur).
    for (const r of manor.rooms) {
      if (r.lamp === undefined) continue;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      c.strokeStyle = "rgba(200,162,74,0.6)"; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, 22, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#c8a24a"; circle(c, cx, cy, 5);
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; c.fillStyle = "#e8dcb8"; circle(c, cx + Math.cos(a) * 22, cy + Math.sin(a) * 22, 3); }
    }
    for (const f of manor.furniture) furniture(c, f, rnd);
    for (const o of manor.garden) gardenThing(c, o, rnd);
    for (const d of manor.deco) if (d.kind === "portail") gardenDeco(c, d, rnd);
    // Escaliers (des marches qui descendent / montent) et passages secrets (une bibliothèque contre le mur, avec une fine fissure).
    for (const p of manor.portals) for (const e of [p.a, p.b]) {
      const nx = (e.ex - e.x) / 46, ny = (e.ey - e.y) / 46, ang = Math.atan2(ny, nx);
      c.save(); c.translate(e.x, e.y); c.rotate(ang);
      if (p.kind === "stairs") {
        for (let k = 0; k < 5; k++) { c.fillStyle = `rgb(${110 - k * 16},${95 - k * 14},${80 - k * 12})`; c.fillRect(-24 + k * 6, -24, 7, 48); }
        c.strokeStyle = "#2b2420"; c.lineWidth = 2; c.strokeRect(-24, -24, 34, 48);
      } else {
        c.fillStyle = "#3f2716"; c.fillRect(-24, -26, 14, 52);
        for (let k = 0; k < 7; k++) { c.fillStyle = ["#8e2f3c", "#2f4f8e", "#3e7a4a", "#b08a3a"][k % 4]; c.fillRect(-22, -24 + k * 7, 10, 5); }
        c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 1; c.beginPath(); c.moveTo(-10, -26); c.lineTo(-10, 26); c.stroke();
      }
      c.restore();
    }
    // Les murs : pierre sombre, liseré clair dessus (le vide autour de la cave : noir).
    for (const w of manor.walls) {
      const big = !!w.void;
      c.fillStyle = big ? "#020203" : w.fence ? "#3a3632" : "#2b2420"; c.fillRect(w.x, w.y, w.w, w.h);
      if (big) continue;
      c.fillStyle = "#4a3d33"; if (w.w > w.h) c.fillRect(w.x, w.y, w.w, 4); else c.fillRect(w.x, w.y, 4, w.h);
    }
    // Tableaux accrochés aux murs (côté pièce).
    for (const r of manor.rooms) {
      if (r.cave || rnd() > 0.6) continue;
      const px = r.x + 30 + rnd() * Math.max(1, r.w - 90), py = r.y - 3;
      c.fillStyle = "#c8a24a"; c.fillRect(px, py, 40, 7);
      c.fillStyle = ["#3a5a7a", "#7a3a3a", "#4a6a3a", "#6a5a3a"][Math.floor(rnd() * 4)]; c.fillRect(px + 3, py + 1, 34, 4);
    }
    // Fenêtres sur les murs extérieurs.
    for (const w of manor.windows) {
      c.fillStyle = "#6d88b8";
      if (w.vert) c.fillRect(w.at + 3, w.c - 26, M.T - 6, 52); else c.fillRect(w.c - 26, w.at + 3, 52, M.T - 6);
      c.fillStyle = "#2b2420";
      if (w.vert) c.fillRect(w.at + 3, w.c - 1, M.T - 6, 2); else c.fillRect(w.c - 1, w.at + 3, 2, M.T - 6);
    }
    // Toiles d'araignée dans les coins.
    c.strokeStyle = "rgba(220,220,220,0.22)"; c.lineWidth = 1;
    for (const r of manor.rooms) {
      if (rnd() > 0.45) continue;
      const cx = rnd() < 0.5 ? r.x : r.x + r.w, cy = rnd() < 0.5 ? r.y : r.y + r.h;
      const sx = cx === r.x ? 1 : -1, sy = cy === r.y ? 1 : -1;
      for (let k = 1; k <= 4; k++) { c.beginPath(); c.moveTo(cx + sx * k * 9, cy); c.quadraticCurveTo(cx + sx * k * 5, cy + sy * k * 5, cx, cy + sy * k * 9); c.stroke(); }
    }
    return bg;
  }

  // Ce qui change pendant la partie : portes, interrupteurs (litRooms : salle -> fin de l'éclairage, en performance.now()), toiles.
  function dynamic(c, manor, doorsOpen, litRooms, websAlive) {
    manor.doors.forEach((d, i) => {
      if (!doorsOpen[i]) {
        // Porte fermée : un battant en bois avec sa poignée.
        c.fillStyle = "#6b4527"; c.fillRect(d.x - (d.vert ? 1 : 0), d.y - (d.vert ? 0 : 1), d.w + (d.vert ? 2 : 0), d.h + (d.vert ? 0 : 2));
        c.strokeStyle = "#3a2618"; c.lineWidth = 2; c.strokeRect(d.x + 1, d.y + 1, d.w - 2, d.h - 2);
        c.fillStyle = "#c8a24a"; if (d.vert) circle(c, d.x + d.w / 2, d.y + d.h - 12, 3); else circle(c, d.x + d.w - 12, d.y + d.h / 2, 3);
      } else {
        // Ouverte : le battant contre le mur.
        c.strokeStyle = "#7a5430"; c.lineWidth = 5; c.beginPath();
        if (d.vert) { c.moveTo(d.x + d.w / 2, d.y + 2); c.lineTo(d.x + d.w / 2 + 30, d.y + 18); } else { c.moveTo(d.x + 2, d.y + d.h / 2); c.lineTo(d.x + 18, d.y + d.h / 2 + 30); }
        c.stroke();
      }
    });
    for (const sw of manor.switches) {
      const on = (litRooms.get(sw.room) || 0) > performance.now();
      c.fillStyle = "#e8dcb8"; c.fillRect(sw.x - 7, sw.y - 9, 14, 18);
      c.fillStyle = on ? "#ffd23f" : "#555"; c.fillRect(sw.x - 3, sw.y - 5, 6, 10);
    }
    manor.webs.forEach((wb, i) => {
      if (!websAlive[i]) return;
      const cx = wb.x + wb.w / 2, cy = wb.y + wb.h / 2;
      c.strokeStyle = "rgba(235,235,235,0.55)"; c.lineWidth = 1;
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * 28, cy + Math.sin(a) * 28); c.stroke(); }
      for (const r of [8, 15, 22]) { c.beginPath(); for (let k = 0; k <= 8; k++) { const a = (k / 8) * Math.PI * 2; const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (k) c.lineTo(px, py); else c.moveTo(px, py); } c.stroke(); }
    });
  }

  window.ManoirArt = { paint, dynamic, circle };
})();
