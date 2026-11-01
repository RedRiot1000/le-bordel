// ===================================================================
//  NÉON — Client (s'affiche dans le hub Le Bordel)
//  - MA moto est calculée ici tout de suite (prédiction, comme la Patate),
//    puis recalée sur le serveur.
//  - Les murs : le serveur envoie les nouveaux points 30 fois/s, et
//    tous les murs une fois par seconde (pour se recaler).
// ===================================================================

(() => {
  const P = window.PatatePhysics;
  const N = window.NeonRules;
  const K = P.K;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null, bg = null, mapId = null;

  // Prédiction de MA moto
  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0, a: 0 };
  const pressed = new Set();

  // Murs (recollés à partir des envois du serveur)
  let trails = {};
  let lastTick = -1;
  let clockOff = 0;          // heure du serveur - mon heure

  let particles = [];
  const seenBooms = new Set();
  let shake = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const colorOf = (id) => playerOf(id)?.color || "#888";
  const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  const serverNow = () => Date.now() + clockOff;

  const TEMPLATE = `
    <div id="ne-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🏍️</span>
        <h1>NÉON</h1>
        <p class="tagline">Ta moto laisse un mur de lumière. Ne touche à rien.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="ne-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏍️ Ta moto <b>avance toute seule</b>. <kbd>Z</kbd>/<kbd>↑</kbd> accélérer · <kbd>S</kbd>/<kbd>↓</kbd> ralentir (jamais à l'arrêt)</li>
            <li><kbd>Q</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> tourner</li>
            <li id="ne-help-jump"><kbd>Espace</kbd> <b>saut</b> par-dessus un mur (recharge 5 s)</li>
            <li>💥 Touche un mur de lumière (même le tien), un obstacle ou le bord : <b>BOUM</b>.</li>
            <li>🏆 1 point par joueur éliminé avant toi, <b>+1 par kill</b> (quelqu'un s'écrase sur TON mur).</li>
            <li id="ne-help-zone">🟥 Après 40 s, l'arène rétrécit.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="ne-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="ne-hint" class="muted"></p>
        <p id="ne-error" class="error-msg"></p>
        <button id="ne-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>
    </div>

    <div id="ne-play" class="hidden">
      <div class="game-topbar">
        <span class="pill" id="ne-round">Manche 1</span>
        <span class="pt-surface" id="ne-alive"></span>
        <span class="phase-label" id="ne-status">—</span>
        <div id="ne-jump" class="pt-nitro ne-jump hidden" title="Saut (Espace)"><span>SAUT</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="ne-canvas" width="1280" height="800"></canvas>
        <div id="ne-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches · Espace = saut</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.neon = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; trails = {}; lastTick = -1;
      mapId = null; bg = null; seenBooms.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-ocean");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("ne-canvas");
      g2d = canvas.getContext("2d");
      $("ne-start").onclick = () => {
        $("ne-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("ne-error").textContent = r.error; });
      };
      $("ne-finish-setup").onclick = finishGame;
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
      clockOff = st.t - Date.now();

      if (st.phase === "setup") {
        $("ne-play").classList.add("hidden");
        $("ne-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("ne-setup").classList.add("hidden");
      $("ne-play").classList.remove("hidden");

      if (st.map && st.map.id !== mapId) newMap();
      if (prevRound !== st.roundNum) { pending = []; pred = prevPred = null; history.clear(); particles = []; }
      syncTrails();
      handleBooms();
      reconcile();
      lastSnapRecv = performance.now();
      rebaseMotos();
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
    if (confirm("Terminer Néon ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  LES MURS : tout d'un coup (1 fois/s) ou juste les nouveaux points
  // ===================================================================
  function syncTrails() {
    if (st.trails) {
      trails = {};
      for (const [id, p] of Object.entries(st.trails)) trails[id] = p.slice();
      lastTick = st.tick;
    } else if (st.tick === lastTick + 1) {
      for (const [id, p] of Object.entries(st.adds || {})) (trails[id] ||= []).push(...p);
      lastTick = st.tick;
    }
    // (sinon : message en double ou raté -> on attend le prochain envoi complet)
    // Les murs trop vieux s'effacent.
    const limit = serverNow() - st.wallMs - 100;   // (petite marge : le serveur les retire un poil plus tard)
    for (const tr of Object.values(trails)) {
      let cut = 0;
      while (cut < tr.length && tr[cut + 2] < limit) cut += 4;
      if (cut) { tr.splice(0, cut); if (tr.length) tr[3] = 1; }
    }
  }

  // ===================================================================
  //  CLAVIER
  // ===================================================================
  const KEYMAP = {
    KeyW: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN,
    KeyA: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.HB,
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
  //  PRÉDICTION DE MA MOTO (même principe que la Patate)
  // ===================================================================
  function env() {
    const m = st.map;
    return { w: m.w, h: m.h, grip: 1, oils: [], obstacles: m.obstacles, nitro: false, jump: st.settings.jump };
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
    const sc = st.motos.find((c) => c.id === me());
    if (!sc || !sc.alive || st.phase !== "play") { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = N.copy(sc);
    const e = env();
    pending.forEach((p, i) => { N.simulate(pred, p.k, e, othersAt((i + 1) * P.TICK)); history.set(p.s, N.copy(pred)); });
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
      prevPred = N.copy(pred);
      N.simulate(pred, k, e, othersAt(pending.length * P.TICK));
      history.set(seq, N.copy(pred));
      acc -= P.TICK;
    }
  }

  // Les autres motos "au présent" (avancées du même temps que la mienne).
  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.motos.filter((c) => c.id !== me() && c.alive).map((c) => P.extrapolate(c, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / P.TICK) * P.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownMoto(c) {
    const base = c.alive ? P.extrapolate(c, aheadNow()) : c;
    const o = othersOff[c.id] || { x: 0, y: 0, a: 0 };
    const v = { ...base, x: base.x + o.x, y: base.y + o.y, a: base.a + o.a };
    lastShown[c.id] = v;
    return v;
  }
  function rebaseMotos() {
    const t = aheadNow();
    for (const c of st.motos) {
      if (c.id === me() && pred) continue;
      const prev = lastShown[c.id];
      const base = P.extrapolate(c, t);
      if (prev && c.alive && Math.hypot(prev.x - base.x, prev.y - base.y) < 120) {
        othersOff[c.id] = { x: prev.x - base.x, y: prev.y - base.y, a: angDiff(prev.a, base.a) };
      } else othersOff[c.id] = { x: 0, y: 0, a: 0 };
    }
  }

  // ===================================================================
  //  EXPLOSIONS
  // ===================================================================
  function handleBooms() {
    for (const b of st.booms || []) {
      const key = st.roundNum + ":" + b.id;
      if (seenBooms.has(key)) continue;
      seenBooms.add(key);
      const col = colorOf(b.id);
      for (let i = 0; i < 60; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 360;
        particles.push({ x: b.x, y: b.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.7, max: 1.1, col });
      }
      particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.4, max: 0.4, flash: true, col });
      shake = Math.max(shake, b.id === me() ? 20 : 8);
    }
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("ne-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    const toggle = (key) => `<label class="switch"><input type="checkbox" data-toggle="${key}" ${s[key] ? "checked" : ""} ${host ? "" : "disabled"} /><span class="track"></span></label>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Nombre de manches</label>${chips("rounds", [[3, "3"], [5, "5"], [7, "7"]])}</div>
      <div class="setting-block"><label>Durée des murs de lumière</label>${chips("walls", [["court", "5 s"], ["normal", "8 s"], ["long", "12 s"]])}</div>
      <div class="setting"><label>Saut (Espace)</label><div class="val">${toggle("jump")}</div></div>
      <div class="setting"><label>Zone qui rétrécit (après 40 s)</label><div class="val">${toggle("zone")}</div></div>
      <p class="settings-note">La map change à chaque manche, et grandit avec le nombre de joueurs.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) {
      panel.querySelectorAll("[data-key]").forEach((b) => {
        b.onclick = () => {
          const v = b.dataset.key === "rounds" ? Number(b.dataset.v) : b.dataset.v;
          api.action("settings", { settings: { [b.dataset.key]: v } });
        };
      });
      panel.querySelectorAll("[data-toggle]").forEach((cb) => {
        cb.onchange = () => api.action("settings", { settings: { [cb.dataset.toggle]: cb.checked } });
      });
    }
    $("ne-help-jump").style.display = s.jump ? "" : "none";
    $("ne-help-zone").style.display = s.zone ? "" : "none";
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("ne-start").style.display = host ? "" : "none";
    $("ne-start").disabled = n < 2;
    $("ne-finish-setup").classList.toggle("hidden", !host);
    $("ne-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("ne-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} joueurs prêts.`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("ne-round").textContent = `Manche ${st.roundNum}/${st.rounds}`;
    const alive = st.motos.filter((m) => m.alive).length;
    $("ne-alive").textContent = `🏍️ ${alive} en vie`;
    const mine = st.motos.find((c) => c.id === me());
    const status = $("ne-status");
    status.className = "phase-label";
    if (st.phase === "countdown") status.textContent = "Prépare-toi…";
    else if (st.phase === "play") {
      if (!mine) status.textContent = "👀 Tu regardes cette manche";
      else if (!mine.alive) status.textContent = "💥 Éliminé — regarde la fin !";
      else if (alive === 1) { status.textContent = "🏆 Dernier en vie !"; }
      else status.textContent = "Ne touche à rien !";
    } else status.textContent = "🏁 Fin de la manche";
    $("ne-jump").classList.toggle("hidden", !st.settings.jump || !mine?.alive || st.phase === "roundOver");
    renderRoundOver();
  }

  function renderRoundOver() {
    const ov = $("ne-overlay");
    const isOver = st.phase === "roundOver" && !!st.lastRound;
    ov.parentElement.classList.toggle("over", isOver);
    if (!isOver) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const key = st.roundNum + ":" + host + ":" + st.final;
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const medals = ["🥇", "🥈", "🥉"];
    const win = st.lastRound[0];
    const winners = st.lastRound.filter((r) => r.place === 1);
    ov.innerHTML = `
      <div class="pt-over card">
        <h2 class="go-banner">${winners.length > 1 ? "🤝 Égalité !" : `🏆 ${esc(pseudoOf(win.id))} survit !`}</h2>
        <ul class="podium-list">
          ${st.lastRound.map((r, i) => `
            <li style="animation-delay:${i * 0.1}s">
              <span class="place">${medals[r.place - 1] || r.place + "e"}</span>
              ${api.avatar(playerOf(r.id))}
              <span class="name">${esc(pseudoOf(r.id))}</span>
              ${r.kills ? `<span class="ne-kills">💀×${r.kills}</span>` : ""}
              <span class="gain">+${r.points}</span>
              <span class="muted">(${playerOf(r.id)?.score ?? 0})</span>
            </li>`).join("")}
        </ul>
        ${overButtons(host)}
      </div>`;
    ov.classList.remove("hidden");
    if (host) {
      $("ne-next") && ($("ne-next").onclick = () => api.action("start").then((r) => { if (r.error) $("ne-over-error").textContent = r.error; }));
      $("ne-to-setup") && ($("ne-to-setup").onclick = () => api.action("setup"));
      $("ne-finish").onclick = st.final ? () => api.action("finish") : finishGame;
    }
  }

  function overButtons(host) {
    if (st.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      return `<p class="go-final">🏁 C'était la dernière manche ! Classement dans <b id="ne-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? `<div class="go-actions"><button id="ne-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`;
    }
    if (!host) return `<p class="muted">En attente de l'hôte…</p>`;
    return `<div class="go-actions">
        <button id="ne-next" class="btn btn-primary">▶ Manche suivante (${st.roundNum + 1}/${st.rounds})</button>
        ${st.playlist ? "" : '<button id="ne-to-setup" class="btn btn-secondary">Réglages</button>'}
        <button id="ne-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
      </div>
      <p id="ne-over-error" class="error-msg"></p>`;
  }

  // ===================================================================
  //  DÉCOR (une fois par map) : sol sombre quadrillé, obstacles néon
  // ===================================================================
  function newMap() {
    const m = st.map;
    mapId = m.id;
    canvas.width = m.w; canvas.height = m.h;
    bg = document.createElement("canvas");
    bg.width = m.w; bg.height = m.h;
    const c = bg.getContext("2d");
    const gr = c.createRadialGradient(m.w / 2, m.h / 2, 50, m.w / 2, m.h / 2, m.w * 0.7);
    gr.addColorStop(0, "#101a33"); gr.addColorStop(1, "#05070f");
    c.fillStyle = gr; c.fillRect(0, 0, m.w, m.h);
    c.strokeStyle = "rgba(80,140,255,0.10)"; c.lineWidth = 1;
    for (let x = 0; x <= m.w; x += 40) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, m.h); c.stroke(); }
    for (let y = 0; y <= m.h; y += 40) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(m.w, y + 0.5); c.stroke(); }
    for (const o of m.obstacles) {
      c.fillStyle = "#121a2e"; c.fillRect(o.x, o.y, o.w, o.h);
      c.strokeStyle = "rgba(255,80,200,0.35)"; c.lineWidth = 8; c.strokeRect(o.x, o.y, o.w, o.h);
      c.strokeStyle = "#ff6ad5"; c.lineWidth = 2; c.strokeRect(o.x, o.y, o.w, o.h);
    }
    c.strokeStyle = "rgba(90,200,255,0.4)"; c.lineWidth = 10; c.strokeRect(0, 0, m.w, m.h);
    c.strokeStyle = "#5ac8ff"; c.lineWidth = 3; c.strokeRect(1.5, 1.5, m.w - 3, m.h - 3);
  }

  // ===================================================================
  //  BOUCLE D'AFFICHAGE
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("ne-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.82, dt * 60);
    off.x *= decay; off.y *= decay; off.a *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; o.a *= decay; }
    draw(ts, dt);
  }

  function draw(ts, dt) {
    const c = g2d;
    c.save();
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); }
    else shake = 0;
    c.drawImage(bg, 0, 0);

    // Positions affichées.
    const view = [];
    for (const m of st.motos) {
      let v;
      if (m.id === me() && pred) {
        const o = ownView();
        v = { ...o, id: m.id, alive: true, x: o.x + off.x, y: o.y + off.y, a: o.a + off.a };
      } else v = shownMoto(m);
      view.push(v);
    }

    drawZone();

    // Murs de lumière : un halo large et transparent, puis un trait fin et vif.
    const limit = serverNow() - st.wallMs;
    for (const [id, tr] of Object.entries(trails)) {
      const v = view.find((x) => x.id === id);
      const path = new Path2D();
      let open = false;
      for (let i = 0; i < tr.length; i += 4) {
        if (tr[i + 2] < limit) { open = false; continue; }
        if (!open || tr[i + 3]) path.moveTo(tr[i], tr[i + 1]); else path.lineTo(tr[i], tr[i + 1]);
        open = true;
      }
      // Le bout du mur jusqu'à la moto (si elle roule au sol).
      if (open && v?.alive && !(v.jump > 0)) { const t = N.tail(v); path.lineTo(t.x, t.y); }
      const col = colorOf(id);
      c.lineJoin = c.lineCap = "round";
      c.globalAlpha = 0.25; c.strokeStyle = col; c.lineWidth = 10; c.stroke(path);
      c.globalAlpha = 1; c.lineWidth = 4; c.stroke(path);
      c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 1.2; c.stroke(path);
    }

    // Motos (en l'air : plus grosses, avec une ombre décalée).
    for (const v of view) {
      if (!v.alive) continue;
      const air = v.jump > 0 ? Math.sin((1 - v.jump / N.JUMP) * Math.PI) : 0;
      c.save();
      c.translate(v.x, v.y);
      if (air) {
        c.save(); c.translate(6 + air * 10, 8 + air * 12); c.rotate(v.a); c.fillStyle = "rgba(0,0,0,0.45)";
        c.fillRect(-17, -6, 34, 12); c.restore();
      }
      c.rotate(v.a);
      const sc = 1.15 + air * 0.4;
      c.scale(sc, sc);
      window.VehicleArt.paint(c, "moto", colorOf(v.id), null, v.st || 0, v.id === me(), false, !air);
      c.restore();
      // Nom au-dessus.
      c.font = "bold 13px Segoe UI, sans-serif";
      c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.7)";
      c.strokeText(pseudoOf(v.id), v.x, v.y - 28);
      c.fillStyle = v.id === me() ? "#fff" : "rgba(255,255,255,0.85)";
      c.fillText(pseudoOf(v.id), v.x, v.y - 28);
      if (v.id === me()) { c.fillStyle = "#fff"; c.beginPath(); c.moveTo(v.x - 6, v.y - 46); c.lineTo(v.x + 6, v.y - 46); c.lineTo(v.x, v.y - 39); c.fill(); }
    }

    drawParticles(dt);

    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      const m = st.map;
      c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, m.h / 2 - 80, m.w, 160);
      c.fillStyle = "#fff"; c.textAlign = "center"; c.textBaseline = "middle";
      c.font = "bold 72px Segoe UI, sans-serif";
      c.fillText(left > 0 ? left : "GO !", m.w / 2, m.h / 2 - 14);
      c.font = "22px Segoe UI, sans-serif";
      c.fillText("Ta moto démarre toute seule : prépare ton premier virage !", m.w / 2, m.h / 2 + 46);
    }
    c.restore();

    // Jauge du saut.
    const mine = pred || st.motos.find((x) => x.id === me());
    const bar = document.querySelector("#ne-jump i");
    if (bar && mine) {
      const ready = 1 - (mine.jumpCd || 0) / N.JUMP_CD;
      bar.style.width = Math.round(ready * 100) + "%";
      bar.parentElement.classList.toggle("on", ready >= 1);
    }
  }

  // La zone qui rétrécit : tout ce qui est dehors est rouge.
  function drawZone() {
    const z = st.zone, m = st.map;
    if (!z || (z.x0 <= 0 && z.y0 <= 0)) return;
    const c = g2d;
    c.fillStyle = "rgba(255,40,60,0.18)";
    c.fillRect(0, 0, m.w, z.y0); c.fillRect(0, z.y1, m.w, m.h - z.y1);
    c.fillRect(0, z.y0, z.x0, z.y1 - z.y0); c.fillRect(z.x1, z.y0, m.w - z.x1, z.y1 - z.y0);
    c.strokeStyle = "#ff4060"; c.lineWidth = 3; c.setLineDash([14, 10]);
    c.strokeRect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0);
    c.setLineDash([]);
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    const c = g2d;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.93; p.vy *= 0.93;
      const f = p.life / p.max;
      c.globalAlpha = f;
      c.fillStyle = p.col;
      if (p.flash) { c.beginPath(); c.arc(p.x, p.y, 30 + (1 - f) * 120, 0, Math.PI * 2); c.globalAlpha = f * 0.5; c.fill(); }
      else { c.fillRect(p.x - 2, p.y - 2, 4, 4); }
    }
    c.globalAlpha = 1;
  }
})();
