// ===================================================================
//  CHAT ET SOURIS — Client (s'affiche dans le hub Le Bordel)
//  - MA voiture est calculée ici tout de suite (prédiction, comme la
//    Patate), puis recalée sur le serveur.
//  - Les autres sont affichées "au présent" (avancées selon leur vitesse).
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const K = P.K;
  const CAT_BONUS = 1.1;        // (le même que games/chat/server.js)

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0, catGoLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, bg = null, mini = null, mapId = null;
  const MINI = 0.1;             // échelle de la mini-carte

  // Prédiction de MA voiture
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
  const CAT_COL = "#ff8a2a", MOUSE_COL = "#9fd4ff";

  const TEMPLATE = `
    <div id="ch-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🐱</span>
        <h1>CHAT ET SOURIS</h1>
        <p class="tagline">Fuis… ou deviens le chat.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="ch-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🐱 Le <b>chat</b> (Sportive boostée) chasse les <b>souris</b> 🐭 (motos agiles).</li>
            <li>🐭 Une souris touchée devient <b>chat</b> à son tour. Les chats se multiplient !</li>
            <li>🏁 Les souris partent avec <b>2 s d'avance</b>. Tiens jusqu'à la fin du chrono ou sois la dernière souris.</li>
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches · <kbd>Espace</kbd> frein à main · <kbd>Shift</kbd> nitro</li>
            <li>🏆 Chat : <b>+1</b> par souris attrapée. Souris : <b>+1</b> par souris attrapée avant toi, et si tu tiens jusqu'au bout <b>+2</b> en plus.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="ch-start" class="btn btn-primary btn-big">Lancer la chasse</button>
        <p id="ch-hint" class="muted"></p>
        <p id="ch-error" class="error-msg"></p>
        <button id="ch-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="ch-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="ch-round"></span>
        <span id="ch-role" class="ch-role"></span>
        <span id="ch-clock" class="cf-clock"></span>
      </div>
      <div class="ch-sub">
        <div id="ch-mice" class="ch-mice"></div>
        <div id="ch-nitro" class="pt-nitro" title="Nitro (Shift)"><span>NITRO</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="ch-canvas" width="${P.W}" height="${P.H}"></canvas>
        <div id="ch-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.chat = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; mapId = null; myRole = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("ch-canvas");
      g2d = canvas.getContext("2d");
      $("ch-start").onclick = () => {
        $("ch-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("ch-error").textContent = r.error; });
      };
      $("ch-finish-setup").onclick = () => api.action("finish");
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
      catGoLocal = Date.now() + (st.catWait || 0);

      if (st.phase === "setup") {
        $("ch-play").classList.add("hidden");
        $("ch-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("ch-setup").classList.add("hidden");
      $("ch-play").classList.remove("hidden");
      if (st.map && st.map.id !== mapId) newMap();
      // Je viens de changer de rôle (attrapé !) : on repart de l'état du serveur.
      const role = carOf(me())?.role || null;
      if (role !== myRole) { if (myRole === "mouse" && role === "cat") roleFlash = 2; myRole = role; pred = prevPred = null; pending = []; history.clear(); }
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
    // Chat : figé tant que les souris ont leur avance.
    if (myRole === "cat" && Date.now() < catGoLocal) return 0;
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    return k;
  }

  // ===================================================================
  //  PRÉDICTION DE MA VOITURE (même principe que la Patate)
  // ===================================================================
  const env = () => ({ w: st.map.w, h: st.map.h, grip: st.map.grip, oils: st.map.oils, obstacles: st.map.obstacles, nitro: true, holderNitro: true });
  const myBonus = () => (myRole === "cat" ? CAT_BONUS : 1);
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
    if (!sc || !driving() || !st.map) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = P.copyCar(sc);
    const E = env();
    pending.forEach((p, i) => { P.simulate(pred, p.k, E, myBonus(), othersAt((i + 1) * P.TICK)); history.set(p.s, P.copyCar(pred)); });
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
    const E = env();
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = P.copyCar(pred);
      P.simulate(pred, k, E, myBonus(), othersAt(pending.length * P.TICK));
      history.set(seq, P.copyCar(pred));
      acc -= P.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.cars.filter((c) => c.id !== me()).map((c) => P.extrapolate(c, t));
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
    for (const c of st.cars) {
      if (c.id === me() && pred) continue;
      const prev = lastShown[c.id];
      const base = driving() ? P.extrapolate(c, t) : c;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 120) othersOff[c.id] = { x: prev.x - base.x, y: prev.y - base.y, a: angDiff(prev.a, base.a) };
      else othersOff[c.id] = { x: 0, y: 0, a: 0 };
    }
  }

  // ===================================================================
  //  EFFETS : chocs, souris attrapée (gros nuage orange)
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.big ? 70 : Math.min(24, 5 + f.s / 30);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = f.big ? 80 + Math.random() * 380 : 60 + Math.random() * f.s * 0.7;
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * (f.big ? 0.9 : 0.3), max: f.big ? 1.2 : 0.6, col: f.big ? (i % 2 ? CAT_COL : "#fff") : "#ffd27a" });
      }
      if (f.big) shake = 10;
    }
    if (seenFx.size > 300) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("ch-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"], [7, "7"]])}</div>
      <div class="setting-block"><label>Durée d'une manche</label>${chips("duration", [[60, "60 s"], [90, "90 s"], [120, "2 min"]])}</div>
      <p class="settings-note">Chacun est chat à tour de rôle. 2 chats au départ à partir de 5 joueurs.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("ch-start").style.display = host ? "" : "none";
    $("ch-start").disabled = n < 3;
    $("ch-finish-setup").classList.toggle("hidden", !host);
    $("ch-hint").textContent = !host ? "En attente que l'hôte lance la chasse…" : n < 3 ? `Il faut au moins 3 joueurs (${n}/3).` :
      `${n} joueurs → ${n >= 5 ? 2 : 1} chat${n >= 5 ? "s" : ""} contre ${n - (n >= 5 ? 2 : 1)} souris`;
  }

  // ===================================================================
  //  BANDEAU DU HAUT
  // ===================================================================
  function renderHud() {
    $("ch-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const role = $("ch-role");
    const txt = !myRole ? "👀 Tu regardes" : myRole === "cat" ? "🐱 Tu es le CHAT : attrape les souris !" : "🐭 Tu es une SOURIS : fuis !";
    if (role.textContent !== txt) { role.textContent = txt; role.className = "ch-role " + (myRole || ""); }
    const mice = st.cars.filter((c) => c.role === "mouse");
    const html = `<span class="muted">🐭 Souris libres :</span> ${mice.map((c) => `<span class="ch-tag ${c.id === me() ? "me" : ""}">${esc(pseudoOf(c.id))}</span>`).join("") || "<b>aucune</b>"}`;
    if ($("ch-mice").innerHTML !== html) $("ch-mice").innerHTML = html;
    $("ch-nitro").classList.toggle("hidden", !myRole || st.phase !== "play");
  }

  function renderOver() {
    const ov = $("ch-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.survivors.length === 0 ? "🐱 Les chats ont tout attrapé !"
      : lr.survivors.length === 1 ? `🐭 ${esc(pseudoOf(lr.survivors[0]))} s'en sort !` : `🐭 ${lr.survivors.length} souris s'en sortent !`;
    const ids = Object.keys(st.players.reduce((o, p) => (o[p.id] = 1, o), {})).filter((id) => lr.gains[id] !== undefined || lr.starters.includes(id) || lr.survivors.includes(id));
    const rows = ids.sort((a, b) => (lr.gains[b] || 0) - (lr.gains[a] || 0)).map((id) => {
      const c = lr.caught.find((x) => x.id === id);
      const how = lr.survivors.includes(id) ? "🐭 libre jusqu'au bout" : c ? `🐭→🐱 attrapé par ${esc(pseudoOf(c.by))} (${Math.round(c.at / 1000)} s)` : "🐱 chat de départ";
      return `<li>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="muted">${how}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`;
    }).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].filter((p) => p.score !== undefined)
      .sort((a, b) => b.score - a.score).map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="ch-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="ch-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="ch-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="ch-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="ch-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="ch-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="ch-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="ch-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="ch-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `
      <div class="pt-over card ch-over">
        <h2 class="go-banner">${banner}</h2>
        <ul class="ch-rows">${rows}</ul>
        ${total}
        ${buttons}
      </div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("ch-next") && ($("ch-next").onclick = () => api.action("next"));
    $("ch-again") && ($("ch-again").onclick = () => api.action("start").then((r) => { if (r.error) $("ch-over-error").textContent = r.error; }));
    $("ch-to-setup") && ($("ch-to-setup").onclick = () => api.action("setup"));
    $("ch-finish") && ($("ch-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Chat et souris ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DÉCOR (même style que la Patate, dessiné une fois par map)
  // ===================================================================
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const LOOK = {
    asphalte: { ground: "#2c2d35", dots: ["#34353e", "#26272e"], line: "rgba(255,210,80,0.18)", block: "#5b5f6b", edge: "#ffcc33" },
    terre:    { ground: "#6e4b2e", dots: ["#7b5636", "#5f3f25"], line: null, block: "#8b5a2b", edge: "#5a3615" },
    neige:    { ground: "#dfe9f3", dots: ["#eef4fa", "#cfdbe8"], line: null, block: "#a8d4f0", edge: "#6fb2dd" },
  };
  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
  function newMap() {
    const m = st.map;
    mapId = m.id;
    const look = LOOK[m.surface] || LOOK.asphalte;
    const rnd = seeded(m.seed);
    const W = m.w, H = m.h;
    bg = document.createElement("canvas");
    bg.width = W; bg.height = H;
    const c = bg.getContext("2d");
    c.fillStyle = look.ground; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 10000; i++) {
      c.fillStyle = look.dots[i % 2];
      const s = 1 + rnd() * 3;
      c.fillRect(rnd() * W, rnd() * H, s, s);
    }
    if (look.line) {
      c.strokeStyle = look.line; c.lineWidth = 4; c.setLineDash([30, 26]);
      c.strokeRect(60, 60, W - 120, H - 120); c.setLineDash([]);
    }
    for (const o of m.oils) {
      const gr = c.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, 2, o.x, o.y, o.r);
      gr.addColorStop(0, "rgba(90,70,140,0.85)"); gr.addColorStop(0.4, "rgba(15,15,25,0.9)"); gr.addColorStop(1, "rgba(10,10,15,0.75)");
      c.fillStyle = gr; c.beginPath(); c.ellipse(o.x, o.y, o.r, o.r * 0.8, rnd() * 3, 0, Math.PI * 2); c.fill();
    }
    for (const o of m.obstacles) {
      c.fillStyle = "rgba(0,0,0,0.35)"; rr(c, o.x + 6, o.y + 8, o.w, o.h, 6); c.fill();
      c.fillStyle = look.block; rr(c, o.x, o.y, o.w, o.h, 6); c.fill();
      c.lineWidth = 4; c.strokeStyle = look.edge;
      if (m.surface === "asphalte") c.setLineDash([12, 10]);
      rr(c, o.x + 2, o.y + 2, o.w - 4, o.h - 4, 5); c.stroke(); c.setLineDash([]);
    }
    c.lineWidth = 10; c.strokeStyle = "#111"; c.setLineDash([16, 8]);
    c.strokeRect(5, 5, W - 10, H - 10); c.setLineDash([]);
    // Mini-carte : le fond (obstacles) dessiné une fois.
    mini = document.createElement("canvas");
    mini.width = Math.round(W * MINI); mini.height = Math.round(H * MINI);
    const mc = mini.getContext("2d");
    mc.fillStyle = "rgba(10,10,16,0.72)"; mc.fillRect(0, 0, mini.width, mini.height);
    mc.fillStyle = "rgba(255,255,255,0.35)";
    for (const o of m.obstacles) mc.fillRect(o.x * MINI, o.y * MINI, Math.max(2, o.w * MINI), Math.max(2, o.h * MINI));
    mc.strokeStyle = "rgba(255,255,255,0.5)"; mc.lineWidth = 2; mc.strokeRect(1, 1, mini.width - 2, mini.height - 2);
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("ch-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("ch-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.82, dt * 60);
    off.x *= decay; off.y *= decay; off.a *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; o.a *= decay; }
    const clock = $("ch-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.phase === "countdown" ? st.timeLeft : 0;
      const s = Math.ceil(left / 1000);
      clock.textContent = `⏱️ ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      clock.classList.toggle("urgent", st.phase === "play" && left < 10000);
    }
    draw(ts, dt);
  }

  function draw(ts, dt) {
    const c = g2d;
    c.save();
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.86, dt * 60); }
    else shake = 0;
    const view = st.cars.map((car) => {
      if (car.id === me() && pred) {
        const o = ownView();
        return { ...o, id: car.id, role: car.role, fresh: car.fresh, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a };
      }
      return { ...shownCar(car), role: car.role, fresh: car.fresh };
    });
    // La caméra suit ma voiture (sans sortir de la map). Pas de voiture : on voit toute la map en petit.
    const mv = view.find((v) => v.id === me());
    const W = st.map.w, H = st.map.h;
    c.fillStyle = "#111"; c.fillRect(0, 0, canvas.width, canvas.height);
    let cam = null;
    if (mv) {
      cam = { x: Math.max(0, Math.min(W - canvas.width, mv.x - canvas.width / 2)), y: Math.max(0, Math.min(H - canvas.height, mv.y - canvas.height / 2)) };
      c.translate(-cam.x, -cam.y);
    } else c.scale(canvas.width / W, canvas.height / H);
    c.drawImage(bg, 0, 0);

    // Halo orange sous les chats (qui clignote pour un chat tout neuf).
    for (const v of view) {
      if (v.role !== "cat") continue;
      const blink = v.fresh ? 0.3 + 0.3 * Math.sin(ts / 60) : 0.35;
      const gr = c.createRadialGradient(v.x, v.y, 8, v.x, v.y, 46);
      gr.addColorStop(0, `rgba(255,138,42,${blink})`); gr.addColorStop(1, "rgba(255,138,42,0)");
      c.fillStyle = gr; c.beginPath(); c.arc(v.x, v.y, 46, 0, Math.PI * 2); c.fill();
    }
    for (const v of view) {
      c.save();
      c.translate(v.x, v.y); c.rotate(v.a);
      window.VehicleArt.paint(c, v.type || (v.role === "cat" ? "sport" : "moto"), v.role === "cat" ? CAT_COL : MOUSE_COL, playerOf(v.id)?.color, v.st || 0, v.id === me(), v.boost);
      c.restore();
      c.font = "bold 14px Segoe UI, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      const label = `${v.role === "cat" ? "🐱" : "🐭"} ${pseudoOf(v.id)}`;
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.75)"; c.strokeText(label, v.x, v.y - 32);
      c.fillStyle = v.role === "cat" ? "#ffcf9a" : "#fff"; c.fillText(label, v.x, v.y - 32);
    }

    drawParticles(dt);

    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, mv.role === "cat" ? CAT_COL : MOUSE_COL,
      roleFlash > 0 ? 1 : window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt),
      Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();

    drawMini(view, cam);

    // Compte à rebours / avance des souris / attrapé !
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", myRole === "cat" ? "🐱 Tu es le chat !" : "🐭 Les souris partent en premier !");
    } else if (st.phase === "play" && Date.now() < catGoLocal) {
      const s = Math.ceil((catGoLocal - Date.now()) / 1000);
      if (myRole === "cat") band("🐱 ATTENDS…", `Les souris ont de l'avance. Tu pars dans ${s} s !`, CAT_COL);
      else band("🐭 FUYEZ !", `Le chat part dans ${s} s…`, MOUSE_COL);
    } else if (roleFlash > 0) {
      roleFlash -= dt;
      band("🐱 ATTRAPÉ !", "Tu es un chat maintenant : attrape les autres !", CAT_COL);
    }

    const mine = pred || carOf(me());
    const bar = document.querySelector("#ch-nitro i");
    if (bar && mine) { bar.style.width = Math.round(mine.nitro * 100) + "%"; bar.parentElement.classList.toggle("on", !!mine.boost); }
  }

  // Mini-carte en haut à droite : obstacles, chats (orange), souris (bleu), moi (cerclé), la zone visible.
  function drawMini(view, cam) {
    if (!mini) return;
    const c = g2d, x0 = canvas.width - mini.width - 12, y0 = 12;
    c.drawImage(mini, x0, y0);
    for (const v of view) {
      c.fillStyle = v.role === "cat" ? CAT_COL : MOUSE_COL;
      c.beginPath(); c.arc(x0 + v.x * MINI, y0 + v.y * MINI, v.role === "cat" ? 5 : 4, 0, Math.PI * 2); c.fill();
      if (v.id === me()) { c.strokeStyle = "#fff"; c.lineWidth = 2; c.beginPath(); c.arc(x0 + v.x * MINI, y0 + v.y * MINI, 8, 0, Math.PI * 2); c.stroke(); }
    }
    if (cam) { c.strokeStyle = "rgba(255,255,255,0.6)"; c.lineWidth = 1; c.strokeRect(x0 + cam.x * MINI, y0 + cam.y * MINI, canvas.width * MINI, canvas.height * MINI); }
  }

  function band(big, small, color) {
    const c = g2d;
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, P.H / 2 - 80, P.W, 160);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "bold 66px Segoe UI, sans-serif";
    c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,0.6)"; c.strokeText(big, P.W / 2, P.H / 2 - 16);
    c.fillStyle = color || "#fff"; c.fillText(big, P.W / 2, P.H / 2 - 16);
    c.font = "24px Segoe UI, sans-serif"; c.fillStyle = "#fff";
    c.fillText(small, P.W / 2, P.H / 2 + 46);
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
