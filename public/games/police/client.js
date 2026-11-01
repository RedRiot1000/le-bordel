// ===================================================================
//  AVIS DE RECHERCHE — Client (s'affiche dans le hub Le Bordel)
//  - La ville est refaite ici à partir de sa seed (city.js).
//  - MA voiture est calculée ici tout de suite (prédiction), puis recalée
//    sur le serveur ; les autres sont affichées "au présent".
//  - Caméra qui suit ma voiture + mini-carte.
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const C = window.PoliceCity;
  const K = P.K;
  const COP_POWER = (stars) => 0.85 + 0.07 * stars;   // (le même que games/police/server.js)
  const COP_COLOR = "#16213e";
  const MINI = 0.07;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, copsInLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, bg = null, mini = null, city = null, cityKey = null, ENV = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0, a: 0 };
  const pressed = new Set();

  let particles = [];
  const seenFx = new Set();
  let shake = 0;
  let prevPhase = null, playSeenAt = 0;
  let myRole = null, roleFlash = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const carOf = (id) => st?.cars.find((c) => c.id === id);
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const driving = () => st?.phase === "play";
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const TEMPLATE = `
    <div id="po-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🚨</span>
        <h1>AVIS DE RECHERCHE</h1>
        <p class="tagline">Toute la police de la ville est à vos trousses.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="po-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏎️ Vous êtes en <b>F1</b> dans une ville. La police arrive après 5 s, de plus en plus nombreuse (⭐ → ⭐⭐⭐⭐⭐) : sportives, motos, vans, puis supercars et camions.</li>
            <li>🚔 Presque à l'arrêt pendant <b>1 s</b> avec <b>2 véhicules de police</b> autour = <b>ARRÊTÉ</b>. Tu deviens flic (un van) et tu aides à coincer les autres !</li>
            <li>🚁 À ⭐⭐⭐⭐, l'hélico suit un fugitif : la moitié des flics fonce sur lui.</li>
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches · <kbd>Espace</kbd> frein à main · <kbd>Shift</kbd> nitro</li>
            <li>🏆 +1 par 20 s de liberté, <b>+3</b> si tu es encore libre à la fin. Flic : <b>+2</b> par arrestation.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="po-start" class="btn btn-primary btn-big">Démarrer la cavale</button>
        <p id="po-hint" class="muted"></p>
        <p id="po-error" class="error-msg"></p>
        <button id="po-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="po-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="po-round"></span>
        <span id="po-stars" class="po-stars"></span>
        <span id="po-role" class="ch-role"></span>
        <span id="po-clock" class="cf-clock"></span>
      </div>
      <div class="ch-sub">
        <div id="po-free" class="ch-mice"></div>
        <div id="po-nitro" class="pt-nitro" title="Nitro (Shift)"><span>NITRO</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="po-canvas" width="${P.W}" height="${P.H}"></canvas>
        <div id="po-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.police = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; cityKey = null; myRole = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("po-canvas");
      g2d = canvas.getContext("2d");
      $("po-start").onclick = () => {
        $("po-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("po-error").textContent = r.error; });
      };
      $("po-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      copsInLocal = Date.now() + (st.copsIn || 0);

      if (st.phase === "setup") {
        $("po-play").classList.add("hidden");
        $("po-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("po-setup").classList.add("hidden");
      $("po-play").classList.remove("hidden");
      if (st.city && st.city.seed + ":" + st.city.n !== cityKey) newCity();
      const role = carOf(me())?.role || null;
      if (role !== myRole) { if (myRole === "free" && role === "cop") roleFlash = 2.5; myRole = role; pred = prevPred = null; pending = []; history.clear(); }
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
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
      bg = mini = city = null;
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
  const myBonus = () => (myRole === "cop" ? COP_POWER(st.stars) : 1);
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
    const sc = carOf(me());
    if (!sc || !driving() || !ENV) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = P.copyCar(sc);
    pending.forEach((p, i) => { P.simulate(pred, p.k, ENV, myBonus(), othersAt((i + 1) * P.TICK)); history.set(p.s, P.copyCar(pred)); });
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
      P.simulate(pred, k, ENV, myBonus(), othersAt(pending.length * P.TICK));
      history.set(seq, P.copyCar(pred));
      acc -= P.TICK;
    }
  }

  // Toutes les autres voitures (joueurs + flics), avec un id unique.
  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  const allOthers = () => st.cars.filter((c) => c.id !== me()).concat(st.cops);
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    const mine = pred;
    // Seulement celles qui sont près de moi (les autres ne peuvent pas me toucher).
    return allOthers().filter((c) => !mine || (Math.abs(c.x - mine.x) < 300 && Math.abs(c.y - mine.y) < 300)).map((c) => P.extrapolate(c, t));
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
  function rebase() {
    const t = aheadNow();
    for (const c of st.cars.concat(st.cops)) {
      if (c.id === me() && pred) continue;
      const prev = lastShown[c.id];
      const base = driving() ? P.extrapolate(c, t) : c;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 120) othersOff[c.id] = { x: prev.x - base.x, y: prev.y - base.y, a: angDiff(prev.a, base.a) };
      else othersOff[c.id] = { x: 0, y: 0, a: 0 };
    }
  }

  // ===================================================================
  //  EFFETS : chocs, arrestation (gyrophares qui explosent en bleu/rouge)
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.big ? 80 : Math.min(24, 5 + f.s / 30);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = f.big ? 80 + Math.random() * 360 : 60 + Math.random() * f.s * 0.7;
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * (f.big ? 0.9 : 0.3), max: f.big ? 1.2 : 0.6, col: f.big ? (i % 2 ? "#ff3b3b" : "#3b7bff") : "#ffd27a" });
      }
      if (f.big) shake = 10;
    }
    if (seenFx.size > 400) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("po-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[2, "2"], [3, "3"], [5, "5"]])}</div>
      <div class="setting-block"><label>Durée d'une manche</label>${chips("duration", [[90, "1 min 30"], [120, "2 min"], [180, "3 min"]])}</div>
      <p class="settings-note">Une nouvelle ville à chaque manche. Le niveau de recherche monte 5 fois pendant la manche.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("po-start").style.display = host ? "" : "none";
    $("po-start").disabled = n < 2;
    $("po-finish-setup").classList.toggle("hidden", !host);
    $("po-hint").textContent = !host ? "En attente que l'hôte lance la cavale…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} fugitifs · jusqu'à ${Math.min(40, 6 * n)} véhicules de police`;
  }

  // ===================================================================
  //  BANDEAU DU HAUT
  // ===================================================================
  function renderHud() {
    $("po-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const stars = "⭐".repeat(st.stars) + "<span class='off'>" + "⭐".repeat(5 - st.stars) + "</span>";
    if ($("po-stars").innerHTML !== stars) $("po-stars").innerHTML = stars;
    const role = $("po-role");
    const txt = !myRole ? "👀 Tu regardes" : myRole === "cop" ? "🚔 Tu es FLIC : coince les fugitifs !" : "🏎️ FUIS ! Ne t'arrête jamais";
    if (role.textContent !== txt) { role.textContent = txt; role.className = "ch-role " + (myRole === "cop" ? "cop" : "free"); }
    const free = st.cars.filter((c) => c.role === "free");
    const html = `<span class="muted">🏎️ En fuite :</span> ${free.map((c) => `<span class="ch-tag ${c.id === me() ? "me" : ""}" style="border-color:${playerOf(c.id)?.color}">${esc(pseudoOf(c.id))}</span>`).join("") || "<b>personne</b>"}
      <span class="muted po-copcount">🚓 ${st.cops.length + st.cars.length - free.length}</span>`;
    if ($("po-free").innerHTML !== html) $("po-free").innerHTML = html;
    $("po-nitro").classList.toggle("hidden", !myRole || st.phase !== "play");
  }

  function renderOver() {
    const ov = $("po-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.survivors.length === 0 ? "🚔 Tout le monde au poste !"
      : lr.survivors.length === 1 ? `🏁 ${esc(pseudoOf(lr.survivors[0]))} s'échappe !` : `🏁 ${lr.survivors.length} fugitifs s'échappent !`;
    const ids = [...new Set([...lr.survivors, ...lr.arrests.map((a) => a.id), ...Object.keys(lr.gains)])].filter((id) => playerOf(id));
    const rows = ids.sort((a, b) => (lr.gains[b] || 0) - (lr.gains[a] || 0)).map((id) => {
      const a = lr.arrests.find((x) => x.id === id);
      const helped = lr.arrests.filter((x) => x.by.includes(id)).length;
      const how = (lr.survivors.includes(id) ? "🏁 libre jusqu'au bout" : a ? `🚔 arrêté à ${mmss(a.at)}` : "") + (helped ? ` · 🚓 ${helped} arrestation${helped > 1 ? "s" : ""}` : "");
      return `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="muted">${how}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`;
    }).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="po-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="po-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="po-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="po-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="po-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="po-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="po-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="po-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="po-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `
      <div class="pt-over card ch-over">
        <h2 class="go-banner">${banner}</h2>
        <p class="muted">Niveau de recherche atteint : ${"⭐".repeat(lr.stars)}</p>
        <ul class="ch-rows">${rows}</ul>
        ${total}
        ${buttons}
      </div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("po-next") && ($("po-next").onclick = () => api.action("next"));
    $("po-again") && ($("po-again").onclick = () => api.action("start").then((r) => { if (r.error) $("po-over-error").textContent = r.error; }));
    $("po-to-setup") && ($("po-to-setup").onclick = () => api.action("setup"));
    $("po-finish") && ($("po-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Avis de recherche ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  LA VILLE (dessinée une fois par manche)
  // ===================================================================
  const ROOF = ["#5b6170", "#6b5a4e", "#4f5d6b", "#6d6a60", "#565168"];
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function newCity() {
    cityKey = st.city.seed + ":" + st.city.n;
    city = C.build(st.city.seed, st.city.n);
    ENV = { w: city.w, h: city.h, grip: 1, oils: [], obstacles: city.obstacles, nitro: true };
    const rnd = seeded(st.city.seed ^ 0x5bd1);
    const W = city.w, H = city.h, R = C.ROAD, half = R / 2;
    bg = document.createElement("canvas");
    bg.width = W; bg.height = H;
    const c = bg.getContext("2d");
    // Bitume + grain.
    c.fillStyle = "#2a2c33"; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 14000; i++) { c.fillStyle = i % 2 ? "#30323a" : "#25272d"; const s = 1 + rnd() * 2.5; c.fillRect(rnd() * W, rnd() * H, s, s); }
    // Lignes au milieu des rues (pointillés), en sautant les carrefours.
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 4; c.setLineDash([26, 22]);
    for (let i = 0; i <= city.nx; i++) for (let j = 0; j < city.ny; j++) {
      const x = half + i * C.CELL; c.beginPath(); c.moveTo(x, j * C.CELL + R + 10); c.lineTo(x, (j + 1) * C.CELL - 10); c.stroke();
    }
    for (let j = 0; j <= city.ny; j++) for (let i = 0; i < city.nx; i++) {
      const y = half + j * C.CELL; c.beginPath(); c.moveTo(i * C.CELL + R + 10, y); c.lineTo((i + 1) * C.CELL - 10, y); c.stroke();
    }
    c.setLineDash([]);
    // Passages piétons aux carrefours.
    c.fillStyle = "rgba(255,255,255,0.22)";
    for (let i = 0; i <= city.nx; i++) for (let j = 0; j <= city.ny; j++) {
      const x0 = i * C.CELL, y0 = j * C.CELL;
      for (let k = 0; k < 6; k++) {
        if (j < city.ny) c.fillRect(x0 + 14 + k * 22, y0 + R + 4, 12, 18);
        if (i < city.nx) c.fillRect(x0 + R + 4, y0 + 14 + k * 22, 18, 12);
      }
    }
    // Places : herbe, arbres, fontaine.
    for (const p of city.parks) {
      c.fillStyle = "#b9b4a6"; c.fillRect(p.x, p.y, p.w, p.h);
      c.fillStyle = "#3f7a3a"; c.fillRect(p.x + 14, p.y + 14, p.w - 28, p.h - 28);
      c.fillStyle = "#c9c2b0"; c.fillRect(p.x + p.w / 2 - 20, p.y + 14, 40, p.h - 28); c.fillRect(p.x + 14, p.y + p.h / 2 - 20, p.w - 28, 40);
    }
    // Immeubles : trottoir, ombre, toit, détails.
    for (const b of city.buildings) {
      if (b.tone < 0) {   // fontaine
        c.fillStyle = "#8a8578"; c.beginPath(); c.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 6, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#3d8fd1"; c.beginPath(); c.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 - 2, 0, Math.PI * 2); c.fill();
        continue;
      }
      c.fillStyle = "#9c978b"; c.fillRect(b.x, b.y, b.w, b.h);                       // trottoir
      c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(b.x + 16, b.y + 18, b.w - 22, b.h - 22);   // ombre
      c.fillStyle = ROOF[b.tone]; c.fillRect(b.x + 10, b.y + 10, b.w - 22, b.h - 22);        // toit
      c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 3; c.strokeRect(b.x + 12, b.y + 12, b.w - 26, b.h - 26);
      const n = Math.floor((b.w * b.h) / 9000);
      for (let k = 0; k < n; k++) {   // climatiseurs, cheminées
        const w = 14 + rnd() * 20, h = 10 + rnd() * 16;
        const x = b.x + 18 + rnd() * Math.max(1, b.w - 40 - w), y = b.y + 18 + rnd() * Math.max(1, b.h - 40 - h);
        c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(x + 3, y + 3, w, h);
        c.fillStyle = rnd() < 0.5 ? "#8d939e" : "#a8a092"; c.fillRect(x, y, w, h);
      }
    }
    for (const t of city.trees) {
      c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.arc(t.x + 5, t.y + 6, t.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#2f6b2a"; c.beginPath(); c.arc(t.x, t.y, t.r, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#3e8a37"; c.beginPath(); c.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.6, 0, Math.PI * 2); c.fill();
    }
    // Rues barrées (rayures rouges et blanches).
    for (const o of city.barriers) {
      c.save(); c.beginPath(); c.rect(o.x, o.y, o.w, o.h); c.clip();
      c.fillStyle = "#fff"; c.fillRect(o.x, o.y, o.w, o.h);
      c.fillStyle = "#e0302f";
      for (let k = -o.h; k < o.w + o.h; k += 24) { c.beginPath(); c.moveTo(o.x + k, o.y); c.lineTo(o.x + k + 12, o.y); c.lineTo(o.x + k + 12 - o.h, o.y + o.h); c.lineTo(o.x + k - o.h, o.y + o.h); c.fill(); }
      c.restore();
    }
    // Bord de la ville.
    c.lineWidth = 12; c.strokeStyle = "#111"; c.strokeRect(6, 6, W - 12, H - 12);

    // Mini-carte.
    mini = document.createElement("canvas");
    mini.width = Math.round(W * MINI); mini.height = Math.round(H * MINI);
    const mc = mini.getContext("2d");
    mc.fillStyle = "rgba(40,42,50,0.85)"; mc.fillRect(0, 0, mini.width, mini.height);
    mc.fillStyle = "rgba(160,160,170,0.75)";
    for (const o of city.obstacles) mc.fillRect(o.x * MINI, o.y * MINI, Math.max(2, o.w * MINI), Math.max(2, o.h * MINI));
    mc.strokeStyle = "rgba(255,255,255,0.5)"; mc.lineWidth = 2; mc.strokeRect(1, 1, mini.width - 2, mini.height - 2);
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("po-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("po-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.82, dt * 60);
    off.x *= decay; off.y *= decay; off.a *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; o.a *= decay; }
    const clock = $("po-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
      clock.textContent = "⏱️ " + mmss(left);
      clock.classList.toggle("urgent", st.phase === "play" && left < 10000);
    }
    draw(ts, dt);
  }

  // Gyrophare : rouge et bleu qui alternent.
  function lightBar(c, v, ts, phase) {
    const on = Math.floor(ts / 160 + phase) % 2 === 0;
    c.save(); c.translate(v.x, v.y); c.rotate(v.a);
    c.fillStyle = on ? "#ff2b2b" : "#5a1010"; c.fillRect(-3, -9, 6, 8);
    c.fillStyle = on ? "#1c2c60" : "#2d6bff"; c.fillRect(-3, 1, 6, 8);
    c.restore();
    const gr = c.createRadialGradient(v.x, v.y, 2, v.x, v.y, 38);
    gr.addColorStop(0, on ? "rgba(255,40,40,0.28)" : "rgba(45,107,255,0.28)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = gr; c.beginPath(); c.arc(v.x, v.y, 38, 0, Math.PI * 2); c.fill();
  }

  function draw(ts, dt) {
    const c = g2d;
    const view = st.cars.map((car) => {
      if (car.id === me() && pred) {
        const o = ownView();
        return { ...o, id: car.id, role: car.role, arrest: car.arrest, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a };
      }
      return { ...shownCar(car), role: car.role, arrest: car.arrest };
    });
    const copsView = st.cops.map((cop) => shownCar(cop));
    const mv = view.find((v) => v.id === me());
    const W = city.w, H = city.h;

    c.save();
    c.fillStyle = "#111"; c.fillRect(0, 0, canvas.width, canvas.height);
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.86, dt * 60); }
    else shake = 0;
    let cam = null;
    if (mv) {
      cam = { x: Math.max(0, Math.min(W - canvas.width, mv.x - canvas.width / 2)), y: Math.max(0, Math.min(H - canvas.height, mv.y - canvas.height / 2)) };
      c.translate(-cam.x, -cam.y);
    } else {
      const s = Math.min(canvas.width / W, canvas.height / H);
      c.scale(s, s);
    }
    c.drawImage(bg, 0, 0);

    // Les flics IA.
    copsView.forEach((v, i) => {
      c.save(); c.translate(v.x, v.y); c.rotate(v.a);
      window.VehicleArt.paint(c, v.type, COP_COLOR, "#f2f2f2", v.st || 0, false, v.boost);
      c.restore();
      lightBar(c, v, ts, i);
    });
    // Les joueurs (fugitifs en F1, ou flics en van).
    for (const v of view) {
      const pc = playerOf(v.id)?.color || "#fff";
      c.save(); c.translate(v.x, v.y); c.rotate(v.a);
      window.VehicleArt.paint(c, v.type, v.role === "cop" ? COP_COLOR : pc, v.role === "cop" ? pc : null, v.st || 0, v.id === me(), v.boost);
      c.restore();
      if (v.role === "cop") lightBar(c, v, ts, 0.5);
      // Jauge d'arrestation : un cercle rouge qui se remplit.
      if (v.role === "free" && v.arrest > 0) {
        c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,0.5)";
        c.beginPath(); c.arc(v.x, v.y, 40, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = "#ff3030";
        c.beginPath(); c.arc(v.x, v.y, 40, -Math.PI / 2, -Math.PI / 2 + v.arrest * Math.PI * 2); c.stroke();
      }
      c.font = "bold 14px Segoe UI, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      const label = `${v.role === "cop" ? "🚔" : "🏎️"} ${pseudoOf(v.id)}`;
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.75)"; c.strokeText(label, v.x, v.y - 32);
      c.fillStyle = v.role === "cop" ? "#9fc0ff" : "#fff"; c.fillText(label, v.x, v.y - 32);
    }
    drawParticles(dt);

    // L'hélico : projecteur sur sa cible, et l'appareil au-dessus.
    if (st.heli) {
      const h = st.heli;
      const tv = view.find((v) => v.id === h.target);
      if (tv) {
        const gr = c.createRadialGradient(tv.x, tv.y, 10, tv.x, tv.y, 120);
        gr.addColorStop(0, "rgba(255,255,220,0.35)"); gr.addColorStop(1, "rgba(255,255,220,0)");
        c.fillStyle = gr; c.beginPath(); c.arc(tv.x, tv.y, 120, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.ellipse(h.x + 40, h.y + 60, 30, 14, 0, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(h.x, h.y);
      c.fillStyle = "#1d2b4f"; c.beginPath(); c.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(-48, -3, 26, 6);
      c.fillStyle = "#8fb6ff"; c.beginPath(); c.ellipse(12, 0, 9, 8, 0, 0, Math.PI * 2); c.fill();
      c.rotate(ts / 40);
      c.strokeStyle = "rgba(220,220,220,0.8)"; c.lineWidth = 4;
      c.beginPath(); c.moveTo(-38, 0); c.lineTo(38, 0); c.moveTo(0, -38); c.lineTo(0, 38); c.stroke();
      c.restore();
    }

    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, mv.role === "cop" ? "#5a8dff" : playerOf(me())?.color || "#fff",
      roleFlash > 0 ? 1 : window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt),
      Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();

    drawMini(view, copsView, cam);

    // Bandeaux : départ, arrivée de la police, arrestation.
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", "🏎️ Tu es en F1. La police arrive dans quelques secondes…");
    } else if (st.phase === "play" && Date.now() < copsInLocal) {
      band("🚨 FILEZ !", `La police arrive dans ${Math.ceil((copsInLocal - Date.now()) / 1000)} s…`, "#ffcf5c");
    } else if (roleFlash > 0) {
      roleFlash -= dt;
      band("🚔 ARRÊTÉ !", "Tu es flic maintenant : coince les autres !", "#ff4d4d");
    } else if (mv && mv.role === "free" && mv.arrest > 0.15) {
      band("⚠️ BOUGE !", "La police t'encercle !", "#ff4d4d", true);
    }

    const mine = pred || carOf(me());
    const bar = document.querySelector("#po-nitro i");
    if (bar && mine) { bar.style.width = Math.round(mine.nitro * 100) + "%"; bar.parentElement.classList.toggle("on", !!mine.boost); }
  }

  // Mini-carte en haut à droite.
  function drawMini(view, copsView, cam) {
    if (!mini) return;
    const c = g2d, x0 = canvas.width - mini.width - 12, y0 = 12;
    // Ma voiture passe sous la mini-carte : elle devient transparente.
    const mv = view.find((v) => v.id === me());
    const sx = mv && cam ? mv.x - cam.x : -1, sy = mv && cam ? mv.y - cam.y : -1;
    c.save();
    if (sx > x0 - 40 && sy < y0 + mini.height + 40) c.globalAlpha = 0.25;
    c.drawImage(mini, x0, y0);
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const v of copsView) { c.fillStyle = blink ? "#ff3b3b" : "#3b7bff"; c.fillRect(x0 + v.x * MINI - 2, y0 + v.y * MINI - 2, 4, 4); }
    for (const v of view) {
      c.fillStyle = v.role === "cop" ? "#5a8dff" : playerOf(v.id)?.color || "#fff";
      c.beginPath(); c.arc(x0 + v.x * MINI, y0 + v.y * MINI, v.role === "cop" ? 3 : 5, 0, Math.PI * 2); c.fill();
      if (v.id === me()) { c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(x0 + v.x * MINI, y0 + v.y * MINI, 8, 0, Math.PI * 2); c.stroke(); }
    }
    if (st.heli) { c.font = "14px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("🚁", x0 + st.heli.x * MINI, y0 + st.heli.y * MINI); }
    if (cam) { c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 1; c.strokeRect(x0 + cam.x * MINI, y0 + cam.y * MINI, canvas.width * MINI, canvas.height * MINI); }
    c.restore();
  }

  function band(big, small, color, low = false) {
    const c = g2d;
    const y = low ? canvas.height - 120 : canvas.height / 2;
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, y - (low ? 50 : 80), canvas.width, low ? 100 : 160);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = `bold ${low ? 44 : 66}px Segoe UI, sans-serif`;
    c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,0.6)"; c.strokeText(big, canvas.width / 2, y - (low ? 12 : 16));
    c.fillStyle = color || "#fff"; c.fillText(big, canvas.width / 2, y - (low ? 12 : 16));
    c.font = `${low ? 20 : 24}px Segoe UI, sans-serif`; c.fillStyle = "#fff";
    c.fillText(small, canvas.width / 2, y + (low ? 26 : 46));
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
