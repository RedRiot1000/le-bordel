// ===================================================================
//  SUMO — Client (s'affiche dans le hub Le Bordel)
//  Même conduite que Patate chaude (prédiction de sa voiture + autres
//  voitures lissées). En plus : le vide, la caméra qui suit sur la
//  version Îles, la mini-carte, la zone sûre et les équipes.
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const G = window.SumoGround;
  const K = P.K;
  const INTERP_DELAY = 100;
  const VIEW_W = 1280, VIEW_H = 800;     // taille du canvas
  const ISLAND_ZOOM = 0.8;               // zoom de la caméra sur les îles

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;

  // Prédiction de MA voiture (comme Patate chaude)
  let pred = null, prevPred = null, pending = [], seq = 0, acc = 0, clockOff = null;
  const history = new Map();
  const off = { x: 0, y: 0, a: 0 };
  const snaps = [];
  const pressed = new Set();

  // Décor / effets
  let mapId = null, world = null, skid = null, skidCtx = null;
  const lastWheels = {};
  let particles = [];
  const seenFx = new Set();
  let shake = 0;
  const cam = { x: 0, y: 0, z: 1 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const carOf = (id) => st?.cars.find((c) => c.id === id);

  const VARIANT_LABEL = { arena: "🔴 Arène", islands: "🏝️ Îles" };
  const TEAM_LABEL = { red: "🔴 Rouges", blue: "🔵 Bleus" };

  // ===================================================================
  //  SQUELETTE HTML
  // ===================================================================
  const TEMPLATE = `
    <div id="sm-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🤼</span>
        <h1>SUMO</h1>
        <p class="tagline">Pousse les autres dans le vide.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card">
          <h2>⚙️ Réglages</h2>
          <div id="sm-settings" class="settings"></div>
        </div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches · <kbd>Espace</kbd> frein à main · <kbd>Shift</kbd> nitro</li>
            <li>🌊 Si tu sors du sol, tu tombes : éliminé !</li>
            <li>🔴 <b>Arène</b> : la plateforme rétrécit, pousse les autres dehors.</li>
            <li>🏝️ <b>Îles</b> : une île s'allume, rejoins-la. Le dernier arrivé explose, et à 0 tous ceux dehors explosent.</li>
            <li>👥 Nombre pair : parfois en <b>2 équipes</b> (rouges contre bleus).</li>
            <li>🏆 1 pt par joueur éliminé avant toi, <b>+1 par voiture éjectée</b>.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="sm-start" class="btn btn-primary btn-big">Lancer la manche</button>
        <p id="sm-hint" class="muted"></p>
        <p id="sm-error" class="error-msg"></p>
        <button id="sm-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>
    </div>

    <div id="sm-play" class="hidden">
      <div class="game-topbar">
        <span class="pill" id="sm-round">Manche 1</span>
        <span class="sm-tag" id="sm-variant"></span>
        <span class="phase-label" id="sm-status">—</span>
        <div id="sm-nitro" class="pt-nitro hidden" title="Nitro (Shift)"><span>NITRO</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="sm-canvas" width="${VIEW_W}" height="${VIEW_H}"></canvas>
        <div id="sm-zone" class="sm-zone hidden"></div>
        <ul id="sm-feed" class="sm-feed"></ul>
        <div id="sm-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.sumo = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; history.clear(); snaps.length = 0;
      particles = []; mapId = null; seenFx.clear(); pressed.clear(); clockOff = null;
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("sm-canvas");
      g2d = canvas.getContext("2d");
      $("sm-start").onclick = () => {
        $("sm-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("sm-error").textContent = r.error; });
      };
      $("sm-finish-setup").onclick = finishGame;
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      const prevRound = st?.roundNum;
      st = state;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      if (st.phase === "setup") {
        $("sm-play").classList.add("hidden");
        $("sm-setup").classList.remove("hidden");
        renderSettings();
        renderStartArea();
        return;
      }
      $("sm-setup").classList.add("hidden");
      $("sm-play").classList.remove("hidden");
      if (st.map && st.map.id !== mapId) newMap();
      if (prevRound !== st.roundNum) { pending = []; pred = prevPred = null; history.clear(); }

      const d = Date.now() - st.t;
      clockOff = clockOff === null ? d : Math.min(d, clockOff + 1);
      snaps.push({ t: st.t + clockOff, cars: Object.fromEntries(st.cars.map((c) => [c.id, c])) });
      if (snaps.length > 30) snaps.shift();

      handleEffects();
      reconcile();
      renderHud();
    },

    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      document.querySelector(".app").classList.remove("pt-wide");
      root.innerHTML = "";
    },
  };

  function finishGame() {
    if (confirm("Terminer le Sumo ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

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
  function keyMask() { let k = 0; for (const c of pressed) k |= KEYMAP[c]; return k; }

  // ===================================================================
  //  PRÉDICTION DE MA VOITURE (même principe que Patate chaude)
  // ===================================================================
  function env() {
    return { w: st.map.w, h: st.map.h, grip: 1, oils: [], obstacles: [], nitro: st.settings.nitro, walls: false };
  }
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
    if (!sc || !sc.alive || sc.falling || st.phase !== "play") { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = P.copyCar(sc);
    const e = env();
    for (const p of pending) { P.simulate(pred, p.k, e, 1); history.set(p.s, P.copyCar(pred)); }
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; prevPred.a += angDiff(pred.a, oldPred.a); }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 150) { off.x += dx; off.y += dy; off.a += angDiff(before.a, after.a); }
    }
  }
  function driveLocal(dt) {
    if (!pred || st?.phase !== "play") { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    const e = env();
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = P.copyCar(pred);
      P.simulate(pred, k, e, 1);
      history.set(seq, P.copyCar(pred));
      acc -= P.TICK;
    }
  }
  function interpolated(id) {
    const t = Date.now() - INTERP_DELAY;
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].t <= t) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    if (!a) a = b = snaps[0];
    const ca = a?.cars[id], cb = b?.cars[id] || ca;
    if (!ca) return null;
    const f = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;
    return { ...cb, x: ca.x + (cb.x - ca.x) * f, y: ca.y + (cb.y - ca.y) * f, a: ca.a + angDiff(cb.a, ca.a) * f };
  }

  // ===================================================================
  //  EFFETS
  // ===================================================================
  function handleEffects() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      if (f.kind === "boom") {
        for (let i = 0; i < 60; i++) {
          const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 360;
          particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.7, max: 1.2, kind: i % 3 ? "fire" : "smoke" });
        }
        particles.push({ x: f.x, y: f.y, vx: 0, vy: 0, life: 0.5, max: 0.5, kind: "flash" });
        shake = Math.max(shake, f.cars.includes(me()) ? 22 : 8);
      } else {
        const n = Math.min(30, 6 + f.s / 25);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * f.s * 0.8;
          particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, max: 0.6, kind: "spark" });
        }
        if (f.cars.includes(me())) shake = Math.max(shake, Math.min(16, f.s / 35));
      }
    }
    if (seenFx.size > 300) seenFx.clear();
  }

  // ===================================================================
  //  DÉCOR : le vide + les plateformes (îles dessinées une fois par map)
  // ===================================================================
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function newMap() {
    const m = st.map;
    mapId = m.id;
    const rnd = seeded(m.seed);
    world = document.createElement("canvas");
    world.width = m.w; world.height = m.h;
    const c = world.getContext("2d");
    // Le vide : bleu nuit + étoiles.
    c.fillStyle = "#050814";
    c.fillRect(0, 0, m.w, m.h);
    for (let i = 0; i < (m.w * m.h) / 4000; i++) {
      c.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.5})`;
      const s = rnd() < 0.9 ? 1 : 2;
      c.fillRect(rnd() * m.w, rnd() * m.h, s, s);
    }
    if (m.kind === "islands") {
      // Couloirs puis îles (bord épais = falaise).
      for (const cor of m.corridors) {
        const A = m.islands[cor.a], B = m.islands[cor.b];
        c.lineCap = "butt";
        c.strokeStyle = "#1c2433"; c.lineWidth = cor.w + 16;
        c.beginPath(); c.moveTo(A.x, A.y + 10); c.lineTo(B.x, B.y + 10); c.stroke();
        c.strokeStyle = "#5b6577"; c.lineWidth = cor.w;
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
        c.strokeStyle = "rgba(255,210,80,0.35)"; c.lineWidth = 3; c.setLineDash([24, 20]);
        c.beginPath(); c.moveTo(A.x, A.y); c.lineTo(B.x, B.y); c.stroke();
        c.setLineDash([]);
      }
      m.islands.forEach((I, i) => {
        c.fillStyle = "#1c2433";
        c.beginPath(); c.arc(I.x, I.y + 12, I.r, 0, Math.PI * 2); c.fill();
        const gr = c.createRadialGradient(I.x - I.r * 0.3, I.y - I.r * 0.3, 10, I.x, I.y, I.r);
        gr.addColorStop(0, "#7b8698"); gr.addColorStop(1, "#4a5466");
        c.fillStyle = gr;
        c.beginPath(); c.arc(I.x, I.y, I.r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(255,255,255,0.18)"; c.lineWidth = 6;
        c.beginPath(); c.arc(I.x, I.y, I.r - 3, 0, Math.PI * 2); c.stroke();
        // Grain
        for (let k = 0; k < I.r * 2; k++) {
          const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (I.r - 8);
          c.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)";
          c.fillRect(I.x + Math.cos(a) * d, I.y + Math.sin(a) * d, 3, 3);
        }
        c.fillStyle = "rgba(255,255,255,0.10)";
        c.font = "bold 90px Segoe UI, sans-serif";
        c.textAlign = "center"; c.textBaseline = "middle";
        c.fillText(String.fromCharCode(65 + i), I.x, I.y);
      });
    }
    skid = document.createElement("canvas");
    skid.width = m.w; skid.height = m.h;
    skidCtx = skid.getContext("2d");
    skidCtx.strokeStyle = "rgba(10,10,15,0.35)";
    skidCtx.lineWidth = 4; skidCtx.lineCap = "round";
    for (const k in lastWheels) delete lastWheels[k];
    // Caméra : départ sur ma voiture (ou toute la map).
    const mineCar = carOf(me());
    if (mineCar) { cam.x = mineCar.x; cam.y = mineCar.y; }
  }

  function drawSkids(id, c) {
    const fx = Math.cos(c.a), fy = Math.sin(c.a), rx = -fy, ry = fx;
    const lat = Math.abs(c.vx * rx + c.vy * ry);
    const wheels = [
      { x: c.x - fx * 14 + rx * 9, y: c.y - fy * 14 + ry * 9 },
      { x: c.x - fx * 14 - rx * 9, y: c.y - fy * 14 - ry * 9 },
    ];
    const prev = lastWheels[id];
    if (prev && (lat > 70 || c.slide) && !c.falling) {
      for (let i = 0; i < 2; i++) {
        if (Math.hypot(prev[i].x - wheels[i].x, prev[i].y - wheels[i].y) > 40) continue;
        if (!G.onGround(st.map, wheels[i].x, wheels[i].y, st.arenaR)) continue;
        skidCtx.beginPath(); skidCtx.moveTo(prev[i].x, prev[i].y); skidCtx.lineTo(wheels[i].x, wheels[i].y); skidCtx.stroke();
      }
    }
    lastWheels[id] = wheels;
  }

  // ===================================================================
  //  RÉGLAGES (mode "un jeu")
  // ===================================================================
  function renderSettings() {
    const s = st.settings;
    const host = api.isHost();
    const panel = $("sm-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${String(s[key]) === String(v) ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Version</label>${chips("variant", [["random", "🎲 Au hasard"], ["arena", "🔴 Arène"], ["islands", "🏝️ Îles"]])}</div>
      <div class="setting-block"><label>Mode</label>${chips("mode", [["auto", "🎲 Auto"], ["ffa", "Chacun pour soi"], ["teams", "👥 Équipes"]])}</div>
      <p class="settings-note">Équipes seulement avec un nombre pair de joueurs (sinon chacun pour soi).</p>
      <div class="setting-block"><label>Arène : vitesse de rétrécissement</label>${chips("shrink", [["lent", "Lente"], ["normal", "Normale"], ["rapide", "Rapide"]])}</div>
      <div class="setting-block"><label>Îles : chrono de la zone</label>${chips("zoneTime", [[10, "10 s"], [15, "15 s"], [20, "20 s"]])}</div>
      <div class="setting"><label>Nitro (Shift)</label><div class="val">
        <label class="switch"><input type="checkbox" data-toggle="nitro" ${s.nitro ? "checked" : ""} ${host ? "" : "disabled"} /><span class="track"></span></label>
      </div></div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (!host) return;
    panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.key === "zoneTime" ? Number(b.dataset.v) : b.dataset.v;
        api.action("settings", { settings: { [b.dataset.key]: v } });
      };
    });
    panel.querySelector("[data-toggle]").onchange = (e) => api.action("settings", { settings: { nitro: e.target.checked } });
  }

  function renderStartArea() {
    const host = api.isHost();
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("sm-finish-setup").classList.toggle("hidden", !host);
    $("sm-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("sm-start").style.display = host ? "" : "none";
    $("sm-start").disabled = n < 3;
    $("sm-hint").textContent = !host ? "En attente que l'hôte lance la manche…"
      : n < 3 ? `Il faut au moins 3 joueurs connectés (${n}/3).` : `${n} joueurs prêts.`;
  }

  // ===================================================================
  //  BANDEAU, ZONE, FIL D'INFO, FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("sm-round").textContent = "Manche " + st.roundNum + (st.playlist ? "/" + st.playlist.rounds : "");
    const myTeam = carOf(me())?.team;
    $("sm-variant").textContent = `${VARIANT_LABEL[st.map?.kind] || ""} · ${st.mode === "teams" ? "👥 Équipes" : "Chacun pour soi"}`;
    const mine = carOf(me());
    const status = $("sm-status");
    status.className = "phase-label";
    if (st.phase === "countdown" || st.phase === "play") {
      if (!mine) status.textContent = "👀 Tu regardes cette manche";
      else if (!mine.alive) status.textContent = "💀 Éliminé — regarde la fin !";
      else if (mine.falling) { status.textContent = "🌊 Tu tombes !!"; status.classList.add("pt-danger"); }
      else if (st.mode === "teams") status.innerHTML = `Tu es chez les <b style="color:${st.teamColors[myTeam]}">${TEAM_LABEL[myTeam]}</b>`;
      else status.textContent = st.map?.kind === "arena" ? "Pousse-les tous dehors !" : "Reste sur le sol !";
    } else if (st.phase === "roundOver") status.textContent = "🏁 Fin de la manche";

    $("sm-nitro").classList.toggle("hidden", !(st.settings.nitro && mine?.alive && st.phase !== "roundOver"));

    // Fil d'info (éjections, chutes, explosions).
    $("sm-feed").innerHTML = (st.feed || []).slice(-5).map((f) => `<li>${esc(f.text)}</li>`).join("");

    renderZone();
    renderRoundOver();
  }

  function renderZone() {
    const box = $("sm-zone");
    if (st.phase !== "play" || st.map?.kind !== "islands") { box.classList.add("hidden"); return; }
    box.classList.remove("hidden");
    if (st.zone) {
      const sec = Math.ceil(st.zone.left / 1000);
      const letter = String.fromCharCode(65 + st.zone.island);
      const mineCar = carOf(me());
      const isl = st.map.islands[st.zone.island];
      const inside = mineCar && Math.hypot(mineCar.x - isl.x, mineCar.y - isl.y) <= isl.r;
      box.className = "sm-zone" + (sec <= 5 ? " urgent" : "");
      box.innerHTML = `<span class="sm-zone-sec">${sec}</span>
        <span>🏝️ Rejoins l'île <b>${letter}</b> ! ${mineCar?.alive && !mineCar.falling ? (inside ? "✅ Tu y es" : "⚠️ Tu n'y es pas") : ""}</span>`;
    } else {
      const sec = Math.ceil((st.zoneNextIn || 0) / 1000);
      box.className = "sm-zone calm";
      box.innerHTML = `<span>⏳ Prochaine île dans <b>${sec}</b> s</span>`;
    }
  }

  function renderRoundOver() {
    const ov = $("sm-overlay");
    const isOver = st.phase === "roundOver" && !!st.lastRound;
    ov.parentElement.classList.toggle("over", isOver);
    if (!isOver) { ov.classList.add("hidden"); return; }
    const host = api.isHost();
    if (!ov.classList.contains("hidden") && ov.dataset.round === String(st.roundNum) && ov.dataset.host === String(host)) return;
    ov.dataset.round = st.roundNum;
    ov.dataset.host = host;
    const lr = st.lastRound;
    const medals = ["🥇", "🥈", "🥉"];
    const title = lr.mode === "teams"
      ? (lr.winnerTeam ? `🏆 Les ${TEAM_LABEL[lr.winnerTeam]} gagnent !` : "🤝 Personne ne gagne")
      : `🏆 ${esc(pseudoOf(lr.rows[0]?.id))} gagne !`;
    ov.innerHTML = `
      <div class="pt-over card">
        <h2 class="go-banner">${title}</h2>
        <ul class="podium-list">
          ${lr.rows.map((r, i) => `
            <li style="animation-delay:${i * 0.1}s">
              <span class="place">${lr.mode === "teams" ? (r.team === "red" ? "🔴" : "🔵") : medals[r.place - 1] || r.place + "e"}</span>
              ${api.avatar(playerOf(r.id))}
              <span class="name">${esc(pseudoOf(r.id))}${r.alive ? " ✅" : ""}</span>
              ${r.ejections ? `<span class="muted">💥×${r.ejections}</span>` : ""}
              <span class="gain">+${r.points}</span>
              <span class="muted">(${playerOf(r.id)?.score ?? 0} au total)</span>
            </li>`).join("")}
        </ul>
        ${overButtons(host)}
      </div>`;
    ov.classList.remove("hidden");
    if (host) {
      $("sm-next") && ($("sm-next").onclick = () => api.action("start").then((r) => { if (r.error) $("sm-over-error").textContent = r.error; }));
      $("sm-to-setup") && ($("sm-to-setup").onclick = () => api.action("setup"));
      $("sm-finish").onclick = st.playlist?.final ? () => api.action("finish") : finishGame;
    }
  }

  function overButtons(host) {
    const pl = st.playlist;
    if (pl?.final) {
      finishEndLocal = Date.now() + pl.finishLeft;
      return `<p class="go-final">🏁 C'était la dernière manche ! Classement dans <b id="sm-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
        ${host ? `<div class="go-actions"><button id="sm-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`;
    }
    if (!host) return `<p class="muted">En attente de l'hôte…</p>`;
    if (pl) {
      return `<div class="go-actions">
          <button id="sm-next" class="btn btn-primary">▶ Manche suivante (${pl.played + 1}/${pl.rounds})</button>
          <button id="sm-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="sm-over-error" class="error-msg"></p>`;
    }
    return `<div class="go-actions">
        <button id="sm-next" class="btn btn-primary">Nouvelle manche</button>
        <button id="sm-to-setup" class="btn btn-secondary">Réglages</button>
        <button id="sm-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
      </div><p id="sm-over-error" class="error-msg"></p>`;
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("sm-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !g2d || !world) return;
    driveLocal(dt);
    const decay = Math.pow(0.82, dt * 60);
    off.x *= decay; off.y *= decay; off.a *= decay;
    draw(ts, dt);
  }

  // Où est la caméra ? Arène : tout l'écran. Îles : sur ma voiture (ou toute la map si je suis éliminé).
  function updateCamera(myView, dt) {
    const m = st.map;
    if (m.kind === "arena") { cam.x = m.w / 2; cam.y = m.h / 2; cam.z = 1; return; }
    const follow = myView && myView.alive;
    const fitZ = Math.min(VIEW_W / m.w, VIEW_H / m.h);
    const tz = follow ? ISLAND_ZOOM : fitZ;
    const tx = follow ? myView.x + myView.vx * 0.25 : m.w / 2;
    const ty = follow ? myView.y + myView.vy * 0.25 : m.h / 2;
    const k = 1 - Math.pow(0.0015, dt);   // glissé doux
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
  }

  function draw(ts, dt) {
    const m = st.map;
    // Positions à afficher.
    const view = [];
    for (const c of st.cars) {
      let v;
      if (c.id === me() && pred) { const o = ownView(); v = { ...o, id: c.id, alive: true, team: c.team, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a }; }
      else v = interpolated(c.id) || c;
      view.push(v);
      if (v.alive) drawSkids(c.id, v);
    }
    updateCamera(view.find((v) => v.id === me()), dt);

    g2d.setTransform(1, 0, 0, 1, 0, 0);
    g2d.fillStyle = "#050814";
    g2d.fillRect(0, 0, VIEW_W, VIEW_H);
    let sx = 0, sy = 0;
    if (shake > 0.3) { sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake; shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    g2d.setTransform(cam.z, 0, 0, cam.z, VIEW_W / 2 - cam.x * cam.z + sx, VIEW_H / 2 - cam.y * cam.z + sy);

    g2d.drawImage(world, 0, 0);
    if (m.kind === "arena") drawArena(ts);
    else drawZoneIsland(ts);
    g2d.drawImage(skid, 0, 0);

    // Voitures qui tombent (sous les autres), puis les autres.
    for (const v of view) if (v.alive && v.falling) drawCar(v);
    for (const v of view) if (v.alive && !v.falling) drawCar(v);
    // Noms
    for (const v of view) {
      if (!v.alive || v.falling) continue;
      const p = playerOf(v.id);
      g2d.font = "bold 13px Segoe UI, sans-serif";
      g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.lineWidth = 3; g2d.strokeStyle = "rgba(0,0,0,0.75)";
      g2d.strokeText(p?.pseudo || "?", v.x, v.y - 34);
      g2d.fillStyle = "#fff";
      g2d.fillText(p?.pseudo || "?", v.x, v.y - 34);
      if (v.id === me()) {
        g2d.beginPath(); g2d.moveTo(v.x - 6, v.y - 52); g2d.lineTo(v.x + 6, v.y - 52); g2d.lineTo(v.x, v.y - 45); g2d.fill();
      }
    }
    drawParticles(dt);
    drawZoneArrow(view.find((v) => v.id === me()));

    // Écran fixe (compte à rebours, mini-carte).
    g2d.setTransform(1, 0, 0, 1, 0, 0);
    if (m.kind === "islands") drawMinimap(view);
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      g2d.fillStyle = "rgba(0,0,0,0.45)";
      g2d.fillRect(0, VIEW_H / 2 - 80, VIEW_W, 160);
      g2d.fillStyle = "#fff";
      g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.font = "bold 72px Segoe UI, sans-serif";
      g2d.fillText(left > 0 ? left : "GO !", VIEW_W / 2, VIEW_H / 2 - 14);
      g2d.font = "22px Segoe UI, sans-serif";
      const myTeam = carOf(me())?.team;
      g2d.fillText(`${VARIANT_LABEL[m.kind]} · ${st.mode === "teams" ? `Équipes — tu es chez les ${TEAM_LABEL[myTeam] || "?"}` : "Chacun pour soi"}`, VIEW_W / 2, VIEW_H / 2 + 46);
    }

    if (pred) {
      const bar = document.querySelector("#sm-nitro i");
      if (bar) { bar.style.width = Math.round(pred.nitro * 100) + "%"; bar.parentElement.classList.toggle("on", pred.boost); }
    }
  }

  // Arène : le rond (qui rétrécit) avec un bord rouge qui clignote.
  function drawArena(ts) {
    const m = st.map, R = st.arenaR;
    // Zone déjà disparue (fantôme)
    g2d.strokeStyle = "rgba(255,80,80,0.15)"; g2d.lineWidth = 2; g2d.setLineDash([10, 12]);
    g2d.beginPath(); g2d.arc(m.cx, m.cy, m.r0, 0, Math.PI * 2); g2d.stroke(); g2d.setLineDash([]);
    g2d.fillStyle = "#1c2433";
    g2d.beginPath(); g2d.arc(m.cx, m.cy + 14, R, 0, Math.PI * 2); g2d.fill();
    const gr = g2d.createRadialGradient(m.cx - R * 0.3, m.cy - R * 0.3, 10, m.cx, m.cy, Math.max(20, R));
    gr.addColorStop(0, "#8d97a8"); gr.addColorStop(1, "#4a5466");
    g2d.fillStyle = gr;
    g2d.beginPath(); g2d.arc(m.cx, m.cy, R, 0, Math.PI * 2); g2d.fill();
    // Cercles du dohyō
    g2d.strokeStyle = "rgba(255,255,255,0.25)"; g2d.lineWidth = 4;
    g2d.beginPath(); g2d.arc(m.cx, m.cy, Math.min(R, 90), 0, Math.PI * 2); g2d.stroke();
    const pulse = st.shrinking ? (Math.sin(ts / 120) + 1) / 2 : 0;
    g2d.strokeStyle = st.shrinking ? `rgba(255,${60 + pulse * 80},60,${0.6 + pulse * 0.4})` : "rgba(255,255,255,0.35)";
    g2d.lineWidth = 8;
    g2d.beginPath(); g2d.arc(m.cx, m.cy, Math.max(1, R - 4), 0, Math.PI * 2); g2d.stroke();
  }

  // Îles : l'île de la zone sûre brille.
  function drawZoneIsland(ts) {
    if (!st.zone) return;
    const I = st.map.islands[st.zone.island];
    const pulse = (Math.sin(ts / 180) + 1) / 2;
    g2d.fillStyle = `rgba(80,255,170,${0.12 + pulse * 0.12})`;
    g2d.beginPath(); g2d.arc(I.x, I.y, I.r, 0, Math.PI * 2); g2d.fill();
    g2d.strokeStyle = `rgba(80,255,170,${0.6 + pulse * 0.4})`; g2d.lineWidth = 10;
    g2d.beginPath(); g2d.arc(I.x, I.y, I.r - 5, 0, Math.PI * 2); g2d.stroke();
    // Chrono au centre de l'île
    g2d.fillStyle = "rgba(255,255,255,0.85)";
    g2d.font = "bold 120px Segoe UI, sans-serif";
    g2d.textAlign = "center"; g2d.textBaseline = "middle";
    g2d.fillText(Math.ceil(st.zone.left / 1000), I.x, I.y);
  }

  // Flèche autour de ma voiture qui montre la zone sûre.
  function drawZoneArrow(v) {
    if (!st.zone || !v || !v.alive || v.falling) return;
    const I = st.map.islands[st.zone.island];
    const d = Math.hypot(I.x - v.x, I.y - v.y);
    if (d <= I.r) return;
    const a = Math.atan2(I.y - v.y, I.x - v.x);
    g2d.save();
    g2d.translate(v.x + Math.cos(a) * 58, v.y + Math.sin(a) * 58);
    g2d.rotate(a);
    g2d.fillStyle = "rgba(80,255,170,0.95)";
    g2d.beginPath(); g2d.moveTo(16, 0); g2d.lineTo(-8, -11); g2d.lineTo(-3, 0); g2d.lineTo(-8, 11); g2d.closePath(); g2d.fill();
    g2d.restore();
  }

  function drawMinimap(view) {
    const m = st.map;
    const W = 250, s = W / m.w, H = m.h * s;
    const x0 = VIEW_W - W - 16, y0 = 16;
    g2d.fillStyle = "rgba(5,8,20,0.8)";
    g2d.strokeStyle = "rgba(255,255,255,0.3)"; g2d.lineWidth = 2;
    g2d.fillRect(x0 - 6, y0 - 6, W + 12, H + 12);
    g2d.strokeRect(x0 - 6, y0 - 6, W + 12, H + 12);
    g2d.strokeStyle = "#5b6577";
    for (const cor of m.corridors) {
      const A = m.islands[cor.a], B = m.islands[cor.b];
      g2d.lineWidth = Math.max(2, cor.w * s);
      g2d.beginPath(); g2d.moveTo(x0 + A.x * s, y0 + A.y * s); g2d.lineTo(x0 + B.x * s, y0 + B.y * s); g2d.stroke();
    }
    m.islands.forEach((I, i) => {
      const zone = st.zone?.island === i;
      g2d.fillStyle = zone ? "rgba(80,255,170,0.85)" : "#6b7588";
      g2d.beginPath(); g2d.arc(x0 + I.x * s, y0 + I.y * s, I.r * s, 0, Math.PI * 2); g2d.fill();
      g2d.fillStyle = "rgba(0,0,0,0.55)";
      g2d.font = "bold 12px Segoe UI, sans-serif"; g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.fillText(String.fromCharCode(65 + i), x0 + I.x * s, y0 + I.y * s);
    });
    for (const v of view) {
      if (!v.alive || v.falling) continue;
      g2d.fillStyle = colorOf(v);
      g2d.beginPath(); g2d.arc(x0 + v.x * s, y0 + v.y * s, v.id === me() ? 5 : 4, 0, Math.PI * 2); g2d.fill();
      if (v.id === me()) { g2d.strokeStyle = "#fff"; g2d.lineWidth = 2; g2d.stroke(); }
    }
    // Ce que montre l'écran
    const vw = VIEW_W / cam.z, vh = VIEW_H / cam.z;
    g2d.strokeStyle = "rgba(255,255,255,0.5)"; g2d.lineWidth = 1;
    g2d.strokeRect(x0 + (cam.x - vw / 2) * s, y0 + (cam.y - vh / 2) * s, vw * s, vh * s);
  }

  const colorOf = (v) => (st.mode === "teams" && v.team ? st.teamColors[v.team] : playerOf(v.id)?.color || "#888");

  function drawCar(v) {
    const L = P.CAR_L, Wd = P.CAR_W;
    const fall = v.falling ? v.fall || 0 : 0;
    g2d.save();
    g2d.translate(v.x, v.y);
    g2d.rotate(v.a + fall * 3);
    const sc = 1 - fall * 0.8;
    g2d.scale(sc, sc);
    g2d.globalAlpha = 1 - fall * 0.6;
    if (v.boost && !v.falling) {
      const len = 18 + Math.random() * 14;
      const gr = g2d.createLinearGradient(-L / 2, 0, -L / 2 - len, 0);
      gr.addColorStop(0, "rgba(120,200,255,0.95)"); gr.addColorStop(0.4, "rgba(255,170,40,0.9)"); gr.addColorStop(1, "rgba(255,60,20,0)");
      g2d.fillStyle = gr;
      g2d.beginPath(); g2d.moveTo(-L / 2 + 2, -6); g2d.lineTo(-L / 2 - len, 0); g2d.lineTo(-L / 2 + 2, 6); g2d.fill();
    }
    if (!v.falling) { g2d.fillStyle = "rgba(0,0,0,0.35)"; rr(g2d, -L / 2 + 3, -Wd / 2 + 4, L, Wd, 7); g2d.fill(); }
    g2d.fillStyle = "#111";
    for (const sy of [-1, 1]) {
      g2d.fillRect(-L / 2 + 5, sy * (Wd / 2) - 3, 11, 6);
      g2d.save(); g2d.translate(L / 2 - 10, sy * (Wd / 2)); g2d.rotate((v.st || 0) * 0.45); g2d.fillRect(-5.5, -3, 11, 6); g2d.restore();
    }
    g2d.fillStyle = colorOf(v);
    rr(g2d, -L / 2, -Wd / 2, L, Wd, 7); g2d.fill();
    g2d.lineWidth = 2; g2d.strokeStyle = "rgba(0,0,0,0.45)"; g2d.stroke();
    // En équipe : bande de la couleur du joueur sur le toit.
    g2d.fillStyle = st.mode === "teams" ? playerOf(v.id)?.color || "#fff" : "rgba(255,255,255,0.18)";
    g2d.fillRect(-8, -Wd / 2 + 4, 14, Wd - 8);
    g2d.fillStyle = "rgba(20,30,50,0.8)";
    rr(g2d, L / 2 - 18, -Wd / 2 + 4, 8, Wd - 8, 2); g2d.fill();
    rr(g2d, -L / 2 + 6, -Wd / 2 + 5, 5, Wd - 10, 2); g2d.fill();
    g2d.fillStyle = "#fff6b0";
    g2d.fillRect(L / 2 - 3, -Wd / 2 + 3, 3, 5); g2d.fillRect(L / 2 - 3, Wd / 2 - 8, 3, 5);
    if (v.id === me()) { g2d.lineWidth = 2; g2d.strokeStyle = "#fff"; rr(g2d, -L / 2 - 2, -Wd / 2 - 2, L + 4, Wd + 4, 8); g2d.stroke(); }
    g2d.restore();
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    if (particles.length > 600) particles.splice(0, particles.length - 600);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
      const f = p.life / p.max;
      if (p.kind === "spark") {
        g2d.strokeStyle = `rgba(255,${180 + Math.random() * 60},80,${f})`; g2d.lineWidth = 2;
        g2d.beginPath(); g2d.moveTo(p.x, p.y); g2d.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g2d.stroke();
      } else if (p.kind === "fire") {
        g2d.fillStyle = `rgba(255,${100 + f * 120},30,${f})`;
        g2d.beginPath(); g2d.arc(p.x, p.y, 4 + (1 - f) * 10, 0, Math.PI * 2); g2d.fill();
      } else if (p.kind === "smoke") {
        g2d.fillStyle = `rgba(60,60,60,${f * 0.45})`;
        g2d.beginPath(); g2d.arc(p.x, p.y, 6 + (1 - f) * 16, 0, Math.PI * 2); g2d.fill();
      } else if (p.kind === "flash") {
        g2d.fillStyle = `rgba(255,240,200,${f * 0.8})`;
        g2d.beginPath(); g2d.arc(p.x, p.y, 40 + (1 - f) * 160, 0, Math.PI * 2); g2d.fill();
      }
    }
  }

  function rr(c, x, y, w, h, r) {
    c.beginPath(); c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }
})();
