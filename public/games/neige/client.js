// ===================================================================
//  BOULES DE NEIGE — Client (s'affiche dans le hub Le Bordel)
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Viseur RELATIF à mon bonhomme (il me suit quand je marche) ; la souris
//    est capturée au 1er clic (Échap la libère).
//  - Clic gauche maintenu = charger, relâché = lancer. Clic droit / R = fabriquer.
// ===================================================================

(() => {
  const H = window.Pieton;
  const K = H.K;
  const MAKE = 64;                                    // (le même que games/neige/server.js)
  const W = 1280, HGT = 800, WALL_HP = 4, BALL_R = 7, MAX_BALLS = 3, MAKE_S = 1;
  const rangeOf = (c) => 230 + 400 * c;
  const wallRect = (w) => { const f = 0.35 + 0.65 * (w.hp / WALL_HP), cw = w.w * f, ch = w.h * f; return { x: w.x + (w.w - cw) / 2, y: w.y + (w.h - ch) / 2, w: cw, h: ch }; };

  let api = null, root = null;
  let st = null;
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
  const AIM_MAX = 320;
  let chargeStart = 0;                 // pour la jauge de charge (côté navigateur)
  let particles = [];
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const colorOf = (id) => (st?.teamsMode ? st.teams[st.teamOf[id]]?.color : playerOf(id)?.color) || "#fff";

  const TEMPLATE = `
    <div id="sn-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">❄️</span>
        <h1>BOULES DE NEIGE</h1>
        <p class="tagline">Charge, vise, lance… et cache-toi avant que le muret fonde.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="sn-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches : bouger · 🖱️ le viseur te suit (clique sur l'arène pour capturer la souris).</li>
            <li>🖱️ <b>Maintiens le clic gauche</b> pour charger, <b>lâche</b> pour lancer : plus c'est chargé, plus ça va loin et vite.</li>
            <li>⛄ <b>Clic droit</b> (ou <kbd>R</kbd>) : tu te baisses pour fabriquer une boule (1 s, tu ne bouges plus). 3 boules max.</li>
            <li>🧱 Les murets arrêtent les boules… et fondent petit à petit.</li>
            <li>❤️ 3 cœurs : touché 3 fois = éliminé. Dernier debout (ou dernière équipe) gagne la manche.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="sn-start" class="btn btn-primary btn-big">Bataille !</button>
        <p id="sn-hint" class="muted"></p>
        <p id="sn-error" class="error-msg"></p>
        <button id="sn-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="sn-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="sn-round"></span>
        <span id="sn-me" class="ch-role"></span>
        <span id="sn-ammo" class="sn-ammo"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="sn-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="sn-feed" class="so-feed"></ul>
        <div id="sn-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · clic gauche maintenu = charger, lâché = lancer · clic droit / R = fabriquer une boule · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.neige = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = [];
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("sn-canvas");
      g2d = canvas.getContext("2d");
      $("sn-start").onclick = () => {
        $("sn-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("sn-error").textContent = r.error; });
      };
      $("sn-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => { pressed.clear(); mouse.left = mouse.right = false; });
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
      if (st.phase === "setup") {
        $("sn-play").classList.add("hidden");
        $("sn-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("sn-setup").classList.add("hidden");
      $("sn-play").classList.remove("hidden");
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
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, KeyR: MAKE };
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
      // Le 1er clic capture la souris (on ne lance pas avec ce clic-là).
      if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
      mouse.left = true; chargeStart = performance.now();
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
    if (mouse.right) k |= MAKE;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const env = () => ({ walls: true, w: W, h: HGT, rects: (st?.walls || []).map(wallRect), noDash: true });
  // Pendant qu'on fabrique une boule, on ne bouge pas (comme le serveur).
  const moveBits = (k, balls) => ((k & MAKE) && balls < MAX_BALLS ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT));
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving() || !sc.alive) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = H.copy(sc);
    const E = env();
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k, sc.balls), p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; }
    }
  }
  function driveLocal(dt) {
    if (!pred || !driving()) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    const E = env(), balls = heroOf(me())?.balls ?? 0;
    while (acc >= H.TICK) {
      const k = keyMask();
      const a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k, balls), a, E, othersAt(pending.length * H.TICK));
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
  //  EFFETS : neige qui éclabousse
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "hit" ? 22 : f.kind === "wall" ? 14 : 8;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (f.kind === "hit" ? 220 : 140);
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, max: 0.6, r: 1.5 + Math.random() * 3 });
      }
      if (f.kind === "hit") shake = 5;
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("sn-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"], [8, "8"]])}</div>
      <div class="setting-block"><label>Mode</label>${chips("mode", [["auto", "🔁 Alterné"], ["solo", "⛄ Chacun pour soi"], ["equipes", "🔴🔵 2 équipes"]])}</div>
      <p class="settings-note">Après 75 s de manche : mort subite (tout le monde à 1 cœur).</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      const v = b.dataset.v;
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: isNaN(Number(v)) ? v : Number(v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const teams = s.mode === "equipes" || (s.mode === "auto" && n >= 4);
    $("sn-start").style.display = host ? "" : "none";
    $("sn-start").disabled = n < 2;
    $("sn-finish-setup").classList.toggle("hidden", !host);
    $("sn-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : teams ? `${n} joueurs → 2 équipes` : `${n} joueurs, chacun pour soi`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("sn-round").textContent = `Manche ${st.round}/${st.settings.rounds}${st.sudden ? " · ⚠️ MORT SUBITE" : ""}`;
    const mine = heroOf(me());
    const tm = st.teamsMode && mine ? st.teams[st.teamOf[me()]] : null;
    const txt = !mine ? "👀 Tu regardes" : !mine.alive ? "☃️ Éliminé : tu regardes la fin" : `${"❤️".repeat(mine.hearts)}${"🤍".repeat(Math.max(0, 3 - mine.hearts))}${tm ? ` · ${tm.emoji} ${esc(tm.name)}` : ""}`;
    if ($("sn-me").innerHTML !== txt) $("sn-me").innerHTML = txt;
    const ammo = mine?.alive ? `${"⚪".repeat(mine.balls)}${"◌".repeat(MAX_BALLS - mine.balls)}` : "";
    if ($("sn-ammo").textContent !== ammo) $("sn-ammo").textContent = ammo;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("sn-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }   // (comparé à notre propre texte : sinon il clignote)
  }

  function renderOver() {
    const ov = $("sn-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = st.teamsMode ? (lr.winTeam ? `🏆 Victoire des ${st.teams[lr.winTeam].emoji} ${esc(st.teams[lr.winTeam].name)} !` : "🤝 Égalité !")
      : lr.winner ? `🏆 ${esc(pseudoOf(lr.winner))} reste debout !` : "☃️ Personne ne reste debout !";
    const rows = lr.order.map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.elims[id] ? `❄️ ${lr.elims[id]} élimination${lr.elims[id] > 1 ? "s" : ""}` : ""}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="sn-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="sn-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="sn-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="sn-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="sn-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="sn-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="sn-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="sn-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="sn-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("sn-next") && ($("sn-next").onclick = () => api.action("next"));
    $("sn-again") && ($("sn-again").onclick = () => api.action("start").then((r) => { if (r.error) $("sn-over-error").textContent = r.error; }));
    $("sn-to-setup") && ($("sn-to-setup").onclick = () => api.action("setup"));
    $("sn-finish") && ($("sn-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Boules de neige ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("sn-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("sn-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup") return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }

  // Le sol enneigé (dessiné une fois).
  let snowBg = null;
  function snowGround() {
    if (snowBg) return snowBg;
    snowBg = document.createElement("canvas");
    snowBg.width = W; snowBg.height = HGT;
    const c = snowBg.getContext("2d");
    const gr = c.createLinearGradient(0, 0, W, HGT);
    gr.addColorStop(0, "#eef5fb"); gr.addColorStop(1, "#dce8f3");
    c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    for (let i = 0; i < 2600; i++) { c.fillStyle = i % 3 ? "rgba(180,205,230,0.35)" : "rgba(255,255,255,0.9)"; const s = 1 + Math.random() * 3; c.fillRect(Math.random() * W, Math.random() * HGT, s, s); }
    for (let i = 0; i < 40; i++) { c.strokeStyle = "rgba(160,190,220,0.25)"; c.lineWidth = 2; c.beginPath(); const x = Math.random() * W, y = Math.random() * HGT; c.arc(x, y, 20 + Math.random() * 40, Math.random() * 3, Math.random() * 3 + 1.5); c.stroke(); }
    return snowBg;
  }

  function draw(ts, dt) {
    const c = g2d;
    c.save();
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.drawImage(snowGround(), 0, 0);
    // Murets de neige (ils rétrécissent en fondant).
    for (const w of st.walls || []) {
      const r = wallRect(w);
      c.fillStyle = "rgba(90,120,160,0.25)"; c.fillRect(r.x + 5, r.y + 7, r.w, r.h);
      c.fillStyle = "#ffffff"; c.fillRect(r.x, r.y, r.w, r.h);
      c.fillStyle = "#d5e4f2"; c.fillRect(r.x, r.y + r.h - 6, r.w, 6);
      c.strokeStyle = "#b8cde0"; c.lineWidth = 2; c.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      // Les briques de neige.
      c.strokeStyle = "rgba(170,195,220,0.6)"; c.lineWidth = 1;
      const horiz = r.w > r.h;
      for (let k = 1; k < 4; k++) { c.beginPath(); if (horiz) { c.moveTo(r.x + (r.w * k) / 4, r.y); c.lineTo(r.x + (r.w * k) / 4, r.y + r.h); } else { c.moveTo(r.x, r.y + (r.h * k) / 4); c.lineTo(r.x + r.w, r.y + (r.h * k) / 4); } c.stroke(); }
    }
    // Bonshommes.
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y }; }
      return { ...shownHero(h), alive: h.alive, hearts: h.hearts, balls: h.balls, make: h.make, charge: h.charge, hurt: h.hurt };
    });
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      if (!v.alive) continue;
      const col = colorOf(v.id);
      const blink = v.hurt && Math.floor(ts / 80) % 2;
      const crouch = v.make > 0;
      window.HeroArt.paint(c, v, col, { id: v.id, isMe: v.id === me(), alpha: blink ? 0.35 : 1, scale: crouch ? 0.85 : 1,
        item: (v.charge > 0 || (v.id === me() && mouse.left && pred)) ? (cc) => { cc.fillStyle = "#fff"; cc.beginPath(); cc.arc(-6, 17, 6, 0, Math.PI * 2); cc.fill(); cc.strokeStyle = "#9db6cf"; cc.lineWidth = 1; cc.stroke(); } : null });
      // Fabrication : un anneau qui se remplit.
      if (crouch) {
        c.strokeStyle = "rgba(60,110,170,0.35)"; c.lineWidth = 5; c.beginPath(); c.arc(v.x, v.y, 26, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = "#3a8bff"; c.beginPath(); c.arc(v.x, v.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.min(1, v.make / MAKE_S) * Math.PI * 2); c.stroke();
      }
      // Cœurs + nom.
      c.font = "12px sans-serif"; c.fillText("❤️".repeat(v.hearts), v.x, v.y - 42);
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,0.85)"; c.strokeText(pseudoOf(v.id), v.x, v.y - 28);
      c.fillStyle = "#16243a"; c.fillText(pseudoOf(v.id), v.x, v.y - 28);
      // Ses boules (petits points sous lui).
      for (let k = 0; k < v.balls; k++) { c.fillStyle = "#fff"; c.strokeStyle = "#7f9bb8"; c.lineWidth = 1; c.beginPath(); c.arc(v.x - 9 + k * 9, v.y + 27, 3.5, 0, Math.PI * 2); c.fill(); c.stroke(); }
    }
    // Boules en vol (avancées « au présent »).
    const ahead = Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
    for (const b of st.balls || []) {
      const x = b.x + b.vx * ahead, y = b.y + b.vy * ahead;
      c.fillStyle = "rgba(60,90,130,0.25)"; c.beginPath(); c.ellipse(x + 4, y + 8, BALL_R, BALL_R * 0.6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(x, y, BALL_R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = b.team ? st.teams[b.team].color : "#7f9bb8"; c.lineWidth = 2; c.stroke();
    }
    drawParticles(dt);
    // Mon viseur : la portée selon la charge en cours.
    const mv = views.find((v) => v.id === me() && v.alive);
    if (mv && st.phase === "play") {
      const charge = mouse.left ? Math.min(1, (performance.now() - chargeStart) / 1000) : 0;
      const a = Math.atan2(mouse.oy, mouse.ox), d = Math.hypot(mouse.ox, mouse.oy);
      const tx = mv.x + Math.cos(a) * d, ty = mv.y + Math.sin(a) * d;
      // Ligne pointillée jusqu'à la portée.
      const reach = rangeOf(charge);
      c.setLineDash([6, 8]); c.strokeStyle = mouse.left ? "rgba(58,139,255,0.8)" : "rgba(22,36,58,0.35)"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(mv.x + Math.cos(a) * 24, mv.y + Math.sin(a) * 24); c.lineTo(mv.x + Math.cos(a) * reach, mv.y + Math.sin(a) * reach); c.stroke(); c.setLineDash([]);
      c.strokeStyle = "rgba(22,36,58,0.85)"; c.lineWidth = 2;
      c.beginPath(); c.arc(tx, ty, 12, 0, Math.PI * 2); c.moveTo(tx - 18, ty); c.lineTo(tx - 6, ty); c.moveTo(tx + 6, ty); c.lineTo(tx + 18, ty);
      c.moveTo(tx, ty - 18); c.lineTo(tx, ty - 6); c.moveTo(tx, ty + 6); c.lineTo(tx, ty + 18); c.stroke();
      // Jauge de charge autour de moi.
      if (mouse.left) {
        c.strokeStyle = "rgba(58,139,255,0.25)"; c.lineWidth = 6; c.beginPath(); c.arc(mv.x, mv.y, 30, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = charge >= 1 ? "#ff4d5a" : "#3a8bff"; c.beginPath(); c.arc(mv.x, mv.y, 30, -Math.PI / 2, -Math.PI / 2 + charge * Math.PI * 2); c.stroke();
      }
      if (document.pointerLockElement !== canvas) {
        c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(22,36,58,0.8)";
        c.fillText("🖱️ Clique sur l'arène : ton viseur te suivra", W / 2, HGT - 18);
      }
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, colorOf(me()),
      window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(10,25,45,0.55)"; c.fillRect(0, HGT / 2 - 75, W, 150);
      c.font = "bold 64px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(left > 0 ? String(left) : "GO !", W / 2, HGT / 2 - 14);
      c.font = "22px Segoe UI, sans-serif"; c.fillText("Maintiens le clic pour charger · clic droit / R pour fabriquer des boules", W / 2, HGT / 2 + 42);
    }
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    const c = g2d;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.88; p.vy *= 0.88;
      c.globalAlpha = p.life / p.max; c.fillStyle = "#fff"; c.strokeStyle = "#a8c0d8"; c.lineWidth = 1;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    c.globalAlpha = 1;
  }
})();
