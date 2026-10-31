// ===================================================================
//  PATATE CHAUDE — Client (s'affiche dans le hub Le Bordel)
//  - TA voiture est calculée ici tout de suite (prédiction), puis
//    recalée sur le serveur à chaque message : zéro retard au volant.
//  - Les AUTRES voitures sont affichées avec ~0,1 s de retard, en
//    glissant entre deux positions reçues : c'est fluide.
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const K = P.K;
  const INTERP_DELAY = 100;   // ms de retard pour afficher les autres voitures

  let api = null, root = null;
  let st = null;              // dernier état reçu du serveur
  let phaseEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;

  // Prédiction de MA voiture
  let pred = null;            // état de ma voiture calculé ici
  let prevPred = null;        // état au calcul précédent (pour glisser entre les deux à l'écran)
  let pending = [];           // touches envoyées mais pas encore traitées par le serveur
  const history = new Map();  // n° de touche -> ce que j'avais prédit juste après
  let clockOff = null;        // écart entre l'horloge du serveur et la nôtre
  let seq = 0;
  let acc = 0;                // temps accumulé avant le prochain calcul
  const off = { x: 0, y: 0, a: 0 };   // petit décalage lissé quand le serveur nous recale

  const snaps = [];           // dernières positions reçues (pour lisser les autres)
  const pressed = new Set();  // touches enfoncées (codes)

  // Décor
  let mapId = null, bg = null, skid = null, skidCtx = null;
  const lastWheels = {};      // dernières positions des roues arrière (traces de pneus)
  let particles = [];
  const seenFx = new Set();
  let shake = 0;
  let boomKey = null;

  // Diagnostic de fluidité (taper window.__pt dans la console du navigateur).
  const dbg = { n: 0, fix: 0, sum: 0, max: 0, big: 0, frames: 0, slow: 0, drawMs: 0 };
  window.__pt = () => ({
    messages: dbg.n, recalages: dbg.fix, ecartMoyen: +(dbg.sum / Math.max(1, dbg.fix)).toFixed(2),
    ecartMax: +dbg.max.toFixed(1), recalagesVisibles: dbg.big,
    images: dbg.frames, imagesLentes: dbg.slow, dessinMoyenMs: +(dbg.drawMs / Math.max(1, dbg.frames)).toFixed(2),
  });

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  const FUSE_LABELS = { courte: "Courte", normale: "Normale", longue: "Longue" };
  const SURFACE_LABELS = { asphalte: "🛣️ Asphalte", terre: "🟫 Terre", neige: "❄️ Neige" };

  // ===================================================================
  //  SQUELETTE HTML
  // ===================================================================
  const TEMPLATE = `
    <div id="pt-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">💣</span>
        <h1>PATATE CHAUDE</h1>
        <p class="tagline">Petites voitures, grosse bombe.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card">
          <h2>⚙️ Réglages</h2>
          <div id="pt-settings" class="settings"></div>
        </div>
        <div class="card">
          <h2>🎮 Commandes</h2>
          <ul class="pt-help">
            <li><kbd>Z</kbd> / <kbd>↑</kbd> accélérer · <kbd>S</kbd> / <kbd>↓</kbd> freiner puis reculer</li>
            <li><kbd>Q</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> tourner</li>
            <li><kbd>Espace</kbd> frein à main → <b>dérapage</b></li>
            <li><kbd>Shift</kbd> <b>nitro</b> (la jauge se recharge)</li>
            <li>💣 Touche une voiture pour lui refiler la bombe.</li>
            <li>💥 Tape l'arrière d'une voiture pour la faire partir en tête-à-queue !</li>
            <li>⚠️ Trop vite dans un virage = tu perds le contrôle (surtout sur terre, neige et huile).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="pt-start" class="btn btn-primary btn-big">Lancer la manche</button>
        <p id="pt-hint" class="muted"></p>
        <p id="pt-error" class="error-msg"></p>
        <button id="pt-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>
    </div>

    <div id="pt-play" class="hidden">
      <div class="game-topbar">
        <span class="pill" id="pt-round">Manche 1</span>
        <span class="pt-surface" id="pt-surface"></span>
        <span class="phase-label" id="pt-status">—</span>
        <div id="pt-nitro" class="pt-nitro hidden" title="Nitro (Shift)"><span>NITRO</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="pt-canvas" width="${P.W}" height="${P.H}"></canvas>
        <div id="pt-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = frein à main · Shift = nitro</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.patate = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; snaps.length = 0; particles = []; clockOff = null;
      mapId = null; boomKey = null; seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");
      document.querySelector(".app").classList.add("pt-wide");   // arène plus grande
      canvas = $("pt-canvas");
      g2d = canvas.getContext("2d");
      $("pt-start").onclick = startRound;
      $("pt-finish-setup").onclick = finishGame;
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
        $("pt-play").classList.add("hidden");
        $("pt-setup").classList.remove("hidden");
        renderSettings();
        renderStartArea();
        return;
      }
      $("pt-setup").classList.add("hidden");
      $("pt-play").classList.remove("hidden");

      if (st.map && st.map.id !== mapId) newMap();
      if (prevRound !== st.roundNum) { pending = []; pred = prevPred = null; history.clear(); }

      // On date chaque position avec l'heure du SERVEUR (convertie en heure locale) :
      // les petits retards du réseau ne font plus trembler les autres voitures.
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

  function startRound() {
    $("pt-error").textContent = "";
    api.action("start").then((r) => { if (r.error) $("pt-error").textContent = r.error; });
  }

  function finishGame() {
    if (confirm("Terminer Patate chaude ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  CLAVIER (e.code = touche physique : Z d'un AZERTY = "KeyW")
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
    let k = 0;
    for (const code of pressed) k |= KEYMAP[code];
    return k;
  }

  // ===================================================================
  //  PRÉDICTION : on repart de l'état du serveur et on rejoue les
  //  touches qu'il n'a pas encore traitées.
  // ===================================================================
  function env() {
    const m = st.map;
    return { w: m.w, h: m.h, grip: m.grip, oils: m.oils, obstacles: m.obstacles, nitro: st.settings.nitro };
  }
  const myBonus = () => (st.holderId === me() ? P.HOLDER_BONUS : 1);

  // Où dessiner MA voiture : entre le calcul précédent et le dernier,
  // selon le temps écoulé (l'écran tourne à 60 i/s, la physique à 30).
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / P.TICK);
    return {
      ...pred,
      x: prevPred.x + (pred.x - prevPred.x) * f,
      y: prevPred.y + (pred.y - prevPred.y) * f,
      a: prevPred.a + angDiff(pred.a, prevPred.a) * f,
    };
  }

  // Le serveur et moi avons-nous trouvé la même chose ?
  // (le serveur arrondit ses nombres, d'où la petite tolérance)
  function same(a, b) {
    return Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(angDiff(a.a, b.a)) < 0.002 &&
           Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05 && Math.abs(a.w - b.w) < 0.05;
  }

  function reconcile() {
    const sc = st.cars.find((c) => c.id === me());
    if (!sc || !sc.alive || !["play", "boom"].includes(st.phase)) {
      pred = prevPred = null; pending = []; history.clear(); return;
    }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);

    // Ma prédiction pour ce numéro de touche était juste : on ne touche à rien.
    const mine = history.get(sc.seq);
    dbg.n++;
    if (pred && mine && same(mine, sc)) return;

    // Sinon (choc, explosion, réseau...) : on repart de la vérité du serveur
    // et on rejoue les touches qu'il n'a pas encore reçues.
    const before = pred && ownView();
    const oldPred = pred;
    pred = P.copyCar(sc);
    const e = env(), b = myBonus();
    const others = othersForPred();
    for (const p of pending) { P.simulate(pred, p.k, e, b, others); history.set(p.s, P.copyCar(pred)); }
    if (prevPred && oldPred) {   // on décale aussi l'image précédente pour garder le glissé
      prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; prevPred.a += angDiff(pred.a, oldPred.a);
    }
    if (before) {
      // L'écart est effacé en douceur à l'écran, pas d'un coup.
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 150) { off.x += dx; off.y += dy; off.a += angDiff(before.a, after.a); }
      const err = Math.hypot(dx, dy);
      dbg.fix++; dbg.sum += err; dbg.max = Math.max(dbg.max, err); if (err > 2) dbg.big++;
    }
  }

  // Avance ma voiture au rythme du serveur (30 fois/s) et envoie mes touches.
  function driveLocal(dt) {
    if (!pred || !["play", "boom"].includes(st?.phase)) { acc = 0; return; }
    acc = Math.min(acc + dt, 0.2);
    const e = env(), b = myBonus();
    const others = acc >= P.TICK ? othersForPred() : null;
    while (acc >= P.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = P.copyCar(pred);
      P.simulate(pred, k, e, b, others);
      history.set(seq, P.copyCar(pred));
      acc -= P.TICK;
    }
  }

  // Les autres voitures (et les épaves) là où on les VOIT : ma voiture
  // prédite bute dessus, donc à l'écran elle ne passe jamais à travers.
  function othersForPred() {
    return st.cars.filter((c) => c.id !== me()).map((c) => P.copyCar(interpolated(c.id) || c));
  }

  // Position affichée des autres voitures (entre deux messages reçus).
  function interpolated(id) {
    const t = Date.now() - INTERP_DELAY;
    let a = null, b = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].t <= t) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
    }
    if (!a) a = b = snaps[0];
    const ca = a?.cars[id], cb = b?.cars[id] || ca;
    if (!ca) return null;
    const f = b.t > a.t ? Math.min(1, (t - a.t) / (b.t - a.t)) : 0;
    return {
      ...cb,
      x: ca.x + (cb.x - ca.x) * f,
      y: ca.y + (cb.y - ca.y) * f,
      a: ca.a + angDiff(cb.a, ca.a) * f,
    };
  }

  // ===================================================================
  //  EFFETS : chocs, explosions
  // ===================================================================
  function handleEffects() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = Math.min(30, 6 + f.s / 25);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * f.s * 0.8;
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.3, max: 0.6, kind: "spark" });
      }
      if (f.cars.includes(me())) shake = Math.max(shake, Math.min(16, f.s / 35));
    }
    if (seenFx.size > 300) seenFx.clear();

    const bk = st.lastBoom ? `${st.roundNum}:${st.lastBoom.id}` : null;
    if (bk && bk !== boomKey) {
      const { x, y } = st.lastBoom;
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 380;
        particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.7, max: 1.2, kind: i % 3 ? "fire" : "smoke" });
      }
      particles.push({ x, y, vx: 0, vy: 0, life: 0.5, max: 0.5, kind: "flash" });
      shake = Math.max(shake, st.lastBoom.id === me() ? 22 : 10);
    }
    boomKey = bk;
  }

  // ===================================================================
  //  DÉCOR (dessiné une fois par map dans une image à part)
  // ===================================================================
  function seeded(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  const LOOK = {
    asphalte: { ground: "#2c2d35", dots: ["#34353e", "#26272e"], line: "rgba(255,210,80,0.18)", block: "#5b5f6b", edge: "#ffcc33", skid: "rgba(10,10,12,0.32)" },
    terre:    { ground: "#6e4b2e", dots: ["#7b5636", "#5f3f25"], line: null, block: "#8b5a2b", edge: "#5a3615", skid: "rgba(50,30,15,0.30)" },
    neige:    { ground: "#dfe9f3", dots: ["#eef4fa", "#cfdbe8"], line: null, block: "#a8d4f0", edge: "#6fb2dd", skid: "rgba(120,140,170,0.35)" },
  };

  function newMap() {
    const m = st.map;
    mapId = m.id;
    const look = LOOK[m.surface] || LOOK.asphalte;
    const rnd = seeded(m.seed);

    bg = document.createElement("canvas");
    bg.width = P.W; bg.height = P.H;
    const c = bg.getContext("2d");
    c.fillStyle = look.ground;
    c.fillRect(0, 0, P.W, P.H);
    // Grain du sol.
    for (let i = 0; i < 2500; i++) {
      c.fillStyle = look.dots[i % 2];
      const s = 1 + rnd() * 3;
      c.fillRect(rnd() * P.W, rnd() * P.H, s, s);
    }
    // Marquages au sol (asphalte).
    if (look.line) {
      c.strokeStyle = look.line; c.lineWidth = 4; c.setLineDash([30, 26]);
      c.strokeRect(60, 60, P.W - 120, P.H - 120);
      c.setLineDash([]);
    }
    // Flaques d'huile.
    for (const o of m.oils) {
      const gr = c.createRadialGradient(o.x - o.r * 0.3, o.y - o.r * 0.3, 2, o.x, o.y, o.r);
      gr.addColorStop(0, "rgba(90,70,140,0.85)"); gr.addColorStop(0.4, "rgba(15,15,25,0.9)"); gr.addColorStop(1, "rgba(10,10,15,0.75)");
      c.fillStyle = gr;
      c.beginPath(); c.ellipse(o.x, o.y, o.r, o.r * 0.8, rnd() * 3, 0, Math.PI * 2); c.fill();
    }
    // Obstacles (avec leur ombre).
    for (const o of m.obstacles) {
      c.fillStyle = "rgba(0,0,0,0.35)";
      rr(c, o.x + 6, o.y + 8, o.w, o.h, 6); c.fill();
      c.fillStyle = look.block;
      rr(c, o.x, o.y, o.w, o.h, 6); c.fill();
      c.lineWidth = 4; c.strokeStyle = look.edge;
      if (m.surface === "asphalte") c.setLineDash([12, 10]);
      rr(c, o.x + 2, o.y + 2, o.w - 4, o.h - 4, 5); c.stroke();
      c.setLineDash([]);
      c.fillStyle = "rgba(255,255,255,0.12)";
      c.fillRect(o.x + 6, o.y + 6, o.w - 12, Math.min(10, o.h / 4));
    }
    // Bordure de l'arène (pneus).
    c.lineWidth = 10; c.strokeStyle = "#111"; c.setLineDash([16, 8]);
    c.strokeRect(5, 5, P.W - 10, P.H - 10);
    c.setLineDash([]);

    skid = document.createElement("canvas");
    skid.width = P.W; skid.height = P.H;
    skidCtx = skid.getContext("2d");
    skidCtx.strokeStyle = look.skid;
    skidCtx.lineWidth = 4;
    skidCtx.lineCap = "round";
    for (const k in lastWheels) delete lastWheels[k];
  }

  // Traces de pneus quand une voiture glisse ou freine fort.
  function drawSkids(id, c) {
    const fx = Math.cos(c.a), fy = Math.sin(c.a), rx = -fy, ry = fx;
    const lat = Math.abs(c.vx * rx + c.vy * ry);
    const wheels = [
      { x: c.x - fx * 14 + rx * 9, y: c.y - fy * 14 + ry * 9 },
      { x: c.x - fx * 14 - rx * 9, y: c.y - fy * 14 - ry * 9 },
    ];
    const prev = lastWheels[id];
    if (prev && (lat > 70 || c.slide)) {
      for (let i = 0; i < 2; i++) {
        if (Math.hypot(prev[i].x - wheels[i].x, prev[i].y - wheels[i].y) > 40) continue;
        skidCtx.beginPath();
        skidCtx.moveTo(prev[i].x, prev[i].y);
        skidCtx.lineTo(wheels[i].x, wheels[i].y);
        skidCtx.stroke();
      }
    }
    lastWheels[id] = wheels;
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings;
    const host = api.isHost();
    const panel = $("pt-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const toggle = (key, checked) => `
      <label class="switch">
        <input type="checkbox" data-key="${key}" ${checked ? "checked" : ""} ${host ? "" : "disabled"} />
        <span class="track"></span>
      </label>`;
    panel.innerHTML = `
      <div class="setting-block">
        <label>Durée de la mèche</label>
        <div class="cat-chips">
          ${Object.entries(FUSE_LABELS).map(([k, label]) =>
            `<button class="cat-chip ${s.fuse === k ? "on" : ""}" data-fuse="${k}" ${host ? "" : "disabled"}>${label}</button>`).join("")}
        </div>
      </div>
      <div class="setting"><label>Nitro (Shift)</label><div class="val">${toggle("nitro", s.nitro)}</div></div>
      <div class="setting"><label>Sols glissants (terre, neige)</label><div class="val">${toggle("slippery", s.slippery)}</div></div>
      <p class="settings-note">La map est tirée au hasard à chaque manche.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (!host) return;
    panel.querySelectorAll("[data-fuse]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { fuse: b.dataset.fuse } });
    });
    panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => api.action("settings", { settings: { [cb.dataset.key]: cb.checked } });
    });
  }

  function renderStartArea() {
    const host = api.isHost();
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("pt-finish-setup").classList.toggle("hidden", !host);
    $("pt-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("pt-start").style.display = host ? "" : "none";
    $("pt-start").disabled = n < 3;
    $("pt-hint").textContent = !host ? "En attente que l'hôte lance la manche…"
      : n < 3 ? `Il faut au moins 3 joueurs connectés (${n}/3).`
      : `${n} joueurs prêts.`;
  }

  // ===================================================================
  //  BANDEAU + ÉCRAN DE FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("pt-round").textContent = "Manche " + st.roundNum + (st.playlist ? "/" + st.playlist.rounds : "");
    $("pt-surface").textContent = SURFACE_LABELS[st.map?.surface] || "";
    const mine = st.cars.find((c) => c.id === me());
    const status = $("pt-status");
    status.className = "phase-label";
    if (st.phase === "play" || st.phase === "countdown") {
      if (!mine) status.textContent = "👀 Tu regardes cette manche";
      else if (!mine.alive) status.textContent = "💀 Éliminé — regarde la fin !";
      else if (st.holderId === me()) { status.textContent = "💣 TU AS LA BOMBE ! Fonce sur quelqu'un !"; status.classList.add("pt-danger"); }
      else status.textContent = `🏎️ Fuis ${pseudoOf(st.holderId)} !`;
    } else if (st.phase === "boom") status.textContent = `💥 ${pseudoOf(st.lastBoom?.id)} a explosé !`;
    else if (st.phase === "roundOver") status.textContent = "🏁 Fin de la manche";

    const nitro = $("pt-nitro");
    const show = st.settings.nitro && mine?.alive && st.phase !== "roundOver";
    nitro.classList.toggle("hidden", !show);
    renderRoundOver();
  }

  function renderRoundOver() {
    const ov = $("pt-overlay");
    const isOver = st.phase === "roundOver" && !!st.lastRound;
    ov.parentElement.classList.toggle("over", isOver);
    if (!isOver) { ov.classList.add("hidden"); return; }
    const host = api.isHost();
    if (!ov.classList.contains("hidden") && ov.dataset.round === String(st.roundNum) && ov.dataset.host === String(host)) return;
    ov.dataset.round = st.roundNum;
    ov.dataset.host = host;
    const medals = ["🥇", "🥈", "🥉"];
    ov.innerHTML = `
      <div class="pt-over card">
        <h2 class="go-banner">🏆 ${esc(pseudoOf(st.lastRound[0].id))} survit !</h2>
        <ul class="podium-list">
          ${st.lastRound.map((r, i) => `
            <li style="animation-delay:${i * 0.1}s">
              <span class="place">${medals[r.place - 1] || r.place + "e"}</span>
              ${api.avatar(playerOf(r.id))}
              <span class="name">${esc(pseudoOf(r.id))}</span>
              <span class="gain">+${r.points}</span>
              <span class="muted">(${playerOf(r.id)?.score ?? 0} au total)</span>
            </li>`).join("")}
        </ul>
        ${overButtons(host)}
      </div>`;
    ov.classList.remove("hidden");
    if (host) {
      $("pt-next") && ($("pt-next").onclick = () => api.action("start").then((r) => { if (r.error) $("pt-over-error").textContent = r.error; }));
      $("pt-to-setup") && ($("pt-to-setup").onclick = () => api.action("setup"));
      $("pt-finish").onclick = st.playlist?.final ? () => api.action("finish") : finishGame;
    }
  }

  // Boutons de fin de manche (différents en mode playlist).
  let finishEndLocal = 0;
  function overButtons(host) {
    const pl = st.playlist;
    if (pl?.final) {
      finishEndLocal = Date.now() + pl.finishLeft;
      return `<p class="go-final">🏁 C'était la dernière manche ! Classement dans <b id="pt-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
        ${host ? `<div class="go-actions"><button id="pt-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`;
    }
    if (!host) return `<p class="muted">En attente de l'hôte…</p>`;
    if (pl) {
      return `<div class="go-actions">
          <button id="pt-next" class="btn btn-primary">▶ Manche suivante (${pl.played + 1}/${pl.rounds})</button>
          <button id="pt-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div>
        <p id="pt-over-error" class="error-msg"></p>`;
    }
    return `<div class="go-actions">
        <button id="pt-next" class="btn btn-primary">Nouvelle manche</button>
        <button id="pt-to-setup" class="btn btn-secondary">Réglages</button>
        <button id="pt-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
      </div>
      <p id="pt-over-error" class="error-msg"></p>`;
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE (60 images/s)
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    dbg.frames++; if (dt > 0.025) dbg.slow++;
    const fin = document.getElementById("pt-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !g2d || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.82, dt * 60);
    off.x *= decay; off.y *= decay; off.a *= decay;
    const t0 = performance.now();
    draw(ts, dt);
    dbg.drawMs += performance.now() - t0;
  }

  function draw(ts, dt) {
    g2d.save();
    if (shake > 0.3) {
      g2d.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
      shake *= Math.pow(0.85, dt * 60);
    } else shake = 0;

    g2d.drawImage(bg, 0, 0);

    // Positions à afficher.
    const view = [];
    for (const c of st.cars) {
      let v;
      if (c.id === me() && pred) {
        const o = ownView();
        v = { ...o, id: c.id, alive: true, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a };
      }
      else v = interpolated(c.id) || c;
      view.push(v);
      if (v.alive) drawSkids(c.id, v);
    }
    g2d.drawImage(skid, 0, 0);

    // Lueur sous le porteur de bombe.
    const pulseHz = 1.5 + (st.heat || 0) * 9;
    const pulse = (Math.sin((ts / 1000) * pulseHz * Math.PI * 2) + 1) / 2;
    const holderV = view.find((v) => v.id === st.holderId);
    if (holderV) {
      g2d.beginPath();
      g2d.arc(holderV.x, holderV.y, 34 + pulse * 10, 0, Math.PI * 2);
      g2d.fillStyle = `rgba(255,50,30,${0.18 + pulse * 0.3})`;
      g2d.fill();
    }

    // Épaves d'abord, puis voitures.
    for (const v of view) if (!v.alive) drawCar(v, true);
    for (const v of view) if (v.alive) drawCar(v, false);

    // Noms + bombe (au-dessus de tout, pas tournés).
    for (const v of view) {
      if (!v.alive) continue;
      const p = playerOf(v.id);
      g2d.font = "bold 13px Segoe UI, sans-serif";
      g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.lineWidth = 3; g2d.strokeStyle = "rgba(0,0,0,0.7)";
      g2d.strokeText(p?.pseudo || "?", v.x, v.y - 34);
      g2d.fillStyle = v.id === me() ? "#fff" : "rgba(255,255,255,0.85)";
      g2d.fillText(p?.pseudo || "?", v.x, v.y - 34);
      if (v.id === me()) {   // petite flèche au-dessus de MA voiture
        g2d.fillStyle = "#fff";
        g2d.beginPath(); g2d.moveTo(v.x - 6, v.y - 52); g2d.lineTo(v.x + 6, v.y - 52); g2d.lineTo(v.x, v.y - 45); g2d.fill();
      }
      if (v.id === st.holderId) {
        g2d.font = `${24 + pulse * 8}px serif`;
        g2d.fillText("💣", v.x, v.y);
      }
    }

    drawParticles(dt);

    // Compte à rebours.
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      g2d.fillStyle = "rgba(0,0,0,0.45)";
      g2d.fillRect(0, P.H / 2 - 80, P.W, 160);
      g2d.fillStyle = "#fff";
      g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.font = "bold 72px Segoe UI, sans-serif";
      g2d.fillText(left > 0 ? left : "GO !", P.W / 2, P.H / 2 - 14);
      g2d.font = "22px Segoe UI, sans-serif";
      g2d.fillText(st.holderId === me() ? "💣 C'est TOI qui as la bombe !" : `💣 ${pseudoOf(st.holderId)} a la bombe`, P.W / 2, P.H / 2 + 46);
    }
    g2d.restore();

    // Jauge de nitro.
    if (pred) {
      const bar = document.querySelector("#pt-nitro i");
      if (bar) { bar.style.width = Math.round(pred.nitro * 100) + "%"; bar.parentElement.classList.toggle("on", pred.boost); }
    }
  }

  // Une petite voiture vue de dessus.
  function drawCar(v, dead) {
    const L = P.CAR_L, Wd = P.CAR_W;
    const color = dead ? "#2a2626" : playerOf(v.id)?.color || "#888";
    g2d.save();
    g2d.translate(v.x, v.y);
    g2d.rotate(v.a);

    // Flamme du nitro.
    if (!dead && v.boost) {
      const len = 18 + Math.random() * 14;
      const gr = g2d.createLinearGradient(-L / 2, 0, -L / 2 - len, 0);
      gr.addColorStop(0, "rgba(120,200,255,0.95)"); gr.addColorStop(0.4, "rgba(255,170,40,0.9)"); gr.addColorStop(1, "rgba(255,60,20,0)");
      g2d.fillStyle = gr;
      g2d.beginPath(); g2d.moveTo(-L / 2 + 2, -6); g2d.lineTo(-L / 2 - len, 0); g2d.lineTo(-L / 2 + 2, 6); g2d.fill();
    }

    // Ombre.
    g2d.fillStyle = "rgba(0,0,0,0.35)";
    rr(g2d, -L / 2 + 3, -Wd / 2 + 4, L, Wd, 7); g2d.fill();

    // Roues (celles de devant tournent avec le volant).
    g2d.fillStyle = "#111";
    for (const sy of [-1, 1]) {
      g2d.fillRect(-L / 2 + 5, sy * (Wd / 2) - 3, 11, 6);
      g2d.save();
      g2d.translate(L / 2 - 10, sy * (Wd / 2));
      g2d.rotate((v.st || 0) * 0.45);
      g2d.fillRect(-5.5, -3, 11, 6);
      g2d.restore();
    }

    // Carrosserie.
    g2d.fillStyle = color;
    rr(g2d, -L / 2, -Wd / 2, L, Wd, 7); g2d.fill();
    g2d.lineWidth = 2; g2d.strokeStyle = "rgba(0,0,0,0.45)"; g2d.stroke();
    if (!dead) {
      g2d.fillStyle = "rgba(255,255,255,0.18)";               // reflet du toit
      g2d.fillRect(-8, -Wd / 2 + 4, 14, Wd - 8);
      g2d.fillStyle = "rgba(20,30,50,0.8)";                   // pare-brise
      rr(g2d, L / 2 - 18, -Wd / 2 + 4, 8, Wd - 8, 2); g2d.fill();
      rr(g2d, -L / 2 + 6, -Wd / 2 + 5, 5, Wd - 10, 2); g2d.fill();   // lunette arrière
      g2d.fillStyle = "#fff6b0";                               // phares
      g2d.fillRect(L / 2 - 3, -Wd / 2 + 3, 3, 5);
      g2d.fillRect(L / 2 - 3, Wd / 2 - 8, 3, 5);
    } else {
      g2d.fillStyle = "rgba(255,120,30,0.5)";                  // braises
      g2d.fillRect(-6, -4, 10, 8);
    }
    if (v.id === me() && !dead) { g2d.lineWidth = 2; g2d.strokeStyle = "#fff"; rr(g2d, -L / 2 - 2, -Wd / 2 - 2, L + 4, Wd + 4, 8); g2d.stroke(); }
    g2d.restore();

    // Fumée des épaves.
    if (dead && Math.random() < 0.08) {
      particles.push({ x: v.x + (Math.random() - 0.5) * 10, y: v.y, vx: (Math.random() - 0.5) * 10, vy: -20 - Math.random() * 20, life: 1.4, max: 1.4, kind: "smoke" });
    }
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    if (particles.length > 600) particles.splice(0, particles.length - 600);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
      const f = p.life / p.max;
      if (p.kind === "spark") {
        g2d.strokeStyle = `rgba(255,${180 + Math.random() * 60},80,${f})`;
        g2d.lineWidth = 2;
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
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
})();
