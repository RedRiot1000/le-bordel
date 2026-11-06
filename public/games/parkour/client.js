// ===================================================================
//  PARKOUR — Client (s'affiche dans le hub Le Bordel)
//  - Une seule piste. Le parcours est refait ici à partir de la seed.
//  - MON coureur est calculé ici tout de suite (prédiction), puis recalé :
//    le serveur fait exactement les mêmes calculs, touche par touche.
//  - Les autres sont des fantômes transparents, derrière le décor : affichés
//    avec un léger retard, en glissant entre leurs positions reçues (pas de saccades).
// ===================================================================

(() => {
  const P = window.Parkour;
  const K = P.K;
  const W = 1280, HGT = 800;
  const RUN_X = 340;          // où le coureur est dessiné
  const S = 1.25;             // l'échelle de la piste
  const FLOOR = 660;          // la hauteur du sol à l'écran
  const DELAY = 110;          // le retard d'affichage des fantômes (ms)

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let course = null, courseSeed = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const pressed = new Set();
  const trail = {};           // id -> les dernières positions reçues (pour les fantômes)
  let particles = [];
  const seenFx = new Set();
  let prevPhase = null, playSeenAt = 0, flash = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const runnerOf = (id) => st?.runners.find((r) => r.id === id);
  const driving = () => st?.phase === "play";
  const meters = (d) => Math.floor(d / 10);

  const TEMPLATE = `
    <div id="pk-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🏃</span>
        <h1>PARKOUR</h1>
        <p class="tagline">Cours, monte, évite les pièges. Le mur élimine les plus lents.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="pk-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏃 Tu cours tout seul, de plus en plus vite. Les autres sont des <b>fantômes</b> : ils ne te gênent pas.</li>
            <li>⬆️ <kbd>Espace</kbd> / <kbd>↑</kbd> / <kbd>Z</kbd> : <b>sauter</b> (maintenir = plus haut, pour monter sur les toits).</li>
            <li>⬇️ <kbd>↓</kbd> / <kbd>S</kbd> : <b>glisser</b>. En l'air : retomber plus vite.</li>
            <li>💥 Un choc te <b>ralentit</b>. Le <b>mur</b> qui te suit t'élimine : le dernier en course gagne.</li>
            <li>🏢 En haut, c'est plus rapide mais plus piégé. En bas, c'est plus sûr mais plus lent.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="pk-start" class="btn btn-primary btn-big">À vos marques !</button>
        <p id="pk-hint" class="muted"></p>
        <p id="pk-error" class="error-msg"></p>
        <button id="pk-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="pk-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="pk-round"></span>
        <span id="pk-me" class="ch-role"></span>
        <span id="pk-alive" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="pk-canvas" width="${W}" height="${HGT}"></canvas>
        <div id="pk-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">Espace / ↑ / Z = sauter (maintenir = plus haut) · ↓ / S = glisser, s'accroupir</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.parkour = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; courseSeed = null;
      for (const k in trail) delete trail[k];
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-violet");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("pk-canvas");
      g2d = canvas.getContext("2d");
      $("pk-start").onclick = () => {
        $("pk-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("pk-error").textContent = r.error; });
      };
      $("pk-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); seq = 0; acc = 0; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (st.phase === "setup") {
        $("pk-play").classList.add("hidden");
        $("pk-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("pk-setup").classList.add("hidden");
      $("pk-play").classList.remove("hidden");
      if (st.seed !== courseSeed) { courseSeed = st.seed; course = P.course(st.seed); for (const k in trail) delete trail[k]; }
      const at = performance.now();
      for (const r of st.runners) {
        const q = trail[r.id] || (trail[r.id] = []);
        q.push({ at, d: r.d, y: r.y, crouch: r.crouch, air: r.air, alive: r.alive, stall: r.stall, safe: r.safe, t: r.t });
        if (q.length > 24) q.shift();
      }
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
    },
  };

  // ===================================================================
  //  CLAVIER
  // ===================================================================
  const KEYMAP = { Space: K.JUMP, ArrowUp: K.JUMP, KeyW: K.JUMP, ArrowDown: K.DOWN, KeyS: K.DOWN };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; return k; }

  // ===================================================================
  //  PRÉDICTION DE MON COUREUR (le serveur fait les mêmes calculs)
  // ===================================================================
  const same = (a, b) => Math.abs(a.d - b.d) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vy - b.vy) < 0.05 && a.alive === b.alive;
  // Un fantôme : sa position il y a DELAY ms, en glissant entre deux positions reçues.
  function ghostOf(id) {
    const q = trail[id];
    if (!q?.length) return null;
    const at = performance.now() - DELAY;
    for (let i = q.length - 1; i > 0; i--) {
      const a = q[i - 1], b = q[i];
      if (a.at <= at && at <= b.at) {
        const f = b.at > a.at ? (at - a.at) / (b.at - a.at) : 1;
        if (Math.abs(b.d - a.d) > 500) return b;      // (il vient de remonter d'un trou)
        return { ...b, d: a.d + (b.d - a.d) * f, y: a.y + (b.y - a.y) * f };
      }
    }
    return q[q.length - 1];
  }
  function reconcile() {
    const sc = runnerOf(me());
    if (!sc || !driving() || !course) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    pred = P.copy(sc);
    for (const p of pending) { P.step(pred, p.k, course); history.set(p.s, P.copy(pred)); }
    prevPred = null;
  }
  function driveLocal(dt) {
    if (!driving() || !course) { acc = 0; return; }
    const sc = runnerOf(me());
    if (!sc) return;
    if (!pred) pred = P.copy(sc);
    acc = Math.min(acc + dt, 0.25);
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 120) pending.shift();
      prevPred = P.copy(pred);
      const was = pred.alive;
      const res = P.step(pred, k, course);
      if (was && res) flash = 1;
      history.set(seq, P.copy(pred));
      acc -= P.TICK;
    }
  }
  function myView() {
    if (!pred) return runnerOf(me());
    if (!prevPred) return pred;
    const f = Math.min(1, acc / P.TICK);
    return { ...pred, d: prevPred.d + (pred.d - prevPred.d) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }

  // ===================================================================
  //  EFFETS
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (f.who !== me()) continue;
      const v = myView();
      const y = FLOOR - ((v?.y || 0) + 26) * S;
      for (let i = 0; i < 26; i++) {
        const a = -Math.random() * Math.PI, sp = 60 + Math.random() * 260;
        particles.push({ x: RUN_X, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.4, max: 0.8, col: f.kind === "trou" ? "#8a7a6a" : i % 2 ? "#ffcf5c" : "#fff" });
      }
      flash = 1;
    }
    if (seenFx.size > 300) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("pk-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[5, "5"], [7, "7"], [10, "10"]])}</div>
      <p class="settings-note">Un nouveau parcours à chaque manche (le même pour tout le monde).</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("pk-start").style.display = host ? "" : "none";
    $("pk-start").disabled = n < 2;
    $("pk-finish-setup").classList.toggle("hidden", !host);
    $("pk-hint").textContent = !host ? "En attente que l'hôte lance la course…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} coureurs`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("pk-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = runnerOf(me());
    const n = st.runners.filter((r) => r.alive).length;
    const txt = !mine ? "👀 Tu regardes" : !mine.alive ? `🧱 Rattrapé par le mur à ${meters(mine.d)} m` : n === 1 && st.runners.length > 1 ? "🏆 Dernier en course !" : mine.slow > 0 ? "💥 Choc : tu ralentis !" : mine.stall > 0 ? "🕳️ Dans le trou !" : "🏃 Cours !";
    if ($("pk-me").textContent !== txt) $("pk-me").textContent = txt;
    $("pk-alive").textContent = `🏃 ${n} encore en course`;
  }

  function renderOver() {
    const ov = $("pk-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = `🏆 ${esc(pseudoOf(lr.order[0]))} gagne la course !`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.dist[id]} m · ${lr.hits[id]} choc${lr.hits[id] > 1 ? "s" : ""}${lr.cause[id] === "mur" ? " · rattrapé" : lr.cause[id] === "parti" ? " · parti" : ""}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="pk-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="pk-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="pk-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="pk-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="pk-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="pk-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="pk-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="pk-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="pk-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("pk-next") && ($("pk-next").onclick = () => api.action("next"));
    $("pk-again") && ($("pk-again").onclick = () => api.action("start").then((r) => { if (r.error) $("pk-over-error").textContent = r.error; }));
    $("pk-to-setup") && ($("pk-to-setup").onclick = () => api.action("setup"));
    $("pk-finish") && ($("pk-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Parkour ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("pk-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("pk-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !course) return;
    driveLocal(dt);
    draw(ts, dt);
  }

  // Le décor qui défile (ville au crépuscule, en 2 plans). Chaque immeuble est attaché
  // à sa place dans le monde (numéro de colonne) : il ne change jamais de forme en défilant.
  const hash = (a, b) => { let h = Math.imul(a ^ 0x9e3779b9, 2654435761) ^ Math.imul(b + 0x7f4a7c15, 1597334677); h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  function drawBackdrop(c, L, d) {
    const gr = c.createLinearGradient(0, L.y, 0, L.ground);
    gr.addColorStop(0, "#5f83cf"); gr.addColorStop(0.65, "#b09bd8"); gr.addColorStop(1, "#f7bb80");
    c.fillStyle = gr; c.fillRect(0, L.y, W, L.h);
    // Soleil couchant (fixe).
    c.fillStyle = "rgba(255,230,160,0.55)"; c.beginPath(); c.arc(W * 0.78, L.ground - (L.ground - L.y) * 0.25, 40 * L.s, 0, Math.PI * 2); c.fill();
    const top = L.ground - L.y;
    for (const [layer, par, col, win, hmin, hmax, wb] of [[1, 0.15, "rgba(120,112,180,0.75)", "rgba(255,240,190,0.4)", 0.15, 0.4, 90], [2, 0.4, "rgba(80,72,130,0.85)", "rgba(255,215,130,0.5)", 0.08, 0.28, 70]]) {
      const scroll = d * par * L.s, bw = wb * L.s;
      const i0 = Math.floor(scroll / bw);
      for (let k = -1; k < W / bw + 2; k++) {
        const idx = i0 + k;
        const x = idx * bw - scroll;
        const hh = (hmin + hash(idx, layer) * hmax) * top;
        const ww = bw * (0.7 + hash(idx, layer + 10) * 0.25);
        c.fillStyle = col; c.fillRect(x, L.ground - hh, ww, hh);
        // Fenêtres : allumées ou non une fois pour toutes (selon l'immeuble et la case).
        c.fillStyle = win;
        const fw = 6 * L.s, fh = 8 * L.s, sx = 14 * L.s, sy = 18 * L.s;
        for (let row = 0, wy = L.ground - hh + 8 * L.s; wy < L.ground - 12 * L.s; row++, wy += sy)
          for (let colI = 0, wx = x + 6 * L.s; wx < x + ww - 10 * L.s; colI++, wx += sx)
            if (hash(idx * 64 + row, colI + layer * 100) < 0.25) c.fillRect(wx, wy, fw, fh);
      }
    }
  }

  // Les obstacles : couleurs vives + halo clair + contour noir (comme les bonshommes),
  // dessinés pile à la taille de leur zone de choc. Un petit « ! » rouge au sol les annonce.
  function outlined(c, s, pathFn, fill) {
    c.save();
    c.lineJoin = "round";
    pathFn(); c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 9 * s; c.stroke();
    pathFn(); c.strokeStyle = "#0b0914"; c.lineWidth = 4 * s; c.stroke();
    pathFn(); c.fillStyle = fill; c.fill();
    c.restore();
  }
  const rectPath = (c, x, y, w, h) => () => { c.beginPath(); c.rect(x, y, w, h); };
  function drawObstacle(c, L, o, sx, ts) {
    const z = P.zone(o, 0), K = { w: P.wOf(o), y0: z[0], y1: z[1] }, s = L.s;
    const x = sx, w = K.w * s, y0 = L.ground - K.y1 * s, h = (K.y1 - K.y0) * s;
    // Repère au sol devant chaque obstacle (triangle rouge).
    c.fillStyle = "#ff2d2d";
    c.beginPath(); c.moveTo(x + w / 2 - 8 * s, L.ground + 12 * s); c.lineTo(x + w / 2 + 8 * s, L.ground + 12 * s); c.lineTo(x + w / 2, L.ground + 2 * s); c.fill();
    if (o.kind === "haie") {
      // Barrière : 2 poteaux + 2 planches rayées rouge/blanc.
      for (const px of [x, x + w - 6 * s]) outlined(c, s, rectPath(c, px, y0, 6 * s, h), "#e8e8e8");
      for (const py of [y0, y0 + h * 0.5]) {
        outlined(c, s, rectPath(c, x - 3 * s, py, w + 6 * s, 9 * s), "#fff");
        c.fillStyle = "#ff2d2d"; for (let k = 0; k < w + 6 * s; k += 12 * s) c.fillRect(x - 3 * s + k, py, 6 * s, 9 * s);
      }
    } else if (o.kind === "caisse") {
      outlined(c, s, rectPath(c, x, y0, w, h), "#e08a2e");
      c.strokeStyle = "#6b3a10"; c.lineWidth = 3 * s;
      c.strokeRect(x + 4 * s, y0 + 4 * s, w - 8 * s, h - 8 * s);
      c.beginPath(); c.moveTo(x + 4 * s, y0 + 4 * s); c.lineTo(x + w - 4 * s, y0 + h - 4 * s); c.moveTo(x + w - 4 * s, y0 + 4 * s); c.lineTo(x + 4 * s, y0 + h - 4 * s); c.stroke();
    } else if (o.kind === "barre") {
      // Poteaux du haut de la ligne jusqu'à la barre, barre jaune/noir bien épaisse au bas de la zone.
      const by = L.ground - K.y0 * s;
      for (const px of [x + 2, x + w - 9 * s]) outlined(c, s, rectPath(c, px, L.y + 4, 7 * s, by - L.y - 4), "#9aa3b5");
      outlined(c, s, rectPath(c, x - 4 * s, by - 16 * s, w + 8 * s, 16 * s), "#ffd400");
      c.fillStyle = "#111"; for (let k = 0; k < w + 8 * s; k += 12 * s) c.fillRect(x - 4 * s + k, by - 16 * s, 6 * s, 16 * s);
    } else {
      // Un oiseau rouge vif qui bat des ailes (taille = sa zone dangereuse).
      const cy = L.ground - ((K.y0 + K.y1) / 2) * s, cx = x + w / 2, rx = w / 2, ry = h / 2;
      const flap = Math.sin(ts / 70) * 10 * s;
      outlined(c, s, () => { c.beginPath(); c.ellipse(cx, cy, rx, ry * 0.8, 0, 0, Math.PI * 2); }, "#ff3b3b");
      outlined(c, s, () => { c.beginPath(); c.moveTo(cx - 6 * s, cy); c.lineTo(cx + 6 * s, cy - ry * 0.6 - flap); c.lineTo(cx + rx * 0.9, cy - 2 * s); c.closePath(); }, "#c41e1e");
      c.fillStyle = "#ffc400"; c.beginPath(); c.moveTo(cx - rx, cy - 4 * s); c.lineTo(cx - rx - 12 * s, cy); c.lineTo(cx - rx, cy + 4 * s); c.fill();
      c.fillStyle = "#fff"; c.beginPath(); c.arc(cx - rx * 0.5, cy - ry * 0.25, 4 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#000"; c.beginPath(); c.arc(cx - rx * 0.55, cy - ry * 0.25, 2 * s, 0, Math.PI * 2); c.fill();
    }
  }

  // Le coureur, vu de côté : il court, saute, glisse, tombe.
  // Dessiné 3 fois (halo clair, contour noir, couleur) pour bien ressortir sur le décor.
  function drawRunner(c, x, r, color, alpha, solid) {
    const s = S, foot = FLOOR - r.y * s;
    c.save(); c.globalAlpha = alpha;
    const ph = (r.d / 40) % (Math.PI * 2);
    // Les traits (membres) et la tête, selon la pose.
    let lines, head;
    if (r.crouch) {
      lines = [[x - 16, 10, x + 10, 14, 5], [x + 10, 14, x + 24, 4, 5], [x - 6, 12, x - 2, 2, 5]];
      head = [x - 18, 15, 7];
    } else {
      const sw = r.air ? 0.9 : Math.sin(ph);
      lines = [
        [x, 21, x + 3, 37, 5],                                   // corps
        [x, 21, x + 10 * sw, r.air ? 8 : 0, 5],                  // jambes
        [x, 21, x - 10 * sw, r.air ? 3 : 0, 5],
        [x + 2, 34, x - 10 * sw, 24, 4],                         // bras
        [x + 2, 34, x + 10 * sw, 26, 4],
      ];
      head = [x + 3, 43, 6.5];
    }
    const X = (px) => x + (px - x) * s;   // les x sont donnés « en monde » autour de lui
    const pass = (col, extra) => {
      c.strokeStyle = col; c.fillStyle = col; c.lineCap = "round";
      for (const [x0, y0, x1, y1, w] of lines) { c.lineWidth = (w + extra) * s; c.beginPath(); c.moveTo(X(x0), foot - y0 * s); c.lineTo(X(x1), foot - y1 * s); c.stroke(); }
      c.beginPath(); c.arc(X(head[0]), foot - head[1] * s, (head[2] + extra / 2) * s, 0, Math.PI * 2); c.fill();
    };
    if (solid) {
      pass("rgba(255,255,255,0.8)", 8);   // halo clair
      pass("#0b0914", 3.5);               // contour noir
    }
    pass(color, 0);                       // la couleur du joueur
    c.restore();
  }

  // Les nouveaux pièges, dessinés à l'instant t.
  function drawTrap(c, o, x, base, t, ts) {
    const K = P.KINDS[o.kind], w = P.wOf(o) * S, z = P.zone(o, t);
    if (o.kind === "pique") {
      // Rentrés, on voit leur socle. Ils sortent en rythme.
      c.fillStyle = "#4a4560"; c.fillRect(x, base - 8, w, 8);
      const n = 4, sw = w / n, hgt = z ? 34 * S + 8 : 8;
      for (let i = 0; i < n; i++) {
        c.fillStyle = z ? "#ff2d2d" : "#8c86a8"; c.strokeStyle = "#fff"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x + i * sw, base); c.lineTo(x + i * sw + sw / 2, base - hgt); c.lineTo(x + (i + 1) * sw, base); c.closePath(); c.fill(); c.stroke();
      }
    } else if (o.kind === "laser") {
      // 2 bornes. Le rayon est en bas (saute) ou en haut (glisse).
      const top = base - 215 * S * (o.b ? 0.52 : 1);
      c.fillStyle = "#2c2a3c"; c.fillRect(x - 4, top, 10, base - top);
      const yA = base - z[1] * S, yB = base - z[0] * S;
      c.fillStyle = "rgba(255,40,70,0.3)"; c.fillRect(x - 12, yA, w + 24, yB - yA);
      c.fillStyle = "#ff2d55"; c.fillRect(x, yA, w, yB - yA);
      c.fillStyle = "#fff"; c.fillRect(x + w / 2 - 2, yA, 4, yB - yA);
    } else if (o.kind === "scie") {
      const cy = base - ((z[0] + z[1]) / 2) * S, cx = x + w / 2, r = 22 * S + 3;
      c.strokeStyle = "#3a3648"; c.lineWidth = 6; c.beginPath(); c.moveTo(cx, base); c.lineTo(cx, base - 118 * S); c.stroke();
      c.save(); c.translate(cx, cy); c.rotate(ts / 60);
      c.fillStyle = "#d8dde6"; c.strokeStyle = "#0b0914"; c.lineWidth = 3;
      c.beginPath(); for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r : r - 8; c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } c.closePath(); c.fill(); c.stroke();
      c.fillStyle = "#ff2d2d"; c.beginPath(); c.arc(0, 0, 7, 0, Math.PI * 2); c.fill();
      c.restore();
    } else if (o.kind === "rapide" || o.kind === "lent") {
      const fast = o.kind === "rapide";
      c.fillStyle = fast ? "#25d366" : "#7a4e2a"; c.fillRect(x, base - 3, w, 10);
      c.fillStyle = fast ? "#d8ffe6" : "#a87a4e";
      if (fast) { const shift = (ts / 8) % 40; for (let k = -40 + shift; k < w; k += 40) { if (k < 0) continue; c.beginPath(); c.moveTo(x + k, base - 3); c.lineTo(x + k + 12, base + 2); c.lineTo(x + k, base + 7); c.closePath(); c.fill(); } }
      else for (let k = 8; k < w; k += 26) { c.beginPath(); c.arc(x + k, base + 1, 5, 0, Math.PI * 2); c.fill(); }
    } else if (o.kind === "tremplin") {
      c.fillStyle = "#ffd23f"; c.fillRect(x, base - 12, w, 10);
      c.strokeStyle = "#0b0914"; c.lineWidth = 3; c.strokeRect(x, base - 12, w, 10);
      c.strokeStyle = "#ff7a1a"; c.lineWidth = 4; c.beginPath(); for (let k = 0; k <= w; k += 10) c.lineTo(x + k, base - (k / 10) % 2 * 6); c.stroke();
      c.fillStyle = "#ff2d2d"; c.beginPath(); c.moveTo(x + w / 2 - 10, base - 22); c.lineTo(x + w / 2, base - 38); c.lineTo(x + w / 2 + 10, base - 22); c.closePath(); c.fill();
    }
    void K;
  }

  // Toits et passerelles.
  function drawPlat(c, p, x, ts) {
    const w = p.w * S, y = FLOOR - p.y * S;
    if (p.cr) {
      // Dalles orange fissurées, posées sur le vide.
      c.fillStyle = "#ff9a2e"; c.fillRect(x, y, w, 14);
      c.fillStyle = "#6b3a10"; for (let k = 0; k < w; k += 46) { c.fillRect(x + k, y, 3, 14); c.fillRect(x + k + 18, y + 3, 12, 2); c.fillRect(x + k + 26, y + 8, 10, 2); }
      c.fillStyle = "#fff0c8"; c.fillRect(x, y, w, 3);
      return;
    }
    const top = p.y === P.Y2;
    c.fillStyle = "#2c2a3c";
    for (let k = 40; k < w - 20; k += 200) c.fillRect(x + k, y + 16, 8, (top ? P.Y2 - P.Y1 : P.Y1) * S - 16);
    c.fillStyle = top ? "#39b3a6" : "#3f7fc4"; c.fillRect(x, y, w, 18);
    c.fillStyle = top ? "#c8fff2" : "#cfe6ff"; c.fillRect(x, y, w, 4);
    c.fillStyle = "rgba(0,0,0,0.25)"; for (let k = 0; k < w; k += 40) c.fillRect(x + k, y + 4, 2, 14);
    void ts;
  }

  function draw(ts, dt) {
    const c = g2d;
    // Qui suit-on ? Moi, sinon le premier encore en course.
    const mine = runnerOf(me());
    const live = mine?.alive ? null : st.runners.filter((r) => r.alive).sort((a, b) => b.d - a.d)[0];
    const view = mine?.alive ? (pred ? myView() : mine) : live ? ghostOf(live.id) || live : mine || st.runners[0];
    if (!view) return;
    const cd = view.d, t = view.t || 0, toX = (d) => (d - cd) * S + RUN_X;
    const L = { y: 0, h: HGT, s: S, ground: FLOOR };
    drawBackdrop(c, L, cd);
    // Les fantômes : derrière le décor, jamais devant mon perso ni devant les pièges.
    const others = [];
    for (const r of st.runners) {
      if (r.id === me() && mine?.alive) continue;
      const g = ghostOf(r.id);
      if (!g) continue;
      others.push({ id: r.id, g, x: toX(g.d) });
    }
    for (const o of others) {
      if (o.x < -40 || o.x > W + 40 || !o.g.alive) continue;
      const col = playerOf(o.id)?.color || "#fff";
      drawRunner(c, o.x, o.g, col, live && o.id === live.id ? 1 : 0.42, !!live && o.id === live.id);
      c.font = "bold 13px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.globalAlpha = 0.75;
      c.fillStyle = col; c.fillText(pseudoOf(o.id), o.x, FLOOR - (o.g.y + 72) * S);
      c.globalAlpha = 1;
    }
    // Le sol, les trous, les toits, les pièges.
    const d0 = cd - RUN_X / S, d1 = d0 + W / S;
    const near = P.near(course, d0 - 60, d1 + 60);
    c.fillStyle = "#6b5b8e"; c.fillRect(0, FLOOR, W, HGT - FLOOR);
    c.fillStyle = "#d9d0f5"; c.fillRect(0, FLOOR, W, 5);
    c.fillStyle = "rgba(255,255,255,0.18)";
    for (let x = -((d0 * S) % 60); x < W; x += 60) c.fillRect(x, FLOOR + 14, 26, 4);
    for (const gp of near.gaps) {
      const gx = toX(gp.x), gw = gp.w * S;
      c.fillStyle = "#050308"; c.fillRect(gx, FLOOR, gw, HGT - FLOOR);
      for (const ex of [gx - 7, gx + gw]) for (let k = 0; k < 4; k++) { c.fillStyle = k % 2 ? "#fff" : "#e0302f"; c.fillRect(ex, FLOOR + k * 6, 7, 6); }
    }
    for (const p of near.plats) { if (p.cr && mine?.cx === p.id) continue; drawPlat(c, p, toX(p.x), ts); }
    for (const o of near.obs) {
      const base = FLOOR - o.b * S, x = toX(o.x);
      if (P.KINDS[o.kind].pad || ["pique", "laser", "scie"].includes(o.kind)) drawTrap(c, o, x, base, t, ts);
      else drawObstacle(c, { ...L, ground: base, y: o.b ? FLOOR - (o.b + 112) * S : 0 }, o, x, ts);
    }
    if (d0 < 200) { c.fillStyle = "rgba(255,255,255,0.7)"; const sx = toX(0); for (let k = 0; k < 8; k++) c.fillRect(sx + (k % 2) * 8, FLOOR - (k + 1) * 10, 8, 10); }
    // Le mur.
    const wall = mine?.alive && pred ? P.wallAt(pred.t) : st.wall;
    const wx = toX(wall);
    if (wx > -60) {
      const g = c.createLinearGradient(wx - 120, 0, wx, 0);
      g.addColorStop(0, "rgba(120,0,20,0)"); g.addColorStop(1, "rgba(160,10,30,0.85)");
      c.fillStyle = g; c.fillRect(Math.max(0, wx - 120), 0, Math.min(120, wx + 120), HGT);
      c.fillStyle = "#2a0810"; c.fillRect(0, 0, Math.max(0, wx - 2), HGT);
      c.fillStyle = "#ff2d45"; for (let y = 0; y < HGT; y += 40) { const j = Math.sin(ts / 90 + y) * 6; c.beginPath(); c.moveTo(wx, y); c.lineTo(wx + 22 + j, y + 20); c.lineTo(wx, y + 40); c.closePath(); c.fill(); }
    }
    // Mon coureur, net et au premier plan.
    if (mine?.alive) {
      const r = view, col = playerOf(me())?.color || "#fff";
      const blink = r.safe > 0 && Math.floor(ts / 90) % 2;
      drawRunner(c, RUN_X, r, col, r.stall > 0 ? 0.55 : blink ? 0.55 : 1, true);
      const hy = FLOOR - (r.y + P.height(r)) * S - 12, bob = Math.sin(ts / 160) * 3;
      c.fillStyle = "#ffd23f"; c.strokeStyle = "#1b1830"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(RUN_X - 11, hy - 16 + bob); c.lineTo(RUN_X + 11, hy - 16 + bob); c.lineTo(RUN_X, hy + bob); c.closePath(); c.fill(); c.stroke();
      if (r.boost > 0) { c.fillStyle = "rgba(37,211,102,0.75)"; for (let k = 1; k < 5; k++) c.fillRect(RUN_X - 16 - k * 18, FLOOR - (r.y + 12 + k * 6) * S, 12, 4); }
    }
    // Ceux qui sont hors de l'écran : une étiquette sur le bord.
    let lf = 0, rt = 0;
    for (const o of others) {
      if (!o.g.alive || (o.x >= -40 && o.x <= W + 40)) continue;
      const ahead = o.x > W, gap = Math.abs(meters(o.g.d) - meters(cd)), txt = `${ahead ? "" : "◀ "}${pseudoOf(o.id)} ${gap} m${ahead ? " ▶" : ""}`;
      c.font = "bold 14px Segoe UI, sans-serif"; const tw = c.measureText(txt).width + 16, y = 150 + (ahead ? rt++ : lf++) * 30;
      c.fillStyle = "rgba(12,10,24,0.65)"; c.beginPath(); c.roundRect(ahead ? W - tw - 58 : 16, y, tw, 24, 6); c.fill();
      c.textAlign = "left"; c.textBaseline = "middle"; c.fillStyle = playerOf(o.id)?.color || "#fff"; c.fillText(txt, (ahead ? W - tw - 58 : 16) + 8, y + 12);
    }
    // Étincelles.
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x, p.y, 4, 4); }
    c.globalAlpha = 1;
    if (flash > 0) { c.fillStyle = `rgba(255,60,60,${flash * 0.3})`; c.fillRect(0, 0, W, HGT); flash = Math.max(0, flash - dt * 2); }
    // Le mur est proche : l'écran rougit.
    const gapW = mine?.alive ? view.d - wall : 9999;
    if (gapW < 400 && st.phase === "play") { c.fillStyle = `rgba(255,20,40,${(0.24 * (1 - Math.max(0, gapW) / 400)).toFixed(3)})`; c.fillRect(0, 0, W, HGT); }
    // En haut à gauche : ma distance, ma place, le mur.
    const panelH = mine ? 128 : 76;
    c.fillStyle = "rgba(12,10,24,0.74)"; c.beginPath(); c.roundRect(16, 14, 272, panelH, 12); c.fill();
    c.textBaseline = "top"; c.textAlign = "left";
    c.font = "900 50px Segoe UI, sans-serif"; c.fillStyle = "#ffd23f"; c.fillText(`${meters(view.d)} m`, 30, 22);
    if (mine) {
      const place = 1 + st.runners.filter((r) => r.alive && r.id !== me() && r.d > (mine.alive ? view.d : mine.d)).length, total = st.runners.filter((r) => r.alive).length;
      c.font = "bold 20px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(mine.alive ? `${place}${place === 1 ? "er" : "e"} sur ${total}` : "Éliminé", 30, 78);
      if (mine.alive) {
        const f = Math.max(0, Math.min(1, gapW / 1500));
        c.fillStyle = "rgba(255,255,255,0.2)"; c.fillRect(30, 108, 244, 14);
        c.fillStyle = f < 0.25 ? "#ff3b4e" : f < 0.5 ? "#ffb020" : "#3dff7a"; c.fillRect(30, 108, 244 * f, 14);
        c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(`🧱 Mur à ${Math.max(0, meters(gapW))} m`, 36, 116);
      }
    }
    // Le compte à rebours.
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, HGT / 2 - 90, W, 170);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "bold 64px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(left > 0 ? String(left) : "GO !", W / 2, HGT / 2 - 32);
      c.font = "22px Segoe UI, sans-serif"; c.fillText("Espace / ↑ = sauter (maintenir = plus haut) · ↓ = glisser", W / 2, HGT / 2 + 20);
      c.fillText("Un choc te ralentit. Le mur qui te suit t'élimine.", W / 2, HGT / 2 + 52);
    }
  }
})();
