// ===================================================================
//  DEVINE LA MAP (CS2) — Client (s'affiche dans le hub Le Bordel)
//  L'image est zoomée sur un détail puis se dézoome jusqu'à la fin du
//  chrono. On clique sur la map : plus c'est tôt, plus ça rapporte.
// ===================================================================

(() => {
  let api = null, root = null;
  let st = null;
  let qEndLocal = 0, finishEndLocal = 0;
  let rafId = null;
  let shownImg = null;          // image actuellement chargée
  let myAnswer = null;          // ma réponse pour l'image en cours

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";

  const TEMPLATE = `
    <div id="cm-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🗺️</span>
        <h1>DEVINE LA MAP</h1>
        <p class="tagline">Un screenshot de CS2. Quelle map ?</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card">
          <h2>⚙️ Réglages</h2>
          <div id="cm-settings" class="settings"></div>
        </div>
        <div class="card">
          <h2>📸 Screenshots</h2>
          <div id="cm-pool"></div>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="cm-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="cm-hint" class="muted"></p>
        <p id="cm-error" class="error-msg"></p>
        <button id="cm-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>
    </div>

    <div id="cm-play" class="hidden">
      <div class="game-topbar">
        <span class="pill" id="cm-count">Image 1/10</span>
        <span class="phase-label" id="cm-status">—</span>
        <span class="cm-sec" id="cm-sec"></span>
      </div>
      <div class="cm-bar"><i id="cm-bar"></i></div>
      <div class="cm-frame">
        <img id="cm-img" alt="" draggable="false" />
        <div id="cm-reveal" class="cm-reveal hidden"></div>
      </div>
      <div id="cm-answered" class="cm-answered"></div>
      <div id="cm-maps" class="cm-maps"></div>
    </div>

    <div id="cm-over" class="hidden"></div>`;

  window.GAMES.cs2map = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl; st = null; shownImg = null; myAnswer = null;
      root.innerHTML = TEMPLATE;
      api.setTheme("theme-forest");
      $("cm-start").onclick = () => {
        $("cm-error").textContent = "";
        api.action("start").then((r) => { if (r.error) $("cm-error").textContent = r.error; });
      };
      $("cm-finish-setup").onclick = finishGame;
      rafId = requestAnimationFrame(frame);
    },

    update(state) {
      const prevIndex = st?.index, prevPhase = st?.phase;
      st = state;
      $("cm-setup").classList.toggle("hidden", st.phase !== "setup");
      $("cm-play").classList.toggle("hidden", !["question", "reveal"].includes(st.phase));
      $("cm-over").classList.toggle("hidden", st.phase !== "over");
      if (st.phase === "setup") { renderSettings(); renderPool(); renderStartArea(); return; }
      if (st.phase === "over") { renderOver(); return; }
      if (st.index !== prevIndex || prevPhase === "over") myAnswer = null;   // nouvelle image
      qEndLocal = Date.now() + (st.q?.left || 0);
      renderPlay();
    },

    unmount() { cancelAnimationFrame(rafId); root.innerHTML = ""; },
  };

  function finishGame() {
    if (confirm("Terminer « Devine la map » ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function renderSettings() {
    const s = st.settings, host = api.isHost();
    const panel = $("cm-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Nombre d'images</label>${chips("images", [[5, "5"], [10, "10"], [15, "15"], [20, "20"]])}</div>
      <div class="setting-block"><label>Temps par image</label>${chips("time", [[15, "15 s"], [20, "20 s"], [30, "30 s"]])}</div>
      <div class="setting-block"><label>Zoom de départ (plus c'est zoomé, plus c'est dur)</label>${chips("zoom", [[2, "×2"], [4, "×4"], [6, "×6"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (!host) return;
    panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
  }

  function renderPool() {
    const pool = $("cm-pool");
    if (!st.imageCount) {
      pool.innerHTML = `<p class="cm-empty">Aucun screenshot pour l'instant 📭</p>
        <p class="muted">L'hôte doit en ajouter : dans CS2, <code>cl_drawhud 0</code> + <code>r_drawviewmodel 0</code>, F12,
        puis ranger les images dans <code>screenshots-cs2/&lt;map&gt;/</code> et lancer <code>npm run images</code>.</p>`;
      return;
    }
    pool.innerHTML = `<p><b>${st.imageCount}</b> screenshots dans ${st.maps.length} maps :</p>
      <ul class="cm-pool">${st.maps.map((m) => `<li><span>${esc(m.name)}</span><b>${st.perMap[m.id]}</b></li>`).join("")}</ul>`;
  }

  function renderStartArea() {
    const host = api.isHost();
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("cm-finish-setup").classList.toggle("hidden", !host);
    $("cm-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("cm-start").style.display = host ? "" : "none";
    $("cm-start").disabled = !st.imageCount || n < 2;
    $("cm-hint").textContent = !host ? "En attente que l'hôte lance la partie…"
      : !st.imageCount ? "Ajoute des screenshots pour pouvoir jouer."
      : `${n} joueurs · ${Math.min(st.settings.images, st.imageCount)} images de ${st.settings.time} s.`;
  }

  // ===================================================================
  //  UNE IMAGE
  // ===================================================================
  function renderPlay() {
    const q = st.q;
    const reveal = st.phase === "reveal";
    $("cm-count").textContent = `Image ${st.index + 1}/${st.total}`;
    if (shownImg !== q.img) { $("cm-img").src = q.img; shownImg = q.img; }
    $("cm-img").style.transformOrigin = `${q.fx * 100}% ${q.fy * 100}%`;

    const status = $("cm-status");
    if (reveal) status.textContent = `C'était… ${q.mapName} !`;
    else if (myAnswer) status.textContent = `✅ Réponse envoyée : ${myAnswer}`;
    else status.textContent = "🤔 Quelle est cette map ?";

    // Qui a déjà répondu (sans dire quoi).
    $("cm-answered").innerHTML = reveal ? "" : st.players.filter((p) => p.connected).map((p) =>
      `<span class="cm-who ${q.answered.includes(p.id) ? "done" : ""}">${api.avatar(p)} ${esc(p.pseudo)}</span>`).join("");

    // Les boutons des maps.
    const maps = $("cm-maps");
    maps.innerHTML = st.maps.map((m) => {
      let cls = "cm-map";
      if (reveal && m.id === q.map) cls += " good";
      else if (reveal && q.answers?.[me()]?.map === m.id) cls += " bad";
      else if (!reveal && myAnswer === m.name) cls += " mine";
      return `<button class="${cls}" data-id="${m.id}" ${reveal || myAnswer ? "disabled" : ""}>${esc(m.name)}</button>`;
    }).join("");
    maps.querySelectorAll(".cm-map:not([disabled])").forEach((b) => {
      b.onclick = () => {
        myAnswer = st.maps.find((m) => m.id === b.dataset.id)?.name;
        api.action("answer", { map: b.dataset.id }).then((r) => { if (r.error) myAnswer = null; });
        renderPlay();
      };
    });

    // Révélation : qui a trouvé, en combien de temps, combien de points.
    const rv = $("cm-reveal");
    rv.classList.toggle("hidden", !reveal);
    if (reveal) {
      const rows = st.players.filter((p) => q.answers?.[p.id] || p.connected).map((p) => {
        const a = q.answers?.[p.id];
        return { p, a, pts: a?.points || 0 };
      }).sort((x, y) => y.pts - x.pts);
      rv.innerHTML = `
        <div class="cm-reveal-map">📍 ${esc(q.mapName)}</div>
        <ul class="cm-reveal-list">${rows.map(({ p, a, pts }) => `
          <li class="${a?.correct ? "ok" : "ko"}">${api.avatar(p)} <span class="name">${esc(p.pseudo)}</span>
            <span class="what">${a ? (a.correct ? `✅ en ${a.secs} s` : `❌ ${esc(a.mapName)}`) : "⌛ pas répondu"}</span>
            <span class="gain">${pts ? "+" + pts : ""}</span></li>`).join("")}
        </ul>`;
    }
  }

  // ===================================================================
  //  FIN DE LA SÉRIE
  // ===================================================================
  function renderOver() {
    const host = api.isHost();
    const pl = st.playlist;
    const sorted = [...st.players].sort((a, b) => b.score - a.score);
    const medals = ["🥇", "🥈", "🥉"];
    if (pl?.final) finishEndLocal = Date.now() + pl.finishLeft;
    const found = (h) => h.found.length ? h.found.map((id) => esc(pseudoOf(id))).join(", ") : "personne";
    $("cm-over").innerHTML = `
      <div class="card cm-over-card">
        <h2 class="go-banner">🏁 Fin de la série !</h2>
        <ul class="podium-list">${sorted.map((p, i) => `
          <li style="animation-delay:${i * 0.1}s"><span class="place">${medals[i] || i + 1 + "e"}</span>${api.avatar(p)}
            <span class="name">${esc(p.pseudo)}</span><span class="gain">${p.score} pts</span></li>`).join("")}
        </ul>
        <h3 class="muted cm-recap-title">Les images</h3>
        <div class="cm-recap">${(st.history || []).map((h, i) => `
          <figure><img src="${h.img}" alt="" /><figcaption><b>${i + 1}. ${esc(h.mapName)}</b><br><span class="muted">${found(h)}</span></figcaption></figure>`).join("")}
        </div>
        ${pl?.final
          ? `<p class="go-final">Classement dans <b id="cm-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
             ${host ? `<div class="go-actions"><button id="cm-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`
          : host ? `<div class="go-actions">
              <button id="cm-again" class="btn btn-primary">🔁 Nouvelle série</button>
              <button id="cm-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="cm-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="cm-over-error" class="error-msg"></p>`
          : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    if (!host) return;
    $("cm-again") && ($("cm-again").onclick = () => api.action("start").then((r) => { if (r.error) $("cm-over-error").textContent = r.error; }));
    $("cm-to-setup") && ($("cm-to-setup").onclick = () => api.action("setup"));
    $("cm-finish").onclick = pl?.final ? () => api.action("finish") : finishGame;
  }

  // ===================================================================
  //  ANIMATION : le zoom qui recule + le chrono
  // ===================================================================
  function frame() {
    rafId = requestAnimationFrame(frame);
    const fin = document.getElementById("cm-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    if (!st?.q || !["question", "reveal"].includes(st.phase)) return;
    const img = $("cm-img");
    if (st.phase === "reveal") {
      img.style.transform = "scale(1)";
      $("cm-bar").style.width = "0%";
      $("cm-sec").textContent = "";
      return;
    }
    const left = Math.max(0, qEndLocal - Date.now());
    const progress = 1 - left / st.q.totalMs;          // 0 au début, 1 à la fin
    const z = st.q.zoom - (st.q.zoom - 1) * progress;   // ×4 -> ×1
    img.style.transform = `scale(${z.toFixed(3)})`;
    $("cm-bar").style.width = (100 * left / st.q.totalMs).toFixed(1) + "%";
    const sec = Math.ceil(left / 1000);
    $("cm-sec").textContent = sec + " s";
    $("cm-sec").classList.toggle("urgent", sec <= 5);
  }
})();
