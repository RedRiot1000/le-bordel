// ===================================================================
//  GOLF DE COMBAT — Client (s'affiche dans le hub Le Bordel)
//  Style maquette en papier, en plein jour : gazon rayé, bordures en bois,
//  ombres franches, eau qui ondule, drapeau qui flotte.
//  - Le trou est refait ici à partir de la seed (course.js).
//  - Viseur relatif à ma balle (souris capturée au 1er clic) ; clic maintenu = la force monte.
// ===================================================================

(() => {
  const G = window.Golf;
  const W = G.W, HGT = G.H, AIM_MAX = 300, CHARGE_S = 1.1, SHOT_MAX = 1300;   // (les mêmes que games/golf/server.js)

  let api = null, root = null;
  let st = null, hole = null, holeSeed = null, bg = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let seq = 0, acc = 0;
  const mouse = { ox: 150, oy: 0, left: false };
  let chargeStart = 0, particles = [], ripples = [];
  const seenFx = new Set();
  let prevPhase = null, lastSnapRecv = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const ballOf = (id) => st?.balls.find((b) => b.id === id);
  const colorOf = (id) => playerOf(id)?.color || "#fff";

  const TEMPLATE = `
    <div id="gf-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">⛳</span>
        <h1>GOLF DE COMBAT</h1>
        <p class="tagline">Tout le monde joue en même temps. Les balles se cognent.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="gf-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>⛳ Tout le monde joue <b>le même trou, en même temps</b>. Le moins de coups gagne.</li>
            <li>🎯 Vise à la souris, <b>maintiens le clic</b> pour doser la force, lâche pour taper. Seulement quand ta balle est arrêtée.</li>
            <li>💥 Les balles <b>se cognent</b> : envoie celles des autres à l'eau !</li>
            <li>💦 Dans l'eau : +1 coup, tu rejoues d'où tu as tiré. Le sable freine, les bumpers rouges renvoient fort.</li>
            <li>⏱️ 30 s après le premier dans le trou, le trou se termine (+2 coups pour les retardataires).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="gf-start" class="btn btn-primary btn-big">⛳ Au départ !</button>
        <p id="gf-hint" class="muted"></p>
        <p id="gf-error" class="error-msg"></p>
        <button id="gf-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="gf-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="gf-round"></span>
        <span id="gf-me" class="ch-role"></span>
        <span id="gf-par" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="gf-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="gf-feed" class="so-feed"></ul>
        <div id="gf-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">Souris = viser · clic maintenu = doser la force, lâché = taper · Échap = libérer la souris</p>
    </div>`;

  window.GAMES.golf = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; holeSeed = null; particles = []; ripples = []; bg = null;
      seenFx.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-candy");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("gf-canvas");
      g2d = canvas.getContext("2d");
      $("gf-start").onclick = () => { $("gf-error").textContent = ""; api.action("start").then((r) => { if (r.error) $("gf-error").textContent = r.error; }); };
      $("gf-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("blur", onBlur);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (["setup", "over"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();   // (entre deux manches, la souris reste capturée)
      if (st.phase === "setup") { $("gf-play").classList.add("hidden"); $("gf-setup").classList.remove("hidden"); renderSettings(); return; }
      $("gf-setup").classList.add("hidden");
      $("gf-play").classList.remove("hidden");
      if (st.seed && st.seed !== holeSeed) { holeSeed = st.seed; hole = G.build(st.seed); bg = null; }
      lastSnapRecv = performance.now();
      handleFx();
      renderHud();
      renderOver();
    },
    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onBlur);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  // ===================================================================
  //  SOURIS
  // ===================================================================
  function onBlur() { mouse.left = false; }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    if (document.pointerLockElement === canvas) { mouse.ox += e.movementX * k; mouse.oy += e.movementY * k; }
    else { if (e.target !== canvas) return; const b = ballOf(me()); if (!b) return; mouse.ox = (e.clientX - r.left) * k - b.x; mouse.oy = (e.clientY - r.top) * (HGT / r.height) - b.y; }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  function onDown(e) {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); }   // (ce clic compte aussi)
    mouse.left = true; chargeStart = performance.now();
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; }
  // On envoie les touches 30 fois par seconde (clic maintenu + angle).
  function sendInput(dt) {
    if (st?.phase !== "play") { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    while (acc >= 1 / 30) { seq++; api.send("in", { s: seq, k: mouse.left ? 32 : 0, a: Math.atan2(mouse.oy, mouse.ox) }); acc -= 1 / 30; }
  }

  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (f.kind === "plouf") { ripples.push({ x: f.x, y: f.y, life: 1, max: 1 }); for (let i = 0; i < 18; i++) { const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 140; particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5, col: "#bfe6ff" }); } }
      else if (f.kind === "trou") for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 260; particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.8, max: 0.8, col: ["#ffd23f", "#ff6b8a", "#7fd8ff", "#fff"][i % 4] }); }
      else if (f.kind === "choc" || f.kind === "bump") for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 120; particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3, max: 0.3, col: "#ffffff" }); }
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE TROU
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("gf-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Trous</label><div class="cat-chips">${[4, 6, 9].map((v) => `<button class="cat-chip ${s.rounds === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${v}</button>`).join("")}</div></div>
      <p class="settings-note">Un nouveau trou à chaque fois. Points du trou : 10, 7, 5, 3, 2, 1 selon les coups.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { rounds: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("gf-start").style.display = host ? "" : "none";
    $("gf-start").disabled = n < 2;
    $("gf-finish-setup").classList.toggle("hidden", !host);
    $("gf-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} golfeurs`;
  }
  function renderHud() {
    $("gf-round").textContent = `Trou ${st.round}/${st.settings.rounds}`;
    const b = ballOf(me());
    const txt = !b ? "👀 Tu regardes" : b.done ? `⛳ Dans le trou en ${b.strokes} coup${b.strokes > 1 ? "s" : ""}` : `🏌️ ${b.strokes} coup${b.strokes > 1 ? "s" : ""}`;
    if ($("gf-me").textContent !== txt) $("gf-me").textContent = txt;
    $("gf-par").textContent = hole ? `Par ${hole.par}` : "";
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("gf-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }   // (comparé à notre propre texte : sinon il clignote)
  }
  function renderOver() {
    const ov = $("gf-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost(), lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const best = lr.order[0];
    const banner = `🏆 ${esc(pseudoOf(best))} gagne le trou en ${lr.strokes[best]} coup${lr.strokes[best] > 1 ? "s" : ""} (par ${lr.par})`;
    const rel = (n) => (n === lr.par ? "par" : n < lr.par ? `${n - lr.par}` : `+${n - lr.par}`);
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.strokes[id]} coups (${rel(lr.strokes[id])})${lr.done[id] ? "" : " · pas dans le trou"} · total ${st.total[id] ?? 0}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = `<p class="muted">Trou suivant dans <b id="gf-next-sec"></b> s…</p>` + (st.playlist ? "" : host ? `<div class="go-actions"><button id="gf-next" class="btn btn-primary">Trou suivant ▶</button><button id="gf-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>');
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="gf-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>${host ? '<div class="go-actions"><button id="gf-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions"><button id="gf-again" class="btn btn-primary">🔁 Rejouer</button><button id="gf-to-setup" class="btn btn-secondary">Réglages</button><button id="gf-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div><p id="gf-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("gf-next") && ($("gf-next").onclick = () => api.action("next"));
    $("gf-again") && ($("gf-again").onclick = () => api.action("start").then((r) => { if (r.error) $("gf-over-error").textContent = r.error; }));
    $("gf-to-setup") && ($("gf-to-setup").onclick = () => api.action("setup"));
    $("gf-finish") && ($("gf-finish").onclick = () => { if (st.playlist?.final || confirm("Terminer Golf de combat ? Le classement actuel donne les points de soirée.")) api.action("finish"); });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["gf-fin-sec", finishEndLocal], ["gf-next-sec", phaseEndLocal]]) { const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); }
    if (!st || st.phase === "setup" || !hole) return;
    sendInput(dt);
    draw(ts, dt);
  }
  // Le trou, comme une maquette en papier : fond crème, gazon rayé, bordures en bois, ombres franches.
  function background() {
    if (bg) return bg;
    bg = document.createElement("canvas"); bg.width = W; bg.height = HGT;
    const c = bg.getContext("2d");
    c.fillStyle = "#f3e7d3"; c.fillRect(0, 0, W, HGT);
    for (let i = 0; i < 1800; i++) { c.fillStyle = i % 2 ? "rgba(120,90,50,0.05)" : "rgba(255,255,255,0.25)"; c.fillRect(Math.random() * W, Math.random() * HGT, 2, 2); }
    const B = 12;
    // L'ombre, la bordure en bois, puis le gazon (dans cet ordre, pour que les couloirs se fondent).
    c.fillStyle = "rgba(70,45,20,0.25)"; for (const s of hole.segs) c.fillRect(s.x - B + 8, s.y - B + 10, s.w + 2 * B, s.h + 2 * B);
    c.fillStyle = "#b9824f"; for (const s of hole.segs) c.fillRect(s.x - B, s.y - B, s.w + 2 * B, s.h + 2 * B);
    c.fillStyle = "#cf9a63"; for (const s of hole.segs) c.fillRect(s.x - B, s.y - B, s.w + 2 * B, 4);
    for (const s of hole.segs) {
      for (let k = 0; k * 40 < (s.w > s.h ? s.w : s.h); k++) {
        c.fillStyle = k % 2 ? "#7ccf6a" : "#6fc25e";
        if (s.w > s.h) c.fillRect(s.x + k * 40, s.y, Math.min(40, s.w - k * 40), s.h); else c.fillRect(s.x, s.y + k * 40, s.w, Math.min(40, s.h - k * 40));
      }
    }
    // Le sable, l'eau, les blocs.
    for (const s of hole.sand) { c.fillStyle = "#ead39a"; c.beginPath(); c.roundRect(s.x, s.y, s.w, s.h, 22); c.fill(); c.fillStyle = "rgba(160,120,60,0.25)"; for (let i = 0; i < 40; i++) c.fillRect(s.x + 8 + Math.random() * (s.w - 16), s.y + 8 + Math.random() * (s.h - 16), 2, 2); }
    for (const w of hole.water) { c.fillStyle = "#4aa8e0"; c.beginPath(); c.roundRect(w.x, w.y, w.w, w.h, 18); c.fill(); c.strokeStyle = "#2f86c0"; c.lineWidth = 3; c.stroke(); }
    for (const b of hole.blocks) {
      const thin = Math.min(b.w, b.h) < 20;
      c.fillStyle = "rgba(70,45,20,0.3)"; c.fillRect(b.x + 6, b.y + 8, b.w, b.h);
      c.fillStyle = thin ? "#b9824f" : "#9aa3ad"; c.fillRect(b.x, b.y, b.w, b.h);
      c.fillStyle = thin ? "#cf9a63" : "#c3cad2"; c.fillRect(b.x, b.y, b.w, Math.min(6, b.h));
    }
    // Les tapis : une bande avec des flèches (elles avancent à l'écran).
    for (const t of hole.boosts || []) { c.fillStyle = "rgba(255,210,63,0.35)"; c.beginPath(); c.roundRect(t.x, t.y, t.w, t.h, 10); c.fill(); c.strokeStyle = "rgba(200,140,20,0.7)"; c.lineWidth = 2; c.stroke(); }
    // Le départ.
    c.fillStyle = "rgba(255,255,255,0.5)"; c.beginPath(); c.roundRect(hole.tee.x - 26, hole.tee.y - 60, 52, 120, 10); c.fill();
    return bg;
  }
  function draw(ts, dt) {
    const c = g2d;
    c.drawImage(background(), 0, 0);
    // L'eau qui ondule.
    for (const w of hole.water) { c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2; for (let k = 0; k < 3; k++) { const y = w.y + w.h * (0.3 + k * 0.2); c.beginPath(); for (let x = w.x + 12; x < w.x + w.w - 12; x += 8) c.lineTo(x, y + Math.sin(x / 14 + ts / 300 + k) * 2); c.stroke(); } }
    ripples = ripples.filter((r) => (r.life -= dt) > 0);
    for (const r of ripples) { c.strokeStyle = `rgba(255,255,255,${r.life})`; c.lineWidth = 2; c.beginPath(); c.arc(r.x, r.y, (1 - r.life) * 40 + 6, 0, Math.PI * 2); c.stroke(); }
    // Les flèches des tapis.
    for (const t of hole.boosts || []) {
      c.save(); c.beginPath(); c.rect(t.x, t.y, t.w, t.h); c.clip();
      const a = Math.atan2(t.dy, t.dx), step = 34, shift = (ts / 18) % step;
      c.translate(t.x + t.w / 2, t.y + t.h / 2); c.rotate(a);
      const L = Math.abs(t.dx) ? t.w : t.h, Wd = Math.abs(t.dx) ? t.h : t.w;
      c.strokeStyle = "rgba(160,100,10,0.8)"; c.lineWidth = 5; c.lineCap = "round";
      for (let x = -L / 2 - step + shift; x < L / 2 + step; x += step) for (let y = -Wd / 2 + 18; y < Wd / 2 - 8; y += 34) { c.beginPath(); c.moveTo(x - 7, y - 8); c.lineTo(x + 3, y); c.lineTo(x - 7, y + 8); c.stroke(); }
      c.restore();
    }
    // Les bumpers.
    for (const p of hole.bumpers) {
      c.fillStyle = "rgba(70,45,20,0.3)"; c.beginPath(); c.arc(p.x + 5, p.y + 7, p.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#e8434e"; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(p.x, p.y, p.r * 0.62, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#e8434e"; c.beginPath(); c.arc(p.x, p.y, p.r * 0.3, 0, Math.PI * 2); c.fill();
    }
    // Le trou et son drapeau.
    const cp = hole.cup;
    c.fillStyle = "#1d2a1a"; c.beginPath(); c.arc(cp.x, cp.y, G.CUP_R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#f3e7d3"; c.lineWidth = 3; c.beginPath(); c.arc(cp.x, cp.y, G.CUP_R + 2, 0, Math.PI * 2); c.stroke();
    c.strokeStyle = "#3b2a1a"; c.lineWidth = 4; c.beginPath(); c.moveTo(cp.x, cp.y); c.lineTo(cp.x + 6, cp.y - 70); c.stroke();
    const wave = Math.sin(ts / 220) * 5;
    c.fillStyle = "#ff4d6a"; c.beginPath(); c.moveTo(cp.x + 6, cp.y - 70); c.quadraticCurveTo(cp.x + 30, cp.y - 64 + wave, cp.x + 52, cp.y - 58); c.lineTo(cp.x + 6, cp.y - 46); c.closePath(); c.fill();
    // Les balles (avancées « au présent » avec le freinage du gazon).
    const ahead = Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const b of st.balls) {
      if (b.done) continue;
      const f = Math.pow(1 - G.ROLL, ahead), x = b.x + b.vx * ahead * f, y = b.y + b.vy * ahead * f, col = colorOf(b.id), isMe = b.id === me();
      c.fillStyle = "rgba(60,40,20,0.3)"; c.beginPath(); c.ellipse(x + 4, y + 5, G.BALL_R, G.BALL_R * 0.8, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#ffffff"; c.beginPath(); c.arc(x, y, G.BALL_R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = col; c.lineWidth = 4; c.stroke();
      c.font = `bold ${isMe ? 14 : 12}px Segoe UI, sans-serif`;
      c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,0.9)"; c.strokeText(pseudoOf(b.id), x, y - 22);
      c.fillStyle = isMe ? "#2b1d10" : col; c.fillText(pseudoOf(b.id), x, y - 22);
      if (isMe) { c.strokeStyle = "rgba(43,29,16,0.7)"; c.lineWidth = 2; c.setLineDash([3, 4]); c.beginPath(); c.arc(x, y, G.BALL_R + 7, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
    }
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    c.globalAlpha = 1;
    // Ma visée : la direction, et la force qui monte quand je maintiens le clic.
    const mb = ballOf(me());
    if (mb && !mb.done && st.phase === "play") {
      const still = mb.vx === 0 && mb.vy === 0, a = Math.atan2(mouse.oy, mouse.ox);
      const power = mouse.left && still ? Math.min(1, (performance.now() - chargeStart) / (CHARGE_S * 1000)) : 0;
      const len = 40 + power * 160;
      c.strokeStyle = still ? "rgba(43,29,16,0.75)" : "rgba(43,29,16,0.25)"; c.lineWidth = 3; c.setLineDash([8, 7]);
      c.beginPath(); c.moveTo(mb.x + Math.cos(a) * 14, mb.y + Math.sin(a) * 14); c.lineTo(mb.x + Math.cos(a) * len, mb.y + Math.sin(a) * len); c.stroke(); c.setLineDash([]);
      const ex = mb.x + Math.cos(a) * len, ey = mb.y + Math.sin(a) * len;
      c.fillStyle = still ? "#2b1d10" : "rgba(43,29,16,0.3)"; c.beginPath(); c.moveTo(ex + Math.cos(a) * 10, ey + Math.sin(a) * 10); c.lineTo(ex + Math.cos(a + 2.5) * 10, ey + Math.sin(a + 2.5) * 10); c.lineTo(ex + Math.cos(a - 2.5) * 10, ey + Math.sin(a - 2.5) * 10); c.closePath(); c.fill();
      // La jauge de force, en bas.
      c.fillStyle = "rgba(43,29,16,0.75)"; c.beginPath(); c.roundRect(W / 2 - 160, HGT - 44, 320, 30, 10); c.fill();
      const gr = c.createLinearGradient(W / 2 - 150, 0, W / 2 + 150, 0); gr.addColorStop(0, "#7ccf6a"); gr.addColorStop(0.6, "#ffd23f"); gr.addColorStop(1, "#ff4d6a");
      c.fillStyle = gr; c.fillRect(W / 2 - 150, HGT - 36, 300 * power, 14);
      c.font = "bold 12px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(still ? (power > 0 ? `Force ${Math.round(power * SHOT_MAX / 13)} %` : "Maintiens le clic pour taper") : "La balle roule…", W / 2, HGT - 29);
    }
    // Le temps qui reste, une fois que quelqu'un est dans le trou.
    if (st.phase === "play" && st.firstIn) { const s = Math.ceil(st.timeLeft / 1000); c.font = "900 26px Segoe UI, sans-serif"; c.fillStyle = s <= 10 ? "#e8434e" : "#2b1d10"; c.fillText(`⏱️ ${s} s`, W / 2, 34); }
    if (st.phase === "play" && document.pointerLockElement !== canvas) { c.font = "bold 14px Segoe UI, sans-serif"; c.fillStyle = "rgba(43,29,16,0.8)"; c.fillText("🖱️ Clique sur le parcours : ton viseur suivra ta balle", W / 2, HGT - 58); }
    if (st.phase === "countdown") {
      const n = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      // Une petite étiquette en haut (le terrain reste visible).
      c.fillStyle = "rgba(43,29,16,0.82)"; c.beginPath(); c.roundRect(W / 2 - 170, 8, 340, 46, 12); c.fill();
      c.font = "900 26px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(`${n > 0 ? n : "GO !"} · Par ${hole.par}`, W / 2, 31);
    }
  }
})();
