// ===================================================================
//  LA TOUR — Client (s'affiche dans le hub Le Bordel)
//  - La tour est refaite ici à partir de la seed (tower.js).
//  - MON perso est calculé ici tout de suite (prédiction), puis recalé :
//    le serveur fait les mêmes calculs, touche par touche.
//  - La caméra suit mon perso vers le haut ; la lave monte en dessous.
// ===================================================================

(() => {
  const P = window.Tower;
  const K = P.K;
  const W = 1280, HGT = 800;
  const Z = 1.4;              // zoom de la caméra : on ne voit que ce qui nous entoure

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let tower = null, towerSeed = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const pressed = new Set();
  const shown = {};
  const cam = { x: P.W / 2, y: 0 };
  let particles = [];
  const seenFx = new Set();
  let prevPhase = null, goFlash = 0, playAtLocal = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const colorOf = (id) => playerOf(id)?.color || "#fff";
  const runnerOf = (id) => st?.runners.find((r) => r.id === id);
  const driving = () => st?.phase === "play";
  const meters = (y) => Math.max(0, Math.floor(y / 10));

  const TEMPLATE = `
    <div id="to-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🌋</span>
        <h1>LA TOUR</h1>
        <p class="tagline">Un labyrinthe vertical. La lave monte. Le dernier en vie gagne.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="to-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🌋 Tout le monde grimpe <b>le même labyrinthe</b>. La <b>lave</b> monte de plus en plus vite : si elle te touche, tu es éliminé.</li>
            <li>🔀 À chaque étage : le <b>puits</b> (direct, au saut mural, avec des piques) ou le <b>zigzag</b> (sauts muraux et couloirs à passer accroupi, plus long, plus sûr). Pas de cul-de-sac.</li>
            <li>🏃 <kbd>←</kbd><kbd>→</kbd> ou <kbd>Q</kbd><kbd>D</kbd> : courir · <kbd>Espace</kbd> / <kbd>↑</kbd> / <kbd>Z</kbd> : sauter (maintenir = plus haut).</li>
            <li>🧗 <b>Saut mural</b> : contre un mur, saute pour rebondir vers l'autre côté (pas deux fois de suite sur le même côté).</li>
            <li>⬇️ <kbd>↓</kbd> / <kbd>S</kbd> : s'accroupir (passer sous les plafonds bas) · en l'air : retomber plus vite.</li>
            <li>🟠 Certains rebords d'arrivée sont <b>orange</b> : ils s'effritent. Les <b>piques</b> rouges éliminent.</li>
            <li>🏆 Le <b>dernier en vie</b> gagne la manche (10, 7, 5, 3, 2, 1 points).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="to-start" class="btn btn-primary btn-big">🌋 Lancer la lave !</button>
        <p id="to-hint" class="muted"></p>
        <p id="to-error" class="error-msg"></p>
        <button id="to-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="to-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="to-round"></span>
        <span id="to-me" class="ch-role"></span>
        <span id="to-alive" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="to-canvas" width="${W}" height="${HGT}"></canvas>
        <div id="to-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">← → / Q D = courir · Espace / ↑ / Z = sauter (aussi contre les murs) · ↓ / S = s'accroupir</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.tour = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; towerSeed = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("to-canvas");
      g2d = canvas.getContext("2d");
      $("to-start").onclick = () => {
        $("to-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("to-error").textContent = r.error; });
      };
      $("to-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") { goFlash = 1; playAtLocal = performance.now() - (st.time || 0) * 1000; }
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); seq = 0; acc = 0; cam.y = 0; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (st.phase === "setup") {
        $("to-play").classList.add("hidden");
        $("to-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("to-setup").classList.add("hidden");
      $("to-play").classList.remove("hidden");
      if (st.seed !== towerSeed) { towerSeed = st.seed; tower = P.tower(st.seed); }
      Object.assign(tower.crumbles, st.crumbles || {});
      handleFx();
      reconcile();
      renderHud();
      renderOver();
    },

    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
      tower = null;
    },
  };

  // ===================================================================
  //  CLAVIER
  // ===================================================================
  const KEYMAP = {
    ArrowLeft: K.LEFT, KeyA: K.LEFT, KeyQ: K.LEFT, ArrowRight: K.RIGHT, KeyD: K.RIGHT,
    Space: K.JUMP, ArrowUp: K.JUMP, KeyW: K.JUMP, KeyZ: K.JUMP, ArrowDown: K.DOWN, KeyS: K.DOWN,
  };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; return k; }

  // ===================================================================
  //  PRÉDICTION DE MON PERSO
  // ===================================================================
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vy - b.vy) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && a.alive === b.alive;
  function reconcile() {
    const sc = runnerOf(me());
    if (!sc || !driving() || !tower || !sc.alive) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    pred = P.copy(sc);
    for (const p of pending) { P.step(pred, p.k, tower); history.set(p.s, P.copy(pred)); }
    prevPred = null;
  }
  function driveLocal(dt) {
    const sc = runnerOf(me());
    if (!driving() || !tower || !sc || !sc.alive) { acc = 0; return; }
    if (!pred) pred = P.copy(sc);
    acc = Math.min(acc + dt, 0.25);
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 120) pending.shift();
      prevPred = P.copy(pred);
      P.step(pred, k, tower);
      history.set(seq, P.copy(pred));
      acc -= P.TICK;
    }
  }
  function myView() {
    if (!pred) return runnerOf(me());
    if (!prevPred) return pred;
    const f = Math.min(1, acc / P.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }

  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      for (let i = 0; i < 34; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 300;
        particles.push({ x: f.x, y: f.y + 20, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.6, max: 1, col: f.kind === "lave" ? ["#ff5a1f", "#ffb020", "#ffe14d"][i % 3] : ["#fff", "#ff3b3b"][i % 2] });
      }
    }
    if (seenFx.size > 300) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("to-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label><div class="cat-chips">${[3, 5].map((v) =>
        `<button class="cat-chip ${s.rounds === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${v}</button>`).join("")}</div></div>
      <p class="settings-note">Une nouvelle tour à chaque manche (la même pour tout le monde).</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { rounds: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("to-start").style.display = host ? "" : "none";
    $("to-start").disabled = n < 2;
    $("to-finish-setup").classList.toggle("hidden", !host);
    $("to-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} grimpeurs`;
  }

  function renderHud() {
    $("to-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = runnerOf(me());
    const n = st.runners.filter((r) => r.alive).length;
    const txt = !mine ? "👀 Tu regardes" : !mine.alive ? (mine.cause === "pique" ? "💥 Piques ! Tu regardes la suite." : "🔥 Dans la lave ! Tu regardes la suite.") : n === 1 && st.runners.length > 1 ? "🏆 Dernier en vie !" : "🧗 Grimpe !";
    if ($("to-me").textContent !== txt) $("to-me").textContent = txt;
    $("to-alive").textContent = `🧗 ${n} en vie`;
  }

  function renderOver() {
    const ov = $("to-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = `🏆 ${esc(pseudoOf(lr.order[0]))} est le dernier en vie !`;
    const cause = (id) => (lr.cause[id] === "pique" ? " · piques" : lr.cause[id] === "lave" ? " · lave" : lr.cause[id] === "parti" ? " · parti" : " · survivant");
    const rows = lr.order.filter((id) => playerOf(id)).map((id, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.height[id]} m${cause(id)}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="to-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="to-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="to-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="to-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="to-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="to-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="to-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="to-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="to-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("to-next") && ($("to-next").onclick = () => api.action("next"));
    $("to-again") && ($("to-again").onclick = () => api.action("start").then((r) => { if (r.error) $("to-over-error").textContent = r.error; }));
    $("to-to-setup") && ($("to-to-setup").onclick = () => api.action("setup"));
    $("to-finish") && ($("to-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer La Tour ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["to-fin-sec", finishEndLocal], ["to-next-sec", phaseEndLocal]]) {
      const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
    if (!st || st.phase === "setup" || !tower) return;
    driveLocal(dt);
    draw(ts, dt);
  }

  // Le temps de la course (pour la lave et les plateformes qui bougent).
  const timeNow = () => (pred ? pred.t : driving() ? (performance.now() - playAtLocal) / 1000 : 0);
  const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 1597334677); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; };

  function draw(ts, dt) {
    const c = g2d, t = timeNow();
    // Qui suit-on ? Moi, sinon le plus haut encore en vie.
    const mine = runnerOf(me());
    let focus = mine && mine.alive ? (myView() || mine) : null;
    if (!focus) { const up = st.runners.filter((r) => r.alive).sort((a, b) => b.y - a.y)[0]; focus = up ? (shown[up.id] ? { ...up, ...shown[up.id] } : up) : mine; }
    const vw = W / Z, vh = HGT / Z;
    const k = Math.min(1, dt * 9);
    cam.x += ((focus?.x ?? P.W / 2) - cam.x) * k;
    cam.y += ((focus?.y ?? 0) + 50 - cam.y) * k;
    cam.x = Math.max(vw / 2, Math.min(P.W - vw / 2, cam.x));
    const top = cam.y + vh / 2, bottom = cam.y - vh / 2, left = cam.x - vw / 2, right = cam.x + vw / 2;
    const Y = (y) => -(y - cam.y);     // hauteur → écran (dans le repère zoomé)
    tower.ensure(top);

    // Le fond des couloirs : clair (on doit bien voir où on va).
    const lava = P.lavaAt(t);
    const gr = c.createLinearGradient(0, 0, 0, HGT);
    gr.addColorStop(0, "#8fa6e0"); gr.addColorStop(1, "#d9b3c9");
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    c.setTransform(Z, 0, 0, Z, W / 2 - cam.x * Z, HGT / 2);

    // Les murs, case par case : pierres sombres, bord clair du côté des couloirs.
    const T = P.TILE;
    const r0 = Math.floor(bottom / T) - 1, r1 = Math.ceil(top / T) + 1, q0 = Math.max(0, Math.floor(left / T) - 1), q1 = Math.min(P.COLS - 1, Math.ceil(right / T) + 1);
    for (let row = r0; row <= r1; row++) for (let q = q0; q <= q1; q++) {
      const x = q * T, y = Y((row + 1) * T);
      if (!P.tileAt(tower, row, q)) {
        // Briques du fond, très légères (fixes).
        if (hash(row, q) < 0.22) { c.fillStyle = "rgba(255,255,255,0.13)"; c.fillRect(x + 3, y + 3, T - 6, T / 2 - 4); }
        continue;
      }
      c.fillStyle = hash(row, q) < 0.5 ? "#39325a" : "#413965";
      c.fillRect(x, y, T + 0.5, T + 0.5);
      c.fillStyle = "rgba(0,0,0,0.16)"; c.fillRect(x, y + T / 2 - 1, T, 2); c.fillRect(x + (row % 2 ? T / 2 : T - 2), y, 2, T / 2); c.fillRect(x + (row % 2 ? 2 : T / 2), y + T / 2, 2, T / 2);
    }
    // Bord clair : on voit tout de suite la forme des couloirs.
    c.fillStyle = "#e9e4ff";
    for (let row = r0; row <= r1; row++) for (let q = q0; q <= q1; q++) {
      if (!P.tileAt(tower, row, q)) continue;
      const x = q * T, y = Y((row + 1) * T);
      if (!P.tileAt(tower, row + 1, q)) c.fillRect(x, y, T, 5);        // dessus (le sol)
      if (!P.tileAt(tower, row - 1, q)) c.fillRect(x, y + T - 3, T, 3);
      if (q > 0 && !P.tileAt(tower, row, q - 1)) c.fillRect(x, y, 3, T);
      if (q < P.COLS - 1 && !P.tileAt(tower, row, q + 1)) c.fillRect(x + T - 3, y, 3, T);
    }

    const v = P.view(tower, bottom - 40, top + 40);
    // Plafonds bas.
    for (const s of v.solids) {
      if (!s.low) continue;
      const y = Y(s.y + s.h);
      c.fillStyle = "#413965"; c.fillRect(s.x, y, s.w, s.h);
      c.fillStyle = "#ffcf3a"; c.fillRect(s.x, y + s.h - 8, s.w, 8);
      c.fillStyle = "#1b1b1b"; for (let q = 0; q < s.w; q += 16) c.fillRect(s.x + q, y + s.h - 8, 8, 8);
      c.strokeStyle = "#e9e4ff"; c.lineWidth = 3; c.strokeRect(s.x + 1.5, y + 1.5, s.w - 3, s.h - 3);
    }
    // Rebords.
    for (const p of v.plats) {
      if (p.ground) continue;
      const on = P.platOn(tower, p, t);
      const px = p.x, y = Y(p.y), c0 = tower.crumbles[p.id];
      if (p.kind === "crumble" && c0 !== undefined && !on) {
        c.strokeStyle = "rgba(255,255,255,0.5)"; c.setLineDash([8, 8]); c.lineWidth = 2; c.strokeRect(px, y, p.w, p.h); c.setLineDash([]);
        continue;
      }
      let sh = 0;
      if (p.kind === "crumble" && c0 !== undefined && t >= c0 && t < c0 + P.CRUMBLE) sh = (Math.random() - 0.5) * 6;
      c.fillStyle = p.kind === "crumble" ? "#ff9a2e" : "#58d06a"; c.fillRect(px + sh, y, p.w, p.h);
      c.fillStyle = "rgba(255,255,255,0.65)"; c.fillRect(px + sh, y, p.w, 3);
      c.strokeStyle = "#1b1830"; c.lineWidth = 2; c.strokeRect(px + sh, y, p.w, p.h);
      if (p.kind === "crumble") { c.strokeStyle = "rgba(90,40,0,0.7)"; c.lineWidth = 2; for (let q = 14; q < p.w; q += 30) { c.beginPath(); c.moveTo(px + sh + q, y + 1); c.lineTo(px + sh + q + 6, y + 6); c.lineTo(px + sh + q - 2, y + p.h - 1); c.stroke(); } }
    }
    // Piques : rouge et blanc, avec un contour.
    for (const s of v.spikes) {
      const vert = s.faces !== undefined;
      c.fillStyle = "#ff2d2d"; c.strokeStyle = "#fff"; c.lineWidth = 2;
      if (!vert) {
        const n = Math.max(2, Math.round(s.w / 14)), w = s.w / n, base = Y(s.y);
        for (let i = 0; i < n; i++) { c.beginPath(); c.moveTo(s.x + i * w, base); c.lineTo(s.x + i * w + w / 2, base - s.h - 6); c.lineTo(s.x + (i + 1) * w, base); c.closePath(); c.fill(); c.stroke(); }
      } else {
        const n = Math.max(2, Math.round(s.h / 14)), h = s.h / n, top0 = Y(s.y + s.h), dirX = s.faces;
        const bx = dirX > 0 ? s.x : s.x + s.w;
        for (let i = 0; i < n; i++) { c.beginPath(); c.moveTo(bx, top0 + i * h); c.lineTo(bx + dirX * (s.w + 6), top0 + i * h + h / 2); c.lineTo(bx, top0 + (i + 1) * h); c.closePath(); c.fill(); c.stroke(); }
      }
    }

    // Les persos (les autres lissés, le mien prédit).
    for (const r0b of st.runners) {
      if (!r0b.alive) continue;
      const isMe = r0b.id === me();
      let r = r0b;
      if (isMe && pred) r = myView();
      else {
        const sh = shown[r0b.id] || (shown[r0b.id] = { x: r0b.x, y: r0b.y });
        const kk = Math.min(1, dt * 16);
        sh.x += (r0b.x - sh.x) * kk; sh.y += (r0b.y - sh.y) * kk;
        if (Math.hypot(r0b.x - sh.x, r0b.y - sh.y) > 200) { sh.x = r0b.x; sh.y = r0b.y; }
        r = { ...r0b, x: sh.x, y: sh.y };
      }
      if (r.y > top + 80 || r.y < bottom - 80) continue;
      drawRunner(c, r, Y(r.y), colorOf(r0b.id), isMe);
      const lab = pseudoOf(r0b.id), hy = Y(r.y) - P.height(r) - 14;
      c.font = "bold 12px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      const lw = c.measureText(lab).width + 10;
      c.fillStyle = isMe ? "rgba(255,210,63,0.95)" : "rgba(0,0,0,0.6)";
      c.beginPath(); c.roundRect(r.x - lw / 2, hy - 9, lw, 18, 5); c.fill();
      c.fillStyle = isMe ? "#1b1830" : "#fff"; c.fillText(lab, r.x, hy + 1);
    }

    // Étincelles.
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 500 * dt; c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.col; c.fillRect(p.x - 2, Y(p.y) - 2, 5, 5); }
    c.globalAlpha = 1;

    // La lave.
    const ly = Y(lava), bot = vh / 2 + 20;
    if (ly < bot) {
      const wave = (x) => ly + Math.sin(x / 70 + ts / 300) * 7 + Math.sin(x / 31 - ts / 210) * 4;
      const g2 = c.createLinearGradient(0, ly, 0, ly + 160);
      g2.addColorStop(0, "#ffb020"); g2.addColorStop(0.15, "#ff5a1f"); g2.addColorStop(1, "#a01808");
      c.fillStyle = g2;
      c.beginPath(); c.moveTo(left - 20, bot);
      for (let x = left - 20; x <= right + 32; x += 24) c.lineTo(x, wave(x));
      c.lineTo(right + 32, bot); c.closePath(); c.fill();
      c.strokeStyle = "#ffe14d"; c.lineWidth = 4;
      c.beginPath();
      for (let x = left - 20; x <= right + 32; x += 24) { x === left - 20 ? c.moveTo(x, wave(x)) : c.lineTo(x, wave(x)); }
      c.stroke();
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    // La lave est proche : l'écran rougit.
    const my = mine && mine.alive ? (pred || mine).y : null;
    const gapL = my === null ? 9999 : my - lava;
    if (driving() && gapL < 340) {
      c.fillStyle = `rgba(255,40,10,${(0.28 * (1 - Math.max(0, gapL) / 340)).toFixed(3)})`; c.fillRect(0, 0, W, HGT);
    }

    drawHud(c, ts, dt, lava, gapL, t);
  }

  // Le perso : bâtons avec halo clair + contour noir (il ressort du décor).
  function drawRunner(c, r, foot, color, isMe) {
    const x = r.x, f = r.face || 1;
    const ph = Math.abs(r.vx) > 20 && !r.air ? Math.sin(r.x / 14) : 0;
    let lines, head;
    if (r.crouch) {
      lines = [[-14 * f, 12, 8 * f, 12], [8 * f, 12, 14 * f, 2], [-6 * f, 12, -10 * f, 2]];
      head = [14 * f, 18, 7];
    } else if (r.air && r.wall) {
      const w = r.wall;   // collé au mur
      lines = [[0, 18, 0, 32], [0, 18, 9 * w, 4], [0, 18, -7 * w, 2], [0, 30, 11 * w, 40], [0, 30, 11 * w, 24]];
      head = [-1 * w, 39, 6.5];
    } else {
      const sw = r.air ? 0.8 : ph;
      lines = [[0, 19, 2 * f, 33], [0, 19, 9 * sw, r.air ? 7 : 0], [0, 19, -9 * sw, r.air ? 3 : 0], [2 * f, 31, -9 * sw, r.air ? 38 : 21], [2 * f, 31, 9 * sw, r.air ? 38 : 23]];
      head = [3 * f, 39, 6.5];
    }
    const pass = (col, extra) => {
      c.strokeStyle = col; c.fillStyle = col; c.lineCap = "round"; c.lineWidth = 5 + extra;
      for (const [a, b, d, e] of lines) { c.beginPath(); c.moveTo(x + a, foot - b); c.lineTo(x + d, foot - e); c.stroke(); }
      c.beginPath(); c.arc(x + head[0], foot - head[1], head[2] + extra / 2, 0, Math.PI * 2); c.fill();
    };
    pass("rgba(255,255,255,0.6)", 7);
    pass("#0b0914", 3.5);
    pass(color, 0);
    if (isMe) {
      const y = foot - P.height(r) - 34;
      c.fillStyle = "#ffd23f"; c.strokeStyle = "#1b1830"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - 9, y - 10); c.lineTo(x + 9, y - 10); c.lineTo(x, y + 2); c.closePath(); c.fill(); c.stroke();
    }
  }

  function panel(c, x, y, w, h) { c.fillStyle = "rgba(12,10,24,0.74)"; c.beginPath(); c.roundRect(x, y, w, h, 12); c.fill(); }

  function drawHud(c, ts, dt, lava, gapL, t) {
    const mine = runnerOf(me());
    const v = mine && mine.alive && pred ? pred : mine;
    c.textBaseline = "top"; c.textAlign = "left";
    // Ma hauteur, en gros à gauche.
    if (v) {
      panel(c, 16, 14, 240, 86);
      c.fillStyle = "#fff"; c.font = "bold 16px Segoe UI, sans-serif"; c.fillText("Hauteur", 30, 20);
      c.fillStyle = mine.alive ? "#ffd23f" : "#ff9a9a"; c.font = "900 50px Segoe UI, sans-serif";
      c.fillText(`${meters(mine.alive ? v.y : v.best)} m`, 30, 40);
    }
    // Distance à la lave.
    if (driving() && mine?.alive) {
      const near = gapL < 340;
      panel(c, 16, 108, 240, 40);
      c.font = "bold 20px Segoe UI, sans-serif";
      c.fillStyle = near && Math.floor(ts / 200) % 2 ? "#ff5a5a" : near ? "#ffd0a0" : "#fff";
      c.fillText(gapL < 0 ? "🔥 LAVE !" : `🔥 Lave à ${meters(gapL)} m`, 30, 118);
    }
    // Barre à droite : tout le monde + la lave.
    if (st.phase === "play" || st.phase === "countdown") {
      const bx = W - 48, by = 60, bh = HGT - 120;
      const hi = Math.max(600, ...st.runners.map((r) => r.best)) + 200, lo = Math.min(lava, 0) - 100;
      const yOf = (y) => by + bh - ((Math.max(lo, Math.min(hi, y)) - lo) / (hi - lo)) * bh;
      c.fillStyle = "rgba(12,10,24,0.65)"; c.beginPath(); c.roundRect(bx - 12, by - 12, 36, bh + 24, 12); c.fill();
      c.fillStyle = "#ff5a1f"; const ly = yOf(lava); c.fillRect(bx, ly, 12, by + bh - ly);
      for (const r of st.runners) {
        if (!r.alive) continue;
        const py = yOf(r.id === me() && pred ? pred.y : r.y);
        c.fillStyle = colorOf(r.id); c.strokeStyle = r.id === me() ? "#fff" : "#000"; c.lineWidth = r.id === me() ? 3 : 1.5;
        c.beginPath(); c.arc(bx + 6, py, r.id === me() ? 9 : 6, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
    // Compte à rebours.
    if (st.phase === "countdown") {
      const n = Math.max(1, Math.ceil((phaseEndLocal - Date.now()) / 1000));
      c.textAlign = "center"; c.textBaseline = "middle"; c.font = "900 150px Segoe UI, sans-serif";
      c.lineWidth = 10; c.strokeStyle = "rgba(0,0,0,0.6)"; c.fillStyle = "#ffd23f";
      c.strokeText(n, W / 2, HGT / 2 - 40); c.fillText(n, W / 2, HGT / 2 - 40);
    }
    if (goFlash > 0) {
      goFlash = Math.max(0, goFlash - dt * 1.1);
      c.globalAlpha = Math.min(1, goFlash * 2);
      c.textAlign = "center"; c.textBaseline = "middle"; c.font = "900 120px Segoe UI, sans-serif";
      c.lineWidth = 9; c.strokeStyle = "rgba(0,0,0,0.6)"; c.fillStyle = "#3dff7a";
      c.strokeText("GRIMPE !", W / 2, HGT / 2 - 40); c.fillText("GRIMPE !", W / 2, HGT / 2 - 40);
      c.globalAlpha = 1;
    }
    void t;
  }
})();
