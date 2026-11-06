// ===================================================================
//  CAVALE — Client (s'affiche dans le hub Le Bordel)
//  - Le quartier est refait ici à partir de la seed (quartier.js).
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - La caméra me suit. Les flics visent avec un viseur relatif au bonhomme
//    (la souris est capturée au 1er clic, Échap la libère).
// ===================================================================

(() => {
  const H = window.Pieton, Q = window.Quartier;
  const K = H.K;
  const W = 1280, HGT = 800, AIM_MAX = 320, RANGE = 340, BUTTON_R = 50, CAMP_R = 330, CAMP_S = 5;
  const NAMES = { sprint: "⚡ Sprint", fumi: "💨 Fumigène", banane: "🍌 Peau de banane", barrage: "🚧 Barrage", rapide: "🔋 Taser rapide" };

  let api = null, root = null;
  let st = null, map = null, mapSeed = null, worldImg = null, miniImg = null;
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
  const cam = { x: Q.W / 2, y: Q.H / 2, init: false };
  let particles = [], zaps = [];
  const seenFx = new Set();
  let prevPhase = null, playSeenAt = 0, flash = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const colorOf = (id) => playerOf(id)?.color || "#fff";
  const driving = () => st?.phase === "play";
  const amCop = () => heroOf(me())?.role === "cop";

  const TEMPLATE = `
    <div id="cv-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🚨</span>
        <h1>CAVALE</h1>
        <p class="tagline">Flics contre runners. Mets-les en prison, ou libère tes potes !</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="cv-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🚓 <b>Flics</b> : tire au taser (clic gauche), puis touche le runner sonné pour l'envoyer en prison.</li>
            <li>🏃 <b>Runners</b> : ne te fais pas prendre. Reste 2 s sur un <b>bouton</b> à côté de la prison pour libérer tout le monde.</li>
            <li>🏆 Les flics gagnent si tous les runners sont en prison. Sinon, les runners gagnent au bout de 2 min.</li>
            <li>🎒 Passe sur une caisse pour prendre un gadget, <kbd>Espace</kbd> pour l'utiliser.</li>
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches : bouger. Les rôles changent à chaque manche.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="cv-start" class="btn btn-primary btn-big">🚨 C'est parti !</button>
        <p id="cv-hint" class="muted"></p>
        <p id="cv-error" class="error-msg"></p>
        <button id="cv-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="cv-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="cv-round"></span>
        <span id="cv-me" class="ch-role"></span>
        <span id="cv-jail" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="cv-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="cv-feed" class="so-feed"></ul>
        <div id="cv-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · clic gauche = taser (flics) · Espace / E / clic droit = gadget · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.cavale = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; zaps = []; mapSeed = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("cv-canvas");
      g2d = canvas.getContext("2d");
      $("cv-start").onclick = () => {
        $("cv-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("cv-error").textContent = r.error; });
      };
      $("cv-finish-setup").onclick = () => api.action("finish");
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
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); cam.init = false; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (!["play", "countdown"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") {
        $("cv-play").classList.add("hidden");
        $("cv-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("cv-setup").classList.add("hidden");
      $("cv-play").classList.remove("hidden");
      if (st.seed !== mapSeed) { mapSeed = st.seed; map = Q.build(st.seed); paintWorld(); }
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
      map = null; worldImg = null; miniImg = null;
    },
  };

  // ===================================================================
  //  CLAVIER + SOURIS
  // ===================================================================
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH, KeyE: K.DASH };
  function onBlur() { pressed.clear(); mouse.left = mouse.right = false; }
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    if (document.pointerLockElement === canvas) { mouse.ox += e.movementX * k; mouse.oy += e.movementY * k; }
    else {
      if (e.target !== canvas) return;
      const v = myView();
      if (!v) return;
      mouse.ox = (e.clientX - r.left) * k - (v.x - cam.x + W / 2); mouse.oy = (e.clientY - r.top) * (HGT / r.height) - (v.y - cam.y + HGT / 2);
    }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  function onDown(e) {
    if (e.button === 0) {
      // Le 1er clic d'un flic capture la souris (on ne tire pas avec ce clic-là).
      if (amCop() && document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
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
    if (mouse.right) k |= K.DASH;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const envFor = (h, spd) => ({ walls: true, w: Q.W, h: Q.H, noDash: true, speedMul: spd || 1, rects: [...Q.near(map, h.x, h.y), ...(st.bars || [])] });
  const moveBits = (k, lock) => (lock ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT));
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  function myView() {
    if (pred) { const o = ownView(); return { x: o.x + off.x, y: o.y + off.y }; }
    return heroOf(me());
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving() || !map) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = H.copy(sc);
    pred.stun = 0;
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k, sc.lock), p.a, envFor(pred, sc.spd), othersAt((i + 1) * H.TICK, sc)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } else { off.x = off.y = 0; prevPred = null; }
    }
  }
  function driveLocal(dt) {
    const sc = heroOf(me());
    if (!driving() || !map || !sc) { acc = 0; return; }
    if (!pred) { pred = H.copy(sc); pred.stun = 0; }
    acc = Math.min(acc + dt, 0.2);
    while (acc >= H.TICK) {
      const k = keyMask();
      const a = sc.role === "cop" ? Math.atan2(mouse.oy, mouse.ox) : null;
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k, sc.lock), a, envFor(pred, sc.spd), othersAt(pending.length * H.TICK, sc));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t, mine) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me() && h.jailed === mine.jailed).map((h) => H.extrapolate(h, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / H.TICK) * H.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownHero(h) {
    const base = driving() && !h.lock ? H.extrapolate(h, aheadNow()) : h;
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
      const base = driving() && !h.lock ? H.extrapolate(h, t) : h;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 100) othersOff[h.id] = { x: prev.x - base.x, y: prev.y - base.y };
      else othersOff[h.id] = { x: 0, y: 0 };
    }
  }

  // ===================================================================
  //  EFFETS
  // ===================================================================
  function burst(x, y, n, cols, speed = 200) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * speed;
      particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, col: cols[i % cols.length] });
    }
  }
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (f.kind === "zap") { zaps.push({ ...f, life: 0.18 }); if (f.hit) burst(f.x2, f.y2, 16, ["#ffe14d", "#7fd8ff", "#fff"]); }
      else if (f.kind === "cuff") burst(f.x, f.y, 24, ["#3a8bff", "#fff"]);
      else if (f.kind === "free") { flash = 1; burst(f.x, f.y, 50, ["#3dff7a", "#ffe14d", "#fff"], 420); }
      else if (f.kind === "use") burst(f.x, f.y, 10, ["#fff", "#ffd23f"], 120);
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("cv-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label><div class="cat-chips">${[3, 4, 6].map((v) =>
        `<button class="cat-chip ${s.rounds === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${v}</button>`).join("")}</div></div>
      <p class="settings-note">Une manche dure 2 min. Un nouveau quartier à chaque fois.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { rounds: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("cv-start").style.display = host ? "" : "none";
    $("cv-start").disabled = n < 3;
    $("cv-finish-setup").classList.toggle("hidden", !host);
    const cops = n <= 5 ? 1 : 2;
    $("cv-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 3 ? "Il faut au moins 3 joueurs (les bots comptent)." : `${cops} flic${cops > 1 ? "s" : ""} contre ${n - cops} runners`;
  }

  function renderHud() {
    $("cv-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = heroOf(me());
    const txt = !mine ? "👀 Tu regardes" : mine.role === "cop" ? (mine.camp >= CAMP_S ? "🚓 Flic · 🐌 Tu campes la prison : tu ralentis !" : "🚓 Tu es FLIC") : mine.jailed ? "🔒 En prison : attends qu'on te libère" : mine.stun > 0 ? "⚡ Sonné !" : "🏃 Tu es RUNNER";
    if ($("cv-me").textContent !== txt) $("cv-me").textContent = txt;
    const runners = st.heroes.filter((h) => h.role === "runner"), inJail = runners.filter((h) => h.jailed).length;
    $("cv-jail").textContent = `🔒 ${inJail}/${runners.length} en prison`;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("cv-feed").innerHTML !== feed) $("cv-feed").innerHTML = feed;
  }

  function renderOver() {
    const ov = $("cv-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.win === "cops" ? "🚓 Les flics gagnent !" : "🏃 Les runners gagnent !";
    const note = (id) => [lr.role[id] === "cop" ? "🚓" : "🏃", lr.arrests[id] ? `${lr.arrests[id]} arrestation${lr.arrests[id] > 1 ? "s" : ""}` : "", lr.frees[id] ? `${lr.frees[id]} évasion${lr.frees[id] > 1 ? "s" : ""}` : "", lr.jailed[id] ? "en prison" : ""].filter(Boolean).join(" · ");
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${note(id)}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="cv-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="cv-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="cv-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="cv-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="cv-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="cv-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="cv-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="cv-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="cv-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("cv-next") && ($("cv-next").onclick = () => api.action("next"));
    $("cv-again") && ($("cv-again").onclick = () => api.action("start").then((r) => { if (r.error) $("cv-over-error").textContent = r.error; }));
    $("cv-to-setup") && ($("cv-to-setup").onclick = () => api.action("setup"));
    $("cv-finish") && ($("cv-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Cavale ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  LE QUARTIER (dessiné une seule fois par manche)
  // ===================================================================
  const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 1597334677); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  function paintWorld() {
    const T = Q.T, C = Q.COLS, R = Q.ROWS;
    worldImg = document.createElement("canvas"); worldImg.width = Q.W; worldImg.height = Q.H;
    const c = worldImg.getContext("2d");
    // La route et ses pointillés.
    c.fillStyle = "#7b818a"; c.fillRect(0, 0, Q.W, Q.H);
    c.strokeStyle = "rgba(255,255,255,0.65)"; c.lineWidth = 4; c.setLineDash([26, 26]);
    const lines = (list, n, vert) => { let p = 2; for (const [, b] of [[0, 0], ...list]) { const at = (b ? b + 2 : 2) * T; c.beginPath(); if (vert) { c.moveTo(at, 0); c.lineTo(at, n); } else { c.moveTo(0, at); c.lineTo(n, at); } c.stroke(); p++; } };
    lines(map.xs, Q.H, true); lines(map.ys, Q.W, false);
    c.setLineDash([]);
    // Le sol.
    const COL = { 1: ["#d8d2c4", "#cfc8b9"], 2: ["#e3c497", "#dcbb8b"], 3: ["#8fd66f", "#86cd66"], 4: ["#efe6cf", "#e6dcc2"], 5: ["#c7d3e3", "#bccadc"] };
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const g = map.ground[r * C + q];
      if (!g) continue;
      c.fillStyle = COL[g][(r + q) % 2]; c.fillRect(q * T, r * T, T + 0.5, T + 0.5);
    }
    // Ce qui bloque.
    const solid = (q, r) => q >= 0 && r >= 0 && q < C && r < R && map.cells[r * C + q];
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const v = map.cells[r * C + q], x = q * T, y = r * T;
      if (!v) continue;
      if (v === 1) { c.fillStyle = hash(r, q) < 0.5 ? "#a8583f" : "#b4624a"; c.fillRect(x, y, T + 0.5, T + 0.5); c.fillStyle = "rgba(60,20,10,0.28)"; c.fillRect(x, y + 15, T, 2); c.fillRect(x + (r % 2 ? 15 : 3), y, 2, 15); c.fillRect(x + (r % 2 ? 3 : 15), y + 16, 2, 16); }
      else if (v === 6) { c.fillStyle = (Math.floor(q / 3) + Math.floor(r / 3)) % 2 ? "#5d7f96" : "#648aa2"; c.fillRect(x, y, T + 0.5, T + 0.5); }
      else if (v === 2) { c.fillStyle = "#8fd66f"; c.fillRect(x, y, T + 0.5, T + 0.5); c.fillStyle = "#c79a55"; for (let k = 2; k < T; k += 8) c.fillRect(x + k, y + 4, 4, T - 8); c.fillRect(x, y + 8, T, 3); c.fillRect(x, y + T - 11, T, 3); }
      else if (v === 3) { if (!solid(q - 1, r) && !solid(q, r - 1)) { c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(x + 36, y + 38, 32, 0, 7); c.fill(); c.fillStyle = "#3f9a4a"; c.beginPath(); c.arc(x + 32, y + 32, 32, 0, 7); c.fill(); c.fillStyle = "#58b85c"; c.beginPath(); c.arc(x + 25, y + 24, 19, 0, 7); c.fill(); } }
      else if (v === 4) { c.fillStyle = "#c98f4d"; c.fillRect(x, y, T + 0.5, T + 0.5); c.strokeStyle = "#7b5226"; c.lineWidth = 3; c.strokeRect(x + 2, y + 2, T - 4, T - 4); c.beginPath(); c.moveTo(x + 3, y + 3); c.lineTo(x + T - 3, y + T - 3); c.stroke(); }
      else if (v === 5) { c.fillStyle = "#3f6cc4"; c.fillRect(x, y, T + 0.5, T + 0.5); c.fillStyle = "#dfe8f8"; for (let k = 4; k < T; k += 10) c.fillRect(x + k, y + 4, 3, T - 8); }
    }
    // Le bord des murs : on voit tout de suite leur forme.
    c.fillStyle = "rgba(255,255,255,0.55)";
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const v = map.cells[r * C + q];
      if (!v || v === 3 || v === 2) continue;
      if (!solid(q, r - 1)) c.fillRect(q * T, r * T, T, 4);
    }
    c.fillStyle = "rgba(0,0,0,0.26)";
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const v = map.cells[r * C + q];
      if (!v || v === 3 || v === 2) continue;
      if (!solid(q, r + 1)) c.fillRect(q * T, (r + 1) * T, T, 7);
    }
    // Le mot PRISON au sol.
    const P = map.prison;
    c.font = "900 44px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "rgba(40,70,130,0.3)"; c.fillText("PRISON", P.cx, P.cy);
    // La mini-carte.
    miniImg = document.createElement("canvas"); miniImg.width = 232; miniImg.height = Math.round(232 * Q.H / Q.W);
    const m = miniImg.getContext("2d");
    m.drawImage(worldImg, 0, 0, miniImg.width, miniImg.height);
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["cv-fin-sec", finishEndLocal], ["cv-next-sec", phaseEndLocal]]) {
      const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
    if (!st || st.phase === "setup" || !map) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }

  function draw(ts, dt) {
    const c = g2d;
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, stun: h.stun }; }
      return { ...shownHero(h), stun: h.stun };
    });
    const mine = views.find((v) => v.id === me());
    const focus = mine || views.find((v) => v.role === "runner" && !v.jailed) || views[0];
    if (focus) {
      const k = !cam.init || Math.hypot(focus.x - cam.x, focus.y - cam.y) > 500 ? 1 : Math.min(1, dt * 10);
      cam.x += (focus.x - cam.x) * k; cam.y += (focus.y - cam.y) * k; cam.init = true;
    }
    cam.x = Math.max(W / 2, Math.min(Q.W - W / 2, cam.x)); cam.y = Math.max(HGT / 2, Math.min(Q.H - HGT / 2, cam.y));
    const ox = cam.x - W / 2, oy = cam.y - HGT / 2;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(worldImg, ox, oy, W, HGT, 0, 0, W, HGT);
    c.setTransform(1, 0, 0, 1, -ox, -oy);

    // La zone où un flic se fatigue.
    if (mine?.role === "cop") {
      c.strokeStyle = mine.camp > 0 ? "rgba(255,120,40,0.8)" : "rgba(63,108,196,0.35)"; c.lineWidth = 4; c.setLineDash([16, 14]);
      c.beginPath(); c.arc(map.prison.cx, map.prison.cy, CAMP_R, 0, 7); c.stroke(); c.setLineDash([]);
    }
    // Les boutons d'ouverture.
    c.textAlign = "center"; c.textBaseline = "middle";
    map.buttons.forEach((b, i) => {
      const ready = st.buttonsReady, p = (st.press || [])[i] || 0;
      c.fillStyle = "rgba(0,0,0,0.22)"; c.beginPath(); c.arc(b.x + 3, b.y + 5, BUTTON_R - 8, 0, 7); c.fill();
      c.fillStyle = ready ? "#ff4d5a" : "#9aa3af"; c.beginPath(); c.arc(b.x, b.y, BUTTON_R - 8, 0, 7); c.fill();
      c.strokeStyle = "#fff"; c.lineWidth = 5; c.stroke();
      if (p > 0) { c.strokeStyle = "#3dff7a"; c.lineWidth = 9; c.beginPath(); c.arc(b.x, b.y, BUTTON_R, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); c.stroke(); }
      c.font = "30px sans-serif"; c.fillStyle = "#fff"; c.fillText("🔓", b.x, b.y + 1);
    });
    // Les caisses à gadgets.
    for (const b of st.boxes || []) {
      const bob = Math.sin(ts / 300 + b.id) * 2;
      c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(b.x - 15, b.y - 10, 34, 30);
      c.fillStyle = "#ffd23f"; c.fillRect(b.x - 17, b.y - 17 + bob, 34, 32);
      c.strokeStyle = "#7a4d00"; c.lineWidth = 3; c.strokeRect(b.x - 17, b.y - 17 + bob, 34, 32);
      c.font = "bold 22px Segoe UI, sans-serif"; c.fillStyle = "#7a4d00"; c.fillText("?", b.x, b.y + bob);
    }
    for (const b of st.bananas || []) { c.font = "26px sans-serif"; c.fillText("🍌", b.x, b.y); }
    // Les barrages.
    for (const b of st.bars || []) {
      c.fillStyle = "#ffcf3a"; c.fillRect(b.x, b.y, b.w, b.h);
      c.fillStyle = "#1b1b1b"; if (b.w > b.h) for (let q = 0; q < b.w; q += 26) c.fillRect(b.x + q, b.y, 13, b.h); else for (let q = 0; q < b.h; q += 26) c.fillRect(b.x, b.y + q, b.w, 13);
      c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(b.x, b.y, b.w, b.h);
    }
    // Les bonshommes.
    for (const v of views) {
      const cop = v.role === "cop", col = colorOf(v.id);
      if (cop) { c.fillStyle = "rgba(47,111,255,0.35)"; c.beginPath(); c.arc(v.x, v.y, 27, 0, 7); c.fill(); c.strokeStyle = "#2f6fff"; c.lineWidth = 3; c.stroke(); }
      window.HeroArt.paint(c, v, col, { id: v.id, isMe: v.id === me(), alpha: v.safe && Math.floor(ts / 90) % 2 ? 0.4 : 1 });
      if (cop) { c.fillStyle = "#17357e"; c.beginPath(); c.arc(v.x, v.y, 9, 0, 7); c.fill(); c.font = "10px sans-serif"; c.fillStyle = "#ffd23f"; c.fillText("★", v.x, v.y + 1); }
      if (v.stun > 0 && !cop) { c.fillStyle = "#ffe14d"; c.font = "bold 16px sans-serif"; for (let q = 0; q < 3; q++) { const a = ts / 170 + q * 2.1; c.fillText("★", v.x + Math.cos(a) * 24, v.y - 4 + Math.sin(a) * 12); } }
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,0.9)"; c.strokeText(pseudoOf(v.id), v.x, v.y - 30);
      c.fillStyle = cop ? "#17357e" : "#16243a"; c.fillText(pseudoOf(v.id), v.x, v.y - 30);
      if (v.sprint) { c.fillStyle = "rgba(255,255,255,0.7)"; for (let q = 1; q < 4; q++) c.fillRect(v.x - v.vx * 0.03 * q - 3, v.y - v.vy * 0.03 * q - 3, 6, 6); }
    }
    // Les fumigènes (au-dessus des bonshommes : on ne voit plus rien dedans).
    for (const m of st.smokes || []) {
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + ts / 1400, r = i ? 70 : 0;
        c.fillStyle = "rgba(235,238,245,0.72)"; c.beginPath(); c.arc(m.x + Math.cos(a) * r, m.y + Math.sin(a) * r, 62, 0, 7); c.fill();
      }
    }
    // Les tirs de taser.
    zaps = zaps.filter((z) => (z.life -= dt) > 0);
    for (const z of zaps) {
      c.lineCap = "round"; c.strokeStyle = "#7fd8ff"; c.lineWidth = 7; c.beginPath(); c.moveTo(z.x, z.y);
      for (let i = 1; i <= 6; i++) c.lineTo(z.x + (z.x2 - z.x) * i / 6 + (i < 6 ? (Math.random() - 0.5) * 16 : 0), z.y + (z.y2 - z.y) * i / 6 + (i < 6 ? (Math.random() - 0.5) * 16 : 0));
      c.stroke(); c.strokeStyle = "#fff"; c.lineWidth = 2.5; c.stroke();
    }
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.col; c.fillRect(p.x - 3, p.y - 3, 6, 6); }
    c.globalAlpha = 1;
    // Mon viseur de flic.
    if (mine?.role === "cop" && st.phase === "play") {
      const a = Math.atan2(mouse.oy, mouse.ox), d = Math.hypot(mouse.ox, mouse.oy), reach = Q.ray(map, mine.x, mine.y, a, RANGE);
      const ready = mine.taser <= 0, tx = mine.x + Math.cos(a) * d, ty = mine.y + Math.sin(a) * d;
      c.setLineDash([6, 8]); c.strokeStyle = ready ? "rgba(30,140,255,0.9)" : "rgba(40,40,60,0.35)"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(mine.x + Math.cos(a) * 26, mine.y + Math.sin(a) * 26); c.lineTo(mine.x + Math.cos(a) * reach, mine.y + Math.sin(a) * reach); c.stroke(); c.setLineDash([]);
      c.strokeStyle = "rgba(16,24,48,0.9)"; c.lineWidth = 2.5;
      c.beginPath(); c.arc(tx, ty, 12, 0, 7); c.moveTo(tx - 18, ty); c.lineTo(tx - 6, ty); c.moveTo(tx + 6, ty); c.lineTo(tx + 18, ty); c.moveTo(tx, ty - 18); c.lineTo(tx, ty - 6); c.moveTo(tx, ty + 6); c.lineTo(tx, ty + 18); c.stroke();
    }
    if (mine) window.VehicleArt.markMe(c, mine.x, mine.y, ts, colorOf(me()), window.VehicleArt.markAlpha(st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.setTransform(1, 0, 0, 1, 0, 0);
    if (flash > 0) { flash = Math.max(0, flash - dt * 1.6); c.fillStyle = `rgba(61,255,122,${(flash * 0.3).toFixed(3)})`; c.fillRect(0, 0, W, HGT); }
    drawHud(c, mine, ts);
  }

  function panel(c, x, y, w, h) { c.fillStyle = "rgba(12,16,28,0.78)"; c.beginPath(); c.roundRect(x, y, w, h, 12); c.fill(); }

  function drawHud(c, mine, ts) {
    c.textAlign = "center"; c.textBaseline = "middle";
    // Le chrono, en haut au milieu.
    const left = Math.ceil((st.timeLeft || 0) / 1000);
    panel(c, W / 2 - 80, 12, 160, 54);
    c.font = "900 36px Segoe UI, sans-serif"; c.fillStyle = left <= 15 ? "#ff6b6b" : "#fff";
    c.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, W / 2, 40);
    // Les flics attendent le départ.
    if (st.phase === "play" && st.copWait > 0) {
      panel(c, W / 2 - 240, 76, 480, 46);
      c.font = "bold 24px Segoe UI, sans-serif"; c.fillStyle = "#ffd23f";
      c.fillText(`${mine?.role === "cop" ? "🚓 Tu pars" : "🏃 Cours ! Les flics partent"} dans ${Math.ceil(st.copWait / 1000)} s`, W / 2, 100);
    }
    // La mini-carte : la prison, les boutons, moi et mes coéquipiers. Les barres sont dessous, hors de la vue.
    const mw = miniImg.width, mh = miniImg.height, mx = W - mw - 14, bars = mine && mine.role === "cop" ? 68 : 36, my = HGT - mh - bars - 14;
    panel(c, mx - 6, my - 6, mw + 12, mh + bars + 12);
    c.drawImage(miniImg, mx, my);
    const P = (p) => [mx + p.x * mw / Q.W, my + p.y * mh / Q.H];
    for (const b of map.buttons) { const [x, y] = P(b); c.fillStyle = st.buttonsReady ? "#ff4d5a" : "#9aa3af"; c.beginPath(); c.arc(x, y, 5, 0, 7); c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 1.5; c.stroke(); }
    for (const h of st.heroes) {
      if (mine && h.role !== mine.role && h.id !== me()) continue;
      const [x, y] = P(h.id === me() && mine ? mine : h);
      c.fillStyle = colorOf(h.id); c.strokeStyle = h.id === me() ? "#fff" : "#000"; c.lineWidth = h.id === me() ? 2.5 : 1;
      c.beginPath(); c.arc(x, y, h.id === me() ? 6 : 4.5, 0, 7); c.fill(); c.stroke();
    }
    if (mine) {
      let by = my + mh + 8;
      if (mine.role === "cop") {
        window.VehicleArt.bar(c, mx, by, mw, 28, 1 - mine.taser / mine.taserCd, "⚡ TASER", "cd", false, mine.taser > 0 ? (mine.taser / 1000).toFixed(1) + " s" : "PRÊT !");
        by += 32;
      }
      window.VehicleArt.bar(c, mx, by, mw, 28, mine.gadget ? 1 : 0, mine.gadget ? NAMES[mine.gadget] : "🎒 Aucun gadget", "nitro", false, mine.gadget ? "Espace" : "");
    }
    // Compte à rebours : le rôle, en gros.
    if (st.phase === "countdown") {
      const n = Math.max(1, Math.ceil((phaseEndLocal - Date.now()) / 1000));
      c.fillStyle = "rgba(10,20,40,0.72)"; c.fillRect(0, HGT / 2 - 110, W, 220);
      c.font = "900 70px Segoe UI, sans-serif"; c.fillStyle = mine?.role === "cop" ? "#7fb0ff" : "#ffd23f";
      c.fillText(!mine ? "Tu regardes" : mine.role === "cop" ? "🚓 TU ES FLIC" : "🏃 TU ES RUNNER", W / 2, HGT / 2 - 48);
      c.font = "26px Segoe UI, sans-serif"; c.fillStyle = "#fff";
      c.fillText(mine?.role === "cop" ? "Tire au taser, puis touche le runner sonné" : "Ne te fais pas prendre, libère les autres avec les boutons rouges", W / 2, HGT / 2 + 14);
      c.font = "900 44px Segoe UI, sans-serif"; c.fillText(String(n), W / 2, HGT / 2 + 66);
    }
    if (mine?.role === "cop" && st.phase === "play" && document.pointerLockElement !== canvas) {
      c.font = "bold 16px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,255,255,0.95)"; c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 4;
      c.strokeText("🖱️ Clique pour capturer la souris : ton viseur te suivra", W / 2 - 100, HGT - 22); c.fillText("🖱️ Clique pour capturer la souris : ton viseur te suivra", W / 2 - 100, HGT - 22);
    }
    void ts;
  }
})();
