// ===================================================================
//  PATATE CHAUDE — Client (s'affiche dans le hub Le Bordel)
//  Le serveur envoie les positions 30 fois/s ; ici on DESSINE l'arène
//  dans un <canvas> et on envoie les touches enfoncées.
// ===================================================================

(() => {
  let api = null;
  let root = null;
  let st = null;              // dernier état reçu du serveur
  let phaseEndLocal = 0;      // fin du compte à rebours (horloge locale)
  let rafId = null;
  let canvas = null, g2d = null;
  const disp = {};            // positions affichées (lissées) par joueur
  const keys = { u: false, d: false, l: false, r: false };
  let boomAnim = null;        // { x, y, t0 } animation d'explosion
  let lastBoomKey = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";

  const FUSE_LABELS = { courte: "Courte", normale: "Normale", longue: "Longue" };

  // ===================================================================
  //  SQUELETTE HTML
  // ===================================================================
  const TEMPLATE = `
    <!-- Réglages -->
    <div id="pt-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">💣</span>
        <h1>PATATE CHAUDE</h1>
        <p class="tagline">Refile la bombe avant qu'elle explose.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card">
          <h2>⚙️ Réglages</h2>
          <div id="pt-settings" class="settings"></div>
        </div>
        <div class="card">
          <h2>🎮 Commandes</h2>
          <ul class="pt-help">
            <li><kbd>Z</kbd><kbd>Q</kbd><kbd>S</kbd><kbd>D</kbd> ou les <kbd>flèches</kbd> : bouger</li>
            <li><kbd>Espace</kbd> : sprint (recharge 2,5 s)</li>
            <li>💣 Touche quelqu'un pour lui refiler la bombe.</li>
            <li>⏱️ La mèche est cachée… mais la bombe clignote de plus en plus vite !</li>
            <li>🏆 1 point par joueur éliminé avant toi.</li>
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

    <!-- Arène -->
    <div id="pt-play" class="hidden">
      <div class="game-topbar">
        <span class="pill" id="pt-round">Manche 1</span>
        <span class="phase-label" id="pt-status">—</span>
        <span id="pt-dash" class="timer-pill hidden"></span>
      </div>
      <div class="pt-arena-wrap">
        <canvas id="pt-canvas" width="960" height="600"></canvas>
        <div id="pt-overlay" class="pt-overlay hidden"></div>
      </div>
      <p class="muted pt-keys">ZQSD / flèches pour bouger · Espace pour sprinter</p>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.patate = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; boomAnim = null; lastBoomKey = null;
      for (const k in disp) delete disp[k];
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-sunset");

      canvas = $("pt-canvas");
      g2d = canvas.getContext("2d");

      $("pt-start").onclick = startRound;
      $("pt-finish-setup").onclick = finishGame;

      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKey);
      window.addEventListener("blur", releaseAll);
      rafId = requestAnimationFrame(draw);
    },

    update(state) {
      const prev = st;
      st = state;
      phaseEndLocal = Date.now() + (st.phaseLeft || 0);

      // Nouvelle explosion -> on lance l'animation.
      const bk = st.lastBoom ? `${st.roundNum}:${st.lastBoom.id}` : null;
      if (bk && bk !== lastBoomKey) boomAnim = { x: st.lastBoom.x, y: st.lastBoom.y, t0: performance.now() };
      lastBoomKey = bk;

      // Nouvelle manche -> on oublie les anciennes positions lissées.
      if (prev && prev.roundNum !== st.roundNum) for (const k in disp) delete disp[k];

      if (st.phase === "setup") {
        $("pt-play").classList.add("hidden");
        $("pt-setup").classList.remove("hidden");
        renderSettings();
        renderStartArea();
      } else {
        $("pt-setup").classList.add("hidden");
        $("pt-play").classList.remove("hidden");
        renderHud();
      }
    },

    unmount() {
      cancelAnimationFrame(rafId);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", releaseAll);
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
  //  CLAVIER
  //  e.code = position physique de la touche : "KeyW" est le Z sur un
  //  clavier AZERTY, donc ZQSD et WASD marchent tous les deux.
  // ===================================================================
  const KEYMAP = {
    KeyW: "u", ArrowUp: "u", KeyS: "d", ArrowDown: "d",
    KeyA: "l", ArrowLeft: "l", KeyD: "r", ArrowRight: "r",
  };

  function onKey(e) {
    if (e.target.tagName === "INPUT" || !st || st.phase === "setup") return;
    const down = e.type === "keydown";
    if (e.code === "Space") {
      e.preventDefault();
      if (down && !e.repeat) api.send("dash");
      return;
    }
    const k = KEYMAP[e.code];
    if (!k) return;
    e.preventDefault();
    if (keys[k] === down) return;   // rien n'a changé (touche maintenue)
    keys[k] = down;
    api.send("input", { ...keys });
  }

  function releaseAll() {
    for (const k in keys) keys[k] = false;
    if (st && st.phase !== "setup") api.send("input", { ...keys });
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
            `<button class="cat-chip ${s.fuse === k ? "on" : ""}" data-fuse="${k}" ${host ? "" : "disabled"}>${label}</button>`
          ).join("")}
        </div>
      </div>
      <div class="setting"><label>Obstacles</label><div class="val">${toggle("obstacles", s.obstacles)}</div></div>
      <div class="setting"><label>Sprint (Espace)</label><div class="val">${toggle("dash", s.dash)}</div></div>
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
    $("pt-round").textContent = "Manche " + st.roundNum;
    const mine = st.bodies.find((b) => b.id === me());
    const status = $("pt-status");
    status.className = "phase-label";

    if (st.phase === "play" || st.phase === "countdown") {
      if (!mine) status.textContent = "👀 Tu regardes cette manche";
      else if (!mine.alive) status.textContent = "💀 Éliminé — regarde la fin !";
      else if (st.holderId === me()) {
        status.textContent = "💣 TU AS LA BOMBE ! Touche quelqu'un !";
        status.classList.add("pt-danger");
      } else status.textContent = `🏃 Fuis ${pseudoOf(st.holderId)} !`;
    } else if (st.phase === "boom") {
      status.textContent = `💥 ${pseudoOf(st.lastBoom?.id)} a explosé !`;
    } else if (st.phase === "roundOver") {
      status.textContent = "🏁 Fin de la manche";
    }

    // Indicateur de sprint.
    const dash = $("pt-dash");
    if (st.settings.dash && mine?.alive && st.phase !== "roundOver") {
      dash.classList.remove("hidden");
      dash.textContent = mine.dashReady ? "⚡ Sprint prêt" : "⚡ recharge…";
      dash.classList.toggle("pt-dim", !mine.dashReady);
    } else dash.classList.add("hidden");

    renderRoundOver();
  }

  function renderRoundOver() {
    const ov = $("pt-overlay");
    const isOver = st.phase === "roundOver" && !!st.lastRound;
    ov.parentElement.classList.toggle("over", isOver);
    if (!isOver) { ov.classList.add("hidden"); return; }
    const host = api.isHost();
    const medals = ["🥇", "🥈", "🥉"];
    const winner = st.lastRound[0];
    // On ne reconstruit pas si c'est déjà affiché (évite le clignotement).
    if (!ov.classList.contains("hidden") && ov.dataset.round === String(st.roundNum) && ov.dataset.host === String(host)) return;
    ov.dataset.round = st.roundNum;
    ov.dataset.host = host;
    ov.innerHTML = `
      <div class="pt-over card">
        <h2 class="go-banner">🏆 ${esc(pseudoOf(winner.id))} survit !</h2>
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
        ${host ? `<div class="go-actions">
            <button id="pt-next" class="btn btn-primary">Nouvelle manche</button>
            <button id="pt-to-setup" class="btn btn-secondary">Réglages</button>
            <button id="pt-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
          </div>
          <p id="pt-over-error" class="error-msg"></p>` : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    ov.classList.remove("hidden");
    if (host) {
      $("pt-next").onclick = () => api.action("start").then((r) => { if (r.error) $("pt-over-error").textContent = r.error; });
      $("pt-to-setup").onclick = () => api.action("setup");
      $("pt-finish").onclick = finishGame;
    }
  }

  // ===================================================================
  //  DESSIN DE L'ARÈNE (60 images/s)
  // ===================================================================
  function draw(ts) {
    rafId = requestAnimationFrame(draw);
    if (!st || st.phase === "setup" || !g2d) return;
    const { w, h, r: R, obstacles } = st.arena;
    const css = getComputedStyle(document.body);
    const col = (v) => css.getPropertyValue(v).trim();

    // Fond + quadrillage.
    g2d.fillStyle = col("--surface");
    g2d.fillRect(0, 0, w, h);
    g2d.strokeStyle = "rgba(255,255,255,0.04)";
    g2d.lineWidth = 1;
    for (let x = 40; x < w; x += 40) { g2d.beginPath(); g2d.moveTo(x, 0); g2d.lineTo(x, h); g2d.stroke(); }
    for (let y = 40; y < h; y += 40) { g2d.beginPath(); g2d.moveTo(0, y); g2d.lineTo(w, y); g2d.stroke(); }

    // Obstacles.
    for (const o of obstacles) {
      g2d.fillStyle = col("--surface-2");
      g2d.strokeStyle = col("--border");
      g2d.lineWidth = 3;
      roundRect(o.x, o.y, o.w, o.h, 8);
      g2d.fill(); g2d.stroke();
    }

    // Joueurs (positions lissées vers celles du serveur).
    const holder = st.holderId;
    const pulseHz = 1.5 + st.heat * 9;          // la bombe clignote de plus en plus vite
    const pulse = (Math.sin(ts / 1000 * pulseHz * Math.PI * 2) + 1) / 2;

    for (const b of st.bodies) {
      const d = disp[b.id] || (disp[b.id] = { x: b.x, y: b.y });
      d.x += (b.x - d.x) * 0.35;
      d.y += (b.y - d.y) * 0.35;
      const p = playerOf(b.id);

      if (!b.alive) {
        g2d.globalAlpha = 0.35;
        g2d.font = "26px serif";
        g2d.textAlign = "center"; g2d.textBaseline = "middle";
        g2d.fillText("💀", d.x, d.y);
        g2d.globalAlpha = 1;
        continue;
      }

      // Lueur rouge autour du porteur.
      if (b.id === holder) {
        g2d.beginPath();
        g2d.arc(d.x, d.y, R + 8 + pulse * 8, 0, Math.PI * 2);
        g2d.fillStyle = `rgba(255,60,40,${0.25 + pulse * 0.35})`;
        g2d.fill();
      }

      // Traînée de sprint.
      if (b.dashing) {
        g2d.beginPath();
        g2d.arc(d.x, d.y, R + 4, 0, Math.PI * 2);
        g2d.fillStyle = "rgba(255,255,255,0.18)";
        g2d.fill();
      }

      // Le rond du joueur.
      g2d.beginPath();
      g2d.arc(d.x, d.y, R, 0, Math.PI * 2);
      g2d.fillStyle = p?.color || "#888";
      g2d.fill();
      g2d.lineWidth = b.id === me() ? 4 : 2;
      g2d.strokeStyle = b.id === me() ? "#ffffff" : "rgba(0,0,0,0.35)";
      g2d.stroke();

      // Initiale + pseudo.
      g2d.fillStyle = "#fff";
      g2d.font = "bold 18px Segoe UI, sans-serif";
      g2d.textAlign = "center"; g2d.textBaseline = "middle";
      g2d.fillText((p?.pseudo || "?").charAt(0).toUpperCase(), d.x, d.y + 1);
      g2d.font = "13px Segoe UI, sans-serif";
      g2d.fillStyle = b.id === me() ? "#fff" : "rgba(255,255,255,0.75)";
      g2d.fillText(p?.pseudo || "?", d.x, d.y - R - 12);

      // La bombe !
      if (b.id === holder) {
        const s = 26 + pulse * 6;
        g2d.font = `${s}px serif`;
        g2d.fillText("💣", d.x + R * 0.8, d.y - R * 0.6);
      }
    }

    // Explosion.
    if (boomAnim) {
      const t = (performance.now() - boomAnim.t0) / 900;
      if (t >= 1) boomAnim = null;
      else {
        for (let i = 0; i < 3; i++) {
          g2d.beginPath();
          g2d.arc(boomAnim.x, boomAnim.y, 20 + t * (120 + i * 40), 0, Math.PI * 2);
          g2d.fillStyle = `rgba(255,${140 - i * 50},40,${(1 - t) * (0.5 - i * 0.12)})`;
          g2d.fill();
        }
        g2d.font = `${60 + t * 50}px serif`;
        g2d.globalAlpha = 1 - t;
        g2d.fillText("💥", boomAnim.x, boomAnim.y);
        g2d.globalAlpha = 1;
      }
    }

    // Gros texte au centre (compte à rebours).
    if (st.phase === "countdown") {
      const left = Math.ceil((phaseEndLocal - Date.now()) / 1000);
      g2d.fillStyle = "rgba(0,0,0,0.35)";
      g2d.fillRect(0, h / 2 - 70, w, 140);
      g2d.fillStyle = "#fff";
      g2d.font = "bold 64px Segoe UI, sans-serif";
      g2d.fillText(left > 0 ? left : "GO !", w / 2, h / 2 - 12);
      g2d.font = "20px Segoe UI, sans-serif";
      g2d.fillText(holder === me() ? "💣 C'est TOI qui as la bombe !" : `💣 ${pseudoOf(holder)} a la bombe`, w / 2, h / 2 + 40);
    }
  }

  function roundRect(x, y, w, h, r) {
    g2d.beginPath();
    g2d.moveTo(x + r, y);
    g2d.arcTo(x + w, y, x + w, y + h, r);
    g2d.arcTo(x + w, y + h, x, y + h, r);
    g2d.arcTo(x, y + h, x, y, r);
    g2d.arcTo(x, y, x + w, y, r);
    g2d.closePath();
  }
})();
