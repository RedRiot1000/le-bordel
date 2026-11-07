// ===================================================================
//  SONAR — Client (s'affiche dans le hub Le Bordel)
//  Style écran radar : noir, vert phosphore, lignes de balayage.
//  On ne voit que : soi, les murs tout près, les échos de pas (de tout le
//  monde), et ce que NOS pings révèlent un court instant.
//  - Le serveur m'envoie en privé ma position (« me ») et ce que mes pings
//    révèlent (« reveal »).
// ===================================================================

(() => {
  const H = window.Pieton, M = window.SonarMap;
  const K = H.K;
  const PING = 64, RUN = 0.9, SNEAK = 0.42, PING_CD = 3500, RELOAD = 1400;   // (les mêmes que games/sonar/server.js)
  const W = M.W, HGT = M.H, AIM_MAX = 300, NEAR = 120;
  const GREEN = "57,255,136";

  let api = null, root = null;
  let st = null, map = null, mapSeed = null, mine = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 150, oy: 0, left: false, right: false };
  let reveals = [], flashes = [];
  const seenFx = new Set();
  let prevPhase = null, playSeenAt = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const driving = () => st?.phase === "play";
  const myMsg = () => (mine && mine.round === st?.round ? mine : null);

  const TEMPLATE = `
    <div id="so2-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">📡</span>
        <h1>SONAR</h1>
        <p class="tagline">Dans le noir, chaque bruit te trahit.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="so2-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🌑 Tu ne vois <b>personne</b>. Tu vois les <b>échos de pas</b> de tout le monde.</li>
            <li>📡 <b>Clic droit</b> : un ping révèle ce qui t'entoure… mais tout le monde voit d'où il part.</li>
            <li>🤫 <kbd>Espace</kbd> maintenu : marcher à pas de loup, sans bruit (plus lent).</li>
            <li>🎯 <b>Clic gauche</b> : tirer. Une touche = mort, et le coup de feu se voit.</li>
            <li>⏱️ Après 60 s, un grand balayage révèle tout le monde toutes les 8 s.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="so2-start" class="btn btn-primary btn-big">📡 Couper la lumière</button>
        <p id="so2-hint" class="muted"></p>
        <p id="so2-error" class="error-msg"></p>
        <button id="so2-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="so2-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="so2-round"></span>
        <span id="so2-me" class="ch-role"></span>
        <span id="so2-alive" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="so2-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="so2-feed" class="so-feed"></ul>
        <div id="so2-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · Espace maintenu = pas de loup · clic droit = ping · clic gauche = tirer · Échap = libérer la souris</p>
    </div>`;

  window.GAMES.sonar = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; mine = null; pred = prevPred = null; pending = []; reveals = []; flashes = []; mapSeed = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-forest");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("so2-canvas");
      g2d = canvas.getContext("2d");
      $("so2-start").onclick = () => {
        $("so2-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("so2-error").textContent = r.error; });
      };
      $("so2-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", onBlur);
      window.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); reveals = []; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (!["play", "countdown"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") {
        $("so2-play").classList.add("hidden");
        $("so2-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("so2-setup").classList.add("hidden");
      $("so2-play").classList.remove("hidden");
      if (st.seed && st.seed !== mapSeed) { mapSeed = st.seed; map = M.build(st.seed); }
      handleFx();
      renderHud();
      renderOver();
    },
    message(type, payload) {
      if (type === "me") { mine = payload; reconcile(); }
      else if (type === "reveal") reveals.push({ ...payload, at: performance.now() });
    },
    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", onUp);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  // ===================================================================
  //  CLAVIER + SOURIS
  // ===================================================================
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH, ShiftLeft: K.DASH, KeyE: PING };
  function onBlur() { pressed.clear(); mouse.left = mouse.right = false; }
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function myPos() { if (pred) { const o = ownView(); return { x: o.x + off.x, y: o.y + off.y }; } return myMsg(); }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    if (document.pointerLockElement === canvas) { mouse.ox += e.movementX * k; mouse.oy += e.movementY * k; }
    else { if (e.target !== canvas) return; const p = myPos(); if (!p) return; mouse.ox = (e.clientX - r.left) * k - p.x; mouse.oy = (e.clientY - r.top) * (HGT / r.height) - p.y; }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  function onDown(e) {
    if (e.button === 0) {
      if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
      mouse.left = true;
    }
    if (e.button === 2) mouse.right = true;
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; if (mouse.left) k |= K.FIRE; if (mouse.right) k |= PING; return k; }

  // ===================================================================
  //  PRÉDICTION DE MON PERSO
  // ===================================================================
  const env = (k) => ({ walls: true, w: W, h: HGT, noDash: true, speedMul: k & K.DASH ? SNEAK : RUN, rects: map?.rects || [] });
  const moveBits = (k) => k & (K.UP | K.DOWN | K.LEFT | K.RIGHT);
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = myMsg();
    if (!sc || !driving() || !sc.alive || !map) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const m = history.get(sc.seq);
    if (pred && m && same(m, sc)) return;
    const before = pred && ownView(), oldPred = pred;
    pred = H.copy(sc);
    for (const p of pending) { H.simulate(pred, moveBits(p.k), p.a, env(p.k), null); history.set(p.s, H.copy(pred)); }
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) { const after = ownView(), dx = before.x - after.x, dy = before.y - after.y; if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } }
  }
  function driveLocal(dt) {
    if (!pred || !driving()) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    while (acc >= H.TICK) {
      const k = keyMask(), a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k), a, env(k), null);
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      flashes.push({ ...f, life: f.kind === "tir" ? 0.6 : f.kind === "mort" ? 1.2 : 0.3, max: f.kind === "tir" ? 0.6 : f.kind === "mort" ? 1.2 : 0.3 });
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("so2-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label><div class="cat-chips">${[4, 6, 9].map((v) =>
        `<button class="cat-chip ${s.rounds === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${v}</button>`).join("")}</div></div>
      <p class="settings-note">Une nouvelle arène à chaque manche. Chacun pour soi.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { rounds: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("so2-start").style.display = host ? "" : "none";
    $("so2-start").disabled = n < 2;
    $("so2-finish-setup").classList.toggle("hidden", !host);
    $("so2-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} joueurs dans le noir`;
  }
  function renderHud() {
    $("so2-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const m = myMsg();
    const txt = !m ? "👀 Tu regardes" : !m.alive ? "💀 Touché : tu regardes la fin" : m.sneak ? "🤫 Pas de loup" : "📡 À l'écoute";
    if ($("so2-me").textContent !== txt) $("so2-me").textContent = txt;
    $("so2-alive").textContent = `${st.alive} en vie`;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("so2-feed").innerHTML !== feed) $("so2-feed").innerHTML = feed;
  }
  function renderOver() {
    const ov = $("so2-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.winner ? `🏆 ${esc(pseudoOf(lr.winner))} est le dernier dans le noir !` : "🌑 Personne ne s'en sort";
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.elims[id] ? `🎯 ${lr.elims[id]} élimination${lr.elims[id] > 1 ? "s" : ""}` : ""}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="so2-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="so2-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="so2-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="so2-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="so2-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="so2-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="so2-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="so2-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="so2-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("so2-next") && ($("so2-next").onclick = () => api.action("next"));
    $("so2-again") && ($("so2-again").onclick = () => api.action("start").then((r) => { if (r.error) $("so2-over-error").textContent = r.error; }));
    $("so2-to-setup") && ($("so2-to-setup").onclick = () => api.action("setup"));
    $("so2-finish") && ($("so2-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Sonar ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["so2-fin-sec", finishEndLocal], ["so2-next-sec", phaseEndLocal]]) {
      const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
    if (!st || st.phase === "setup" || !map) return;
    if (!pred && myMsg()?.alive && driving()) { pred = H.copy(myMsg()); }
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    draw(ts, dt);
  }

  // La lumière d'un mur : près de moi, ou touché par la vague d'un de mes pings.
  function wallLight(r, pos, now) {
    const nx = Math.max(r.x, Math.min(pos.x, r.x + r.w)), ny = Math.max(r.y, Math.min(pos.y, r.y + r.h));
    let a = Math.max(0, 1 - Math.hypot(nx - pos.x, ny - pos.y) / NEAR) * 0.7;
    for (const v of reveals) {
      const age = (now - v.at) / 1000, wave = Math.min(1, age / 0.55) * v.r;
      const qx = Math.max(r.x, Math.min(v.x, r.x + r.w)), qy = Math.max(r.y, Math.min(v.y, r.y + r.h)), d = Math.hypot(qx - v.x, qy - v.y);
      if (d < wave && d < v.r) a = Math.max(a, Math.max(0, 1 - Math.max(0, age - d / v.r * 0.55) / 2.6));
    }
    return a;
  }

  function draw(ts, dt) {
    const c = g2d, now = performance.now();
    c.fillStyle = "#020805"; c.fillRect(0, 0, W, HGT);
    // La grille radar, très discrète.
    c.strokeStyle = `rgba(${GREEN},0.05)`; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 80) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, HGT); c.stroke(); }
    for (let y = 0; y <= HGT; y += 80) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    const m = myMsg(), pos = pred ? (() => { const o = ownView(); return { x: o.x + off.x, y: o.y + off.y }; })() : m ? { x: m.x, y: m.y } : { x: -999, y: -999 };
    reveals = reveals.filter((v) => now - v.at < 3200);
    // Les murs (dans le noir sauf s'ils sont éclairés).
    for (const r of map.rects) {
      const a = m?.alive ? wallLight(r, pos, now) : 0.35;
      if (a < 0.02) continue;
      c.fillStyle = `rgba(${GREEN},${(a * 0.18).toFixed(3)})`; c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = `rgba(${GREEN},${a.toFixed(3)})`; c.lineWidth = 2; c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    }
    // Mes pings : la vague, puis les ennemis révélés (des points qui s'effacent).
    for (const v of reveals) {
      const age = (now - v.at) / 1000;
      if (age < 0.6) { c.strokeStyle = `rgba(${GREEN},${(0.8 * (1 - age / 0.6)).toFixed(3)})`; c.lineWidth = 3; c.beginPath(); c.arc(v.x, v.y, Math.min(1, age / 0.55) * Math.min(v.r, 1500), 0, Math.PI * 2); c.stroke(); }
      for (const q of v.seen) {
        const f = Math.max(0, 1 - age / 1.6);
        if (f <= 0) continue;
        c.fillStyle = `rgba(255,80,80,${f.toFixed(3)})`; c.beginPath(); c.arc(q.x, q.y, 10, 0, Math.PI * 2); c.fill();
        c.strokeStyle = `rgba(255,120,120,${(f * 0.6).toFixed(3)})`; c.lineWidth = 2; c.beginPath(); c.arc(q.x, q.y, 18 + (1 - f) * 20, 0, Math.PI * 2); c.stroke();
      }
    }
    // Les pings des autres : on voit d'où ils partent (et un grand balayage).
    for (const p of st.pings || []) {
      if (Math.hypot(p.x - pos.x, p.y - pos.y) < 4 && !p.big) continue;
      const f = Math.max(0, 1 - p.age / 1400);
      c.strokeStyle = `rgba(${p.big ? "255,220,90" : GREEN},${(f * 0.9).toFixed(3)})`; c.lineWidth = 2;
      c.beginPath(); c.arc(p.x, p.y, 14 + (1 - f) * 60, 0, Math.PI * 2); c.stroke();
      c.fillStyle = `rgba(${p.big ? "255,220,90" : GREEN},${f.toFixed(3)})`; c.beginPath(); c.arc(p.x, p.y, 4, 0, Math.PI * 2); c.fill();
    }
    // Les échos de pas (de tout le monde, les miens plus pâles).
    for (const s of st.steps || []) {
      const f = Math.max(0, 1 - s.age / 900), own = Math.hypot(s.x - pos.x, s.y - pos.y) < 30;
      c.strokeStyle = `rgba(${GREEN},${(f * (own ? 0.25 : 0.75)).toFixed(3)})`; c.lineWidth = 2;
      c.beginPath(); c.arc(s.x, s.y, 8 + (1 - f) * 34, 0, Math.PI * 2); c.stroke();
    }
    // Les morts.
    for (const d of st.dead || []) { c.strokeStyle = "rgba(255,80,80,0.5)"; c.lineWidth = 3; c.beginPath(); c.moveTo(d.x - 9, d.y - 9); c.lineTo(d.x + 9, d.y + 9); c.moveTo(d.x + 9, d.y - 9); c.lineTo(d.x - 9, d.y + 9); c.stroke(); }
    // Les fléchettes en vol : un trait lumineux, tout le monde les voit.
    for (const d of st.darts || []) { const l = Math.hypot(d.vx, d.vy) || 1; c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = 3; c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x - (d.vx / l) * 26, d.y - (d.vy / l) * 26); c.stroke(); }
    // Les coups de feu et les morts : un éclair.
    flashes = flashes.filter((f) => (f.life -= dt) > 0);
    for (const f of flashes) {
      const k = f.life / f.max;
      if (f.kind === "tir") { c.fillStyle = `rgba(255,240,200,${(k * 0.8).toFixed(3)})`; c.beginPath(); c.arc(f.x, f.y, 10 + (1 - k) * 40, 0, Math.PI * 2); c.fill(); }
      else if (f.kind === "mort") { c.strokeStyle = `rgba(255,70,70,${k.toFixed(3)})`; c.lineWidth = 4; c.beginPath(); c.arc(f.x, f.y, 20 + (1 - k) * 70, 0, Math.PI * 2); c.stroke(); }
      else { c.fillStyle = `rgba(255,255,255,${k.toFixed(3)})`; c.fillRect(f.x - 3, f.y - 3, 6, 6); }
    }
    // Moi : un point vert vif, et mon viseur.
    if (m?.alive) {
      c.fillStyle = `rgba(${GREEN},0.15)`; c.beginPath(); c.arc(pos.x, pos.y, NEAR, 0, Math.PI * 2); c.fill();
      c.fillStyle = `rgb(${GREEN})`; c.beginPath(); c.arc(pos.x, pos.y, 9, 0, Math.PI * 2); c.fill();
      const a = Math.atan2(mouse.oy, mouse.ox);
      c.strokeStyle = `rgb(${GREEN})`; c.lineWidth = 3; c.beginPath(); c.moveTo(pos.x, pos.y); c.lineTo(pos.x + Math.cos(a) * 22, pos.y + Math.sin(a) * 22); c.stroke();
      const tx = pos.x + mouse.ox, ty = pos.y + mouse.oy;
      c.lineWidth = 1.5; c.beginPath(); c.arc(tx, ty, 9, 0, Math.PI * 2); c.moveTo(tx - 15, ty); c.lineTo(tx + 15, ty); c.moveTo(tx, ty - 15); c.lineTo(tx, ty + 15); c.stroke();
      if (m.sneak) { c.font = "bold 12px Consolas, monospace"; c.textAlign = "center"; c.fillStyle = `rgba(${GREEN},0.8)`; c.fillText("pas de loup", pos.x, pos.y - 20); }
    }
    // Les lignes de balayage et le bord de l'écran.
    c.fillStyle = "rgba(0,0,0,0.18)"; for (let y = 0; y < HGT; y += 4) c.fillRect(0, y, W, 2);
    const sweep = (ts / 2200) % 1;
    const sg = c.createLinearGradient(0, sweep * HGT - 60, 0, sweep * HGT);
    sg.addColorStop(0, `rgba(${GREEN},0)`); sg.addColorStop(1, `rgba(${GREEN},0.05)`);
    c.fillStyle = sg; c.fillRect(0, sweep * HGT - 60, W, 60);
    const vg = c.createRadialGradient(W / 2, HGT / 2, HGT * 0.4, W / 2, HGT / 2, HGT);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.7)");
    c.fillStyle = vg; c.fillRect(0, 0, W, HGT);
    drawHud(c, m);
  }

  function drawHud(c, m) {
    c.textAlign = "center"; c.textBaseline = "middle";
    const left = Math.ceil((st.timeLeft || 0) / 1000);
    c.font = "bold 26px Consolas, monospace"; c.fillStyle = `rgb(${GREEN})`;
    c.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, W / 2, 30);
    if (st.sweepIn !== null && st.sweepIn !== undefined) { c.font = "bold 16px Consolas, monospace"; c.fillStyle = "#ffdc5a"; c.fillText(`GRAND BALAYAGE DANS ${Math.ceil(st.sweepIn / 1000)} s`, W / 2, 56); }
    if (m?.alive && st.phase === "play") {
      const bar = (x, label, f) => {
        c.fillStyle = "rgba(0,20,10,0.8)"; c.fillRect(x, HGT - 42, 150, 26);
        c.fillStyle = `rgba(${GREEN},${f >= 1 ? 0.9 : 0.35})`; c.fillRect(x + 3, HGT - 39, 144 * f, 20);
        c.font = "bold 12px Consolas, monospace"; c.fillStyle = f >= 1 ? "#021" : `rgb(${GREEN})`; c.fillText(label, x + 75, HGT - 29);
      };
      bar(W / 2 - 160, f1(m.pingIn, PING_CD) >= 1 ? "PING PRÊT" : "ping…", f1(m.pingIn, PING_CD));
      bar(W / 2 + 10, f1(m.reloadIn, RELOAD) >= 1 ? "TIR PRÊT" : "recharge…", f1(m.reloadIn, RELOAD));
    }
    if (m?.alive && document.pointerLockElement !== canvas && st.phase === "play") { c.font = "14px Consolas, monospace"; c.fillStyle = `rgba(${GREEN},0.8)`; c.fillText("clique sur l'écran pour capturer la souris", W / 2, HGT - 60); }
    if (st.phase === "countdown") {
      const n = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(0,10,5,0.75)"; c.fillRect(0, HGT / 2 - 80, W, 160);
      c.font = "bold 60px Consolas, monospace"; c.fillStyle = `rgb(${GREEN})`; c.fillText(n > 0 ? String(n) : "GO", W / 2, HGT / 2 - 20);
      c.font = "20px Consolas, monospace"; c.fillText("Espace = pas de loup · clic droit = ping · clic gauche = tir", W / 2, HGT / 2 + 36);
    }
  }
  const f1 = (left, cd) => 1 - Math.min(1, (left || 0) / cd);
})();
