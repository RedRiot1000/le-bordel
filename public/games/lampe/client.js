// ===================================================================
//  LAMPE TORCHE — Client (s'affiche dans le hub Le Bordel)
//  - Le manoir est refait ici à partir de sa seed (manor.js).
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Le noir : un calque sombre percé par les lampes (cônes arrêtés par les murs).
//  - Viseur RELATIF à mon bonhomme (la lampe éclaire vers lui), souris capturée au 1er clic.
// ===================================================================

(() => {
  const H = window.Pieton;
  const M = window.Manoir;
  const K = H.K;
  const W = 1280, HGT = 800;
  const LIT_SLOW = 0.55, GHOST_SIGHT = 420;   // (les mêmes que games/lampe/server.js)
  const AIM_MAX = 320;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, wakeLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, dark = null, dctx = null;
  let manor = null, manorKey = null, bg = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 150, oy: 0, left: false };
  let particles = [];
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0, wasGhost = null, ghostFlash = 0;

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
            <li>👻 Un joueur est le <b>fantôme</b> : invisible dans le noir, il voit les <b>lampes allumées</b> de partout. Chaque humain qu'il touche devient fantôme à son tour !</li>
            <li>🔦 Ta lampe éclaire vers ton viseur. Un fantôme éclairé est <b>visible et ralenti</b> ; éclairé <b>1,5 s</b> d'affilée, il est <b>étourdi</b>.</li>
            <li>🔋 La lampe se vide (25 s) : <b>clic</b> pour l'éteindre et te cacher dans le noir. Ramasse des <b>piles</b> 🔋.</li>
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> bouger · 🖱️ viser · clic = lampe on/off · <kbd>Espace</kbd> = pousser</li>
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
      <p class="muted pt-keys">ZQSD = bouger · souris = viser la lampe · clic = allumer/éteindre · Espace = pousser · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.lampe = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; manorKey = null; wasGhost = null;
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
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); wasGhost = null; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      wakeLocal = Date.now() + (st.wakeIn || 0);
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
    walls: true, w: manor.w, h: manor.h, rects: manor.rects, push: !sc.ghost, noDash: true,
    speedMul: sc.ghost ? (sc.seen && !sc.immune ? LIT_SLOW : 1) : 1,
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
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k, sc), sc.ghost ? null : p.a, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; }
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
      H.simulate(pred, moveBits(k, sc), sc.ghost ? null : a, E, othersAt(pending.length * H.TICK));
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
  const FX_COL = { catch: ["#b48cff", "#e9e0ff"], daze: ["#ffe27a", "#fff6c9"], pile: ["#5cff9d", "#d4ffe5"], push: ["#ffffff", "#cfd8e6"] };
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "catch" ? 40 : f.kind === "daze" ? 26 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (f.kind === "catch" ? 260 : 160);
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.5, max: 0.8, r: 1.5 + Math.random() * 3, col: FX_COL[f.kind]?.[i % 2] || "#fff" });
      }
      if (f.kind === "catch") shake = 9;
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
    const txt = !mine ? "👀 Tu regardes" : mine.ghost ? "👻 FANTÔME : attrape les humains !" : "🔦 HUMAIN : survis !";
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
  const FLOORS = {
    salon: ["#6b4a2f", "#5e4129"], chambre: ["#5a3a4a", "#50334a"], cuisine: ["#c9c3b4", "#8d877a"],
    bibliotheque: ["#7a5636", "#6d4c2f"], bain: ["#9fb7c0", "#86a1ab"], salle: ["#4f3a2a", "#463325"],
  };
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  function floor(c, r, kind, rnd) {
    const [a, b] = FLOORS[kind] || FLOORS.salon;
    c.fillStyle = a; c.fillRect(r.x, r.y, r.w, r.h);
    if (kind === "cuisine" || kind === "bain") {
      // Carrelage en damier.
      const s = kind === "bain" ? 20 : 26;
      c.fillStyle = b;
      for (let x = 0; x < r.w; x += s) for (let y = 0; y < r.h; y += s) if (((x + y) / s) % 2 === 0) c.fillRect(r.x + x, r.y + y, Math.min(s, r.w - x), Math.min(s, r.h - y));
    } else if (kind === "chambre") {
      // Moquette.
      for (let k = 0; k < (r.w * r.h) / 60; k++) { c.fillStyle = k % 2 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.04)"; c.fillRect(r.x + rnd() * r.w, r.y + rnd() * r.h, 2, 2); }
    } else {
      // Parquet : lames décalées.
      c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 1;
      const lh = 14;
      for (let y = 0; y < r.h; y += lh) {
        c.beginPath(); c.moveTo(r.x, r.y + y); c.lineTo(r.x + r.w, r.y + y); c.stroke();
        for (let x = ((y / lh) % 3) * 30; x < r.w; x += 90) { c.beginPath(); c.moveTo(r.x + x, r.y + y); c.lineTo(r.x + x, r.y + y + lh); c.stroke(); }
      }
      c.fillStyle = b; c.globalAlpha = 0.25;
      for (let y = 0; y < r.h; y += lh * 2) c.fillRect(r.x, r.y + y, r.w, lh);
      c.globalAlpha = 1;
    }
  }
  function furniture(c, f, rnd) {
    const { x, y, w, h } = f;
    const horiz = w >= h;
    c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(x + 4, y + 5, w, h);
    const wood = (col = "#5b3a22") => { c.fillStyle = col; c.fillRect(x, y, w, h); c.strokeStyle = "rgba(0,0,0,0.45)"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2); };
    switch (f.name) {
      case "lit": {
        wood("#4a2f1c");
        const head = f.side;   // la tête du lit est contre le mur
        c.fillStyle = ["#8e2f3c", "#2f4f8e", "#3e7a4a", "#7a5a2e"][Math.floor(rnd() * 4)];
        c.fillRect(x + 4, y + 4, w - 8, h - 8);
        c.fillStyle = "#e9e4d8";   // oreillers
        if (head === 0) { c.fillRect(x + 8, y + 6, w / 2 - 12, 18); c.fillRect(x + w / 2 + 4, y + 6, w / 2 - 12, 18); }
        else if (head === 2) { c.fillRect(x + 8, y + h - 24, w / 2 - 12, 18); c.fillRect(x + w / 2 + 4, y + h - 24, w / 2 - 12, 18); }
        else if (head === 1) { c.fillRect(x + w - 24, y + 8, 18, h / 2 - 12); c.fillRect(x + w - 24, y + h / 2 + 4, 18, h / 2 - 12); }
        else { c.fillRect(x + 6, y + 8, 18, h / 2 - 12); c.fillRect(x + 6, y + h / 2 + 4, 18, h / 2 - 12); }
        return;
      }
      case "baignoire":
        c.fillStyle = "#eef1f2"; c.fillRect(x, y, w, h);
        c.fillStyle = "#9fc6d8"; c.fillRect(x + 7, y + 7, w - 14, h - 14);
        c.strokeStyle = "#c9cfd2"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        return;
      case "lavabo": case "frigo":
        c.fillStyle = "#e6e9ea"; c.fillRect(x, y, w, h); c.strokeStyle = "#a9b0b4"; c.lineWidth = 2; c.strokeRect(x + 1, y + 1, w - 2, h - 2);
        if (f.name === "lavabo") { c.fillStyle = "#9fc6d8"; circle(c, x + w / 2, y + h / 2, Math.min(w, h) / 3); }
        return;
      case "four":
        c.fillStyle = "#3b3d42"; c.fillRect(x, y, w, h);
        c.strokeStyle = "#777"; c.lineWidth = 2; for (const [a, b] of [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]) { c.beginPath(); c.arc(x + w * a, y + h * b, Math.min(w, h) * 0.14, 0, Math.PI * 2); c.stroke(); }
        return;
      case "comptoir":
        c.fillStyle = "#8c8f94"; c.fillRect(x, y, w, h); c.fillStyle = "#b9bcc1"; c.fillRect(x + 3, y + 3, w - 6, h - 6);
        c.fillStyle = "#9fc6d8"; if (horiz) c.fillRect(x + w * 0.6, y + 7, 30, h - 14); else c.fillRect(x + 7, y + h * 0.6, w - 14, 30);
        return;
      case "canape": {
        const col = ["#7a2a35", "#2a4a7a", "#4a6a3a", "#6a4a7a"][Math.floor(rnd() * 4)];
        c.fillStyle = col; c.fillRect(x, y, w, h);
        c.fillStyle = "rgba(0,0,0,0.25)";
        if (horiz) c.fillRect(x, f.side === 0 ? y : y + h - 12, w, 12); else c.fillRect(f.side === 3 ? x : x + w - 12, y, 12, h);
        c.strokeStyle = "rgba(255,255,255,0.15)"; c.lineWidth = 2;
        for (let k = 1; k < 3; k++) { c.beginPath(); if (horiz) { c.moveTo(x + (w * k) / 3, y + 4); c.lineTo(x + (w * k) / 3, y + h - 4); } else { c.moveTo(x + 4, y + (h * k) / 3); c.lineTo(x + w - 4, y + (h * k) / 3); } c.stroke(); }
        return;
      }
      case "cheminee":
        c.fillStyle = "#7a3b2a"; c.fillRect(x, y, w, h);
        c.strokeStyle = "rgba(0,0,0,0.35)"; c.lineWidth = 1;
        for (let yy = y + 6; yy < y + h; yy += 6) { c.beginPath(); c.moveTo(x, yy); c.lineTo(x + w, yy); c.stroke(); }
        c.fillStyle = "#1a1210"; c.fillRect(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5);
        c.fillStyle = "#ff8a2a"; circle(c, x + w / 2, y + h / 2, Math.min(w, h) * 0.18);
        return;
      case "etagere": {
        wood("#3f2716");
        const n = Math.floor((horiz ? w : h) / 7);
        for (let k = 0; k < n; k++) {
          c.fillStyle = ["#8e2f3c", "#2f4f8e", "#3e7a4a", "#b08a3a", "#5a3a6a"][Math.floor(rnd() * 5)];
          if (horiz) c.fillRect(x + 3 + k * 7, y + 4, 5, h - 8); else c.fillRect(x + 4, y + 3 + k * 7, w - 8, 5);
        }
        return;
      }
      case "piano":
        c.fillStyle = "#141414"; c.fillRect(x, y, w, h);
        c.fillStyle = "#f2f2f2";
        if (horiz) c.fillRect(x + 6, f.side === 0 ? y + h - 14 : y + 4, w - 12, 10); else c.fillRect(f.side === 3 ? x + w - 14 : x + 4, y + 6, 10, h - 12);
        return;
      case "horloge":
        wood("#4a2f1c"); c.fillStyle = "#e8dcb8"; circle(c, x + w / 2, y + h / 2, Math.min(w, h) * 0.32);
        return;
      case "table": case "table_basse": case "bureau": {
        wood(f.name === "table_basse" ? "#3a2618" : "#6b4527");
        c.fillStyle = "rgba(255,255,255,0.08)"; c.fillRect(x + 4, y + 4, w - 8, h - 8);
        if (f.name === "table") {   // des chaises autour
          c.fillStyle = "#4a2f1c";
          if (horiz) for (let k = 0; k < Math.floor(w / 36); k++) { c.fillRect(x + 10 + k * 36, y - 12, 18, 10); c.fillRect(x + 10 + k * 36, y + h + 2, 18, 10); }
          else for (let k = 0; k < Math.floor(h / 36); k++) { c.fillRect(x - 12, y + 10 + k * 36, 10, 18); c.fillRect(x + w + 2, y + 10 + k * 36, 10, 18); }
          c.fillStyle = "#e8dcb8"; circle(c, x + w / 2, y + h / 2, 5);   // une bougie
        }
        if (f.name === "bureau") { c.fillStyle = "#e9e4d8"; c.fillRect(x + w * 0.2, y + h * 0.25, 20, 14); }
        return;
      }
      default:   // armoire, commode, buffet…
        wood(f.name === "armoire" ? "#4e3220" : "#5b3a22");
        c.strokeStyle = "rgba(0,0,0,0.4)"; c.lineWidth = 1.5;
        c.beginPath(); if (horiz) { c.moveTo(x + w / 2, y + 3); c.lineTo(x + w / 2, y + h - 3); } else { c.moveTo(x + 3, y + h / 2); c.lineTo(x + w - 3, y + h / 2); } c.stroke();
        c.fillStyle = "#c8a24a"; if (horiz) { circle(c, x + w / 2 - 5, y + h / 2, 2); circle(c, x + w / 2 + 5, y + h / 2, 2); } else { circle(c, x + w / 2, y + h / 2 - 5, 2); circle(c, x + w / 2, y + h / 2 + 5, 2); }
    }
  }

  function newManor() {
    manorKey = st.manor.seed + ":" + st.manor.n;
    manor = M.build(st.manor.seed, st.manor.n);
    const rnd = M.seeded(st.manor.seed ^ 0x77aa);
    bg = document.createElement("canvas");
    bg.width = manor.w; bg.height = manor.h;
    const c = bg.getContext("2d");
    c.fillStyle = "#16110e"; c.fillRect(0, 0, manor.w, manor.h);
    for (const r of manor.rooms) {
      floor(c, r, r.kind, rnd);
      if (r.rug) {
        const rw = r.w * 0.5, rh = r.h * 0.45;
        c.fillStyle = "#6e1f26"; c.fillRect(r.x + (r.w - rw) / 2, r.y + (r.h - rh) / 2, rw, rh);
        c.strokeStyle = "#c8a24a"; c.lineWidth = 3; c.strokeRect(r.x + (r.w - rw) / 2 + 6, r.y + (r.h - rh) / 2 + 6, rw - 12, rh - 12);
      }
    }
    // Les seuils des portes (et les grandes ouvertures) : du sol aussi.
    for (const d of manor.doors) { c.fillStyle = d.open ? FLOORS.salle[0] : "#5a4330"; c.fillRect(d.x, d.y, d.w, d.h); }
    // Ombre le long des murs (dans les pièces).
    c.fillStyle = "rgba(0,0,0,0.35)";
    for (const w of manor.walls) { if (w.w > w.h) c.fillRect(w.x, w.y + w.h, w.w, 6); else c.fillRect(w.x + w.w, w.y, 6, w.h); }
    for (const f of manor.furniture) furniture(c, f, rnd);
    // Les murs : pierre sombre, liseré clair dessus.
    for (const w of manor.walls) {
      c.fillStyle = "#2b2420"; c.fillRect(w.x, w.y, w.w, w.h);
      c.fillStyle = "#4a3d33"; if (w.w > w.h) c.fillRect(w.x, w.y, w.w, 4); else c.fillRect(w.x, w.y, 4, w.h);
    }
    // Les portes entrouvertes (un battant contre le mur).
    c.strokeStyle = "#7a5430"; c.lineWidth = 5;
    for (const d of manor.doors) {
      if (d.open) continue;
      c.beginPath();
      if (d.vert) { c.moveTo(d.x + d.w / 2, d.y + 2); c.lineTo(d.x + d.w / 2 + 34, d.y + 12); }
      else { c.moveTo(d.x + 2, d.y + d.h / 2); c.lineTo(d.x + 12, d.y + d.h / 2 + 34); }
      c.stroke();
    }
    // Toiles d'araignée dans quelques coins.
    c.strokeStyle = "rgba(220,220,220,0.25)"; c.lineWidth = 1;
    for (const r of manor.rooms) {
      if (rnd() > 0.45) continue;
      const cx = rnd() < 0.5 ? r.x : r.x + r.w, cy = rnd() < 0.5 ? r.y : r.y + r.h;
      const sx = cx === r.x ? 1 : -1, sy = cy === r.y ? 1 : -1;
      for (let k = 1; k <= 4; k++) { c.beginPath(); c.moveTo(cx + sx * k * 9, cy); c.quadraticCurveTo(cx + sx * k * 5, cy + sy * k * 5, cx, cy + sy * k * 9); c.stroke(); }
      for (const a of [0.15, 0.5, 0.85]) { c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + sx * 40 * Math.cos(a * Math.PI / 2), cy + sy * 40 * Math.sin(a * Math.PI / 2)); c.stroke(); }
    }
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
      c.beginPath(); c.ellipse(-7, -6, 4, 6, 0, 0, Math.PI * 2); c.ellipse(7, -6, 4, 6, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(0, 6, 4, 5, 0, 0, Math.PI * 2); c.fill();
    }
    // La lumière qui l'étourdit : un anneau jaune qui se remplit.
    if (lit > 0 && !v.dazed) {
      c.strokeStyle = "rgba(255,226,122,0.3)"; c.lineWidth = 4; c.beginPath(); c.arc(0, 0, R + 9, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = "#ffe27a"; c.beginPath(); c.arc(0, 0, R + 9, -Math.PI / 2, -Math.PI / 2 + lit * Math.PI * 2); c.stroke();
    }
    c.restore();
  }

  function draw(ts, dt) {
    const c = g2d;
    const mine = heroOf(me());
    const iAmGhost = !!mine?.ghost;
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, aim: mine.ghost ? h.aim : Math.atan2(mouse.oy, mouse.ox) }; }
      return { ...shownHero(h), ghost: h.ghost, lamp: h.lamp, seen: h.seen, dazed: h.dazed, frozen: h.frozen, lit: h.lit, aim: h.aim, bat: h.bat };
    });
    const mv = views.find((v) => v.id === me());
    // Caméra : sur moi (ou sur un humain si je regarde).
    const follow = mv || views.find((v) => !v.ghost) || views[0];
    const camX = manor.w <= W ? (manor.w - W) / 2 : Math.max(0, Math.min(manor.w - W, follow.x - W / 2));
    const camY = manor.h <= HGT ? (manor.h - HGT) / 2 : Math.max(0, Math.min(manor.h - HGT, follow.y - HGT / 2));
    // Un fantôme tout près de moi (humain) : le cœur s'emballe.
    let fear = 0;
    if (mv && !iAmGhost && st.phase === "play") for (const v of views) if (v.ghost && !v.frozen) fear = Math.max(fear, 1 - Math.hypot(v.x - mv.x, v.y - mv.y) / 200);
    if (fear > 0) shake = Math.max(shake, fear * 3 * (0.6 + 0.4 * Math.sin(ts / 90)));

    c.save();
    c.fillStyle = "#050407"; c.fillRect(0, 0, W, HGT);
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.translate(-camX, -camY);
    c.drawImage(bg, 0, 0);
    // Piles.
    for (const p of st.piles || []) pileArt(c, p.x, p.y, ts);
    // Humains (avec leur lampe à la main).
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      if (v.ghost) continue;
      const col = playerOf(v.id)?.color || "#fff";
      window.HeroArt.paint(c, { ...v, face: v.aim }, col, {
        id: v.id, isMe: v.id === me(),
        item: (cc) => { cc.fillStyle = "#333"; cc.fillRect(10, 11, 12, 6); cc.fillStyle = v.lamp ? "#fff3b0" : "#666"; cc.fillRect(21, 10, 4, 8); },
      });
    }
    // Les fantômes : visibles seulement dans la lumière (ou pour les autres fantômes).
    for (const v of views) {
      if (!v.ghost) continue;
      if (iAmGhost) ghostArt(c, v, ts, v.id === me() ? 0.95 : 0.7, v.lit);
      else if (v.seen || v.dazed) ghostArt(c, v, ts, 0.95, v.lit);
    }
    drawParticles(dt);
    c.restore();

    drawDark(views, camX, camY, iAmGhost, mv, ts);

    // Par-dessus le noir : les noms, les fantômes étourdis (on les voit fuir), mes repères.
    c.save();
    c.translate(-camX, -camY);
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      if (v.ghost && !iAmGhost && v.dazed && !v.seen) ghostArt(c, v, ts, 0.45, 0);
      const showName = v.id === me() || (iAmGhost ? (!v.ghost ? (v.lamp || (mv && Math.hypot(v.x - mv.x, v.y - mv.y) < GHOST_SIGHT)) : true) : !v.ghost);
      if (!showName) continue;
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.85)"; c.strokeText((v.ghost ? "👻 " : "") + pseudoOf(v.id), v.x, v.y - 32);
      c.fillStyle = v.ghost ? "#cbb8ff" : "#fff"; c.fillText((v.ghost ? "👻 " : "") + pseudoOf(v.id), v.x, v.y - 32);
    }
    // Les piles brillent un peu dans le noir.
    for (const p of st.piles || []) { c.fillStyle = `rgba(92,255,157,${0.35 + 0.2 * Math.sin(ts / 200 + p.x)})`; circle(c, p.x, p.y, 4); }
    if (mv && st.phase === "play" && !iAmGhost) {
      const a = Math.atan2(mouse.oy, mouse.ox), d = Math.hypot(mouse.oy, mouse.ox);
      const tx = mv.x + Math.cos(a) * d, ty = mv.y + Math.sin(a) * d;
      c.strokeStyle = "rgba(255,240,190,0.7)"; c.lineWidth = 2;
      c.beginPath(); c.arc(tx, ty, 10, 0, Math.PI * 2); c.moveTo(tx - 15, ty); c.lineTo(tx - 5, ty); c.moveTo(tx + 5, ty); c.lineTo(tx + 15, ty); c.moveTo(tx, ty - 15); c.lineTo(tx, ty - 5); c.moveTo(tx, ty + 5); c.lineTo(tx, ty + 15); c.stroke();
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, iAmGhost ? "#b48cff" : playerOf(me())?.color || "#fff",
      ghostFlash > 0 ? 1 : window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();

    // La peur : un voile rouge qui bat sur les bords.
    if (fear > 0) {
      const beat = 0.5 + 0.5 * Math.abs(Math.sin(ts / (220 - fear * 100)));
      const gr = c.createRadialGradient(W / 2, HGT / 2, HGT * 0.35, W / 2, HGT / 2, W * 0.7);
      gr.addColorStop(0, "rgba(160,0,20,0)"); gr.addColorStop(1, `rgba(160,0,20,${0.55 * fear * beat})`);
      c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    }

    // Bandeaux.
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", iAmGhost ? "👻 Tu es le FANTÔME. Tu te réveilles 3 s après les autres…" : "🔦 Tu es HUMAIN. Un fantôme rôde dans le manoir…");
    } else if (st.phase === "play" && Date.now() < wakeLocal) {
      band("🕯️ " + Math.ceil((wakeLocal - Date.now()) / 1000), iAmGhost ? "Tu te réveilles… les humains se dispersent." : "Le fantôme se réveille… cache-toi !", "#cbb8ff");
    } else if (ghostFlash > 0) {
      ghostFlash -= dt;
      band("👻 ATTRAPÉ !", "Tu es un fantôme maintenant : attrape les autres !", "#b48cff");
    } else if (fear > 0.35) {
      smallBand("💓 IL EST TOUT PRÈS !", "#ff6b7d");
    } else if (mv && !iAmGhost && mv.bat <= 0.01 && st.phase === "play") {
      smallBand("🔋 Lampe vide : trouve une pile !", "#5cff9d");
    }
    if (mv && st.phase === "play" && document.pointerLockElement !== canvas && !iAmGhost) {
      c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,240,200,0.85)"; c.textAlign = "center";
      c.fillText("🖱️ Clique dans le manoir : ta lampe suivra ton viseur", W / 2, HGT - 18);
    }
  }

  // Le noir : un calque sombre, percé par les auras et les cônes des lampes.
  function drawDark(views, camX, camY, iAmGhost, mv, ts) {
    const d = dctx;
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, W, HGT);
    d.fillStyle = iAmGhost ? "rgba(6,4,18,0.92)" : "rgba(3,3,8,0.95)";
    d.fillRect(0, 0, W, HGT);
    d.globalCompositeOperation = "destination-out";
    const hole = (x, y, r, k = 1) => {
      const gr = d.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(0.6, `rgba(0,0,0,${k * 0.7})`); gr.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = gr; d.beginPath(); d.arc(x, y, r, 0, Math.PI * 2); d.fill();
    };
    // Vision de nuit du fantôme.
    if (iAmGhost && mv) hole(mv.x - camX, mv.y - camY, GHOST_SIGHT, 0.75);
    for (const v of views) {
      if (v.ghost) continue;
      const x = v.x - camX, y = v.y - camY;
      hole(x, y, v.id === me() ? 85 : 55, 0.85);
      if (!v.lamp) continue;
      const pts = M.cone(manor, v.x, v.y, v.aim ?? v.face, 30);
      const gr = d.createRadialGradient(x, y, 10, x, y, M.LAMP_RANGE);
      gr.addColorStop(0, "rgba(0,0,0,1)"); gr.addColorStop(0.7, "rgba(0,0,0,0.9)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      d.fillStyle = gr;
      d.beginPath(); d.moveTo(pts[0].x - camX, pts[0].y - camY);
      for (const p of pts) d.lineTo(p.x - camX, p.y - camY);
      d.closePath(); d.fill();
    }
    d.globalCompositeOperation = "source-over";
    g2d.drawImage(dark, 0, 0);
    // Une lueur chaude dans les cônes.
    g2d.save();
    g2d.globalCompositeOperation = "lighter";
    for (const v of views) {
      if (v.ghost || !v.lamp) continue;
      const pts = M.cone(manor, v.x, v.y, v.aim ?? v.face, 30);
      const x = v.x - camX, y = v.y - camY;
      const gr = g2d.createRadialGradient(x, y, 10, x, y, M.LAMP_RANGE);
      gr.addColorStop(0, `rgba(255,220,150,${0.16 + 0.02 * Math.sin(ts / 60)})`); gr.addColorStop(1, "rgba(255,220,150,0)");
      g2d.fillStyle = gr;
      g2d.beginPath(); g2d.moveTo(pts[0].x - camX, pts[0].y - camY);
      for (const p of pts) g2d.lineTo(p.x - camX, p.y - camY);
      g2d.closePath(); g2d.fill();
    }
    g2d.restore();
  }

  function pileArt(c, x, y, ts) {
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
    const camX = manor.w <= W ? (manor.w - W) / 2 : Math.max(0, Math.min(manor.w - W, v.x - W / 2));
    const camY = manor.h <= HGT ? (manor.h - HGT) / 2 : Math.max(0, Math.min(manor.h - HGT, v.y - HGT / 2));
    return { x: v.x - camX, y: v.y - camY };
  }
})();
