// ===================================================================
//  SOL QUI S'EFFONDRE — Client (s'affiche dans le hub Le Bordel)
//  - MON bonhomme est calculé ici tout de suite (prédiction, comme les
//    voitures), puis recalé sur le serveur.
//  - Les autres sont affichés "au présent" (avancés selon leur vitesse).
// ===================================================================

(() => {
  const H = window.Pieton;
  const K = H.K;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  let particles = [];
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0;
  const falling = {};             // tombés : on garde leur dernière position pour l'animation
  const ENV = { walls: false, speedMul: 0.85, push: true };   // (le même que games/sol/server.js)

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";

  const TEMPLATE = `
    <div id="so-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🌋</span>
        <h1>SOL QUI S'EFFONDRE</h1>
        <p class="tagline">Ne t'arrête jamais. Le sol, lui, ne t'attendra pas.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="so-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> / flèches pour courir · <kbd>Espace</kbd> <b>pousser</b> (ceux qui sont juste devant toi)</li>
            <li>🟫 Les dalles où tu passes <b>se fissurent</b>, puis <b>tombent</b> (au 2e passage, ou dès le 1er en « fragiles »). Rester planté les fait tomber aussi.</li>
            <li>💥 Mets-toi face à quelqu'un et appuie sur Espace : il est <b>repoussé</b>. Envoie-le dans le vide !</li>
            <li>🟨 Dalle dorée : tu deviens <b>lourd 5 s</b> (impossible à pousser, tes coups sont plus forts).</li>
            <li>🏆 1 point par joueur tombé avant toi. Le dernier debout gagne la manche.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="so-start" class="btn btn-primary btn-big">C'est parti !</button>
        <p id="so-hint" class="muted"></p>
        <p id="so-error" class="error-msg"></p>
        <button id="so-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="so-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="so-round"></span>
        <span id="so-alive" class="ch-role"></span>
        <div id="so-dash" class="pt-nitro" title="Pousser (Espace)"><span>POUSSÉE</span><div class="bar"><i></i></div></div>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="so-canvas"></canvas>
        <ul id="so-feed" class="so-feed"></ul>
        <div id="so-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches = courir · Espace = pousser</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.sol = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = [];
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("so-canvas");
      g2d = canvas.getContext("2d");
      $("so-start").onclick = () => {
        $("so-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("so-error").textContent = r.error; });
      };
      $("so-finish-setup").onclick = () => api.action("finish");
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
      if (st.phase === "setup") {
        $("so-play").classList.add("hidden");
        $("so-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("so-setup").classList.add("hidden");
      $("so-play").classList.remove("hidden");
      if (st.arena) {
        const w = st.arena.cols * st.arena.tile, h = st.arena.rows * st.arena.tile;
        if (canvas.width !== w) { canvas.width = w; canvas.height = h; }
      }
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
    Space: K.DASH, ShiftLeft: K.DASH, ShiftRight: K.DASH,
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
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  function ownView() {
    if (!prevPred) return pred;
    const f = Math.min(1, acc / H.TICK);
    return { ...pred, x: prevPred.x + (pred.x - prevPred.x) * f, y: prevPred.y + (pred.y - prevPred.y) * f };
  }
  const same = (a, b) => Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05 && Math.abs(a.vx - b.vx) < 0.05 && Math.abs(a.vy - b.vy) < 0.05;
  function reconcile() {
    const sc = heroOf(me());
    if (!sc || !driving() || !sc.alive || sc.falling) { pred = prevPred = null; pending = []; history.clear(); return; }
    pending = pending.filter((p) => p.s > sc.seq);
    for (const s of history.keys()) if (s < sc.seq) history.delete(s);
    const mine = history.get(sc.seq);
    if (pred && mine && same(mine, sc)) return;
    const before = pred && ownView();
    const oldPred = pred;
    pred = H.copy(sc);
    pending.forEach((p, i) => { H.simulate(pred, p.k, null, ENV, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
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
    while (acc >= H.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, k, null, ENV, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me() && h.alive && !h.falling).map((h) => H.extrapolate(h, t));
  }
  const aheadNow = () => pred ? Math.min(MAX_AHEAD, Math.max(0, (pending.length - 1 + acc / H.TICK) * H.TICK))
                              : Math.min(0.1, (performance.now() - lastSnapRecv) / 1000);
  function shownHero(h) {
    const base = driving() && !h.falling ? H.extrapolate(h, aheadNow()) : h;
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
      const base = driving() && !h.falling ? H.extrapolate(h, t) : h;
      if (prev && Math.hypot(prev.x - base.x, prev.y - base.y) < 100) othersOff[h.id] = { x: prev.x - base.x, y: prev.y - base.y };
      else othersOff[h.id] = { x: 0, y: 0 };
    }
  }

  // ===================================================================
  //  EFFETS : coups de dash, dalle dorée
  // ===================================================================
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const n = f.kind === "gold" ? 40 : 18;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 260;
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, col: f.kind === "gold" ? "#ffd84a" : i % 2 ? "#fff" : "#ffb347" });
      }
      shake = f.kind === "gold" ? 4 : 7;
    }
    if (seenFx.size > 300) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("so-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label>${chips("rounds", [[3, "3"], [5, "5"], [8, "8"]])}</div>
      <div class="setting-block"><label>Les dalles</label>${chips("floor", [["solides", "🧱 Solides (tombent au 2e passage)"], ["fragiles", "💨 Fragiles (tombent dès le 1er)"]])}</div>
      <p class="settings-note">Une nouvelle arène à chaque manche (carré, rond, croix, anneau, îlots, gruyère).</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      const v = b.dataset.v;
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: isNaN(Number(v)) ? v : Number(v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    $("so-start").style.display = host ? "" : "none";
    $("so-start").disabled = n < 2;
    $("so-finish-setup").classList.toggle("hidden", !host);
    $("so-hint").textContent = !host ? "En attente que l'hôte lance la partie…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} joueurs sur l'arène`;
  }

  // ===================================================================
  //  BANDEAU + FIN DE MANCHE
  // ===================================================================
  function renderHud() {
    $("so-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const alive = st.heroes.filter((h) => h.alive).length;
    const mine = heroOf(me());
    const txt = !mine ? "👀 Tu regardes" : !mine.alive ? `🕳️ Tombé ! (${alive} encore debout)` : `🧍 ${alive} encore debout`;
    if ($("so-alive").textContent !== txt) $("so-alive").textContent = txt;
    const feed = (st.feed || []).map((f) => `<li>${esc(f.text)}</li>`).join("");
    if ($("so-feed").innerHTML !== feed) $("so-feed").innerHTML = feed;
    $("so-dash").classList.toggle("hidden", !mine || !mine.alive || st.phase !== "play");
  }

  function renderOver() {
    const ov = $("so-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = lr.winner ? `🏆 ${esc(pseudoOf(lr.winner))} reste debout !` : "🕳️ Tout le monde est tombé !";
    const rows = lr.order.map((id, i) => `<li>${api.avatar(playerOf(id))}<b>${i + 1}. ${esc(pseudoOf(id))}</b><span class="muted">${i === 0 ? "dernier debout" : "tombé"}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="so-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="so-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="so-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="so-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="so-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="so-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="so-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="so-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="so-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("so-next") && ($("so-next").onclick = () => api.action("next"));
    $("so-again") && ($("so-again").onclick = () => api.action("start").then((r) => { if (r.error) $("so-over-error").textContent = r.error; }));
    $("so-to-setup") && ($("so-to-setup").onclick = () => api.action("setup"));
    $("so-finish") && ($("so-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Sol qui s'effondre ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    const fin = document.getElementById("so-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const nx = document.getElementById("so-next-sec");
    if (nx) nx.textContent = Math.max(0, Math.ceil((phaseEndLocal - Date.now()) / 1000));
    if (!st || st.phase === "setup" || !st.arena) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    draw(ts, dt);
  }

  function draw(ts, dt) {
    const c = g2d, A = st.arena, T = A.tile;
    c.save();
    // Le vide : un dégradé sombre avec des braises.
    const gr = c.createRadialGradient(canvas.width / 2, canvas.height / 2, 50, canvas.width / 2, canvas.height / 2, canvas.width * 0.7);
    gr.addColorStop(0, "#3a1208"); gr.addColorStop(1, "#0b0303");
    c.fillStyle = gr; c.fillRect(0, 0, canvas.width, canvas.height);
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    // Les dalles.
    for (let i = 0; i < A.tiles.length; i++) {
      const ch = A.tiles[i];
      if (ch === "0") continue;
      const col = i % A.cols, row = (i / A.cols) | 0;
      let x = col * T, y = row * T;
      const stage = ch >= "2" && ch <= "9" ? Number(ch) - 1 : 0;   // 1 à 8 : elle va tomber
      if (stage) { x += (Math.random() - 0.5) * stage * 0.5; y += (Math.random() - 0.5) * stage * 0.5; }   // elle tremble
      const gold = i === A.gold;
      // Ombre / épaisseur de la dalle.
      c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(x + 2, y + 5, T - 2, T - 2);
      c.fillStyle = gold ? (Math.floor(ts / 200) % 2 ? "#ffd84a" : "#f1b81c") : stage ? `rgb(${120 - stage * 6},${96 - stage * 7},${84 - stage * 6})` : (col + row) % 2 ? "#8a7a6c" : "#7d6e61";
      c.fillRect(x + 1, y + 1, T - 3, T - 3);
      c.fillStyle = "rgba(255,255,255,0.08)"; c.fillRect(x + 1, y + 1, T - 3, 4);
      // Fissures : légère (« a », elle tient encore) ou grosse (elle va tomber).
      if (ch === "a" || stage) {
        c.strokeStyle = stage ? "rgba(20,8,4,0.85)" : "rgba(30,20,12,0.6)"; c.lineWidth = stage ? 2.5 : 1.6;
        c.beginPath();
        c.moveTo(x + T * 0.2, y + T * 0.15); c.lineTo(x + T * 0.45, y + T * 0.5); c.lineTo(x + T * 0.3, y + T * 0.85);
        c.moveTo(x + T * 0.45, y + T * 0.5); c.lineTo(x + T * 0.85, y + T * 0.4);
        if (stage) { c.moveTo(x + T * 0.6, y + T * 0.45); c.lineTo(x + T * 0.75, y + T * 0.9); c.moveTo(x + T * 0.1, y + T * 0.6); c.lineTo(x + T * 0.4, y + T * 0.55); }
        c.stroke();
      }
      if (gold) { c.fillStyle = "#7a5200"; c.font = "bold 18px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("★", x + T / 2, y + T / 2); }
    }
    // Les bonshommes.
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred && !h.falling) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y }; }
      return { ...shownHero(h), alive: h.alive, falling: h.falling };
    });
    for (const v of views) {
      if (!v.alive && !v.falling) continue;
      const fall = v.falling || 0;
      window.HeroArt.paint(c, { ...v, face: v.face + fall * 6 }, playerOf(v.id)?.color || "#fff", {
        id: v.id, isMe: v.id === me(), heavy: v.heavy > 0, scale: 1 - fall * 0.85, alpha: 1 - fall * 0.6,
      });
      if (!fall) {
        c.font = "bold 13px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.lineWidth = 3; c.strokeStyle = "rgba(0,0,0,0.75)"; c.strokeText(pseudoOf(v.id), v.x, v.y - 28);
        c.fillStyle = "#fff"; c.fillText(pseudoOf(v.id), v.x, v.y - 28);
      }
    }
    drawParticles(dt);
    const mv = views.find((v) => v.id === me() && v.alive && !v.falling);
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, playerOf(me())?.color || "#fff",
      window.VehicleArt.markAlpha(st.phase === "countdown" ? "countdown" : st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)));
    c.restore();
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      band(left > 0 ? String(left) : "GO !", "Ne t'arrête jamais : le sol tombe derrière toi !");
    }
    // Jauge de dash.
    const mine = pred || heroOf(me());
    const bar = document.querySelector("#so-dash i");
    if (bar && mine) { bar.style.width = Math.round((1 - Math.min(1, (mine.dash || 0) / H.PUSH_CD)) * 100) + "%"; bar.parentElement.classList.toggle("on", (mine.dash || 0) <= 0); }
  }

  function band(big, small) {
    const c = g2d;
    c.fillStyle = "rgba(0,0,0,0.5)"; c.fillRect(0, canvas.height / 2 - 75, canvas.width, 150);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "bold 64px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(big, canvas.width / 2, canvas.height / 2 - 14);
    c.font = "22px Segoe UI, sans-serif"; c.fillText(small, canvas.width / 2, canvas.height / 2 + 42);
  }

  function drawParticles(dt) {
    particles = particles.filter((p) => (p.life -= dt) > 0);
    const c = g2d;
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
      c.globalAlpha = p.life / p.max; c.fillStyle = p.col; c.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    c.globalAlpha = 1;
  }
})();
