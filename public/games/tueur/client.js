// ===================================================================
//  LA NUIT DU TUEUR — Client (s'affiche dans le hub Le Bordel)
//  - Le manoir (celui de Lampe torche) est refait ici à partir de sa seed.
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Le noir : un calque sombre percé par les lumières (lampes, lustres, lune,
//    éclairs) et les petites auras des humains ; pour le tueur, aussi par son
//    cône de regard (il ne voit pas les auras : il faut regarder).
//  - Viseur RELATIF à mon bonhomme, souris capturée au 1er clic.
// ===================================================================

(() => {
  const H = window.Pieton;
  const M = window.Manoir;
  const K = H.K;
  const USE = 64;                                    // (le même que games/tueur/server.js)
  const W = 1280, HGT = 800;
  const KILLER_SPEED = 1, RUSH = 1.35, WOUND_SLOW = 0.85, WEB_SLOW = 0.6, HIDE_REACH = 44;
  const AIM_MAX = 320, ZOOM_HUMAN = 1.3;
  const KILLER_COLOR = "#2a2a2e";
  const ITEM_ICON = { piege: "🪤", petard: "🧨", trousse: "🩹" };
  const ITEM_NAME = { piege: "piège à loup", petard: "pétard", trousse: "trousse de soin" };

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, wakeLocal = 0, flashLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, dark = null, dctx = null;
  let manor = null, manorKey = null, bg = null, spots = [];
  let doorsOpen = [], closedDoors = [], blockers = [], rectsNow = [], litRooms = new Map(), websAlive = [];

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 150, oy: 0, left: false, right: false };
  let particles = [], waves = [], blood = [], bloodAt = 0;
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0, lastFlashId = 0, flashMsg = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const circle = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };

  const TEMPLATE = `
    <div id="tk-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🔪</span>
        <h1>LA NUIT DU TUEUR</h1>
        <p class="tagline">Rapportez les fusibles, ouvrez le portail… avant qu'il vous trouve.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="tk-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🔪 Un joueur est le <b>tueur</b> (chacun son tour : autant de manches que de joueurs). Il tue en <b>2 coups</b> de couteau (clic). Il voit dans son cône de regard, les <b>lampes allumées</b> et il <b>entend</b> les bruits.</li>
            <li>⚡ Humains : ramassez les <b>fusibles</b> et branchez-les au <b>tableau électrique</b>. Tous branchés = le <b>portail du jardin s'ouvre</b> : fuyez par là !</li>
            <li>🚪 <kbd>Espace</kbd> : claquer une porte, se cacher dans une armoire / sous un lit, allumer un lustre. Le tueur défonce les portes et fouille les cachettes.</li>
            <li>🪤 🧨 🩹 Objets au sol : <b>clic droit</b> (ou <kbd>E</kbd>) pour s'en servir. 🔦 Clic : lampe on/off.</li>
            <li>🏆 Humain : +1 par fusible branché, <b>+4</b> si tu t'échappes. Tueur : +1 par blessure, +1 par victime.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="tk-start" class="btn btn-primary btn-big">Entrer dans le manoir</button>
        <p id="tk-hint" class="muted"></p>
        <p id="tk-error" class="error-msg"></p>
        <button id="tk-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="tk-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="tk-round"></span>
        <span id="tk-role" class="ch-role"></span>
        <span id="tk-clock" class="cf-clock"></span>
      </div>
      <div class="ch-sub">
        <div id="tk-humans" class="ch-mice"></div>
        <span id="tk-fuses" class="tk-fuses"></span>
        <span id="tk-item" class="tk-item"></span>
        <div id="tk-bat" class="pt-nitro lt-bat" title="Batterie de la lampe"><span>🔋</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="tk-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="tk-feed" class="so-feed"></ul>
        <div id="tk-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD = bouger · souris = viser · clic = lampe (humain) / couteau (tueur) · clic droit ou E = objet · Espace = porte / cachette / lustre · Échap = libérer la souris</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.tueur = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; waves = []; blood = []; manorKey = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-night");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("tk-canvas");
      g2d = canvas.getContext("2d");
      dark = document.createElement("canvas"); dark.width = W; dark.height = HGT; dctx = dark.getContext("2d");
      $("tk-start").onclick = () => {
        $("tk-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("tk-error").textContent = r.error; });
      };
      $("tk-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => { pressed.clear(); mouse.left = mouse.right = false; });
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
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); blood = []; waves = []; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      wakeLocal = Date.now() + (st.wakeIn || 0);
      if (st.flashId !== lastFlashId) { if (st.flashLeft > 0) { flashLocal = performance.now() + st.flashLeft; shake = Math.max(shake, 6); } lastFlashId = st.flashId; }
      if (!["play", "countdown"].includes(st.phase) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") {
        $("tk-play").classList.add("hidden");
        $("tk-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("tk-setup").classList.add("hidden");
      $("tk-play").classList.remove("hidden");
      if (st.manor && st.manor.seed + ":" + st.manor.n !== manorKey) newManor();
      syncWorld();
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

  function newManor() {
    manorKey = st.manor.seed + ":" + st.manor.n;
    manor = M.build(st.manor.seed, st.manor.n);
    spots = M.hideSpots(manor);
    doorsOpen = []; closedDoors = []; blockers = M.blockers(manor, []); rectsNow = manor.rects;
    bg = window.ManoirArt.paint(manor, st.manor.seed);
  }
  function syncWorld() {
    if (!manor) return;
    const ds = st.doors || "";
    if (ds !== doorsOpen.map((o) => (o ? "1" : "0")).join("")) {
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
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH, KeyE: USE };
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
    if (e.button === 0) {
      if (document.pointerLockElement !== canvas && ["play", "countdown"].includes(st?.phase) && canvas.requestPointerLock) { canvas.requestPointerLock(); onMouse(e); return; }
      mouse.left = true;
    }
    if (e.button === 2) mouse.right = true;
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.left) k |= K.FIRE;
    if (mouse.right) k |= USE;
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const envFor = (sc) => ({
    walls: true, w: manor.w, h: manor.h, rects: rectsNow, push: !sc.killer, noDash: true,
    speedMul: sc.killer ? KILLER_SPEED : sc.rush ? RUSH : sc.web >= 0 ? WEB_SLOW : sc.wounded ? WOUND_SLOW : 1,
  });
  const moveBits = (k, sc) => (sc.frozen || sc.trapped || sc.searching || sc.hidden >= 0 || (sc.killer && sc.wipe) ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH));
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  const playing = (sc) => sc && sc.alive && !sc.escaped;
  function reconcile() {
    const sc = heroOf(me());
    if (!playing(sc) || !driving() || !manor) { pred = prevPred = null; pending = []; history.clear(); return; }
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
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me() && playing(h) && h.hidden < 0).map((h) => H.extrapolate(h, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / H.TICK) * H.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownHero(h) {
    const base = driving() && playing(h) ? H.extrapolate(h, aheadNow()) : h;
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
      const base = driving() && playing(h) ? H.extrapolate(h, t) : h;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 100) othersOff[h.id] = { x: prev.x - base.x, y: prev.y - base.y };
      else othersOff[h.id] = { x: 0, y: 0 };
    }
  }

  // ===================================================================
  //  EFFETS
  // ===================================================================
  const FX_COL = { blood: ["#b01020", "#600010"], kill: ["#b01020", "#300008"], pick: ["#ffd23f", "#fff6c9"], fuse: ["#ffd23f", "#7cc8ff"], heal: ["#5cff9d", "#fff"],
    trap: ["#9aa0a8", "#555"], boom: ["#ff8a2a", "#ffd23f"], bang: ["#c08a50", "#6b4527"], door: ["#c08a50", "#6b4527"], escape: ["#5cff9d", "#2ecc71"], push: ["#fff", "#cfd8e6"],
    secret: ["#b48cff", "#6b4a9e"], stairs: ["#cfc2a8", "#8d7f66"], swing: ["#d8dde6", "#9aa0a8"], search: ["#c8a24a", "#6b4527"], trapset: ["#9aa0a8", "#555"] };
  function handleFx() {
    const iAmKiller = heroOf(me())?.killer;
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      // Un bruit : une onde que le tueur voit de partout.
      if (f.kind === "noise") { if (iAmKiller || !heroOf(me())) waves.push({ x: f.x, y: f.y, t: performance.now() }); continue; }
      if (f.kind === "trapset" && iAmKiller) continue;
      const n = f.kind === "kill" ? 50 : f.kind === "blood" || f.kind === "boom" ? 30 : 12;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * (f.kind === "kill" || f.kind === "boom" ? 260 : 160);
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.5, max: 0.8, r: 1.5 + Math.random() * 3, col: FX_COL[f.kind]?.[i % 2] || "#fff" });
      }
      if (f.kind === "blood" || f.kind === "kill") { shake = 8; for (let k = 0; k < 6; k++) blood.push({ x: f.x + (Math.random() - 0.5) * 30, y: f.y + (Math.random() - 0.5) * 30, r: 4 + Math.random() * 7, t: performance.now() + 60000 }); }
      if (f.kind === "boom" || f.kind === "bang" || f.kind === "door") shake = Math.max(shake, 4);
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("tk-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    const n = st.players.filter((p) => p.connected).length;
    panel.innerHTML = `
      <div class="setting-block"><label>Durée d'une manche</label>${chips("duration", [[120, "2 min"], [180, "3 min"], [240, "4 min"]])}</div>
      <p class="settings-note">${n} manche${n > 1 ? "s" : ""} : chacun sera le tueur une fois. Un nouveau manoir à chaque manche.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    $("tk-start").style.display = host ? "" : "none";
    $("tk-start").disabled = n < 2;
    $("tk-finish-setup").classList.toggle("hidden", !host);
    $("tk-hint").textContent = !host ? "En attente que l'hôte ouvre la porte du manoir…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} joueurs : 1 tueur, ${n - 1} humain${n > 2 ? "s" : ""}`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("tk-round").textContent = `Manche ${st.round}/${st.rounds}`;
    const mine = heroOf(me());
    const txt = !mine ? "👀 Tu regardes" : mine.killer ? "🔪 TUEUR : élimine-les tous !" : !mine.alive ? "💀 Mort : tu regardes" : mine.escaped ? "🏃 Échappé !" : mine.wounded ? "🩸 BLESSÉ : soigne-toi, fuis !" : "🔦 HUMAIN : trouve les fusibles !";
    const role = $("tk-role");
    if (role.textContent !== txt) { role.textContent = txt; role.className = "ch-role " + (mine?.killer ? "cop" : "free"); }
    const hum = st.heroes.filter((h) => !h.killer);
    const tag = (h) => `<span class="ch-tag ${h.id === me() ? "me" : ""} ${!h.alive ? "dead" : ""}" style="border-color:${playerOf(h.id)?.color}">${!h.alive ? "💀 " : h.escaped ? "🏃 " : h.wounded ? "🩸 " : ""}${esc(pseudoOf(h.id))}</span>`;
    const html = `<span class="muted">🔪 ${esc(pseudoOf(st.killer))} ·</span> ${hum.map(tag).join("")}`;
    if ($("tk-humans").innerHTML !== html) $("tk-humans").innerHTML = html;
    const done = (st.fuses || []).filter((f) => f.done).length, tot = (st.fuses || []).length;
    const fz = st.gateOpen ? "🚨 Portail ouvert !" : `⚡ ${"🟨".repeat(done)}${"⬛".repeat(tot - done)}${mine?.carry ? " · tu portes un fusible" : ""}`;
    if ($("tk-fuses").textContent !== fz) $("tk-fuses").textContent = fz;
    const it = mine && !mine.killer && mine.alive && !mine.escaped ? (mine.item ? `${ITEM_ICON[mine.item]} ${ITEM_NAME[mine.item]} (clic droit / E)` : "🎒 —") : "";
    if ($("tk-item").textContent !== it) $("tk-item").textContent = it;
    $("tk-bat").classList.toggle("hidden", !mine || mine.killer || !mine.alive || mine.escaped || st.phase !== "play");
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("tk-feed").innerHTML !== feed) $("tk-feed").innerHTML = feed;
  }

  function renderOver() {
    const ov = $("tk-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.escaped.length === 0 ? `🔪 ${esc(pseudoOf(lr.killer))} a gagné la nuit…`
      : lr.escaped.length === 1 ? `🏃 ${esc(pseudoOf(lr.escaped[0]))} s'est échappé !` : `🏃 ${lr.escaped.length} humains se sont échappés !`;
    const ids = Object.keys(lr.gains).filter((id) => playerOf(id));
    const rows = ids.sort((a, b) => (lr.gains[b] || 0) - (lr.gains[a] || 0)).map((id) => {
      const s = lr.stats[id] || {};
      const how = id === lr.killer ? `🔪 tueur · ${s.wounds || 0} blessure${s.wounds > 1 ? "s" : ""}, ${s.kills || 0} victime${s.kills > 1 ? "s" : ""}`
        : (lr.escaped.includes(id) ? "🏃 échappé" : lr.dead.includes(id) ? "💀 tué" : "⏰ pris au piège") + (s.fuses ? ` · ⚡ ${s.fuses} fusible${s.fuses > 1 ? "s" : ""}` : "");
      return `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="muted">${how}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`;
    }).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="tk-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="tk-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="tk-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="tk-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="tk-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="tk-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="tk-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="tk-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="tk-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2>
      <p class="muted">⚡ Fusibles branchés : ${lr.fusesDone}/${lr.fusesTotal}</p><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("tk-next") && ($("tk-next").onclick = () => api.action("next"));
    $("tk-again") && ($("tk-again").onclick = () => api.action("start").then((r) => { if (r.error) $("tk-over-error").textContent = r.error; }));
    $("tk-to-setup") && ($("tk-to-setup").onclick = () => api.action("setup"));
    $("tk-finish") && ($("tk-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer La Nuit du Tueur ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("tk-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("tk-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    const clock = $("tk-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
      clock.textContent = "⏱️ " + mmss(left);
      clock.classList.toggle("urgent", st.phase === "play" && left < 20000);
    }
    const mine = heroOf(me());
    const bar = document.querySelector("#tk-bat i");
    if (bar && mine) { bar.style.width = Math.round(mine.bat * 100) + "%"; $("tk-bat").classList.toggle("low", mine.bat < 0.25); $("tk-bat").classList.toggle("on", !!mine.lamp); }
    draw(ts, dt);
  }

  // Le décor qui bouge : fusibles, tableau, portail, objets, pièges, pétards, piles.
  function drawThings(c, ts, iAmKiller) {
    // Le tableau électrique.
    if (st.box) {
      const b = st.box, done = (st.fuses || []).filter((f) => f.done).length, tot = (st.fuses || []).length;
      c.fillStyle = "rgba(0,0,0,0.4)"; c.fillRect(b.x - 22, b.y - 26, 50, 58);
      c.fillStyle = "#4a4d55"; c.fillRect(b.x - 26, b.y - 30, 52, 60);
      c.strokeStyle = "#ffd23f"; c.lineWidth = 2; c.strokeRect(b.x - 24, b.y - 28, 48, 56);
      for (let k = 0; k < tot; k++) { c.fillStyle = k < done ? "#ffd23f" : "#1a1a1e"; c.fillRect(b.x - 18 + (k % 2) * 20, b.y - 20 + Math.floor(k / 2) * 22, 16, 16); }
      c.fillStyle = "#ffd23f"; c.font = "16px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("⚡", b.x, b.y + 22);
    }
    // Le portail (ouvert : il brille en vert).
    if (st.gate && st.gateOpen) {
      const gt = st.gate;
      c.fillStyle = `rgba(46,204,113,${0.3 + 0.2 * Math.sin(ts / 150)})`; c.fillRect(gt.x - 10, gt.y - 70, gt.w + 20, 80);
      c.fillStyle = "#2a3a2a"; c.fillRect(gt.x, gt.y, gt.w, M.T);
    }
    for (const f of st.fuses || []) {
      if (f.done || f.carrier) continue;
      c.save(); c.translate(f.x, f.y); c.rotate(0.3);
      c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(-6, -10, 16, 24);
      c.fillStyle = "#c8c4ba"; c.fillRect(-8, -12, 16, 24);
      c.fillStyle = "#ffd23f"; c.fillRect(-8, -4, 16, 8);
      c.fillStyle = "#555"; c.fillRect(-5, -15, 10, 3); c.fillRect(-5, 12, 10, 3);
      c.restore();
    }
    for (const it of st.items || []) {
      c.fillStyle = "rgba(255,255,255,0.12)"; circle(c, it.x, it.y, 16);
      c.font = "20px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(ITEM_ICON[it.type], it.x, it.y);
    }
    // Les pièges : seuls les humains les voient.
    if (!iAmKiller) for (const tr of st.traps || []) {
      c.strokeStyle = "#9aa0a8"; c.lineWidth = 3; c.beginPath(); c.arc(tr.x, tr.y, 14, 0, Math.PI * 2); c.stroke();
      for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; c.beginPath(); c.moveTo(tr.x + Math.cos(a) * 10, tr.y + Math.sin(a) * 10); c.lineTo(tr.x + Math.cos(a) * 17, tr.y + Math.sin(a) * 17); c.stroke(); }
    }
    for (const p of st.petards || []) {
      c.fillStyle = "#c0392b"; c.fillRect(p.x - 4, p.y - 9, 8, 18);
      if (Math.floor(ts / 80) % 2) { c.fillStyle = "#ffd23f"; circle(c, p.x, p.y - 12, 4); }
    }
    for (const p of st.piles || []) {
      c.save(); c.translate(p.x, p.y); c.rotate(0.4);
      c.fillStyle = "#222"; c.fillRect(-9, -14, 18, 26); c.fillStyle = "#5cff9d"; c.fillRect(-9, -14, 18, 9); c.fillStyle = "#bbb"; c.fillRect(-4, -18, 8, 4);
      c.restore();
    }
  }

  function draw(ts, dt) {
    const c = g2d;
    const mine = heroOf(me());
    const iAmKiller = !!mine?.killer;
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, aim: Math.atan2(mouse.oy, mouse.ox) }; }
      return { ...shownHero(h), killer: h.killer, alive: h.alive, wounded: h.wounded, escaped: h.escaped, hidden: h.hidden, lamp: h.lamp, carry: h.carry, aim: h.aim, bat: h.bat, searching: h.searching, trapped: h.trapped };
    });
    // Les blessés laissent du sang (le tueur le voit dans le noir).
    if (ts - bloodAt > 220 && st.phase === "play") {
      bloodAt = ts;
      for (const v of views) if (v.wounded && v.alive && !v.escaped && v.hidden < 0 && Math.hypot(v.vx, v.vy) > 30) blood.push({ x: v.x + (Math.random() - 0.5) * 10, y: v.y + (Math.random() - 0.5) * 10, r: 2 + Math.random() * 3, t: performance.now() + 9000 });
    }
    const mv = views.find((v) => v.id === me());
    const active = mv && mv.alive && !mv.escaped ? mv : null;
    const follow = active || views.find((v) => !v.killer && v.alive && !v.escaped) || views.find((v) => v.killer) || views[0];
    const Z = iAmKiller || !active ? 1 : ZOOM_HUMAN;
    const { camX, camY } = camFor(follow, Z);
    // Le tueur tout près de moi (humain) : le cœur s'emballe.
    let fear = 0;
    const kv = views.find((v) => v.killer);
    if (active && !iAmKiller && kv && st.phase === "play") fear = Math.max(0, 1 - Math.hypot(kv.x - active.x, kv.y - active.y) / 220);
    if (fear > 0) shake = Math.max(shake, fear * 3 * (0.6 + 0.4 * Math.sin(ts / 90)));
    const flash = performance.now() < flashLocal;

    c.save();
    c.fillStyle = "#020203"; c.fillRect(0, 0, W, HGT);
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.scale(Z, Z);
    c.translate(-camX, -camY);
    c.drawImage(bg, 0, 0);
    window.ManoirArt.dynamic(c, manor, doorsOpen, litRooms, websAlive);
    // Le sang au sol.
    const now = performance.now();
    blood = blood.filter((b) => b.t > now);
    for (const b of blood) { c.fillStyle = "rgba(120,0,15,0.75)"; circle(c, b.x, b.y, b.r); }
    drawThings(c, ts, iAmKiller);
    // Les morts (au sol), puis les vivants.
    c.textAlign = "center"; c.textBaseline = "middle";
    for (const v of views) {
      if (v.alive || v.killer) continue;
      c.fillStyle = "rgba(120,0,15,0.8)"; c.beginPath(); c.ellipse(v.x + 4, v.y + 6, 26, 18, 0.4, 0, Math.PI * 2); c.fill();
      window.HeroArt.paint(c, { ...v, vx: 0, vy: 0, face: (v.aim || 0) + 1.6 }, playerOf(v.id)?.color || "#fff", { id: v.id, alpha: 0.75 });
    }
    for (const v of views) {
      if (!v.alive || v.escaped || v.hidden >= 0) continue;
      if (v.killer) {
        window.HeroArt.paint(c, { ...v, face: v.aim }, KILLER_COLOR, {
          id: v.id, isMe: v.id === me(),
          item: (cc) => { cc.fillStyle = "#c9ced8"; cc.beginPath(); cc.moveTo(14, 12); cc.lineTo(34, 15); cc.lineTo(14, 18); cc.closePath(); cc.fill(); cc.fillStyle = "#3a2618"; cc.fillRect(8, 12, 7, 6); },
        });
        if (v.searching) { c.fillStyle = "#c8a24a"; c.font = "16px sans-serif"; c.fillText("🔍", v.x, v.y - 28); }
        if (v.trapped) { c.fillStyle = "#fff"; c.font = "16px sans-serif"; c.fillText("🪤", v.x, v.y + 26); }
      } else {
        window.HeroArt.paint(c, { ...v, face: v.aim }, playerOf(v.id)?.color || "#fff", {
          id: v.id, isMe: v.id === me(),
          item: (cc) => { cc.fillStyle = "#333"; cc.fillRect(10, 11, 12, 6); cc.fillStyle = v.lamp ? "#fff3b0" : "#666"; cc.fillRect(21, 10, 4, 8); },
        });
        if (v.carry) { c.fillStyle = "#ffd23f"; c.font = "14px sans-serif"; c.fillText("⚡", v.x + 16, v.y - 16); }
      }
    }
    drawParticles(dt);
    c.restore();

    drawDark(views, camX, camY, Z, iAmKiller, active, ts, flash);

    // Par-dessus le noir.
    c.save();
    c.scale(Z, Z);
    c.translate(-camX, -camY);
    c.textAlign = "center"; c.textBaseline = "middle";
    // Les bruits (pour le tueur) : des ondes.
    waves = waves.filter((w) => now - w.t < 1400);
    for (const w of waves) {
      const k = (now - w.t) / 1400;
      c.strokeStyle = `rgba(255,120,120,${0.8 * (1 - k)})`; c.lineWidth = 3;
      for (const r of [20, 50]) { c.beginPath(); c.arc(w.x, w.y, r + k * 70, 0, Math.PI * 2); c.stroke(); }
    }
    // Le tueur voit le sang frais même dans le noir.
    if (iAmKiller) for (const b of blood) { c.fillStyle = "rgba(200,20,30,0.55)"; circle(c, b.x, b.y, b.r * 0.8); }
    // Les fusibles et le tableau brillent un peu.
    for (const f of st.fuses || []) if (!f.done && !f.carrier) { c.fillStyle = `rgba(255,210,63,${0.4 + 0.25 * Math.sin(ts / 200 + f.x)})`; circle(c, f.x, f.y, 5); }
    if (st.box) { c.fillStyle = `rgba(255,210,63,${0.35 + 0.2 * Math.sin(ts / 300)})`; circle(c, st.box.x, st.box.y + 22, 4); }
    if (st.gateOpen && st.gate) { c.fillStyle = "#5cff9d"; c.font = "bold 18px Segoe UI, sans-serif"; c.fillText("🚪 SORTIE", st.gate.x + st.gate.w / 2, st.gate.y - 40); }
    for (const p of st.piles || []) { c.fillStyle = `rgba(92,255,157,${0.3 + 0.2 * Math.sin(ts / 200 + p.x)})`; circle(c, p.x, p.y, 3); }
    // Les noms (les humains entre eux, et le mien).
    for (const v of views) {
      if (!v.alive || v.escaped || v.hidden >= 0) continue;
      const show = v.id === me() || (!iAmKiller && !v.killer);
      if (!show) continue;
      c.font = "bold 13px Segoe UI, sans-serif";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.85)"; c.strokeText((v.killer ? "🔪 " : v.wounded ? "🩸 " : "") + pseudoOf(v.id), v.x, v.y - 32);
      c.fillStyle = v.killer ? "#ff7b7b" : "#fff"; c.fillText((v.killer ? "🔪 " : v.wounded ? "🩸 " : "") + pseudoOf(v.id), v.x, v.y - 32);
    }
    // Un indice : Espace près d'une cachette / porte.
    if (active && st.phase === "play") {
      const sp = spots.find((p) => Math.hypot(p.x - active.x, p.y - active.y) < HIDE_REACH);
      if (sp && active.hidden < 0) { c.fillStyle = "rgba(255,240,200,0.85)"; c.font = "bold 12px Segoe UI, sans-serif"; c.fillText(iAmKiller ? "Espace : fouiller 🔍" : "Espace : se cacher 🙈", sp.x, sp.y + 26); }
      const a = Math.atan2(mouse.oy, mouse.ox), d = Math.hypot(mouse.oy, mouse.ox) / Z;
      const tx = active.x + Math.cos(a) * d, ty = active.y + Math.sin(a) * d;
      c.strokeStyle = iAmKiller ? "rgba(255,120,120,0.75)" : "rgba(255,240,190,0.7)"; c.lineWidth = 2;
      c.beginPath(); c.arc(tx, ty, 10, 0, Math.PI * 2); c.moveTo(tx - 15, ty); c.lineTo(tx - 5, ty); c.moveTo(tx + 5, ty); c.lineTo(tx + 15, ty); c.moveTo(tx, ty - 15); c.lineTo(tx, ty - 5); c.moveTo(tx, ty + 5); c.lineTo(tx, ty + 15); c.stroke();
      // Flèche vers la sortie quand le portail est ouvert (humains).
      if (st.gateOpen && !iAmKiller && st.gate) {
        const g = st.gate, ga = Math.atan2(g.y - 30 - active.y, g.x + g.w / 2 - active.x);
        c.save(); c.translate(active.x + Math.cos(ga) * 60, active.y + Math.sin(ga) * 60); c.rotate(ga);
        c.fillStyle = "#2ecc71"; c.strokeStyle = "#0b3d20"; c.lineWidth = 3;
        c.beginPath(); c.moveTo(22, 0); c.lineTo(-8, -16); c.lineTo(-2, 0); c.lineTo(-8, 16); c.closePath(); c.fill(); c.stroke();
        c.restore();
      }
      // Flèche vers le tableau quand je porte un fusible.
      if (!iAmKiller && active.carry && st.box) {
        const ba = Math.atan2(st.box.y - active.y, st.box.x - active.x);
        c.save(); c.translate(active.x + Math.cos(ba) * 60, active.y + Math.sin(ba) * 60); c.rotate(ba);
        c.fillStyle = "#ffd23f"; c.strokeStyle = "#5a4200"; c.lineWidth = 3;
        c.beginPath(); c.moveTo(22, 0); c.lineTo(-8, -16); c.lineTo(-2, 0); c.lineTo(-8, 16); c.closePath(); c.fill(); c.stroke();
        c.restore();
      }
    }
    if (active) window.VehicleArt.markMe(c, active.x, active.y, ts, iAmKiller ? "#ff4d4d" : playerOf(me())?.color || "#fff",
      window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)) / Z);
    c.restore();

    if (fear > 0) {
      const beat = 0.5 + 0.5 * Math.abs(Math.sin(ts / (220 - fear * 100)));
      const gr = c.createRadialGradient(W / 2, HGT / 2, HGT * 0.35, W / 2, HGT / 2, W * 0.7);
      gr.addColorStop(0, "rgba(160,0,20,0)"); gr.addColorStop(1, `rgba(160,0,20,${0.55 * fear * beat})`);
      c.fillStyle = gr; c.fillRect(0, 0, W, HGT);
    }
    if (mv?.hidden >= 0) { c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(0, 0, W, HGT); }

    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", iAmKiller ? "🔪 Tu es le TUEUR. Tu pars en chasse dans quelques secondes…" : "🔦 Trouve les fusibles, branche-les au tableau ⚡, puis fuis par le portail !");
    } else if (st.phase === "play" && Date.now() < wakeLocal) {
      band("🕯️ " + Math.ceil((wakeLocal - Date.now()) / 1000), iAmKiller ? "Vise avec la souris : tu vois là où tu regardes. Clic = couteau." : "Le tueur se réveille… dispersez-vous !", "#ff7b7b");
    } else if (mv?.hidden >= 0) {
      smallBand("🙈 Caché… (Espace pour sortir)", "#cbb8ff");
    } else if (mv && !mv.killer && !mv.alive) {
      smallBand("💀 Tu es mort… regarde les autres", "#ff7b7b");
    } else if (mv?.escaped) {
      smallBand("🏃 Échappé ! Bravo", "#5cff9d");
    } else if (fear > 0.4) {
      smallBand("💓 IL EST TOUT PRÈS !", "#ff6b7d");
    } else if (active && !iAmKiller && active.wounded) {
      smallBand(mine?.item === "trousse" ? "🩸 Blessé : clic droit pour te soigner 🩹" : "🩸 Blessé : un coup de plus et tu es mort !", "#ff7b7b");
    } else if (st.gateOpen && active && !iAmKiller) {
      smallBand("🚨 LE PORTAIL EST OUVERT : fonce au jardin !", "#5cff9d");
    }
    if (active && st.phase === "play" && document.pointerLockElement !== canvas) {
      c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,240,200,0.85)"; c.textAlign = "center";
      c.fillText("🖱️ Clique dans le manoir : ton viseur suivra ton perso", W / 2, HGT - 18);
    }
  }

  // Le noir : percé par les lumières ; pour le tueur, aussi par son regard (pas les auras des humains).
  function drawDark(views, camX, camY, Z, iAmKiller, mv, ts, flash) {
    const d = dctx;
    d.setTransform(1, 0, 0, 1, 0, 0);
    d.globalCompositeOperation = "source-over";
    d.clearRect(0, 0, W, HGT);
    d.fillStyle = iAmKiller ? "rgba(8,3,4,0.94)" : "rgba(3,3,8,0.95)";
    d.fillRect(0, 0, W, HGT);
    d.globalCompositeOperation = "destination-out";
    if (flash) { d.fillStyle = "rgba(0,0,0,0.85)"; d.fillRect(0, 0, W, HGT); }
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
    d.fillStyle = "rgba(0,0,0,0.42)";
    for (const G of manor.gardenParts) d.fillRect(G.x, G.y, G.w, G.h);
    d.fillStyle = "rgba(0,0,0,0.5)";
    for (const w of manor.windows) d.fillRect(w.patch.x, w.patch.y, w.patch.w, w.patch.h);
    const now = performance.now();
    for (const r of manor.rooms) {
      const until = litRooms.get(r.id);
      if (!until || until < now) continue;
      if (until - now < 3000 && Math.random() < 0.3) continue;
      d.fillStyle = "rgba(0,0,0,0.88)"; d.fillRect(r.x, r.y, r.w, r.h);
    }
    if (iAmKiller && mv) {
      poly(d, M.cone(blockers, mv.x, mv.y, mv.aim, M.SIGHT_RANGE, M.SIGHT_HALF, 40), mv.x, mv.y, M.SIGHT_RANGE, cut(0.8));
      hole(mv.x, mv.y, 55, 0.8);
    }
    for (const v of views) {
      if (v.killer || !v.alive || v.escaped || v.hidden >= 0) continue;
      if (!iAmKiller) hole(v.x, v.y, v.id === me() ? 85 : 55, 0.85);
      if (v.lamp) poly(d, M.cone(blockers, v.x, v.y, v.aim ?? v.face, M.LAMP_RANGE, M.LAMP_HALF, 30), v.x, v.y, M.LAMP_RANGE, cut(1));
    }
    // Le portail ouvert brille (tout le monde le voit).
    if (st.gateOpen && st.gate) hole(st.gate.x + st.gate.w / 2, st.gate.y - 30, 140, 0.7);
    d.globalCompositeOperation = "source-over";
    if (flash) { const C = manor.caveRect; d.fillStyle = "rgba(3,3,8,0.85)"; d.fillRect(C.x, C.y, C.w, C.h); }
    d.setTransform(1, 0, 0, 1, 0, 0);
    g2d.drawImage(dark, 0, 0);
    g2d.save();
    g2d.globalCompositeOperation = "lighter";
    g2d.setTransform(Z, 0, 0, Z, -camX * Z, -camY * Z);
    for (const v of views) {
      if (v.killer || !v.lamp || !v.alive || v.escaped) continue;
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
    for (const dd of manor.deco) if (dd.kind === "lanterne") {
      const gr = g2d.createRadialGradient(dd.x, dd.y, 2, dd.x, dd.y, 40);
      gr.addColorStop(0, "rgba(255,190,90,0.25)"); gr.addColorStop(1, "rgba(255,190,90,0)");
      g2d.fillStyle = gr; g2d.fillRect(dd.x - 40, dd.y - 40, 80, 80);
    }
    g2d.setTransform(1, 0, 0, 1, 0, 0);
    if (flash) { g2d.fillStyle = "rgba(200,210,255,0.18)"; g2d.fillRect(0, 0, W, HGT); }
    g2d.restore();
  }

  function camFor(v, Z) {
    const vw = W / Z, vh = HGT / Z;
    const camX = manor.w <= vw ? (manor.w - vw) / 2 : Math.max(0, Math.min(manor.w - vw, v.x - vw / 2));
    const camY = manor.h <= vh ? (manor.h - vh) / 2 : Math.max(0, Math.min(manor.h - vh, v.y - vh / 2));
    return { camX, camY };
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
    c.font = "bold 28px Segoe UI, sans-serif"; c.fillStyle = color; c.fillText(text, W / 2, HGT - 82);
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
    const Z = heroOf(me())?.killer ? 1 : ZOOM_HUMAN;
    const { camX, camY } = camFor(v, Z);
    return { x: (v.x - camX) * Z, y: (v.y - camY) * Z };
  }
})();
