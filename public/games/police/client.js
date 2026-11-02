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
  // Les couleurs de chaque quartier : trottoir, toits, couleur sur la mini-carte.
  const DIST = {
    centre: { walk: "#a7a296", roofs: ["#5b6170", "#4f5d6b", "#6a7480", "#565168"], mini: "#4a5068" },
    usine: { walk: "#8f8a7e", roofs: ["#7a5a45", "#6d6a60", "#80705a", "#5e6a6a"], mini: "#6b5240" },
    banlieue: { walk: "#5c9446", roofs: ["#a0523d", "#8c4a3a", "#b5703f", "#7a5040"], mini: "#3f6a3a" },
  };
  const CAR_COLORS = ["#c0392b", "#2e86de", "#f1c40f", "#ecf0f1", "#7f8c8d", "#27ae60", "#8e44ad", "#d35400", "#2c3e50"];
  const MINI_RES = 0.12;   // résolution de l'image de la mini-carte (réduite ou agrandie à l'affichage)
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
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
  // Une voiture garée (dessin seulement) : centre, angle, couleur, taille.
  function parkedCar(c, x, y, a, col, type = "sport", sx = 0.72, sy = 0.72) {
    c.save(); c.translate(x, y); c.rotate(a); c.scale(sx, sy);
    window.VehicleArt.paint(c, type, col, null, 0, false, false);
    c.restore();
  }

  function newCity() {
    cityKey = st.city.seed + ":" + st.city.n;
    city = C.build(st.city.seed, st.city.n);
    ENV = { w: city.w, h: city.h, grip: 1, oils: [], obstacles: city.obstacles, nitro: true };
    const rnd = seeded(st.city.seed ^ 0x5bd1);
    const W = city.w, H = city.h, R = C.ROAD;
    const inWater = (x, y) => city.water.some((w) => C.inRect({ x, y }, w));
    bg = document.createElement("canvas");
    bg.width = W; bg.height = H;
    const c = bg.getContext("2d");

    // Bitume + grain.
    c.fillStyle = "#2a2c33"; c.fillRect(0, 0, W, H);
    for (let i = 0, n = (W * H) / 900; i < n; i++) { c.fillStyle = i % 2 ? "#30323a" : "#25272d"; const s = 1 + rnd() * 2.5; c.fillRect(rnd() * W, rnd() * H, s, s); }

    // La campagne : des champs en bandes et des arbres.
    for (const o of city.country) {
      c.fillStyle = "#4a7a3a"; c.fillRect(o.x, o.y, o.w, o.h);
      c.fillStyle = "#527f40";
      for (let y = o.y; y < o.y + o.h; y += 36) c.fillRect(o.x, y, o.w, 18);
      for (let k = 0, n = (o.w * o.h) / 7000; k < n; k++) tree(c, o.x + 20 + rnd() * (o.w - 40), o.y + 20 + rnd() * (o.h - 40), 14 + rnd() * 12, rnd() < 0.5 ? "#2f6b2a" : "#386f2c");
    }

    // La rivière (sur toute sa longueur), puis les ponts par-dessus.
    {
      const r = city.river;
      c.fillStyle = "#c9c2b0"; c.fillRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);        // quais
      const gr = r.vertical ? c.createLinearGradient(r.x, 0, r.x + r.w, 0) : c.createLinearGradient(0, r.y, 0, r.y + r.h);
      gr.addColorStop(0, "#2d6aa3"); gr.addColorStop(0.5, "#3d86c6"); gr.addColorStop(1, "#2d6aa3");
      c.fillStyle = gr; c.fillRect(r.x, r.y, r.w, r.h);
      c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 2;
      for (let k = 0, n = (r.w * r.h) / 5000; k < n; k++) {
        const x = r.x + rnd() * r.w, y = r.y + rnd() * r.h;
        c.beginPath();
        if (r.vertical) { c.moveTo(x, y); c.quadraticCurveTo(x + 4, y + 10, x, y + 20); } else { c.moveTo(x, y); c.quadraticCurveTo(x + 10, y + 4, x + 20, y); }
        c.stroke();
      }
    }
    for (const b of city.bridges) {
      c.fillStyle = "#8d8a84"; c.fillRect(b.x, b.y - (b.vertical ? 8 : 0), b.w + (b.vertical ? 0 : 0), b.h + (b.vertical ? 16 : 0));
      if (!b.vertical) { c.fillRect(b.x - 8, b.y, b.w + 16, b.h); }
      c.fillStyle = "#33353c"; c.fillRect(b.x, b.y, b.w, b.h);
      c.fillStyle = "#d9d4c8";   // garde-corps
      if (b.vertical) { c.fillRect(b.x, b.y - 6, b.w, 5); c.fillRect(b.x, b.y + b.h + 1, b.w, 5); }
      else { c.fillRect(b.x - 6, b.y, 5, b.h); c.fillRect(b.x + b.w + 1, b.y, 5, b.h); }
    }

    // Lignes au milieu des rues (pointillés) : 2 voies sur les boulevards, en sautant carrefours et eau.
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
    // Bords du périphérique (ligne continue).
    c.strokeStyle = "rgba(255,255,255,0.5)"; c.lineWidth = 3;
    c.strokeRect(C.OUT + 10, C.OUT + 10, W - 2 * C.OUT - 20, H - 2 * C.OUT - 20);

    // Passages piétons aux carrefours (pas sur les boulevards ni aux ronds-points).
    c.fillStyle = "rgba(255,255,255,0.24)";
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
      c.fillStyle = "#d8d2c2"; circle(c, r.x, r.y, r.r + 5);
      c.fillStyle = "#4f8a3c"; circle(c, r.x, r.y, r.r);
      for (let k = 0; k < 10; k++) { const a = k * 0.63; c.fillStyle = k % 2 ? "#e85d75" : "#ffd23f"; circle(c, r.x + Math.cos(a) * r.r * 0.65, r.y + Math.sin(a) * r.r * 0.65, 3); }
      tree(c, r.x, r.y, r.r * 0.4);
    }
    // Terre-pleins des boulevards : de l'herbe et une rangée d'arbres.
    for (const m of city.medians) {
      c.fillStyle = "#d8d2c2"; c.fillRect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
      c.fillStyle = "#4f8a3c"; c.fillRect(m.x, m.y, m.w, m.h);
      const long = Math.max(m.w, m.h);
      for (let d = 30; d < long - 10; d += 70) tree(c, m.w > m.h ? m.x + d : m.x + m.w / 2, m.w > m.h ? m.y + m.h / 2 : m.y + d, 13);
    }

    // Les sols : places, esplanades, parkings, lotissements.
    for (const p of city.parks) {
      const ban = p.d === "banlieue";
      c.fillStyle = "#b9b4a6"; c.fillRect(p.x, p.y, p.w, p.h);
      c.fillStyle = ban ? "#3f7a3a" : "#4a8540"; c.fillRect(p.x + 14, p.y + 14, p.w - 28, p.h - 28);
      c.fillStyle = "#c9c2b0"; c.fillRect(p.x + p.w / 2 - 20, p.y + 14, 40, p.h - 28); c.fillRect(p.x + 14, p.y + p.h / 2 - 20, p.w - 28, 40);
    }
    for (const p of city.plazas) {
      c.save(); c.beginPath(); c.rect(p.x, p.y, p.w, p.h); c.clip();
      c.fillStyle = "#b8b0a0"; c.fillRect(p.x, p.y, p.w, p.h);
      c.strokeStyle = "rgba(0,0,0,0.08)"; c.lineWidth = 1;
      for (let d = 0; d < p.w; d += 20) { c.beginPath(); c.moveTo(p.x + d, p.y); c.lineTo(p.x + d, p.y + p.h); c.moveTo(p.x, p.y + d); c.lineTo(p.x + p.w, p.y + d); c.stroke(); }
      const a = p.dir > 0 ? [p.x, p.y, p.x + p.w, p.y + p.h] : [p.x, p.y + p.h, p.x + p.w, p.y];
      c.strokeStyle = "#34363d"; c.lineWidth = 120; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.stroke();
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 4; c.setLineDash([26, 22]);
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(a[2], a[3]); c.stroke(); c.setLineDash([]);
      c.restore();
    }
    for (const l of city.lots) {
      if (l.kind === "parking") {
        c.fillStyle = "#34363c"; c.fillRect(l.x, l.y, l.w, l.h);
        c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 2;
        for (let d = 20; d < (l.vert ? l.h : l.w); d += 44) {
          c.beginPath();
          if (l.vert) { c.moveTo(l.x + 12, l.y + d); c.lineTo(l.x + 70, l.y + d); c.moveTo(l.x + l.w - 70, l.y + d); c.lineTo(l.x + l.w - 12, l.y + d); }
          else { c.moveTo(l.x + d, l.y + 12); c.lineTo(l.x + d, l.y + 70); c.moveTo(l.x + d, l.y + l.h - 70); c.lineTo(l.x + d, l.y + l.h - 12); }
          c.stroke();
        }
        c.fillStyle = "#2e6fd1"; c.fillRect(l.x + 14, l.y + 14, 30, 30);
        c.fillStyle = "#fff"; c.font = "bold 24px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("P", l.x + 29, l.y + 30);
      } else {
        const G = 64, hw = (l.w - G) / 2, hh = (l.h - G) / 2;
        c.fillStyle = "#c9c0aa"; c.fillRect(l.x + hw, l.y, G, l.h); c.fillRect(l.x, l.y + hh, l.w, G);
      }
    }

    // Immeubles : d'abord toutes les ombres (les grands immeubles en font de plus longues), puis les toits.
    const SW = 22;   // largeur du trottoir autour des immeubles
    const isBig = (b) => b.kind === "tower" || b.kind === "warehouse" || b.kind === "station";
    for (const b of city.buildings) {
      if (!isBig(b)) continue;
      const sh = 8 + (b.hgt || 0.5) * 34;
      c.fillStyle = "rgba(0,0,0,0.32)"; c.fillRect(b.x + SW + sh * 0.5, b.y + SW + sh, b.w - 2 * SW, b.h - 2 * SW);
    }
    for (const b of city.buildings) drawBuilding(c, b, rnd, SW);
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
      const sx = horiz ? r.x + r.w + 70 : r.x + r.w / 2, sy = horiz ? r.y + r.h / 2 : r.y + r.h + 50;
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
    mrect(city.river, "#3d7fc4");
    for (const b of city.bridges) mrect(b, "#c4c7ce");
    for (const b of city.blocks) mrect(b, DIST[b.d].mini);
    for (const p of city.plazas) mrect(p, "#c4c7ce");
    for (const p of city.parks) mrect({ x: p.x + 10, y: p.y + 10, w: p.w - 20, h: p.h - 20 }, "#5e9a4e");
    // Les ruelles et passages (entre deux bâtiments) en clair.
    for (const b of city.buildings) if (b.kind === "house" || b.kind === "fence") mrect(b, DIST[b.d].mini);
    for (const r of city.rounds) { mc.fillStyle = "#5e9a4e"; mc.beginPath(); mc.arc(r.x * f, r.y * f, r.r * f, 0, Math.PI * 2); mc.fill(); }
    for (const o of city.barriers) mrect(o, "#e0302f");
    const s = city.station;
    mrect(s, "#2d6bff");
    mc.fillStyle = "#fff"; mc.font = `bold ${Math.round(150 * f)}px Segoe UI, sans-serif`; mc.textAlign = "center"; mc.textBaseline = "middle";
    mc.fillText("🚓", (s.x + s.w / 2) * f, (s.y + s.h / 2) * f);
  }

  // Un bâtiment selon son type (tour, entrepôt, maison, commissariat…).
  function drawBuilding(c, b, rnd, SW) {
    const D = DIST[b.d] || DIST.centre;
    const roof = D.roofs[(b.tone || 0) % 4];
    switch (b.kind) {
      case "fountain":
        c.fillStyle = "#8a8578"; circle(c, b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 6);
        c.fillStyle = "#3d8fd1"; circle(c, b.x + b.w / 2, b.y + b.h / 2, b.w / 2 - 2);
        c.fillStyle = "rgba(255,255,255,0.6)"; circle(c, b.x + b.w / 2, b.y + b.h / 2, 5);
        return;
      case "fence":
        c.fillStyle = "#5d6168"; c.fillRect(b.x, b.y, b.w, b.h);
        c.fillStyle = "#9aa0a8"; c.fillRect(b.x + 3, b.y + 3, Math.max(1, b.w - 6), Math.max(1, b.h - 6));
        return;
      case "parked": {   // camions garés dans un parking
        const horiz = b.w > b.h;
        const n = Math.max(1, Math.round((horiz ? b.w : b.h) / 60));
        for (let k = 0; k < n; k++) {
          const L = (horiz ? b.w : b.h) / n;
          const x = horiz ? b.x + L * (k + 0.5) : b.x + b.w / 2, y = horiz ? b.y + b.h / 2 : b.y + L * (k + 0.5);
          parkedCar(c, x, y, horiz ? Math.PI / 2 : 0, CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)], "truck", (horiz ? b.h : b.w) / 70, (horiz ? Math.min(L, b.h) : Math.min(L, b.w)) / 36);
        }
        return;
      }
      case "kiosk":
        c.fillStyle = D.walk; c.fillRect(b.x, b.y, b.w, b.h);
        stripes(c, { x: b.x + 10, y: b.y + 10, w: b.w - 20, h: b.h - 20 }, ["#e74c3c", "#f39c12", "#16a085", "#8e44ad"][(b.tone || 0) % 4], "#f4efe4", 18);
        c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 2; c.strokeRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
        return;
      case "house":
        c.fillStyle = D.walk; c.fillRect(b.x, b.y, b.w, b.h);
        if (rnd() < 0.6) tree(c, b.x + 14 + rnd() * (b.w - 28), b.y + 14 + rnd() * (b.h - 28), 10 + rnd() * 6);
        gable(c, b.x + 16, b.y + 16, b.w - 32, b.h - 32, roof);
        return;
      case "houses": {   // un pâté de maisons avec jardins et haies
        c.fillStyle = "#3d6b30"; c.fillRect(b.x, b.y, b.w, b.h);
        c.fillStyle = D.walk; c.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
        c.strokeStyle = "#3d6b30"; c.lineWidth = 6;
        c.beginPath(); c.moveTo(b.x + b.w / 2, b.y); c.lineTo(b.x + b.w / 2, b.y + b.h); c.moveTo(b.x, b.y + b.h / 2); c.lineTo(b.x + b.w, b.y + b.h / 2); c.stroke();
        const hw = b.w / 2, hh = b.h / 2;
        for (const [qx, qy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const x = b.x + qx * hw, y = b.y + qy * hh;
          if (rnd() < 0.35) { c.fillStyle = "#4fb3e8"; c.fillRect(x + hw * 0.55, y + hh * 0.55, hw * 0.3, hh * 0.25); c.strokeStyle = "#e9e4d8"; c.lineWidth = 3; c.strokeRect(x + hw * 0.55, y + hh * 0.55, hw * 0.3, hh * 0.25); }
          else tree(c, x + hw * 0.72, y + hh * 0.72, 11);
          gable(c, x + 16, y + 16, hw * 0.55, hh * 0.5, D.roofs[(b.tone + qx + qy) % 4]);
        }
        return;
      }
      case "station": {
        c.fillStyle = "#a7a296"; c.fillRect(b.x, b.y, b.w, b.h);
        const x = b.x + 14, y = b.y + 14, w = b.w - 28, h = b.h - 28;
        c.fillStyle = "#e8ecf2"; c.fillRect(x, y, w, h);
        c.strokeStyle = "#1f4fa8"; c.lineWidth = 8; c.strokeRect(x + 4, y + 4, w - 8, h - 8);
        c.fillStyle = "#1f4fa8"; c.font = `bold ${Math.min(34, w / 6)}px Segoe UI, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText("POLICE", x + w / 2, y + h / 2);
        c.fillStyle = "#ffd23f"; c.font = "22px sans-serif"; c.fillText("★", x + 22, y + 22);
        // La cour : places de parking.
        const yd = city.station.yard;
        c.fillStyle = "#2f3138"; c.fillRect(yd.x, yd.y, yd.w, yd.h);
        c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 2;
        const along = yd.w > yd.h;
        for (let k = 1; k < 6; k++) {
          c.beginPath();
          if (along) { const xx = yd.x + (k * yd.w) / 6; c.moveTo(xx, yd.y + 6); c.lineTo(xx, yd.y + yd.h * 0.35); }
          else { const yy = yd.y + (k * yd.h) / 6; c.moveTo(yd.x + 6, yy); c.lineTo(yd.x + yd.w * 0.35, yy); }
          c.stroke();
        }
        return;
      }
      default: break;
    }
    // Tours et entrepôts : trottoir (voitures garées, lampadaires), toit.
    c.fillStyle = D.walk; c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = "rgba(0,0,0,0.12)"; c.fillRect(b.x + SW - 4, b.y + SW - 4, b.w - 2 * SW + 8, b.h - 2 * SW + 8);
    // Voitures garées le long du trottoir.
    const sides = [
      [b.x + SW / 2, b.y + 30, b.x + SW / 2, b.y + b.h - 30, Math.PI / 2],
      [b.x + b.w - SW / 2, b.y + 30, b.x + b.w - SW / 2, b.y + b.h - 30, Math.PI / 2],
      [b.x + 30, b.y + SW / 2, b.x + b.w - 30, b.y + SW / 2, 0],
      [b.x + 30, b.y + b.h - SW / 2, b.x + b.w - 30, b.y + b.h - SW / 2, 0],
    ];
    for (const [x0, y0, x1, y1, a] of sides) {
      const len = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d < len; d += 50) {
        if (rnd() > 0.3) continue;
        parkedCar(c, x0 + ((x1 - x0) * d) / len, y0 + ((y1 - y0) * d) / len, a + (rnd() < 0.5 ? Math.PI : 0), CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)], "sport", 0.66, 0.66);
      }
    }
    // Lampadaires aux coins.
    for (const [x, y] of [[b.x + 6, b.y + 6], [b.x + b.w - 6, b.y + 6], [b.x + 6, b.y + b.h - 6], [b.x + b.w - 6, b.y + b.h - 6]]) {
      const gr = c.createRadialGradient(x, y, 1, x, y, 30);
      gr.addColorStop(0, "rgba(255,226,140,0.35)"); gr.addColorStop(1, "rgba(255,226,140,0)");
      c.fillStyle = gr; circle(c, x, y, 30);
      c.fillStyle = "#2b2b2b"; circle(c, x, y, 4);
    }
    const x = b.x + SW, y = b.y + SW, w = b.w - 2 * SW, h = b.h - 2 * SW;
    if (w < 10 || h < 10) return;
    c.fillStyle = roof; c.fillRect(x, y, w, h);
    c.strokeStyle = "rgba(255,255,255,0.14)"; c.lineWidth = 3; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
    if (b.kind === "warehouse") {
      // Tôle ondulée + verrières.
      c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = 2;
      const horiz = w > h;
      for (let d = 6; d < (horiz ? h : w); d += 9) { c.beginPath(); if (horiz) { c.moveTo(x, y + d); c.lineTo(x + w, y + d); } else { c.moveTo(x + d, y); c.lineTo(x + d, y + h); } c.stroke(); }
      c.fillStyle = "rgba(170,210,235,0.55)";
      for (let d = 20; d < (horiz ? w : h) - 30; d += 46) { if (horiz) c.fillRect(x + d, y + h / 2 - 8, 26, 16); else c.fillRect(x + w / 2 - 8, y + d, 16, 26); }
      if (rnd() < 0.4) { c.fillStyle = "rgba(120,60,20,0.3)"; circle(c, x + rnd() * w, y + rnd() * h, 14 + rnd() * 16); }
      return;
    }
    // Toit de tour : héliport, piscine, panneaux solaires, jardin… et des climatiseurs.
    const r = rnd();
    const fx = x + w / 2, fy = y + h / 2;
    if (w > 120 && h > 120 && b.hgt > 0.85 && r < 0.4) {
      c.fillStyle = "#3a3d44"; circle(c, fx, fy, Math.min(w, h) * 0.32);
      c.strokeStyle = "#ffd23f"; c.lineWidth = 4; c.beginPath(); c.arc(fx, fy, Math.min(w, h) * 0.27, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#fff"; c.font = `bold ${Math.round(Math.min(w, h) * 0.26)}px Segoe UI, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("H", fx, fy + 2);
    } else if (r < 0.55 && w > 60 && h > 60) {
      c.fillStyle = "#e9e4d8"; c.fillRect(fx - w * 0.3 - 4, fy - h * 0.2 - 4, w * 0.6 + 8, h * 0.4 + 8);
      c.fillStyle = "#4fb3e8"; c.fillRect(fx - w * 0.3, fy - h * 0.2, w * 0.6, h * 0.4);
      c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 2; c.beginPath(); c.moveTo(fx - w * 0.2, fy); c.quadraticCurveTo(fx, fy - 8, fx + w * 0.2, fy); c.stroke();
    } else if (r < 0.75) {
      c.fillStyle = "#1f3a6b";
      for (let px = x + 12; px < x + w - 30; px += 26) for (let py = y + 12; py < y + h - 22; py += 18) c.fillRect(px, py, 22, 14);
    } else if (r < 0.88) {
      c.fillStyle = "#4a8540"; c.fillRect(x + 10, y + 10, w - 20, h - 20);
      for (let k = 0; k < 4; k++) tree(c, x + 20 + rnd() * (w - 40), y + 20 + rnd() * (h - 40), 9 + rnd() * 5);
    }
    const n = Math.floor((w * h) / 12000) + 1;
    for (let k = 0; k < n; k++) {
      const uw = 14 + rnd() * 16, uh = 10 + rnd() * 12;
      const ux = x + 8 + rnd() * Math.max(1, w - 16 - uw), uy = y + 8 + rnd() * Math.max(1, h - 16 - uh);
      c.fillStyle = "rgba(0,0,0,0.25)"; c.fillRect(ux + 3, uy + 3, uw, uh);
      c.fillStyle = rnd() < 0.5 ? "#8d939e" : "#a8a092"; c.fillRect(ux, uy, uw, uh);
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
