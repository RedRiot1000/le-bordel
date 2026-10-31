// ===================================================================
//  Mesure des "sauts" de ma voiture à l'écran (Sumo, version Arène).
//  À coller dans la console du navigateur sur la page d'accueil du jeu
//  (servi de préférence avec LAG_MS=60 pour simuler un vrai réseau).
//  Résultat dans window.__probe au bout de ~1 min.
//  Un "saut" = la voiture bouge de plus de 4 px au-delà de ce que sa
//  vitesse permet entre deux images. Classés : au contact / en tombant / ailleurs.
// ===================================================================
window.__probe = null;
(async (rounds = 5) => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  localStorage.removeItem("bordel_code");
  document.getElementById("input-pseudo").value = "Moi";
  document.getElementById("btn-create").click(); await sleep(600);
  for (let i = 0; i < 3; i++) { document.getElementById("btn-add-bot").click(); await sleep(250); }
  document.querySelector('.game-tile[data-id="sumo"]').click(); await sleep(800);
  for (const [k, v] of [["variant", "arena"], ["mode", "ffa"], ["shrink", "lent"]]) {
    document.querySelector(`[data-key="${k}"][data-v="${v}"]`).click(); await sleep(250);
  }
  const me = localStorage.getItem("bordel_pid");
  const frames = []; let srv = {};
  socket.on("game", ({ state }) => {
    const c = state.cars.find((x) => x.id === me);
    const near = c && state.cars.some((o) => o.id !== me && o.alive && !o.falling && Math.hypot(o.x - c.x, o.y - c.y) < 70);
    if (c) srv = { speed: Math.hypot(c.vx, c.vy), falling: c.falling, near };
  });
  const orig = CanvasRenderingContext2D.prototype.fillText;
  let rec = false;
  CanvasRenderingContext2D.prototype.fillText = function (txt, x, y) {
    if (rec && txt === "Moi") { const m = this.getTransform(); frames.push({ t: performance.now(), x: m.a * x + m.e, y: m.d * y + m.f, ...srv }); }
    return orig.apply(this, arguments);
  };
  const press = (c) => window.dispatchEvent(new KeyboardEvent("keydown", { code: c, bubbles: true }));
  const rel = (c) => window.dispatchEvent(new KeyboardEvent("keyup", { code: c, bubbles: true }));
  const out = { manches: rounds, images: 0, sautsAuContact: 0, sautsEnTombant: 0, sautsAilleurs: 0, maxContact: 0, maxTombe: 0, maxAilleurs: 0 };
  for (let r = 0; r < rounds; r++) {
    if (r === 0) document.getElementById("sm-start").click();
    else { for (let i = 0; i < 160 && !document.getElementById("sm-next"); i++) await sleep(250); document.getElementById("sm-next")?.click(); }
    await sleep(3300);
    frames.length = 0; rec = true;
    press("KeyW");
    for (let i = 0; i < 10; i++) { const k = i % 2 ? "KeyA" : "KeyD"; press(k); await sleep(450); rel(k); await sleep(550); }
    rel("KeyW"); rec = false;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i]; const dt = (b.t - a.t) / 1000;
      if (dt > 0.1) continue;
      const extra = Math.hypot(b.x - a.x, b.y - a.y) - (Math.max(a.speed, b.speed) + 60) * dt;
      if (extra <= 4) continue;
      if (a.falling || b.falling) { out.sautsEnTombant++; out.maxTombe = Math.max(out.maxTombe, extra); }
      else if (a.near || b.near) { out.sautsAuContact++; out.maxContact = Math.max(out.maxContact, extra); }
      else { out.sautsAilleurs++; out.maxAilleurs = Math.max(out.maxAilleurs, extra); }
    }
    out.images += frames.length;
  }
  CanvasRenderingContext2D.prototype.fillText = orig;
  for (const k of ["maxContact", "maxTombe", "maxAilleurs"]) out[k] = +out[k].toFixed(1);
  window.__probe = out;
})();
