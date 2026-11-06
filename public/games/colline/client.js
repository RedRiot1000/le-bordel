// ===================================================================
//  ROI DE LA COLLINE — Client (s'affiche dans le hub Le Bordel)
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Viseur RELATIF à mon bonhomme ; la souris est capturée au 1er clic.
//  - Clic = coup de batte dans la direction du viseur.
// ===================================================================

(() => {
  const H = window.Pieton;
  const K = H.K;
  const W = 1280, HGT = 800, WARN_MS = 3000, BAT_REACH = 64;   // (les mêmes que games/colline/server.js)
  const AIM_MAX = 320;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, moveLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, ground = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 150, oy: 0, left: false };
  let particles = [];
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0, zoneKey = "", zonePop = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const colorOf = (id) => (st?.teamsMode ? st.teams[st.teamOf[id]]?.color : playerOf(id)?.color) || "#fff";
  const sideOf = (id) => (st?.teamsMode ? "t" + st.teamOf[id] : id);
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const TEMPLATE = `
    <div id="kc-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">👑</span>
        <h1>ROI DE LA COLLINE</h1>
        <p class="tagline">Une zone dorée, une batte chacun. Reste dedans… et vire les autres.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="kc-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>👑 Chaque seconde passée dans la <b>zone dorée</b> rapporte <b>1 point</b>… seulement si tu y es seul (ou seule ton équipe). Sinon elle est <b>contestée</b> : personne ne marque.</li>
            <li>🔁 La zone <b>saute ailleurs toutes les 20 s</b> (on voit où elle va 3 s avant).</li>
            <li>🏏 <b>Clic</b> : coup de batte dans la direction du viseur, ça propulse fort. Le viseur te suit (clique sur l'arène pour capturer la souris).</li>
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches : bouger.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="kc-start" class="btn btn-primary btn-big">À la colline !</button>
        <p id="kc-hint" class="muted"></p>
        <p id="kc-error" class="error-msg"></p>
        <button id="kc-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="kc-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="kc-round"></span>
        <span id="kc-me" class="ch-role"></span>
        <span id="kc-clock" class="cf-clock"></span>
      </div>
      <div class="ch-sub"><div id="kc-board" class="ch-mice"></div></div>
      <div class="pt-arena-wrap">
        <canvas id="kc-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="kc-feed" class="so-feed"></ul>
        <div id="kc-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · souris = viser · clic = coup de batte · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.colline = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; ground = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("kc-canvas");
      g2d = canvas.getContext("2d");
      $("kc-start").onclick = () => {
        $("kc-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("kc-error").textContent = r.error; });
      };
      $("kc-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => { pressed.clear(); mouse.left = false; });
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
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); ground = null; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      moveLocal = Date.now() + (st.moveIn || 0);
      if (st.zone) { const k = st.zone.x + ":" + st.zone.y; if (k !== zoneKey) { zoneKey = k; zonePop = 1; } }
      if (!["play", "countdown"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") {
        $("kc-play").classList.add("hidden");
        $("kc-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("kc-setup").classList.add("hidden");
      $("kc-play").classList.remove("hidden");
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
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT };
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
    if (e.button !== 0) return;
    if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
    mouse.left = true;
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.left) k |= K.FIRE;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const env = () => ({ walls: true, w: W, h: HGT, rects: st?.rects || [], noDash: true });
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving()) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = H.copy(sc);
    const E = env();
    pending.forEach((p, i) => { H.simulate(pred, p.k & 15, p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
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
    const E = env();
    while (acc >= H.TICK) {
      const k = keyMask();
      const a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, k & 15, a, E, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me()).map((h) => H.extrapolate(h, t));
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
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "hit" ? 22 : f.kind === "zone" ? 40 : 6;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (f.kind === "hit" ? 260 : 140);
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, max: 0.6, r: 1.5 + Math.random() * 3,
          col: f.kind === "zone" ? (i % 2 ? "#ffd23f" : "#fff3b0") : f.kind === "hit" ? (i % 2 ? "#fff" : "#ffcf5c") : "#d8d0c0" });
      }
      if (f.kind === "hit") shake = 6;
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("kc-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Mode</label>${chips("mode", [["aleatoire", "🔁 Alterné"], ["equipes", "🔴🔵 Équipes"], ["solo", "👤 Chacun pour soi"]])}</div>
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"], [8, "8"]])}</div>
      <div class="setting-block"><label>Durée d'une manche</label>${chips("duration", [[60, "1 min"], [90, "1 min 30"], [120, "2 min"]])}</div>
      <p class="settings-note">Aléatoire : chaque manche est tirée au sort entre équipes et chacun pour soi (équipes seulement à 4, 6 ou 8 joueurs, pour qu'elles soient égales).</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      const v = b.dataset.v;
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: isNaN(Number(v)) ? v : Number(v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("kc-start").style.display = host ? "" : "none";
    $("kc-start").disabled = n < 2;
    $("kc-finish-setup").classList.toggle("hidden", !host);
    $("kc-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} joueurs`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("kc-round").textContent = `Manche ${st.round}/${st.settings.rounds} · ${st.teamsMode ? "👥 Équipes" : "👤 Chacun pour soi"}`;
    const mine = heroOf(me());
    const tm = st.teamsMode && mine ? st.teams[st.teamOf[me()]] : null;
    const txt = !mine ? "👀 Tu regardes" : `👑 ${mine.held} s dans la zone${tm ? ` · ${tm.emoji} ${esc(tm.name)}` : ""}`;
    if ($("kc-me").innerHTML !== txt) $("kc-me").innerHTML = txt;
    // Tableau : en équipes, les secondes de chaque équipe ; sinon celles de chacun.
    let html;
    if (st.teamsMode) html = [1, 2].map((t) => `<span class="ch-tag" style="border-color:${st.teams[t].color}">${st.teams[t].emoji} ${esc(st.teams[t].name)} : <b>${st.held["t" + t] || 0} s</b></span>`).join("");
    else html = [...st.heroes].sort((a, b) => b.held - a.held).map((h) => `<span class="ch-tag ${h.id === me() ? "me" : ""}" style="border-color:${colorOf(h.id)}">${esc(pseudoOf(h.id))} : <b>${h.held} s</b></span>`).join("");
    if ($("kc-board").innerHTML !== html) $("kc-board").innerHTML = html;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("kc-feed").innerHTML !== feed) $("kc-feed").innerHTML = feed;
  }

  function renderOver() {
    const ov = $("kc-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.teamsMode ? (lr.winTeam ? `👑 Les ${st.teams[lr.winTeam].emoji} ${esc(st.teams[lr.winTeam].name)} tiennent la colline ! (${lr.teamHeld[1]} s contre ${lr.teamHeld[2]} s)` : "🤝 Égalité !")
      : lr.winner ? `👑 ${esc(pseudoOf(lr.winner))} est le roi de la colline !` : "👑 Personne n'a tenu la colline !";
    const rows = Object.keys(lr.gains).filter((id) => playerOf(id)).sort((a, b) => lr.gains[b] - lr.gains[a]).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.teamsMode ? st.teams[st.teamOf[id]]?.emoji || "" : ""} ${lr.secs?.[id] ?? 0} s dans la zone</span><span class="gain">+${lr.gains[id]}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="kc-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="kc-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="kc-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="kc-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="kc-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="kc-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="kc-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="kc-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="kc-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("kc-next") && ($("kc-next").onclick = () => api.action("next"));
    $("kc-again") && ($("kc-again").onclick = () => api.action("start").then((r) => { if (r.error) $("kc-over-error").textContent = r.error; }));
    $("kc-to-setup") && ($("kc-to-setup").onclick = () => api.action("setup"));
    $("kc-finish") && ($("kc-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Roi de la colline ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("kc-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("kc-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup") return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    const clock = $("kc-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
      clock.textContent = "⏱️ " + mmss(left);
      clock.classList.toggle("urgent", st.phase === "play" && left < 10000);
    }
    draw(ts, dt);
  }

  // Le sol : une colline herbeuse, des pierres (dessiné une fois par manche).
  function arenaGround() {
    if (ground) return ground;
    ground = document.createElement("canvas");
    ground.width = W; ground.height = HGT;
    const c = ground.getContext("2d");
    const gr = c.createRadialGradient(W / 2, HGT / 2, 50, W / 2, HGT / 2, W * 0.7);
    gr.addColorStop(0, "#7aa64a"); gr.addColorStop(1, "#4d7a33");
    c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    for (let i = 0; i < 2400; i++) { c.fillStyle = i % 3 ? "rgba(40,70,25,0.25)" : "rgba(170,210,110,0.25)"; c.fillRect(Math.random() * W, Math.random() * HGT, 2, 4); }
    for (let i = 0; i < 40; i++) { c.fillStyle = "rgba(120,110,90,0.5)"; circle(c, Math.random() * W, Math.random() * HGT, 3 + Math.random() * 5); }
    // Les bords de l'arène : une palissade en bois.
    c.fillStyle = "#6b4527"; c.fillRect(0, 0, W, 12); c.fillRect(0, HGT - 12, W, 12); c.fillRect(0, 0, 12, HGT); c.fillRect(W - 12, 0, 12, HGT);
    c.fillStyle = "#8a5e36"; for (let x = 0; x < W; x += 24) { c.fillRect(x + 2, 0, 18, 10); c.fillRect(x + 2, HGT - 10, 18, 10); }
    for (let y = 0; y < HGT; y += 24) { c.fillRect(0, y + 2, 10, 18); c.fillRect(W - 10, y + 2, 10, 18); }
    // Les obstacles : piliers de pierre et caisses en bois.
    for (const o of st.rects || []) {
      c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(o.x + 6, o.y + 8, o.w, o.h);
      if (o.kind === "pilier") {
        c.fillStyle = "#8f8a80"; c.fillRect(o.x, o.y, o.w, o.h);
        c.fillStyle = "#a9a49a"; c.fillRect(o.x + 4, o.y + 4, o.w - 8, o.h - 8);
        c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 2; c.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
      } else {
        c.fillStyle = "#9a6a3a"; c.fillRect(o.x, o.y, o.w, o.h);
        c.strokeStyle = "#5b3a1e"; c.lineWidth = 3; c.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
        c.beginPath(); c.moveTo(o.x, o.y); c.lineTo(o.x + o.w, o.y + o.h); c.moveTo(o.x + o.w, o.y); c.lineTo(o.x, o.y + o.h); c.stroke();
      }
    }
    return ground;
  }

  // La zone dorée : un cercle qui brille ; contestée = elle clignote en rouge ; tenue = à la couleur du camp.
  function drawZone(c, ts, dt) {
    const z = st.zone;
    if (!z) return;
    zonePop = Math.max(0, zonePop - dt * 2);
    const r = z.r * (1 + zonePop * 0.25);
    const blink = st.contested && Math.floor(ts / 160) % 2;
    const ownerCol = st.owner ? (st.teamsMode ? st.teams[Number(st.owner.slice(1))]?.color : playerOf(st.owner)?.color) : null;
    const gr = c.createRadialGradient(z.x, z.y, 10, z.x, z.y, r);
    gr.addColorStop(0, blink ? "rgba(255,60,60,0.45)" : "rgba(255,215,80,0.5)"); gr.addColorStop(1, blink ? "rgba(255,60,60,0.12)" : "rgba(255,200,60,0.15)");
    c.fillStyle = gr; circle(c, z.x, z.y, r);
    c.strokeStyle = blink ? "#ff3b3b" : ownerCol || "#ffd23f"; c.lineWidth = 6;
    c.beginPath(); c.arc(z.x, z.y, r, 0, Math.PI * 2); c.stroke();
    // Des étincelles qui tournent sur le bord.
    for (let k = 0; k < 10; k++) { const a = ts / 900 + (k / 10) * Math.PI * 2; c.fillStyle = "rgba(255,240,180,0.9)"; circle(c, z.x + Math.cos(a) * r, z.y + Math.sin(a) * r, 3); }
    c.font = "34px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha = 0.6; c.fillText("👑", z.x, z.y); c.globalAlpha = 1;
    // La prochaine zone (en pointillé) + le compte à rebours.
    if (st.nextZone && driving()) {
      const n = st.nextZone, left = Math.max(0, moveLocal - Date.now());
      c.setLineDash([14, 10]); c.strokeStyle = "rgba(255,240,180,0.8)"; c.lineWidth = 4;
      c.beginPath(); c.arc(n.x, n.y, n.r, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.fillStyle = "#fff3b0"; c.font = "bold 30px Segoe UI, sans-serif"; c.fillText(Math.ceil(left / 1000), n.x, n.y);
      // Flèche de l'ancienne zone vers la nouvelle.
      const a = Math.atan2(n.y - z.y, n.x - z.x), d = Math.hypot(n.x - z.x, n.y - z.y);
      c.strokeStyle = "rgba(255,240,180,0.6)"; c.lineWidth = 5;
      c.beginPath(); c.moveTo(z.x + Math.cos(a) * (z.r + 10), z.y + Math.sin(a) * (z.r + 10)); c.lineTo(z.x + Math.cos(a) * (d - n.r - 10), z.y + Math.sin(a) * (d - n.r - 10)); c.stroke();
    }
  }

  function draw(ts, dt) {
    const c = g2d;
    c.save();
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.drawImage(arenaGround(), 0, 0);
    drawZone(c, ts, dt);
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, aim: Math.atan2(mouse.oy, mouse.ox) }; }
      return { ...shownHero(h), swing: h.swing, held: h.held, aim: h.aim };
    });
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      const col = colorOf(v.id);
      // La batte : elle balaie un arc quand on frappe.
      const swingA = v.swing > 0 ? (1 - v.swing) * 2.2 - 1.1 : -0.9;
      window.HeroArt.paint(c, { ...v, face: v.aim }, col, {
        id: v.id, isMe: v.id === me(),
        item: (cc) => {
          cc.save(); cc.translate(6, 12); cc.rotate(swingA);
          cc.fillStyle = "#8a5e36"; cc.beginPath(); cc.moveTo(0, -2); cc.lineTo(40, -5); cc.lineTo(40, 5); cc.lineTo(0, 2); cc.closePath(); cc.fill();
          cc.fillStyle = "#5b3a1e"; cc.fillRect(-2, -2.5, 8, 5);
          cc.restore();
        },
      });
      if (v.swing > 0) {
        c.strokeStyle = `rgba(255,255,255,${0.6 * v.swing})`; c.lineWidth = 4;
        c.beginPath(); c.arc(v.x, v.y, BAT_REACH, v.aim - 1, v.aim + 1); c.stroke();
      }
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,0.85)"; c.strokeText(pseudoOf(v.id), v.x, v.y - 30);
      c.fillStyle = "#16243a"; c.fillText(pseudoOf(v.id), v.x, v.y - 30);
      // Une couronne au-dessus de ceux qui tiennent la zone.
      if (st.owner && sideOf(v.id) === st.owner && Math.hypot(v.x - st.zone.x, v.y - st.zone.y) < st.zone.r) { c.font = "16px sans-serif"; c.fillText("👑", v.x, v.y - 46); }
    }
    drawParticles(dt);
    const mv = views.find((v) => v.id === me());
    if (mv && st.phase === "play") {
      const a = Math.atan2(mouse.oy, mouse.ox), d = Math.hypot(mouse.ox, mouse.oy);
      const tx = mv.x + Math.cos(a) * d, ty = mv.y + Math.sin(a) * d;
      c.strokeStyle = "rgba(22,36,58,0.85)"; c.lineWidth = 2;
      c.beginPath(); c.arc(tx, ty, 12, 0, Math.PI * 2); c.moveTo(tx - 18, ty); c.lineTo(tx - 6, ty); c.moveTo(tx + 6, ty); c.lineTo(tx + 18, ty);
      c.moveTo(tx, ty - 18); c.lineTo(tx, ty - 6); c.moveTo(tx, ty + 6); c.lineTo(tx, ty + 18); c.stroke();
      if (document.pointerLockElement !== canvas) {
        c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(22,36,58,0.85)";
        c.fillText("🖱️ Clique sur l'arène : ton viseur te suivra", W / 2, HGT - 22);
      }
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, colorOf(me()),
      window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(30,15,5,0.55)"; c.fillRect(0, HGT / 2 - 75, W, 150);
      c.font = "bold 64px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(left > 0 ? String(left) : "GO !", W / 2, HGT / 2 - 14);
      c.font = "22px Segoe UI, sans-serif";
      c.fillText(st.teamsMode ? `👥 En équipes : tu es chez les ${st.teams[st.teamOf[me()]]?.emoji || ""} ${st.teams[st.teamOf[me()]]?.name || ""}` : "👤 Chacun pour soi : tiens la zone dorée !", W / 2, HGT / 2 + 42);
    }
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    const c = g2d;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.88; p.vy *= 0.88;
      c.globalAlpha = p.life / p.max; c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }
})();
