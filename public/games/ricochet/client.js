// ===================================================================
//  RICOCHET — Client (s'affiche dans le hub Le Bordel)
//  Style néon : grille lumineuse, murs qui brillent, traînées des balles.
//  - L'arène est refaite ici à partir de la seed (arena.js).
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Viseur relatif au bonhomme (souris capturée au 1er clic, Échap la libère).
//  - Clic gauche = tirer (une seule balle), clic droit = bouclier qui renvoie.
// ===================================================================

(() => {
  const H = window.Pieton, A = window.Ricochet;
  const K = H.K;
  const SHIELD = 64, SPEED = 1.1, SHIELD_CD = 4000, SUDDEN_AT = 30000;    // (les mêmes que games/ricochet/server.js)
  const W = A.W, HGT = A.H, AIM_MAX = 320;

  let api = null, root = null;
  let st = null, arena = null, arenaSeed = null, bg = null;
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
  let particles = [], rings = [];
  const trails = {};              // id de balle -> derniers points (pour la traînée)
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0, playAtLocal = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const colorOf = (id) => (st?.teamsMode ? st.teams[st.teamOf[id]]?.color : playerOf(id)?.color) || "#fff";

  const TEMPLATE = `
    <div id="rc-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🎯</span>
        <h1>RICOCHET</h1>
        <p class="tagline">Une balle. Trois rebonds. Une touche.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="rc-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🎯 Tu as <b>une seule balle</b> : elle rebondit 3 fois sur les murs, puis tu peux retirer.</li>
            <li>💀 <b>Une touche = mort</b>, ta propre balle aussi quand elle revient.</li>
            <li>🛡️ <b>Clic droit</b> : un bouclier très court qui <b>renvoie</b> une balle là où tu vises (recharge 4 s).</li>
            <li>⚡ Après 30 s, l'arène rétrécit. Une manche chacun pour soi, une manche en équipes.</li>
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches : bouger · clic gauche : tirer.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="rc-start" class="btn btn-primary btn-big">🎯 En position !</button>
        <p id="rc-hint" class="muted"></p>
        <p id="rc-error" class="error-msg"></p>
        <button id="rc-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="rc-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="rc-round"></span>
        <span id="rc-me" class="ch-role"></span>
        <span id="rc-alive" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="rc-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="rc-feed" class="so-feed"></ul>
        <div id="rc-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · clic gauche = tirer · clic droit = bouclier · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.ricochet = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; rings = []; arenaSeed = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-night");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("rc-canvas");
      g2d = canvas.getContext("2d");
      $("rc-start").onclick = () => {
        $("rc-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("rc-error").textContent = r.error; });
      };
      $("rc-finish-setup").onclick = () => api.action("finish");
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
      if (st.phase === "play" && prevPhase !== "play") { playSeenAt = performance.now(); playAtLocal = performance.now(); }
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); for (const k in trails) delete trails[k]; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (["setup", "over"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();   // (entre deux manches, la souris reste capturée)
      if (st.phase === "setup") {
        $("rc-play").classList.add("hidden");
        $("rc-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("rc-setup").classList.add("hidden");
      $("rc-play").classList.remove("hidden");
      if (st.seed !== arenaSeed) { arenaSeed = st.seed; arena = A.build(st.seed); bg = null; }
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
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: SHIELD, KeyE: SHIELD };
  function onBlur() { pressed.clear(); mouse.left = mouse.right = false; }
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
    else {
      if (e.target !== canvas) return;
      const p = myPos();
      if (!p) return;
      mouse.ox = (e.clientX - r.left) * k - p.x; mouse.oy = (e.clientY - r.top) * (HGT / r.height) - p.y;
    }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  function onDown(e) {
    if (e.button === 0) {
      // Le 1er clic capture la souris (on ne tire pas avec ce clic-là).
      if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); }   // (ce clic compte aussi)
      mouse.left = true;
    }
    if (e.button === 2) mouse.right = true;
  }
  function onUp(e) {
    if (e.button === 0) mouse.left = false;
    if (e.button === 2) mouse.right = false;
  }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.left) k |= K.FIRE;
    if (mouse.right) k |= SHIELD;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const env = () => ({ walls: true, w: W, h: HGT, noDash: true, speedMul: SPEED, segs: arena.walls });
  const moveBits = (k) => k & (K.UP | K.DOWN | K.LEFT | K.RIGHT);
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving() || !sc.alive || !arena) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = H.copy(sc);
    const E = env();
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k), p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; }
    }
  }
  function driveLocal(dt) {
    if (!pred || !driving() || !arena) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    const E = env();
    while (acc >= H.TICK) {
      const k = keyMask();
      const a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k), a, E, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me() && h.alive).map((h) => H.extrapolate(h, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / H.TICK) * H.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownHero(h) {
    const base = driving() ? H.extrapolate(h, aheadNow()) : h;
    const o = othersOff[h.id] || { x: 0, y: 0 };
    const v = { ...base, x: base.x + o.x, y: base.y + o.y };
    lastShown[h.id] = v;
    return v;
  }
  function rebase() {
    const t = aheadNow();
    for (const h of st.heroes) {
      if (h.id === me() && pred) continue;
      const prev = lastShown[h.id];
      const base = driving() ? H.extrapolate(h, t) : h;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 100) othersOff[h.id] = { x: prev.x - base.x, y: prev.y - base.y };
      else othersOff[h.id] = { x: 0, y: 0 };
    }
  }

  // ===================================================================
  //  EFFETS
  // ===================================================================
  function burst(x, y, n, col, speed) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.5, max: 0.8, col, len: 4 + Math.random() * 10 });
    }
  }
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const col = colorOf(f.who);
      if (f.kind === "mort") { burst(f.x, f.y, 44, col, 420); rings.push({ x: f.x, y: f.y, r: 10, life: 0.5, max: 0.5, col }); shake = f.who === me() ? 14 : 6; }
      else if (f.kind === "tir") burst(f.x, f.y, 8, col, 160);
      else if (f.kind === "renvoi") { burst(f.x, f.y, 18, "#ffffff", 260); rings.push({ x: f.x, y: f.y, r: 8, life: 0.3, max: 0.3, col: "#ffffff" }); }
      else if (f.kind === "fin") burst(f.x, f.y, 6, col, 90);
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("rc-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[5, "5"], [8, "8"], [12, "12"]])}</div>
      <div class="setting-block"><label>Mode</label>${chips("mode", [["auto", "🔁 Alterné"], ["solo", "🎯 Chacun pour soi"], ["equipes", "🔷🔶 2 équipes"]])}</div>
      <p class="settings-note">Une nouvelle arène à chaque manche. Les équipes, dès 4 joueurs en nombre pair.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      const v = b.dataset.v;
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: isNaN(Number(v)) ? v : Number(v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("rc-start").style.display = host ? "" : "none";
    $("rc-start").disabled = n < 2;
    $("rc-finish-setup").classList.toggle("hidden", !host);
    $("rc-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} tireurs`;
  }

  function renderHud() {
    $("rc-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = heroOf(me());
    const tm = st.teamsMode && mine ? st.teams[st.teamOf[me()]] : null;
    const txt = !mine ? "👀 Tu regardes" : !mine.alive ? "💀 Touché : tu regardes la fin" : `${tm ? `${tm.emoji} ${esc(tm.name)} · ` : ""}${mine.hasBullet ? "🎯 Balle prête" : "⏳ Balle en vol"}`;
    if ($("rc-me").innerHTML !== txt) $("rc-me").innerHTML = txt;
    $("rc-alive").textContent = `${st.heroes.filter((h) => h.alive).length} en vie${st.teamsMode ? " · équipes" : ""}`;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("rc-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }   // (comparé à notre propre texte : sinon il clignote)
  }

  function renderOver() {
    const ov = $("rc-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = st.teamsMode ? (lr.winTeam ? `🏆 Victoire des ${st.teams[lr.winTeam].emoji} ${esc(st.teams[lr.winTeam].name)} !` : "🤝 Personne ne reste !")
      : lr.winner ? `🏆 ${esc(pseudoOf(lr.winner))} reste debout !` : "💀 Personne ne reste debout !";
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.elims[id] ? `🎯 ${lr.elims[id]} élimination${lr.elims[id] > 1 ? "s" : ""}` : ""}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = `<p class="muted">Manche suivante dans <b id="rc-next-sec"></b> s…</p>` + (st.playlist ? "" : host ? `<div class="go-actions"><button id="rc-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="rc-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>');
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="rc-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="rc-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="rc-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="rc-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="rc-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="rc-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("rc-next") && ($("rc-next").onclick = () => api.action("next"));
    $("rc-again") && ($("rc-again").onclick = () => api.action("start").then((r) => { if (r.error) $("rc-over-error").textContent = r.error; }));
    $("rc-to-setup") && ($("rc-to-setup").onclick = () => api.action("setup"));
    $("rc-finish") && ($("rc-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Ricochet ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["rc-fin-sec", finishEndLocal], ["rc-next-sec", phaseEndLocal]]) {
      const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
    if (!st || st.phase === "setup" || !arena) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }

  // Le fond (dessiné une fois par arène) : grille néon, horizon, murs lumineux.
  function background() {
    if (bg) return bg;
    bg = document.createElement("canvas"); bg.width = W; bg.height = HGT;
    const c = bg.getContext("2d");
    const gr = c.createRadialGradient(W / 2, HGT / 2, 80, W / 2, HGT / 2, W * 0.75);
    gr.addColorStop(0, "#1a0b33"); gr.addColorStop(1, "#05030c");
    c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    // La grille.
    for (let x = 0; x <= W; x += 40) { c.strokeStyle = x % 200 ? "rgba(120,80,255,0.12)" : "rgba(160,110,255,0.28)"; c.lineWidth = 1; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, HGT); c.stroke(); }
    for (let y = 0; y <= HGT; y += 40) { c.strokeStyle = y % 200 ? "rgba(120,80,255,0.12)" : "rgba(160,110,255,0.28)"; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // Le bord.
    for (const [w, a] of [[14, 0.12], [6, 0.35], [2, 1]]) { c.strokeStyle = `rgba(255,63,216,${a})`; c.lineWidth = w; c.strokeRect(3, 3, W - 6, HGT - 6); }
    // Les murs : un halo, puis le cœur brillant.
    c.lineCap = "round";
    for (const s of arena.walls) {
      const col = s.kind === "biais" ? "255,210,63" : s.kind === "pilier" ? "255,63,216" : "33,230,255";
      for (const [extra, a] of [[22, 0.08], [12, 0.18], [0, 1]]) {
        c.strokeStyle = extra ? `rgba(${col},${a})` : "#0b0618"; c.lineWidth = s.t + extra;
        c.beginPath(); c.moveTo(s.x1, s.y1); c.lineTo(s.x2, s.y2); c.stroke();
      }
      c.strokeStyle = `rgba(${col},1)`; c.lineWidth = 3;
      if (s.kind === "pilier") { c.beginPath(); c.arc(s.x1, s.y1, s.t / 2 - 2, 0, Math.PI * 2); c.stroke(); }
      else {
        const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = Math.hypot(dx, dy), nx = -dy / L * (s.t / 2 - 2), ny = dx / L * (s.t / 2 - 2);
        c.beginPath(); c.moveTo(s.x1 + nx, s.y1 + ny); c.lineTo(s.x2 + nx, s.y2 + ny); c.moveTo(s.x1 - nx, s.y1 - ny); c.lineTo(s.x2 - nx, s.y2 - ny); c.stroke();
      }
    }
    return bg;
  }

  function draw(ts, dt) {
    const c = g2d;
    c.save();
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.drawImage(background(), 0, 0);
    // Le bord qui rétrécit.
    const m = st.shrink || 0;
    if (m > 0) {
      const x0 = W * m, y0 = HGT * m, x1 = W * (1 - m), y1 = HGT * (1 - m);
      c.fillStyle = "rgba(255,20,60,0.22)";
      c.fillRect(0, 0, W, y0); c.fillRect(0, y1, W, HGT - y1); c.fillRect(0, y0, x0, y1 - y0); c.fillRect(x1, y0, W - x1, y1 - y0);
      for (const [w, a] of [[12, 0.2], [3, 1]]) { c.strokeStyle = `rgba(255,40,80,${a})`; c.lineWidth = w; c.strokeRect(x0, y0, x1 - x0, y1 - y0); }
    }
    // Les bonshommes : un anneau lumineux de leur couleur, et le canon dans la direction visée.
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, face: Math.atan2(mouse.oy, mouse.ox) }; }
      return { ...shownHero(h), alive: h.alive, shield: h.shield, hasBullet: h.hasBullet };
    });
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      if (!v.alive) continue;
      const col = colorOf(v.id), isMe = v.id === me();
      c.save(); c.translate(v.x, v.y);
      c.fillStyle = col; c.globalAlpha = 0.16; c.beginPath(); c.arc(0, 0, 30, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      c.fillStyle = "#0b0618"; c.beginPath(); c.arc(0, 0, H.R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = col; c.lineWidth = 4; c.stroke();
      c.rotate(v.face || 0);
      c.fillStyle = col; c.fillRect(H.R - 4, -4, 16, 8);
      if (v.hasBullet) { c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, 5, 0, Math.PI * 2); c.fill(); }
      c.restore();
      if (v.shield) {
        c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 5; c.beginPath(); c.arc(v.x, v.y, H.R + 14, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = col; c.lineWidth = 12; c.globalAlpha = 0.35; c.stroke(); c.globalAlpha = 1;
      }
      c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = isMe ? "#fff" : col;
      c.fillText(pseudoOf(v.id), v.x, v.y - 34);
    }
    // Les balles, avec leur traînée.
    const ahead = Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
    const live = new Set();
    for (const b of st.bullets || []) {
      live.add(b.id);
      const x = b.x + b.vx * ahead, y = b.y + b.vy * ahead, col = colorOf(b.by);
      const tr = trails[b.id] || (trails[b.id] = []);
      const last = tr[tr.length - 1];
      if (!last || Math.hypot(last.x - x, last.y - y) > 4) { tr.push({ x, y }); if (tr.length > 14) tr.shift(); }
      c.lineCap = "round";
      for (let i = 1; i < tr.length; i++) { c.strokeStyle = col; c.globalAlpha = (i / tr.length) * 0.7; c.lineWidth = 2 + (i / tr.length) * 6; c.beginPath(); c.moveTo(tr[i - 1].x, tr[i - 1].y); c.lineTo(tr[i].x, tr[i].y); c.stroke(); }
      c.globalAlpha = 1;
      c.fillStyle = col; c.globalAlpha = 0.35; c.beginPath(); c.arc(x, y, A.BULLET_R + 6, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      c.fillStyle = "#fff"; c.beginPath(); c.arc(x, y, A.BULLET_R, 0, Math.PI * 2); c.fill();
      // Les rebonds qui lui restent : de petits points.
      for (let k = 0; k < b.left; k++) { c.fillStyle = col; c.beginPath(); c.arc(x - 6 + k * 6, y - 13, 2, 0, Math.PI * 2); c.fill(); }
    }
    for (const id in trails) if (!live.has(Number(id))) delete trails[id];
    // Étincelles et ondes.
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
      c.globalAlpha = Math.max(0, p.life / p.max); c.strokeStyle = p.col; c.lineWidth = 2;
      const l = Math.hypot(p.vx, p.vy) || 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - (p.vx / l) * p.len, p.y - (p.vy / l) * p.len); c.stroke();
    }
    rings = rings.filter((r) => (r.life -= dt) > 0);
    for (const r of rings) { r.r += dt * 260; c.globalAlpha = r.life / r.max; c.strokeStyle = r.col; c.lineWidth = 3; c.beginPath(); c.arc(r.x, r.y, r.r, 0, Math.PI * 2); c.stroke(); }
    c.globalAlpha = 1;
    // Ma ligne de visée : jusqu'au premier rebond seulement.
    const mv = views.find((v) => v.id === me() && v.alive);
    if (mv && st.phase === "play") {
      const a = Math.atan2(mouse.oy, mouse.ox), mh = heroOf(me());
      const pts = A.trace(arena, mv.x + Math.cos(a) * 24, mv.y + Math.sin(a) * 24, a, 0, 1.5);
      const hit = pts[1] || pts[0];
      c.setLineDash([4, 10]); c.strokeStyle = mh?.hasBullet ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.18)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(mv.x + Math.cos(a) * 24, mv.y + Math.sin(a) * 24); c.lineTo(hit.x, hit.y); c.stroke(); c.setLineDash([]);
      c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 2; c.beginPath(); c.arc(hit.x, hit.y, 6, 0, Math.PI * 2); c.stroke();
      const tx = mv.x + mouse.ox, ty = mv.y + mouse.oy;
      c.strokeStyle = "#fff"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(tx - 12, ty); c.lineTo(tx - 4, ty); c.moveTo(tx + 4, ty); c.lineTo(tx + 12, ty); c.moveTo(tx, ty - 12); c.lineTo(tx, ty - 4); c.moveTo(tx, ty + 4); c.lineTo(tx, ty + 12); c.stroke();
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, colorOf(me()), window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();
    drawHud(c, mv);
  }

  function drawHud(c, mv) {
    const mine = heroOf(me());
    // En bas au milieu, petit : ma balle et mon bouclier.
    if (mine?.alive && st.phase === "play") {
      const x = W / 2 - 150, y = HGT - 46;
      c.fillStyle = "rgba(8,4,20,0.75)"; c.beginPath(); c.roundRect(x, y, 300, 34, 10); c.fill();
      c.font = "bold 15px Segoe UI, sans-serif"; c.textAlign = "left"; c.textBaseline = "middle";
      c.fillStyle = mine.hasBullet ? "#3dff7a" : "#8a7fb0"; c.fillText(mine.hasBullet ? "🎯 Balle prête" : "⏳ Balle en vol", x + 12, y + 17);
      const f = 1 - Math.min(1, mine.shieldCd / SHIELD_CD);
      c.fillStyle = "rgba(255,255,255,0.15)"; c.fillRect(x + 160, y + 11, 128, 12);
      c.fillStyle = f >= 1 ? "#21e6ff" : "#5b6fa0"; c.fillRect(x + 160, y + 11, 128 * f, 12);
      c.font = "bold 11px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(f >= 1 ? "🛡️ PRÊT" : "🛡️", x + 166, y + 17);
    }
    // Au début : on se place, personne ne peut tirer.
    if (st.phase === "play" && st.prep > 0) { c.font = "900 30px Segoe UI, sans-serif"; c.textAlign = "center"; c.fillStyle = "#21e6ff"; c.fillText(`Placez-vous… tir dans ${Math.ceil(st.prep / 1000)} s`, W / 2, 44); }
    // La mort subite arrive.
    if (st.phase === "play") {
      const left = SUDDEN_AT - (performance.now() - playAtLocal);
      if (left > 0 && left < 5000) { c.font = "900 26px Segoe UI, sans-serif"; c.textAlign = "center"; c.fillStyle = "#ff4060"; c.fillText(`⚡ L'arène rétrécit dans ${Math.ceil(left / 1000)} s`, W / 2, 40); }
    }
    if (mv && document.pointerLockElement !== canvas && st.phase === "play") {
      c.font = "bold 15px Segoe UI, sans-serif"; c.textAlign = "center"; c.fillStyle = "rgba(255,255,255,0.85)";
      c.fillText("🖱️ Clique sur l'arène : ton viseur te suivra", W / 2, HGT - 62);
    }
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(5,3,12,0.7)"; c.fillRect(0, HGT / 2 - 80, W, 160);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "900 64px Segoe UI, sans-serif"; c.fillStyle = "#21e6ff"; c.fillText(left > 0 ? String(left) : "GO !", W / 2, HGT / 2 - 18);
      c.font = "22px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(st.teamsMode ? "Manche en équipes : élimine l'autre couleur" : "Chacun pour soi : dernier debout", W / 2, HGT / 2 + 40);
    }
  }
})();
