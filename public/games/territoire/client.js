// ===================================================================
//  TERRITOIRE — Client (s'affiche dans le hub Le Bordel)
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - La peinture : une petite image (1 pixel = 1 case) mise à jour avec
//    les cases qui changent, puis agrandie à l'écran (bords « peinture »).
//  - Visée à la souris, clic gauche = jet de peinture.
// ===================================================================

(() => {
  const H = window.Pieton;
  const K = H.K;
  const W = 1280, HGT = 800, CELL = 16, GW = 80, GH = 50;   // (les mêmes que games/territoire/server.js)
  const SHOT_TIME = 0.35, FAST_MUL = 1.4;

  let api = null, root = null;
  let st = null, stat = null;     // stat = ce qui ne change pas (obstacles, équipes) gardé en mémoire
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let paintCv = null, paintCtx = null, paintImg = null, grid = null, lastTick = -1;
  let smoothCv = null, smoothCtx = null;   // la peinture adoucie (redessinée seulement quand elle change)

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { x: W / 2, y: HGT / 2, down: false };
  let particles = [];
  const seenFx = new Set();
  let prevPhase = null, playSeenAt = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const ownerColor = (o) => stat?.owners?.[o]?.color || "#888";
  const myOwner = () => stat?.ownerOf?.[me()];
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const TEMPLATE = `
    <div id="te-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🎨</span>
        <h1>TERRITOIRE</h1>
        <p class="tagline">Repeins tout. La plus grande surface gagne.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="te-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches : tes pas <b>peignent</b> le sol de ta couleur.</li>
            <li>🖱️ <b>Clic gauche</b> : jet de peinture vers la souris (il passe par-dessus les obstacles).</li>
            <li>🎨 On peut <b>repeindre</b> par-dessus les autres couleurs.</li>
            <li>📦 Caisses : 💣 bombe de peinture · 🧹 gros rouleau (6 s) · 👟 chaussures rapides (5 s).</li>
            <li>🏆 À la fin du chrono, la <b>plus grande surface</b> gagne (en équipes : on additionne).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="te-start" class="btn btn-primary btn-big">À vos pinceaux !</button>
        <p id="te-hint" class="muted"></p>
        <p id="te-error" class="error-msg"></p>
        <button id="te-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="te-play" class="hidden">
      <div class="ch-hud">
        <span id="te-me" class="ch-role"></span>
        <span id="te-clock" class="cf-clock"></span>
      </div>
      <div id="te-bar" class="te-bar"></div>
      <div class="pt-arena-wrap">
        <canvas id="te-canvas" width="${W}" height="${HGT}"></canvas>
        <div id="te-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches = marcher (et peindre) · Clic gauche = jet de peinture</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.territoire = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = stat = null; pred = prevPred = null; pending = []; particles = []; grid = null; lastTick = -1;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-candy");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("te-canvas");
      g2d = canvas.getContext("2d");
      paintCv = document.createElement("canvas");
      paintCv.width = GW; paintCv.height = GH;
      paintCtx = paintCv.getContext("2d");
      paintImg = paintCtx.createImageData(GW, GH);
      smoothCv = document.createElement("canvas");
      smoothCv.width = W / 2; smoothCv.height = HGT / 2;
      smoothCtx = smoothCv.getContext("2d");
      $("te-start").onclick = () => {
        $("te-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("te-error").textContent = r.error; });
      };
      $("te-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => { pressed.clear(); mouse.down = false; });
      canvas.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", (e) => { if (e.button === 0) { mouse.down = true; onMouse(e); } });
      window.addEventListener("mouseup", onMouseUp);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.static) stat = st.static;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); grid = null; lastTick = -1; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      if (st.phase === "setup") {
        $("te-play").classList.add("hidden");
        $("te-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("te-setup").classList.add("hidden");
      $("te-play").classList.remove("hidden");
      applyPaint();
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
      window.removeEventListener("mouseup", onMouseUp);
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  // ===================================================================
  //  LA PEINTURE : grille complète (1 fois/s) ou juste les cases changées
  // ===================================================================
  const rgbCache = {};
  function rgb(hex) {
    if (rgbCache[hex]) return rgbCache[hex];
    const v = parseInt(String(hex).replace("#", ""), 16);
    return (rgbCache[hex] = [(v >> 16) & 255, (v >> 8) & 255, v & 255]);
  }
  function setCell(i, v) {
    grid[i] = v;
    const p = i * 4;
    if (v === 0 || v === 255) { paintImg.data[p + 3] = 0; return; }
    const [r, g, b] = rgb(ownerColor(v));
    paintImg.data[p] = r; paintImg.data[p + 1] = g; paintImg.data[p + 2] = b; paintImg.data[p + 3] = 235;
  }
  function applyPaint() {
    const pt = st.paint;
    if (!pt) return;
    if (pt.full) {
      grid = new Uint8Array(GW * GH);
      for (let i = 0; i < pt.full.length; i++) { const ch = pt.full[i]; setCell(i, ch === "#" ? 255 : Number(ch)); }
    } else if (grid) {
      for (let j = 0; j < pt.adds.length; j += 2) setCell(pt.adds[j], pt.adds[j + 1]);
    }
    lastTick = pt.tick;
    if (!grid) return;
    paintCtx.putImageData(paintImg, 0, 0);
    // Chaque case peinte = un petit rond un peu plus grand qu'elle : les ronds se chevauchent
    // et donnent des taches aux bords arrondis, comme de la vraie peinture (un seul tracé par couleur).
    const sc = smoothCtx, k = smoothCv.width / GW, rad = k * 0.78;
    sc.clearRect(0, 0, smoothCv.width, smoothCv.height);
    const paths = {};
    for (let i = 0; i < grid.length; i++) {
      const v = grid[i];
      if (!v || v === 255) continue;
      const p = (paths[v] ||= new Path2D());
      const x = ((i % GW) + 0.5) * k, y = (((i / GW) | 0) + 0.5) * k;
      p.moveTo(x + rad, y); p.arc(x, y, rad, 0, Math.PI * 2);
    }
    for (const [v, p] of Object.entries(paths)) { sc.fillStyle = ownerColor(Number(v)); sc.fill(p); }

  }

  // ===================================================================
  //  CLAVIER + SOURIS
  // ===================================================================
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function onMouse(e) {
    const r = canvas.getBoundingClientRect();
    mouse.x = ((e.clientX - r.left) / r.width) * W;
    mouse.y = ((e.clientY - r.top) / r.height) * HGT;
  }
  function onMouseUp(e) { if (e.button === 0) mouse.down = false; }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.down) k |= K.FIRE;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const envMine = () => ({ walls: true, w: W, h: HGT, rects: stat?.rects || [], speedMul: (heroOf(me())?.fast || 0) > 0 ? FAST_MUL : 1, noDash: true });
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
    const E = envMine();
    pending.forEach((p, i) => { H.simulate(pred, p.k, p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
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
    const E = envMine();
    while (acc >= H.TICK) {
      const k = keyMask() & ~K.DASH;
      const a = Math.atan2(mouse.y - pred.y, mouse.x - pred.x);
      seq++;
      api.send("in", { s: seq, k, a, tx: Math.round(mouse.x), ty: Math.round(mouse.y) });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, k, a, E, othersAt(pending.length * H.TICK));
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
  //  EFFETS : éclaboussures, bombe, bonus
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "bombe" ? 70 : f.kind === "splat" ? 14 : 24;
      const col = f.kind === "bonus" ? "#fff" : ownerColor(f.owner);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (f.kind === "bombe" ? 120 : 50) + Math.random() * (f.kind === "bombe" ? 380 : 160);
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, max: 0.6, col, r: 2 + Math.random() * 4 });
      }
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("te-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Durée</label>${chips("duration", [[60, "60 s"], [90, "90 s"], [120, "2 min"]])}</div>
      <div class="setting-block"><label>Mode</label>${chips("mode", [["auto", "🤖 Auto (équipes dès 4)"], ["solo", "🎨 Chacun pour soi"], ["equipes", "🔴🔵 2 équipes"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      const v = b.dataset.v;
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: isNaN(Number(v)) ? v : Number(v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const teams = s.mode === "equipes" || (s.mode === "auto" && n >= 4);
    $("te-start").style.display = host ? "" : "none";
    $("te-start").disabled = n < 2;
    $("te-finish-setup").classList.toggle("hidden", !host);
    $("te-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : teams ? `${n} joueurs → 2 équipes` : `${n} joueurs, chacun sa couleur`;
  }

  // ===================================================================
  //  BANDEAU : qui je suis + la barre des pourcentages
  // ===================================================================
  function renderHud() {
    if (!stat) return;
    const o = myOwner();
    const meTxt = !o ? "👀 Tu regardes" : stat.teamsMode ? `Tu peins pour les ${stat.owners[o].emoji} <b style="color:${ownerColor(o)}">${esc(stat.owners[o].name)}</b>` : `Ta couleur : <b style="color:${ownerColor(o)}">■ ${esc(pseudoOf(me()))}</b>`;
    if ($("te-me").innerHTML !== meTxt) $("te-me").innerHTML = meTxt;
    const entries = Object.keys(stat.owners).map((k) => ({ k, p: st.pct?.[k] || 0 })).sort((a, b) => b.p - a.p);
    const bar = entries.map((e) => `<div class="te-seg ${Number(e.k) === o ? "mine" : ""}" style="flex:${Math.max(0.0001, e.p)};background:${ownerColor(e.k)}" title="${esc(stat.owners[e.k].name)}">${e.p >= 0.06 ? Math.round(e.p * 100) + "%" : ""}</div>`).join("")
      + `<div class="te-seg empty" style="flex:${Math.max(0.0001, 1 - entries.reduce((s, e) => s + e.p, 0))}"></div>`;
    $("te-bar").innerHTML = bar;
  }

  function renderOver() {
    const ov = $("te-overlay");
    const show = st.phase === "over" && st.result;
    ov.parentElement.classList.toggle("over", false);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const key = JSON.stringify([st.result.scores.map((s) => s.pct), host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const top = st.result.scores[0], second = st.result.scores[1];
    const draw = second && Math.round(top.pct * 1000) === Math.round(second.pct * 1000);
    const banner = draw ? "🤝 Égalité parfaite !" : stat?.teamsMode ? `🏆 Victoire des ${stat.owners[top.owner].emoji} ${esc(stat.owners[top.owner].name)} !` : `🏆 ${esc(stat?.owners[top.owner]?.name || "?")} gagne !`;
    const rows = st.result.scores.map((s, i) => `<li><span class="te-sw" style="background:${ownerColor(s.owner)}"></span>
      <b>${i + 1}. ${esc(stat?.owners[s.owner]?.name || "?")}</b>${stat?.teamsMode ? `<span class="muted">${s.ids.map((id) => esc(pseudoOf(id))).join(", ")}</span>` : ""}
      <span class="gain">${(s.pct * 100).toFixed(1)} %</span></li>`).join("");
    let buttons;
    if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="te-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="te-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="te-again" class="btn btn-primary">🔁 Revanche</button>
          <button id="te-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="te-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="te-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over te-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("te-again") && ($("te-again").onclick = () => api.action("start").then((r) => { if (r.error) $("te-over-error").textContent = r.error; }));
    $("te-to-setup") && ($("te-to-setup").onclick = () => api.action("setup"));
    $("te-finish") && ($("te-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Territoire ? Le résultat donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("te-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !stat) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    const clock = $("te-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
      clock.textContent = "⏱️ " + mmss(st.phase === "over" ? 0 : left);
      clock.classList.toggle("urgent", st.phase === "play" && left < 10000);
    }
    draw(ts, dt);
  }

  const BONUS_ICON = { bombe: "💣", rouleau: "🧹", chaussures: "👟" };
  function draw(ts, dt) {
    const c = g2d;
    // Le sol (carrelage sombre).
    c.fillStyle = "#2a2733"; c.fillRect(0, 0, W, HGT);
    c.strokeStyle = "rgba(255,255,255,0.04)"; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 64) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, HGT); c.stroke(); }
    for (let y = 0; y <= HGT; y += 64) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // La peinture (agrandie, bords adoucis).
    if (grid) { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.drawImage(smoothCv, 0, 0, W, HGT); }
    // Obstacles.
    for (const o of stat.rects || []) {
      c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(o.x + 6, o.y + 8, o.w, o.h);
      c.fillStyle = "#4b4658"; c.fillRect(o.x, o.y, o.w, o.h);
      c.fillStyle = "rgba(255,255,255,0.1)"; c.fillRect(o.x, o.y, o.w, 6);
      c.strokeStyle = "#5e5870"; c.lineWidth = 3; c.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
    }
    // Caisses bonus.
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const b of st.bonuses || []) {
      const bob = Math.sin(ts / 200 + b.id) * 3;
      c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.ellipse(b.x + 3, b.y + 14, 16, 6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#c98b3c"; c.fillRect(b.x - 15, b.y - 15 + bob, 30, 30);
      c.strokeStyle = "#7a4f1c"; c.lineWidth = 3; c.strokeRect(b.x - 15, b.y - 15 + bob, 30, 30);
      c.font = "20px sans-serif"; c.fillText(BONUS_ICON[b.kind] || "?", b.x, b.y + bob + 1);
    }
    // Bonshommes (à la couleur de leur camp).
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y }; }
      return shownHero(h);
    });
    for (const v of views) {
      const col = ownerColor(stat.ownerOf[v.id]);
      if (v.roller > 0) { c.strokeStyle = col; c.lineWidth = 4; c.globalAlpha = 0.5; c.beginPath(); c.arc(v.x, v.y, 46, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; }
      window.HeroArt.paint(c, v, col, {
        id: v.id, isMe: v.id === me(),
        item: (cc) => { cc.fillStyle = "#333"; cc.fillRect(12, 9, 14, 6); cc.fillStyle = col; cc.fillRect(22, 8, 6, 8); },   // le pistolet à peinture
      });
      if (v.fast > 0) { c.font = "14px sans-serif"; c.fillText("👟", v.x - 18, v.y + 18); }
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.75)"; c.strokeText(pseudoOf(v.id), v.x, v.y - 28);
      c.fillStyle = "#fff"; c.fillText(pseudoOf(v.id), v.x, v.y - 28);
    }
    // Les jets de peinture en vol (une cloche + leur ombre au sol).
    for (const sh of st.shots || []) {
      const p = Math.min(1, (sh.age + (performance.now() - lastSnapRecv) / 1000) / SHOT_TIME);
      const x = sh.x0 + (sh.x1 - sh.x0) * p, y = sh.y0 + (sh.y1 - sh.y0) * p, hgt = Math.sin(Math.PI * p) * 45;
      c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(x, y, 7, 4, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = ownerColor(sh.owner); c.beginPath(); c.arc(x, y - hgt, 8, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "rgba(0,0,0,0.4)"; c.lineWidth = 2; c.stroke();
    }
    drawParticles(dt);
    // Le viseur (portée du jet) autour de la souris.
    const mv = views.find((v) => v.id === me());
    if (mv && st.phase === "play") {
      const d = Math.min(180, Math.hypot(mouse.x - mv.x, mouse.y - mv.y)), a = Math.atan2(mouse.y - mv.y, mouse.x - mv.x);
      const tx = mv.x + Math.cos(a) * d, ty = mv.y + Math.sin(a) * d;
      const ready = (heroOf(me())?.fireCd || 0) <= 0;
      c.strokeStyle = ready ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)"; c.lineWidth = 2;
      c.beginPath(); c.arc(tx, ty, 14, 0, Math.PI * 2); c.moveTo(tx - 20, ty); c.lineTo(tx - 8, ty); c.moveTo(tx + 8, ty); c.lineTo(tx + 20, ty);
      c.moveTo(tx, ty - 20); c.lineTo(tx, ty - 8); c.moveTo(tx, ty + 8); c.lineTo(tx, ty + 20); c.stroke();
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, ownerColor(myOwner()),
      window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, HGT / 2 - 75, W, 150);
      c.font = "bold 64px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(left > 0 ? String(left) : "GO !", W / 2, HGT / 2 - 14);
      c.font = "22px Segoe UI, sans-serif"; c.fillText("Marche pour peindre · clic gauche pour lancer de la peinture", W / 2, HGT / 2 + 42);
    }
    if (st.phase === "over") {
      c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(0, 0, W, HGT);
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
