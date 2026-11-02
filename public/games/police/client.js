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
  const COP_POWER = (stars) => 0.95 + 0.06 * stars;   // (le même que games/police/server.js)
  const COP_COLOR = "#16213e";

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, copsInLocal = 0, fleeEndLocal = 0;
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
  let bigMap = false, fleeSeenAt = 0;

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
            <li>🚓 Les flics partent du <b>commissariat</b> (et un peu des sorties). Les <b>portiques jaunes</b> sont des raccourcis : les vans et camions ne passent pas dessous !</li>
            <li>🚪 À la fin du chrono : <b>FUYEZ !</b> Les 2 sorties s'ouvrent, tu as quelques secondes pour quitter la ville. <kbd>M</kbd> = la carte en grand.</li>
            <li>🏆 +1 par 20 s de liberté, <b>+3</b> si tu sors de la ville à temps. Flic : <b>+2</b> par arrestation.</li>
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
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro · M = carte</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.police = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; bigMap = false; fleeSeenAt = 0; pred = prevPred = null; pending = []; particles = []; cityKey = null; myRole = null;
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
      if (st.flee && !fleeSeenAt) fleeSeenAt = performance.now();
      if (!st.flee) fleeSeenAt = 0;
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      copsInLocal = Date.now() + (st.copsIn || 0);
      fleeEndLocal = Date.now() + (st.fleeLeft || 0);

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
    if (e.code === "KeyM" && st && st.phase !== "setup" && e.target.tagName !== "INPUT") {
      e.preventDefault();
      if (e.type === "keydown" && !e.repeat) bigMap = !bigMap;
      return;
    }
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
  const envAt = (car) => { ENV.obstacles = C.near(city, car.x, car.y, !!st?.flee); return ENV; };
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
    pending.forEach((p, i) => { P.simulate(pred, p.k, envAt(pred), myBonus(), othersAt((i + 1) * P.TICK)); history.set(p.s, P.copyCar(pred)); });
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
      P.simulate(pred, k, envAt(pred), myBonus(), othersAt(pending.length * P.TICK));
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
      <div class="setting-block"><label>🚪 Temps pour sortir de la ville (« FUYEZ ! »)</label>${chips("flee", [[20, "20 s"], [30, "30 s"], [45, "45 s"]])}</div>
      <p class="settings-note">Une nouvelle ville à chaque manche. Le niveau de recherche monte 5 fois pendant la manche. À la fin du chrono, il faut sortir de la ville par une des 2 sorties.</p>
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
    const out = st.escapes?.some((e) => e.id === me());
    const txt = out ? "🏁 ÉVADÉ ! Tu regardes les autres" : !myRole ? "👀 Tu regardes" : myRole === "cop" ? "🚔 Tu es FLIC : coince les fugitifs !" : "🏎️ FUIS ! Ne t'arrête jamais";
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
    const banner = lr.survivors.length === 0 ? "🚔 Personne n'est sorti de la ville !"
      : lr.survivors.length === 1 ? `🏁 ${esc(pseudoOf(lr.survivors[0]))} s'échappe !` : `🏁 ${lr.survivors.length} fugitifs s'échappent !`;
    const ids = [...new Set([...lr.survivors, ...(lr.late || []), ...lr.arrests.map((a) => a.id), ...Object.keys(lr.gains)])].filter((id) => playerOf(id));
    const rows = ids.sort((a, b) => (lr.gains[b] || 0) - (lr.gains[a] || 0)).map((id) => {
      const a = lr.arrests.find((x) => x.id === id);
      const helped = lr.arrests.filter((x) => x.by.includes(id)).length;
      const esc1 = lr.escapes?.find((e) => e.id === id);
      const how = (esc1 ? `🏁 sorti de la ville à ${mmss(esc1.at)}` : lr.late?.includes(id) ? "⏰ pas sorti à temps" : a ? `🚔 arrêté à ${mmss(a.at)}` : "") + (helped ? ` · 🚓 ${helped} arrestation${helped > 1 ? "s" : ""}` : "");
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
  // Les couleurs de chaque quartier : toits, sol des jardins, couleur sur la mini-carte.
  const DIST = {
    centre: { roofs: ["#5b6170", "#4f5d6b", "#6a7480", "#565168", "#7a6e66", "#3f4a5c"], mini: "#4a5068" },
    usine: { roofs: ["#7a5a45", "#6d6a60", "#80705a", "#5e6a6a", "#8a6248", "#55605e"], mini: "#6b5240" },
    banlieue: { roofs: ["#a0523d", "#8c4a3a", "#b5703f", "#7a5040", "#9c5f45", "#6f4a3a"], mini: "#3f6a3a" },
  };
  const WALK = "#b5b1a7", CURB = "#8a867c";   // trottoirs et bordures
  const CAR_COLORS = ["#c0392b", "#2e86de", "#f1c40f", "#ecf0f1", "#7f8c8d", "#27ae60", "#8e44ad", "#d35400", "#2c3e50"];
  const MINI_RES = 0.1;   // résolution de l'image de la mini-carte (réduite ou agrandie à l'affichage)
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const inset = (b, k) => ({ x: b.x + k, y: b.y + k, w: b.w - 2 * k, h: b.h - 2 * k });
  function tree(c, x, y, r, col = "#2f6b2a") {
    c.fillStyle = "rgba(0,0,0,0.3)"; circle(c, x + r * 0.3, y + r * 0.35, r);
    c.fillStyle = col; circle(c, x, y, r);
    c.fillStyle = "rgba(255,255,255,0.12)"; circle(c, x - r * 0.25, y - r * 0.25, r * 0.55);
  }
  // Rayures (portiques, barrières, auvents).
  function stripes(c, o, a, b, step = 24) {
    c.save(); c.beginPath(); c.rect(o.x, o.y, o.w, o.h); c.clip();
    c.fillStyle = a; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = b;
    const L = o.w + o.h;
    for (let k = -L; k < L; k += step) { c.beginPath(); c.moveTo(o.x + k, o.y); c.lineTo(o.x + k + step / 2, o.y); c.lineTo(o.x + k + step / 2 - o.h, o.y + o.h); c.lineTo(o.x + k - o.h, o.y + o.h); c.fill(); }
    c.restore();
  }
  // Un véhicule garé (dessin seulement) : centre, angle, couleur, échelle.
  function parkedCar(c, x, y, a, col, type = "sport", sx = 0.72, sy = 0.72) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(sx, sy);
    window.VehicleArt.paint(c, type, col, null, 0, false, false);
    c.restore();
  }
  // Un trottoir : dalles grises, bordure du côté de la rue. (sides : quels bords ont une bordure)
  function sidewalk(c, b, w = C.WALK) {
    c.fillStyle = WALK; c.fillRect(b.x, b.y, b.w, b.h);
    c.strokeStyle = "rgba(0,0,0,0.09)"; c.lineWidth = 1;
    c.beginPath();
    for (let x = b.x + 20; x < b.x + b.w - 2; x += 20) { c.moveTo(x, b.y); c.lineTo(x, b.y + Math.min(w, b.h)); c.moveTo(x, b.y + b.h - Math.min(w, b.h)); c.lineTo(x, b.y + b.h); }
    for (let y = b.y + 20; y < b.y + b.h - 2; y += 20) { c.moveTo(b.x, y); c.lineTo(b.x + Math.min(w, b.w), y); c.moveTo(b.x + b.w - Math.min(w, b.w), y); c.lineTo(b.x + b.w, y); }
    c.stroke();
    c.strokeStyle = CURB; c.lineWidth = 3; c.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
  }
  // Lampadaires (et parfois des arbres) le long d'un trottoir.
  function streetFurniture(c, b, rnd, trees) {
    const k = 6;
    const pts = [];
    for (let x = b.x + 30; x < b.x + b.w - 20; x += 110) pts.push([x, b.y + k], [x, b.y + b.h - k]);
    for (let y = b.y + 30; y < b.y + b.h - 20; y += 110) pts.push([b.x + k, y], [b.x + b.w - k, y]);
    for (const [x, y] of pts) {
      if (trees && rnd() < 0.45) { tree(c, x, y, 8 + rnd() * 3, "#2f6b2a"); continue; }
      const gr = c.createRadialGradient(x, y, 1, x, y, 30);
      gr.addColorStop(0, "rgba(255,226,140,0.32)"); gr.addColorStop(1, "rgba(255,226,140,0)");
      c.fillStyle = gr; circle(c, x, y, 30);
      c.fillStyle = "#2b2b2b"; circle(c, x, y, 3.5);
    }
  }

  // ---------------- Les formes des immeubles (tirées au hasard, mais pareil chez tout le monde) ----------------
  // Renvoie { ground, parts: [{ x, y, w, h, hgt, roof }], silos } à l'intérieur du trottoir.
  function layoutOf(b, rnd) {
    const D = DIST[b.d] || DIST.centre;
    const I = inset(b, C.WALK);
    const roofAt = (k) => D.roofs[((b.tone || 0) + k) % D.roofs.length];
    const H = b.hgt || 0.5;
    const out = { ground: null, parts: [], silos: [] };
    if (I.w < 20 || I.h < 20) return out;
    const r = rnd();
    const long = I.w >= I.h;
    if (b.kind === "warehouse") {
      if (r < 0.45 || Math.max(I.w, I.h) < 150) out.parts.push({ ...I, hgt: H, roof: roofAt(0), ware: true });
      else if (r < 0.75) {
        // Entrepôt + bureaux (plus hauts) au bout.
        const cut = (long ? I.w : I.h) * (0.68 + rnd() * 0.1);
        out.parts.push(long ? { x: I.x, y: I.y, w: cut, h: I.h, hgt: H, roof: roofAt(0), ware: true } : { x: I.x, y: I.y, w: I.w, h: cut, hgt: H, roof: roofAt(0), ware: true });
        out.parts.push(long ? { x: I.x + cut, y: I.y + I.h * 0.15, w: I.w - cut, h: I.h * 0.7, hgt: H + 0.25, roof: "#6a7480" } : { x: I.x + I.w * 0.15, y: I.y + cut, w: I.w * 0.7, h: I.h - cut, hgt: H + 0.25, roof: "#6a7480" });
      } else {
        // Entrepôt + cour de béton avec des silos.
        const cut = (long ? I.w : I.h) * 0.6;
        out.ground = "#9a958a";
        out.parts.push(long ? { x: I.x, y: I.y, w: cut, h: I.h, hgt: H, roof: roofAt(0), ware: true } : { x: I.x, y: I.y, w: I.w, h: cut, hgt: H, roof: roofAt(0), ware: true });
        const rest = long ? { x: I.x + cut, y: I.y, w: I.w - cut, h: I.h } : { x: I.x, y: I.y + cut, w: I.w, h: I.h - cut };
        const R = Math.min(rest.w, rest.h) / 4.4;
        const n = Math.max(1, Math.floor(Math.max(rest.w, rest.h) / (R * 2.4)));
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          out.silos.push(long ? { x: rest.x + rest.w / 2, y: rest.y + rest.h * t, r: R } : { x: rest.x + rest.w * t, y: rest.y + rest.h / 2, r: R });
        }
      }
      return out;
    }
    // Tours et immeubles.
    if (r < 0.28 || Math.min(I.w, I.h) < 90) {
      out.parts.push({ ...I, hgt: H, roof: roofAt(0) });
    } else if (r < 0.52) {
      // Une rangée d'immeubles de hauteurs différentes.
      const n = 2 + Math.floor(rnd() * 3), L = long ? I.w : I.h;
      let p = 0;
      for (let k = 0; k < n; k++) {
        const len = k === n - 1 ? L - p : L * (0.6 + rnd() * 0.8) / n;
        const hh = Math.min(1, H * (0.55 + rnd() * 0.6));
        out.parts.push(long ? { x: I.x + p, y: I.y, w: len, h: I.h, hgt: hh, roof: roofAt(k) } : { x: I.x, y: I.y + p, w: I.w, h: len, hgt: hh, roof: roofAt(k) });
        p += len;
      }
    } else if (r < 0.7) {
      // Une tour au milieu d'une esplanade (arbres autour).
      out.ground = "plaza";
      const sw = I.w * (0.5 + rnd() * 0.2), sh = I.h * (0.5 + rnd() * 0.2);
      out.parts.push({ x: I.x + (I.w - sw) * rnd(), y: I.y + (I.h - sh) * rnd(), w: sw, h: sh, hgt: Math.min(1, H + 0.15), roof: roofAt(0) });
    } else if (r < 0.86) {
      // Un immeuble en L, avec un jardin dans le coin.
      out.ground = "lawn";
      const tw = I.w * (0.42 + rnd() * 0.12), th = I.h * (0.42 + rnd() * 0.12);
      const cx = rnd() < 0.5, cy = rnd() < 0.5;   // coin du jardin
      out.parts.push({ x: cx ? I.x : I.x + I.w - tw, y: I.y, w: tw, h: I.h, hgt: H, roof: roofAt(0) });
      out.parts.push({ x: cx ? I.x + tw : I.x, y: cy ? I.y + I.h - th : I.y, w: I.w - tw, h: th, hgt: H * 0.8, roof: roofAt(1) });
    } else {
      // Un immeuble autour d'une cour intérieure.
      out.ground = "lawn";
      const t = Math.min(I.w, I.h) * 0.3;
      out.parts.push({ x: I.x, y: I.y, w: I.w, h: t, hgt: H, roof: roofAt(0) });
      out.parts.push({ x: I.x, y: I.y + I.h - t, w: I.w, h: t, hgt: H, roof: roofAt(0) });
      out.parts.push({ x: I.x, y: I.y + t, w: t, h: I.h - 2 * t, hgt: H, roof: roofAt(0) });
      out.parts.push({ x: I.x + I.w - t, y: I.y + t, w: t, h: I.h - 2 * t, hgt: H, roof: roofAt(0) });
    }
    return out;
  }

  function newCity() {
    cityKey = st.city.seed + ":" + st.city.n;
    city = C.build(st.city.seed, st.city.n);
    ENV = { w: city.w, h: city.h, grip: 1, oils: [], obstacles: city.obstacles, nitro: true };
    const rnd = seeded(st.city.seed ^ 0x5bd1);
    const W = city.w, H = city.h, R = C.ROAD, SW = C.WALK;
    const inWater = (x, y) => city.water.some((w) => C.inRect({ x, y }, w));
    bg = document.createElement("canvas");
    bg.width = W; bg.height = H;
    const c = bg.getContext("2d");

    // Bitume + grain.
    c.fillStyle = "#2a2c33"; c.fillRect(0, 0, W, H);
    for (let i = 0, n = (W * H) / 1000; i < n; i++) { c.fillStyle = i % 2 ? "#30323a" : "#25272d"; const s = 1 + rnd() * 2.5; c.fillRect(rnd() * W, rnd() * H, s, s); }

    // La campagne : des champs en bandes, des arbres, et un trottoir côté route.
    for (const o of city.country) {
      c.fillStyle = "#4a7a3a"; c.fillRect(o.x, o.y, o.w, o.h);
      c.fillStyle = "#527f40";
      for (let y = o.y; y < o.y + o.h; y += 36) c.fillRect(o.x, y, o.w, 18);
      for (let k = 0, n = (o.w * o.h) / 7000; k < n; k++) tree(c, o.x + 24 + rnd() * (o.w - 48), o.y + 24 + rnd() * (o.h - 48), 14 + rnd() * 12, rnd() < 0.5 ? "#2f6b2a" : "#386f2c");
      // Trottoir sur les bords qui touchent la route (pas sur le bord de la carte).
      const s = 16;
      const edges = [];
      if (o.x > 0) edges.push({ x: o.x, y: o.y, w: s, h: o.h });
      if (o.x + o.w < W) edges.push({ x: o.x + o.w - s, y: o.y, w: s, h: o.h });
      if (o.y > 0) edges.push({ x: o.x, y: o.y, w: o.w, h: s });
      if (o.y + o.h < H) edges.push({ x: o.x, y: o.y + o.h - s, w: o.w, h: s });
      for (const e of edges) { c.fillStyle = WALK; c.fillRect(e.x, e.y, e.w, e.h); }
      c.strokeStyle = CURB; c.lineWidth = 3;
      for (const e of edges) c.strokeRect(e.x + 1.5, e.y + 1.5, e.w - 3, e.h - 3);
    }

    // Les rivières (sur toute leur longueur), puis les quais et les ponts.
    for (const r of city.rivers) {
      const gr = c.createLinearGradient(r.x, 0, r.x + r.w, 0);
      gr.addColorStop(0, "#2d6aa3"); gr.addColorStop(0.5, "#3d86c6"); gr.addColorStop(1, "#2d6aa3");
      c.fillStyle = gr; c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 2;
      for (let k = 0, n = (r.w * r.h) / 5000; k < n; k++) {
        const x = r.x + rnd() * r.w, y = r.y + rnd() * r.h;
        c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 4, y + 10, x, y + 20); c.stroke();
      }
      c.fillStyle = "#8d8a84"; c.fillRect(r.x, 0, 6, H); c.fillRect(r.x + r.w - 6, 0, 6, H);
    }
    for (const w of city.water) {   // quais : un trottoir de pierre le long de l'eau
      const q = 14;
      c.fillStyle = "#c2bcae";
      c.fillRect(w.x, w.y, q, w.h); c.fillRect(w.x + w.w - q, w.y, q, w.h);
      c.fillRect(w.x, w.y, w.w, q); c.fillRect(w.x, w.y + w.h - q, w.w, q);
      c.strokeStyle = CURB; c.lineWidth = 3; c.strokeRect(w.x + 1.5, w.y + 1.5, w.w - 3, w.h - 3);
      c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 2; c.strokeRect(w.x + q, w.y + q, w.w - 2 * q, w.h - 2 * q);
    }
    for (const b of city.bridges) {
      c.fillStyle = "#33353c"; c.fillRect(b.x, b.y, b.w, b.h);
      // Garde-corps de chaque côté, sur les quais.
      c.fillStyle = "#e3ddd0"; c.fillRect(b.x, b.y - 5, b.w, 4); c.fillRect(b.x, b.y + b.h + 1, b.w, 4);
      c.fillStyle = "#777"; for (let x = b.x + 8; x < b.x + b.w; x += 40) { c.fillRect(x, b.y - 7, 4, 8); c.fillRect(x, b.y + b.h - 1, 4, 8); }
    }

    // Lignes au milieu des rues (pointillés) : 2 voies sur les boulevards et le périphérique, en sautant carrefours et eau.
    c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 4; c.setLineDash([26, 22]);
    for (let i = 0; i <= city.nx; i++) {
      const r = city.roadX(i), cx = (r.x0 + r.x1) / 2;
      const lanes = city.bvX.includes(i) ? [cx - 64, cx + 64] : i === 0 || i === city.nx ? [cx - 30, cx + 30] : [cx];
      for (let j = 0; j < city.ny; j++) {
        const y0 = city.roadY(j).y1 + 10, y1 = city.roadY(j + 1).y0 - 10;
        if (inWater(cx, (y0 + y1) / 2)) continue;
        for (const x of lanes) { c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); }
      }
    }
    for (let j = 0; j <= city.ny; j++) {
      const r = city.roadY(j), cy = (r.y0 + r.y1) / 2;
      const lanes = city.bvY.includes(j) ? [cy - 64, cy + 64] : j === 0 || j === city.ny ? [cy - 30, cy + 30] : [cy];
      for (let i = 0; i < city.nx; i++) {
        const x0 = city.roadX(i).x1 + 10, x1 = city.roadX(i + 1).x0 - 10;
        if (inWater((x0 + x1) / 2, cy)) continue;
        for (const y of lanes) { c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); }
      }
    }
    c.setLineDash([]);

    // Passages piétons aux carrefours (pas sur les boulevards ni aux ronds-points).
    c.fillStyle = "rgba(255,255,255,0.28)";
    for (let i = 0; i <= city.nx; i++) for (let j = 0; j <= city.ny; j++) {
      if (city.bvX.includes(i) || city.bvY.includes(j) || city.roundAt.has(i + "," + j)) continue;
      const x0 = city.lineX(i), y0 = city.lineY(j);
      for (let k = 0; k < 6; k++) {
        if (j < city.ny && !inWater(x0 + R / 2, y0 + R + 14)) c.fillRect(x0 + 14 + k * 22, y0 + R + 4, 12, 18);
        if (j > 0 && !inWater(x0 + R / 2, y0 - 14)) c.fillRect(x0 + 14 + k * 22, y0 - 22, 12, 18);
        if (i < city.nx && !inWater(x0 + R + 14, y0 + R / 2)) c.fillRect(x0 + R + 4, y0 + 14 + k * 22, 18, 12);
        if (i > 0 && !inWater(x0 - 14, y0 + R / 2)) c.fillRect(x0 - 22, y0 + 14 + k * 22, 18, 12);
      }
    }
    // Plaques d'égout.
    for (let k = 0; k < city.nx * city.ny * 2; k++) {
      const cell = Math.floor(rnd() * city.nav.free.length);
      if (!city.nav.free[cell]) continue;
      const p = C.centerOf(city.nav, cell);
      if (!C.inCity(city, p.x, p.y)) continue;
      c.fillStyle = "#1d1e22"; circle(c, p.x, p.y, 8);
      c.strokeStyle = "#3a3c43"; c.lineWidth = 2; c.beginPath(); c.arc(p.x, p.y, 5, 0, Math.PI * 2); c.stroke();
    }

    // Ronds-points : îlot fleuri + marquage autour.
    for (const r of city.rounds) {
      c.strokeStyle = "rgba(255,255,255,0.3)"; c.lineWidth = 3; c.setLineDash([14, 12]);
      c.beginPath(); c.arc(r.x, r.y, r.r + 26, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
      c.fillStyle = CURB; circle(c, r.x, r.y, r.r + 6);
      c.fillStyle = WALK; circle(c, r.x, r.y, r.r + 4);
      c.fillStyle = "#4f8a3c"; circle(c, r.x, r.y, r.r - 2);
      for (let k = 0; k < 10; k++) { const a = k * 0.63; c.fillStyle = k % 2 ? "#e85d75" : "#ffd23f"; circle(c, r.x + Math.cos(a) * r.r * 0.65, r.y + Math.sin(a) * r.r * 0.65, 3); }
      tree(c, r.x, r.y, r.r * 0.4);
    }
    // Terre-pleins des boulevards : bordure, herbe et une rangée d'arbres.
    for (const m of city.medians) {
      c.fillStyle = CURB; c.fillRect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
      c.fillStyle = "#4f8a3c"; c.fillRect(m.x + 1, m.y + 1, m.w - 2, m.h - 2);
      const long = Math.max(m.w, m.h);
      for (let d = 30; d < long - 10; d += 70) tree(c, m.w > m.h ? m.x + d : m.x + m.w / 2, m.w > m.h ? m.y + m.h / 2 : m.y + d, 13);
    }

    // ---------------- Les sols : places, esplanades, parkings, lotissements ----------------
    for (const p of city.parks) {
      sidewalk(c, p);
      const ban = p.d === "banlieue";
      c.fillStyle = ban ? "#3f7a3a" : "#4a8540"; c.fillRect(p.x + SW, p.y + SW, p.w - 2 * SW, p.h - 2 * SW);
      c.fillStyle = "#cfc7b2"; c.fillRect(p.x + p.w / 2 - 18, p.y + SW, 36, p.h - 2 * SW); c.fillRect(p.x + SW, p.y + p.h / 2 - 18, p.w - 2 * SW, 36);
      streetFurniture(c, p, rnd, false);
    }
    for (const p of city.plazas) {
      c.save(); c.beginPath(); c.rect(p.x, p.y, p.w, p.h); c.clip();
      c.fillStyle = "#b8b0a0"; c.fillRect(p.x, p.y, p.w, p.h);
      c.strokeStyle = "rgba(0,0,0,0.08)"; c.lineWidth = 1;
      for (let d = 0; d < Math.max(p.w, p.h); d += 20) { c.beginPath(); c.moveTo(p.x + d, p.y); c.lineTo(p.x + d, p.y + p.h); c.moveTo(p.x, p.y + d); c.lineTo(p.x + p.w, p.y + d); c.stroke(); }
      const a = p.dir > 0 ? [p.x, p.y, p.x + p.w, p.y + p.h] : [p.x, p.y + p.h, p.x + p.w, p.y];
      c.strokeStyle = CURB; c.lineWidth = 126; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.stroke();
      c.strokeStyle = "#34363d"; c.lineWidth = 118; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.stroke();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 4; c.setLineDash([26, 22]);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.stroke(); c.setLineDash([]);
      c.restore();
    }
    for (const l of city.lots) {
      if (l.kind === "parking") {
        c.fillStyle = "#34363c"; c.fillRect(l.x, l.y, l.w, l.h);
        c.fillStyle = "#2e6fd1"; c.fillRect(l.x + SW + 6, l.y + SW + 6, 28, 28);
        c.fillStyle = "#fff"; c.font = "bold 22px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("P", l.x + SW + 20, l.y + SW + 21);
      } else {
        const G = 64, hw = (l.w - G) / 2, hh = (l.h - G) / 2;
        c.fillStyle = "#c9c0aa"; c.fillRect(l.x + hw, l.y, G, l.h); c.fillRect(l.x, l.y + hh, l.w, G);
      }
    }

    // ---------------- Les bâtiments ----------------
    // 1) les sols (trottoir tout autour + cour/esplanade/jardin), 2) toutes les ombres, 3) les toits.
    const items = [];
    for (const b of city.buildings) {
      if (b.kind === "fence") {   // clôture de parking : posée sur le trottoir
        sidewalk(c, b, Math.min(b.w, b.h));
        // Le grillage, côté intérieur du parking.
        const lot = city.lots.find((l) => b.x >= l.x - 1 && b.y >= l.y - 1 && b.x + b.w <= l.x + l.w + 1 && b.y + b.h <= l.y + l.h + 1);
        c.fillStyle = "#6b6f76";
        if (b.w > b.h) c.fillRect(b.x, lot && Math.abs(b.y - lot.y) < 1 ? b.y + b.h - 4 : b.y, b.w, 4);
        else c.fillRect(lot && Math.abs(b.x - lot.x) < 1 ? b.x + b.w - 4 : b.x, b.y, 4, b.h);
        continue;
      }
      if (b.kind === "parked" || b.kind === "fountain" || b.kind === "station") continue;
      sidewalk(c, b);
      if (b.kind === "tower" || b.kind === "warehouse") {
        const L = layoutOf(b, rnd);
        const I = inset(b, SW);
        if (L.ground === "plaza") {
          c.fillStyle = "#cbc4b4"; c.fillRect(I.x, I.y, I.w, I.h);
          for (let k = 0; k < 4; k++) tree(c, I.x + 14 + rnd() * (I.w - 28), I.y + 14 + rnd() * (I.h - 28), 10 + rnd() * 5);
        } else if (L.ground === "lawn") { c.fillStyle = "#4a8540"; c.fillRect(I.x, I.y, I.w, I.h); for (let k = 0; k < 3; k++) tree(c, I.x + 14 + rnd() * (I.w - 28), I.y + 14 + rnd() * (I.h - 28), 9 + rnd() * 4); }
        else if (L.ground) { c.fillStyle = L.ground; c.fillRect(I.x, I.y, I.w, I.h); }
        streetFurniture(c, b, rnd, b.d !== "usine");
        items.push({ b, L });
      } else items.push({ b, L: null });
    }
    // Le commissariat (sol + cour du garage).
    const S = city.station;
    sidewalk(c, S);
    c.fillStyle = "#26282e"; c.fillRect(S.bay.x, S.bay.y, S.bay.w, S.bay.h);
    // Les ombres.
    c.fillStyle = "rgba(0,0,0,0.32)";
    for (const { L } of items) if (L) for (const p of L.parts) { const sh = 6 + p.hgt * 34; c.fillRect(p.x + sh * 0.5, p.y + sh, p.w, p.h); }
    for (const { L } of items) if (L) for (const s of L.silos) circle(c, s.x + s.r * 0.5, s.y + s.r * 0.7, s.r);
    { const ip = inset(S, SW); c.fillRect(ip.x + 18, ip.y + 28, ip.w, ip.h); }
    // Les toits.
    for (const { b, L } of items) {
      if (L) { for (const p of L.parts) roofOf(c, p, rnd); for (const s of L.silos) silo(c, s); }
      else drawBuilding(c, b, rnd);
    }
    drawStation(c, S);
    for (const b of city.buildings) if (b.kind === "parked" || b.kind === "fountain") drawBuilding(c, b, rnd);
    for (const t of city.trees) tree(c, t.x, t.y, t.r);

    // Portiques des raccourcis (jaune et noir) : les vans et les camions ne passent pas dessous.
    for (const g of city.gates) {
      stripes(c, g, "#ffcf3a", "#1b1b1b", 16);
      c.fillStyle = "#555";
      if (g.w > g.h) { c.fillRect(g.x - 4, g.y - 2, 8, g.h + 4); c.fillRect(g.x + g.w - 4, g.y - 2, 8, g.h + 4); }
      else { c.fillRect(g.x - 2, g.y - 4, g.w + 4, 8); c.fillRect(g.x - 2, g.y + g.h - 4, g.w + 4, 8); }
    }
    // Rues barrées (rayures rouges et blanches).
    for (const o of city.barriers) stripes(c, o, "#fff", "#e0302f");

    // Les sorties : flèches au sol et grand panneau vert.
    for (const e of city.exits) {
      const r = e.ramp, horiz = e.side % 2 === 0;
      const out = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][e.side];
      c.fillStyle = "rgba(255,255,255,0.45)";
      for (let k = 0; k < 2; k++) {
        const fx = horiz ? r.x + r.w / 2 : r.x + r.w * (0.25 + k * 0.4), fy = horiz ? r.y + r.h * (0.25 + k * 0.4) : r.y + r.h / 2;
        c.save(); c.translate(fx, fy); c.rotate(out);
        c.beginPath(); c.moveTo(26, 0); c.lineTo(-6, -22); c.lineTo(-6, -9); c.lineTo(-26, -9); c.lineTo(-26, 9); c.lineTo(-6, 9); c.lineTo(-6, 22); c.closePath(); c.fill();
        c.restore();
      }
      const sx = horiz ? r.x + r.w + 76 : r.x + r.w / 2, sy = horiz ? r.y + r.h / 2 : r.y + r.h + 56;
      c.fillStyle = "#0b7a3e"; c.fillRect(sx - 60, sy - 24, 120, 48);
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.strokeRect(sx - 56, sy - 20, 112, 40);
      c.fillStyle = "#fff"; c.font = "bold 22px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("SORTIE", sx, sy + 1);
    }
    // Bord de la carte.
    c.lineWidth = 12; c.strokeStyle = "#111"; c.strokeRect(6, 6, W - 12, H - 12);

    // ---------------- Mini-carte : rues claires, quartiers colorés ----------------
    const f = MINI_RES;
    mini = document.createElement("canvas");
    mini.width = Math.round(W * f); mini.height = Math.round(H * f);
    const mc = mini.getContext("2d");
    const mrect = (o, col) => { mc.fillStyle = col; mc.fillRect(o.x * f, o.y * f, Math.max(1.5, o.w * f), Math.max(1.5, o.h * f)); };
    mc.fillStyle = "#c4c7ce"; mc.fillRect(0, 0, mini.width, mini.height);
    for (const o of city.country) mrect(o, "#2f4a2a");
    for (const r of city.rivers) mrect(r, "#3d7fc4");
    for (const b of city.bridges) mrect(b, "#c4c7ce");
    for (const b of city.buildings) if (b.kind !== "parked") mrect(b, DIST[b.d]?.mini || "#4a5068");
    for (const p of city.lots) if (p.kind === "parking") mrect(inset(p, SW), "#7d7f86");
    for (const p of city.parks) mrect(inset(p, 10), "#5e9a4e");
    for (const r of city.rounds) { mc.fillStyle = "#5e9a4e"; mc.beginPath(); mc.arc(r.x * f, r.y * f, r.r * f, 0, Math.PI * 2); mc.fill(); }
    for (const o of city.barriers) mrect(o, "#e0302f");
    mrect(S, "#2d6bff");
    mc.fillStyle = "#fff"; mc.font = `bold ${Math.round(150 * f)}px Segoe UI, sans-serif`; mc.textAlign = "center"; mc.textBaseline = "middle";
    mc.fillText("🚓", (S.x + S.w / 2) * f, (S.y + S.h / 2) * f);
  }

  // Un toit (tour ou entrepôt) : bordure, puis héliport / piscine / panneaux solaires / jardin / climatiseurs.
  function roofOf(c, p, rnd) {
    const { x, y, w, h } = p;
    c.fillStyle = p.roof; c.fillRect(x, y, w, h);
    c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 3; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
    c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (p.ware) {
      // Tôle ondulée + verrières.
      c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = 2;
      const horiz = w > h;
      c.beginPath();
      for (let d = 6; d < (horiz ? h : w); d += 9) { if (horiz) { c.moveTo(x, y + d); c.lineTo(x + w, y + d); } else { c.moveTo(x + d, y); c.lineTo(x + d, y + h); } }
      c.stroke();
      c.fillStyle = "rgba(170,210,235,0.55)";
      for (let d = 20; d < (horiz ? w : h) - 30; d += 46) { if (horiz) c.fillRect(x + d, y + h / 2 - 8, 26, 16); else c.fillRect(x + w / 2 - 8, y + d, 16, 26); }
      if (rnd() < 0.4) { c.fillStyle = "rgba(120,60,20,0.3)"; circle(c, x + rnd() * w, y + rnd() * h, 14 + rnd() * 16); }
      return;
    }
    const r = rnd();
    const fx = x + w / 2, fy = y + h / 2, m = Math.min(w, h);
    if (m > 120 && p.hgt > 0.8 && r < 0.35) {
      c.fillStyle = "#3a3d44"; circle(c, fx, fy, m * 0.34);
      c.strokeStyle = "#ffd23f"; c.lineWidth = 4; c.beginPath(); c.arc(fx, fy, m * 0.28, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#fff"; c.font = `bold ${Math.round(m * 0.26)}px Segoe UI, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("H", fx, fy + 2);
    } else if (r < 0.5 && m > 70) {
      c.fillStyle = "#e9e4d8"; c.fillRect(fx - w * 0.3 - 4, fy - h * 0.2 - 4, w * 0.6 + 8, h * 0.4 + 8);
      c.fillStyle = "#4fb3e8"; c.fillRect(fx - w * 0.3, fy - h * 0.2, w * 0.6, h * 0.4);
      c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 2; c.beginPath(); c.moveTo(fx - w * 0.2, fy); c.quadraticCurveTo(fx, fy - 8, fx + w * 0.2, fy); c.stroke();
    } else if (r < 0.7 && m > 50) {
      c.fillStyle = "#1f3a6b";
      for (let px = x + 10; px < x + w - 28; px += 26) for (let py = y + 10; py < y + h - 20; py += 18) c.fillRect(px, py, 22, 14);
    } else if (r < 0.82 && m > 60) {
      c.fillStyle = "#4a8540"; c.fillRect(x + 8, y + 8, w - 16, h - 16);
      for (let k = 0; k < 3; k++) tree(c, x + 18 + rnd() * (w - 36), y + 18 + rnd() * (h - 36), 8 + rnd() * 4);
    }
    const n = Math.floor((w * h) / 12000) + 1;
    for (let k = 0; k < n; k++) {
      const uw = 12 + rnd() * 14, uh = 9 + rnd() * 10;
      const ux = x + 6 + rnd() * Math.max(1, w - 12 - uw), uy = y + 6 + rnd() * Math.max(1, h - 12 - uh);
      c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(ux + 3, uy + 3, uw, uh);
      c.fillStyle = rnd() < 0.5 ? "#8d939e" : "#a8a092"; c.fillRect(ux, uy, uw, uh);
    }
  }
  function silo(c, s) {
    const gr = c.createRadialGradient(s.x - s.r * 0.3, s.y - s.r * 0.3, 2, s.x, s.y, s.r);
    gr.addColorStop(0, "#d9d6cf"); gr.addColorStop(1, "#8f8b82");
    c.fillStyle = gr; circle(c, s.x, s.y, s.r);
    c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 2; c.beginPath(); c.arc(s.x, s.y, s.r * 0.5, 0, Math.PI * 2); c.stroke();
  }

  // Le commissariat : bâtiment en U, toit blanc et bleu, « POLICE », et la porte du garage côté rue.
  function drawStation(c, S) {
    const parts = city.buildings.filter((o) => o.kind === "station");
    // Un seul bâtiment (en U) : toit blanc bordé de bleu, le garage découpé dedans.
    const I = inset(S, C.WALK), B0 = S.bay;
    c.fillStyle = "#e8ecf2"; c.fillRect(I.x, I.y, I.w, I.h);
    c.strokeStyle = "#1f4fa8"; c.lineWidth = 6; c.strokeRect(I.x + 3, I.y + 3, I.w - 6, I.h - 6);
    c.fillStyle = "#26282e"; c.fillRect(B0.x, B0.y, B0.w, B0.h);
    c.strokeStyle = "#1f4fa8"; c.lineWidth = 5; c.strokeRect(B0.x - 2, B0.y - 2, B0.w + 4, B0.h + 4);
    c.fillStyle = "#26282e"; c.fillRect(B0.x, B0.y, B0.w, B0.h);
    const big = parts.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
    const bx = big.x + big.w / 2, by = big.y + big.h / 2;
    c.save(); c.translate(bx, by); if (big.h > big.w * 1.3) c.rotate(-Math.PI / 2);
    c.fillStyle = "#1f4fa8"; c.font = `bold ${Math.round(Math.min(30, Math.max(big.w, big.h) / 6))}px Segoe UI, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("POLICE", 0, 0);
    c.restore();
    c.fillStyle = "#ffd23f"; c.font = "22px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("★", big.x + 26, big.y + 26);
    // Le garage : sol, places, et la porte relevée (rayures) sur le bord du trottoir.
    const B = S.bay, horiz = S.side % 2 === 0;
    c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 2;
    c.beginPath();
    if (horiz) { c.moveTo(B.x + B.w / 2, B.y + 10); c.lineTo(B.x + B.w / 2, B.y + B.h - 10); } else { c.moveTo(B.x + 10, B.y + B.h / 2); c.lineTo(B.x + B.w - 10, B.y + B.h / 2); }
    c.stroke();
    // La porte : là où le garage touche le trottoir.
    const door = S.side === 0 ? { x: B.x, y: B.y + C.WALK - 2, w: B.w, h: 8 } : S.side === 2 ? { x: B.x, y: B.y + B.h - C.WALK - 6, w: B.w, h: 8 }
      : S.side === 1 ? { x: B.x + B.w - C.WALK - 6, y: B.y, w: 8, h: B.h } : { x: B.x + C.WALK - 2, y: B.y, w: 8, h: B.h };
    stripes(c, door, "#ffcf3a", "#1b1b1b", 12);
    // Bateau (le trottoir est abaissé devant le garage).
    c.fillStyle = "#9d9a92";
    if (S.side === 0) c.fillRect(B.x, B.y, B.w, C.WALK - 2); else if (S.side === 2) c.fillRect(B.x, B.y + B.h - C.WALK + 2, B.w, C.WALK - 2);
    else if (S.side === 1) c.fillRect(B.x + B.w - C.WALK + 2, B.y, C.WALK - 2, B.h); else c.fillRect(B.x, B.y, C.WALK - 2, B.h);
    c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = "#9fc0ff"; c.textAlign = "center"; c.textBaseline = "middle";
    c.save(); c.translate(B.x + B.w / 2, B.y + B.h / 2); if (!horiz) c.rotate(-Math.PI / 2); c.fillText("GARAGE", 0, 0); c.restore();
  }

  // Les autres bâtiments (maisons, kiosques, camions garés, fontaines).
  function drawBuilding(c, b, rnd) {
    const D = DIST[b.d] || DIST.centre;
    const roof = D.roofs[(b.tone || 0) % D.roofs.length];
    const I = inset(b, C.WALK);
    switch (b.kind) {
      case "fountain":
        c.fillStyle = "#8a8578"; circle(c, b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 6);
        c.fillStyle = "#3d8fd1"; circle(c, b.x + b.w / 2, b.y + b.h / 2, b.w / 2 - 2);
        c.fillStyle = "rgba(255,255,255,0.6)"; circle(c, b.x + b.w / 2, b.y + b.h / 2, 5);
        return;
      case "parked": {   // véhicules garés dans un parking (ils remplissent tout le rectangle qui bloque)
        const horiz = b.w > b.h, len = horiz ? b.w : b.h, thick = horiz ? b.h : b.w;
        const n = Math.max(1, Math.round(len / 64)), L = len / n;
        for (let k = 0; k < n; k++) {
          const x = horiz ? b.x + L * (k + 0.5) : b.x + b.w / 2, y = horiz ? b.y + b.h / 2 : b.y + L * (k + 0.5);
          const type = rnd() < 0.5 ? "truck" : "minivan", V = window.PatatePhysics.VEHICLES[type];
          parkedCar(c, x, y, horiz ? 0 : Math.PI / 2, CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)], type, (L - 6) / V.L, thick / V.W);
        }
        return;
      }
      case "kiosk":
        stripes(c, I, ["#e74c3c", "#f39c12", "#16a085", "#8e44ad"][(b.tone || 0) % 4], "#f4efe4", 18);
        c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 2; c.strokeRect(I.x, I.y, I.w, I.h);
        return;
      case "house":
        c.fillStyle = "#5c9446"; c.fillRect(I.x, I.y, I.w, I.h);
        if (rnd() < 0.6) tree(c, I.x + 10 + rnd() * (I.w - 20), I.y + 10 + rnd() * (I.h - 20), 9 + rnd() * 5);
        gable(c, I.x + 8, I.y + 8, I.w * 0.7, I.h * 0.65, roof);
        return;
      case "houses": {   // un pâté de maisons avec jardins, haies, piscines
        c.fillStyle = "#3d6b30"; c.fillRect(I.x, I.y, I.w, I.h);
        c.fillStyle = "#5c9446"; c.fillRect(I.x + 4, I.y + 4, I.w - 8, I.h - 8);
        const nx = I.w > 200 ? 3 : 2, ny = I.h > 200 ? 3 : 2;
        const cw = I.w / nx, ch = I.h / ny;
        c.strokeStyle = "#3d6b30"; c.lineWidth = 5; c.beginPath();
        for (let k = 1; k < nx; k++) { c.moveTo(I.x + k * cw, I.y); c.lineTo(I.x + k * cw, I.y + I.h); }
        for (let k = 1; k < ny; k++) { c.moveTo(I.x, I.y + k * ch); c.lineTo(I.x + I.w, I.y + k * ch); }
        c.stroke();
        for (let qx = 0; qx < nx; qx++) for (let qy = 0; qy < ny; qy++) {
          const x = I.x + qx * cw, y = I.y + qy * ch;
          const hw = cw * (0.45 + rnd() * 0.15), hh = ch * (0.4 + rnd() * 0.15);
          const hx = x + 8 + rnd() * (cw - hw - 16), hy = y + 8 + rnd() * (ch - hh - 16);
          if (rnd() < 0.3) { const px = hx < x + cw / 2 ? x + cw - 34 : x + 8, py = y + ch - 26; c.fillStyle = "#e9e4d8"; c.fillRect(px - 2, py - 2, 28, 20); c.fillStyle = "#4fb3e8"; c.fillRect(px, py, 24, 16); }
          else tree(c, hx < x + cw / 2 ? x + cw - 16 : x + 16, y + ch - 16, 9);
          gable(c, hx, hy, hw, hh, D.roofs[(b.tone + qx * 2 + qy) % D.roofs.length]);
        }
        return;
      }
      default: break;
    }
  }
  // Toit de maison à deux pentes (un côté plus sombre).
  function gable(c, x, y, w, h, col) {
    c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x + 5, y + 6, w, h);
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.fillStyle = "rgba(0,0,0,0.18)";
    if (w > h) c.fillRect(x, y + h / 2, w, h / 2); else c.fillRect(x + w / 2, y, w / 2, h);
    c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 2; c.beginPath();
    if (w > h) { c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); } else { c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); }
    c.stroke();
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
      if (st.flee) {
        clock.textContent = "🚪 " + mmss(Math.max(0, fleeEndLocal - Date.now()));
        clock.classList.add("urgent");
      } else {
        const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
        clock.textContent = "⏱️ " + mmss(left);
        clock.classList.toggle("urgent", st.phase === "play" && left < 10000);
      }
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
    const follow = mv || view.find((v) => v.role === "free") || view[0];
    if (follow) {
      cam = { x: Math.max(0, Math.min(W - canvas.width, follow.x - canvas.width / 2)), y: Math.max(0, Math.min(H - canvas.height, follow.y - canvas.height / 2)) };
      c.translate(-cam.x, -cam.y);
    } else {
      const s = Math.min(canvas.width / W, canvas.height / H);
      c.scale(s, s);
    }
    c.drawImage(bg, 0, 0);
    for (const e of city.exits) {
      if (!st.flee) stripes(c, e.gate, "#fff", "#e0302f");
      else { c.fillStyle = `rgba(46,204,113,${0.25 + 0.2 * Math.sin(ts / 140)})`; c.fillRect(e.ramp.x, e.ramp.y, e.ramp.w, e.ramp.h); }
    }

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

    // L'hélico : il tourne autour de sa cible. Projecteur allumé seulement quand il est assez près.
    if (st.heli) {
      const h = st.heli;
      if (h.on) {
        // Le faisceau, de l'hélico jusqu'au rond de lumière au sol.
        const ang = Math.atan2(h.sy - h.y, h.sx - h.x), R = 90;
        c.fillStyle = "rgba(255,255,220,0.07)";
        c.beginPath(); c.moveTo(h.x, h.y);
        c.lineTo(h.sx + Math.cos(ang + Math.PI / 2) * R, h.sy + Math.sin(ang + Math.PI / 2) * R);
        c.lineTo(h.sx + Math.cos(ang - Math.PI / 2) * R, h.sy + Math.sin(ang - Math.PI / 2) * R);
        c.closePath(); c.fill();
        const gr = c.createRadialGradient(h.sx, h.sy, 10, h.sx, h.sy, R + 20);
        gr.addColorStop(0, "rgba(255,255,220,0.4)"); gr.addColorStop(0.7, "rgba(255,255,220,0.18)"); gr.addColorStop(1, "rgba(255,255,220,0)");
        c.fillStyle = gr; c.beginPath(); c.arc(h.sx, h.sy, R + 20, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.ellipse(h.x + 40, h.y + 60, 30, 14, h.a, 0, Math.PI * 2); c.fill();
      c.save(); c.translate(h.x, h.y); c.rotate(h.a);
      c.fillStyle = "#1d2b4f"; c.beginPath(); c.ellipse(0, 0, 26, 14, 0, 0, Math.PI * 2); c.fill();
      c.fillRect(-48, -3, 26, 6);
      c.fillStyle = "#8fb6ff"; c.beginPath(); c.ellipse(12, 0, 9, 8, 0, 0, Math.PI * 2); c.fill();
      c.rotate(ts / 40 - h.a);
      c.strokeStyle = "rgba(220,220,220,0.8)"; c.lineWidth = 4;
      c.beginPath(); c.moveTo(-38, 0); c.lineTo(38, 0); c.moveTo(0, -38); c.lineTo(0, 38); c.stroke();
      c.restore();
    }

    if (st.flee && mv && mv.role === "free") {
      let best = null, bd = 1e9;
      for (const e of city.exits) { const z = { x: e.zone.x + e.zone.w / 2, y: e.zone.y + e.zone.h / 2 }; const d = Math.hypot(z.x - mv.x, z.y - mv.y); if (d < bd) { bd = d; best = z; } }
      const a = Math.atan2(best.y - mv.y, best.x - mv.x), pulse = 70 + 8 * Math.sin(ts / 120);
      c.save(); c.translate(mv.x + Math.cos(a) * pulse, mv.y + Math.sin(a) * pulse); c.rotate(a);
      c.fillStyle = "#2ecc71"; c.strokeStyle = "#0b3d20"; c.lineWidth = 3;
      c.beginPath(); c.moveTo(26, 0); c.lineTo(-10, -20); c.lineTo(-2, 0); c.lineTo(-10, 20); c.closePath(); c.fill(); c.stroke();
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
    } else if (st.flee && mv?.role === "free" && performance.now() - fleeSeenAt < 2500) {
      band("🚪 FUYEZ !", "Les sorties sont ouvertes : quitte la ville avant la fin ! (suis la flèche verte)", "#2ecc71");
    } else if (st.flee && st.escapes?.some((e) => e.id === me())) {
      band("🏁 ÉVADÉ !", "Tu as quitté la ville à temps. Regarde les autres…", "#2ecc71", true);
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

  // Mini-carte en haut à droite (M = la carte en grand au milieu de l'écran).
  function drawMini(view, copsView, cam) {
    if (!mini) return;
    const c = g2d, W = city.w, H = city.h;
    let f, x0, y0;
    if (bigMap) {
      f = Math.min((canvas.width * 0.88) / W, (canvas.height * 0.84) / H);
      x0 = (canvas.width - W * f) / 2; y0 = (canvas.height - H * f) / 2 + 14;
    } else {
      f = 300 / W;
      x0 = canvas.width - W * f - 12; y0 = 12;
    }
    // Ma voiture passe sous la mini-carte : elle devient transparente.
    const mv = view.find((v) => v.id === me());
    const sx = mv && cam ? mv.x - cam.x : -1, sy = mv && cam ? mv.y - cam.y : -1;
    c.save();
    if (bigMap) { c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(0, 0, canvas.width, canvas.height); }
    else if (sx > x0 - 40 && sy < y0 + H * f + 40) c.globalAlpha = 0.25;
    c.drawImage(mini, x0, y0, W * f, H * f);
    c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 2; c.strokeRect(x0, y0, W * f, H * f);
    // Les sorties (elles clignotent pendant « FUYEZ ! »).
    const lit = !st.flee || Math.floor(performance.now() / 300) % 2;
    for (const e of city.exits) {
      const r = e.ramp;
      c.fillStyle = lit ? "#2ecc71" : "#ffffff";
      c.fillRect(x0 + r.x * f, y0 + r.y * f, Math.max(5, r.w * f), Math.max(5, r.h * f));
    }
    const k = bigMap ? 1.7 : 1;
    const blink = Math.floor(performance.now() / 250) % 2;
    for (const v of copsView) { c.fillStyle = blink ? "#ff3b3b" : "#3b7bff"; c.fillRect(x0 + v.x * f - 2 * k, y0 + v.y * f - 2 * k, 4 * k, 4 * k); }
    for (const v of view) {
      c.fillStyle = v.role === "cop" ? "#5a8dff" : playerOf(v.id)?.color || "#fff";
      c.strokeStyle = "#000"; c.lineWidth = 1.5;
      c.beginPath(); c.arc(x0 + v.x * f, y0 + v.y * f, (v.role === "cop" ? 3 : 5) * k, 0, Math.PI * 2); c.fill(); c.stroke();
      if (v.id === me()) { c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(x0 + v.x * f, y0 + v.y * f, 8 * k, 0, Math.PI * 2); c.stroke(); }
    }
    c.textAlign = "center"; c.textBaseline = "middle";
    if (st.heli) { c.font = `${Math.round(14 * k)}px sans-serif`; c.fillText("🚁", x0 + st.heli.x * f, y0 + st.heli.y * f); }
    if (cam) { c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 1; c.strokeRect(x0 + cam.x * f, y0 + cam.y * f, canvas.width * f, canvas.height * f); }
    c.globalAlpha = 1;
    c.font = "bold 15px Segoe UI, sans-serif"; c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.8)"; c.fillStyle = "#fff";
    const tip = bigMap ? "🗺️ Carte de la ville · M pour fermer" : "M = carte";
    const tx = bigMap ? canvas.width / 2 : x0 + (W * f) / 2, ty = bigMap ? y0 - 16 : y0 + H * f + 14;
    c.strokeText(tip, tx, ty); c.fillText(tip, tx, ty);
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
