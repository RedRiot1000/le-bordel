// ===================================================================
//  CAMBRIOLEURS — Client (s'affiche dans le hub Le Bordel)
//  - Le manoir est refait ici à partir de sa seed (manor.js).
//  - MON bonhomme est calculé ici tout de suite (prédiction), puis recalé.
//  - Tout est éclairé : pas de noir. Caméra qui suit, classement, flèche vers le van.
// ===================================================================

(() => {
  const H = window.Pieton;
  const M = window.Manoir;
  const C = window.Casse;
  const K = H.K;
  const W = 1280, HGT = 800;
  const Z = 1.15;

  let api = null, root = null;
  let st = null;
  let phaseEndLocal = 0, finishEndLocal = 0, timeEndLocal = 0;
  let rafId = null, lastTs = 0;
  let canvas = null, g2d = null;
  let manor = null, manorKey = null, bg = null;

  let pred = null, prevPred = null;
  let pending = [];
  const history = new Map();
  let seq = 0, acc = 0;
  const off = { x: 0, y: 0 };
  const pressed = new Set();
  let particles = [], floats = [];
  const seenFx = new Set();
  let shake = 0, prevPhase = null, playSeenAt = 0;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const colorOf = (id) => playerOf(id)?.color || "#fff";
  const heroOf = (id) => st?.heroes.find((h) => h.id === id);
  const driving = () => st?.phase === "play";
  const mmss = (ms) => { const s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const money = (v) => v.toLocaleString("fr-FR") + " $";

  const TEMPLATE = `
    <div id="ca-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">💰</span>
        <h1>CAMBRIOLEURS</h1>
        <p class="tagline">Un manoir à piller, un van sur le parking. Le plus riche gagne.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="ca-settings" class="settings"></div></div>
        <div class="card">
          <h2>🎮 Règles & commandes</h2>
          <ul class="pt-help">
            <li>🏃 <kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> ou <kbd>ZQSD</kbd> : marcher. On ramasse un objet en passant dessus.</li>
            <li>🚐 Ramène-le au <b>van</b>, sur le parking, pour encaisser (plusieurs sorties y mènent). Un seul objet à la fois : <b>plus il vaut cher, plus tu es lent</b>.</li>
            <li>🥄 100 $ · 🏺 300 $ · 🖼️ 600 $ · 💎 coffre-fort 1 500 $ (annoncé à tout le monde).</li>
            <li>👊 <kbd>Espace</kbd> : <b>pousser</b>, seulement dans le manoir. Celui que tu touches <b>lâche son objet</b>. Sur le parking, tu es à l'abri.</li>
            <li>👮 Les <b>gardiens</b> ne s'occupent que de ceux qui portent un objet : ils te le reprennent, tu es sonné 1 s, et ils vont le ranger dans une autre pièce.</li>
            <li>🌀 Les <b>passages secrets</b> (portails de couleur) t'emmènent à l'autre bout du manoir, 🪜 les <b>escaliers</b> vont à la cave : marche vers le mur pour y entrer.</li>
            <li>🚨 Les 30 dernières secondes : l'<b>alarme</b> sonne, tout ce que tu déposes vaut <b>double</b> !</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="ca-start" class="btn btn-primary btn-big">💰 Lancer le casse</button>
        <p id="ca-hint" class="muted"></p>
        <p id="ca-error" class="error-msg"></p>
        <button id="ca-finish-setup" class="btn btn-ghost hidden">Retour au menu</button>
      </div>
    </div>

    <div id="ca-play" class="hidden">
      <div class="ch-hud">
        <span class="pill" id="ca-round"></span>
        <span id="ca-me" class="ch-role"></span>
        <span id="ca-clock" class="pill"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="ca-canvas" width="${W}" height="${HGT}"></canvas>
        <div id="ca-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">↑↓←→ / ZQSD = marcher · Espace = pousser (fait lâcher l'objet) · ramasse et dépose en passant dessus</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.casse = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; pred = prevPred = null; pending = []; particles = []; floats = []; manorKey = null;
      seenFx.clear(); pressed.clear();
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-forest");
      document.querySelector(".app").classList.add("pt-wide");
      canvas = $("ca-canvas");
      g2d = canvas.getContext("2d");
      $("ca-start").onclick = () => {
        $("ca-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("ca-error").textContent = r.error; });
      };
      $("ca-finish-setup").onclick = () => api.action("finish");
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", () => pressed.clear());
      lastTs = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      st = state;
      if (st.phase === "play" && prevPhase !== "play") playSeenAt = performance.now();
      if (st.phase === "countdown" && prevPhase !== "countdown") { pending = []; pred = prevPred = null; history.clear(); floats = []; }
      prevPhase = st.phase;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);
      timeEndLocal = Date.now() + (st.timeLeft || 0);
      if (st.phase === "setup") {
        $("ca-play").classList.add("hidden");
        $("ca-setup").classList.remove("hidden");
        renderSettings();
        return;
      }
      $("ca-setup").classList.add("hidden");
      $("ca-play").classList.remove("hidden");
      if (st.manor && st.manor.seed + ":" + st.manor.n !== manorKey) newManor();
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
      bg = manor = null;
    },
  };

  function newManor() {
    manorKey = st.manor.seed + ":" + st.manor.n;
    manor = M.build(st.manor.seed, st.manor.n, { small: true });
    // Le décor du manoir, éclairé (il a été peint pour la nuit).
    const night = window.ManoirArt.paint(manor, st.manor.seed);
    bg = document.createElement("canvas");
    bg.width = night.width; bg.height = night.height;
    const c = bg.getContext("2d");
    c.filter = "brightness(1.75) saturate(1.2)";
    c.drawImage(night, 0, 0);
    c.filter = "none";
  }

  // ===================================================================
  //  CLAVIER
  // ===================================================================
  const KEYMAP = {
    KeyW: K.UP, KeyZ: K.UP, ArrowUp: K.UP, KeyS: K.DOWN, ArrowDown: K.DOWN,
    KeyA: K.LEFT, KeyQ: K.LEFT, ArrowLeft: K.LEFT, KeyD: K.RIGHT, ArrowRight: K.RIGHT, Space: K.DASH,
  };
  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup" || !(e.code in KEYMAP)) return;
    e.preventDefault();
    if (e.type === "keydown") pressed.add(e.code); else pressed.delete(e.code);
  }
  function keyMask() { let k = 0; for (const code of pressed) k |= KEYMAP[code]; return k; }

  // ===================================================================
  //  PRÉDICTION DE MON BONHOMME
  // ===================================================================
  const envFor = (sc) => ({ walls: true, w: manor.w, h: manor.h, rects: manor.rects, push: M.zoneOf(manor, sc.x, sc.y) !== "jardin", noDash: true, speedMul: C.speedOf(sc.carry) });
  const moveBits = (k, sc) => (sc.frozen ? 0 : k & (K.UP | K.DOWN | K.LEFT | K.RIGHT | K.DASH));
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
    pending.forEach((p, i) => { H.simulate(pred, moveBits(p.k, sc), null, E, othersAt((i + 1) * H.TICK)); history.set(p.s, H.copy(pred)); });
    if (prevPred && oldPred) { prevPred.x += pred.x - oldPred.x; prevPred.y += pred.y - oldPred.y; }
    if (before) {
      const after = ownView();
      const dx = before.x - after.x, dy = before.y - after.y;
      if (Math.hypot(dx, dy) < 120) { off.x += dx; off.y += dy; } else { off.x = 0; off.y = 0; prevPred = null; }
    }
  }
  function driveLocal(dt) {
    const sc = heroOf(me());
    if (!sc || !driving() || !manor) { acc = 0; return; }
    if (!pred) pred = H.copy(sc);
    acc = Math.min(acc + dt, 0.2);
    const E = envFor(sc);
    while (acc >= H.TICK) {
      const k = keyMask();
      seq++;
      api.send("in", { s: seq, k });
      pending.push({ s: seq, k });
      if (pending.length > 90) pending.shift();
      prevPred = H.copy(pred);
      H.simulate(pred, moveBits(k, sc), null, E, othersAt(pending.length * H.TICK));
      history.set(seq, H.copy(pred));
      acc -= H.TICK;
    }
  }

  const MAX_AHEAD = 0.3;
  const othersOff = {}, lastShown = {};
  let lastSnapRecv = 0;
  function othersAt(t) {
    t = Math.min(MAX_AHEAD, Math.max(0, t));
    return st.heroes.filter((h) => h.id !== me()).map((h) => H.extrapolate(h, t));
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
  const FX_COL = { push: ["#fff", "#cfd8e6"], drop: ["#ffd23f", "#fff"], pick: ["#7dffb0", "#fff"], caught: ["#3bb8ff", "#fff"], tp: ["#b48cff", "#fff"], cash: ["#7dffb0", "#ffd23f"] };
  function handleFx() {
    for (const f of st.fx || []) {
      if (seenFx.has(f.id)) continue;
      seenFx.add(f.id);
      const cols = FX_COL[f.kind] || ["#fff", "#ccc"];
      for (let i = 0; i < (f.kind === "cash" ? 20 : 12); i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 220;
        particles.push({ x: f.x, y: f.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.3 + Math.random() * 0.4, max: 0.7, r: 3, col: cols[i % 2] });
      }
      if (f.kind === "cash") floats.push({ x: f.x, y: f.y, text: "+" + money(f.v), life: 1.4 });
      if (f.kind === "caught") shake = 8;
    }
    if (seenFx.size > 300) seenFx.clear();
  }

  // ===================================================================
  //  RÉGLAGES, BANDEAU, FIN DE MANCHE
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("ca-settings");
    panel.className = "settings" + (host ? "" : " locked");
    panel.innerHTML = `
      <div class="setting-block"><label>Manches</label><div class="cat-chips">${[3, 5].map((v) =>
        `<button class="cat-chip ${s.rounds === v ? "on" : ""}" data-v="${v}" ${host ? "" : "disabled"}>${v}</button>`).join("")}</div></div>
      <p class="settings-note">Une manche dure 2 min 30, un nouveau manoir à chaque fois.</p>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-v]").forEach((b) => { b.onclick = () => api.action("settings", { settings: { rounds: Number(b.dataset.v) } }); });
    const n = st.players.filter((p) => p.connected).length;
    $("ca-start").style.display = host ? "" : "none";
    $("ca-start").disabled = n < 2;
    $("ca-finish-setup").classList.toggle("hidden", !host);
    $("ca-hint").textContent = !host ? "En attente que l'hôte lance le casse…" : n < 2 ? "Il faut au moins 2 joueurs." : `${n} cambrioleurs`;
  }

  function renderHud() {
    $("ca-round").textContent = `Manche ${st.round}/${st.settings.rounds}`;
    const mine = heroOf(me());
    const txt = !mine ? "👀 Tu regardes" : mine.frozen ? "👮 Attrapé !" : mine.carry ? `${C.LOOT[mine.carry].emoji} Ramène-le au van !` : "🏃 Trouve du butin !";
    if ($("ca-me").textContent !== txt) $("ca-me").textContent = txt;
  }

  function renderOver() {
    const ov = $("ca-overlay");
    const show = (st.phase === "roundOver" || st.phase === "over") && st.lastRound;
    ov.parentElement.classList.toggle("over", !!show);
    if (!show) { ov.classList.add("hidden"); ov.dataset.key = ""; return; }
    const host = api.isHost();
    const lr = st.lastRound;
    const key = JSON.stringify([st.phase, st.round, host, st.playlist?.final]);
    if (ov.dataset.key === key) return;
    ov.dataset.key = key;
    const banner = `🏆 ${esc(pseudoOf(lr.order[0]))} a le plus gros butin !`;
    const rows = lr.order.filter((id) => playerOf(id)).map((id, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>
      <span class="muted">${money(lr.money[id])}</span><span class="gain">+${lr.gains[id] || 0}</span></li>`).join("");
    const total = st.phase === "over" ? `<h3 class="ch-total">🏆 Classement</h3><ol class="s10-rank">${[...st.players].sort((a, b) => b.score - a.score)
      .map((p, i) => `<li><span class="s10-medal">${["🥇", "🥈", "🥉"][i] || i + 1 + "."}</span>${api.avatar(p)}<b>${esc(p.pseudo)}</b><span class="gain">${p.score} pts</span></li>`).join("")}</ol>` : "";
    let buttons;
    if (st.phase === "roundOver") {
      buttons = st.playlist ? `<p class="muted">Manche suivante dans <b id="ca-next-sec"></b> s…</p>`
        : host ? `<div class="go-actions"><button id="ca-next" class="btn btn-primary">Manche suivante ▶</button>
            <button id="ca-finish" class="btn btn-secondary">🏁 Terminer le jeu</button></div>` : '<p class="muted">En attente de l\'hôte…</p>';
    } else if (st.playlist?.final) {
      finishEndLocal = Date.now() + st.finishLeft;
      buttons = `<p class="go-final">Classement dans <b id="ca-fin-sec">${Math.ceil(st.finishLeft / 1000)}</b> s</p>
        ${host ? '<div class="go-actions"><button id="ca-finish" class="btn btn-primary">Voir le classement maintenant</button></div>' : ""}`;
    } else {
      buttons = host ? `<div class="go-actions">
          <button id="ca-again" class="btn btn-primary">🔁 Rejouer</button>
          <button id="ca-to-setup" class="btn btn-secondary">Réglages</button>
          <button id="ca-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
        </div><p id="ca-over-error" class="error-msg"></p>` : '<p class="muted">En attente de l\'hôte…</p>';
    }
    ov.innerHTML = `<div class="pt-over card ch-over"><h2 class="go-banner">${banner}</h2><ul class="ch-rows">${rows}</ul>${total}${buttons}</div>`;
    ov.classList.remove("hidden");
    if (!host) return;
    $("ca-next") && ($("ca-next").onclick = () => api.action("next"));
    $("ca-again") && ($("ca-again").onclick = () => api.action("start").then((r) => { if (r.error) $("ca-over-error").textContent = r.error; }));
    $("ca-to-setup") && ($("ca-to-setup").onclick = () => api.action("setup"));
    $("ca-finish") && ($("ca-finish").onclick = () => {
      if (st.playlist?.final || confirm("Terminer Cambrioleurs ? Le classement actuel donne les points de soirée.")) api.action("finish");
    });
  }

  // ===================================================================
  //  DESSIN
  // ===================================================================
  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;
    for (const [id, end] of [["ca-fin-sec", finishEndLocal], ["ca-next-sec", phaseEndLocal]]) {
      const el = $(id); if (el) el.textContent = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    }
    if (!st || st.phase === "setup" || !bg) return;
    driveLocal(dt);
    const decay = Math.pow(0.8, dt * 60);
    off.x *= decay; off.y *= decay;
    for (const o of Object.values(othersOff)) { o.x *= decay; o.y *= decay; }
    const clock = $("ca-clock");
    if (clock) {
      const left = st.phase === "play" ? Math.max(0, timeEndLocal - Date.now()) : st.timeLeft;
      clock.textContent = (st.alarm ? "🚨 " : "⏱️ ") + mmss(left);
    }
    draw(ts, dt);
  }

  function van(c, v, ts) {
    c.save();
    c.translate(v.x, v.y);
    // La zone de dépôt.
    c.strokeStyle = "#ffd23f"; c.lineWidth = 5; c.setLineDash([14, 10]); c.lineDashOffset = -ts / 40;
    c.beginPath(); c.arc(0, 0, 92, 0, Math.PI * 2); c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(0,0,0,0.35)"; c.fillRect(-54, -22, 114, 58);
    c.fillStyle = "#111"; for (const [x, y] of [[-40, -34], [30, -34], [-40, 28], [30, 28]]) c.fillRect(x, y, 20, 7);
    c.fillStyle = "#f2f2f2"; c.fillRect(-58, -29, 116, 58);
    c.fillStyle = "#2b2d34"; c.fillRect(-58, -7, 116, 14);
    c.fillStyle = "#26303d"; c.fillRect(30, -24, 22, 48);
    c.strokeStyle = "#1b1830"; c.lineWidth = 3; c.strokeRect(-58, -29, 116, 58);
    c.font = "bold 22px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#ffd23f"; c.fillText("💰", -14, 0);
    c.restore();
  }

  // Les passages : un portail animé qui saute aux yeux. Les 2 bouts d'un même passage ont la même couleur.
  const PORTAL_COL = ["#c44dff", "#ff4dc4", "#3bd6ff", "#7dff5c", "#ffb020"];
  function drawPortals(c, ts, mv) {
    manor.portals.forEach((p, i) => {
      const stairs = p.kind === "stairs";
      const col = stairs ? "#ffd23f" : PORTAL_COL[i % PORTAL_COL.length];
      for (const e of [p.a, p.b]) {
        const nx = (e.ex - e.x) / 46, ny = (e.ey - e.y) / 46;     // sens : du mur vers la pièce
        const pulse = 0.5 + 0.5 * Math.sin(ts / 220 + i);
        // Halo + anneaux qui tournent.
        c.save();
        c.translate(e.x, e.y);
        const gr = c.createRadialGradient(0, 0, 4, 0, 0, 52);
        gr.addColorStop(0, col); gr.addColorStop(1, "rgba(0,0,0,0)");
        c.globalAlpha = 0.45 + 0.3 * pulse; c.fillStyle = gr; c.beginPath(); c.arc(0, 0, 52, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
        c.rotate(ts / 500);
        c.strokeStyle = col; c.lineWidth = 5; c.setLineDash([16, 10]);
        c.beginPath(); c.arc(0, 0, 30, 0, Math.PI * 2); c.stroke();
        c.rotate(-ts / 250);
        c.strokeStyle = "#fff"; c.lineWidth = 3; c.setLineDash([8, 12]);
        c.beginPath(); c.arc(0, 0, 21, 0, Math.PI * 2); c.stroke();
        c.setLineDash([]);
        c.restore();
        c.font = "24px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#000";
        c.fillText(stairs ? "🪜" : "🌀", e.x, e.y + 1);
        // Une flèche qui montre où pousser : vers le mur.
        const bob = 5 * Math.sin(ts / 160), ax = e.x + nx * (58 + bob), ay = e.y + ny * (58 + bob), ang = Math.atan2(-ny, -nx);
        c.save(); c.translate(ax, ay); c.rotate(ang);
        c.fillStyle = col; c.strokeStyle = "#111"; c.lineWidth = 3;
        c.beginPath(); c.moveTo(16, 0); c.lineTo(-8, -13); c.lineTo(-3, 0); c.lineTo(-8, 13); c.closePath(); c.fill(); c.stroke();
        c.restore();
        // De près : ce que c'est, et quoi faire.
        if (mv && Math.hypot(mv.x - e.x, mv.y - e.y) < 190) {
          const t1 = stairs ? (e === p.a ? "🪜 ESCALIER vers la cave" : "🪜 ESCALIER vers le manoir") : "🌀 PASSAGE SECRET", t2 = "Marche vers le mur pour y entrer";
          c.font = "900 16px Segoe UI, sans-serif";
          const w = Math.max(c.measureText(t1).width, 220) + 22, ly = e.y + ny * 104;
          c.fillStyle = "rgba(10,10,20,0.85)"; c.beginPath(); c.roundRect(e.x - w / 2, ly - 25, w, 50, 9); c.fill();
          c.strokeStyle = col; c.lineWidth = 2; c.stroke();
          c.fillStyle = col; c.fillText(t1, e.x, ly - 10);
          c.font = "bold 13px Segoe UI, sans-serif"; c.fillStyle = "#fff"; c.fillText(t2, e.x, ly + 11);
        }
      }
    });
  }

  function drawLoot(c, l, ts) {
    const big = l.kind === "coffre";
    const y = l.y + Math.sin(ts / 260 + l.id) * 3;
    c.fillStyle = "rgba(0,0,0,0.3)"; c.beginPath(); c.ellipse(l.x, l.y + 15, big ? 22 : 14, 5, 0, 0, Math.PI * 2); c.fill();
    if (big) {
      c.strokeStyle = `rgba(100,220,255,${0.55 + 0.35 * Math.sin(ts / 160)})`; c.lineWidth = 5;
      c.beginPath(); c.arc(l.x, l.y, 34 + 6 * Math.sin(ts / 200), 0, Math.PI * 2); c.stroke();
    }
    c.fillStyle = "rgba(255,255,255,0.8)"; c.beginPath(); c.arc(l.x, y, big ? 24 : 18, 0, Math.PI * 2); c.fill();
    c.font = `${big ? 36 : 26}px sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#000";
    c.fillText(C.LOOT[l.kind].emoji, l.x, y + 1);
  }

  function draw(ts, dt) {
    const c = g2d;
    const views = st.heroes.map((h) => {
      if (h.id === me() && pred) { const o = ownView(); return { ...h, ...o, x: o.x + off.x, y: o.y + off.y }; }
      return { ...shownHero(h), carry: h.carry, frozen: h.frozen, safe: h.safe };
    });
    const mv = views.find((v) => v.id === me());
    const follow = mv || views[0];
    const vw = W / Z, vh = HGT / Z;
    const camX = manor.w <= vw ? (manor.w - vw) / 2 : Math.max(0, Math.min(manor.w - vw, (follow?.x || 0) - vw / 2));
    const camY = manor.h <= vh ? (manor.h - vh) / 2 : Math.max(0, Math.min(manor.h - vh, (follow?.y || 0) - vh / 2));

    c.save();
    c.fillStyle = "#3f7a3a"; c.fillRect(0, 0, W, HGT);
    if (shake > 0.3) { c.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake); shake *= Math.pow(0.85, dt * 60); } else shake = 0;
    c.scale(Z, Z);
    c.translate(-camX, -camY);
    c.drawImage(bg, 0, 0);
    drawPortals(c, ts, mv);
    if (st.van) van(c, st.van, ts);
    for (const l of st.loot || []) drawLoot(c, l, ts);
    // Les gardiens : uniforme bleu nuit, casquette, lampe rouge quand ils courent après quelqu'un.
    for (const q of st.guards || []) {
      window.HeroArt.paint(c, q, "#22304f", { id: "gardien" });
      c.fillStyle = "#101828"; c.beginPath(); c.arc(q.x, q.y, 9, 0, Math.PI * 2); c.fill();
      if (q.chase) {
        c.font = "bold 24px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
        c.lineWidth = 4; c.strokeStyle = "#000"; c.fillStyle = "#ff3b3b";
        c.strokeText("!", q.x, q.y - 32); c.fillText("!", q.x, q.y - 32);
      }
      if (q.carry) {
        c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.arc(q.x, q.y - 34, 16, 0, Math.PI * 2); c.fill();
        c.font = "20px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#000";
        c.fillText(C.LOOT[q.carry].emoji, q.x, q.y - 33);
      }
    }
    // Les joueurs.
    for (const v of views) {
      const isMe = v.id === me();
      if (v.safe && Math.floor(ts / 140) % 2) c.globalAlpha = 0.55;
      window.HeroArt.paint(c, v, colorOf(v.id), { id: v.id, isMe });
      c.globalAlpha = 1;
      if (v.carry) {
        c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.arc(v.x, v.y - 34, 17, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#ffd23f"; c.lineWidth = 3; c.stroke();
        c.font = "22px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#000";
        c.fillText(C.LOOT[v.carry].emoji, v.x, v.y - 33);
      }
      if (v.frozen) { c.fillStyle = "#ffd23f"; c.font = "14px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; for (let k = 0; k < 3; k++) { const a = ts / 220 + k * 2.1; c.fillText("★", v.x + Math.cos(a) * 22, v.y - 24 + Math.sin(a) * 6); } }
      const lab = pseudoOf(v.id), ly = v.y + 30;
      c.font = "bold 13px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      const lw = c.measureText(lab).width + 10;
      c.fillStyle = isMe ? "rgba(255,210,63,0.95)" : "rgba(0,0,0,0.6)";
      c.beginPath(); c.roundRect(v.x - lw / 2, ly - 9, lw, 18, 5); c.fill();
      c.fillStyle = isMe ? "#1b1830" : "#fff"; c.fillText(lab, v.x, ly + 1);
    }
    if (mv) window.VehicleArt.markMe(c, mv.x, mv.y, ts, colorOf(me()), window.VehicleArt.markAlpha(st.phase, playSeenAt), Math.max(1, canvas.width / (canvas.clientWidth || canvas.width)) / Z);
    // Étincelles et gains.
    particles = particles.filter((p) => (p.life -= dt) > 0);
    for (const p of particles) {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9;
      c.globalAlpha = p.life / p.max; c.fillStyle = p.col;
      c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    floats = floats.filter((f) => (f.life -= dt) > 0);
    for (const f of floats) {
      f.y -= 40 * dt;
      c.globalAlpha = Math.min(1, f.life);
      c.font = "900 26px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.lineWidth = 5; c.strokeStyle = "#0b3d20"; c.fillStyle = "#7dffb0";
      c.strokeText(f.text, f.x, f.y); c.fillText(f.text, f.x, f.y);
    }
    c.globalAlpha = 1;
    c.restore();

    drawHud(c, ts, mv, camX, camY);
  }

  function panel(c, x, y, w, h) { c.fillStyle = "rgba(12,16,24,0.76)"; c.beginPath(); c.roundRect(x, y, w, h, 12); c.fill(); }

  function drawHud(c, ts, mv, camX, camY) {
    // Alarme : l'écran clignote en rouge.
    if (st.alarm) {
      c.fillStyle = `rgba(255,30,30,${(0.1 + 0.1 * Math.sin(ts / 170)).toFixed(3)})`; c.fillRect(0, 0, W, HGT);
      panel(c, W / 2 - 230, 14, 460, 44);
      c.fillStyle = Math.floor(ts / 300) % 2 ? "#ff5a5a" : "#fff"; c.font = "900 26px Segoe UI, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillText("🚨 ALARME : BUTIN × 2 !", W / 2, 37);
    }
    c.textAlign = "left"; c.textBaseline = "top";
    // Classement (à gauche).
    if (st.phase === "play" || st.phase === "countdown") {
      const list = [...st.heroes].sort((a, b) => b.money - a.money);
      panel(c, 14, 14, 250, 14 + list.length * 28);
      list.forEach((h, i) => {
        const y = 22 + i * 28;
        c.fillStyle = h.id === me() ? "#ffd23f" : "#fff";
        c.font = `${h.id === me() ? "900" : "bold"} 18px Segoe UI, sans-serif`;
        c.textAlign = "left"; c.fillText(`${i + 1}. ${pseudoOf(h.id)}`.slice(0, 15), 28, y);
        c.textAlign = "right"; c.fillStyle = "#7dffb0"; c.fillText(money(h.money), 252, y);
      });
      c.textAlign = "left";
    }
    // Les dernières nouvelles (coffre, vols).
    const feed = (st.feed || []).slice(-3);
    feed.forEach((f, i) => {
      c.font = "bold 17px Segoe UI, sans-serif";
      const w = c.measureText(f.text).width + 22, y = HGT - 40 - (feed.length - 1 - i) * 32;
      panel(c, 14, y, w, 28);
      c.fillStyle = "#fff"; c.textBaseline = "middle"; c.fillText(f.text, 25, y + 15);
    });
    c.textBaseline = "top";
    // Quand je porte quelque chose : une grosse flèche vers le van.
    const myVan = st.van;
    if (mv?.carry && myVan && st.phase === "play") {
      const sx = (mv.x - camX) * Z, sy = (mv.y - camY) * Z;
      const a = Math.atan2(myVan.y - mv.y, myVan.x - mv.x), d = Math.hypot(myVan.y - mv.y, myVan.x - mv.x);
      if (d > 150) {
        c.save(); c.translate(sx + Math.cos(a) * 70, sy + Math.sin(a) * 70); c.rotate(a);
        c.fillStyle = "#ffd23f"; c.strokeStyle = "#1b1830"; c.lineWidth = 3;
        c.beginPath(); c.moveTo(20, 0); c.lineTo(-10, -14); c.lineTo(-4, 0); c.lineTo(-10, 14); c.closePath(); c.fill(); c.stroke();
        c.restore();
      }
    }
    if (st.phase === "countdown") {
      const n = Math.max(1, Math.ceil((phaseEndLocal - Date.now()) / 1000));
      c.textAlign = "center"; c.textBaseline = "middle"; c.font = "900 150px Segoe UI, sans-serif";
      c.lineWidth = 10; c.strokeStyle = "rgba(0,0,0,0.6)"; c.fillStyle = "#ffd23f";
      c.strokeText(n, W / 2, HGT / 2); c.fillText(n, W / 2, HGT / 2);
    }
  }
})();
