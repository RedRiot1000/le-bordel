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
  const TASER = 64, TASER_CD = 15000;   // (les mêmes que games/police/server.js)

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
            <li>🚔 Presque à l'arrêt pendant <b>1 s</b> avec <b>2 véhicules de police</b> autour = <b>ARRÊTÉ</b>. Tu deviens flic en <b>Lamborghini de police</b> (elle pousse fort et passe dans les ruelles) et tu aides à coincer les autres !</li>
            <li>⚡ Flic : <b>clic</b> ou <kbd>E</kbd> = <b>taser</b> droit devant. Le 1er véhicule touché (même un flic !) a le <b>moteur coupé 2 s</b>. Recharge : 15 s.</li>
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
        <span id="po-taser" class="po-taser hidden"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="po-canvas" width="${P.W}" height="${P.H}"></canvas>
        <div id="po-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro · M = carte · flic : clic / E = taser</p>
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
      canvas.addEventListener("mousedown", (e) => { if (e.button === 0) mouseDown = true; });
      window.addEventListener("mouseup", () => { mouseDown = false; });
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
    Space: K.HB, ShiftLeft: K.NITRO, ShiftRight: K.NITRO, KeyE: TASER,
  };
  let mouseDown = false;
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
    if (mouseDown) k |= TASER;
    return k;
  }
  // Moteur coupé (taser) : on ne peut plus accélérer, comme sur le serveur.
  const engineMask = (k) => (carOf(me())?.emp ? k & ~(K.UP | K.NITRO) : k);

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
    pending.forEach((p, i) => { P.simulate(pred, engineMask(p.k), envAt(pred), myBonus(), othersAt((i + 1) * P.TICK)); history.set(p.s, P.copyCar(pred)); });
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
      P.simulate(pred, engineMask(k), envAt(pred), myBonus(), othersAt(pending.length * P.TICK));
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
    // Le taser (flics) : prêt, ou le temps qu'il reste avant de pouvoir retirer.
    const mc = carOf(me());
    const tz = $("po-taser");
    tz.classList.toggle("hidden", !mc || mc.role !== "cop" || st.phase !== "play");
    if (mc && mc.role === "cop") { const t = mc.taser > 0 ? `⚡ Taser : ${(mc.taser / 1000).toFixed(1)} s` : "⚡ Taser prêt (clic / E)"; if (tz.textContent !== t) { tz.textContent = t; tz.classList.toggle("ready", mc.taser <= 0); } }
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
  //  LA VILLE (dessinée une fois par manche, à partir des tuiles)
  // ===================================================================
  const T = C.TILE, KD = C.KIND;
  // Les couleurs de chaque quartier : toits, couleur sur la mini-carte.
  const DIST = {
    centre: { roofs: ["#5b6170", "#4f5d6b", "#6a7480", "#565168", "#7a6e66", "#3f4a5c"], mini: "#4a5068" },
    usine: { roofs: ["#7a5a45", "#6d6a60", "#80705a", "#5e6a6a", "#8a6248", "#55605e"], mini: "#6b5240" },
    banlieue: { roofs: ["#a0523d", "#8c4a3a", "#b5703f", "#7a5040", "#9c5f45", "#6f4a3a"], mini: "#3f6a3a" },
  };
  const WALK = "#b5b1a7", CURB = "#8a867c";
  const TILE_COL = { [KD.ROAD]: "#2b2d34", [KD.SIDEWALK]: WALK, [KD.PLAZA]: "#c9c2b0", [KD.BRIDGE]: "#2f3138", [KD.HIGHWAY]: "#26282e",
    [KD.ALLEY]: "#3c3a3a", [KD.YARD]: "#8f8b80", [KD.RAMP]: "#2b2d34", [KD.BAY]: "#26282e", [KD.FENCE]: "#8f8b80", [KD.ISLAND]: "#2b2d34" };
  const ASPHALT = new Set([KD.ROAD, KD.BRIDGE, KD.HIGHWAY, KD.RAMP, KD.BAY]);
  const MINI_RES = 0.06;
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  function tree(c, x, y, r, col = "#2f6b2a") {
    c.fillStyle = "rgba(0,0,0,0.3)"; circle(c, x + r * 0.3, y + r * 0.35, r);
    c.fillStyle = col; circle(c, x, y, r);
    c.fillStyle = "rgba(255,255,255,0.12)"; circle(c, x - r * 0.25, y - r * 0.25, r * 0.55);
  }
  function stripes(c, o, a, b, step = 24) {
    c.save(); c.beginPath(); c.rect(o.x, o.y, o.w, o.h); c.clip();
    c.fillStyle = a; c.fillRect(o.x, o.y, o.w, o.h);
    c.fillStyle = b;
    const L = o.w + o.h;
    for (let k = -L; k < L; k += step) { c.beginPath(); c.moveTo(o.x + k, o.y); c.lineTo(o.x + k + step / 2, o.y); c.lineTo(o.x + k + step / 2 - o.h, o.y + o.h); c.lineTo(o.x + k - o.h, o.y + o.h); c.fill(); }
    c.restore();
  }
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const px = (r) => ({ x: r.x * T, y: r.y * T, w: r.w * T, h: r.h * T });

  // Un toit plat d'immeuble : bordure, puis héliport / piscine / panneaux solaires / jardin / climatiseurs.
  function roofOf(c, p, rnd) {
    const { x, y, w, h } = p;
    c.fillStyle = p.roof; c.fillRect(x, y, w, h);
    c.strokeStyle = "rgba(255,255,255,0.16)"; c.lineWidth = 3; c.strokeRect(x + 2, y + 2, w - 4, h - 4);
    c.strokeStyle = "rgba(0,0,0,0.3)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (p.ware) {
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
    const r = rnd(), fx = x + w / 2, fy = y + h / 2, m = Math.min(w, h);
    if (m > 110 && p.hgt > 0.8 && r < 0.15) {
      c.fillStyle = "#3a3d44"; circle(c, fx, fy, m * 0.34);
      c.strokeStyle = "#ffd23f"; c.lineWidth = 4; c.beginPath(); c.arc(fx, fy, m * 0.28, 0, Math.PI * 2); c.stroke();
      c.fillStyle = "#fff"; c.font = `bold ${Math.round(m * 0.26)}px Segoe UI, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("H", fx, fy + 2);
    } else if (r < 0.27 && m > 70) {
      c.fillStyle = "#e9e4d8"; c.fillRect(fx - w * 0.3 - 4, fy - h * 0.2 - 4, w * 0.6 + 8, h * 0.4 + 8);
      c.fillStyle = "#4fb3e8"; c.fillRect(fx - w * 0.3, fy - h * 0.2, w * 0.6, h * 0.4);
    } else if (r < 0.5 && m > 50) {
      c.fillStyle = "#1f3a6b";
      for (let px2 = x + 10; px2 < x + w - 28; px2 += 26) for (let py = y + 10; py < y + h - 20; py += 18) c.fillRect(px2, py, 22, 14);
    } else if (r < 0.62 && m > 60) {
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
  // Toit de maison à deux pentes.
  function gable(c, x, y, w, h, col) {
    c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x + 5, y + 6, w, h);
    c.fillStyle = col; c.fillRect(x, y, w, h);
    c.fillStyle = "rgba(0,0,0,0.18)";
    if (w > h) c.fillRect(x, y + h / 2, w, h / 2); else c.fillRect(x + w / 2, y, w / 2, h);
    c.strokeStyle = "rgba(255,255,255,0.25)"; c.lineWidth = 2; c.beginPath();
    if (w > h) { c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); } else { c.moveTo(x + w / 2, y); c.lineTo(x + w / 2, y + h); }
    c.stroke();
  }
  const shadowOf = (c, p) => { const sh = 6 + (p.hgt || 0.5) * 30; c.fillStyle = "rgba(0,0,0,0.32)"; c.fillRect(p.x + sh * 0.5, p.y + sh, p.w, p.h); };

  // ---------------- Les bâtiments d'un pâté, selon son quartier ----------------
  // Centre : un îlot d'immeubles à l'alignement de la rue (de hauteurs différentes), une cour derrière.
  function drawBlock(c, L, rnd, parts) {
    const D = DIST.centre, R = px(L);
    const depth = Math.min(Math.min(R.w, R.h) / 2, Math.min(R.w, R.h) * (0.3 + rnd() * 0.12) + 20);
    // La cour intérieure : jardin ou parking privé.
    c.fillStyle = rnd() < 0.5 ? "#4a6a3e" : "#5a5650"; c.fillRect(R.x, R.y, R.w, R.h);
    if (Math.min(R.w, R.h) > 2 * depth + 30) for (let k = 0; k < 3; k++) tree(c, R.x + depth + 15 + rnd() * (R.w - 2 * depth - 30), R.y + depth + 15 + rnd() * (R.h - 2 * depth - 30), 10 + rnd() * 6);
    // Les façades : chaque côté découpé en 1 à 4 immeubles.
    const cut = (len) => { const n = 1 + Math.floor(rnd() * Math.min(4, Math.max(1, len / 90))); const xs = [0]; for (let k = 1; k < n; k++) xs.push(Math.round((len * k) / n + (rnd() - 0.5) * len / n * 0.5)); xs.push(len); return xs; };
    const add = (x, y, w, h) => parts.push({ x, y, w, h, hgt: 0.45 + rnd() * 0.55, roof: D.roofs[Math.floor(rnd() * D.roofs.length)] });
    let xs = cut(R.w); for (let k = 0; k < xs.length - 1; k++) { add(R.x + xs[k], R.y, xs[k + 1] - xs[k], depth); add(R.x + xs[k], R.y + R.h - depth, xs[k + 1] - xs[k], depth); }
    if (R.h > 2 * depth) { xs = cut(R.h - 2 * depth); for (let k = 0; k < xs.length - 1; k++) { add(R.x, R.y + depth + xs[k], depth, xs[k + 1] - xs[k]); add(R.x + R.w - depth, R.y + depth + xs[k], depth, xs[k + 1] - xs[k]); } }
  }
  // Centre : 1 ou 2 tours sur une pelouse.
  function drawTowers(c, L, rnd, parts) {
    const D = DIST.centre, R = px(L);
    c.fillStyle = "#4a7a3e"; c.fillRect(R.x, R.y, R.w, R.h);
    const two = R.w > R.h * 1.4 || R.h > R.w * 1.4;
    const n = two ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const horiz = R.w >= R.h;
      const cw = horiz ? R.w / n : R.w, ch = horiz ? R.h : R.h / n;
      const ox = horiz ? R.x + k * cw : R.x, oy = horiz ? R.y : R.y + k * ch;
      const w = cw * (0.55 + rnd() * 0.15), h = ch * (0.55 + rnd() * 0.15);
      parts.push({ x: ox + (cw - w) / 2, y: oy + (ch - h) / 2, w, h, hgt: 0.85 + rnd() * 0.15, roof: D.roofs[Math.floor(rnd() * D.roofs.length)] });
    }
    for (let k = 0; k < 5; k++) tree(c, R.x + 14 + rnd() * (R.w - 28), R.y + 14 + rnd() * (R.h - 28), 9 + rnd() * 5);
  }
  // Usine : un grand entrepôt (quais de chargement sur un côté).
  function drawWarehouse(c, L, rnd, parts, factory) {
    const D = DIST.usine, R = px(L);
    c.fillStyle = "#77736a"; c.fillRect(R.x, R.y, R.w, R.h);
    const m = 12;
    const p = { x: R.x + m, y: R.y + m, w: R.w - 2 * m, h: R.h - 2 * m, hgt: factory ? 0.55 : 0.35 + rnd() * 0.15, roof: D.roofs[Math.floor(rnd() * D.roofs.length)], ware: !factory };
    parts.push(p);
    if (factory) {
      // Cheminées et cuves.
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) parts.push({ chimney: true, x: p.x + p.w * (0.2 + rnd() * 0.6), y: p.y + p.h * (0.2 + rnd() * 0.6), r: 14 + rnd() * 8 });
    }
  }
  // Banlieue : des maisons alignées le long des rues, avec jardins et haies.
  function drawHouses(c, L, rnd, parts, cul) {
    const D = DIST.banlieue, R = px(L);
    c.fillStyle = "#5c9446"; c.fillRect(R.x, R.y, R.w, R.h);
    const lotsAlong = (x0, y0, len, horiz, front) => {
      const n = Math.max(1, Math.round(len / 120));
      const lw = len / n;
      for (let k = 0; k < n; k++) {
        const x = horiz ? x0 + k * lw : x0, y = horiz ? y0 : y0 + k * lw;
        // haie entre deux jardins
        c.strokeStyle = "#3d6b30"; c.lineWidth = 5; c.beginPath();
        if (horiz) { c.moveTo(x, y); c.lineTo(x, y + front * 1); } else { c.moveTo(x, y); c.lineTo(x + front, y); }
        c.stroke();
        const hw = lw * (0.55 + rnd() * 0.15), hd = Math.abs(front) * (0.5 + rnd() * 0.15);
        const set = 18;
        const hx = horiz ? x + (lw - hw) / 2 : front > 0 ? x + set : x + front - set - hd;
        const hy = horiz ? (front > 0 ? y + set : y + front - set - hd) : y + (lw - hw) / 2;
        parts.push({ house: true, x: hx, y: hy, w: horiz ? hw : hd, h: horiz ? hd : hw, roof: D.roofs[Math.floor(rnd() * D.roofs.length)] });
        if (rnd() < 0.3) {
          const bx = horiz ? x + lw * 0.2 : front > 0 ? x + Math.abs(front) * 0.75 : x + front * 0.75 - 26;
          const by = horiz ? (front > 0 ? y + Math.abs(front) * 0.75 : y + front * 0.75 - 18) : y + lw * 0.25;
          c.fillStyle = "#e9e4d8"; c.fillRect(bx - 2, by - 2, 30, 22); c.fillStyle = "#4fb3e8"; c.fillRect(bx, by, 26, 18);
        } else tree(c, horiz ? x + lw * 0.8 : x + front * 0.8, horiz ? y + front * 0.8 : y + lw * 0.8, 10);
      }
    };
    // Des maisons sur les 4 côtés (chacune face à sa rue), jardins vers l'intérieur.
    const dp = Math.min(Math.min(R.w, R.h) / 2, 115);
    lotsAlong(R.x, R.y, R.w, true, dp);
    if (R.h > dp + 40) lotsAlong(R.x, R.y + R.h, R.w, true, -dp);
    if (R.h > 2 * dp + 60) { lotsAlong(R.x, R.y + dp, R.h - 2 * dp, false, Math.min(dp, R.w / 2)); lotsAlong(R.x + R.w, R.y + dp, R.h - 2 * dp, false, -Math.min(dp, R.w / 2)); }
  }
  function drawPark(c, L, rnd) {
    const R = px(L);
    c.fillStyle = "#3f7a3a"; c.fillRect(R.x, R.y, R.w, R.h);
    c.strokeStyle = "#2c5a28"; c.lineWidth = 6; c.strokeRect(R.x + 3, R.y + 3, R.w - 6, R.h - 6);
    c.strokeStyle = "#cfc7b2"; c.lineWidth = 10; c.beginPath(); c.moveTo(R.x, R.y + R.h * 0.3); c.quadraticCurveTo(R.x + R.w * 0.5, R.y + R.h * 0.9, R.x + R.w, R.y + R.h * 0.5); c.stroke();
    if (R.w > 150 && R.h > 120) { c.fillStyle = "#2d6aa3"; c.beginPath(); c.ellipse(R.x + R.w * 0.65, R.y + R.h * 0.35, R.w * 0.15, R.h * 0.12, 0, 0, Math.PI * 2); c.fill(); }
    for (let k = 0; k < (R.w * R.h) / 5000; k++) tree(c, R.x + 16 + rnd() * (R.w - 32), R.y + 16 + rnd() * (R.h - 32), 12 + rnd() * 8);
  }
  function drawField(c, L) {
    const R = px(L);
    c.fillStyle = "#3f8a3a"; c.fillRect(R.x, R.y, R.w, R.h);
    c.fillStyle = "#48963f"; for (let k = 0; k < R.w; k += 30) c.fillRect(R.x + k, R.y, 15, R.h);
    c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 3;
    c.strokeRect(R.x + 12, R.y + 12, R.w - 24, R.h - 24);
    c.beginPath(); if (R.w > R.h) { c.moveTo(R.x + R.w / 2, R.y + 12); c.lineTo(R.x + R.w / 2, R.y + R.h - 12); } else { c.moveTo(R.x + 12, R.y + R.h / 2); c.lineTo(R.x + R.w - 12, R.y + R.h / 2); } c.stroke();
    c.beginPath(); c.arc(R.x + R.w / 2, R.y + R.h / 2, Math.min(R.w, R.h) * 0.15, 0, Math.PI * 2); c.stroke();
  }
  function drawStationLot(c, S) {
    const I = { x: S.x + 8, y: S.y + 8, w: S.w - 16, h: S.h - 16 };
    c.fillStyle = "rgba(0,0,0,0.32)"; c.fillRect(I.x + 18, I.y + 28, I.w, I.h);
    c.fillStyle = "#e8ecf2"; c.fillRect(I.x, I.y, I.w, I.h);
    c.strokeStyle = "#1f4fa8"; c.lineWidth = 6; c.strokeRect(I.x + 3, I.y + 3, I.w - 6, I.h - 6);
    const B = S.bay;
    c.fillStyle = "#26282e"; c.fillRect(B.x, B.y, B.w, B.h);
    c.strokeStyle = "#1f4fa8"; c.lineWidth = 4; c.strokeRect(B.x - 2, B.y - 2, B.w + 4, B.h + 4);
    c.fillStyle = "#26282e"; c.fillRect(B.x, B.y, B.w, B.h);
    c.strokeStyle = "rgba(255,255,255,0.4)"; c.lineWidth = 2; c.beginPath(); c.moveTo(B.x + 10, B.y + B.h / 2); c.lineTo(B.x + B.w - 10, B.y + B.h / 2); c.stroke();
    const door = S.side === 3 ? { x: B.x + 4, y: B.y, w: 8, h: B.h } : { x: B.x + B.w - 12, y: B.y, w: 8, h: B.h };
    stripes(c, door, "#ffcf3a", "#1b1b1b", 12);
    const big = S.side === 3 ? { x: B.x + B.w, w: I.x + I.w - B.x - B.w } : { x: I.x, w: B.x - I.x };
    c.fillStyle = "#1f4fa8"; c.font = `bold ${Math.round(Math.min(32, big.w / 5))}px Segoe UI, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
    c.fillText("POLICE", big.x + big.w / 2, I.y + I.h / 2);
    c.fillStyle = "#ffd23f"; c.font = "22px sans-serif"; c.fillText("★", I.x + 22, I.y + 22);
  }

  function newCity() {
    cityKey = st.city.seed + ":" + st.city.n;
    city = C.build(st.city.seed, st.city.n);
    ENV = { w: city.w, h: city.h, grip: 1, oils: [], obstacles: city.obstacles, nitro: true };
    const rnd = seeded(st.city.seed ^ 0x5bd1);
    const W = city.w, H = city.h, { TW, TH, grid } = city;
    const kAt = (i, j) => (i < 0 || j < 0 || i >= TW || j >= TH ? KD.GROUND : grid[j * TW + i]);
    bg = document.createElement("canvas");
    bg.width = W; bg.height = H;
    const c = bg.getContext("2d");

    // 1) La campagne : des champs en patchwork, des bois.
    c.fillStyle = "#4a7a3a"; c.fillRect(0, 0, W, H);
    const crops = ["#5a8a40", "#6f9a48", "#8a9a50", "#4f7e3a", "#9a8a50", "#6a8a3a"];
    for (let k = 0; k < (W * H) / 90000; k++) {
      const fw = 200 + rnd() * 400, fh = 160 + rnd() * 300, fx = rnd() * W, fy = rnd() * H;
      c.fillStyle = crops[Math.floor(rnd() * crops.length)]; c.fillRect(fx, fy, fw, fh);
      c.strokeStyle = "rgba(0,0,0,0.08)"; c.lineWidth = 2;
      for (let d = 8; d < fh; d += 14) { c.beginPath(); c.moveTo(fx, fy + d); c.lineTo(fx + fw, fy + d); c.stroke(); }
    }
    // 2) Les tuiles (rangée par rangée, par morceaux de même sorte).
    for (let j = 0; j < TH; j++) {
      let i = 0;
      while (i < TW) {
        const k = grid[j * TW + i];
        let n = 1;
        while (i + n < TW && grid[j * TW + i + n] === k) n++;
        if (k === KD.WATER) { c.fillStyle = "#2d6aa3"; c.fillRect(i * T, j * T, n * T, T); }
        else if (k !== KD.GROUND) {
          c.fillStyle = TILE_COL[k] || "#2b2d34"; c.fillRect(i * T, j * T, n * T, T);
          // Sous les ponts : l'eau sur les côtés (garde-corps dessinés plus loin).
        }
        i += n;
      }
    }
    // Grain du bitume.
    for (let k = 0; k < (W * H) / 900; k++) {
      const x = rnd() * W, y = rnd() * H;
      if (!ASPHALT.has(C.kindAt(city, x, y))) continue;
      c.fillStyle = k % 2 ? "#33353c" : "#24262b"; const s = 1 + rnd() * 2; c.fillRect(x, y, s, s);
    }
    // 3) Trottoirs : dalles + bordures côté rue ; garde-corps des ponts côté eau ; berges.
    const roadish = (k) => ASPHALT.has(k) || k === KD.ALLEY;
    c.lineWidth = 1;
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = grid[j * TW + i], x = i * T, y = j * T;
      if (k === KD.SIDEWALK) {
        c.strokeStyle = "rgba(0,0,0,0.08)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
        c.fillStyle = CURB;
        if (roadish(kAt(i, j - 1))) c.fillRect(x, y, T, 3);
        if (roadish(kAt(i, j + 1))) c.fillRect(x, y + T - 3, T, 3);
        if (roadish(kAt(i - 1, j))) c.fillRect(x, y, 3, T);
        if (roadish(kAt(i + 1, j))) c.fillRect(x + T - 3, y, 3, T);
      } else if (k === KD.BRIDGE) {
        c.fillStyle = "#d9d4c8";
        if (kAt(i, j - 1) === KD.WATER) c.fillRect(x, y, T, 5);
        if (kAt(i, j + 1) === KD.WATER) c.fillRect(x, y + T - 5, T, 5);
        if (kAt(i - 1, j) === KD.WATER) c.fillRect(x, y, 5, T);
        if (kAt(i + 1, j) === KD.WATER) c.fillRect(x + T - 5, y, 5, T);
      } else if (k === KD.WATER) {
        c.fillStyle = "#8d8a84";
        if (kAt(i - 1, j) === KD.GROUND) c.fillRect(x, y, 6, T);
        if (kAt(i + 1, j) === KD.GROUND) c.fillRect(x + T - 6, y, 6, T);
      }
    }
    // 4) Marquages : ligne au milieu des rues (pas dans les carrefours), passages piétons à l'entrée des carrefours.
    const inter = (r, t) => {
      // Au point t (en tuiles) le long de la rue : les deux tuiles juste à côté de la rue sont-elles de la route ? (= carrefour)
      const rd = (k) => k === KD.ROAD || k === KD.BRIDGE || k === KD.HIGHWAY;
      if (r.horiz) { const i = r.x + t; return rd(kAt(i, r.y - 1)) || rd(kAt(i, r.y + r.h)); }
      const j = r.y + t; return rd(kAt(r.x - 1, j)) || rd(kAt(r.x + r.w, j));
    };
    for (const r of city.roads) {
      if (r.kind === "culdesac") continue;
      const len = r.horiz ? r.w : r.h, across = r.horiz ? r.h : r.w;
      const wide = r.kind === "avenue" || r.kind === "access" || r.kind === "ring" || r.kind === "link";
      let prev = true;
      for (let t = 0; t < len; t++) {
        const it = inter(r, t);
        const x = r.horiz ? (r.x + t) * T : r.x * T, y = r.horiz ? r.y * T : (r.y + t) * T;
        if (!it) {
          c.fillStyle = wide ? "rgba(255,210,80,0.55)" : "rgba(255,255,255,0.4)";
          if (r.horiz) { const cy = y + (across * T) / 2; if (wide) { c.fillRect(x, cy - 4, T, 2); c.fillRect(x, cy + 2, T, 2); } else if (t % 2 === 0) c.fillRect(x + 4, cy - 2, T - 8, 4); }
          else { const cx = x + (across * T) / 2; if (wide) { c.fillRect(cx - 4, y, 2, T); c.fillRect(cx + 2, y, 2, T); } else if (t % 2 === 0) c.fillRect(cx - 2, y + 4, 4, T - 8); }
        }
        // Passage piéton juste avant / après un carrefour.
        if (it !== prev && t > 0 && wide) {
          const zt = it ? t - 1 : t;
          const zx = r.horiz ? (r.x + zt) * T : r.x * T, zy = r.horiz ? r.y * T : (r.y + zt) * T;
          c.fillStyle = "rgba(255,255,255,0.32)";
          for (let k = 0; k < across * 2 - 1; k++) { if (r.horiz) c.fillRect(zx + 6, zy + 4 + k * 15, T - 12, 9); else c.fillRect(zx + 4 + k * 15, zy + 6, 9, T - 12); }
        }
        prev = it;
      }
    }
    // 5) Les pâtés : jardins, cours, puis ombres et toits.
    const parts = [];
    let stationDrawn = false;
    for (const lot of city.lots) {
      switch (lot.type) {
        case "block": drawBlock(c, lot, rnd, parts); break;
        case "towers": drawTowers(c, lot, rnd, parts); break;
        case "warehouse": drawWarehouse(c, lot, rnd, parts, false); break;
        case "factory": drawWarehouse(c, lot, rnd, parts, true); break;
        case "houses": drawHouses(c, lot, rnd, parts); break;
        case "park": drawPark(c, lot, rnd); break;
        case "field": drawField(c, lot); break;
        case "culdesac": {
          // Les maisons autour de l'impasse : on dessine le terrain (hors route) comme un lotissement.
          const R = px(lot);
          c.fillStyle = "#5c9446"; c.fillRect(R.x, R.y, R.w, R.h);
          const cu = lot.cul;
          c.fillStyle = TILE_COL[KD.ROAD]; c.fillRect(cu.sx * T, cu.sy * T, cu.sw * T, cu.sh * T); c.fillRect(cu.x * T, cu.y * T, cu.w * T, cu.h * T);
          c.fillStyle = "#4f8a3c"; circle(c, (cu.x + cu.w / 2) * T, (cu.y + cu.h / 2) * T, 26);
          // Maisons tout autour, dans les tuiles de terrain.
          for (let j = lot.y; j < lot.y + lot.h; j += 3) for (let i = lot.x; i < lot.x + lot.w; i += 3) {
            let ok = true;
            for (let jj = j; jj < Math.min(j + 3, lot.y + lot.h); jj++) for (let ii = i; ii < Math.min(i + 3, lot.x + lot.w); ii++) if (kAt(ii, jj) !== KD.GROUND) ok = false;
            if (!ok || i + 3 > lot.x + lot.w || j + 3 > lot.y + lot.h) continue;
            if (rnd() < 0.75) parts.push({ house: true, x: i * T + 12, y: j * T + 12, w: 3 * T - 24, h: 3 * T - 30, roof: DIST.banlieue.roofs[Math.floor(rnd() * 6)] });
            else tree(c, i * T + 45, j * T + 45, 12);
          }
          break;
        }
        case "yard": {
          // La cour : grillage (sur les tuiles de clôture), conteneurs.
          const R = px(lot);
          c.strokeStyle = "#5d6168"; c.lineWidth = 4; c.strokeRect(R.x + T / 2, R.y + T / 2, R.w - T, R.h - T);
          c.strokeStyle = "rgba(200,200,210,0.5)"; c.lineWidth = 1; c.strokeRect(R.x + T / 2 + 3, R.y + T / 2 + 3, R.w - T - 6, R.h - T - 6);
          for (const ct of lot.cont) {
            const cr = px(ct);
            c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(cr.x + 4, cr.y + 5, cr.w, cr.h);
            c.fillStyle = ["#b0413e", "#2e6fa8", "#3e8a4a", "#c8902a"][Math.floor(rnd() * 4)]; c.fillRect(cr.x + 1, cr.y + 1, cr.w - 2, cr.h - 2);
            c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1;
            for (let k = 6; k < Math.max(cr.w, cr.h); k += 6) { c.beginPath(); if (cr.w > cr.h) { c.moveTo(cr.x + k, cr.y + 2); c.lineTo(cr.x + k, cr.y + cr.h - 2); } else { c.moveTo(cr.x + 2, cr.y + k); c.lineTo(cr.x + cr.w - 2, cr.y + k); } c.stroke(); }
          }
          // Les entrées de la cour (on y roule) : bandes jaunes au sol.
          break;
        }
        case "plaza": {
          const R = px(lot);
          c.strokeStyle = "rgba(0,0,0,0.07)"; c.lineWidth = 1;
          for (let d = 0; d < Math.max(R.w, R.h); d += 20) { c.beginPath(); c.moveTo(R.x + d, R.y); c.lineTo(R.x + d, R.y + R.h); c.moveTo(R.x, R.y + d); c.lineTo(R.x + R.w, R.y + d); c.stroke(); }
          break;
        }
        case "fountain": {
          const R = px(lot), cx = R.x + R.w / 2, cy = R.y + R.h / 2;
          c.fillStyle = "#8a8578"; circle(c, cx, cy, R.w / 2 + 4);
          c.fillStyle = "#3d8fd1"; circle(c, cx, cy, R.w / 2 - 6);
          c.fillStyle = "rgba(255,255,255,0.6)"; circle(c, cx, cy, 6);
          break;
        }
        case "fill": {
          const R = px(lot);
          parts.push({ x: R.x, y: R.y, w: R.w, h: R.h, hgt: 0.45 + rnd() * 0.5, roof: DIST.centre.roofs[Math.floor(rnd() * DIST.centre.roofs.length)] });
          break;
        }
        case "station": stationDrawn = true; break;
        default: break;
      }
    }
    for (const p of parts) if (!p.house && !p.chimney) shadowOf(c, p);
    for (const p of parts) {
      if (p.house) gable(c, p.x, p.y, p.w, p.h, p.roof);
      else if (p.chimney) {
        c.fillStyle = "rgba(0,0,0,0.35)"; circle(c, p.x + 10, p.y + 16, p.r);
        c.fillStyle = "#7a6a5a"; circle(c, p.x, p.y, p.r);
        c.fillStyle = "#2a2522"; circle(c, p.x, p.y, p.r * 0.6);
      } else roofOf(c, p, rnd);
    }
    if (stationDrawn && city.station) drawStationLot(c, city.station);
    // 6) Arbres dans la campagne (jamais sur une route).
    for (let k = 0; k < (W * H) / 25000; k++) {
      const x = rnd() * W, y = rnd() * H;
      if (C.kindAt(city, x, y) !== KD.GROUND || C.inRect({ x, y }, city.cityRect)) continue;
      if ([[22, 0], [-22, 0], [0, 22], [0, -22]].some(([a, b]) => C.kindAt(city, x + a, y + b) !== KD.GROUND)) continue;
      tree(c, x, y, 14 + rnd() * 10, rnd() < 0.5 ? "#2f6b2a" : "#386f2c");
    }
    // 7) Portiques des raccourcis (les vans et les camions ne passent pas dessous).
    for (const g of city.gates) {
      stripes(c, g, "#ffcf3a", "#1b1b1b", 16);
      c.fillStyle = "#555";
      if (g.w > g.h) { c.fillRect(g.x - 4, g.y - 3, 8, g.h + 6); c.fillRect(g.x + g.w - 4, g.y - 3, 8, g.h + 6); }
      else { c.fillRect(g.x - 3, g.y - 4, g.w + 6, 8); c.fillRect(g.x - 3, g.y + g.h - 4, g.w + 6, 8); }
    }
    // 8) Les sorties : flèches au sol et panneau vert.
    for (const e of city.exits) {
      const r = e.ramp, out = e.side === 3 ? Math.PI : 0;
      c.fillStyle = "rgba(255,255,255,0.45)";
      for (let k = 0; k < 2; k++) {
        c.save(); c.translate(r.x + r.w * (0.25 + k * 0.4), r.y + r.h / 2); c.rotate(out);
        c.beginPath(); c.moveTo(26, 0); c.lineTo(-6, -22); c.lineTo(-6, -9); c.lineTo(-26, -9); c.lineTo(-26, 9); c.lineTo(-6, 9); c.lineTo(-6, 22); c.closePath(); c.fill();
        c.restore();
      }
      const sx = r.x + r.w / 2, sy = r.y - 40;
      c.fillStyle = "#0b7a3e"; c.fillRect(sx - 60, sy - 24, 120, 48);
      c.strokeStyle = "#fff"; c.lineWidth = 3; c.strokeRect(sx - 56, sy - 20, 112, 40);
      c.fillStyle = "#fff"; c.font = "bold 22px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("SORTIE", sx, sy + 1);
    }
    c.lineWidth = 12; c.strokeStyle = "#111"; c.strokeRect(6, 6, W - 12, H - 12);

    // ---------------- Mini-carte : routes claires, quartiers colorés ----------------
    const f = MINI_RES;
    mini = document.createElement("canvas");
    mini.width = Math.round(W * f); mini.height = Math.round(H * f);
    const mc = mini.getContext("2d");
    mc.fillStyle = "#2f4a2a"; mc.fillRect(0, 0, mini.width, mini.height);
    { const t = city.cityRect; mc.fillStyle = DIST.centre.mini; mc.fillRect(t.x * f, t.y * f, t.w * f, t.h * f); }
    const MCOL = { [KD.WATER]: "#3d7fc4", [KD.ISLAND]: "#5e9a4e" };
    for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
      const k = grid[j * TW + i];
      if (k === KD.GROUND || k === KD.FENCE) continue;
      mc.fillStyle = MCOL[k] || (k === KD.SIDEWALK || k === KD.PLAZA || k === KD.YARD ? "rgba(196,199,206,0.5)" : "#c4c7ce");
      mc.fillRect(i * T * f, j * T * f, T * f + 0.5, T * f + 0.5);
    }
    if (city.station) { const S = city.station; mc.fillStyle = "#2d6bff"; mc.fillRect(S.x * f, S.y * f, S.w * f, S.h * f); mc.fillStyle = "#fff"; mc.font = `bold ${Math.round(170 * f)}px Segoe UI, sans-serif`; mc.textAlign = "center"; mc.textBaseline = "middle"; mc.fillText("🚓", (S.x + S.w / 2) * f, (S.y + S.h / 2) * f); }
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
        return { ...o, id: car.id, role: car.role, arrest: car.arrest, emp: car.emp, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a };
      }
      return { ...shownCar(car), role: car.role, arrest: car.arrest, emp: car.emp };
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
      if (v.emp) zapArcs(c, v.x, v.y, ts, 30);
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
    // Les éclairs du taser en vol.
    for (const b of st.shots || []) {
      const a = Math.atan2(b.vy, b.vx), ahead = Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
      const x = b.x + b.vx * ahead, y = b.y + b.vy * ahead;
      c.save(); c.translate(x, y); c.rotate(a);
      const gr = c.createRadialGradient(0, 0, 2, 0, 0, 22);
      gr.addColorStop(0, "rgba(160,220,255,0.9)"); gr.addColorStop(1, "rgba(80,160,255,0)");
      c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 22, 0, Math.PI * 2); c.fill();
      c.strokeStyle = "#e8f6ff"; c.lineWidth = 3; c.beginPath(); c.moveTo(-34, 0);
      for (let k = 1; k <= 6; k++) c.lineTo(-34 + k * 7, (Math.random() - 0.5) * 10);
      c.stroke();
      c.restore();
    }
    // Les voitures qui viennent d'être touchées : un gros éclair.
    for (const z of st.zaps || []) {
      const car = st.cars.find((x) => x.id === z.target);
      if (car) zapArcs(c, car.x, car.y, ts, 50);
    }

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
    } else if (mv && carOf(me())?.emp) {
      band("⚡ MOTEUR COUPÉ !", "Un taser t'a touché : tu ne peux plus accélérer pendant 2 s…", "#7cc8ff", true);
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

  // Des arcs électriques autour d'une voiture.
  function zapArcs(c, x, y, ts, r) {
    c.save();
    c.strokeStyle = "rgba(170,225,255,0.9)"; c.lineWidth = 2;
    c.shadowColor = "#5ab4ff"; c.shadowBlur = 10;
    for (let k = 0; k < 4; k++) {
      const a0 = Math.random() * Math.PI * 2;
      c.beginPath(); c.moveTo(x + Math.cos(a0) * 8, y + Math.sin(a0) * 8);
      for (let s = 1; s <= 4; s++) { const a = a0 + (Math.random() - 0.5) * 0.9; c.lineTo(x + Math.cos(a) * (8 + (r * s) / 4), y + Math.sin(a) * (8 + (r * s) / 4)); }
      c.stroke();
    }
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
