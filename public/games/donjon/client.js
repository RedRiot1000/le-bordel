// ===================================================================
//  DONJON — Client (s'affiche dans le hub Le Bordel)
//  Style : donjon de pierre éclairé aux torches.
//  - Slayer : vue de dessus qui suit mon perso, ZQSD + souris capturée
//    (viseur relatif), clic = attaque, A/E/R ou 1/2/3 = sorts (clic droit
//    = sort 1), Espace = esquive. Mon perso est calculé ici tout de suite.
//  - Maître du jeu : la carte entière. Construction (phase 1), puis
//    pièges, renforts et contrôle du boss (phase 2). Souris libre.
// ===================================================================

(() => {
  const H = window.Pieton, D = window.Donjon;
  const K = H.K;
  const SK = [64, 128, 256], ALT = 64;                 // (les mêmes que games/donjon/server.js)
  const W = 1280, HGT = 800, AIM_MAX = 300;

  let api = null, root = null;
  let st = null, gmMsg = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let rects = [], worldKey = null, bg = null;
  let pred = null, prevPred = null, pending = [], seq = 0, acc = 0;
  const history = new Map();
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { ox: 120, oy: 0, sx: W / 2, sy: HGT / 2, left: false, right: false };
  let cam = { x: 0, y: 0, s: 1 };
  let particles = [], floats = [], rings = [], swings = [];
  const seenFx = new Set(), othersOff = {}, lastShown = {};
  let lastSnapRecv = 0, prevPhase = null, toast = null, playSeenAt = 0;
  let tool = { kind: "room", type: "piliers" };       // l'outil du maître du jeu
  let gmErr = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const amGm = () => st?.gm === me();
  const myHero = () => heroOf(me());
  const fighting = () => st && (st.phase === "hordes" || st.phase === "donjon");
  const driving = () => st && ["hordes", "enter", "donjon"].includes(st.phase) && myHero()?.alive && myHero()?.cls;
  const WW = () => (st?.world === "donjon" ? D.WW : D.HW), WH = () => (st?.world === "donjon" ? D.WH : D.HH);
  const clsOf = (h) => D.CLASSES[h?.cls] || null;

  const TEMPLATE = `
    <style>
      .dj-classes { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 10px 0; }
      .dj-class { background: #1c1712; border: 3px solid #3a2f24; border-radius: 12px; padding: 12px; text-align: left; color: #eee; cursor: pointer; font: inherit; }
      .dj-class:hover { border-color: #8a6a3a; }
      .dj-class.on { border-color: #ffd36b; box-shadow: 0 0 18px rgba(255, 211, 107, 0.4); }
      .dj-class h3 { margin: 4px 0; font-size: 1.25rem; }
      .dj-class .big { font-size: 2.2rem; }
      .dj-class ul { margin: 6px 0 0; padding-left: 16px; font-size: 0.85rem; line-height: 1.35; }
      .dj-class .who { margin-top: 6px; font-size: 0.85rem; color: #ffd36b; min-height: 1.2em; }
      .dj-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
      .dj-tools .lbl { font-weight: 700; margin: 0 4px 0 10px; color: #c9b48a; }
      .dj-tools button { font-size: 0.95rem; padding: 6px 10px; }
      .dj-tools .budget { margin-left: auto; font-weight: 800; font-size: 1.1rem; color: #ffd36b; }
      .dj-tools .err { color: #ff7b7b; font-weight: 700; }
      @media (max-width: 900px) { .dj-classes { grid-template-columns: repeat(2, 1fr); } }
    </style>
    <div id="dj-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🐉</span>
        <h1>DONJON</h1>
        <p class="tagline">Un maître du jeu construit. Les slayers montent de niveau… puis entrent.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="dj-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🎲 À chaque manche, un joueur est le <b>maître du jeu</b> (chacun son tour). Les autres sont les <b>slayers</b>.</li>
            <li>⚔️ <b>2 min de préparation</b> : les slayers combattent des hordes pour monter de niveau et débloquer leurs sorts. <b>Les PV perdus restent perdus</b> pour le donjon !</li>
            <li>🏗️ Pendant ce temps, le maître construit son donjon : salles, ennemis, pièges, boss.</li>
            <li>🚪 <b>3 min de donjon</b> : il faut tuer le boss. Le maître déclenche ses pièges, lâche des renforts et peut piloter le boss.</li>
            <li>🎮 Slayer : <kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> bouger · clic attaquer · <kbd>A</kbd><kbd>E</kbd><kbd>R</kbd> (ou 1 2 3) sorts · <kbd>Espace</kbd> esquive.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="dj-start" class="btn btn-primary btn-big">🐉 Ouvrir le donjon</button>
        <p id="dj-hint" class="muted"></p>
        <p id="dj-error" class="error-msg"></p>
        <button id="dj-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="dj-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="dj-round"></span>
        <span id="dj-me" class="ch-role"></span>
        <span id="dj-phase" class="pill"></span>
      </div>
      <div id="dj-tools" class="dj-tools hidden"></div>
      <div class="pt-arena-wrap">
        <canvas id="dj-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="dj-feed" class="so-feed"></ul>
        <div id="dj-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys" id="dj-keys"></p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.donjon = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; gmMsg = null; pred = prevPred = null; pending = []; particles = []; floats = []; rings = []; swings = []; worldKey = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("dj-canvas");
      g2d = canvas.getContext("2d");
      $("dj-start").onclick = () => { $("dj-error").textContent = ""; api.action("start").then((r) => { if (r.error) $("dj-error").textContent = r.error; }); };
      $("dj-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", onBlur);
      window.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      canvas.addEventListener("contextmenu", (e) => e.preventDefault());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      if (st.phase !== prevPhase) {
        if (["choose", "enter"].includes(st.phase)) { pending = []; pred = prevPred = null; history.clear(); }
        if (st.phase === "hordes" || st.phase === "donjon") playSeenAt = performance.now();
        if (st.phase === "choose") gmMsg = null;
      }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if ((["setup", "over"].includes(st.phase) || amGm()) && document.pointerLockElement === canvas) document.exitPointerLock();
      if (st.phase === "setup") { $("dj-play").classList.add("hidden"); $("dj-setup").classList.remove("hidden"); renderSettings(); return; }
      $("dj-setup").classList.add("hidden");
      $("dj-play").classList.remove("hidden");
      const key = st.world === "donjon" ? JSON.stringify(st.grid) : "horde";
      if (key !== worldKey && (st.world !== "donjon" || st.grid)) { worldKey = key; rects = st.world === "donjon" ? D.walls(st.grid) : D.hordeWalls(); bg = null; }
      handleFx();
      reconcile();
      lastSnapRecv = performance.now();
      rebase();
      renderHud();
      renderTools();
      renderOverlay();
    },
    message(type, payload) {
      if (type !== "gm") return;
      const prevKey = gmMsg && JSON.stringify(gmMsg.grid);
      gmMsg = payload;
      if (amGm() && ["choose", "hordes"].includes(st?.phase) && JSON.stringify(gmMsg.grid) !== prevKey) bg = null;
      renderTools();
    },
    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", onUp);
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  // ===================================================================
  //  CLAVIER + SOURIS
  // ===================================================================
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT,
    Space: K.DASH, ShiftLeft: K.DASH, KeyQ: SK[0], Digit1: SK[0], Numpad1: SK[0], KeyE: SK[1], Digit2: SK[1], Numpad2: SK[1], KeyR: SK[2], Digit3: SK[2], Numpad3: SK[2] };
  function onBlur() { pressed.clear(); mouse.left = mouse.right = false; }
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup") return;
    if (e.code === "KeyB" && e.type === "keydown" && amGm() && st.phase === "donjon") { api.action("control", { on: !st.boss?.ctl }); return; }
    if (!(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function myPos() { if (pred) { const o = ownView(); return { x: o.x + off.x, y: o.y + off.y }; } return myHero(); }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect(), k = W / r.width;
    if (document.pointerLockElement === canvas) { mouse.ox += e.movementX * k; mouse.oy += e.movementY * k; }
    else {
      mouse.sx = (e.clientX - r.left) * k; mouse.sy = (e.clientY - r.top) * (HGT / r.height);
      if (e.target !== canvas) return;
      const p = myPos();
      if (p && !amGm()) { mouse.ox = mouse.sx / cam.s + cam.x - p.x; mouse.oy = mouse.sy / cam.s + cam.y - p.y; }
    }
    const d = Math.hypot(mouse.ox, mouse.oy);
    if (d > AIM_MAX) { mouse.ox *= AIM_MAX / d; mouse.oy *= AIM_MAX / d; }
  }
  const toWorld = () => ({ x: mouse.sx / cam.s + cam.x, y: mouse.sy / cam.s + cam.y });
  function onDown(e) {
    if (!st) return;
    onMouse(e);
    if (amGm()) { gmClick(e.button); if (e.button === 0) mouse.left = true; if (e.button === 2) mouse.right = true; return; }
    if (e.button === 0) {
      // Le 1er clic capture la souris (et compte aussi comme une attaque).
      if (document.pointerLockElement !== canvas && driving() && canvas.requestPointerLock) canvas.requestPointerLock();
      mouse.left = true;
    }
    if (e.button === 2) mouse.right = true;
  }
  function onUp(e) { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; }
  function keyMask() {
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    if (mouse.left) k |= K.FIRE;
    if (mouse.right) k |= SK[0];
    return k;
  }

  // ===================================================================
  //  LE MAÎTRE DU JEU : outils et clics
  // ===================================================================
  const say = (txt) => { gmErr = { txt, until: performance.now() + 2500 }; renderTools(true); };
  const answer = (r) => { if (r?.error) say(r.error); };
  function gmClick(button) {
    const p = toWorld();
    if (["choose", "hordes"].includes(st.phase)) {
      if (p.x < 0 || p.y < 0 || p.x > D.WW || p.y > D.WH) return;
      if (button === 2) { api.action("build", { op: "erase", x: p.x, y: p.y }).then(answer); return; }
      if (tool.kind === "room") { const c = D.cellOf(p.x, p.y); api.action("build", { op: "room", c: c.c, r: c.r, tpl: tool.type }).then(answer); }
      else if (tool.kind === "erase") api.action("build", { op: "erase", x: p.x, y: p.y }).then(answer);
      else api.action("build", { op: "put", kind: tool.kind, type: tool.type, x: p.x, y: p.y }).then(answer);
    } else if (st.phase === "donjon" && !st.boss?.ctl && button === 0) {
      // Un piège sous la souris : on le déclenche. Sinon : un renfort (si un renfort est choisi).
      const tr = (gmMsg?.traps || []).find((t) => Math.hypot(t.x - p.x, t.y - p.y) < 34);
      if (tr) { api.action("trigger", { id: tr.id }).then(answer); return; }
      if (tool.kind === "spawn") api.action("spawn", { type: tool.type, x: p.x, y: p.y }).then(answer);
    }
  }
  let toolsKey = "";
  function renderTools(force) {
    const el = $("dj-tools");
    if (!el || !st) return;
    const gm = amGm() && ["choose", "hordes", "enter", "donjon"].includes(st.phase);
    el.classList.toggle("hidden", !gm);
    if (!gm) { toolsKey = ""; return; }
    const err = gmErr && performance.now() < gmErr.until ? gmErr.txt : "";
    const build = st.phase === "choose" || st.phase === "hordes";
    const key = JSON.stringify([st.phase, tool, gmMsg?.left, Math.floor(st.energy || 0), st.boss?.ctl, err]);
    if (key === toolsKey && !force) return;
    toolsKey = key;
    const b = (kind, type, label, extra = "") => `<button class="cat-chip ${tool.kind === kind && tool.type === type ? "on" : ""}" data-kind="${kind}" data-type="${type}">${label}${extra}</button>`;
    let html;
    if (build) {
      html = `<span class="lbl">Salles</span>${D.TPL_IDS.map((id) => b("room", id, `${D.TEMPLATES[id].emoji} ${D.TEMPLATES[id].name}`)).join("")}
        <span class="lbl">Ennemis</span>${D.ENEMY_IDS.map((id) => b("enemy", id, `${D.ENEMIES[id].emoji} ${D.ENEMIES[id].name}`, ` <small>(${D.ENEMIES[id].cost})</small>`)).join("")}
        <span class="lbl">Pièges</span>${D.TRAP_IDS.map((id) => b("trap", id, `${D.TRAPS[id].emoji} ${D.TRAPS[id].name}`, ` <small>(${D.TRAPS[id].cost})</small>`)).join("")}
        <span class="lbl">Boss</span>${D.BOSS_IDS.map((id) => b("boss", id, `${D.BOSSES[id].emoji} ${D.BOSSES[id].name}`)).join("")}
        ${b("erase", "", "🧽 Gomme")}
        <span class="budget">💰 ${gmMsg ? gmMsg.left : "…"} / ${gmMsg ? gmMsg.budget : "…"}</span>`;
    } else {
      html = `<span class="lbl">Renforts</span>${D.ENEMY_IDS.map((id) => b("spawn", id, `${D.ENEMIES[id].emoji} ${D.ENEMIES[id].name}`, ` <small>(⚡${D.REINFORCE[id]})</small>`)).join("")}
        <button id="dj-ctl" class="btn ${st.boss?.ctl ? "btn-primary" : "btn-secondary"}">${st.boss?.ctl ? "🗺️ Revenir à la carte (B)" : "🎮 Piloter le boss (B)"}</button>
        <span class="budget">⚡ ${Math.floor(st.energy || 0)} / ${D.ENERGY_MAX}</span>`;
    }
    el.innerHTML = html + (err ? `<span class="err">⚠️ ${esc(err)}</span>` : "");
    el.querySelectorAll("[data-kind]").forEach((x) => { x.onclick = () => { tool = { kind: x.dataset.kind, type: x.dataset.type }; renderTools(true); }; });
    $("dj-ctl") && ($("dj-ctl").onclick = () => api.action("control", { on: !st.boss?.ctl }));
  }

  // ===================================================================
  //  PRÉDICTION DE MON PERSO (slayer)
  // ===================================================================
  const envFor = () => ({ walls: true, w: WW(), h: WH(), speedMul: clsOf(myHero())?.speed || 1, rects });
  const moveBits = (k) => k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH);
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = myHero();
    if (!sc || !driving() || amGm()) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const m = history.get(sc.seq);
    if (pred && m && same(m, sc)) return;
    const before = pred && ownView(), oldPred = pred;
    pred = H.copy(sc);
    const E = envFor();
    pending.forEach((p) => { H.simulate(pred, moveBits(p.k), p.a, E, null); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) { const after = ownView(), dx = before.x - after.x, dy = before.y - after.y; if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } }
  }
  function drive(dt) {
    acc = Math.min(acc + dt, 0.2);
    // Le maître qui pilote le boss : touches + point visé (sur la carte), 30 fois par seconde.
    if (amGm()) {
      while (acc >= H.TICK) {
        acc -= H.TICK;
        if (st.phase === "donjon" && st.boss?.ctl) { let k = 0; for (const code of pressed) k |= KEYMAP[code] & 15; if (mouse.left) k |= K.FIRE; if (mouse.right) k |= ALT; const p = toWorld(); api.send("in", { k, p: { x: Math.round(p.x), y: Math.round(p.y) } }); }
      }
      return;
    }
    if (!driving()) { acc = 0; return; }
    if (!pred) pred = H.copy(myHero());
    const E = envFor();
    while (acc >= H.TICK) {
      acc -= H.TICK;
      const k = keyMask(), a = Math.atan2(mouse.oy, mouse.ox);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k), a, E, null);
      history.set(seq, H.copy(pred));
    }
  }
  const aheadNow = () => Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownHero(h) {
    const base = fighting() ? H.extrapolate(h, aheadNow()) : h, o = othersOff[h.id] || { x: 0, y: 0 };
    const v = { ...h, x: base.x + o.x, y: base.y + o.y };
    lastShown[h.id] = v;
    return v;
  }
  function rebase() {
    for (const h of st.heroes) {
      if (h.id === me() && pred) continue;
      const prev = lastShown[h.id], base = fighting() ? H.extrapolate(h, aheadNow()) : h;
      othersOff[h.id] = prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 100 ? { x: prev.x - base.x, y: prev.y - base.y } : { x: 0, y: 0 };
    }
  }

  // ===================================================================
  //  EFFETS
  // ===================================================================
  function burst(x, y, n, col, speed, life = 0.6) {
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * speed; particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life * (0.5 + Math.random() * 0.6), max: life, col }); }
  }
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const hc = clsOf(heroOf(f.who))?.color || "#fff";
      switch (f.kind) {
        case "aie": floats.push({ x: f.x, y: f.y - 20, txt: `-${f.n}`, col: "#ff5b5b", life: 0.9 }); burst(f.x, f.y, 6, "#c0182b", 120, 0.4); break;
        case "touche": floats.push({ x: f.x + (Math.random() - 0.5) * 16, y: f.y - 18, txt: String(f.n), col: "#f4eee0", life: 0.7 }); break;
        case "crit": floats.push({ x: f.x, y: f.y - 22, txt: `${f.n} !`, col: "#ffd36b", life: 0.9, big: true }); break;
        case "meurt": burst(f.x, f.y, 18, "#d8d2c0", 200); break;
        case "boss": burst(f.x, f.y, 90, "#ffd36b", 520, 1.2); rings.push({ x: f.x, y: f.y, r: 20, grow: 420, life: 0.9, max: 0.9, col: "#ffd36b" }); break;
        case "niveau": rings.push({ x: f.x, y: f.y, r: 10, grow: 160, life: 0.6, max: 0.6, col: "#ffd36b" }); if (f.who === me()) { const sk = clsOf(myHero())?.skills.find((s) => s.lvl === f.lvl), ps = clsOf(myHero())?.passive; toast = { txt: `⭐ Niveau ${f.lvl} !${sk ? ` Nouveau sort : ${sk.name}` : ps && ps.lvl === f.lvl ? ` Passif : ${ps.name}` : ""}`, until: performance.now() + 2600 }; } break;
        case "coup": swings.push({ x: f.x, y: f.y, a: f.a, r: f.r, life: 0.16, col: hc }); break;
        case "nova": rings.push({ x: f.x, y: f.y, r: 20, grow: 700, life: 0.2, max: 0.2, col: "#9fe8ff", fill: true }); break;
        case "tourbillon": rings.push({ x: f.x, y: f.y, r: 30, grow: 400, life: 0.18, max: 0.18, col: "#ff8a4a", fill: true }); break;
        case "defi": rings.push({ x: f.x, y: f.y, r: 30, grow: 1400, life: 0.25, max: 0.25, col: "#5fb0ff" }); break;
        case "etourdi": swings.push({ x: f.x, y: f.y, a: f.a, r: 80, life: 0.25, col: "#ffe27a" }); break;
        case "teleport": burst(f.x, f.y, 22, "#c9a8ff", 220, 0.5); break;
        case "bouclier": rings.push({ x: f.x, y: f.y, r: 22, grow: 30, life: 0.4, max: 0.4, col: "#5fb0ff" }); break;
        case "charge": burst(f.x, f.y, 14, "#5fb0ff", 160, 0.4); break;
        case "rage": burst(f.x, f.y, 26, "#ff3b2f", 260, 0.6); break;
        case "explosion": burst(f.x, f.y, 34, "#ff9a3c", 320, 0.6); rings.push({ x: f.x, y: f.y, r: 10, grow: (f.r || 80) * 4, life: 0.25, max: 0.25, col: "#ffb35c", fill: true }); break;
        case "pluie": burst(f.x, f.y, 16, "#cfe8a0", 160, 0.4); break;
        case "pics": burst(f.x, f.y, 16, "#c8c8c8", 160, 0.4); break;
        case "slam": burst(f.x, f.y, 24, "#8a7a60", 260, 0.5); rings.push({ x: f.x, y: f.y, r: 10, grow: (f.r || 70) * 4, life: 0.22, max: 0.22, col: "#c9a878" }); break;
        case "griffe": burst(f.x, f.y, 6, "#ddd", 120, 0.3); break;
        case "invoque": burst(f.x, f.y, 26, "#a050ff", 200, 0.7); break;
        case "clac": burst(f.x, f.y, 14, "#d0d0d0", 160, 0.4); break;
        case "potion": burst(f.x, f.y, 18, "#ff5b8a", 140, 0.6); if (f.who === me()) toast = { txt: "🧪 Potion : +15 % de PV", until: performance.now() + 1600 }; break;
        case "releve": rings.push({ x: f.x, y: f.y, r: 10, grow: 200, life: 0.6, max: 0.6, col: "#8dffb0" }); break;
      }
    }
    if (seenFx.size > 800) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, CHOIX DES CLASSES, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("dj-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label><div class="cat-chips">${[[0, "Chacun maître 1 fois"], [2, "2"], [3, "3"]].map(([v, l]) =>
        `<button class="cat-chip ${s.rounds === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${l}</button>`).join("")}</div></div>
      <p class="settings-note">Une manche : 2 min de préparation + 3 min de donjon au plus. Les bots peuvent être slayers ou maître du jeu.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { rounds: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("dj-start").style.display = host ? "" : "none";
    $("dj-start").disabled = n < 2;
    $("dj-finish-setup").classList.toggle("hidden", !host);
    $("dj-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs (ajoute des bots)." : `${n} joueurs : 1 maître du jeu + ${n - 1} slayer${n > 2 ? "s" : ""} à chaque manche`;
  }
  const PHASES = { choose: "🎭 Choix des classes", hordes: "⚔️ Préparation", enter: "🚪 Entrée", donjon: "🐉 Le donjon", roundOver: "🏁 Fin de manche", over: "🏆 Fin" };
  function renderHud() {
    $("dj-round").textContent = `Manche ${st.round}/${st.rounds}`;
    const h = myHero(), c = clsOf(h);
    const txt = amGm() ? "🎲 Tu es le MAÎTRE DU JEU" : !h ? "👀 Tu regardes" : c ? `${c.emoji} ${esc(c.name)} · niveau ${h.lvl}` : "🎭 Choisis ta classe";
    if ($("dj-me").innerHTML !== txt) $("dj-me").innerHTML = txt;
    $("dj-phase").textContent = PHASES[st.phase] || "";
    const keys = amGm() ? (["choose", "hordes"].includes(st.phase) ? "Choisis un outil en haut, clique sur la carte pour poser · clic droit = enlever · la salle d'entrée est à gauche" : st.boss?.ctl ? "Tu pilotes le boss : ZQSD bouger · clic attaque · clic droit spéciale · B = revenir à la carte" : "Clique un piège pour le déclencher · choisis un renfort puis clique loin des slayers · B = piloter le boss")
      : "ZQSD bouger · clic attaque · A/E/R (ou 1/2/3, clic droit = sort 1) sorts · Espace esquive · Échap libère la souris";
    if ($("dj-keys").textContent !== keys) $("dj-keys").textContent = keys;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("dj-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }
  }
  function renderOverlay() {
    const ov = $("dj-overlay");
    // Le choix des classes (slayers).
    if (st.phase === "choose" && !amGm() && myHero()) {
      const key = JSON.stringify(["choose", st.round, st.heroes.map((h) => [h.id, h.cls])]);
      ov.parentElement.classList.add("over");
      if (ov.dataset.key === key) return;
      ov.dataset.key = key;
      const mine = myHero().cls;
      const cards = D.CLASS_IDS.map((id) => {
        const C = D.CLASSES[id], who = st.heroes.filter((h) => h.cls === id).map((h) => esc(pseudoOf(h.id))).join(", ");
        return `<button class="dj-class ${mine === id ? "on" : ""}" data-cls="${id}"><span class="big">${C.emoji}</span><h3 style="color:${C.color}">${esc(C.name)}</h3>
          <div class="muted">${esc(C.role)} · ❤️ ${C.hp} PV</div><ul><li><b>Clic</b> : ${esc(C.basic.name)}</li>${C.skills.map((s, i) => `<li><b>${"AER"[i]}</b> (niv. ${s.lvl}) : ${esc(s.name)}</li>`).join("")}<li>Passif (niv. ${C.passive.lvl}) : ${esc(C.passive.name)}</li></ul>
          <div class="who">${who}</div></button>`;
      }).join("");
      ov.innerHTML = `<div class="pt-over card ch-over" style="max-width:1100px"><h2 class="go-banner">🎭 Choisis ta classe · ${esc(pseudoOf(st.gm))} est le maître du jeu</h2>
        <div class="dj-classes">${cards}</div><p class="muted">Sans choix, une classe au hasard · on part dans <b id="dj-choose-sec"></b> s</p></div>`;
      ov.classList.remove("hidden");
      ov.querySelectorAll("[data-cls]").forEach((b) => { b.onclick = () => api.action("class", { cls: b.dataset.cls }); });
      return;
    }
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost(), lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const B = D.BOSSES[lr.bossType] || { emoji: "👑", name: "boss" };
    const banner = lr.bossDead ? `🏆 Les slayers ont vaincu ${B.emoji} ${esc(B.name)} !` : lr.dead === lr.total ? `💀 Le donjon de ${esc(pseudoOf(lr.gm))} a eu raison des slayers !` : `⏰ Temps écoulé : ${B.emoji} ${esc(B.name)} tient bon`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => {
      const s = lr.stats[id], C = s && D.CLASSES[s.cls];
      const detail = id === lr.gm ? `🎲 maître · ${lr.gmDmg} dégâts · ${lr.dead}/${lr.total} tombé${lr.dead > 1 ? "s" : ""}` : `${C ? C.emoji : ""} niv. ${s.lvl} · ⚔️ ${s.dmg} dégâts · ${s.alive ? `❤️ ${s.hp}/${s.maxHp}` : "💀 tombé"}`;
      return `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="muted">${detail}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`;
    }).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = `<p class="muted">Manche suivante dans <b id="dj-next-sec"></b> s…</p>` + (st.playlist ? "" : host ? `<div class="go-actions"><button id="dj-next" class="btn btn-primary">Manche suivante ▶</button><button id="dj-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : "");
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="dj-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>${host ? '<div class="go-actions"><button id="dj-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions"><button id="dj-again" class="btn btn-primary">🔁 Rejouer</button><button id="dj-to-setup" class="btn btn-secondary">Réglages</button><button id="dj-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div><p id="dj-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("dj-next") && ($("dj-next").onclick = () => api.action("next"));
    $("dj-again") && ($("dj-again").onclick = () => api.action("start").then((r) => { if (r.error) $("dj-over-error").textContent = r.error; }));
    $("dj-to-setup") && ($("dj-to-setup").onclick = () => api.action("setup"));
    $("dj-finish") && ($("dj-finish").onclick = () => { if (st.playlist?.final || confirm("Terminer Donjon ? Le classement actuel donne les points de soirée.")) api.action("finish"); });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["dj-fin-sec", finishEndLocal], ["dj-next-sec", phaseEndLocal], ["dj-choose-sec", phaseEndLocal]]) { const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); }
    if (!st || st.phase === "setup") return;
    if (gmErr && performance.now() > gmErr.until) { gmErr = null; renderTools(true); }
    drive(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }

  // Le fond (une fois par monde) : dalles de pierre, murs en briques, torches.
  function background(gridForGm) {
    const grid = gridForGm || st.grid;
    const isDj = !!grid && (st.world === "donjon" || gridForGm);
    if (bg && bg.dj === isDj) return bg;
    const w = isDj ? D.WW : D.HW, h = isDj ? D.WH : D.HH, R = isDj ? D.walls(grid) : D.hordeWalls();
    bg = document.createElement("canvas"); bg.width = w; bg.height = h; bg.dj = isDj;
    const c = bg.getContext("2d");
    c.fillStyle = "#17120e"; c.fillRect(0, 0, w, h);
    // Des dalles irrégulières.
    for (let y = 0; y < h; y += 40) for (let x = (y / 40) % 2 ? -20 : 0; x < w; x += 40) {
      const n = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      c.fillStyle = `rgb(${40 + Math.abs(n) * 14},${33 + Math.abs(n) * 11},${27 + Math.abs(n) * 8})`;
      c.fillRect(x + 1, y + 1, 38, 38);
    }
    if (isDj) {
      // Couleur de sol selon la salle ; l'entrée en vert.
      for (let r = 0; r < D.ROWS; r++) for (let cc = 0; cc < D.COLS; cc++) {
        const tint = cc === D.ENTRY.c && r === D.ENTRY.r ? "rgba(60,200,120,0.12)" : { piliers: "rgba(120,90,60,0.08)", croix: "rgba(80,80,120,0.08)", arene: "rgba(140,50,40,0.08)", dedale: "rgba(60,100,80,0.08)", etroit: "rgba(110,110,60,0.08)" }[grid[r][cc]] || "rgba(0,0,0,0)";
        c.fillStyle = tint; c.fillRect(cc * D.CW, r * D.CH, D.CW, D.CH);
      }
      const e = D.cellRect(D.ENTRY.c, D.ENTRY.r);
      c.font = "bold 22px Georgia, serif"; c.textAlign = "center"; c.fillStyle = "rgba(140,255,180,0.35)"; c.fillText("ENTRÉE", e.x + e.w / 2, e.y + 40);
    }
    // Les murs : des briques.
    for (const o of R) {
      c.fillStyle = "#3b3026"; c.fillRect(o.x, o.y, o.w, o.h);
      c.strokeStyle = "rgba(0,0,0,0.45)"; c.lineWidth = 1;
      for (let y = o.y; y < o.y + o.h; y += 12) { c.beginPath(); c.moveTo(o.x, y); c.lineTo(o.x + o.w, y); c.stroke(); for (let x = o.x + ((y / 12) % 2 ? 0 : 12); x < o.x + o.w; x += 24) { c.beginPath(); c.moveTo(x, y); c.lineTo(x, Math.min(y + 12, o.y + o.h)); c.stroke(); } }
      c.strokeStyle = "#5a4836"; c.lineWidth = 2; c.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
    }
    return bg;
  }
  function torchLight(c, x, y, ts, r = 170) {
    const f = 1 + Math.sin(ts / 90 + x) * 0.04 + Math.sin(ts / 37 + y) * 0.03;
    const gr = c.createRadialGradient(x, y, 4, x, y, r * f);
    gr.addColorStop(0, "rgba(255,190,110,0.28)"); gr.addColorStop(1, "rgba(255,160,80,0)");
    c.fillStyle = gr; c.fillRect(x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
  }

  function setCamera() {
    if (amGm() && (["choose", "hordes"].includes(st.phase) || ((st.phase === "donjon" || st.phase === "enter" || st.phase === "roundOver" || st.phase === "over") && !st.boss?.ctl))) {
      const s = Math.min(W / D.WW, HGT / D.WH);
      cam = { s, x: -(W / s - D.WW) / 2, y: -(HGT / s - D.WH) / 2 };
      return;
    }
    let focus = null;
    if (amGm()) { const b = st.enemies.find((e) => e.boss); focus = b || { x: D.WW / 2, y: D.WH / 2 }; }
    else {
      const p = myPos();
      if (myHero()?.alive) focus = p;
      else { const a = st.heroes.find((h) => h.alive && h.id !== me()); focus = a ? shownHero(a) : p; }
    }
    if (!focus) focus = { x: WW() / 2, y: WH() / 2 };
    cam = { s: 1, x: Math.max(0, Math.min(WW() - W, focus.x - W / 2)), y: Math.max(0, Math.min(WH() - HGT, focus.y - HGT / 2)) };
  }

  function draw(ts, dt) {
    const c = g2d;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = "#0b0907"; c.fillRect(0, 0, W, HGT);
    const building = amGm() && ["choose", "hordes"].includes(st.phase);
    if (building && !gmMsg) { c.fillStyle = "#e8dcc0"; c.font = "24px Georgia, serif"; c.textAlign = "center"; c.fillText("Préparation du donjon…", W / 2, HGT / 2); return; }
    setCamera();
    c.setTransform(cam.s, 0, 0, cam.s, -cam.x * cam.s, -cam.y * cam.s);
    c.drawImage(background(building ? gmMsg.grid : null), 0, 0);
    if (building) { drawBuild(c, ts); c.setTransform(1, 0, 0, 1, 0, 0); drawGmHud(c); return; }
    // Lumière des torches (aux coins des salles, ou autour de l'arène).
    c.globalCompositeOperation = "lighter";
    if (st.world === "donjon") { for (let r = 0; r < D.ROWS; r++) for (let cc = 0; cc < D.COLS; cc++) torchLight(c, cc * D.CW + D.CW / 2, r * D.CH + 30, ts); }
    else for (const [x, y] of [[40, 40], [D.HW - 40, 40], [40, D.HH - 40], [D.HW - 40, D.HH - 40], [D.HW / 2, 40], [D.HW / 2, D.HH - 40]]) torchLight(c, x, y, ts, 260);
    c.globalCompositeOperation = "source-over";
    // Les pièges (le maître seul les voit).
    if (amGm() && gmMsg?.traps) for (const tr of gmMsg.traps) drawTrapIcon(c, tr, ts, tr.ready <= 0);
    // Zones annoncées (elles se remplissent avant de frapper).
    for (const z of st.zones || []) {
      const f = z.tot ? 1 - z.left / z.tot : 1;
      const col = z.side === "slayer" ? "120,200,255" : "255,60,50";
      c.fillStyle = `rgba(${col},${0.12 + f * 0.18})`; c.strokeStyle = `rgba(${col},0.8)`; c.lineWidth = 2;
      if (z.k === "pics") { c.fillRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h); c.strokeRect(z.x - z.w / 2, z.y - z.h / 2, z.w, z.h); }
      else { c.beginPath(); c.arc(z.x, z.y, z.r, 0, Math.PI * 2); c.fill(); c.stroke(); c.beginPath(); c.arc(z.x, z.y, z.r * f, 0, Math.PI * 2); c.stroke(); }
    }
    for (const sn of st.snares || []) { c.strokeStyle = "#bfbfbf"; c.lineWidth = 3; c.beginPath(); c.arc(sn.x, sn.y, 12, 0, Math.PI * 2); c.stroke(); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; c.beginPath(); c.moveTo(sn.x + Math.cos(a) * 8, sn.y + Math.sin(a) * 8); c.lineTo(sn.x + Math.cos(a) * 15, sn.y + Math.sin(a) * 15); c.stroke(); } }
    for (const p of st.potions || []) { const b = Math.sin(ts / 200 + p.id) * 3; c.fillStyle = "#ff5b8a"; c.beginPath(); c.arc(p.x, p.y + b, 9, 0, Math.PI * 2); c.fill(); c.fillStyle = "#fff"; c.fillRect(p.x - 3, p.y - 14 + b, 6, 6); }
    // Les ennemis (et leurs attaques annoncées).
    const ahead = aheadNow();
    for (const e of st.enemies || []) drawEnemy(c, e, ts);
    // Les slayers.
    for (const h of st.heroes) {
      const v = h.id === me() && pred ? (() => { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y, face: Math.atan2(mouse.oy, mouse.ox) }; })() : shownHero(h);
      drawHero(c, v, h, ts);
    }
    // Les tirs.
    for (const b of st.shots || []) drawShot(c, { ...b, x: b.x + b.vx * ahead, y: b.y + b.vy * ahead });
    // Coups, ondes, particules, chiffres.
    swings = swings.filter((s) => (s.life -= dt) > 0);
    for (const s of swings) { c.strokeStyle = s.col; c.globalAlpha = s.life * 5; c.lineWidth = 6; c.beginPath(); c.arc(s.x, s.y, s.r, s.a - 1.1, s.a + 1.1); c.stroke(); c.globalAlpha = 1; }
    rings = rings.filter((r) => (r.life -= dt) > 0);
    for (const r of rings) { r.r += r.grow * dt; c.globalAlpha = r.life / r.max; c.strokeStyle = r.col; c.lineWidth = 4; c.beginPath(); c.arc(r.x, r.y, r.r, 0, Math.PI * 2); c.stroke(); if (r.fill) { c.fillStyle = r.col; c.globalAlpha *= 0.25; c.fill(); } c.globalAlpha = 1; }
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; c.globalAlpha = Math.max(0, p.life / p.max); c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    c.globalAlpha = 1;
    c.textAlign = "center"; c.textBaseline = "middle";
    floats = floats.filter((f) => (f.life -= dt) > 0);
    for (const f of floats) { f.y -= 40 * dt; c.globalAlpha = Math.min(1, f.life * 2); c.font = `900 ${f.big ? 22 : 15}px Segoe UI, sans-serif`; c.fillStyle = "#000"; c.fillText(f.txt, f.x + 1, f.y + 1); c.fillStyle = f.col; c.fillText(f.txt, f.x, f.y); }
    c.globalAlpha = 1;
    // Mon viseur.
    const mh = myHero();
    if (mh?.alive && pred && fighting()) {
      const o = ownView(), x = o.x + off.x + mouse.ox, y = o.y + off.y + mouse.oy;
      c.strokeStyle = "rgba(255,240,210,0.9)"; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.moveTo(x - 15, y); c.lineTo(x - 5, y); c.moveTo(x + 5, y); c.lineTo(x + 15, y); c.moveTo(x, y - 15); c.lineTo(x, y - 5); c.moveTo(x, y + 5); c.lineTo(x, y + 15); c.stroke();
    }
    // Le maître qui pilote le boss : où il vise.
    if (amGm() && st.boss?.ctl) { const p = toWorld(); c.strokeStyle = "#ff5040"; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, 12, 0, Math.PI * 2); c.stroke(); }
    // Un peu d'ombre sur les bords (on est sous terre).
    c.setTransform(1, 0, 0, 1, 0, 0);
    const vg = c.createRadialGradient(W / 2, HGT / 2, HGT * 0.35, W / 2, HGT / 2, HGT * 0.9);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.55)");
    if (!amGm() || st.boss?.ctl) { c.fillStyle = vg; c.fillRect(0, 0, W, HGT); }
    if (amGm()) drawGmHud(c); else drawSlayerHud(c, ts);
  }

  function drawTrapIcon(c, tr, ts, ready) {
    const def = D.TRAPS[tr.type];
    c.globalAlpha = ready ? 0.9 : 0.4;
    c.strokeStyle = ready ? "#ffcf5c" : "#888"; c.lineWidth = 2; c.setLineDash([5, 4]);
    if (def.r) { c.beginPath(); c.arc(tr.x, tr.y, def.r, 0, Math.PI * 2); c.stroke(); }
    else c.strokeRect(tr.x - def.w / 2, tr.y - def.h / 2, def.w, def.h);
    c.setLineDash([]);
    c.font = "26px Segoe UI Emoji, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(def.emoji, tr.x, tr.y);
    if (!ready && tr.ready > 0) { c.font = "bold 14px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(`${Math.ceil(tr.ready / 1000)} s`, tr.x, tr.y + 26); }
    c.globalAlpha = 1;
  }
  function drawEnemy(c, e, ts) {
    if (e.wind) {
      const f = e.wind.tot ? 1 - e.wind.left / e.wind.tot : 1;
      c.fillStyle = `rgba(255,40,30,${0.1 + f * 0.25})`; c.strokeStyle = "rgba(255,60,40,0.85)"; c.lineWidth = 2;
      c.beginPath(); c.arc(e.wind.x, e.wind.y, e.wind.r, 0, Math.PI * 2); c.fill(); c.stroke();
      c.beginPath(); c.arc(e.wind.x, e.wind.y, e.wind.r * f, 0, Math.PI * 2); c.stroke();
    }
    const def = e.boss ? D.BOSSES[e.t] : D.ENEMIES[e.t];
    const r = e.r;
    c.save(); c.translate(e.x, e.y);
    c.fillStyle = "rgba(0,0,0,0.45)"; c.beginPath(); c.ellipse(4, 6, r, r * 0.8, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = e.awake ? 1 : 0.8;
    c.rotate(e.face || 0);
    c.fillStyle = def.color; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.6)"; c.lineWidth = 3; c.stroke();
    if (e.boss) {
      if (e.t === "golem") { c.fillStyle = "#6f665a"; for (const [x, y] of [[-12, -14], [10, 12], [-6, 14]]) { c.beginPath(); c.arc(x, y, 7, 0, Math.PI * 2); c.fill(); } }
      if (e.t === "dragon") { c.fillStyle = "#8a2a1c"; c.beginPath(); c.moveTo(-10, -r); c.lineTo(-30, -r - 22); c.lineTo(4, -r + 4); c.fill(); c.beginPath(); c.moveTo(-10, r); c.lineTo(-30, r + 22); c.lineTo(4, r - 4); c.fill(); }
      if (e.t === "necro") { c.fillStyle = "#2a1640"; c.beginPath(); c.arc(-4, 0, r - 6, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = "#ffdd55"; c.beginPath(); c.arc(r * 0.55, -7, 4, 0, Math.PI * 2); c.arc(r * 0.55, 7, 4, 0, Math.PI * 2); c.fill();
    } else {
      c.fillStyle = "#1a1612"; c.beginPath(); c.arc(r * 0.45, -5, 3, 0, Math.PI * 2); c.arc(r * 0.45, 5, 3, 0, Math.PI * 2); c.fill();
      if (e.t === "archer") { c.strokeStyle = "#6b4a2a"; c.lineWidth = 3; c.beginPath(); c.arc(r - 2, 0, 10, -1.2, 1.2); c.stroke(); }
      if (e.t === "squelette") { c.fillStyle = "#9a9a9a"; c.fillRect(r - 2, -2, 14, 4); }
      if (e.t === "brute") { c.fillStyle = "#5a3a20"; c.fillRect(r - 4, -5, 18, 10); }
    }
    c.restore();
    if (e.stun) { c.fillStyle = "#ffe27a"; c.font = "16px Segoe UI Emoji"; c.textAlign = "center"; c.fillText("💫", e.x, e.y - r - 10); }
    if (e.slow) { c.strokeStyle = "rgba(150,220,255,0.8)"; c.lineWidth = 2; c.beginPath(); c.arc(e.x, e.y, r + 4, 0, Math.PI * 2); c.stroke(); }
    // Barre de vie (si blessé, ou le boss).
    if (e.hp < e.mh || e.boss) {
      const w = e.boss ? 90 : r * 2.2, y = e.y - r - (e.boss ? 18 : 9);
      c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(e.x - w / 2 - 1, y - 1, w + 2, e.boss ? 9 : 6);
      c.fillStyle = e.boss ? "#ff4a3a" : "#e05a4a"; c.fillRect(e.x - w / 2, y, w * Math.max(0, e.hp / e.mh), e.boss ? 7 : 4);
    }
    if (!e.awake && !e.boss) { c.fillStyle = "rgba(230,230,255,0.6)"; c.font = "bold 12px Segoe UI"; c.textAlign = "center"; c.fillText("z", e.x + r, e.y - r); }
  }
  function drawHero(c, v, h, ts) {
    const C = clsOf(h);
    if (!C) return;
    const col = C.color, isMe = h.id === me();
    if (!h.alive) {
      // Tombé : une silhouette au sol, et la jauge de relève.
      c.globalAlpha = 0.6; c.fillStyle = col; c.beginPath(); c.ellipse(v.x, v.y, 18, 10, 0.4, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      c.font = "18px Segoe UI Emoji"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("💀", v.x, v.y);
      if (st.phase === "donjon") { c.strokeStyle = "rgba(141,255,176,0.35)"; c.lineWidth = 2; c.setLineDash([4, 4]); c.beginPath(); c.arc(v.x, v.y, 55, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); if (h.revive > 0) { c.strokeStyle = "#8dffb0"; c.lineWidth = 5; c.beginPath(); c.arc(v.x, v.y, 26, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * h.revive); c.stroke(); } }
      return;
    }
    c.save(); c.translate(v.x, v.y);
    c.fillStyle = "rgba(0,0,0,0.45)"; c.beginPath(); c.ellipse(4, 6, 17, 13, 0, 0, Math.PI * 2); c.fill();
    if (h.dashT > 0) c.globalAlpha = 0.55;
    if (h.rage) { c.fillStyle = "rgba(255,50,30,0.3)"; c.beginPath(); c.arc(0, 0, 26, 0, Math.PI * 2); c.fill(); }
    c.rotate(v.face || 0);
    // L'arme selon la classe.
    c.strokeStyle = h.cls === "mage" ? "#8a6a4a" : h.cls === "archer" ? "#7a5530" : "#cfd6de"; c.lineWidth = h.cls === "archer" ? 3 : 5;
    if (h.cls === "archer") { c.beginPath(); c.arc(10, 0, 16, -1.1, 1.1); c.stroke(); }
    else if (h.cls === "mage") { c.beginPath(); c.moveTo(4, 12); c.lineTo(28, 12); c.stroke(); c.fillStyle = "#c9a8ff"; c.beginPath(); c.arc(29, 12, 5, 0, Math.PI * 2); c.fill(); }
    else { c.beginPath(); c.moveTo(10, 10); c.lineTo(36, 10); c.stroke(); if (h.cls === "armes") { c.fillStyle = "#cfd6de"; c.beginPath(); c.moveTo(30, 2); c.lineTo(40, 10); c.lineTo(30, 18); c.fill(); } }
    c.fillStyle = col; c.beginPath(); c.arc(0, 0, H.R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#1a120a"; c.lineWidth = 3; c.stroke();
    if (h.cls === "chevalier") { c.fillStyle = "#3a6fb0"; c.fillRect(6, -16, 8, 18); }
    c.fillStyle = "#f0d8b8"; c.beginPath(); c.arc(3, 0, 7, 0, Math.PI * 2); c.fill();
    c.restore();
    c.globalAlpha = 1;
    if (h.shield) { c.strokeStyle = "rgba(120,190,255,0.9)"; c.lineWidth = 4; c.beginPath(); c.arc(v.x, v.y, 26, 0, Math.PI * 2); c.stroke(); }
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = isMe ? "#fff" : col; c.fillText(`${pseudoOf(h.id)} · ${h.lvl}`, v.x, v.y - 36);
    const w = 40, f = Math.max(0, h.hp / h.maxHp);
    c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(v.x - w / 2 - 1, v.y - 28, w + 2, 6);
    c.fillStyle = f > 0.5 ? "#5fe08a" : f > 0.25 ? "#ffcf5c" : "#ff5b5b"; c.fillRect(v.x - w / 2, v.y - 27, w * f, 4);
    if (isMe && window.VehicleArt?.markMe) window.VehicleArt.markMe(c, v.x, v.y, ts, "#ffffff", window.VehicleArt.markAlpha(st.phase === "enter" ? "countdown" : "play", playSeenAt), 1);
  }
  const SHOT_COL = { orbe: "#c9a8ff", fleche: "#e8d8a0", percant: "#8dffb0", feu: "#ff9a3c", os: "#f0ead8", sombre: "#a050ff", rocher: "#8a7a60" };
  function drawShot(c, b) {
    const col = SHOT_COL[b.k] || "#fff";
    if (b.k === "fleche" || b.k === "percant") {
      const a = Math.atan2(b.vy, b.vx), L = b.k === "percant" ? 26 : 16;
      c.strokeStyle = col; c.lineWidth = b.k === "percant" ? 4 : 2; c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x - Math.cos(a) * L, b.y - Math.sin(a) * L); c.stroke();
      return;
    }
    c.fillStyle = col; c.globalAlpha = 0.35; c.beginPath(); c.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    c.fillStyle = col; c.beginPath(); c.arc(b.x, b.y, b.r, 0, Math.PI * 2); c.fill();
  }

  // La construction : la grille, ce qui est posé, et l'outil sous la souris.
  function drawBuild(c, ts) {
    const m = gmMsg;
    c.strokeStyle = "rgba(255,211,107,0.25)"; c.lineWidth = 3;
    for (let r = 0; r <= D.ROWS; r++) { c.beginPath(); c.moveTo(0, r * D.CH); c.lineTo(D.WW, r * D.CH); c.stroke(); }
    for (let cc = 0; cc <= D.COLS; cc++) { c.beginPath(); c.moveTo(cc * D.CW, 0); c.lineTo(cc * D.CW, D.WH); c.stroke(); }
    c.textAlign = "center"; c.textBaseline = "middle";
    for (let r = 0; r < D.ROWS; r++) for (let cc = 0; cc < D.COLS; cc++) { const T = D.TEMPLATES[m.grid[r][cc]]; c.font = "bold 22px Georgia, serif"; c.fillStyle = "rgba(255,230,180,0.28)"; c.fillText(T.name, cc * D.CW + D.CW / 2, r * D.CH + D.CH - 30); }
    for (const e of m.items.enemies || []) { const def = D.ENEMIES[e.type]; c.fillStyle = def.color; c.beginPath(); c.arc(e.x, e.y, def.r, 0, Math.PI * 2); c.fill(); c.font = `${def.r * 1.4}px Segoe UI Emoji`; c.fillText(def.emoji, e.x, e.y + 1); }
    for (const tr of m.items.traps || []) drawTrapIcon(c, { ...tr, ready: 0 }, ts, true);
    if (m.items.boss) { const B = D.BOSSES[m.items.boss.type]; c.fillStyle = B.color; c.beginPath(); c.arc(m.items.boss.x, m.items.boss.y, B.r, 0, Math.PI * 2); c.fill(); c.strokeStyle = "#ffd36b"; c.lineWidth = 4; c.stroke(); c.font = "40px Segoe UI Emoji"; c.fillText(B.emoji, m.items.boss.x, m.items.boss.y + 2); }
    // L'aperçu de l'outil.
    const p = toWorld();
    if (p.x > 0 && p.y > 0 && p.x < D.WW && p.y < D.WH) {
      const cell = D.cellOf(p.x, p.y), entry = cell.c === D.ENTRY.c && cell.r === D.ENTRY.r;
      if (tool.kind === "room") { c.fillStyle = entry ? "rgba(255,60,60,0.15)" : "rgba(255,211,107,0.15)"; c.fillRect(cell.c * D.CW, cell.r * D.CH, D.CW, D.CH); c.font = "bold 26px Georgia, serif"; c.fillStyle = "#ffd36b"; c.fillText(entry ? "Entrée (fixe)" : `${D.TEMPLATES[tool.type].emoji} ${D.TEMPLATES[tool.type].name}`, cell.c * D.CW + D.CW / 2, cell.r * D.CH + D.CH / 2); }
      else if (tool.kind !== "erase") { const r = tool.kind === "enemy" ? D.ENEMIES[tool.type].r : tool.kind === "boss" ? D.BOSSES[tool.type].r : D.TRAPS[tool.type].r || 35; c.strokeStyle = entry || !D.free(D.walls(m.grid), p.x, p.y, tool.kind === "trap" ? 4 : r, D.WW, D.WH) ? "#ff5b5b" : "#ffd36b"; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, r, 0, Math.PI * 2); c.stroke(); }
      else { c.strokeStyle = "#ff8a8a"; c.lineWidth = 3; c.beginPath(); c.arc(p.x, p.y, 30, 0, Math.PI * 2); c.stroke(); }
    }
  }

  function clock(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
  function topBanner(c, txt, sub, col = "#ffe9c0") {
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "900 24px Georgia, serif";
    const w = Math.max(c.measureText(txt).width, sub ? (c.font = "16px Georgia, serif", c.measureText(sub).width) : 0) + 40;
    c.fillStyle = "rgba(10,7,4,0.78)"; c.beginPath(); c.roundRect(W / 2 - w / 2, 8, w, sub ? 64 : 42, 10); c.fill();
    c.font = "900 24px Georgia, serif"; c.fillStyle = col; c.fillText(txt, W / 2, 30);
    if (sub) { c.font = "16px Georgia, serif"; c.fillStyle = "#cdbb98"; c.fillText(sub, W / 2, 56); }
  }
  function drawGmHud(c) {
    const left = phaseEndLocal - Date.now();
    if (["choose", "hordes"].includes(st.phase)) topBanner(c, `🏗️ Construis ton donjon · ${clock(st.phase === "choose" ? left + 120000 : left)}`, "Les slayers montent de niveau pendant ce temps. Le boss est obligatoire (sinon : au hasard, au fond).");
    else if (st.phase === "enter") topBanner(c, `🚪 Ils entrent dans ${Math.ceil(left / 1000)} s…`, "Prépare tes pièges : clique dessus pour les déclencher.");
    else if (st.phase === "donjon") {
      topBanner(c, `🐉 ${clock(left)} · ⚡ ${Math.floor(st.energy)}`, st.boss?.ctl ? "Tu pilotes le boss" : "Pièges : clique dessus · renfort : choisis en haut puis clique (loin des slayers)", "#ffcf5c");
      // Les slayers : qui reste, et ses PV.
      c.textAlign = "left"; c.font = "bold 14px Segoe UI, sans-serif";
      st.heroes.forEach((h, i) => {
        const y = 90 + i * 24, C = clsOf(h);
        c.fillStyle = "rgba(10,7,4,0.75)"; c.fillRect(10, y - 10, 210, 20);
        c.fillStyle = h.alive ? "#fff" : "#888"; c.fillText(`${C?.emoji || ""} ${pseudoOf(h.id)} ${h.alive ? "" : "💀"}`, 16, y);
        c.fillStyle = "#333"; c.fillRect(140, y - 4, 74, 8); c.fillStyle = "#ff5b5b"; c.fillRect(140, y - 4, 74 * Math.max(0, h.hp / h.maxHp), 8);
      });
    }
  }
  function drawSlayerHud(c, ts) {
    const h = myHero(), C = clsOf(h), left = phaseEndLocal - Date.now();
    if (st.phase === "hordes") topBanner(c, `⚔️ Hordes · ${clock(left)}`, `Monte de niveau ! Les PV perdus restent perdus. ${pseudoOf(st.gm)} construit le donjon…`);
    else if (st.phase === "enter") topBanner(c, `🚪 Entrée dans le donjon dans ${Math.ceil(left / 1000)} s`, "Trouvez le boss et tuez-le. Attention aux pièges cachés !");
    else if (st.phase === "donjon") topBanner(c, `🐉 ${clock(left)}`, st.boss?.awake ? `${D.BOSSES[st.boss.type].emoji} ${D.BOSSES[st.boss.type].name}${st.boss.ctl ? ` (piloté par ${pseudoOf(st.gm)})` : ""}` : "Trouvez le boss");
    if (!h || !C) return;
    // En bas au milieu : PV, expérience, attaques.
    const x0 = W / 2 - 230, y0 = HGT - 92;
    c.fillStyle = "rgba(10,7,4,0.8)"; c.beginPath(); c.roundRect(x0, y0, 460, 84, 12); c.fill();
    const f = Math.max(0, h.hp / h.maxHp);
    c.fillStyle = "#2a1e16"; c.fillRect(x0 + 12, y0 + 10, 436, 16);
    c.fillStyle = f > 0.5 ? "#4cc870" : f > 0.25 ? "#e0b040" : "#e04545"; c.fillRect(x0 + 12, y0 + 10, 436 * f, 16);
    c.font = "bold 13px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#fff"; c.fillText(`❤️ ${h.hp} / ${h.maxHp}`, W / 2, y0 + 18);
    const lo = D.XP[h.lvl - 1] || 0, hi = D.XP[h.lvl], xf = hi ? (h.xp - lo) / (hi - lo) : 1;
    c.fillStyle = "#2a1e16"; c.fillRect(x0 + 12, y0 + 29, 436, 5); c.fillStyle = "#ffd36b"; c.fillRect(x0 + 12, y0 + 29, 436 * Math.min(1, xf), 5);
    const slots = [{ name: C.basic.name, key: "Clic", lvl: 1, cd: C.basic.cd }, ...C.skills.map((s, i) => ({ ...s, key: "AER"[i] }))];
    slots.forEach((s, i) => {
      const x = x0 + 12 + i * 96, y = y0 + 40, locked = h.lvl < s.lvl, cdl = h.cds[i] || 0;
      c.fillStyle = locked ? "#1c1611" : "#3a2c1e"; c.beginPath(); c.roundRect(x, y, 90, 38, 6); c.fill();
      if (!locked && cdl > 0) { c.fillStyle = "rgba(0,0,0,0.55)"; c.fillRect(x, y, 90 * Math.min(1, cdl / (s.cd || 1000)), 38); }
      c.textAlign = "left"; c.font = "bold 11px Segoe UI, sans-serif"; c.fillStyle = locked ? "#6a5a48" : "#ffd36b"; c.fillText(s.key, x + 6, y + 10);
      c.font = "bold 12px Segoe UI, sans-serif"; c.fillStyle = locked ? "#6a5a48" : "#fff"; c.fillText(locked ? `🔒 niveau ${s.lvl}` : s.name, x + 6, y + 27);
      if (!locked && cdl > 0) { c.textAlign = "right"; c.fillStyle = "#fff"; c.fillText(`${Math.ceil(cdl / 1000)}`, x + 84, y + 10); }
    });
    const ps = C.passive, x = x0 + 12 + 4 * 96;
    c.textAlign = "left"; c.font = "bold 11px Segoe UI, sans-serif"; c.fillStyle = h.lvl >= ps.lvl ? "#8dffb0" : "#6a5a48"; c.fillText(h.lvl >= ps.lvl ? `✦ ${ps.name}` : `🔒 passif niv. ${ps.lvl}`, x - 4, y0 + 52);
    c.fillText(`Niveau ${h.lvl}`, x - 4, y0 + 70);
    // Mort / relève / retour.
    c.textAlign = "center";
    if (!h.alive) {
      const txt = st.phase === "hordes" ? `💀 Tu es tombé · retour dans ${Math.ceil(h.respawn / 1000)} s (avec 30 % de PV)` : `💀 Tu es tombé · un allié peut te relever en restant 3 s près de toi`;
      c.font = "900 24px Georgia, serif"; c.fillStyle = "rgba(10,7,4,0.8)"; const w = c.measureText(txt).width + 40; c.fillRect(W / 2 - w / 2, HGT / 2 - 26, w, 52);
      c.fillStyle = "#ff8a8a"; c.fillText(txt, W / 2, HGT / 2);
    }
    if (toast && performance.now() < toast.until) { c.font = "900 26px Georgia, serif"; c.fillStyle = "#ffd36b"; c.fillText(toast.txt, W / 2, HGT - 120); }
    if (driving() && document.pointerLockElement !== canvas && fighting()) { c.font = "bold 15px Segoe UI, sans-serif"; c.fillStyle = "rgba(255,240,210,0.9)"; c.fillText("🖱️ Clique sur le jeu : ton viseur te suivra", W / 2, HGT - 104); }
  }
})();
