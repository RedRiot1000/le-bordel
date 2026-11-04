// ===================================================================
//  PARKOUR — Client (s'affiche dans le hub Le Bordel)
//  - Une ligne par joueur, le même parcours (refait ici à partir de la seed).
//  - MON coureur est calculé ici tout de suite (prédiction), puis recalé :
//    le serveur fait exactement les mêmes calculs, touche par touche.
// ===================================================================

(() => {
  const P = window.Parkour;
  const K = P.K;
  const W = 1280, HGT = 800;
  const RUN_X = 230;          // où le coureur est dessiné dans sa ligne
  const BASE = 235;           // hauteur « normale » d'une ligne : le saut le plus haut (tête comprise) y tient

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
  const shown = {};           // id -> position affichée (lissée)
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
        <p class="tagline">Chacun sa ligne, le même parcours. Le meilleur réflexe va le plus loin.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="pk-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏃 Tu cours tout seul, de plus en plus vite. Tout le monde a <b>le même parcours</b>, chacun sur sa ligne.</li>
            <li>⬆️ <kbd>Espace</kbd> / <kbd>↑</kbd> / <kbd>Z</kbd> : <b>sauter</b> (garde appuyé pour sauter plus haut) — haies, caisses, oiseaux bas, <b>trous</b>.</li>
            <li>⬇️ <kbd>↓</kbd> / <kbd>S</kbd> : <b>glisser</b> / s'accroupir — barres et oiseaux hauts. En l'air : retomber plus vite.</li>
            <li>💥 Un obstacle touché ou un trou = <b>éliminé</b>. Le plus loin gagne la manche (10, 7, 5, 3, 2, 1 points).</li>
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
      if (st.seed !== courseSeed) { courseSeed = st.seed; course = P.course(st.seed); }
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
      const lane = st.lanes.indexOf(f.lane);
      if (lane < 0) continue;
      const L = laneBox(lane);
      for (let i = 0; i < 26; i++) {
        const a = -Math.random() * Math.PI, v = 60 + Math.random() * 260;
        particles.push({ x: RUN_X, y: L.ground - 30 * L.s, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, max: 0.8, col: f.kind === "trou" ? "#8a7a6a" : i % 2 ? "#ffcf5c" : "#fff" });
      }
      if (f.lane === me()) flash = 1;
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
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"], [7, "7"]])}</div>
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
    const txt = !mine ? "👀 Tu regardes" : st.lastStand === me() ? "🏆 Dernier en course : tu gagnes la manche !" : mine.alive ? "🏃 Cours !" : `💥 Éliminé à ${meters(mine.d)} m`;
    if ($("pk-me").textContent !== txt) $("pk-me").textContent = txt;
    const n = st.runners.filter((r) => r.alive).length;
    $("pk-alive").textContent = st.lastStand ? `🏆 ${pseudoOf(st.lastStand)} est le dernier en course !` : `🏃 ${n} encore en course`;
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
    const banner = `🏆 ${esc(pseudoOf(lr.order[0]))} va le plus loin : ${lr.dist[lr.order[0]]} m !`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${lr.dist[id]} m${lr.cause[id] === "trou" ? " · tombé dans un trou" : lr.cause[id] === "obstacle" ? " · obstacle" : ""}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
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
  // La boîte d'une ligne : y du haut, hauteur, échelle, y du sol.
  function laneBox(i) {
    const n = Math.max(1, st.lanes.length);
    const h = HGT / n, s = Math.min(1.35, h / BASE);
    return { y: i * h, h, s, ground: i * h + h - 18 * s };
  }

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
  function drawBackdrop(c, L, d, mineLane) {
    const gr = c.createLinearGradient(0, L.y, 0, L.ground);
    gr.addColorStop(0, "#4b6cb7"); gr.addColorStop(0.65, "#9d86c9"); gr.addColorStop(1, "#f3a96b");
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
    const K = P.KINDS[o.kind], s = L.s;
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
  function drawRunner(c, L, r, color, ts, alpha) {
    const s = L.s, x = RUN_X, foot = L.ground - r.y * s;
    c.save(); c.globalAlpha = alpha;
    // Ombre au sol.
    if (r.y >= 0) { c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.ellipse(x, L.ground + 2, 14 * s * Math.max(0.4, 1 - r.y / 160), 3 * s, 0, 0, Math.PI * 2); c.fill(); }
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
    const X = (px) => x + (px - x) * s;   // les x sont donnés « en monde » autour de RUN_X
    const pass = (col, extra) => {
      c.strokeStyle = col; c.fillStyle = col; c.lineCap = "round";
      for (const [x0, y0, x1, y1, w] of lines) { c.lineWidth = (w + extra) * s; c.beginPath(); c.moveTo(X(x0), foot - y0 * s); c.lineTo(X(x1), foot - y1 * s); c.stroke(); }
      c.beginPath(); c.arc(X(head[0]), foot - head[1] * s, (head[2] + extra / 2) * s, 0, Math.PI * 2); c.fill();
    };
    pass("rgba(255,255,255,0.55)", 7);   // halo clair
    pass("#0b0914", 3.5);                 // contour noir
    pass(color, 0);                       // la couleur du joueur
    c.restore();
  }

  function draw(ts, dt) {
    const c = g2d;
    c.fillStyle = "#1b1830"; c.fillRect(0, 0, W, HGT);
    const lanes = st.lanes;
    lanes.forEach((id, i) => {
      const L = laneBox(i);
      const sr = runnerOf(id);
      if (!sr) return;
      const isMe = id === me();
      // Position affichée : la mienne prédite, les autres lissées.
      let r;
      if (isMe && pred) r = myView();
      else {
        const sh = shown[id] || (shown[id] = { ...sr });
        const k = Math.min(1, dt * 14);
        sh.d += (sr.d - sh.d) * k; sh.y += (sr.y - sh.y) * k;
        if (Math.abs(sr.d - sh.d) > 300) { sh.d = sr.d; sh.y = sr.y; }
        r = { ...sr, d: sh.d, y: sh.y };
      }
      c.save();
      c.beginPath(); c.rect(0, L.y, W, L.h); c.clip();
      drawBackdrop(c, L, r.d, isMe);
      // Le sol (avec les trous) : on dessine ce qui est entre la distance du coureur - RUN_X et + l'écran.
      const d0 = r.d - RUN_X / L.s, d1 = d0 + W / L.s;
      const near = P.near(course, d0, d1);
      const toX = (x) => (x - d0) * L.s;
      c.fillStyle = "#6b5b8e"; c.fillRect(0, L.ground, W, L.y + L.h - L.ground);
      c.fillStyle = "#c9bff0"; c.fillRect(0, L.ground, W, 4 * L.s);
      // Pointillés au sol (pour sentir la vitesse).
      c.fillStyle = "rgba(255,255,255,0.15)";
      for (let x = -((d0 * L.s) % 40); x < W; x += 40) c.fillRect(x, L.ground + 8 * L.s, 16, 3 * L.s);
      for (const gp of near.gaps) {
        const gx = toX(gp.x), gw = gp.w * L.s;
        c.fillStyle = "#050308"; c.fillRect(gx, L.ground, gw, L.y + L.h - L.ground);
        // Bords du trou : rayures rouge et blanc + petit cône.
        for (const ex of [gx - 6 * L.s, gx + gw]) {
          for (let k = 0; k < 3; k++) { c.fillStyle = k % 2 ? "#fff" : "#e0302f"; c.fillRect(ex, L.ground + k * 4 * L.s, 6 * L.s, 4 * L.s); }
        }
        c.fillStyle = "#ff7a1a"; for (const ex of [gx - 4 * L.s, gx + gw + 4 * L.s]) { c.beginPath(); c.moveTo(ex - 7 * L.s, L.ground); c.lineTo(ex, L.ground - 18 * L.s); c.lineTo(ex + 7 * L.s, L.ground); c.fill(); }
      }
      for (const o of near.obs) drawObstacle(c, L, o, toX(o.x), ts);
      // Le départ.
      if (d0 < P.START) { c.fillStyle = "rgba(255,255,255,0.6)"; const sx = toX(0); for (let k = 0; k < 6; k++) c.fillRect(sx + (k % 2) * 6, L.ground - (k + 1) * 8 * L.s, 6, 8 * L.s); }
      const col = playerOf(id)?.color || "#fff";
      drawRunner(c, L, r, col, ts, r.alive ? 1 : 0.5);
      // Nom + distance.
      c.textBaseline = "middle"; c.textAlign = "left";
      c.font = `bold ${Math.round(Math.max(12, 18 * L.s))}px Segoe UI, sans-serif`;
      c.fillStyle = isMe ? "#fff" : "rgba(255,255,255,0.8)";
      c.fillText(`${isMe ? "⭐ " : ""}${pseudoOf(id)}`, 12, L.y + 16 * Math.max(0.8, L.s));
      c.textAlign = "right"; c.fillStyle = "#ffd23f";
      c.fillText(`${meters(r.d)} m`, W - 12, L.y + 16 * Math.max(0.8, L.s));
      if (!r.alive) {
        c.fillStyle = "rgba(10,8,20,0.55)"; c.fillRect(0, L.y, W, L.h);
        c.textAlign = "center"; c.fillStyle = "#ff7b7b"; c.font = `bold ${Math.round(Math.max(14, 26 * L.s))}px Segoe UI, sans-serif`;
        c.fillText(`💥 ${meters(r.d)} m`, W / 2, L.y + L.h / 2);
      }
      if (!isMe && r.alive) { c.fillStyle = "rgba(15,12,30,0.38)"; c.fillRect(0, L.y, W, L.h); }
      if (isMe) {
        c.strokeStyle = "#ffd23f"; c.lineWidth = 8; c.strokeRect(4, L.y + 4, W - 8, L.h - 8);
        // Étiquette « TOI » à gauche.
        const tw = 70, th = Math.max(22, 30 * L.s);
        c.fillStyle = "#ffd23f"; c.fillRect(8, L.y + L.h / 2 - th / 2, tw, th);
        c.fillStyle = "#1b1830"; c.textAlign = "center"; c.font = `900 ${Math.round(th * 0.62)}px Segoe UI, sans-serif`;
        c.fillText("TOI", 8 + tw / 2, L.y + L.h / 2);
        // Flèche dorée au-dessus de mon bonhomme.
        if (r.alive) {
          const hy = L.ground - (r.y + P.height(r)) * L.s - 10 * L.s, bob = Math.sin(ts / 160) * 3;
          c.fillStyle = "#ffd23f"; c.beginPath(); c.moveTo(RUN_X - 9 * L.s, hy - 14 * L.s + bob); c.lineTo(RUN_X + 9 * L.s, hy - 14 * L.s + bob); c.lineTo(RUN_X, hy + bob); c.closePath(); c.fill();
        }
      }
      c.restore();
      c.fillStyle = "#0e0c1a"; c.fillRect(0, L.y + L.h - 2, W, 2);
    });
    // Étincelles (chutes).
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 600 * dt; c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x, p.y, 4, 4); }
    c.globalAlpha = 1;
    if (flash > 0) { c.fillStyle = `rgba(255,60,60,${flash * 0.3})`; c.fillRect(0, 0, W, HGT); flash = Math.max(0, flash - dt * 2); }
    // Le compte à rebours.
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, HGT / 2 - 70, W, 140);
      c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "bold 64px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(left > 0 ? String(left) : "GO !", W / 2, HGT / 2 - 12);
      c.font = "22px Segoe UI, sans-serif"; c.fillText("Espace / ↑ = sauter · ↓ = glisser — ta ligne est encadrée en jaune", W / 2, HGT / 2 + 40);
    }
  }
})();
