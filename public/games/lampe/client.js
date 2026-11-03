// ===================================================================
//  LAMPE TORCHE — Client (s'affiche dans le hub Le Bordel)
//  - Le manoir (jardin + cave) est refait ici à partir de sa seed (manor.js).
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Le noir : un calque sombre percé par les lumières (lampes, lustres, lune,
//    éclairs) ; pour un fantôme, aussi par son cône de regard.
//  - Viseur RELATIF à mon bonhomme (lampe ou regard), souris capturée au 1er clic.
// ===================================================================

(() => {
  const H = window.Pieton;
  const M = window.Manoir;
  const K = H.K;
  const W = 1280, HGT = 800;
  const GHOST_SPEED = 1.1, LIT_SLOW = 0.55, WEB_SLOW = 0.6;   // (les mêmes que games/lampe/server.js)
  const AIM_MAX = 320;
  const ZOOM_HUMAN = 1.3;   // les humains voient de plus près (le fantôme garde la vue large)

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, wakeLocal = 0, flashLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, dark = null, dctx = null;
  let manor = null, manorKey = null, bg = null;
  let doorsOpen = [], closedDoors = [], blockers = [], rectsNow = [], litRooms = new Map(), websAlive = [];

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 150, oy: 0, left: false };
  let particles = [], waves = [], trails = [], trailAt = 0;
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0, wasGhost = null, ghostFlash = 0, lastFlashId = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  const TEMPLATE = `
    <div id="lt-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">👻</span>
        <h1>LAMPE TORCHE</h1>
        <p class="tagline">Un manoir dans le noir. Ta lampe se vide. Et il y a quelque chose derrière toi…</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="lt-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>👻 Un joueur est le <b>fantôme</b> : invisible dans le noir. Il voit dans son <b>cône de regard</b> (pas à travers les murs)… et les <b>lampes allumées de partout</b>. Chaque humain touché devient fantôme !</li>
            <li>🔦 Un fantôme dans ta lampe est <b>visible et ralenti</b> ; éclairé <b>1,5 s</b>, il est <b>étourdi</b>. 🔋 La lampe se vide : <b>clic</b> pour l'éteindre, ramasse des piles.</li>
            <li>🚪 <kbd>Espace</kbd> près d'une porte : la claquer (un fantôme met 2 s à la défoncer). Près d'un interrupteur : allumer le lustre 20 s. Sinon : pousser.</li>
            <li>🏚️ Jardin sous la lune, cave par les escaliers, passages secrets, planches qui craquent, toiles d'araignée, éclairs…</li>
            <li>🏆 Humain : +1 toutes les 15 s, <b>+3</b> si tu tiens jusqu'au bout. Fantôme : <b>+2</b> par humain attrapé.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="lt-start" class="btn btn-primary btn-big">Entrer dans le manoir</button>
        <p id="lt-hint" class="muted"></p>
        <p id="lt-error" class="error-msg"></p>
        <button id="lt-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="lt-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="lt-round"></span>
        <span id="lt-role" class="ch-role"></span>
        <span id="lt-clock" class="cf-clock"></span>
      </div>
      <div class="ch-sub">
        <div id="lt-humans" class="ch-mice"></div>
        <div id="lt-bat" class="pt-nitro lt-bat" title="Batterie de la lampe"><span>🔋</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="lt-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="lt-feed" class="so-feed"></ul>
        <div id="lt-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · souris = viser · clic = lampe on/off · Espace = porte / interrupteur / pousser · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.lampe = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; waves = []; trails = []; manorKey = null; wasGhost = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-night");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("lt-canvas");
      g2d = canvas.getContext("2d");
      dark = document.createElement("canvas"); dark.width = W; dark.height = HGT; dctx = dark.getContext("2d");
      $("lt-start").onclick = () => {
        $("lt-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("lt-error").textContent = r.error; });
      };
      $("lt-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => { pressed.clear(); mouse.left = false; });
      window.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); wasGhost = null; trails = []; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      wakeLocal = Date.now() + (st.wakeIn || 0);
      if (st.flashId !== lastFlashId) { if (st.flashLeft > 0) { flashLocal = performance.now() + st.flashLeft; shake = Math.max(shake, 6); } lastFlashId = st.flashId; }
      if (!["play", "countdown"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") {
        $("lt-play").classList.add("hidden");
        $("lt-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("lt-setup").classList.add("hidden");
      $("lt-play").classList.remove("hidden");
      if (st.manor && st.manor.seed + ":" + st.manor.n !== manorKey) newManor();
      syncWorld();
      const mine = heroOf(me());
      if (mine && wasGhost === false && mine.ghost) ghostFlash = 3;
      if (mine) wasGhost = mine.ghost;
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
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", onUp);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
      bg = manor = null;
    },
  };

  // Les portes, lustres et toiles d'araignée du moment.
  function syncWorld() {
    if (!manor) return;
    const ds = st.doors || "";
    const changed = ds !== doorsOpen.map((o) => (o ? "1" : "0")).join("");
    if (changed) {
      doorsOpen = manor.doors.map((d, i) => ds[i] !== "0");
      closedDoors = manor.doors.filter((d, i) => !doorsOpen[i]);
      blockers = M.blockers(manor, closedDoors);
      rectsNow = manor.rects.concat(closedDoors);
    }
    litRooms = new Map((st.lit || []).map(([id, left]) => [id, performance.now() + left]));
    websAlive = manor.webs.map((w, i) => (st.webs || "")[i] !== "0");
  }

  // ===================================================================
  //  CLAVIER + SOURIS
  // ===================================================================
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    if (document.pointerLockElement === canvas) { mouse.ox += e.movementX * k; mouse.oy += e.movementY * k; }
    else {
      if (e.target !== canvas) return;
      const p = myScreen();
      if (!p) return;
      mouse.ox = (e.clientX - r.left) * k - p.x; mouse.oy = (e.clientY - r.top) * (HGT / r.height) - p.y;
    }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  function onDown(e) {
    if (e.button !== 0) return;
    // Le 1er clic capture la souris (il n'allume/éteint pas la lampe).
    if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
    mouse.left = true;
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.left) k |= K.FIRE;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const envFor = (sc) => ({
    walls: true, w: manor.w, h: manor.h, rects: rectsNow, push: !sc.ghost, noDash: true,
    speedMul: sc.ghost ? GHOST_SPEED * (sc.slow && !sc.immune ? LIT_SLOW : 1) : sc.web >= 0 ? WEB_SLOW : 1,
  });
  const moveBits = (k, sc) => (sc.frozen || sc.dazed ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH));
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving() || !manor) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = H.copy(sc);
    const E = envFor(sc);
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k, sc), p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      // (un escalier ou un passage secret : on saute, sans glisser)
      if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } else { off.x = 0; off.y = 0; prevPred = null; }
    }
  }
  function driveLocal(dt) {
    if (!pred || !driving()) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    const sc = heroOf(me());
    if (!sc) return;
    const E = envFor(sc);
    while (acc >= H.TICK) {
      const k = keyMask();
      const a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k, sc), a, E, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  // Les humains se bousculent entre eux ; un fantôme traverse tout le monde.
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    const mine = heroOf(me());
    if (!mine || mine.ghost) return [];
    return st.heroes.filter((h) => h.id !== me() && !h.ghost).map((h) => H.extrapolate(h, t));
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
  //  EFFETS
  // ===================================================================
  const FX_COL = { catch: ["#b48cff", "#e9e0ff"], daze: ["#ffe27a", "#fff6c9"], pile: ["#5cff9d", "#d4ffe5"], push: ["#ffffff", "#cfd8e6"],
    bang: ["#c08a50", "#6b4527"], secret: ["#b48cff", "#6b4a9e"], stairs: ["#cfc2a8", "#8d7f66"], web: ["#e8e8e8", "#bbbbbb"], switch: ["#ffe27a", "#fff"], door: ["#c08a50", "#6b4527"] };
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      // Une planche qui craque : une onde (les fantômes la voient de partout).
      if (f.kind === "creak") { waves.push({ x: f.x, y: f.y, t: performance.now() }); continue; }
      const n = f.kind === "catch" ? 40 : f.kind === "daze" || f.kind === "bang" ? 26 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (f.kind === "catch" ? 260 : 160);
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.5, max: 0.8, r: 1.5 + Math.random() * 3, col: FX_COL[f.kind]?.[i % 2] || "#fff" });
      }
      if (f.kind === "catch") shake = 9;
      if (f.kind === "bang" || f.kind === "door") shake = Math.max(shake, 4);
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("lt-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"], [8, "8"]])}</div>
      <div class="setting-block"><label>Durée d'une manche</label>${chips("duration", [[60, "1 min"], [90, "1 min 30"], [120, "2 min"]])}</div>
      <p class="settings-note">Un nouveau manoir à chaque manche. Le fantôme de départ change à chaque fois.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("lt-start").style.display = host ? "" : "none";
    $("lt-start").disabled = n < 2;
    $("lt-finish-setup").classList.toggle("hidden", !host);
    $("lt-hint").textContent = !host ? "En attente que l'hôte ouvre la porte du manoir…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} joueurs : 1 fantôme, ${n - 1} humain${n > 2 ? "s" : ""}`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("lt-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = heroOf(me());
    const where = mine && manor ? { cave: " · 🕳️ cave", jardin: " · 🌙 jardin", manoir: "" }[M.zoneOf(manor, mine.x, mine.y)] : "";
    const txt = (!mine ? "👀 Tu regardes" : mine.ghost ? "👻 FANTÔME : attrape les humains !" : "🔦 HUMAIN : survis !") + where;
    const role = $("lt-role");
    if (role.textContent !== txt) { role.textContent = txt; role.className = "ch-role " + (mine?.ghost ? "cop" : "free"); }
    const hum = st.heroes.filter((h) => !h.ghost);
    const html = `<span class="muted">🔦 Humains :</span> ${hum.map((h) => `<span class="ch-tag ${h.id === me() ? "me" : ""}" style="border-color:${playerOf(h.id)?.color}">${esc(pseudoOf(h.id))}</span>`).join("") || "<b>plus personne</b>"}
      <span class="muted po-copcount">👻 ${st.heroes.length - hum.length}</span>`;
    if ($("lt-humans").innerHTML !== html) $("lt-humans").innerHTML = html;
    $("lt-bat").classList.toggle("hidden", !mine || mine.ghost || st.phase !== "play");
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("lt-feed").innerHTML !== feed) $("lt-feed").innerHTML = feed;
  }

  function renderOver() {
    const ov = $("lt-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.survivors.length === 0 ? "👻 Les fantômes ont gagné !"
      : lr.survivors.length === 1 ? `🔦 ${esc(pseudoOf(lr.survivors[0]))} a survécu !` : `🔦 ${lr.survivors.length} humains ont survécu !`;
    const ids = Object.keys(lr.gains).filter((id) => playerOf(id));
    const rows = ids.sort((a, b) => (lr.gains[b] || 0) - (lr.gains[a] || 0)).map((id) => {
      const how = (id === lr.startGhost ? "👻 fantôme de départ" : lr.survivors.includes(id) ? "🔦 a tenu jusqu'au bout" : `👻 attrapé à ${mmss(lr.caught[id] || 0)}`)
        + (lr.catches[id] ? ` · 👋 ${lr.catches[id]} attrapé${lr.catches[id] > 1 ? "s" : ""}` : "");
      return `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="muted">${how}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`;
    }).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="lt-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="lt-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="lt-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="lt-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="lt-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="lt-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="lt-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="lt-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="lt-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("lt-next") && ($("lt-next").onclick = () => api.action("next"));
    $("lt-again") && ($("lt-again").onclick = () => api.action("start").then((r) => { if (r.error) $("lt-over-error").textContent = r.error; }));
    $("lt-to-setup") && ($("lt-to-setup").onclick = () => api.action("setup"));
    $("lt-finish") && ($("lt-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Lampe torche ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  LE MANOIR (dessiné une fois par manche)
  // ===================================================================
  const circle = window.ManoirArt.circle;

  function newManor() {
    manorKey = st.manor.seed + ":" + st.manor.n;
    manor = M.build(st.manor.seed, st.manor.n);
    doorsOpen = []; closedDoors = []; blockers = M.blockers(manor, []); rectsNow = manor.rects;
    bg = window.ManoirArt.paint(manor, st.manor.seed);
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("lt-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("lt-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    const clock = $("lt-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
      clock.textContent = "⏱️ " + mmss(left);
      clock.classList.toggle("urgent", st.phase === "play" && left < 10000);
    }
    const mine = heroOf(me());
    const bar = document.querySelector("#lt-bat i");
    if (bar && mine) { bar.style.width = Math.round(mine.bat * 100) + "%"; $("lt-bat").classList.toggle("low", mine.bat < 0.25); $("lt-bat").classList.toggle("on", !!mine.lamp); }
    draw(ts, dt);
  }

  // Le fantôme : un drap qui flotte, deux yeux. Étourdi : des étoiles qui tournent.
  function ghostArt(c, v, ts, alpha, lit) {
    c.save();
    c.translate(v.x, v.y + Math.sin(ts / 300 + v.x) * 2);
    c.globalAlpha = alpha;
    const R = 19;
    const gr = c.createRadialGradient(0, 0, 4, 0, 0, R * 1.8);
    gr.addColorStop(0, "rgba(200,190,255,0.35)"); gr.addColorStop(1, "rgba(200,190,255,0)");
    c.fillStyle = gr; circle(c, 0, 0, R * 1.8);
    c.fillStyle = v.dazed ? "#fff7d6" : "#f1eeff";
    c.beginPath();
    c.arc(0, -4, R, Math.PI, 0);
    c.lineTo(R, R - 2);
    for (let k = 0; k < 4; k++) {
      const x0 = R - (k + 0.5) * (R * 2 / 4), wob = Math.sin(ts / 120 + k) * 3;
      c.quadraticCurveTo(x0 + 4, R + 6 + wob, x0 - (R / 4), R - 2);
    }
    c.closePath(); c.fill();
    c.strokeStyle = "rgba(90,70,160,0.5)"; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = "#1b1030";
    if (v.dazed) {
      c.strokeStyle = "#1b1030"; c.lineWidth = 2;
      for (const ex of [-7, 7]) { c.beginPath(); c.arc(ex, -6, 4, 0, Math.PI * 1.6); c.stroke(); }
      c.fillStyle = "#ffd23f"; c.font = "12px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      for (let k = 0; k < 3; k++) { const a = ts / 250 + k * 2.1; c.fillText("★", Math.cos(a) * 22, -26 + Math.sin(a) * 6); }
    } else {
      // Les yeux regardent où il regarde.
      const lx = Math.cos(v.aim || 0) * 2.5, ly = Math.sin(v.aim || 0) * 2.5;
      c.beginPath(); c.ellipse(-7 + lx, -6 + ly, 4, 6, 0, 0, Math.PI * 2); c.ellipse(7 + lx, -6 + ly, 4, 6, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(0, 6, 4, 5, 0, 0, Math.PI * 2); c.fill();
    }
    if (lit > 0 && !v.dazed) {
      c.strokeStyle = "rgba(255,226,122,0.3)"; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, R + 9, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = "#ffe27a"; c.beginPath(); c.arc(0, 0, R + 9, -Math.PI / 2, -Math.PI / 2 + lit * Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  // Ce qui bouge dans le décor : portes, interrupteurs, toiles d'araignée, piles, traces d'ectoplasme.
  function drawDynamic(c, ts) {
    window.ManoirArt.dynamic(c, manor, doorsOpen, litRooms, websAlive);
    for (const p of st.piles || []) pileArt(c, p.x, p.y);
    // Traces d'ectoplasme : elles brillent quelques secondes, seulement dans la lumière.
    const now = performance.now();
    trails = trails.filter((t) => now - t.t < 3000);
    for (const t of trails) { c.fillStyle = `rgba(140,255,200,${0.35 * (1 - (now - t.t) / 3000)})`; c.beginPath(); c.ellipse(t.x, t.y, 7, 4, t.a, 0, Math.PI * 2); c.fill(); }
  }

  function draw(ts, dt) {
    const c = g2d;
    const mine = heroOf(me());
    const iAmGhost = !!mine?.ghost;
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, aim: Math.atan2(mouse.oy, mouse.ox) }; }
      return { ...shownHero(h), ghost: h.ghost, lamp: h.lamp, seen: h.seen, moon: h.moon, exp: h.exp, dazed: h.dazed, frozen: h.frozen, lit: h.lit, aim: h.aim, bat: h.bat };
    });
    // Traces des fantômes.
    if (ts - trailAt > 180 && st.phase === "play") {
      trailAt = ts;
      for (const v of views) if (v.ghost && Math.hypot(v.vx, v.vy) > 40) trails.push({ x: v.x, y: v.y + 14, a: Math.atan2(v.vy, v.vx), t: performance.now() });
    }
    const mv = views.find((v) => v.id === me());
    const follow = mv || views.find((v) => !v.ghost) || views[0];
    const Z = zoomNow(iAmGhost);
    const { camX, camY } = camFor(follow, Z);
    // Un fantôme tout près de moi (humain) : le cœur s'emballe.
    let fear = 0;
    if (mv && !iAmGhost && st.phase === "play") for (const v of views) if (v.ghost && !v.frozen) fear = Math.max(fear, 1 - Math.hypot(v.x - mv.x, v.y - mv.y) / 200);
    if (fear > 0) shake = Math.max(shake, fear * 3 * (0.6 + 0.4 * Math.sin(ts / 90)));
    const flash = performance.now() < flashLocal;

    c.save();
    c.fillStyle = "#020203"; c.fillRect(0, 0, W, HGT);
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.scale(Z, Z);
    c.translate(-camX, -camY);
    c.drawImage(bg, 0, 0);
    drawDynamic(c, ts);
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      if (v.ghost) continue;
      const col = playerOf(v.id)?.color || "#fff";
      window.HeroArt.paint(c, { ...v, face: v.aim }, col, {
        id: v.id, isMe: v.id === me(),
        item: (cc) => { cc.fillStyle = "#333"; cc.fillRect(10, 11, 12, 6); cc.fillStyle = v.lamp ? "#fff3b0" : "#666"; cc.fillRect(21, 10, 4, 8); },
      });
    }
    // Les fantômes : pour les humains, seulement s'ils sont éclairés (ou à moitié sous la lune) ; les fantômes se voient entre eux.
    for (const v of views) {
      if (!v.ghost) continue;
      if (iAmGhost) ghostArt(c, v, ts, v.id === me() ? 0.95 : 0.7, v.lit);
      else if (v.seen || v.dazed) ghostArt(c, v, ts, 0.95, v.lit);
      else if (v.moon) ghostArt(c, v, ts, 0.4, 0);
    }
    drawParticles(dt);
    c.restore();

    drawDark(views, camX, camY, Z, iAmGhost, mv, ts, flash);

    // Par-dessus le noir : ondes des planches, regards des fantômes alliés, noms, passages secrets (pour les fantômes), mon viseur.
    c.save();
    c.scale(Z, Z);
    c.translate(-camX, -camY);
    c.textAlign = "center"; c.textBaseline = "middle";
    const now = performance.now();
    waves = waves.filter((w) => now - w.t < 1200);
    for (const w of waves) {
      const k = (now - w.t) / 1200;
      c.strokeStyle = `rgba(255,190,120,${0.7 * (1 - k)})`; c.lineWidth = 3;
      for (const r of [20, 45]) { c.beginPath(); c.arc(w.x, w.y, r + k * 60, 0, Math.PI * 2); c.stroke(); }
    }
    if (iAmGhost) {
      for (const v of views) {
        if (!v.ghost || v.id === me()) continue;
        const pts = M.cone(blockers, v.x, v.y, v.aim ?? 0, M.SIGHT_RANGE, M.SIGHT_HALF, 24);
        c.strokeStyle = "rgba(180,140,255,0.35)"; c.lineWidth = 2; c.fillStyle = "rgba(180,140,255,0.05)";
        c.beginPath(); c.moveTo(pts[0].x, pts[0].y); for (const p of pts) c.lineTo(p.x, p.y); c.closePath(); c.fill(); c.stroke();
      }
      for (const p of manor.portals) if (p.kind === "secret") for (const e of [p.a, p.b]) { c.strokeStyle = "rgba(180,140,255,0.8)"; c.lineWidth = 2; c.beginPath(); c.arc(e.x, e.y, 16 + Math.sin(ts / 200) * 3, 0, Math.PI * 2); c.stroke(); }
    }
    for (const v of views) {
      if (v.ghost && !iAmGhost && v.dazed && !v.seen) ghostArt(c, v, ts, 0.45, 0);
      const showName = v.id === me() || (iAmGhost ? v.ghost : !v.ghost);
      if (!showName) continue;
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.85)"; c.strokeText((v.ghost ? "👻 " : "") + pseudoOf(v.id), v.x, v.y - 32);
      c.fillStyle = v.ghost ? "#cbb8ff" : "#fff"; c.fillText((v.ghost ? "👻 " : "") + pseudoOf(v.id), v.x, v.y - 32);
    }
    for (const p of st.piles || []) { c.fillStyle = `rgba(92,255,157,${0.35 + 0.2 * Math.sin(ts / 200 + p.x)})`; circle(c, p.x, p.y, 4); }
    if (mv && st.phase === "play") {
      const a = Math.atan2(mouse.oy, mouse.ox), d = Math.hypot(mouse.oy, mouse.ox) / Z;
      const tx = mv.x + Math.cos(a) * d, ty = mv.y + Math.sin(a) * d;
      c.strokeStyle = iAmGhost ? "rgba(203,184,255,0.7)" : "rgba(255,240,190,0.7)"; c.lineWidth = 2;
      c.beginPath(); c.arc(tx, ty, 10, 0, Math.PI * 2); c.moveTo(tx - 15, ty); c.lineTo(tx - 5, ty); c.moveTo(tx + 5, ty); c.lineTo(tx + 15, ty); c.moveTo(tx, ty - 15); c.lineTo(tx, ty - 5); c.moveTo(tx, ty + 5); c.lineTo(tx, ty + 15); c.stroke();
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, iAmGhost ? "#b48cff" : playerOf(me())?.color || "#fff",
      ghostFlash > 0 ? 1 : window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)) / Z);
    c.restore();

    if (fear > 0) {
      const beat = 0.5 + 0.5 * Math.abs(Math.sin(ts / (220 - fear * 100)));
      const gr = c.createRadialGradient(W / 2, HGT / 2, HGT * 0.35, W / 2, HGT / 2, W * 0.7);
      gr.addColorStop(0, "rgba(160,0,20,0)"); gr.addColorStop(1, `rgba(160,0,20,${0.55 * fear * beat})`);
      c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    }

    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", iAmGhost ? "👻 Tu es le FANTÔME. Tu te réveilles 3 s après les autres…" : "🔦 Tu es HUMAIN. Un fantôme rôde dans le manoir…");
    } else if (st.phase === "play" && Date.now() < wakeLocal) {
      band("🕯️ " + Math.ceil((wakeLocal - Date.now()) / 1000), iAmGhost ? "Tu te réveilles… vise avec la souris : tu vois là où tu regardes." : "Le fantôme se réveille… cache-toi !", "#cbb8ff");
    } else if (ghostFlash > 0) {
      ghostFlash -= dt;
      band("👻 ATTRAPÉ !", "Tu es un fantôme : vise avec la souris pour regarder, attrape les autres !", "#b48cff");
    } else if (fear > 0.35) {
      smallBand("💓 IL EST TOUT PRÈS !", "#ff6b7d");
    } else if (mv && !iAmGhost && mv.bat <= 0.01 && st.phase === "play") {
      smallBand("🔋 Lampe vide : trouve une pile !", "#5cff9d");
    }
    if (mv && st.phase === "play" && document.pointerLockElement !== canvas) {
      c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,240,200,0.85)"; c.textAlign = "center";
      c.fillText(iAmGhost ? "🖱️ Clique dans le manoir : ton regard suivra ton viseur" : "🖱️ Clique dans le manoir : ta lampe suivra ton viseur", W / 2, HGT - 18);
    }
  }

  // Le noir : un calque sombre, percé par les lumières (et, pour un fantôme, par son regard).
  function drawDark(views, camX, camY, Z, iAmGhost, mv, ts, flash) {
    const d = dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, W, HGT);
    d.fillStyle = iAmGhost ? "rgba(6,4,18,0.94)" : "rgba(3,3,8,0.95)";
    d.fillRect(0, 0, W, HGT);
    d.globalCompositeOperation = "destination-out";
    // L'éclair : tout s'illumine (sauf la cave, qui n'a pas de fenêtre).
    if (flash) { d.fillStyle = "rgba(0,0,0,0.85)"; d.fillRect(0, 0, W, HGT); }
    // À partir d'ici, on dessine en coordonnées du monde (zoom + caméra).
    d.setTransform(Z, 0, 0, Z, -camX * Z, -camY * Z);
    const hole = (x, y, r, k = 1) => {
      const gr = d.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(0.6, `rgba(0,0,0,${k * 0.7})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = gr; d.beginPath(); d.arc(x, y, r, 0, Math.PI * 2); d.fill();
    };
    const poly = (ctx, pts, x, y, R, stops) => {
      const gr = ctx.createRadialGradient(x, y, 10, x, y, R);
      for (const [o, col] of stops) gr.addColorStop(o, col);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.closePath(); ctx.fill();
    };
    const cut = (k) => [[0, `rgba(0,0,0,${k})`], [0.7, `rgba(0,0,0,${k * 0.9})`], [1, "rgba(0,0,0,0)"]];
    // La lune : le jardin à moitié éclairé, les rayons près des fenêtres.
    d.fillStyle = "rgba(0,0,0,0.42)";
    for (const G of manor.gardenParts) d.fillRect(G.x, G.y, G.w, G.h);
    d.fillStyle = "rgba(0,0,0,0.5)";
    for (const w of manor.windows) d.fillRect(w.patch.x, w.patch.y, w.patch.w, w.patch.h);
    // Les lustres allumés (ils grésillent avant de s'éteindre).
    const now = performance.now();
    for (const r of manor.rooms) {
      const until = litRooms.get(r.id);
      if (!until || until < now) continue;
      if (until - now < 3000 && Math.random() < 0.3) continue;
      d.fillStyle = "rgba(0,0,0,0.88)"; d.fillRect(r.x, r.y, r.w, r.h);
    }
    // Mon regard (fantôme) : un grand cône, arrêté par les murs et les portes fermées.
    if (iAmGhost && mv) {
      poly(d, M.cone(blockers, mv.x, mv.y, mv.aim, M.SIGHT_RANGE, M.SIGHT_HALF, 40), mv.x, mv.y, M.SIGHT_RANGE, cut(0.8));
      hole(mv.x, mv.y, 50, 0.8);
    }
    for (const v of views) {
      if (v.ghost) continue;
      // L'aura autour des humains (les fantômes ne la voient pas : il faut les voir avec son regard).
      if (!iAmGhost) hole(v.x, v.y, v.id === me() ? 85 : 55, 0.85);
      if (v.lamp) poly(d, M.cone(blockers, v.x, v.y, v.aim ?? v.face, M.LAMP_RANGE, M.LAMP_HALF, 30), v.x, v.y, M.LAMP_RANGE, cut(1));
    }
    d.globalCompositeOperation = "source-over";
    // La cave reste dans le noir total pendant un éclair.
    if (flash) { const C = manor.caveRect; d.fillStyle = "rgba(3,3,8,0.85)"; d.fillRect(C.x, C.y, C.w, C.h); }
    d.setTransform(1, 0, 0, 1, 0, 0);
    g2d.drawImage(dark, 0, 0);
    // Lueurs : chaude dans les cônes, dorée sous les lustres, bleue sous la lune, blanche pendant l'éclair.
    g2d.save();
    g2d.globalCompositeOperation = "lighter";
    g2d.setTransform(Z, 0, 0, Z, -camX * Z, -camY * Z);
    for (const v of views) {
      if (v.ghost || !v.lamp) continue;
      poly(g2d, M.cone(blockers, v.x, v.y, v.aim ?? v.face, M.LAMP_RANGE, M.LAMP_HALF, 30), v.x, v.y, M.LAMP_RANGE,
        [[0, `rgba(255,220,150,${0.16 + 0.02 * Math.sin(ts / 60)})`], [1, "rgba(255,220,150,0)"]]);
    }
    for (const r of manor.rooms) {
      const until = litRooms.get(r.id);
      if (!until || until < now) continue;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const gr = g2d.createRadialGradient(cx, cy, 10, cx, cy, Math.max(r.w, r.h) * 0.7);
      gr.addColorStop(0, "rgba(255,200,110,0.18)"); gr.addColorStop(1, "rgba(255,200,110,0)");
      g2d.fillStyle = gr; g2d.fillRect(r.x, r.y, r.w, r.h);
    }
    for (const w of manor.windows) { g2d.fillStyle = "rgba(90,120,200,0.07)"; g2d.fillRect(w.patch.x, w.patch.y, w.patch.w, w.patch.h); }
    // Les lanternes du jardin : une petite lueur.
    for (const dd of manor.deco) if (dd.kind === "lanterne") {
      const gr = g2d.createRadialGradient(dd.x, dd.y, 2, dd.x, dd.y, 40);
      gr.addColorStop(0, "rgba(255,190,90,0.25)"); gr.addColorStop(1, "rgba(255,190,90,0)");
      g2d.fillStyle = gr; g2d.fillRect(dd.x - 40, dd.y - 40, 80, 80);
    }
    g2d.setTransform(1, 0, 0, 1, 0, 0);
    if (flash) { g2d.fillStyle = "rgba(200,210,255,0.18)"; g2d.fillRect(0, 0, W, HGT); }
    g2d.restore();
  }

  // La caméra : centrée sur le joueur suivi, sans sortir de la carte (vue W/Z × HGT/Z).
  const zoomNow = (ghost) => (ghost || !heroOf(me()) ? 1 : ZOOM_HUMAN);
  function camFor(v, Z) {
    const vw = W / Z, vh = HGT / Z;
    const camX = manor.w <= vw ? (manor.w - vw) / 2 : Math.max(0, Math.min(manor.w - vw, v.x - vw / 2));
    const camY = manor.h <= vh ? (manor.h - vh) / 2 : Math.max(0, Math.min(manor.h - vh, v.y - vh / 2));
    return { camX, camY };
  }

  function pileArt(c, x, y) {
    c.save(); c.translate(x, y); c.rotate(0.4);
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(-7, -12, 18, 26);
    c.fillStyle = "#222"; c.fillRect(-9, -14, 18, 26);
    c.fillStyle = "#5cff9d"; c.fillRect(-9, -14, 18, 9);
    c.fillStyle = "#bbb"; c.fillRect(-4, -18, 8, 4);
    c.restore();
  }

  function band(big, small, color) {
    const c = g2d;
    c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, HGT / 2 - 75, W, 150);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "bold 60px Segoe UI, sans-serif"; c.fillStyle = color || "#fff"; c.fillText(big, W / 2, HGT / 2 - 14);
    c.font = "22px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(small, W / 2, HGT / 2 + 40);
  }
  function smallBand(text, color) {
    const c = g2d;
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, HGT - 110, W, 56);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "bold 30px Segoe UI, sans-serif"; c.fillStyle = color; c.fillText(text, W / 2, HGT - 82);
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    const c = g2d;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
      c.globalAlpha = p.life / p.max; c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
  }

  function myScreen() {
    const v = pred ? ownView() : heroOf(me());
    if (!v || !manor) return null;
    const mine = heroOf(me()), Z = zoomNow(!!mine?.ghost);
    const { camX, camY } = camFor(v, Z);
    return { x: (v.x - camX) * Z, y: (v.y - camY) * Z };
  }
})();
