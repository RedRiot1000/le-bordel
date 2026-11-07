// ===================================================================
//  PUCK — Client (s'affiche dans le hub Le Bordel)
//  Style patinoire néon : glace sombre, lignes lumineuses, buts qui
//  s'illuminent, tableau des scores façon retransmission.
//  - MON patineur est calculé ici tout de suite (prédiction), puis recalé.
//  - Viseur relatif au patineur (souris capturée au 1er clic).
// ===================================================================

(() => {
  const H = window.Pieton, R = window.Rink;
  const K = H.K;
  const SPEED = 1.15, CARRY_SLOW = 0.9, CHARGE_S = 0.8;   // (les mêmes que games/puck/server.js)
  const W = R.W, HGT = R.H, AIM_MAX = 320;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, bg = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 150, oy: 0, left: false };
  let chargeStart = 0, particles = [], puckTrail = [], goalFlash = null;
  const seenFx = new Set();
  let prevPhase = null, playSeenAt = 0, lastSnapRecv = 0;
  const othersOff = {}, lastShown = {};

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => (id === "robot" ? "Robot" : playerOf(id)?.pseudo || "?");
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const teamColor = (tm) => st?.teams[tm]?.color || "#fff";

  const TEMPLATE = `
    <div id="pu-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🏒</span>
        <h1>PUCK</h1>
        <p class="tagline">Hockey néon. Passe, tire, charge.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="pu-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏒 Deux équipes. Passe sur le palet pour le prendre : il reste au bout de ta crosse.</li>
            <li>🎯 <b>Clic gauche</b> : maintiens pour tirer fort, tape pour faire une passe. Le palet part là où tu vises.</li>
            <li>💥 <kbd>Espace</kbd> sans le palet : <b>charge</b>. Le porteur bousculé lâche le palet.</li>
            <li>🧱 Le palet rebondit sur les bandes : vise les angles !</li>
            <li>🏆 +2 par but, +3 pour l'équipe gagnante (+1 chacun en cas d'égalité).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="pu-start" class="btn btn-primary btn-big">🏒 Mise au jeu !</button>
        <p id="pu-hint" class="muted"></p>
        <p id="pu-error" class="error-msg"></p>
        <button id="pu-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="pu-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="pu-round"></span>
        <span id="pu-me" class="ch-role"></span>
        <span id="pu-team" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="pu-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="pu-feed" class="so-feed"></ul>
        <div id="pu-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = patiner · clic gauche maintenu = tir, tapé = passe · Espace = charge · Échap = libérer la souris</p>
    </div>`;

  window.GAMES.puck = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; puckTrail = []; bg = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("pu-canvas");
      g2d = canvas.getContext("2d");
      $("pu-start").onclick = () => { $("pu-error").textContent = ""; api.action("start").then((r) => { if (r.error) $("pu-error").textContent = r.error; }); };
      $("pu-finish-setup").onclick = () => api.action("finish");
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
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (!["play", "countdown"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") { $("pu-play").classList.add("hidden"); $("pu-setup").classList.remove("hidden"); renderSettings(); return; }
      $("pu-setup").classList.add("hidden");
      $("pu-play").classList.remove("hidden");
      handleFx();
      reconcile();
      lastSnapRecv = performance.now();
      rebase();
      renderHud();
      renderOver();
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
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH, KeyE: K.DASH };
  function onBlur() { pressed.clear(); mouse.left = false; }
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function myPos() { if (pred) { const o = ownView(); return { x: o.x + off.x, y: o.y + off.y }; } return heroOf(me()); }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    if (document.pointerLockElement === canvas) { mouse.ox += e.movementX * k; mouse.oy += e.movementY * k; }
    else { if (e.target !== canvas) return; const p = myPos(); if (!p) return; mouse.ox = (e.clientX - r.left) * k - p.x; mouse.oy = (e.clientY - r.top) * (HGT / r.height) - p.y; }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  function onDown(e) {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
    mouse.left = true; chargeStart = performance.now();
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; if (mouse.left) k |= K.FIRE; return k; }

  // ===================================================================
  //  PRÉDICTION DE MON PATINEUR
  // ===================================================================
  const env = () => ({ walls: true, w: W, h: HGT, push: true, speedMul: SPEED * (st?.carrier === me() ? CARRY_SLOW : 1), rects: R.heroRects });
  const moveBits = (k) => (st?.faceoff > 0 ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | (st?.carrier === me() ? 0 : K.DASH)));
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function simulate(h, k, a, E, others) {
    const dt = H.TICK / H.SUB;
    for (let i = 0; i < H.SUB; i++) { H.drive(h, k, a, dt, E); H.collideWalls(h, E); R.keepIn(h, H.R); if (others) for (const o of others) H.collideHeroes(h, o, true); }
    h.pushed = false;
  }
  function othersAt(t) { t = Math.min(0.3, Math.max(0, t)); return st.heroes.filter((h) => h.id !== me()).map((h) => H.extrapolate(h, t)); }
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving()) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const m = history.get(sc.seq);
    if (pred && m && same(m, sc)) return;
    const before = pred && ownView(), oldPred = pred;
    pred = H.copy(sc);
    const E = env();
    pending.forEach((p, i) => { simulate(pred, moveBits(p.k), p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) { const after = ownView(), dx = before.x - after.x, dy = before.y - after.y; if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } }
  }
  function driveLocal(dt) {
    if (!pred || !driving()) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    const E = env();
    while (acc >= H.TICK) {
      const k = keyMask(), a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      simulate(pred, moveBits(k), a, E, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }
  const aheadNow = () => (pred ? Math.min(0.3, Math.max(0, (pending.length - 1 + acc / H.TICK) * H.TICK)) : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000));
  function shownHero(h) {
    const base = driving() ? H.extrapolate(h, aheadNow()) : h, o = othersOff[h.id] || { x: 0, y: 0 };
    const v = { ...base, x: base.x + o.x, y: base.y + o.y };
    lastShown[h.id] = v;
    return v;
  }
  function rebase() {
    const t = aheadNow();
    for (const h of st.heroes) {
      if (h.id === me() && pred) continue;
      const prev = lastShown[h.id], base = driving() ? H.extrapolate(h, t) : h;
      othersOff[h.id] = prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 100 ? { x: prev.x - base.x, y: prev.y - base.y } : { x: 0, y: 0 };
    }
  }

  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "but" ? 70 : f.kind === "tir" ? 14 : f.kind === "vol" ? 16 : 6;
      const col = f.kind === "but" ? teamColor(f.team) : "#ffffff";
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * (f.kind === "but" ? 520 : 220); particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.6, max: 1, col }); }
      if (f.kind === "but") goalFlash = { team: f.team, life: 1.6 };
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MATCH
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("pu-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) => `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Matchs</label>${chips("rounds", [[1, "1"], [3, "3"], [5, "5"]])}</div>
      <div class="setting-block"><label>Durée d'un match</label>${chips("minutes", [[2, "2 min"], [3, "3 min"]])}</div>
      <p class="settings-note">Équipes tirées au hasard à chaque match. Nombre impair : un robot complète.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("pu-start").style.display = host ? "" : "none";
    $("pu-start").disabled = n < 2;
    $("pu-finish-setup").classList.toggle("hidden", !host);
    $("pu-hint").textContent = !host ? "En attente que l'hôte lance le match…" : n < 2 ? "Il faut au moins 2 joueurs." : `${Math.ceil(n / 2)} contre ${Math.ceil(n / 2)}${n % 2 ? " (avec un robot)" : ""}`;
  }
  function renderHud() {
    $("pu-round").textContent = `Match ${st.round}/${st.settings.rounds}`;
    const mine = heroOf(me()), tm = mine && st.teams[mine.team];
    const txt = !mine ? "👀 Tu regardes" : st.carrier === me() ? "🏒 Tu as le palet !" : "⛸️ Va chercher le palet";
    if ($("pu-me").textContent !== txt) $("pu-me").textContent = txt;
    $("pu-team").textContent = tm ? `${tm.emoji} ${tm.name}` : "";
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("pu-feed").innerHTML !== feed) $("pu-feed").innerHTML = feed;
  }
  function renderOver() {
    const ov = $("pu-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost(), lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const T = st.teams;
    const banner = lr.win ? `🏆 Victoire des ${T[lr.win].emoji} ${T[lr.win].name} ${lr.goals[1]} – ${lr.goals[2]} !` : `🤝 Match nul ${lr.goals[1]} – ${lr.goals[2]}`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${T[lr.teamOf[id]].emoji}${lr.scorers[id] ? ` · 🚨 ${lr.scorers[id]} but${lr.scorers[id] > 1 ? "s" : ""}` : ""}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Match suivant dans <b id="pu-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="pu-next" class="btn btn-primary">Match suivant ▶</button><button id="pu-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="pu-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>${host ? '<div class="go-actions"><button id="pu-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions"><button id="pu-again" class="btn btn-primary">🔁 Rejouer</button><button id="pu-to-setup" class="btn btn-secondary">Réglages</button><button id="pu-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div><p id="pu-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("pu-next") && ($("pu-next").onclick = () => api.action("next"));
    $("pu-again") && ($("pu-again").onclick = () => api.action("start").then((r) => { if (r.error) $("pu-over-error").textContent = r.error; }));
    $("pu-to-setup") && ($("pu-to-setup").onclick = () => api.action("setup"));
    $("pu-finish") && ($("pu-finish").onclick = () => { if (st.playlist?.final || confirm("Terminer Puck ? Le classement actuel donne les points de soirée.")) api.action("finish"); });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["pu-fin-sec", finishEndLocal], ["pu-next-sec", phaseEndLocal]]) { const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); }
    if (!st || st.phase === "setup") return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }
  const rinkPath = (c, inset = 0) => { c.beginPath(); c.roundRect(R.X0 + inset, R.Y0 + inset, R.X1 - R.X0 - 2 * inset, R.Y1 - R.Y0 - 2 * inset, R.CORNER - inset); };
  function background() {
    if (bg) return bg;
    bg = document.createElement("canvas"); bg.width = W; bg.height = HGT;
    const c = bg.getContext("2d");
    c.fillStyle = "#050812"; c.fillRect(0, 0, W, HGT);
    // La glace.
    rinkPath(c); const gr = c.createRadialGradient(R.CX, R.CY, 60, R.CX, R.CY, 700); gr.addColorStop(0, "#14233f"); gr.addColorStop(1, "#0a1428"); c.fillStyle = gr; c.fill();
    c.save(); rinkPath(c); c.clip();
    for (let i = 0; i < 260; i++) { c.strokeStyle = "rgba(160,200,255,0.05)"; c.lineWidth = 1; const x = Math.random() * W, y = Math.random() * HGT, a = Math.random() * Math.PI; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * 40, y + Math.sin(a) * 40); c.stroke(); }
    const glow = (draw, col, w) => { for (const [ww, a] of [[w + 10, 0.12], [w + 4, 0.3], [w, 1]]) { c.strokeStyle = col.replace("A", a); c.lineWidth = ww; draw(); } };
    glow(() => { c.beginPath(); c.moveTo(R.CX, R.Y0); c.lineTo(R.CX, R.Y1); c.stroke(); }, "rgba(255,60,90,A)", 4);
    glow(() => { c.beginPath(); c.arc(R.CX, R.CY, 110, 0, Math.PI * 2); c.stroke(); }, "rgba(80,170,255,A)", 3);
    for (const x of [R.X0 + 330, R.X1 - 330]) glow(() => { c.beginPath(); c.moveTo(x, R.Y0); c.lineTo(x, R.Y1); c.stroke(); }, "rgba(80,170,255,A)", 3);
    for (const [x, d] of [[R.X0, 1], [R.X1, -1]]) glow(() => { c.beginPath(); c.arc(x, R.CY, 120, d > 0 ? -Math.PI / 2 : Math.PI / 2, d > 0 ? Math.PI / 2 : Math.PI * 1.5); c.stroke(); }, "rgba(80,170,255,A)", 2);
    c.fillStyle = "rgba(255,60,90,0.9)"; c.beginPath(); c.arc(R.CX, R.CY, 8, 0, Math.PI * 2); c.fill();
    c.restore();
    // Les bandes.
    for (const [w, a] of [[16, 0.1], [8, 0.3], [3, 1]]) { c.strokeStyle = `rgba(200,225,255,${a})`; c.lineWidth = w; rinkPath(c); c.stroke(); }
    return bg;
  }
  function drawGoal(c, team, x, d, lit) {
    const col = teamColor(team === 1 ? 2 : 1), y0 = R.CY - R.GOAL / 2;
    c.fillStyle = lit ? col : "rgba(5,8,18,0.95)"; c.globalAlpha = lit ? 0.5 : 1;
    c.fillRect(d > 0 ? x - R.DEPTH : x, y0, R.DEPTH, R.GOAL); c.globalAlpha = 1;
    for (const [w, a] of [[12, 0.15], [5, 0.4], [2.5, 1]]) {
      c.strokeStyle = col.replace(")", `,${a})`).replace("#", "#"); c.globalAlpha = a; c.lineWidth = w;
      c.beginPath(); c.moveTo(x, y0); c.lineTo(d > 0 ? x - R.DEPTH : x + R.DEPTH, y0); c.lineTo(d > 0 ? x - R.DEPTH : x + R.DEPTH, y0 + R.GOAL); c.lineTo(x, y0 + R.GOAL); c.stroke();
    }
    c.globalAlpha = 1;
  }
  function draw(ts, dt) {
    const c = g2d;
    c.drawImage(background(), 0, 0);
    const lit = goalFlash && goalFlash.life > 0 ? goalFlash.team : 0;
    drawGoal(c, 1, R.X0, 1, lit === 2);
    drawGoal(c, 2, R.X1, -1, lit === 1);
    // Les patineurs.
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, face: Math.atan2(mouse.oy, mouse.ox) }; }
      return { ...shownHero(h), team: h.team, robot: h.robot, charge: h.charge };
    });
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      const col = teamColor(v.team), isMe = v.id === me();
      c.save(); c.translate(v.x, v.y);
      c.fillStyle = col; c.globalAlpha = 0.18; c.beginPath(); c.arc(0, 0, 30, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      c.fillStyle = "#07101f"; c.beginPath(); c.arc(0, 0, H.R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = col; c.lineWidth = 4; c.stroke();
      c.rotate(v.face || 0);
      // La crosse.
      c.strokeStyle = "#e8f1ff"; c.lineWidth = 4; c.lineCap = "round"; c.beginPath(); c.moveTo(6, 8); c.lineTo(26, 12); c.lineTo(32, 4); c.stroke();
      if (v.pushT > 0) { c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 3; c.beginPath(); c.arc(0, 0, H.R + 14, -0.9, 0.9); c.stroke(); }
      c.restore();
      if (v.charge > 0 || (isMe && mouse.left && st.carrier === me())) {
        const f = isMe ? Math.min(1, (performance.now() - chargeStart) / (CHARGE_S * 1000)) : v.charge;
        c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 5; c.beginPath(); c.arc(v.x, v.y, 26, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = f >= 1 ? "#ff4d5a" : "#ffffff"; c.beginPath(); c.arc(v.x, v.y, 26, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2); c.stroke();
      }
      c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = isMe ? "#fff" : col; c.fillText(pseudoOf(v.id), v.x, v.y - 32);
    }
    // Le palet (au bout de la crosse du porteur, sinon avancé « au présent »), avec sa traînée.
    let px, py;
    const carrier = st.carrier && views.find((v) => v.id === st.carrier);
    if (carrier) { px = carrier.x + Math.cos(carrier.face || 0) * 28; py = carrier.y + Math.sin(carrier.face || 0) * 28; }
    else { const a = Math.min(0.1, (performance.now() - lastSnapRecv) / 1000); px = st.puck.x + st.puck.vx * a; py = st.puck.y + st.puck.vy * a; }
    // (le palet vient d'être replacé au centre : pas de traînée à travers la glace)
    const lastP = puckTrail[puckTrail.length - 1];
    if (lastP && Math.hypot(lastP.x - px, lastP.y - py) > 120) puckTrail = [];
    puckTrail.push({ x: px, y: py }); if (puckTrail.length > 10) puckTrail.shift();
    for (let i = 1; i < puckTrail.length; i++) { c.strokeStyle = `rgba(255,255,255,${(i / puckTrail.length) * 0.4})`; c.lineWidth = 2 + i; c.beginPath(); c.moveTo(puckTrail[i - 1].x, puckTrail[i - 1].y); c.lineTo(puckTrail[i].x, puckTrail[i].y); c.stroke(); }
    c.fillStyle = "rgba(255,255,255,0.25)"; c.beginPath(); c.arc(px, py, R.PUCK_R + 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#111"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(px, py, R.PUCK_R, 0, Math.PI * 2); c.fill(); c.stroke();
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    c.globalAlpha = 1;
    // Mon viseur.
    const mv = views.find((v) => v.id === me());
    if (mv && st.phase === "play") {
      const tx = mv.x + mouse.ox, ty = mv.y + mouse.oy;
      if (st.carrier === me()) { c.setLineDash([5, 9]); c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 2; c.beginPath(); c.moveTo(px, py); c.lineTo(tx, ty); c.stroke(); c.setLineDash([]); }
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(tx, ty, 9, 0, Math.PI * 2); c.stroke();
      window.VehicleArt.markMe(c, mv.x, mv.y, ts, teamColor(mv.team), window.VehicleArt.markAlpha(st.phase, playSeenAt), 1);
    }
    if (goalFlash) { goalFlash.life -= dt; if (goalFlash.life > 0) { c.fillStyle = teamColor(goalFlash.team); c.globalAlpha = Math.min(0.25, goalFlash.life * 0.2); c.fillRect(0, 0, W, HGT); c.globalAlpha = 1; } else goalFlash = null; }
    drawHud(c);
  }
  function drawHud(c) {
    // Le tableau des scores, en haut au milieu.
    const T = st.teams, x = W / 2, left = Math.ceil((st.timeLeft || 0) / 1000);
    c.fillStyle = "rgba(4,8,20,0.88)"; c.beginPath(); c.roundRect(x - 190, 8, 380, 50, 10); c.fill();
    c.fillStyle = teamColor(1); c.fillRect(x - 190, 8, 8, 50); c.fillStyle = teamColor(2); c.fillRect(x + 182, 8, 8, 50);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "900 30px Segoe UI, sans-serif"; c.fillStyle = teamColor(1); c.fillText(String(st.goals[1]), x - 120, 34);
    c.fillStyle = teamColor(2); c.fillText(String(st.goals[2]), x + 120, 34);
    c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = "#9fb3d9"; c.fillText(T[1].name.toUpperCase(), x - 120, 52); c.fillText(T[2].name.toUpperCase(), x + 120, 52);
    c.font = "900 26px Consolas, monospace"; c.fillStyle = left <= 15 ? "#ff6b6b" : "#ffffff"; c.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, x, 34);
    if (goalFlash) { c.font = "900 90px Segoe UI, sans-serif"; c.fillStyle = teamColor(goalFlash.team); c.globalAlpha = Math.min(1, goalFlash.life); c.fillText("BUT !", x, HGT / 2); c.globalAlpha = 1; }
    if (st.phase === "countdown" || (st.faceoff > 0 && !goalFlash)) {
      const n = Math.ceil((st.phase === "countdown" ? phaseEndLocal - Date.now() : st.faceoff) / 1000);
      c.font = "900 46px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(n > 0 ? `Mise au jeu ${n}` : "GO !", x, HGT / 2 - 150);
    }
    if (st.phase === "play" && document.pointerLockElement !== canvas) { c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,255,255,0.85)"; c.fillText("🖱️ Clique sur la glace : ton viseur te suivra", x, HGT - 14); }
  }
})();
