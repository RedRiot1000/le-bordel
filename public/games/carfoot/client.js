// ===================================================================
//  CAR-FOOT — Client (s'affiche dans le hub Le Bordel)
//  - MA voiture est calculée ici tout de suite (prédiction, comme la
//    Patate), puis recalée sur le serveur.
//  - Les autres voitures et le ballon sont affichés "au présent"
//    (avancés selon leur vitesse), en glissant d'une position à l'autre.
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const B = window.CarFootBall;
  const K = P.K;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, bg = null;

  // Prédiction de MA voiture
  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0, a: 0 };
  const pressed = new Set();

  let particles = [];
  const seenFx = new Set();
  let shake = 0, goalKey = null;
  let prevPhase = null, playSeenAt = 0;   // pour le repère « TOI »

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const teamOf = (id) => playerOf(id)?.team;
  const teamColor = (tm) => st?.teamInfo?.[tm]?.color || "#888";
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const driving = () => st && ["play", "goal"].includes(st.phase);
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const TEMPLATE = `
    <div id="cf-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">⚽</span>
        <h1>CAR-FOOT</h1>
        <p class="tagline">Du foot. Avec des voitures. Et du nitro.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="cf-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🔵🔴 2 équipes tirées au hasard. Mets le ballon dans la cage d'en face !</li>
            <li><kbd>Z</kbd>/<kbd>↑</kbd> accélérer · <kbd>S</kbd>/<kbd>↓</kbd> freiner puis reculer · <kbd>Q</kbd><kbd>D</kbd>/<kbd>←</kbd><kbd>→</kbd> tourner</li>
            <li><kbd>Espace</kbd> frein à main (dérapage) · <kbd>Shift</kbd> <b>nitro</b></li>
            <li>💥 Plus tu vas vite, plus tu frappes fort. Tu peux entrer dans les cages.</li>
            <li>🏆 L'équipe qui gagne prend la 1re place (match nul = tout le monde ex æquo).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="cf-start" class="btn btn-primary btn-big">Coup d'envoi !</button>
        <p id="cf-hint" class="muted"></p>
        <p id="cf-error" class="error-msg"></p>
        <button id="cf-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="cf-play" class="hidden">
      <div class="cf-board">
        <div class="cf-team blue"><span id="cf-blue-names" class="cf-names"></span><b>🔵 Bleus</b></div>
        <div class="cf-score"><span id="cf-score-blue">0</span><span class="cf-sep">–</span><span id="cf-score-red">0</span></div>
        <div class="cf-team red"><b>Rouges 🔴</b><span id="cf-red-names" class="cf-names"></span></div>
      </div>
      <div class="cf-sub">
        <span id="cf-clock" class="cf-clock">3:00</span>
        <span id="cf-me" class="cf-me"></span>
        <div id="cf-nitro" class="pt-nitro" title="Nitro (Shift)"><span>NITRO</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="cf-canvas" width="${B.W}" height="${B.H}"></canvas>
        <div id="cf-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.carfoot = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; goalKey = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-forest");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("cf-canvas");
      g2d = canvas.getContext("2d");
      bg = drawField();
      $("cf-start").onclick = () => {
        $("cf-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("cf-error").textContent = r.error; });
      };
      $("cf-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play" && prevPhase !== "goal") playSeenAt = performance.now();
      if (st.phase === "kickoff" && prevPhase !== "kickoff") { pending = []; pred = prevPred = null; history.clear(); }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);

      if (st.phase === "setup") {
        $("cf-play").classList.add("hidden");
        $("cf-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("cf-setup").classList.add("hidden");
      $("cf-play").classList.remove("hidden");
      handleFx();
      reconcile();
      lastSnapRecv = performance.now();
      rebase();
      renderBoard();
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
  const KEYMAP = {
    KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN,
    KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT,
    Space: K.HB, ShiftLeft: K.NITRO, ShiftRight: K.NITRO,
  };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MA VOITURE (même principe que la Patate)
  // ===================================================================
  const ENV = B.env();
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / P.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f, a: prevPred.a + angDiff(pred.a, prevPred.a) * f };
  }
  function same(a, b) {
    return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(angDiff(a.a, b.a)) < 0.002 &&
           Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05 && Math.abs(a.w - b.w) < 0.05;
  }
  function reconcile() {
    const sc = st.cars.find((c) => c.id === me());
    if (!sc || !driving()) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = P.copyCar(sc);
    pending.forEach((p, i) => { P.simulate(pred, p.k, ENV, 1, othersAt((i + 1) * P.TICK)); history.set(p.s, P.copyCar(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; prevPred.a += angDiff(pred.a, oldPred.a); }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 150) { off.x += dx; off.y += dy; off.a += angDiff(before.a, after.a); }
    }
  }
  function driveLocal(dt) {
    if (!pred || !driving()) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = P.copyCar(pred);
      P.simulate(pred, k, ENV, 1, othersAt(pending.length * P.TICK));
      history.set(seq, P.copyCar(pred));
      acc -= P.TICK;
    }
  }

  // Les autres voitures et le ballon "au présent".
  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  const ballOff = { x: 0, y: 0 };
  let lastBallShown = null;
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.cars.filter((c) => c.id !== me()).map((c) => P.extrapolate(c, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / P.TICK) * P.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownCar(c) {
    const base = driving() ? P.extrapolate(c, aheadNow()) : c;
    const o = othersOff[c.id] || { x: 0, y: 0, a: 0 };
    const v = { ...base, x: base.x + o.x, y: base.y + o.y, a: base.a + o.a };
    lastShown[c.id] = v;
    return v;
  }
  function shownBall() {
    const base = st.phase === "play" ? B.extrapolate(st.ball, aheadNow()) : st.ball;
    const v = { ...base, x: base.x + ballOff.x, y: base.y + ballOff.y };
    lastBallShown = v;
    return v;
  }
  // Nouveau message du serveur : on garde ce qui est à l'écran et on efface l'écart en douceur.
  function rebase() {
    const t = aheadNow();
    for (const c of st.cars) {
      if (c.id === me() && pred) continue;
      const prev = lastShown[c.id];
      const base = driving() ? P.extrapolate(c, t) : c;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 120) othersOff[c.id] = { x: prev.x - base.x, y: prev.y - base.y, a: angDiff(prev.a, base.a) };
      else othersOff[c.id] = { x: 0, y: 0, a: 0 };
    }
    const bb = st.phase === "play" ? B.extrapolate(st.ball, t) : st.ball;
    if (lastBallShown && Math.hypot(lastBallShown.x - bb.x, lastBallShown.y - bb.y) < 100) { ballOff.x = lastBallShown.x - bb.x; ballOff.y = lastBallShown.y - bb.y; }
    else { ballOff.x = ballOff.y = 0; }
  }

  // ===================================================================
  //  EFFETS : chocs, buts
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = Math.min(24, 5 + f.s / 30);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * f.s * 0.7;
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.3, max: 0.6, col: "#ffd27a" });
      }
    }
    if (seenFx.size > 300) seenFx.clear();
    // Un but : feu d'artifice de la couleur de l'équipe dans la cage.
    const gk = st.phase === "goal" && st.lastGoal ? st.lastGoal.n : null;
    if (gk && gk !== goalKey) {
      const left = st.lastGoal.team === "red";   // les Rouges marquent à gauche
      const x = left ? B.GD / 2 : B.W - B.GD / 2, y = B.H / 2;
      for (let i = 0; i < 120; i++) {
        const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 520;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 1.2, max: 1.8, col: i % 3 ? teamColor(st.lastGoal.team) : "#fff" });
      }
      shake = 14;
    }
    goalKey = gk;
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("cf-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Durée du match</label><div class="cat-chips">
        ${[2, 3, 5].map((d) => `<button class="cat-chip ${s.duration === d ? "on" : ""}" data-d="${d}" ${host ? "" : "disabled"}>${d} min</button>`).join("")}
      </div></div>
      <div class="setting"><label>But en or si égalité (prolongation)</label><div class="val">
        <label class="switch"><input type="checkbox" id="cf-golden" ${s.golden ? "checked" : ""} ${host ? "" : "disabled"} /><span class="track"></span></label>
      </div></div>
      <p class="settings-note">Les équipes sont tirées au hasard à chaque match.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) {
      panel.querySelectorAll("[data-d]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { duration: Number(b.dataset.d) } }); });
      $("cf-golden").onchange = (e) => api.action("settings", { settings: { golden: e.target.checked } });
    }
    const n = st.players.filter((p) => p.connected).length;
    $("cf-start").style.display = host ? "" : "none";
    $("cf-start").disabled = n < 2;
    $("cf-finish-setup").classList.toggle("hidden", !host);
    $("cf-hint").textContent = !host ? "En attente que l'hôte lance le match…" : n < 2 ? "Il faut au moins 2 joueurs." :
      `${n} joueurs → ${Math.ceil(n / 2)} contre ${Math.floor(n / 2)}`;
  }

  // ===================================================================
  //  TABLEAU DE SCORE
  // ===================================================================
  function renderBoard() {
    $("cf-score-blue").textContent = st.score.blue;
    $("cf-score-red").textContent = st.score.red;
    const names = (tm) => st.teams[tm].map((id) => `<span class="${id === me() ? "me" : ""}">${esc(pseudoOf(id))}</span>`).join("");
    const nb = names("blue"), nr = names("red");
    if ($("cf-blue-names").innerHTML !== nb) $("cf-blue-names").innerHTML = nb;
    if ($("cf-red-names").innerHTML !== nr) $("cf-red-names").innerHTML = nr;
    const tm = teamOf(me());
    $("cf-me").innerHTML = tm ? `Tu joues chez les <b style="color:${teamColor(tm)}">${st.teamInfo[tm].name}</b> ${tm === "blue" ? "→ attaque à droite ➡️" : "⬅️ attaque à gauche"}` : "👀 Tu regardes ce match";
    $("cf-nitro").classList.toggle("hidden", !tm || st.phase === "over");
  }

  function renderOver() {
    const ov = $("cf-overlay");
    const isOver = st.phase === "over" && !!st.result;
    ov.parentElement.classList.toggle("over", isOver);
    if (!isOver) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const key = JSON.stringify([st.score, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const res = st.result;
    const banner = res === "draw" ? "🤝 Match nul !" : `🏆 Victoire des ${st.teamInfo[res].name} !`;
    const goals = st.goals.map((gl) => `<li><span style="color:${teamColor(gl.team)}">⚽</span>
      ${gl.by ? esc(pseudoOf(gl.by)) : "?"}${gl.own ? " <span class='muted'>(contre son camp 😅)</span>" : ""}
      <span class="muted">${gl.overtime ? "but en or" : gl.min + "e min"}</span></li>`).join("") || '<li class="muted">Aucun but… 😴</li>';
    ov.innerHTML = `
      <div class="pt-over card cf-over">
        <h2 class="go-banner">${banner}</h2>
        <div class="cf-final"><span style="color:${teamColor("blue")}">🔵 ${st.score.blue}</span> – <span style="color:${teamColor("red")}">${st.score.red} 🔴</span></div>
        <ul class="cf-goals">${goals}</ul>
        ${st.playlist?.final
          ? (finishEndLocal = Date.now() + st.finishLeft, `<p class="go-final">Classement dans <b id="cf-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
             ${host ? '<div class="go-actions"><button id="cf-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`)
          : host ? `<div class="go-actions">
              <button id="cf-again" class="btn btn-primary">🔁 Revanche (nouvelles équipes)</button>
              <button id="cf-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="cf-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="cf-over-error" class="error-msg"></p>`
          : '<p class="muted">En attente de l\'hôte…</p>'}
      </div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("cf-again") && ($("cf-again").onclick = () => api.action("start").then((r) => { if (r.error) $("cf-over-error").textContent = r.error; }));
    $("cf-to-setup") && ($("cf-to-setup").onclick = () => api.action("setup"));
    $("cf-finish") && ($("cf-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Car-foot ? Le résultat du match donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  LE TERRAIN (dessiné une fois)
  // ===================================================================
  function drawField() {
    const c0 = document.createElement("canvas");
    c0.width = B.W; c0.height = B.H;
    const c = c0.getContext("2d");
    c.fillStyle = "#1d5e2c"; c.fillRect(0, 0, B.W, B.H);
    // Bandes de pelouse.
    for (let i = 0; i < 12; i++) {
      c.fillStyle = i % 2 ? "#2f8a3e" : "#2a7d38";
      c.fillRect(B.GD + (B.FW / 12) * i, 0, B.FW / 12 + 1, B.H);
    }
    // Cages (filet + couleur de l'équipe qui défend).
    const net = (x, col) => {
      c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(x, B.goalTop, B.GD, B.GH);
      c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 1;
      for (let i = 0; i <= B.GD; i += 12) { c.beginPath(); c.moveTo(x + i, B.goalTop); c.lineTo(x + i, B.goalBot); c.stroke(); }
      for (let j = B.goalTop; j <= B.goalBot; j += 12) { c.beginPath(); c.moveTo(x, j); c.lineTo(x + B.GD, j); c.stroke(); }
      c.strokeStyle = col; c.lineWidth = 6; c.strokeRect(x + 3, B.goalTop, B.GD - 6, B.GH);
    };
    net(0, "#3a8bff");
    net(B.GD + B.FW, "#ff4d5a");
    // Murs à côté des cages.
    for (const o of B.obstacles) { c.fillStyle = "#14361c"; c.fillRect(o.x, o.y, o.w, o.h); }
    // Lignes blanches.
    c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 4;
    c.strokeRect(B.GD + 2, 2, B.FW - 4, B.H - 4);
    c.beginPath(); c.moveTo(B.W / 2, 0); c.lineTo(B.W / 2, B.H); c.stroke();
    c.beginPath(); c.arc(B.W / 2, B.H / 2, 110, 0, Math.PI * 2); c.stroke();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(B.W / 2, B.H / 2, 6, 0, Math.PI * 2); c.fill();
    const box = (x, w) => c.strokeRect(x, B.H / 2 - 220, w, 440);
    box(B.GD, 200); box(B.GD + B.FW - 200, 200);
    // Couleur des camps (léger).
    c.fillStyle = "rgba(58,139,255,0.07)"; c.fillRect(B.GD, 0, B.FW / 2, B.H);
    c.fillStyle = "rgba(255,77,90,0.07)"; c.fillRect(B.W / 2, 0, B.FW / 2, B.H);
    return c0;
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("cf-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup") return;
    driveLocal(dt);
    const decay = Math.pow(0.82, dt * 60);
    off.x *= decay; off.y *= decay; off.a *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; o.a *= decay; }
    ballOff.x *= decay; ballOff.y *= decay;
    // Le chrono (il ne tourne que pendant le jeu).
    const clock = $("cf-clock");
    if (clock) {
      clock.textContent = st.overtime ? `⏱️ BUT EN OR · ${mmss(st.overtimeLeft)}` : mmss(st.clockLeft);
      clock.classList.toggle("urgent", st.overtime || st.clockLeft < 10000);
    }
    draw(ts, dt);
  }

  function draw(ts, dt) {
    const c = g2d;
    c.save();
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.86, dt * 60); }
    else shake = 0;
    c.drawImage(bg, 0, 0);

    const view = st.cars.map((car) => {
      if (car.id === me() && pred) {
        const o = ownView();
        return { ...o, id: car.id, team: car.team, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a };
      }
      return shownCar(car);
    });

    // Le ballon (avec son ombre), sauf pendant la célébration d'un but (il est dans le filet).
    const b = shownBall();
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.arc(b.x + 5, b.y + 7, B.R, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff"; c.beginPath(); c.arc(b.x, b.y, B.R, 0, Math.PI * 2); c.fill();
    c.lineWidth = 2; c.strokeStyle = "#222"; c.stroke();
    // Taches du ballon (qui tournent quand il roule).
    const spin = (b.x + b.y) / B.R / 2;
    c.fillStyle = "#222";
    for (let i = 0; i < 5; i++) {
      const a = spin + (i * Math.PI * 2) / 5;
      c.beginPath(); c.arc(b.x + Math.cos(a) * B.R * 0.6, b.y + Math.sin(a) * B.R * 0.6, 4.5, 0, Math.PI * 2); c.fill();
    }
    c.beginPath(); c.arc(b.x, b.y, 5, 0, Math.PI * 2); c.fill();

    // Voitures : couleur de l'équipe, couleur du joueur sur le toit.
    for (const v of view) {
      c.save();
      c.translate(v.x, v.y); c.rotate(v.a);
      window.VehicleArt.paint(c, "sport", teamColor(v.team), playerOf(v.id)?.color, v.st || 0, v.id === me(), v.boost);
      c.restore();
      c.font = "bold 13px Segoe UI, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.75)";
      c.strokeText(pseudoOf(v.id), v.x, v.y - 30);
      c.fillStyle = "#fff"; c.fillText(pseudoOf(v.id), v.x, v.y - 30);
    }

    drawParticles(dt);

    // Remise en jeu / but.
    if (st.phase === "kickoff") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", st.goals.length ? "Remise en jeu" : "Coup d'envoi !");
    } else if (st.phase === "goal" && st.lastGoal) {
      const gl = st.lastGoal;
      band(`⚽ BUT des ${st.teamInfo[gl.team].name} !`, gl.by ? (gl.own ? `${pseudoOf(gl.by)} marque contre son camp 😅` : `Buteur : ${pseudoOf(gl.by)}`) : "", teamColor(gl.team));
    }

    // Repère « TOI » (remise en jeu + début de jeu).
    const mv = view.find((v) => v.id === me());
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, teamColor(mv.team), window.VehicleArt.markAlpha(st.phase === "kickoff" ? "countdown" : st.phase, playSeenAt),
      Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    if (mv && st.phase !== "over") window.VehicleArt.gauge(c, mv.x, mv.y, Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)), (pred || mv).nitro, (pred || mv).boost);
    c.restore();

    // Jauge de nitro.
    const mine = pred || st.cars.find((x) => x.id === me());
    const bar = document.querySelector("#cf-nitro i");
    if (bar && mine) { bar.style.width = Math.round(mine.nitro * 100) + "%"; bar.parentElement.classList.toggle("on", !!mine.boost); }
  }

  // Bandeau au milieu (compte à rebours, but).
  function band(big, small, color) {
    const c = g2d;
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, B.H / 2 - 80, B.W, 160);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "bold 66px Segoe UI, sans-serif";
    c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,0.6)"; c.strokeText(big, B.W / 2, B.H / 2 - 16);
    c.fillStyle = color || "#fff"; c.fillText(big, B.W / 2, B.H / 2 - 16);
    c.font = "24px Segoe UI, sans-serif"; c.fillStyle = "#fff";
    c.fillText(small, B.W / 2, B.H / 2 + 46);
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    const c = g2d;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
      c.globalAlpha = p.life / p.max;
      c.fillStyle = p.col;
      c.fillRect(p.x - 2.5, p.y - 2.5, 5, 5);
    }
    c.globalAlpha = 1;
  }
})();
