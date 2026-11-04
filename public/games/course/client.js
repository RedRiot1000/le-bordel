// ===================================================================
//  GRAND PRIX — Client (s'affiche dans le hub Le Bordel)
//  - Le circuit est refait ici à partir de sa seed (track.js).
//  - MA voiture est calculée ici tout de suite (prédiction), puis recalée
//    sur le serveur ; les autres sont affichées « au présent ».
//  - Caméra qui suit ma voiture, mini-carte, position, tours, nitro.
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const T = window.CourseTrack;
  const K = P.K;
  const RESET = 128;
  const W = 1280, HGT = 800;
  const ELIM_EVERY = 30000;   // (le même que games/course/server.js)

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, elimEndLocal = 0, endEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let track = null, trackSeed = null, ENV = null, path = null, mini = null, rails = [];

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0, a: 0 };
  const pressed = new Set();
  const cam = { x: 0, y: 0, z: 0.85 };

  let particles = [];
  const seenFx = new Set();
  const coneSeen = {};        // cône renversé : quand je l'ai vu tomber
  let shake = 0, prevPhase = null, playSeenAt = 0, goFlash = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const carOf = (id) => st?.cars.find((c) => c.id === id);
  const colorOf = (id) => playerOf(id)?.color || "#ccc";
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const driving = () => st?.phase === "play";
  const solid = (c) => c.alive && !c.finished;
  const kmh = (c) => Math.round(Math.hypot(c.vx, c.vy) * 0.45);
  const place = (i) => (i === 0 ? "1er" : i + 1 + "e");
  const mmss = (ms) => { const s = ms / 1000; return Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0"); };

  const TEMPLATE = `
    <div id="gp-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🏁</span>
        <h1>GRAND PRIX</h1>
        <p class="tagline">Trois supersportives, un circuit jamais vu. Que le meilleur pilote gagne !</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="gp-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏎️ Avant chaque course, choisis ta voiture : <b>⚡ ÉCLAIR</b> (vitesse), <b>🐍 VIPÈRE</b> (agile), <b>🦏 TITAN</b> (lourde).</li>
            <li>🏁 <b>Course</b> : X tours, l'ordre d'arrivée donne les points. Après le 1er, il reste 20 s pour finir.</li>
            <li>💥 <b>Élimination</b> : toutes les <b>30 s</b>, la voiture en <b>dernière place explose</b> ! Le dernier survivant gagne.</li>
            <li>🔥 <b>Nitro</b> : se recharge en <b>dérapant</b> (et un peu tout seul). Plus tu es derrière, plus elle remonte vite.</li>
            <li>⌨️ <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ou <kbd>ZQSD</kbd> · <kbd>Espace</kbd> frein à main (dérapage) · <kbd>Maj</kbd> nitro · <kbd>R</kbd> revenir sur la piste.</li>
            <li>🚧 Herbe = ça ralentit. On peut <b>pousser</b> les autres dehors (TITAN pousse fort, VIPÈRE s'envole).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="gp-start" class="btn btn-primary btn-big">🏁 Lancer le Grand Prix</button>
        <p id="gp-hint" class="muted"></p>
        <p id="gp-error" class="error-msg"></p>
        <button id="gp-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="gp-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="gp-round"></span>
        <span id="gp-me" class="ch-role"></span>
        <span id="gp-mode" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="gp-canvas" width="${W}" height="${HGT}"></canvas>
        <div id="gp-pick" class="gp-pick hidden"></div>
        <div id="gp-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">↑↓←→ / ZQSD = conduire · Espace = frein à main · Maj = nitro · R = revenir sur la piste</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.course = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; trackSeed = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("gp-canvas");
      g2d = canvas.getContext("2d");
      $("gp-start").onclick = () => {
        $("gp-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("gp-error").textContent = r.error; });
      };
      $("gp-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") { playSeenAt = performance.now(); goFlash = 1; }
      if (st.phase !== prevPhase && (st.phase === "countdown" || st.phase === "pick")) { pending = []; pred = prevPred = null; history.clear(); }
      if (st.phase === "pick" && prevPhase !== "pick") $("gp-pick").dataset.key = "";
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      elimEndLocal = Date.now() + (st.elimLeft || 0);
      endEndLocal = Date.now() + (st.endLeft || 0);
      if (st.phase === "setup") {
        $("gp-play").classList.add("hidden");
        $("gp-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("gp-setup").classList.add("hidden");
      $("gp-play").classList.remove("hidden");
      if (st.seed !== trackSeed) newTrack();
      handleFx();
      reconcile();
      rebase();
      renderHud();
      renderPick();
      renderOver();
    },

    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
      track = path = mini = null;
    },
  };

  function newTrack() {
    trackSeed = st.seed;
    track = T.build(st.seed);
    ENV = T.env(track);
    path = new Path2D();
    track.pts.forEach((p, i) => (i ? path.lineTo(p.x, p.y) : path.moveTo(p.x, p.y)));
    path.closePath();
    for (const k in coneSeen) delete coneSeen[k];
    rails = track.rails.map((line) => { const p = new Path2D(); line.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y))); p.closePath(); return p; });
    // Mini-carte (dessinée une fois).
    mini = document.createElement("canvas");
    const mw = 230, mh = 170, s = Math.min((mw - 16) / track.w, (mh - 16) / track.h);
    mini.width = mw; mini.height = mh; mini.s = s; mini.ox = (mw - track.w * s) / 2; mini.oy = (mh - track.h * s) / 2;
    const m = mini.getContext("2d");
    m.fillStyle = "rgba(10,20,15,0.72)"; m.beginPath(); m.roundRect(0, 0, mw, mh, 12); m.fill();
    m.save(); m.translate(mini.ox, mini.oy); m.scale(s, s);
    m.strokeStyle = "#e8e8e8"; m.lineWidth = T.WIDTH * 0.9; m.lineJoin = "round"; m.stroke(path);
    m.strokeStyle = "#555"; m.lineWidth = T.WIDTH * 0.55; m.stroke(path);
    const p0 = track.pts[0], n0 = T.normal(track, 0);
    m.strokeStyle = "#fff"; m.lineWidth = 60; m.beginPath(); m.moveTo(p0.x - n0.x * 120, p0.y - n0.y * 120); m.lineTo(p0.x + n0.x * 120, p0.y + n0.y * 120); m.stroke();
    m.restore();
  }

  // ===================================================================
  //  CLAVIER
  // ===================================================================
  const KEYMAP = {
    KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN,
    KeyA: K.LEFT, KeyQ: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT,
    KeyZ: K.UP, Space: K.HB, ShiftLeft: K.NITRO, ShiftRight: K.NITRO, KeyR: RESET,
  };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; return k; }

  // ===================================================================
  //  PRÉDICTION DE MA VOITURE (même principe que la Patate / Avis de recherche)
  // ===================================================================
  const envAt = (car) => { ENV.obstacles = T.nearObs(track, car.x, car.y); return ENV; };
  function step(car, k, others) {
    const dt = P.TICK / P.SUB;
    for (let i = 0; i < P.SUB; i++) {
      P.drive(car, k, dt, envAt(car), 1);
      P.collideStatic(car, ENV);
      if (others) for (const o of others) P.collideCars(car, o, true, 6);
    }
  }
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / P.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f, a: prevPred.a + angDiff(pred.a, prevPred.a) * f };
  }
  function same(a, b) {
    return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(angDiff(a.a, b.a)) < 0.002 &&
           Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05 && Math.abs(a.w - b.w) < 0.05;
  }
  const canDrive = () => { const sc = carOf(me()); return driving() && sc && solid(sc) && track; };
  function reconcile() {
    const sc = carOf(me());
    if (!canDrive()) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = P.copyCar(sc);
    pending.forEach((p, i) => { step(pred, p.k, othersAt((i + 1) * P.TICK)); history.set(p.s, P.copyCar(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; prevPred.a += angDiff(pred.a, oldPred.a); }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 150) { off.x += dx; off.y += dy; off.a += angDiff(before.a, after.a); }
    }
  }
  function driveLocal(dt) {
    if (!canDrive()) { acc = 0; return; }
    if (!pred) pred = P.copyCar(carOf(me()));
    acc = Math.min(acc + dt, 0.2);
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = P.copyCar(pred);
      step(pred, k, othersAt(pending.length * P.TICK));
      history.set(seq, P.copyCar(pred));
      acc -= P.TICK;
    }
  }

  // Les autres voitures (vues « au présent »).
  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.cars.filter((c) => c.id !== me() && solid(c) && (!pred || (Math.abs(c.x - pred.x) < 300 && Math.abs(c.y - pred.y) < 300))).map((c) => P.extrapolate(c, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / P.TICK) * P.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownCar(c) {
    const base = driving() && solid(c) ? P.extrapolate(c, aheadNow()) : c;
    const o = othersOff[c.id] || { x: 0, y: 0, a: 0 };
    const v = { ...base, x: base.x + o.x, y: base.y + o.y, a: base.a + o.a };
    lastShown[c.id] = v;
    return v;
  }
  function rebase() {
    lastSnapRecv = performance.now();
    const t = aheadNow();
    for (const c of st.cars) {
      if (c.id === me() && pred) continue;
      const prev = lastShown[c.id];
      const base = driving() && solid(c) ? P.extrapolate(c, t) : c;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 120) othersOff[c.id] = { x: prev.x - base.x, y: prev.y - base.y, a: angDiff(prev.a, base.a) };
      else othersOff[c.id] = { x: 0, y: 0, a: 0 };
    }
  }

  // ===================================================================
  //  EFFETS : chocs, explosions, arrivées
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (f.kind === "boum") {
        for (let i = 0; i < 90; i++) {
          const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 420;
          particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 1, max: 1.5, col: ["#ff3b1f", "#ffb020", "#ffe14d", "#555"][i % 4], r: 4 + Math.random() * 6 });
        }
        const mc = pred || carOf(me());
        if (mc && Math.hypot(mc.x - f.x, mc.y - f.y) < 700) shake = 14;
      } else if (f.kind === "arrivee") {
        for (let i = 0; i < 50; i++) {
          const a = Math.random() * Math.PI * 2, v = 80 + Math.random() * 260;
          particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.8, max: 1.4, col: ["#fff", "#111", "#ffd23f", "#3bd6ff"][i % 4], r: 3 });
        }
      } else if (f.kind === "retour") {
        for (let i = 0; i < 24; i++) {
          const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 120;
          particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5, max: 0.5, col: "#9fe8ff", r: 3 });
        }
      } else {
        const n = Math.min(24, 5 + f.s / 30);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * f.s * 0.7;
          particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.3, max: 0.6, col: "#ffd27a", r: 2.5 });
        }
      }
    }
    if (seenFx.size > 400) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("gp-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" data-num="${typeof v === "number"}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Mode</label>${chips("mode", [["aleatoire", "🎲 Aléatoire"], ["course", "🏁 Course"], ["elimination", "💥 Élimination"]])}</div>
      <div class="setting-block"><label>Tours (mode course)</label>${chips("laps", [[2, "2"], [3, "3"], [5, "5"]])}</div>
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"]])}</div>
      <p class="settings-note">Un nouveau circuit à chaque manche. En aléatoire, le mode est tiré au sort à chaque manche.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: b.dataset.num === "true" ? Number(b.dataset.v) : b.dataset.v } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("gp-start").style.display = host ? "" : "none";
    $("gp-start").disabled = n < 2;
    $("gp-finish-setup").classList.toggle("hidden", !host);
    $("gp-hint").textContent = !host ? "En attente que l'hôte lance la course…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} pilotes`;
  }

  // ===================================================================
  //  BANDEAU
  // ===================================================================
  const modeLabel = () => (st.mode === "elimination" ? "💥 Élimination" : `🏁 Course · ${st.laps} tours`);
  function renderHud() {
    $("gp-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    $("gp-mode").textContent = modeLabel();
    const mine = carOf(me());
    let txt = "👀 Tu regardes";
    if (mine) {
      const i = st.order.indexOf(me());
      if (st.phase === "pick") txt = "🏎️ Choisis ta voiture !";
      else if (st.phase === "countdown") txt = "🚦 Prêt…";
      else if (!mine.alive) txt = mine.cause === "explosé" ? "💥 Tu as explosé ! Tu regardes la suite." : "👀 Tu regardes";
      else if (mine.finished) txt = `🏁 Arrivé ${place(i)} !`;
      else txt = `🏎️ ${place(i)} / ${st.cars.length}`;
    }
    if ($("gp-me").textContent !== txt) $("gp-me").textContent = txt;
  }

  // ===================================================================
  //  CHOIX DE LA VOITURE
  // ===================================================================
  function stars(n) { return "★".repeat(n) + "☆".repeat(5 - n); }
  function renderPick() {
    const box = $("gp-pick");
    if (st.phase !== "pick") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    const mine = st.picks[me()];
    const key = JSON.stringify([st.round, st.picks]);
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      const who = (t) => Object.entries(st.picks).filter(([, v]) => v === t).map(([id]) => api.avatar(playerOf(id))).join("");
      box.innerHTML = `
        <div class="gp-pick-in card">
          <h2>${st.mode === "elimination" ? "💥 ÉLIMINATION : toutes les 30 s, le dernier explose !" : `🏁 COURSE : ${st.laps} tours`}</h2>
          <p class="muted">Choisis ta voiture — départ dans <b id="gp-pick-sec"></b> s</p>
          <div class="gp-cars">
            ${P.RACE_TYPES.map((t) => {
              const V = P.VEHICLES[t];
              return `<button class="gp-car ${mine === t ? "on" : ""}" data-t="${t}">
                <canvas class="gp-prev" data-t="${t}" width="220" height="110"></canvas>
                <b class="gp-name">${V.emoji} ${V.name}</b>
                <span class="gp-desc">${V.desc}</span>
                <span class="gp-stars"><span>Vitesse</span><i>${stars(V.stars.speed)}</i><span>Accélération</span><i>${stars(V.stars.accel)}</i>
                  <span>Virages</span><i>${stars(V.stars.handling)}</i><span>Poussée</span><i>${stars(V.stars.push)}</i></span>
                <span class="gp-who">${who(t)}</span>
              </button>`;
            }).join("")}
          </div>
        </div>`;
      box.querySelectorAll(".gp-car").forEach((b) => { b.onclick = () => api.action("car", { type: b.dataset.t }); });
      box.querySelectorAll(".gp-prev").forEach((cv) => {
        const c = cv.getContext("2d");
        c.save(); c.translate(110, 55); c.scale(2.4, 2.4);
        window.VehicleArt.paint(c, cv.dataset.t, colorOf(me()), null, 0, false, false);
        c.restore();
      });
    }
    const sec = $("gp-pick-sec");
    if (sec) sec.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
  }

  // ===================================================================
  //  FIN DE MANCHE
  // ===================================================================
  function renderOver() {
    const ov = $("gp-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const V = (id) => P.VEHICLES[lr.types[id]] || P.VEHICLES.eclair;
    const banner = lr.mode === "elimination" ? `🏆 ${esc(pseudoOf(lr.order[0]))} est le dernier survivant !` : `🏆 ${esc(pseudoOf(lr.order[0]))} gagne la course !`;
    const info = (id) => lr.times[id] != null ? `⏱️ ${mmss(lr.times[id])}` : lr.cause[id] === "explosé" ? "💥 explosé" : lr.cause[id] === "parti" ? "parti" : lr.mode === "elimination" ? "survivant" : `pas fini (tour ${lr.laps[id] + 1})`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${V(id).emoji} ${V(id).name} · ${info(id)}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Course suivante dans <b id="gp-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="gp-next" class="btn btn-primary">Course suivante ▶</button>
            <button id="gp-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="gp-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="gp-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="gp-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="gp-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="gp-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="gp-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("gp-next") && ($("gp-next").onclick = () => api.action("next"));
    $("gp-again") && ($("gp-again").onclick = () => api.action("start").then((r) => { if (r.error) $("gp-over-error").textContent = r.error; }));
    $("gp-to-setup") && ($("gp-to-setup").onclick = () => api.action("setup"));
    $("gp-finish") && ($("gp-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer le Grand Prix ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["gp-fin-sec", finishEndLocal], ["gp-next-sec", phaseEndLocal], ["gp-pick-sec", phaseEndLocal]]) {
      const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
    if (!st || st.phase === "setup" || !track) return;
    driveLocal(dt);
    draw(ts, dt);
  }

  // La voiture qu'on suit : la mienne, sinon le premier encore en course.
  function followed() {
    const mine = carOf(me());
    if (mine && mine.alive) return mine.id === me() && pred ? viewMine() : shownCar(mine);
    const lead = st.order.map(carOf).find((c) => c && solid(c));
    return lead ? shownCar(lead) : null;
  }
  function viewMine() {
    const v = ownView();
    return { ...v, x: v.x + off.x, y: v.y + off.y, a: v.a + off.a };
  }

  function draw(ts, dt) {
    const c = g2d;
    // Les petits décalages de recalage s'effacent en douceur.
    const k = Math.min(1, dt * 10);
    off.x -= off.x * k; off.y -= off.y * k; off.a -= off.a * k;
    for (const o of Object.values(othersOff)) { o.x -= o.x * k; o.y -= o.y * k; o.a -= o.a * k; }

    // Caméra : vue d'ensemble pendant le choix, sinon elle suit (en regardant un peu devant).
    const f = st.phase === "pick" ? null : followed();
    let tx, ty, tz;
    if (!f) { tx = track.w / 2; ty = track.h / 2; tz = Math.min(W / track.w, HGT / track.h) * 0.95; }
    else {
      const sp = Math.hypot(f.vx, f.vy);
      tx = f.x + f.vx * 0.35; ty = f.y + f.vy * 0.35;
      tz = 0.95 - Math.min(0.25, sp / 2400);
    }
    const ck = st.phase === "pick" || !cam.init ? 1 : Math.min(1, dt * 5);
    cam.x += (tx - cam.x) * ck; cam.y += (ty - cam.y) * ck; cam.z += (tz - cam.z) * Math.min(1, dt * 2.5);
    if (st.phase === "pick") cam.z = tz;
    cam.init = st.phase !== "pick";
    shake = Math.max(0, shake - dt * 30);

    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#3d8a36"; c.fillRect(0, 0, W, HGT);
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    c.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z + sx, HGT / 2 - cam.y * cam.z + sy);
    const vx0 = cam.x - W / 2 / cam.z, vy0 = cam.y - HGT / 2 / cam.z, vx1 = cam.x + W / 2 / cam.z, vy1 = cam.y + HGT / 2 / cam.z;

    // Herbe tondue en bandes.
    c.fillStyle = "#44953c";
    const B = 260;
    for (let x = Math.floor(vx0 / B) * B; x < vx1; x += B) if (Math.floor(x / B) % 2 === 0) c.fillRect(x, vy0, B / 2, vy1 - vy0);
    // Le bord du monde.
    c.strokeStyle = "#2a5f25"; c.lineWidth = 30; c.strokeRect(0, 0, track.w, track.h);

    // La piste : vibreurs rouge/blanc, ligne blanche, asphalte, pointillés au milieu.
    c.lineJoin = "round"; c.lineCap = "round";
    c.strokeStyle = "#d8302a"; c.lineWidth = T.WIDTH + 22; c.stroke(path);
    c.setLineDash([28, 28]); c.strokeStyle = "#f4f4f4"; c.stroke(path); c.setLineDash([]);
    c.strokeStyle = "#f2f2f2"; c.lineWidth = T.WIDTH; c.stroke(path);
    c.strokeStyle = "#4a4b55"; c.lineWidth = T.WIDTH - 10; c.stroke(path);
    c.setLineDash([34, 46]); c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 4; c.stroke(path); c.setLineDash([]);

    // Barrières de sécurité (rail métallique sur poteaux, des 2 côtés).
    for (const r of rails) {
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 12; c.save(); c.translate(3, 4); c.stroke(r); c.restore();
      c.setLineDash([4, 36]); c.strokeStyle = "#5b5f66"; c.lineWidth = 14; c.stroke(r); c.setLineDash([]);
      c.strokeStyle = "#cfd4dc"; c.lineWidth = 7; c.stroke(r);
      c.strokeStyle = "#8a9099"; c.lineWidth = 2; c.stroke(r);
    }
    // Ligne de départ / arrivée (damier) et la grille.
    {
      const p0 = track.pts[0], n0 = T.normal(track, 0), a0 = track.ang[0];
      c.save(); c.translate(p0.x, p0.y); c.rotate(a0);
      const half = T.WIDTH / 2 - 5, sq = 10;
      for (let i = 0; i < 2; i++) for (let j = -half; j < half; j += sq) {
        c.fillStyle = (Math.floor(j / sq) + i) % 2 ? "#111" : "#fff"; c.fillRect(i * sq - sq, j, sq, sq);
      }
      c.restore();
      c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 3;
      for (const g of T.startGrid(track, 8)) {
        c.save(); c.translate(g.x, g.y); c.rotate(g.a);
        c.beginPath(); c.moveTo(22, -16); c.lineTo(28, -16); c.lineTo(28, 16); c.lineTo(22, 16); c.stroke();
        c.restore();
      }
      void n0;
    }

    // Obstacles : piles de pneus, bottes de paille.
    for (const o of track.obstacles) {
      if (o.x + o.w < vx0 - 40 || o.x > vx1 + 40 || o.y + o.h < vy0 - 40 || o.y > vy1 + 40) continue;
      if (o.kind === "pneus") {
        const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
        c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.arc(cx + 3, cy + 4, o.w / 2 + 2, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#151515"; c.beginPath(); c.arc(cx, cy, o.w / 2 + 1, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#3a3a3a"; c.lineWidth = 3; c.beginPath(); c.arc(cx, cy, o.w / 2 - 4, 0, Math.PI * 2); c.stroke();
        c.fillStyle = "#e0302f"; c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.fill();
      } else {
        c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(o.x + 4, o.y + 5, o.w, o.h);
        c.fillStyle = "#e6c25a"; c.fillRect(o.x, o.y, o.w, o.h);
        c.strokeStyle = "#a8862e"; c.lineWidth = 2;
        for (let k2 = 6; k2 < o.w; k2 += 7) { c.beginPath(); c.moveTo(o.x + k2, o.y + 2); c.lineTo(o.x + k2, o.y + o.h - 2); c.stroke(); }
        c.strokeStyle = "#6b4a14"; c.lineWidth = 3; c.strokeRect(o.x + 1.5, o.y + 1.5, o.w - 3, o.h - 3);
      }
    }
    // Plots (renversés : ils volent puis restent couchés).
    const now = performance.now();
    for (const cn of track.cones) {
      const kn = st.cones[cn.id];
      let x = cn.x, y = cn.y, down = false, rot = 0;
      if (kn) {
        if (!coneSeen[cn.id]) coneSeen[cn.id] = now;
        const tt = Math.min(0.6, (now - coneSeen[cn.id]) / 1000);
        const dist = kn.v * tt * (1 - tt / 1.2);
        x += Math.cos(kn.a) * dist; y += Math.sin(kn.a) * dist; down = true; rot = kn.a + tt * 12;
      }
      if (x < vx0 - 30 || x > vx1 + 30 || y < vy0 - 30 || y > vy1 + 30) continue;
      c.save(); c.translate(x, y);
      if (down) { c.rotate(rot); c.fillStyle = "#ff7a1a"; c.beginPath(); c.moveTo(-10, -7); c.lineTo(12, 0); c.lineTo(-10, 7); c.closePath(); c.fill(); c.fillStyle = "#fff"; c.fillRect(-3, -4, 3, 8); }
      else {
        c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.arc(3, 3, 10, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#ff7a1a"; c.beginPath(); c.arc(0, 0, 10, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#fff"; c.beginPath(); c.arc(0, 0, 6, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#ff7a1a"; c.beginPath(); c.arc(0, 0, 3.5, 0, Math.PI * 2); c.fill();
      }
      c.restore();
    }

    // Les voitures (pas pendant le choix : elles ne sont pas encore sur la grille).
    const lastId = st.mode === "elimination" && driving() ? [...st.order].reverse().find((id) => { const cc = carOf(id); return cc && solid(cc); }) : null;
    const views = [];
    if (st.phase !== "pick") {
      for (const car of st.cars) {
        if (!car.alive) continue;
        const v = car.id === me() && pred ? viewMine() : shownCar(car);
        views.push([car, v]);
      }
      // Fumée des pneus quand ça glisse.
      for (const [car, v] of views) {
        if (v.slide && Math.hypot(v.vx, v.vy) > 140 && Math.random() < 0.6) {
          particles.push({ x: v.x - Math.cos(v.a) * 20, y: v.y - Math.sin(v.a) * 20, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.6, max: 0.6, col: "rgba(220,220,220,0.5)", r: 7, smoke: true });
        }
        void car;
      }
      for (const [car, v] of views) {
        c.save(); c.translate(v.x, v.y); c.rotate(v.a);
        if (car.finished) c.globalAlpha = 0.5;
        window.VehicleArt.paint(c, car.type, colorOf(car.id), null, v.st, car.id === me(), v.boost);
        c.restore();
      }
      // Pseudos (+ bombe sur le dernier en élimination).
      c.textAlign = "center"; c.textBaseline = "middle";
      for (const [car, v] of views) {
        const isLast = car.id === lastId;
        const lab = `${isLast ? "💣 " : ""}${pseudoOf(car.id)}`;
        c.font = `bold ${Math.round(15 / cam.z)}px Segoe UI, sans-serif`;
        const w = c.measureText(lab).width + 12 / cam.z, h = 22 / cam.z, y = v.y - 38 / Math.max(0.7, cam.z);
        c.fillStyle = isLast ? "rgba(200,20,20,0.85)" : car.id === me() ? "rgba(255,210,63,0.9)" : "rgba(0,0,0,0.55)";
        c.beginPath(); c.roundRect(v.x - w / 2, y - h / 2, w, h, 6 / cam.z); c.fill();
        c.fillStyle = car.id === me() && !isLast ? "#1b1830" : "#fff";
        c.fillText(lab, v.x, y + 1);
      }
      // Repère « c'est toi » au départ.
      const mv = views.find(([car]) => car.id === me());
      if (mv) window.VehicleArt.markMe(c, mv[1].x, mv[1].y, ts, colorOf(me()), window.VehicleArt.markAlpha(st.phase, playSeenAt), 1 / cam.z);
      if (mv && !mv[0].finished) window.VehicleArt.gauge(c, mv[1].x, mv[1].y, 1 / cam.z, mv[1].nitro, mv[1].boost);
    }

    // Étincelles, fumée, explosions.
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy *= 0.94;
      c.globalAlpha = Math.max(0, p.life / p.max) * (p.smoke ? 0.6 : 1);
      c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.smoke ? p.r * (1.6 - p.life / p.max) : p.r || 3, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;

    // ---------------- ÉCRAN (HUD dessiné par-dessus) ----------------
    c.setTransform(1, 0, 0, 1, 0, 0);
    drawHud(c, ts, dt);
  }

  function panel(c, x, y, w, h) { c.fillStyle = "rgba(10,14,28,0.72)"; c.beginPath(); c.roundRect(x, y, w, h, 12); c.fill(); }

  function drawHud(c, ts, dt) {
    const mine = carOf(me());
    const mv = pred ? viewMine() : mine;
    c.textBaseline = "top"; c.textAlign = "left";
    // Position + tour (en haut à gauche).
    if (mine && st.phase !== "pick") {
      const i = st.order.indexOf(me());
      panel(c, 14, 14, 230, st.mode === "course" ? 118 : 84);
      const big = mine.alive ? place(i) : "💥";
      c.fillStyle = "#ffd23f"; c.font = "900 54px Segoe UI, sans-serif";
      c.fillText(big, 28, 18);
      const bw = c.measureText(big).width;
      c.fillStyle = "#fff"; c.font = "bold 22px Segoe UI, sans-serif";
      c.fillText(`/ ${st.cars.length}`, 28 + bw + 8, 44);
      if (st.mode === "course") {
        const lap = Math.min(st.laps, Math.max(1, Math.floor(mine.prog / track.len) + 1));
        c.font = "bold 26px Segoe UI, sans-serif"; c.fillStyle = "#9fe8ff";
        c.fillText(mine.finished ? "🏁 Arrivé !" : `Tour ${lap} / ${st.laps}`, 28, 84);
      }
    }
    // Classement en direct (à gauche, sous la position).
    if (st.phase === "play" || st.phase === "countdown") {
      const y0 = st.mode === "course" ? 144 : 110;
      const list = st.order.slice(0, 8);
      panel(c, 14, y0, 230, 12 + list.length * 26);
      list.forEach((id, i) => {
        const cc = carOf(id), y = y0 + 8 + i * 26;
        const dead = cc && !cc.alive;
        c.fillStyle = id === me() ? "#ffd23f" : dead ? "#ff8a8a" : "#fff";
        c.font = `${id === me() ? "900" : "bold"} 17px Segoe UI, sans-serif`;
        c.fillText(`${i + 1}. ${dead ? "💥 " : cc?.finished ? "🏁 " : id === lastIdHud() ? "💣 " : ""}${pseudoOf(id)}`.slice(0, 24), 26, y);
        c.fillStyle = colorOf(id); c.beginPath(); c.arc(232, y + 9, 6, 0, Math.PI * 2); c.fill();
      });
    }
    // Élimination : compte à rebours de la prochaine explosion (en haut au milieu).
    if (st.mode === "elimination" && st.phase === "play" && st.elimLeft !== undefined) {
      const left = Math.max(0, elimEndLocal - Date.now());
      const urgent = left < 5000;
      const wv = 420;
      panel(c, W / 2 - wv / 2, 14, wv, 70);
      c.textAlign = "center";
      c.fillStyle = urgent && Math.floor(ts / 200) % 2 ? "#ff3b3b" : "#fff";
      c.font = "900 32px Segoe UI, sans-serif";
      c.fillText(`💥 Explosion dans ${Math.ceil(left / 1000)} s`, W / 2, 20);
      const lid = lastIdHud();
      c.font = "bold 18px Segoe UI, sans-serif"; c.fillStyle = lid === me() ? "#ff6b6b" : "#ffd0d0";
      c.fillText(lid ? (lid === me() ? "💣 C'EST TOI LE DERNIER ! Remonte !" : `💣 Dernier : ${pseudoOf(lid)}`) : "", W / 2, 56);
      // Barre qui se vide.
      c.fillStyle = urgent ? "#ff3b3b" : "#ffb020"; c.fillRect(W / 2 - wv / 2 + 10, 80, (wv - 20) * (left / ELIM_EVERY), 4);
      c.textAlign = "left";
    }
    // Course : après l'arrivée du premier, le temps qui reste.
    if (st.mode === "course" && st.phase === "play" && st.endLeft > 0) {
      const left = Math.max(0, endEndLocal - Date.now());
      panel(c, W / 2 - 190, 14, 380, 50);
      c.textAlign = "center"; c.fillStyle = "#ffd23f"; c.font = "900 26px Segoe UI, sans-serif";
      c.fillText(`🏁 Fin de course dans ${Math.ceil(left / 1000)} s`, W / 2, 24);
      c.textAlign = "left";
    }
    // Nitro + vitesse (en bas à gauche).
    if (mine && mine.alive && (st.phase === "play" || st.phase === "countdown")) {
      panel(c, 14, HGT - 96, 300, 82);
      c.fillStyle = "#fff"; c.font = "900 34px Segoe UI, sans-serif";
      c.fillText(`${kmh(mv)} km/h`, 28, HGT - 90);
      const nv = mv.nitro ?? 1;
      c.fillStyle = "rgba(255,255,255,0.15)"; c.fillRect(28, HGT - 44, 272, 18);
      const gr = c.createLinearGradient(28, 0, 300, 0); gr.addColorStop(0, "#3bd6ff"); gr.addColorStop(1, "#ff7a1a");
      c.fillStyle = gr; c.fillRect(28, HGT - 44, 272 * nv, 18);
      c.fillStyle = "#fff"; c.font = "bold 14px Segoe UI, sans-serif";
      const rg = mine.regen || 1;
      c.fillText(`🔥 NITRO (Maj)${rg > 1.05 ? `  · recharge ×${rg.toFixed(1)}` : ""}${mv.slide ? "  · dérapage +" : ""}`, 32, HGT - 43);
    }
    // Mini-carte (en bas à droite).
    if (mini) {
      const mx = W - mini.width - 14, my = HGT - mini.height - 14;
      c.drawImage(mini, mx, my);
      for (const car of st.cars) {
        if (!car.alive || st.phase === "pick") continue;
        const v = car.id === me() && pred ? viewMine() : car;
        const px = mx + mini.ox + v.x * mini.s, py = my + mini.oy + v.y * mini.s;
        c.fillStyle = colorOf(car.id); c.strokeStyle = car.id === me() ? "#fff" : "#000"; c.lineWidth = car.id === me() ? 3 : 1.5;
        c.beginPath(); c.arc(px, py, car.id === me() ? 7 : 5, 0, Math.PI * 2); c.fill(); c.stroke();
      }
    }
    // Feux de départ.
    if (st.phase === "countdown") {
      const left = Math.max(0, phaseEndLocal - Date.now()), n = Math.ceil(left / 1000);
      panel(c, W / 2 - 150, HGT / 2 - 150, 300, 110);
      for (let i = 0; i < 3; i++) {
        c.fillStyle = i < 4 - n ? "#ff2a2a" : "#3a1010";   // 3 s : 1 feu, 2 s : 2 feux, 1 s : 3 feux
        c.beginPath(); c.arc(W / 2 - 80 + i * 80, HGT / 2 - 95, 30, 0, Math.PI * 2); c.fill();
      }
    }
    if (goFlash > 0) {
      goFlash = Math.max(0, goFlash - dt * 0.9);
      c.globalAlpha = Math.min(1, goFlash * 2);
      c.textAlign = "center"; c.textBaseline = "middle"; c.font = "900 140px Segoe UI, sans-serif";
      c.fillStyle = "#3dff7a"; c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 8;
      c.strokeText("GO !", W / 2, HGT / 2 - 60); c.fillText("GO !", W / 2, HGT / 2 - 60);
      c.globalAlpha = 1;
    }
    // Spectateur.
    if (mine && !mine.alive && st.phase === "play") {
      c.textAlign = "center"; c.textBaseline = "top"; c.font = "bold 22px Segoe UI, sans-serif";
      panel(c, W / 2 - 230, HGT - 60, 460, 44);
      c.fillStyle = "#fff"; c.fillText("💥 Tu as explosé — tu regardes le premier", W / 2, HGT - 50);
    }
  }
  function lastIdHud() {
    if (st.mode !== "elimination" || !driving()) return null;
    return [...st.order].reverse().find((id) => { const cc = carOf(id); return cc && solid(cc); }) || null;
  }
})();
