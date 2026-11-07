// ===================================================================
//  FOULE — Client (s'affiche dans le hub Le Bordel)
//  Style film noir : une place la nuit, sous la pluie, éclairée par des
//  lampadaires. Un joueur est le sniper (un laser rouge, visible par tous) ;
//  les autres se cachent parmi les passants. Seul MON perso est marqué,
//  et seulement sur MON écran.
//  - Le serveur m'envoie en privé mon rôle et mon personnage (« me »).
//  - Caché : mon perso est calculé ici tout de suite (prédiction), puis recalé.
// ===================================================================

(() => {
  const H = window.Pieton;
  const K = H.K;
  const W = 1280, HGT = 800, WALK = 0.42, JOG = 0.66, RELOAD = 1600;   // (les mêmes que games/foule/server.js)

  let api = null, root = null;
  let st = null, mineMsg = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, bg = null, bgKey = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  const mouse = { x: W / 2, y: HGT / 2, down: false };
  let particles = [], shots = [];
  const seenFx = new Set();
  let rain = [], prevPhase = null, playSeenAt = 0, lastSnapRecv = 0, doneToast = 0, lastMissions = 0;
  const shownOff = {}, lastShown = {};

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const driving = () => st?.phase === "play";
  const amSniper = () => st?.sniper === me();
  const myEnt = () => (mineMsg && mineMsg.round === st?.round && mineMsg.role === "hider" ? mineMsg : null);

  const TEMPLATE = `
    <div id="fo-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🕴️</span>
        <h1>FOULE</h1>
        <p class="tagline">Un sniper. Une foule. Qui sera trahi par sa démarche ?</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="fo-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🎯 À chaque manche, un joueur est le <b>sniper</b> (chacun son tour). Son <b>laser</b> rouge est visible par tous.</li>
            <li>🕴️ Les autres sont <b>cachés parmi les passants</b>. Imite-les : marche, arrête-toi, rejoins un groupe, assieds-toi près d'un banc, trottine (<kbd>Espace</kbd>).</li>
            <li>🖱️ Caché : à l'arrêt, ton perso regarde vers ta souris (comme un passant qui regarde autour).</li>
            <li>🔫 Sniper : vise à la souris, clic pour tirer. Peu de balles : un passant tué, c'est une balle perdue.</li>
            <li>📋 Caché : tu as des <b>missions</b> (toi seul les vois) : passer près de la fontaine, t'asseoir sur un banc, rejoindre un groupe… Fais-les sans te faire remarquer !</li>
            <li>🏆 Sniper : +3 par joueur touché. Caché : +2 par mission, +1 toutes les 30 s en vie, +2 si tu survis.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="fo-start" class="btn btn-primary btn-big">🕴️ Entrer dans la foule</button>
        <p id="fo-hint" class="muted"></p>
        <p id="fo-error" class="error-msg"></p>
        <button id="fo-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="fo-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="fo-round"></span>
        <span id="fo-me" class="ch-role"></span>
        <span id="fo-left" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="fo-canvas" width="${W}" height="${HGT}"></canvas>
        <ul id="fo-feed" class="so-feed"></ul>
        <div id="fo-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys" id="fo-keys"></p>
    </div>`;

  window.GAMES.foule = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; mineMsg = null; pred = prevPred = null; pending = []; particles = []; shots = []; bg = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-night");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("fo-canvas");
      g2d = canvas.getContext("2d");
      rain = Array.from({ length: 160 }, () => ({ x: Math.random() * W, y: Math.random() * HGT, v: 500 + Math.random() * 400 }));
      $("fo-start").onclick = () => { $("fo-error").textContent = ""; api.action("start").then((r) => { if (r.error) $("fo-error").textContent = r.error; }); };
      $("fo-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", onBlur);
      window.addEventListener("mousemove", onMouse);
      canvas.addEventListener("mousedown", onDown);
      window.addEventListener("mouseup", onUp);
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (st.phase === "setup") { $("fo-play").classList.add("hidden"); $("fo-setup").classList.remove("hidden"); renderSettings(); return; }
      $("fo-setup").classList.add("hidden");
      $("fo-play").classList.remove("hidden");
      handleFx();
      lastSnapRecv = performance.now();
      rebase();
      renderHud();
      renderOver();
    },
    message(type, payload) {
      if (type !== "me") return;
      if (payload.role === "hider" && mineMsg?.round === payload.round && payload.missions > lastMissions) doneToast = performance.now();
      lastMissions = payload.role === "hider" ? payload.missions || 0 : 0;
      mineMsg = payload;
      reconcile();
    },
    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("mouseup", onUp);
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  // ===================================================================
  //  CLAVIER + SOURIS (souris libre : on vise directement sur la place)
  // ===================================================================
  const KEYMAP = { KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN, KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH, ShiftLeft: K.DASH };
  function onBlur() { pressed.clear(); mouse.down = false; }
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function onMouse(e) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left) * (W / r.width); mouse.y = (e.clientY - r.top) * (HGT / r.height);
  }
  function onDown(e) { if (e.button === 0) { mouse.down = true; onMouse(e); } }
  function onUp(e) { if (e.button === 0) mouse.down = false; }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; return k; }

  // ===================================================================
  //  PRÉDICTION DE MON PERSO (caché)
  // ===================================================================
  const envFor = (k) => ({ walls: true, w: W, h: HGT, noDash: true, speedMul: k & K.DASH ? JOG : WALK, rects: st?.plaza?.rects || [] });
  const moveBits = (k) => k & (K.UP | K.DOWN | K.LEFT | K.RIGHT);
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function othersAt(t) {
    const e = myEnt()?.e;
    t = Math.min(0.3, Math.max(0, t));
    return (st?.ents || []).filter((x) => x.e !== e).map((x) => H.extrapolate(x, t));
  }
  const step = (h, k, a, others) => { const E = envFor(k), bits = moveBits(k), dt = H.TICK / H.SUB; for (let i = 0; i < H.SUB; i++) { H.drive(h, bits, bits ? null : a, dt, E); H.collideWalls(h, E); for (const o of others) H.collideHeroes(h, o, true); } };
  function reconcile() {
    const sc = myEnt();
    if (!sc || !driving() || !sc.alive || !st) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const m = history.get(sc.seq);
    if (pred && m && same(m, sc)) return;
    const before = pred && ownView(), oldPred = pred;
    pred = H.copy(sc);
    pending.forEach((p, i) => { step(pred, p.k, p.a, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) { const after = ownView(), dx = before.x - after.x, dy = before.y - after.y; if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } }
  }
  function drive(dt) {
    if (!driving()) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    while (acc >= H.TICK) {
      acc -= H.TICK;
      // Le sniper : son viseur et son tir.
      if (amSniper()) { api.send("in", { k: mouse.down ? K.FIRE : 0, p: { x: Math.round(mouse.x), y: Math.round(mouse.y) } }); continue; }
      if (!pred) continue;
      const k = keyMask(), a = Math.atan2(mouse.y - pred.y, mouse.x - pred.x);
      seq++;
      api.send("in", { s: seq, k, a });
      pending.push({ s: seq, k, a });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      step(pred, k, a, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
    }
  }
  const aheadNow = () => Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shown(x) {
    const b = driving() ? H.extrapolate(x, aheadNow()) : x, o = shownOff[x.e] || { x: 0, y: 0 };
    const v = { ...x, x: b.x + o.x, y: b.y + o.y };
    lastShown[x.e] = v;
    return v;
  }
  function rebase() {
    for (const x of st.ents || []) {
      const prev = lastShown[x.e], b = driving() ? H.extrapolate(x, aheadNow()) : x;
      shownOff[x.e] = prev && Math.hypot(prev.x - b.x, prev.y - b.y) < 60 ? { x: prev.x - b.x, y: prev.y - b.y } : { x: 0, y: 0 };
    }
  }

  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (f.kind === "tir") {
        shots.push({ x: f.x, y: f.y, life: 0.35 });
        for (let i = 0; i < (f.hit ? 26 : 10); i++) { const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 180; particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.4, max: 0.9, col: f.hit ? "#8a1020" : "#bbb" }); }
      }
    }
    if (seenFx.size > 500) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("fo-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Tours</label><div class="cat-chips">${[[1, "Chacun sniper 1 fois"], [2, "Chacun sniper 2 fois"]].map(([v, l]) =>
        `<button class="cat-chip ${s.laps === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${l}</button>`).join("")}</div></div>
      <p class="settings-note">Une manche par joueur : chacun prend le fusil à son tour. Une manche dure au plus 90 s.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { laps: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("fo-start").style.display = host ? "" : "none";
    $("fo-start").disabled = n < 2;
    $("fo-finish-setup").classList.toggle("hidden", !host);
    $("fo-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} manches : chacun sera sniper`;
  }
  function renderHud() {
    $("fo-round").textContent = `Manche ${st.round}/${st.rounds}`;
    const m = myEnt();
    const txt = amSniper() ? `🔫 Tu es le SNIPER · ${st.ammo} balle${st.ammo > 1 ? "s" : ""}` : !m ? "👀 Tu regardes" : !m.alive ? "💀 Repéré : tu regardes la fin" : `🕴️ Cache-toi · sniper : ${esc(pseudoOf(st.sniper))}`;
    if ($("fo-me").innerHTML !== txt) $("fo-me").innerHTML = txt;
    $("fo-left").textContent = `🕵️ ${st.left} caché${st.left > 1 ? "s" : ""}`;
    const keys = amSniper() ? "Souris = viser · clic = tirer" : "ZQSD = marcher · Espace / Shift = trottiner · à l'arrêt, tu regardes vers la souris";
    if ($("fo-keys").textContent !== keys) $("fo-keys").textContent = keys;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    { const fe = $("fo-feed"); if (fe.dataset.k !== feed) { fe.dataset.k = feed; fe.innerHTML = feed; } }   // (comparé à notre propre texte : sinon il clignote)
  }
  function renderOver() {
    const ov = $("fo-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost(), lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = `🔫 ${esc(pseudoOf(lr.sniper))} a touché ${lr.kills} joueur${lr.kills > 1 ? "s" : ""}`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id) => `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${id === lr.sniper ? "🔫 sniper" : (lr.alive[id] ? "🕴️ jamais repéré" : "💀 repéré") + ` · 📋 ${lr.missions?.[id] || 0} mission${lr.missions?.[id] > 1 ? "s" : ""}`}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = `<p class="muted">Manche suivante dans <b id="fo-next-sec"></b> s…</p>` + (st.playlist ? "" : host ? `<div class="go-actions"><button id="fo-next" class="btn btn-primary">Manche suivante ▶</button><button id="fo-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : "");
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="fo-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>${host ? '<div class="go-actions"><button id="fo-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions"><button id="fo-again" class="btn btn-primary">🔁 Rejouer</button><button id="fo-to-setup" class="btn btn-secondary">Réglages</button><button id="fo-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div><p id="fo-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("fo-next") && ($("fo-next").onclick = () => api.action("next"));
    $("fo-again") && ($("fo-again").onclick = () => api.action("start").then((r) => { if (r.error) $("fo-over-error").textContent = r.error; }));
    $("fo-to-setup") && ($("fo-to-setup").onclick = () => api.action("setup"));
    $("fo-finish") && ($("fo-finish").onclick = () => { if (st.playlist?.final || confirm("Terminer Foule ? Le classement actuel donne les points de soirée.")) api.action("finish"); });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["fo-fin-sec", finishEndLocal], ["fo-next-sec", phaseEndLocal]]) { const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000)); }
    if (!st || st.phase === "setup" || !st.plaza) return;
    if (!pred && myEnt()?.alive && driving()) pred = H.copy(myEnt());
    drive(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(shownOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }
  function background() {
    const key = JSON.stringify(st.plaza.rects.map((r) => [r.x | 0, r.y | 0]));
    if (bg && bgKey === key) return bg;
    bgKey = key;
    bg = document.createElement("canvas"); bg.width = W; bg.height = HGT;
    const c = bg.getContext("2d");
    c.fillStyle = "#14161b"; c.fillRect(0, 0, W, HGT);
    for (let y = 0; y < HGT; y += 22) for (let x = (y / 22) % 2 ? -14 : 0; x < W; x += 28) { c.fillStyle = (x * 7 + y * 3) % 5 ? "#1b1e24" : "#1f232a"; c.fillRect(x + 1, y + 1, 26, 20); }
    for (const l of st.plaza.lamps) {
      const gr = c.createRadialGradient(l.x, l.y, 4, l.x, l.y, 190);
      gr.addColorStop(0, "rgba(255,226,170,0.42)"); gr.addColorStop(0.5, "rgba(255,210,140,0.12)"); gr.addColorStop(1, "rgba(255,200,120,0)");
      c.fillStyle = gr; c.fillRect(l.x - 190, l.y - 190, 380, 380);
    }
    for (const r of st.plaza.rects) {
      c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(r.x + 6, r.y + 8, r.w, r.h);
      if (r.kind === "fontaine") {
        c.fillStyle = "#3a3f4a"; c.beginPath(); c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#1d2c3a"; c.beginPath(); c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2 - 12, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#5d6878"; c.beginPath(); c.arc(r.x + r.w / 2, r.y + r.h / 2, 14, 0, Math.PI * 2); c.fill();
      } else if (r.kind === "banc") {
        c.fillStyle = "#4a3a2c"; c.fillRect(r.x, r.y, r.w, r.h);
        c.fillStyle = "#5e4a38"; const horiz = r.w > r.h; for (let k = 4; k < (horiz ? r.h : r.w); k += 8) horiz ? c.fillRect(r.x, r.y + k, r.w, 4) : c.fillRect(r.x + k, r.y, 4, r.h);
      } else if (r.kind === "kiosque") {
        c.fillStyle = "#2e3a32"; c.fillRect(r.x, r.y, r.w, r.h);
        c.strokeStyle = "#4c5e50"; c.lineWidth = 3; c.strokeRect(r.x + 4, r.y + 4, r.w - 8, r.h - 8);
        c.beginPath(); c.moveTo(r.x, r.y); c.lineTo(r.x + r.w, r.y + r.h); c.moveTo(r.x + r.w, r.y); c.lineTo(r.x, r.y + r.h); c.stroke();
      } else {
        c.fillStyle = "#3b332c"; c.fillRect(r.x, r.y, r.w, r.h);
        c.fillStyle = "#253526"; c.beginPath(); c.arc(r.x + r.w / 2, r.y + r.h / 2, r.w * 0.75, 0, Math.PI * 2); c.fill();
      }
    }
    for (const l of st.plaza.lamps) { c.fillStyle = "#0c0d10"; c.beginPath(); c.arc(l.x, l.y, 7, 0, Math.PI * 2); c.fill(); c.fillStyle = "#ffe2aa"; c.beginPath(); c.arc(l.x, l.y, 3, 0, Math.PI * 2); c.fill(); }
    return bg;
  }
  // Un personnage, vu de dessus (tout le monde pareil). Assis : un peu tassé.
  function person(c, p, ts, mine) {
    const sw = Math.sin(p.walk || 0) * Math.min(1, Math.hypot(p.vx || 0, p.vy || 0) / 60) * 5, s = p.sit ? 0.86 : 1;
    c.save(); c.translate(p.x, p.y);
    c.fillStyle = "rgba(0,0,0,0.42)"; c.beginPath(); c.ellipse(4, 5, 17 * s, 13 * s, 0, 0, Math.PI * 2); c.fill();
    c.rotate(p.face || 0); c.scale(s, s);
    c.fillStyle = "#1a1a1e"; c.fillRect(-4 + sw, -9, 9, 5); c.fillRect(-4 - sw, 4, 9, 5);
    c.fillStyle = p.coat; c.beginPath(); c.ellipse(0, 0, 11, 16, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.5)"; c.lineWidth = 2; c.stroke();
    c.fillStyle = "#d8c3a8"; c.beginPath(); c.arc(2, 0, 7, 0, Math.PI * 2); c.fill();
    if (p.hat) { c.fillStyle = p.hat; c.beginPath(); c.arc(1, 0, 10, 0, Math.PI * 2); c.fill(); c.fillStyle = "rgba(255,255,255,0.08)"; c.beginPath(); c.arc(1, 0, 6, 0, Math.PI * 2); c.fill(); }
    c.restore();
    if (mine) { c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 2; c.setLineDash([4, 5]); c.beginPath(); c.arc(p.x, p.y, 22, 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
  }
  function draw(ts, dt) {
    const c = g2d;
    c.drawImage(background(), 0, 0);
    for (const b of st.bodies || []) {
      c.save(); c.translate(b.x, b.y); c.rotate((b.face || 0) + Math.PI / 2);
      c.fillStyle = "rgba(120,10,20,0.5)"; c.beginPath(); c.ellipse(6, 4, 22, 14, 0.4, 0, Math.PI * 2); c.fill();
      c.fillStyle = b.coat; c.globalAlpha = 0.75; c.beginPath(); c.ellipse(0, 0, 10, 20, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#b8a38a"; c.beginPath(); c.arc(0, -20, 7, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
      c.restore();
      if (b.player) { c.strokeStyle = "rgba(255,70,90,0.8)"; c.lineWidth = 2; c.beginPath(); c.arc(b.x, b.y, 26, 0, Math.PI * 2); c.stroke(); }
    }
    const m = myEnt();
    if (m && m.alive && m.mission && st.phase === "play") drawMissionSpot(c, m.mission, ts);
    for (const x of st.ents || []) {
      if (m && x.e === m.e && pred) { const o = ownView(); person(c, { ...x, ...o, x: o.x + off.x, y: o.y + off.y, sit: !!m.sit && !moveBits(keyMask()) }, ts, true); continue; }
      person(c, shown(x), ts, m && x.e === m.e);
    }
    shots = shots.filter((s) => (s.life -= dt) > 0);
    for (const s of shots) { c.fillStyle = `rgba(255,240,220,${s.life * 2})`; c.beginPath(); c.arc(s.x, s.y, 8 + (0.35 - s.life) * 80, 0, Math.PI * 2); c.fill(); }
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    c.globalAlpha = 1;
    // La pluie et le vignettage.
    c.strokeStyle = "rgba(180,200,230,0.18)"; c.lineWidth = 1;
    for (const r of rain) { r.y += r.v * dt; r.x -= r.v * dt * 0.12; if (r.y > HGT) { r.y = -10; r.x = Math.random() * W; } c.beginPath(); c.moveTo(r.x, r.y); c.lineTo(r.x + 3, r.y - 14); c.stroke(); }
    const vg = c.createRadialGradient(W / 2, HGT / 2, HGT * 0.35, W / 2, HGT / 2, HGT * 0.95);
    vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.6)");
    c.fillStyle = vg; c.fillRect(0, 0, W, HGT);
    // Le laser du sniper (tout le monde le voit). Le mien suit ma souris tout de suite.
    if (st.phase === "play" || st.phase === "countdown") {
      const L = amSniper() ? mouse : st.laser, N = st.nest;
      c.strokeStyle = "rgba(255,30,50,0.55)"; c.lineWidth = 2; c.beginPath(); c.moveTo(N.x, 0); c.lineTo(L.x, L.y); c.stroke();
      c.fillStyle = "rgba(255,40,60,0.95)"; c.beginPath(); c.arc(L.x, L.y, 5, 0, Math.PI * 2); c.fill();
      c.fillStyle = "rgba(255,40,60,0.25)"; c.beginPath(); c.arc(L.x, L.y, 14 + Math.sin(ts / 120) * 3, 0, Math.PI * 2); c.fill();
      if (amSniper()) {
        c.strokeStyle = "rgba(255,255,255,0.85)"; c.lineWidth = 1.5; c.beginPath(); c.arc(L.x, L.y, 26, 0, Math.PI * 2);
        c.moveTo(L.x - 40, L.y); c.lineTo(L.x - 12, L.y); c.moveTo(L.x + 12, L.y); c.lineTo(L.x + 40, L.y); c.moveTo(L.x, L.y - 40); c.lineTo(L.x, L.y - 12); c.moveTo(L.x, L.y + 12); c.lineTo(L.x, L.y + 40); c.stroke();
      }
    }
    if (m && m.alive && pred) { const o = ownView(); window.VehicleArt.markMe(c, o.x + off.x, o.y + off.y, ts, "#ffffff", window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), 1); }
    if (m && m.alive && m.mission && st.phase === "play") drawMissionCard(c, m, ts);
    drawHud(c);
  }
  // L'endroit de ma mission (moi seul le vois) : un contour discret qui se remplit.
  function drawMissionSpot(c, mi, ts) {
    if (mi.w === undefined || mi.w === null) return;
    const a = 0.35 + Math.sin(ts / 300) * 0.12;
    c.save(); c.strokeStyle = `rgba(120,220,255,${a})`; c.lineWidth = 2; c.setLineDash([6, 6]); c.lineDashOffset = -ts / 60;
    c.beginPath(); c.roundRect(mi.x - mi.m, mi.y - mi.m, mi.w + mi.m * 2, mi.h + mi.m * 2, mi.m); c.stroke(); c.setLineDash([]);
    if (mi.prog > 0) { c.fillStyle = "rgba(120,220,255,0.12)"; c.beginPath(); c.roundRect(mi.x - mi.m, mi.y - mi.m, mi.w + mi.m * 2, mi.h + mi.m * 2, mi.m); c.fill(); }
    c.restore();
  }
  // Ma mission, en bas à gauche : ce qu'il faut faire et où j'en suis.
  function drawMissionCard(c, m, ts) {
    const mi = m.mission, x = 14, y = HGT - 80, w = 400;
    c.fillStyle = "rgba(0,0,0,0.65)"; c.beginPath(); c.roundRect(x, y, w, 66, 10); c.fill();
    c.textAlign = "left"; c.textBaseline = "middle";
    c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = "#78dcff"; c.fillText(`📋 MISSION ${(m.missions || 0) + 1}  ·  ${m.missions || 0} réussie${m.missions > 1 ? "s" : ""} (+${(m.missions || 0) * 2})`, x + 12, y + 15);
    c.font = "bold 17px Georgia, serif"; c.fillStyle = "#e8e0d0"; c.fillText(mi.label + (mi.still && mi.kind !== "pause" ? " (sans bouger)" : ""), x + 12, y + 37);
    c.fillStyle = "rgba(255,255,255,0.15)"; c.fillRect(x + 12, y + 52, w - 24, 6);
    c.fillStyle = "#78dcff"; c.fillRect(x + 12, y + 52, (w - 24) * Math.min(1, mi.prog), 6);
    const age = (performance.now() - doneToast) / 1000;
    if (age < 1.8) { c.globalAlpha = Math.min(1, 1.8 - age); c.font = "900 22px Georgia, serif"; c.fillStyle = "#8dffb0"; c.fillText("✅ Mission réussie +2", x + 12, y - 18); c.globalAlpha = 1; }
    c.textAlign = "center";
  }
  function drawHud(c) {
    c.textAlign = "center"; c.textBaseline = "middle";
    const left = Math.ceil((st.timeLeft || 0) / 1000);
    c.fillStyle = "rgba(0,0,0,0.6)"; c.beginPath(); c.roundRect(W / 2 - 70, 12, 140, 46, 10); c.fill();
    c.font = "900 30px Georgia, serif"; c.fillStyle = left <= 15 ? "#ff6b6b" : "#e8e0d0";
    c.fillText(`${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`, W / 2, 36);
    // Les balles du sniper (tout le monde les voit).
    c.fillStyle = "rgba(0,0,0,0.6)"; c.beginPath(); c.roundRect(W - 210, 12, 196, 46, 10); c.fill();
    c.font = "bold 14px Segoe UI, sans-serif"; c.fillStyle = "#e8e0d0"; c.textAlign = "left"; c.fillText("Sniper", W - 198, 35);
    for (let i = 0; i < Math.min(12, st.ammo); i++) { c.fillStyle = st.reload > 0 && i === st.ammo - 1 ? "#7a6a50" : "#e8c070"; c.fillRect(W - 140 + i * 10, 24, 6, 22); }
    c.textAlign = "center";
    if (st.phase === "countdown") {
      const n = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      c.fillStyle = "rgba(0,0,0,0.75)"; c.beginPath(); c.roundRect(W / 2 - 360, 70, 720, 92, 14); c.fill();
      c.font = "900 34px Georgia, serif"; c.fillStyle = amSniper() ? "#ff6b6b" : "#e8e0d0";
      c.fillText(amSniper() ? `🔫 Tu es le sniper · ${n > 0 ? n : "…"}` : `🕴️ ${esc(pseudoOf(st.sniper))} est le sniper · ${n > 0 ? n : "…"}`, W / 2, 104);
      c.font = "18px Georgia, serif"; c.fillStyle = "#e8e0d0";
      c.fillText(amSniper() ? "Observe : les vrais joueurs ne bougent pas tout à fait comme les passants." : "Ton perso a un anneau pointillé (toi seul le vois). Imite les passants et fais tes missions !", W / 2, 140);
    }
  }
})();
