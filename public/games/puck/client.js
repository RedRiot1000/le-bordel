// ===================================================================
//  PUCK — Client (s'affiche dans le hub Le Bordel)
//  Air hockey néon : glace sombre, lignes lumineuses, buts qui s'illuminent,
//  tableau des scores façon retransmission.
//  - Mon maillet suit ma souris tout de suite (calculé ici), dans ma moitié.
//  - Le palet et les autres viennent du serveur (avancés « au présent »).
// ===================================================================

(() => {
  const R = window.Rink;
  const W = R.W, HGT = R.H, MALLET_R = 28, MALLET_V = 1700;   // (les mêmes que games/puck/server.js)

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0, acc = 0;
  let canvas = null, g2d = null, bg = null;
  const mouse = { x: R.CX - 200, y: R.CY };
  let mine = null, particles = [], puckTrail = [], goalFlash = null;
  const seenFx = new Set(), shown = {};
  let lastSnapRecv = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => (id === "robot" ? "Robot" : playerOf(id)?.pseudo || "?");
  const malletOf = (id) => st?.mallets.find((m) => m.id === id);
  const teamColor = (tm) => st?.teams[tm]?.color || "#fff";

  // Un maillet reste dans sa moitié (comme sur le serveur).
  function clampMallet(team, p) {
    const r = MALLET_R;
    p.x = team === 1 ? Math.max(R.X0 + r, Math.min(R.CX - r, p.x)) : Math.max(R.CX + r, Math.min(R.X1 - r, p.x));
    p.y = Math.max(R.Y0 + r, Math.min(R.Y1 - r, p.y));
    const o = { x: p.x, y: p.y, vx: 0, vy: 0 }; R.keepIn(o, r); p.x = o.x; p.y = o.y;
    return p;
  }

  const TEMPLATE = `
    <div id="pu-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🏒</span>
        <h1>PUCK</h1>
        <p class="tagline">Air hockey néon. Percute le palet, défends ton but.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="pu-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🖱️ Ton <b>maillet suit ta souris</b>, dans ta moitié du terrain : tu ne passes jamais la ligne rouge du milieu.</li>
            <li>💥 On ne touche le palet qu'en le <b>percutant</b> : plus tu frappes vite, plus il part vite.</li>
            <li>🧱 Il rebondit sur les bandes : vise les angles, et garde ton but.</li>
            <li>👥 Deux équipes. En nombre impair, un robot complète.</li>
            <li>🏆 +2 par but, +3 pour l'équipe gagnante (+1 chacun en cas d'égalité).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="pu-start" class="btn btn-primary btn-big">🏒 Mise en jeu !</button>
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
        <canvas id="pu-canvas" width="${W}" height="${HGT}" style="cursor:none"></canvas>
        <ul id="pu-feed" class="so-feed"></ul>
        <div id="pu-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">Souris = déplacer ton maillet (dans ta moitié) · percute le palet vers le but adverse</p>
    </div>`;

  window.GAMES.puck = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; mine = null; particles = []; puckTrail = []; bg = null;
      seenFx.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("pu-canvas");
      g2d = canvas.getContext("2d");
      $("pu-start").onclick = () => { $("pu-error").textContent = ""; api.action("start").then((r) => { if (r.error) $("pu-error").textContent = r.error; }); };
      $("pu-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("mousemove", onMouse);
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (st.phase === "setup") { $("pu-play").classList.add("hidden"); $("pu-setup").classList.remove("hidden"); renderSettings(); return; }
      $("pu-setup").classList.add("hidden");
      $("pu-play").classList.remove("hidden");
      lastSnapRecv = performance.now();
      // Mon maillet : je le garde tel que je le calcule ; je le recale seulement s'il s'écarte trop (engagement, retard).
      const sm = malletOf(me());
      if (sm && (!mine || Math.hypot(mine.x - sm.x, mine.y - sm.y) > 90 || st.faceoff > 0 || st.phase !== "play")) mine = { x: sm.x, y: sm.y, team: sm.team };
      handleFx();
      renderHud();
      renderOver();
    },
    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("mousemove", onMouse);
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width); mouse.y = (e.clientY - r.top) * (HGT / r.height);
  }
  // Mon maillet va vers la souris (même vitesse max que sur le serveur), et j'envoie la cible 30 fois par seconde.
  function drive(dt) {
    if (!mine) return;
    if (st.phase === "play" && !(st.faceoff > 0)) {
      const t = clampMallet(mine.team, { x: mouse.x, y: mouse.y }), dx = t.x - mine.x, dy = t.y - mine.y, d = Math.hypot(dx, dy), step = MALLET_V * dt;
      const k = d > step ? step / d : 1;
      mine.x += dx * k; mine.y += dy * k;
    }
    acc = Math.min(acc + dt, 0.2);
    while (acc >= 1 / 30) { acc -= 1 / 30; api.send("in", { p: { x: Math.round(mouse.x), y: Math.round(mouse.y) } }); }
  }

  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "but" ? 70 : 10, col = f.kind === "but" ? teamColor(f.team) : f.team ? teamColor(f.team) : "#fff";
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * (f.kind === "but" ? 520 : 200); particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.5, max: 0.9, col }); }
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
    const m = malletOf(me()), tm = m && st.teams[m.team];
    const txt = !m ? "👀 Tu regardes" : m.team === 1 ? "🏒 Tu défends le but de GAUCHE" : "🏒 Tu défends le but de DROITE";
    if ($("pu-me").textContent !== txt) $("pu-me").textContent = txt;
    $("pu-team").textContent = tm ? `${tm.emoji} ${tm.name}` : "";
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("pu-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }
  }
  function renderOver() {
    const ov = $("pu-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    canvas.style.cursor = show ? "" : "none";
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
      buttons = `<p class="muted">Match suivant dans <b id="pu-next-sec"></b> s…</p>` + (st.playlist ? "" : host ? `<div class="go-actions"><button id="pu-next" class="btn btn-primary">Match suivant ▶</button><button id="pu-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : "");
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
    drive(dt);
    draw(ts, dt);
  }
  const rinkPath = (c) => { c.beginPath(); c.roundRect(R.X0, R.Y0, R.X1 - R.X0, R.Y1 - R.Y0, R.CORNER); };
  function background() {
    if (bg) return bg;
    bg = document.createElement("canvas"); bg.width = W; bg.height = HGT;
    const c = bg.getContext("2d");
    c.fillStyle = "#050812"; c.fillRect(0, 0, W, HGT);
    rinkPath(c); const gr = c.createRadialGradient(R.CX, R.CY, 60, R.CX, R.CY, 700); gr.addColorStop(0, "#14233f"); gr.addColorStop(1, "#0a1428"); c.fillStyle = gr; c.fill();
    c.save(); rinkPath(c); c.clip();
    // Chaque moitié, teintée de la couleur de son équipe.
    c.fillStyle = "rgba(33,230,255,0.05)"; c.fillRect(R.X0, R.Y0, R.CX - R.X0, R.Y1 - R.Y0);
    c.fillStyle = "rgba(255,138,31,0.05)"; c.fillRect(R.CX, R.Y0, R.X1 - R.CX, R.Y1 - R.Y0);
    // Les petits trous d'air de la table.
    c.fillStyle = "rgba(160,200,255,0.07)"; for (let x = R.X0 + 20; x < R.X1; x += 30) for (let y = R.Y0 + 20; y < R.Y1; y += 30) c.fillRect(x, y, 2, 2);
    const glow = (draw, col, w) => { for (const [ww, a] of [[w + 12, 0.12], [w + 5, 0.3], [w, 1]]) { c.strokeStyle = col.replace("A", a); c.lineWidth = ww; draw(); } };
    // La ligne du milieu : une barrière (personne ne la passe).
    glow(() => { c.beginPath(); c.moveTo(R.CX, R.Y0); c.lineTo(R.CX, R.Y1); c.stroke(); }, "rgba(255,60,90,A)", 6);
    glow(() => { c.beginPath(); c.arc(R.CX, R.CY, 110, 0, Math.PI * 2); c.stroke(); }, "rgba(80,170,255,A)", 3);
    for (const [x, d] of [[R.X0, 1], [R.X1, -1]]) glow(() => { c.beginPath(); c.arc(x, R.CY, 150, d > 0 ? -Math.PI / 2 : Math.PI / 2, d > 0 ? Math.PI / 2 : Math.PI * 1.5); c.stroke(); }, "rgba(80,170,255,A)", 2);
    c.restore();
    for (const [w, a] of [[16, 0.1], [8, 0.3], [3, 1]]) { c.strokeStyle = `rgba(200,225,255,${a})`; c.lineWidth = w; rinkPath(c); c.stroke(); }
    return bg;
  }
  function drawGoal(c, x, d, col, lit) {
    const y0 = R.CY - R.GOAL / 2;
    c.fillStyle = lit ? col : "rgba(5,8,18,0.95)"; c.globalAlpha = lit ? 0.5 : 1;
    c.fillRect(d > 0 ? x - R.DEPTH : x, y0, R.DEPTH, R.GOAL); c.globalAlpha = 1;
    c.strokeStyle = col; c.lineWidth = 4;
    c.beginPath(); c.moveTo(x, y0); c.lineTo(d > 0 ? x - R.DEPTH : x + R.DEPTH, y0); c.lineTo(d > 0 ? x - R.DEPTH : x + R.DEPTH, y0 + R.GOAL); c.lineTo(x, y0 + R.GOAL); c.stroke();
  }
  function mallet(c, x, y, col, isMe) {
    c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.arc(x + 4, y + 6, MALLET_R, 0, Math.PI * 2); c.fill();
    c.fillStyle = col; c.globalAlpha = 0.25; c.beginPath(); c.arc(x, y, MALLET_R + 10, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    c.fillStyle = "#0a1220"; c.beginPath(); c.arc(x, y, MALLET_R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = col; c.lineWidth = 5; c.stroke();
    c.fillStyle = col; c.beginPath(); c.arc(x, y, 11, 0, Math.PI * 2); c.fill();
    c.fillStyle = "rgba(255,255,255,0.6)"; c.beginPath(); c.arc(x - 3, y - 3, 4, 0, Math.PI * 2); c.fill();
    if (isMe) { c.strokeStyle = "#fff"; c.lineWidth = 2; c.setLineDash([4, 5]); c.beginPath(); c.arc(x, y, MALLET_R + 7, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
  }
  function draw(ts, dt) {
    const c = g2d;
    c.drawImage(background(), 0, 0);
    const lit = goalFlash && goalFlash.life > 0 ? goalFlash.team : 0;
    drawGoal(c, R.X0, 1, teamColor(1), lit === 2);
    drawGoal(c, R.X1, -1, teamColor(2), lit === 1);
    // Les maillets : les autres glissent vers leur position, le mien suit ma souris.
    const ahead = Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const m of st.mallets) {
      let x, y;
      if (m.id === me() && mine) { x = mine.x; y = mine.y; }
      else {
        const sh = shown[m.id] || (shown[m.id] = { x: m.x, y: m.y });
        const k = Math.min(1, dt * 18);
        sh.x += (m.x + m.vx * ahead * 0.5 - sh.x) * k; sh.y += (m.y + m.vy * ahead * 0.5 - sh.y) * k;
        x = sh.x; y = sh.y;
      }
      mallet(c, x, y, teamColor(m.team), m.id === me());
      c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = m.id === me() ? "#fff" : teamColor(m.team); c.fillText(pseudoOf(m.id), x, y - MALLET_R - 14);
    }
    // Le palet, avancé « au présent », avec sa traînée.
    const px = st.puck.x + st.puck.vx * ahead, py = st.puck.y + st.puck.vy * ahead;
    const lastP = puckTrail[puckTrail.length - 1];
    if (lastP && Math.hypot(lastP.x - px, lastP.y - py) > 160) puckTrail = [];
    puckTrail.push({ x: px, y: py }); if (puckTrail.length > 12) puckTrail.shift();
    for (let i = 1; i < puckTrail.length; i++) { c.strokeStyle = `rgba(255,255,255,${(i / puckTrail.length) * 0.4})`; c.lineWidth = 2 + i; c.beginPath(); c.moveTo(puckTrail[i - 1].x, puckTrail[i - 1].y); c.lineTo(puckTrail[i].x, puckTrail[i].y); c.stroke(); }
    c.fillStyle = "rgba(255,255,255,0.25)"; c.beginPath(); c.arc(px, py, R.PUCK_R + 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#111"; c.strokeStyle = "#fff"; c.lineWidth = 3; c.beginPath(); c.arc(px, py, R.PUCK_R, 0, Math.PI * 2); c.fill(); c.stroke();
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    c.globalAlpha = 1;
    // Où est ma souris (si elle est de l'autre côté de la ligne, mon maillet reste à la ligne).
    if (st.phase === "play" || st.phase === "countdown") { c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 1.5; c.beginPath(); c.arc(mouse.x, mouse.y, 6, 0, Math.PI * 2); c.stroke(); }
    if (goalFlash) { goalFlash.life -= dt; if (goalFlash.life > 0) { c.fillStyle = teamColor(goalFlash.team); c.globalAlpha = Math.min(0.25, goalFlash.life * 0.2); c.fillRect(0, 0, W, HGT); c.globalAlpha = 1; } else goalFlash = null; }
    drawHud(c);
  }
  function drawHud(c) {
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
      c.fillStyle = "rgba(4,8,20,0.8)"; c.beginPath(); c.roundRect(x - 140, 66, 280, 40, 10); c.fill();
      c.font = "900 24px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(n > 0 ? `Mise en jeu ${n}` : "GO !", x, 86);
    }
  }
})();
