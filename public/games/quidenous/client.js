// ===================================================================
//  QUI DE NOUS ? — Client (s'affiche dans le hub Le Bordel)
//  Écriture -> votes -> cérémonie (tout est dévoilé) -> palmarès.
// ===================================================================

(() => {
  let api = null, root = null;
  let st = null;
  let rafId = null;
  let endLocal = 0, finishEndLocal = 0;
  let shownPhase = null, shownKey = null;
  let myVote = null;            // pour qui j'ai voté sur la question en cours

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const DRUM_MS = 1500;          // roulement de tambour avant de dévoiler chaque question

  window.GAMES.quidenous = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl; st = null; shownPhase = shownKey = null; myVote = null;
      root.innerHTML = `<div id="qn-root"></div>`;
      api.setTheme("theme-candy");
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      endLocal = Date.now() + (st.left || 0);
      // On redessine tout l'écran seulement quand on change de phase (sinon on garderait
      // pas ce qu'on est en train de taper) ; le reste se met à jour par petits bouts.
      if (st.phase !== shownPhase) { shownPhase = st.phase; shownKey = null; renderPhase(); }
      else renderUpdate();
    },
    unmount() { cancelAnimationFrame(rafId); root.innerHTML = ""; },
  };

  function renderPhase() {
    const r = $("qn-root");
    if (st.phase === "setup") r.innerHTML = setupHtml();
    else if (st.phase === "write") r.innerHTML = writeHtml();
    else if (st.phase === "vote") r.innerHTML = `<div id="qn-vote"></div>`;
    else if (st.phase === "reveal") r.innerHTML = `<div id="qn-reveal"></div>`;
    else r.innerHTML = `<div id="qn-over"></div>`;
    bindPhase();
    renderUpdate();
  }

  function renderUpdate() {
    if (st.phase === "setup") renderSetup();
    else if (st.phase === "write") renderWriteStatus();
    else if (st.phase === "vote") renderVote();
    else if (st.phase === "reveal") renderReveal();
    else renderOver();
  }

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function setupHtml() {
    return `
      <div class="logo imp-logo">
        <span class="logo-icon">👉</span>
        <h1>QUI DE NOUS ?</h1>
        <p class="tagline">Votez… et assumez.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="qn-settings" class="settings"></div></div>
        <div class="card">
          <h2>📜 Règles</h2>
          <ul class="pt-help">
            <li>✍️ Chacun écrit une question, comme <b>« Qui finirait en prison en premier ? »</b></li>
            <li>🗳️ Vote pour le joueur qui correspond le mieux.</li>
            <li>🏆 <b>+1</b> si tu votes comme la majorité.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="qn-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="qn-hint" class="muted"></p>
        <p id="qn-error" class="error-msg"></p>
        <button id="qn-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>`;
  }

  function renderSetup() {
    const s = st.settings, host = api.isHost();
    const panel = $("qn-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Questions par joueur</label>${chips("perPlayer", [[1, "1"], [2, "2"], [3, "3"]])}</div>
      <div class="setting-block"><label>Temps pour écrire</label>${chips("writeTime", [[60, "60 s"], [90, "90 s"], [120, "2 min"]])}</div>
      <div class="setting-block"><label>Temps pour voter (par question)</label>${chips("voteTime", [[20, "20 s"], [30, "30 s"], [40, "40 s"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("qn-start").style.display = host ? "" : "none";
    $("qn-start").disabled = n < 3;
    $("qn-finish-setup").classList.toggle("hidden", !host);
    $("qn-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("qn-hint").textContent = !host ? "En attente que l'hôte lance la partie…"
      : n < 3 ? `Il faut au moins 3 joueurs (${n}/3).` : `${n} joueurs · ~${Math.round((s.writeTime + n * s.perPlayer * (s.voteTime + 11)) / 60)} min de jeu.`;
  }

  // ===================================================================
  //  ÉCRITURE
  // ===================================================================
  function writeHtml() {
    const n = st.settings.perPlayer;
    const playing = st.who.includes(me());
    return `
      <div class="qn-top"><span class="pill">✍️ Écriture</span><span class="qn-sec" id="qn-sec"></span></div>
      <div class="qn-bar"><i id="qn-bar"></i></div>
      <div class="card qn-write">
        ${playing ? `
          <h2>Écris ${n > 1 ? "tes " + n + " questions" : "ta question"} 😈</h2>
          <p class="muted">Pense à ton groupe : blagues internes, vieux dossiers… Personne ne saura que c'est toi (jusqu'à la fin 👀).</p>
          ${Array.from({ length: n }, (_, i) => `
            <div class="qn-line">
              <input class="qn-input" maxlength="100" placeholder="Qui ... ?" autocomplete="off" />
              <button class="btn btn-secondary qn-dice" data-i="${i}" title="Idée au hasard">🎲</button>
            </div>`).join("")}
          <button id="qn-send" class="btn btn-primary btn-big">Envoyer</button>
          <p id="qn-write-msg" class="muted qn-write-msg"></p>`
          : `<h2>Tu regardes cette partie 👀</h2><p class="muted">Tu joueras à la prochaine.</p>`}
        <div id="qn-done" class="qn-who"></div>
      </div>`;
  }

  function bindPhase() {
    if (st.phase === "setup") {
      $("qn-start").onclick = () => { $("qn-error").textContent = ""; api.action("start").then((r) => { if (r.error) $("qn-error").textContent = r.error; }); };
      $("qn-finish-setup").onclick = finishGame;
    }
    if (st.phase === "write" && $("qn-send")) {
      const inputs = [...document.querySelectorAll(".qn-input")];
      inputs[0]?.focus();
      document.querySelectorAll(".qn-dice").forEach((b) => {
        b.onclick = () => api.action("random").then((r) => { if (r.text) inputs[Number(b.dataset.i)].value = r.text; });
      });
      const send = () => api.action("write", { texts: inputs.map((i) => i.value) }).then((r) => {
        const msg = $("qn-write-msg");   // (disparu si l'écran est déjà passé au vote)
        if (msg) msg.textContent = r.error ? "⚠️ " + r.error : "✅ Envoyé ! Tu peux encore modifier et renvoyer.";
      });
      $("qn-send").onclick = send;
      inputs.forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); }));
    }
    if (st.phase === "vote") myVote = null;
  }

  function renderWriteStatus() {
    const done = $("qn-done");
    if (!done) return;
    done.innerHTML = st.who.map((id) => `<span class="qn-chip ${st.doneIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))} ${esc(pseudoOf(id))}</span>`).join("");
  }

  // ===================================================================
  //  VOTE
  // ===================================================================
  function renderVote() {
    const v = st.vote;
    const box = $("qn-vote");
    const key = "v" + v.num;
    // Nouvelle question : on dessine le haut une seule fois (sinon la question
    // rejouerait son animation et clignoterait à chaque vote reçu).
    if (shownKey !== key) {
      shownKey = key; myVote = null;
      box.innerHTML = `
        <div class="qn-top"><span class="pill">🗳️ Question ${v.num}/${v.total}</span><span class="qn-sec" id="qn-sec"></span></div>
        <div class="qn-bar"><i id="qn-bar"></i></div>
        <div class="qn-question">${esc(v.text)}</div>
        <div id="qn-vote-live"></div>`;
    }
    const playing = st.who.includes(me());
    const live = $("qn-vote-live");
    live.innerHTML = `
      <div class="qn-candidates">
        ${st.who.map((id) => {
          const p = playerOf(id);
          return `<button class="qn-cand ${myVote === id ? "mine" : ""}" data-id="${id}" ${!playing || myVote ? "disabled" : ""}>
            ${api.avatar(p, "mini-avatar qn-big")}<span>${esc(pseudoOf(id))}${id === me() ? " (toi)" : ""}</span></button>`;
        }).join("")}
      </div>
      <p class="qn-status">${!playing ? "👀 Tu regardes." : myVote ? `✅ Tu as voté pour <b>${esc(pseudoOf(myVote))}</b>` : "👉 Clique sur quelqu'un !"}</p>
      <div class="qn-who">${st.who.map((id) => `<span class="qn-chip ${v.votedIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))}</span>`).join("")}</div>`;
    live.querySelectorAll(".qn-cand:not([disabled])").forEach((b) => {
      b.onclick = () => { myVote = b.dataset.id; api.action("vote", { target: b.dataset.id }); renderVote(); };
    });
  }

  // ===================================================================
  //  LA CÉRÉMONIE
  // ===================================================================
  let stepStartLocal = 0;

  function renderReveal() {
    const box = $("qn-reveal");
    const q = st.revealed[st.revealed.length - 1];
    const key = "r" + st.step.num;
    stepStartLocal = Date.now() - st.step.elapsed;
    if (shownKey === key) { renderRevealHost(); return; }   // déjà affichée : on garde l'animation
    shownKey = key;
    const max = Math.max(1, ...Object.values(q.counts));
    const order = [...st.who].sort((a, b) => (q.counts[b] || 0) - (q.counts[a] || 0));
    const names = q.winners.map((id) => `<b>${esc(pseudoOf(id))}</b>`).join(" & ");
    box.innerHTML = `
      <div class="qn-top"><span class="pill">🥁 Révélation ${st.step.num}/${st.step.total}</span><span class="qn-sec" id="qn-sec"></span></div>
      <div class="qn-question">${esc(q.text)}</div>
      <div class="qn-drum" id="qn-drum">🥁 🥁 🥁</div>
      <div class="qn-results hidden" id="qn-results">
        <ul class="qn-rows">${order.map((id) => {
          const n = q.counts[id] || 0;
          const voters = Object.entries(q.votes).filter(([, t]) => t === id).map(([v]) => api.avatar(playerOf(v))).join("");
          return `<li class="${q.winners.includes(id) ? "win" : ""}">
            ${api.avatar(playerOf(id))}<span class="name">${esc(pseudoOf(id))}</span>
            <span class="qn-track"><i style="--w:${(100 * n) / max}%"></i></span>
            <span class="qn-n">${n}</span><span class="qn-voters">${voters}</span></li>`;
        }).join("")}</ul>
        <div class="qn-winner">${q.winners.length ? `🏆 ${names} — <i>${esc(q.title)}</i>` : "🤷 Personne n'a voté !"}</div>
        <div class="qn-author">✍️ Question écrite par ${api.avatar(playerOf(q.author))} <b>${esc(pseudoOf(q.author))}</b></div>
      </div>
      <div class="lobby-actions" id="qn-host"></div>`;
    renderRevealHost();
  }

  function renderRevealHost() {
    const h = $("qn-host");
    if (!h) return;
    if (api.isHost() && !h.firstChild) {
      h.innerHTML = `<button id="qn-next" class="btn btn-secondary">Suivant ▶</button>`;
      $("qn-next").onclick = () => api.action("next");
    }
  }

  // ===================================================================
  //  PALMARÈS
  // ===================================================================
  function renderOver() {
    const box = $("qn-over");
    const host = api.isHost();
    const pl = st.playlist;
    if (pl?.final) finishEndLocal = Date.now() + pl.finishLeft;
    const key = "o" + JSON.stringify(st.titles) + host;
    if (shownKey === key) return;
    shownKey = key;
    const sorted = [...st.who].sort((a, b) => (playerOf(b)?.score || 0) - (playerOf(a)?.score || 0));
    box.innerHTML = `
      <div class="card qn-over">
        <h2 class="go-banner">🏅 Le palmarès</h2>
        <div class="qn-palmares">${sorted.map((id, i) => `
          <div class="qn-pcard" style="animation-delay:${i * 0.12}s">
            <div class="qn-phead">${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="gain">${playerOf(id)?.score || 0} pts</span></div>
            <ul>${(st.titles[id] || []).map((t) => `<li>🏆 ${esc(t)}</li>`).join("") || '<li class="muted">Aucun titre… pour l\'instant 😇</li>'}</ul>
          </div>`).join("")}
        </div>
        <p class="muted">+1 point chaque fois que tu as voté comme la majorité.</p>
        ${pl?.final
          ? `<p class="go-final">Classement dans <b id="qn-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
             ${host ? `<div class="go-actions"><button id="qn-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`
          : host ? `<div class="go-actions">
              <button id="qn-again" class="btn btn-primary">🔁 Rejouer</button>
              <button id="qn-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="qn-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="qn-over-error" class="error-msg"></p>`
          : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    if (!host) return;
    $("qn-again") && ($("qn-again").onclick = () => api.action("start").then((r) => { if (r.error) $("qn-over-error").textContent = r.error; }));
    $("qn-to-setup") && ($("qn-to-setup").onclick = () => api.action("setup"));
    $("qn-finish").onclick = pl?.final ? () => api.action("finish") : finishGame;
  }

  function finishGame() {
    if (confirm("Terminer « Qui de nous ? » ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  CHRONO + ANIMATION DU TAMBOUR
  // ===================================================================
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!st) return;
    const fin = document.getElementById("qn-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const left = Math.max(0, endLocal - Date.now());
    const sec = document.getElementById("qn-sec");
    if (sec) {
      sec.textContent = st.phase === "reveal" ? "" : Math.ceil(left / 1000) + " s";
      sec.classList.toggle("urgent", st.phase !== "reveal" && left <= 5000);
    }
    const bar = document.getElementById("qn-bar");
    if (bar) {
      const total = (st.phase === "write" ? st.settings.writeTime : st.settings.voteTime) * 1000;
      bar.style.width = Math.min(100, (100 * left) / total) + "%";
    }
    // Cérémonie : tambour pendant 1,5 s, puis les résultats apparaissent.
    if (st.phase === "reveal") {
      const showRes = Date.now() - stepStartLocal >= DRUM_MS;
      const res = document.getElementById("qn-results"), drum = document.getElementById("qn-drum");
      if (res && showRes && res.classList.contains("hidden")) { res.classList.remove("hidden"); drum.classList.add("hidden"); }
    }
  }
})();
