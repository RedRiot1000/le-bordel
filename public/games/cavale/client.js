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
  const AIM = 64, SMOKE_R = 120;                       // (les mêmes que games/cavale/server.js)
  const W = 1280, HGT = 800, AIM_MAX = 320, RANGE = 340, CAMP_R = 340, CAMP_S = 8;
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
            <li>🔒 Au début, un flic <b>pose la prison</b> où il veut (clic ou <kbd>Espace</kbd>).</li>
            <li>🚓 <b>Flics</b> : tire au taser (clic gauche), puis touche le runner sonné pour l'envoyer en prison.</li>
            <li>🏃 <b>Runners</b> : ne te fais pas prendre. Touche un prisonnier pour le libérer.</li>
            <li>🔵 La prison est un <b>cercle</b> : les prisonniers ne peuvent pas en sortir, tous les autres y entrent librement.</li>
            <li>🏆 Les flics gagnent si tous les runners sont en prison. Sinon, les runners gagnent au bout de 2 min.</li>
            <li>🎒 Passe sur une caisse (elles sont rares) pour prendre un gadget, <kbd>Espace</kbd> pour l'utiliser.</li>
            <li>💨 Fumigène : <b>clic droit</b> pour viser, <b>clic gauche</b> pour lancer. Clic gauche direct : il tombe à tes pieds.</li>
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
      <p class="muted pt-keys">ZQSD = bouger · clic gauche = taser (flics) · Espace / E = gadget · fumigène : clic droit = viser, clic gauche = lancer · Échap = libérer la souris</p>
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
      // Le gardien vient de poser la prison : on l'ajoute au quartier.
      if (st.prison && !map.prison) Q.prisonAt(map, st.prison.c, st.prison.r);
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
  const hasSmoke = () => heroOf(me())?.gadget === "fumi";
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.left) k |= K.FIRE;
    if (mouse.right) k |= hasSmoke() ? AIM : K.DASH;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const envFor = (h, sc) => ({ walls: true, w: Q.W, h: Q.H, noDash: true, speedMul: sc.spd || 1, rects: [...Q.near(map, h.x, h.y), ...(st.bars || [])], circle: sc.jailed && map.prison ? { x: map.prison.cx, y: map.prison.cy, r: Q.JAIL_R } : null });
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
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k, sc.lock), p.a, envFor(pred, sc), othersAt((i + 1) * H.TICK, sc)); history.set(p.s, H.copy(pred)); });
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
      const aiming = k & AIM;
      const a = sc.role === "cop" || aiming ? Math.atan2(mouse.oy, mouse.ox) : null;
      seq++;
      api.send("in", { s: seq, k, a, d: aiming ? Math.hypot(mouse.ox, mouse.oy) : undefined });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k, sc.lock), a, envFor(pred, sc), othersAt(pending.length * H.TICK, sc));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t, mine) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me()).map((h) => H.extrapolate(h, t));
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
      else if (f.kind === "place") { flash = 0.5; burst(f.x, f.y, 40, ["#7fb0ff", "#fff"], 380); }
      else if (f.kind === "free") burst(f.x, f.y, 34, ["#3dff7a", "#ffe14d", "#fff"], 300);
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
    const cops = n <= 4 ? 1 : n <= 6 ? 2 : 3;
    $("cv-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 3 ? "Il faut au moins 3 joueurs (les bots comptent)." : `${cops} flic${cops > 1 ? "s" : ""} contre ${n - cops} runners`;
  }

  function renderHud() {
    $("cv-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = heroOf(me());
    const txt = !mine ? "👀 Tu regardes" : !st.prison && st.warden === me() ? "🔒 Pose la prison : clic ou Espace" : mine.role === "cop" ? (mine.camp >= CAMP_S ? "🚓 Flic · 🐌 Tu campes la prison : tu ralentis !" : "🚓 Tu es FLIC") : mine.jailed ? "🔒 En prison : un copain doit te toucher" : mine.stun > 0 ? "⚡ Sonné !" : "🏃 Tu es RUNNER";
    if ($("cv-me").textContent !== txt) $("cv-me").textContent = txt;
    const runners = st.heroes.filter((h) => h.role === "runner"), inJail = runners.filter((h) => h.jailed).length;
    $("cv-jail").textContent = `🔒 ${inJail}/${runners.length} en prison`;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("cv-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }   // (comparé à notre propre texte : sinon il clignote)
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
    const note = (id) => [lr.role[id] === "cop" ? "🚓" : "🏃", lr.arrests[id] ? `${lr.arrests[id]} arrestation${lr.arrests[id] > 1 ? "s" : ""}` : "", lr.frees[id] ? `${lr.frees[id]} libération${lr.frees[id] > 1 ? "s" : ""}` : "", lr.jailed[id] ? "en prison" : ""].filter(Boolean).join(" · ");
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
  const ROOFS = [["#8d939c", "#a6acb5"], ["#a06f52", "#b98668"], ["#6d8ba3", "#88a4ba"], ["#bda67f", "#d0bb96"], ["#7f8c6e", "#98a585"], ["#9c6a6a", "#b48282"]];
  const BRICKS = [["#a8583f", "#b4624a"], ["#d9cbb0", "#e3d7be"], ["#8f9aa8", "#9ca7b5"], ["#c9a26d", "#d4af7c"]];
  function paintWorld() {
    const T = Q.T, C = Q.COLS, R = Q.ROWS, cells = map.cells, ground = map.ground;
    worldImg = document.createElement("canvas"); worldImg.width = Q.W; worldImg.height = Q.H;
    const c = worldImg.getContext("2d");
    const G = (q, r) => (q < 0 || r < 0 || q >= C || r >= R ? -1 : ground[r * C + q]);
    const S = (q, r) => (q < 0 || r < 0 || q >= C || r >= R ? 0 : cells[r * C + q]);
    // L'asphalte, un peu tacheté.
    c.fillStyle = "#62666e"; c.fillRect(0, 0, Q.W, Q.H);
    for (let i = 0; i < 9000; i++) { c.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)"; c.fillRect(hash(i, 1) * Q.W, hash(i, 2) * Q.H, 2 + hash(i, 3) * 5, 2 + hash(i, 4) * 3); }
    // Les rues : leur centre, les pointillés entre deux carrefours, les passages piétons.
    const sx = [0, ...map.xs.slice(0, -1).map(([, b]) => b), Q.COLS - 4], sy = [0, ...map.ys.slice(0, -1).map(([, b]) => b), Q.ROWS - 4];
    c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 3; c.setLineDash([24, 26]);
    for (const a of sx) for (let i = 0; i + 1 < sy.length; i++) { c.beginPath(); c.moveTo((a + 2) * T, (sy[i] + 6) * T); c.lineTo((a + 2) * T, (sy[i + 1] - 2) * T); c.stroke(); }
    for (const b of sy) for (let i = 0; i + 1 < sx.length; i++) { c.beginPath(); c.moveTo((sx[i] + 6) * T, (b + 2) * T); c.lineTo((sx[i + 1] - 2) * T, (b + 2) * T); c.stroke(); }
    c.setLineDash([]);
    c.fillStyle = "rgba(245,245,245,0.85)";
    for (const a of sx) for (const b of sy) {
      for (let k = 0; k < 8; k++) {
        const o = 6 + k * 15;
        c.fillRect(a * T + o, (b - 1.7) * T, 9, 1.3 * T); c.fillRect(a * T + o, (b + 4.4) * T, 9, 1.3 * T);
        c.fillRect((a - 1.7) * T, b * T + o, 1.3 * T, 9); c.fillRect((a + 4.4) * T, b * T + o, 1.3 * T, 9);
      }
    }
    // Le sol des pâtés.
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const g = ground[r * C + q], x = q * T, y = r * T, h = hash(r, q);
      if (!g) continue;
      if (g === Q.WALK) { c.fillStyle = (r + q) % 2 ? "#cfcabf" : "#d6d1c6"; c.fillRect(x, y, T + 0.5, T + 0.5); c.fillStyle = "rgba(0,0,0,0.07)"; c.fillRect(x, y, T, 1); c.fillRect(x, y, 1, T); }
      else if (g === Q.FLOOR) {
        // Le plancher des maisons : une couleur par pièce.
        const room = hash(q >> 3, r >> 3);
        c.fillStyle = room < 0.5 ? ((r % 2) ? "#d9b88a" : "#d2b182") : (r + q) % 2 ? "#e8e3d8" : "#ddd7ca"; c.fillRect(x, y, T + 0.5, T + 0.5);
        if (room < 0.5) { c.fillStyle = "rgba(90,55,20,0.18)"; c.fillRect(x, y + 15, T, 1); c.fillRect(x + (r % 2 ? 8 : 22), y, 1, T); }
      } else if (g === Q.GRASS) {
        c.fillStyle = (q >> 1) % 2 ? "#79c760" : "#71bf58"; c.fillRect(x, y, T + 0.5, T + 0.5);
        for (let k = 0; k < 3; k++) { c.fillStyle = "rgba(30,90,30,0.2)"; c.fillRect(x + hash(r * 3 + k, q) * 28, y + hash(r, q * 3 + k) * 28, 2, 4); }
        if (h < 0.03) { c.fillStyle = ["#fff", "#ffd23f", "#ff6b8a"][Math.floor(h * 100) % 3]; for (let k = 0; k < 5; k++) { c.beginPath(); c.arc(x + 6 + hash(k, q) * 20, y + 6 + hash(r, k) * 20, 2, 0, 7); c.fill(); } }
      }
    }
    // La bordure des trottoirs.
    c.fillStyle = "#a9a59c";
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      if (ground[r * C + q] !== Q.WALK) continue;
      const x = q * T, y = r * T;
      if (G(q, r - 1) === 0) c.fillRect(x, y, T, 3);
      if (G(q, r + 1) === 0) c.fillRect(x, y + T - 3, T, 3);
      if (G(q - 1, r) === 0) c.fillRect(x, y, 3, T);
      if (G(q + 1, r) === 0) c.fillRect(x + T - 3, y, 3, T);
    }
    // Les ombres portées des bâtiments (le soleil est en haut à gauche).
    c.fillStyle = "rgba(10,20,40,0.26)";
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) { const v = S(q, r); if (v === 1 || v === 6) c.fillRect(q * T + 12, r * T + 14, T, T); }
    // Les toits : chaque immeuble a sa couleur, son rebord, ses machines.
    const seen = new Uint8Array(C * R);
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      if (S(q, r) !== 6 || seen[r * C + q]) continue;
      const list = [], stack = [r * C + q];
      seen[r * C + q] = 1;
      while (stack.length) { const i = stack.pop(), a = i % C, b = (i - a) / C; list.push([a, b]); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (S(a + dx, b + dy) === 6 && !seen[(b + dy) * C + a + dx]) { seen[(b + dy) * C + a + dx] = 1; stack.push((b + dy) * C + a + dx); } }
      const [dark, light] = ROOFS[Math.floor(hash(q, r) * ROOFS.length)];
      for (const [a, b] of list) {
        const x = a * T, y = b * T;
        c.fillStyle = dark; c.fillRect(x, y, T + 0.5, T + 0.5);
        c.fillStyle = light;
        if (S(a, b - 1) !== 6) c.fillRect(x, y, T, 7);
        if (S(a, b + 1) !== 6) c.fillRect(x, y + T - 7, T, 7);
        if (S(a - 1, b) !== 6) c.fillRect(x, y, 7, T);
        if (S(a + 1, b) !== 6) c.fillRect(x + T - 7, y, 7, T);
      }
      // Des machines sur le toit, là où il y a de la place.
      for (const [a, b] of list) {
        if (hash(a * 3, b * 5) > 0.1 || S(a + 1, b) !== 6 || S(a, b + 1) !== 6 || S(a - 1, b) !== 6 || S(a, b - 1) !== 6 || S(a + 1, b + 1) !== 6) continue;
        const x = a * T + 6, y = b * T + 6, u = hash(a, b);
        if (u < 0.5) {
          c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + 4, y + 5, 42, 34);
          c.fillStyle = "#c7ccd3"; c.fillRect(x, y, 42, 34); c.strokeStyle = "#7d838c"; c.lineWidth = 2; c.strokeRect(x, y, 42, 34);
          c.beginPath(); c.arc(x + 21, y + 17, 11, 0, 7); c.stroke(); c.beginPath(); c.moveTo(x + 10, y + 17); c.lineTo(x + 32, y + 17); c.moveTo(x + 21, y + 6); c.lineTo(x + 21, y + 28); c.stroke();
        } else { c.fillStyle = "#284a66"; c.fillRect(x, y, 46, 30); c.fillStyle = "rgba(160,215,255,0.5)"; c.fillRect(x + 3, y + 3, 18, 24); c.fillRect(x + 25, y + 3, 18, 24); }
      }
    }
    // Les autres obstacles.
    for (let r = 0; r < R; r++) for (let q = 0; q < C; q++) {
      const v = S(q, r), x = q * T, y = r * T;
      if (v === 1) {
        const [a, b] = BRICKS[Math.floor(hash(q >> 4, r >> 4) * BRICKS.length)];
        c.fillStyle = hash(r, q) < 0.5 ? a : b; c.fillRect(x, y, T + 0.5, T + 0.5);
        c.fillStyle = "rgba(40,20,10,0.22)"; c.fillRect(x, y + 15, T, 2); c.fillRect(x + (r % 2 ? 15 : 3), y, 2, 15); c.fillRect(x + (r % 2 ? 3 : 15), y + 16, 2, 16);
        c.fillStyle = "rgba(255,255,255,0.5)"; if (S(q, r - 1) !== 1) c.fillRect(x, y, T, 4);
      } else if (v === 2) {
        // Une clôture de planches : elle suit son tracé, et se raccorde dans les angles.
        const L = S(q - 1, r) === 2, Rr = S(q + 1, r) === 2, U = S(q, r - 1) === 2, D = S(q, r + 1) === 2;
        const horiz = L || Rr || !(U || D), vert = U || D, m = 6, w = T - 2 * m;
        c.fillStyle = "rgba(10,30,10,0.22)";
        if (horiz) c.fillRect(L ? x : x + m, y + m + 4, T - (L ? 0 : m) - (Rr ? 0 : m), w);
        if (vert) c.fillRect(x + m + 3, U ? y : y + m, w, T - (U ? 0 : m) - (D ? 0 : m));
        c.fillStyle = "#c79a5b";
        if (horiz) c.fillRect(L ? x : x + m, y + m, T - (L ? 0 : m) - (Rr ? 0 : m), w);
        if (vert) c.fillRect(x + m, U ? y : y + m, w, T - (U ? 0 : m) - (D ? 0 : m));
        c.fillStyle = "#8f6636";
        if (horiz && !vert) for (let k = 0; k < T; k += 8) c.fillRect(x + k, y + m, 2, w);
        if (vert && !horiz) for (let k = 0; k < T; k += 8) c.fillRect(x + m, y + k, w, 2);
        c.fillStyle = "#6f4c26"; c.fillRect(x + T / 2 - 6, y + T / 2 - 6, 12, 12);
      } else if (v === 3) {
        if (S(q - 1, r) === 3 || S(q, r - 1) === 3) continue;
        c.fillStyle = "rgba(10,30,10,0.28)"; c.beginPath(); c.arc(x + 42, y + 44, 33, 0, 7); c.fill();
        for (const [dx, dy, rr, col] of [[32, 32, 32, "#2f8a3e"], [20, 24, 18, "#3fa24c"], [42, 26, 16, "#3fa24c"], [28, 42, 16, "#379646"], [26, 20, 10, "#62c26a"]]) { c.fillStyle = col; c.beginPath(); c.arc(x + dx, y + dy, rr, 0, 7); c.fill(); }
      } else if (v === 4) {
        // Une cabane de jardin.
        if (S(q - 1, r) === 4 || S(q, r - 1) === 4) continue;
        c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + 7, y + 8, 2 * T, 2 * T);
        c.fillStyle = "#b5764a"; c.fillRect(x, y, 2 * T, T); c.fillStyle = "#94603a"; c.fillRect(x, y + T, 2 * T, T);
        c.fillStyle = "rgba(0,0,0,0.2)"; for (let k = 0; k < 2 * T; k += 8) c.fillRect(x, y + k, 2 * T, 1);
      } else if (v === 8) {
        c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.arc(x + 19, y + 20, 12, 0, 7); c.fill();
        c.fillStyle = "#2f6b4a"; c.beginPath(); c.arc(x + 16, y + 16, 12, 0, 7); c.fill(); c.fillStyle = "#4a9a70"; c.beginPath(); c.arc(x + 16, y + 16, 7, 0, 7); c.fill();
      }
    }
    // Les lampadaires, sur les trottoirs.
    for (let r = 0; r < R; r += 1) for (let q = 0; q < C; q += 1) {
      if (ground[r * C + q] !== Q.WALK || S(q, r) || hash(q * 7, r * 11) > 0.03) continue;
      c.fillStyle = "rgba(0,0,0,0.2)"; c.beginPath(); c.arc(q * T + 18, r * T + 19, 7, 0, 7); c.fill();
      c.fillStyle = "#4a4f58"; c.beginPath(); c.arc(q * T + 16, r * T + 16, 7, 0, 7); c.fill();
      c.fillStyle = "#ffe9a0"; c.beginPath(); c.arc(q * T + 16, r * T + 16, 3.5, 0, 7); c.fill();
    }
    paintMini();
  }
  function paintMini() {
    miniImg = document.createElement("canvas"); miniImg.width = 232; miniImg.height = Math.round(232 * Q.H / Q.W);
    miniImg.getContext("2d").drawImage(worldImg, 0, 0, miniImg.width, miniImg.height);
  }
  // Une voiture garée, vue de dessus.
  function drawCar(c, o) {
    const T = Q.T, horiz = o.w > o.h, L = 2 * T - 4, B = T - 8;
    c.save();
    c.translate(o.c * T + (o.w * T) / 2, o.r * T + (o.h * T) / 2);
    if (!horiz) c.rotate(Math.PI / 2);
    if (o.flip) c.rotate(Math.PI);
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.roundRect(-L / 2 + 3, -B / 2 + 4, L, B, 7); c.fill();
    c.fillStyle = o.col; c.beginPath(); c.roundRect(-L / 2, -B / 2, L, B, 7); c.fill();
    c.fillStyle = "rgba(255,255,255,0.22)"; c.fillRect(-L / 2 + 6, -B / 2 + 2, L - 12, 3);
    c.fillStyle = "#1e2730"; c.beginPath(); c.roundRect(-8, -B / 2 + 3, 26, B - 6, 3); c.fill();
    c.fillStyle = "#3e5468"; c.fillRect(11, -B / 2 + 4, 6, B - 8); c.fillRect(-7, -B / 2 + 4, 4, B - 8);
    c.fillStyle = "#ffe9a0"; c.fillRect(L / 2 - 3, -B / 2 + 3, 3, 5); c.fillRect(L / 2 - 3, B / 2 - 8, 3, 5);
    c.fillStyle = "#e0413c"; c.fillRect(-L / 2, -B / 2 + 3, 3, 5); c.fillRect(-L / 2, B / 2 - 8, 3, 5);
    c.restore();
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

    for (const o of map.cars) { const x = o.c * Q.T, y = o.r * Q.T; if (x > ox - 80 && x < ox + W + 80 && y > oy - 80 && y < oy + HGT + 80) drawCar(c, o); }
    // La prison : un simple cercle, à bordure transparente.
    if (map.prison) {
      const P = map.prison;
      c.fillStyle = "rgba(63,108,196,0.13)"; c.beginPath(); c.arc(P.cx, P.cy, P.rad, 0, 7); c.fill();
      c.strokeStyle = "rgba(47,111,255,0.42)"; c.lineWidth = 10; c.stroke();
      c.font = "900 40px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "rgba(40,70,130,0.22)"; c.fillText("PRISON", P.cx, P.cy);
    }
    // Le gardien voit où tombera la prison.
    if (!st.prison && st.phase === "play" && st.warden === me() && mine) {
      const p = Q.prisonSpot(mine.x, mine.y), x = p.c * Q.T, y = p.r * Q.T;
      c.fillStyle = "rgba(47,111,255,0.18)"; c.beginPath(); c.arc(x, y, Q.JAIL_R, 0, 7); c.fill();
      c.strokeStyle = "#2f6fff"; c.lineWidth = 5; c.setLineDash([18, 12]); c.stroke(); c.setLineDash([]);
      c.font = "900 32px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#17357e"; c.fillText("PRISON", x, y - 60);
    }
    // La zone où un flic se fatigue.
    if (mine?.role === "cop" && map.prison) {
      c.strokeStyle = mine.camp > 0 ? "rgba(255,120,40,0.8)" : "rgba(63,108,196,0.35)"; c.lineWidth = 4; c.setLineDash([16, 14]);
      c.beginPath(); c.arc(map.prison.cx, map.prison.cy, CAMP_R, 0, 7); c.stroke(); c.setLineDash([]);
    }
    c.textAlign = "center"; c.textBaseline = "middle";
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
      if (v.jailed) { c.strokeStyle = "#ffd23f"; c.lineWidth = 3; c.setLineDash([5, 5]); c.beginPath(); c.arc(v.x, v.y, 25, 0, 7); c.stroke(); c.setLineDash([]); c.font = "15px sans-serif"; c.fillText("🔒", v.x + 22, v.y - 22); }
      if (v.stun > 0 && !cop) { c.fillStyle = "#ffe14d"; c.font = "bold 16px sans-serif"; for (let q = 0; q < 3; q++) { const a = ts / 170 + q * 2.1; c.fillText("★", v.x + Math.cos(a) * 24, v.y - 4 + Math.sin(a) * 12); } }
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(255,255,255,0.9)"; c.strokeText(pseudoOf(v.id), v.x, v.y - 30);
      c.fillStyle = cop ? "#17357e" : "#16243a"; c.fillText(pseudoOf(v.id), v.x, v.y - 30);
      if (v.sprint) { c.fillStyle = "rgba(255,255,255,0.7)"; for (let q = 1; q < 4; q++) c.fillRect(v.x - v.vx * 0.03 * q - 3, v.y - v.vy * 0.03 * q - 3, 6, 6); }
    }
    // Les fumigènes (au-dessus des bonshommes : on ne voit plus rien dedans).
    for (const m of st.smokes || []) {
      // En vol : la grenade décrit une petite courbe.
      if (m.fly > 0) {
        const f = 1 - m.fly / 350, x = m.fx + (m.x - m.fx) * f, y = m.fy + (m.y - m.fy) * f - Math.sin(f * Math.PI) * 50;
        c.fillStyle = "#3d4450"; c.beginPath(); c.arc(x, y, 8, 0, 7); c.fill(); c.strokeStyle = "#fff"; c.lineWidth = 2; c.stroke();
        continue;
      }
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
    // Je vise avec un fumigène : le point d'arrivée et la taille du nuage.
    if (mine?.gadget === "fumi" && mouse.right && st.phase === "play") {
      const a = Math.atan2(mouse.oy, mouse.ox), d = Q.ray(map, mine.x, mine.y, a, Math.min(AIM_MAX, Math.hypot(mouse.ox, mouse.oy)));
      const tx = mine.x + Math.cos(a) * d, ty = mine.y + Math.sin(a) * d;
      c.setLineDash([8, 8]); c.strokeStyle = "rgba(255,255,255,0.95)"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(mine.x, mine.y); c.quadraticCurveTo((mine.x + tx) / 2, (mine.y + ty) / 2 - 50, tx, ty); c.stroke(); c.setLineDash([]);
      c.fillStyle = "rgba(235,238,245,0.3)"; c.beginPath(); c.arc(tx, ty, SMOKE_R, 0, 7); c.fill();
      c.strokeStyle = "rgba(30,40,60,0.8)"; c.lineWidth = 3; c.stroke();
    }
    // Mon viseur de flic.
    if (mine?.role === "cop" && st.hunting) {
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
    if (st.phase === "play" && !st.prison) {
      panel(c, W / 2 - 310, 76, 620, 46);
      c.font = "bold 24px Segoe UI, sans-serif"; c.fillStyle = "#ffd23f";
      c.fillText(st.warden === me() ? `🔒 Choisis ta place, clic ou Espace pour poser la prison (${Math.ceil(st.placeLeft / 1000)} s)` : `🔒 ${esc(pseudoOf(st.warden))} choisit où poser la prison…`, W / 2, 100);
    } else if (st.phase === "play" && st.copWait > 0) {
      panel(c, W / 2 - 240, 76, 480, 46);
      c.font = "bold 24px Segoe UI, sans-serif"; c.fillStyle = "#ffd23f";
      c.fillText(`${mine?.role === "cop" ? "🚓 Tu pars" : "🏃 Cours ! Les flics partent"} dans ${Math.ceil(st.copWait / 1000)} s`, W / 2, 100);
    }
    // La mini-carte (runners seulement) : la prison, moi et mes coéquipiers. Les barres sont dessous, hors de la vue.
    const noMap = mine?.role === "cop";
    const mw = miniImg.width, mh = noMap ? 0 : miniImg.height, mx = W - mw - 14, bars = noMap ? 68 : 36, my = HGT - mh - bars - 14;
    panel(c, mx - 6, my - 6, mw + 12, mh + bars + 12);
    if (!noMap) {
      c.drawImage(miniImg, mx, my);
      const P = (p) => [mx + p.x * mw / Q.W, my + p.y * mh / Q.H];
      if (map.prison) { const [x, y] = P({ x: map.prison.cx, y: map.prison.cy }); c.fillStyle = "rgba(47,111,255,0.55)"; c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, Math.max(7, map.prison.rad * mw / Q.W), 0, 7); c.fill(); c.stroke(); }
      for (const h of st.heroes) {
        if (mine && h.role !== mine.role && h.id !== me()) continue;
        const [x, y] = P(h.id === me() && mine ? mine : h);
        c.fillStyle = colorOf(h.id); c.strokeStyle = h.id === me() ? "#fff" : "#000"; c.lineWidth = h.id === me() ? 2.5 : 1;
        c.beginPath(); c.arc(x, y, h.id === me() ? 6 : 4.5, 0, 7); c.fill(); c.stroke();
      }
    }
    if (mine) {
      let by = my + (noMap ? 0 : mh + 8);
      if (mine.role === "cop") {
        window.VehicleArt.bar(c, mx, by, mw, 28, 1 - mine.taser / mine.taserCd, "⚡ TASER", "cd", false, mine.taser > 0 ? (mine.taser / 1000).toFixed(1) + " s" : "PRÊT !");
        by += 32;
      }
      window.VehicleArt.bar(c, mx, by, mw, 28, mine.gadget ? 1 : 0, mine.gadget ? NAMES[mine.gadget] : "🎒 Aucun gadget", "nitro", false, mine.gadget === "fumi" ? "Clic droit" : mine.gadget ? "Espace" : "");
    }
    // Compte à rebours : le rôle, en gros.
    if (st.phase === "countdown") {
      const n = Math.max(1, Math.ceil((phaseEndLocal - Date.now()) / 1000));
      c.fillStyle = "rgba(10,20,40,0.72)"; c.fillRect(0, HGT / 2 - 110, W, 220);
      c.font = "900 70px Segoe UI, sans-serif"; c.fillStyle = mine?.role === "cop" ? "#7fb0ff" : "#ffd23f";
      c.fillText(!mine ? "Tu regardes" : mine.role === "cop" ? "🚓 TU ES FLIC" : "🏃 TU ES RUNNER", W / 2, HGT / 2 - 48);
      c.font = "26px Segoe UI, sans-serif"; c.fillStyle = "#fff";
      c.fillText(st.warden === me() ? "D'abord, pose la prison où tu veux" : mine?.role === "cop" ? "Tire au taser, puis touche le runner sonné" : "Ne te fais pas prendre, touche les prisonniers pour les libérer", W / 2, HGT / 2 + 14);
      c.font = "900 44px Segoe UI, sans-serif"; c.fillText(String(n), W / 2, HGT / 2 + 66);
    }
    if (mine?.role === "cop" && st.phase === "play" && document.pointerLockElement !== canvas) {
      c.font = "bold 16px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,255,255,0.95)"; c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 4;
      c.strokeText("🖱️ Clique pour capturer la souris : ton viseur te suivra", W / 2 - 100, HGT - 22); c.fillText("🖱️ Clique pour capturer la souris : ton viseur te suivra", W / 2 - 100, HGT - 22);
    }
    void ts;
  }
})();
