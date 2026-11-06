// ===================================================================
//  PENSE PAREIL — Client (s'affiche dans le hub Le Bordel)
//  Thème -> chacun écrit une réponse -> révélation par paquets identiques
//  (l'hôte peut fusionner deux paquets) -> thème suivant -> classement.
// ===================================================================

(() => {
  let api = null, root = null;
  let st = null;
  let rafId = null;
  let endLocal = 0, finishEndLocal = 0;
  let shownPhase = null, shownKey = null;
  let picked = null;            // hôte : premier paquet cliqué pour une fusion

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";

  window.GAMES.pensepareil = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl; st = null; shownPhase = shownKey = null; picked = null;
      root.innerHTML = `<div id="pp-root"></div>`;
      api.setTheme("theme-candy");
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      endLocal = Date.now() + (st.left || 0);
      if (st.phase !== shownPhase) { shownPhase = st.phase; shownKey = null; renderPhase(); }
      else renderUpdate();
    },
    unmount() { cancelAnimationFrame(rafId); root.innerHTML = ""; },
  };

  function renderPhase() {
    const r = $("pp-root");
    r.innerHTML = st.phase === "setup" ? setupHtml() : `<div id="pp-${st.phase}"></div>`;
    if (st.phase === "setup") {
      $("pp-start").onclick = () => { $("pp-error").textContent = ""; api.action("start").then((x) => { if (x.error) $("pp-error").textContent = x.error; }); };
      $("pp-finish-setup").onclick = finishGame;
    }
    renderUpdate();
  }

  function renderUpdate() {
    if (st.phase === "setup") renderSetup();
    else if (st.phase === "propose") renderPropose();
    else if (st.phase === "answer") renderAnswer();
    else if (st.phase === "reveal") renderReveal();
    else renderOver();
  }

  const topHtml = (label) => `
    <div class="qn-top"><span class="pill">${label}</span><span class="qn-sec" id="pp-sec"></span></div>
    <div class="qn-bar"><i id="pp-bar"></i></div>`;
  const promptHtml = () => `<div class="s10-theme pp-prompt"><div class="s10-theme-title">${esc(st.prompt)}</div>
    ${st.promptBy ? `<div class="pp-by">✍️ Thème de ${api.avatar(playerOf(st.promptBy))} <b>${esc(pseudoOf(st.promptBy))}</b></div>` : ""}</div>`;

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function setupHtml() {
    return `
      <div class="logo imp-logo">
        <span class="logo-icon">🧠</span>
        <h1>PENSE PAREIL</h1>
        <p class="tagline">Ne sois pas original : pense comme les autres !</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="pp-settings" class="settings"></div></div>
        <div class="card">
          <h2>📜 Règles</h2>
          <ul class="pt-help">
            <li>✍️ Au début, <b>chacun écrit ses thèmes</b> (🎲 pour en piocher un), ou on prend la banque de thèmes (réglage).</li>
            <li>💭 Un thème s'affiche, par exemple <b>« Un truc rouge »</b>.</li>
            <li>✍️ Chacun écrit <b>une seule réponse</b>, en secret.</li>
            <li>🤝 Tu marques <b>1 point par joueur</b> qui a écrit la même chose que toi. Seul dans ton coin = 0.</li>
            <li>🔗 « Le chat », « chats » et « Chat » comptent pareil. L'hôte peut aussi <b>fusionner</b> deux réponses après débat.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="pp-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="pp-hint" class="muted"></p>
        <p id="pp-error" class="error-msg"></p>
        <button id="pp-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>`;
  }

  function renderSetup() {
    const s = st.settings, host = api.isHost();
    const panel = $("pp-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Les thèmes</label><div class="cat-chips">
        ${[["joueurs", "✍️ Écrits par les joueurs"], ["banque", "📚 Banque de thèmes"]].map(([v, label]) =>
          `<button class="cat-chip ${s.themes === v ? "on" : ""}" data-themes="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}
      </div></div>
      <div class="setting-block"><label>Nombre de thèmes</label>${chips("rounds", [[5, "5"], [8, "8"], [12, "12"]])}</div>
      <div class="setting-block"><label>Temps pour répondre</label>${chips("answerTime", [[45, "45 s"], [60, "60 s"], [90, "90 s"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    if (host) panel.querySelectorAll("[data-themes]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { themes: b.dataset.themes } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("pp-start").style.display = host ? "" : "none";
    $("pp-start").disabled = n < 3;
    $("pp-finish-setup").classList.toggle("hidden", !host);
    $("pp-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("pp-hint").textContent = !host ? "En attente que l'hôte lance la partie…"
      : n < 3 ? `Il faut au moins 3 joueurs (${n}/3).` : `${n} joueurs · ~${Math.round((s.rounds * (s.answerTime * 0.7 + 15)) / 60)} min de jeu.`;
  }

  // ===================================================================
  //  0. CHACUN ÉCRIT SES THÈMES (mode « joueurs »)
  // ===================================================================
  function renderPropose() {
    const box = $("pp-propose");
    const playing = st.who.includes(me());
    if (shownKey !== "p") {
      shownKey = "p";
      const n = st.perPlayer;
      box.innerHTML = `
        ${topHtml("✍️ Vos thèmes")}
        <div class="card s10-write">
          ${playing ? `
            <h2 class="s10-h">Écris ${n > 1 ? `tes ${n} thèmes` : "ton thème"} 💭</h2>
            <p class="muted">Un thème auquel tout le monde peut répondre en un mot : « Un truc rouge », « Un prénom de chien », « Un jeu de notre enfance »… Tu joueras aussi dessus ! (🎲 = un thème au hasard)</p>
            ${Array.from({ length: n }, (_, i) => `
              <div class="qn-line">
                <input class="qn-input pp-theme-in" maxlength="60" placeholder="Un truc qui…" autocomplete="off" />
                <button class="btn btn-secondary qn-dice" data-i="${i}" title="Thème au hasard">🎲</button>
              </div>`).join("")}
            <button id="pp-psend" class="btn btn-primary btn-big">Envoyer</button>
            <p id="pp-pmsg" class="muted qn-write-msg"></p>`
            : `<h2>Tu regardes cette partie 👀</h2>`}
          <div id="pp-pdone"></div>
        </div>`;
      if (playing) {
        const inputs = [...box.querySelectorAll(".pp-theme-in")];
        inputs[0].focus();
        box.querySelectorAll(".qn-dice").forEach((b) => {
          b.onclick = () => api.action("random").then((r) => { if (r.text) inputs[Number(b.dataset.i)].value = r.text; });
        });
        const send = () => api.action("propose", { texts: inputs.map((i) => i.value) }).then((r) => {
          const msg = $("pp-pmsg");
          if (msg) msg.textContent = r.error ? "⚠️ " + r.error : "✅ Envoyé ! Tu peux encore modifier et renvoyer.";
        });
        $("pp-psend").onclick = send;
        inputs.forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); }));
      }
    }
    $("pp-pdone").innerHTML = `<div class="qn-who">${st.who.map((id) =>
      `<span class="qn-chip ${st.doneIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))} ${esc(pseudoOf(id))}</span>`).join("")}</div>`;
  }

  // ===================================================================
  //  1. RÉPONDRE
  // ===================================================================
  function renderAnswer() {
    const box = $("pp-answer");
    const key = "a" + st.round;
    const playing = st.who.includes(me());
    if (shownKey !== key) {
      shownKey = key;
      box.innerHTML = `
        ${topHtml(`💭 Thème ${st.round}/${st.rounds}`)}
        ${promptHtml()}
        <div class="card s10-write">
          ${playing ? `
            <h2 class="s10-h">Ta réponse (pense comme les autres !)</h2>
            <div class="qn-line"><input id="pp-input" class="qn-input" maxlength="40" placeholder="Ta réponse…" autocomplete="off" /></div>
            <button id="pp-send" class="btn btn-primary btn-big">Envoyer</button>
            <p id="pp-msg" class="muted qn-write-msg"></p>`
            : `<h2>Tu regardes cette partie 👀</h2>`}
          <div id="pp-done"></div>
        </div>`;
      if (playing) {
        const input = $("pp-input");
        input.focus();
        const send = () => api.action("answer", { text: input.value }).then((r) => {
          const msg = $("pp-msg");
          if (msg) msg.textContent = r.error ? "⚠️ " + r.error : "✅ Envoyé ! Tu peux encore changer et renvoyer.";
        });
        $("pp-send").onclick = send;
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
      }
    }
    $("pp-done").innerHTML = `<div class="qn-who">${st.who.map((id) =>
      `<span class="qn-chip ${st.doneIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))} ${esc(pseudoOf(id))}</span>`).join("")}</div>`;
  }

  // ===================================================================
  //  2. RÉVÉLATION (les paquets de réponses identiques)
  // ===================================================================
  function renderReveal() {
    const box = $("pp-reveal");
    const key = "r" + st.round;
    const host = api.isHost();
    const first = shownKey !== key;   // 1er affichage : avec animations ; après une fusion : sans
    if (first) { shownKey = key; picked = null; }
    if (picked && !st.groups.some((g) => g.key === picked)) picked = null;
    const max = Math.max(...st.groups.map((g) => g.ids.length), 1);
    box.classList.toggle("noanim", !first);
    box.innerHTML = `
      ${topHtml(`🔍 Thème ${st.round}/${st.rounds} · Révélation`)}
      ${promptHtml()}
      <div class="pp-groups ${first ? "" : "noanim"}">${st.groups.map((g, i) => `
        <button class="pp-group ${g.ids.length === max && max > 1 ? "best" : ""} ${g.ids.length === 1 ? "alone" : ""} ${picked === g.key ? "picked" : ""}"
          data-key="${esc(g.key)}" style="animation-delay:${i * 0.12}s" ${host ? "" : "disabled"}>
          <span class="pp-count">${g.ids.length > 1 ? "×" + g.ids.length : "seul"}</span>
          <span class="pp-label">${esc(g.label)}</span>
          <span class="pp-who">${g.ids.map((id) => `<span class="pp-p" title="${esc(g.answers[id])}">${api.avatar(playerOf(id))}<small>${esc(pseudoOf(id))}</small></span>`).join("")}</span>
          <span class="pp-pts">${g.ids.length > 1 ? `+${g.ids.length - 1} chacun` : "+0"}</span>
        </button>`).join("") || '<p class="muted">Personne n\'a répondu 😴</p>'}
      </div>
      ${(() => { const silent = st.who.filter((id) => !st.groups.some((g) => g.ids.includes(id))); return silent.length ? `<p class="muted pp-silent">😶 Pas de réponse : ${silent.map((id) => esc(pseudoOf(id))).join(", ")}</p>` : ""; })()}
      ${host ? `<p class="pp-merge-hint">${picked ? "🔗 Clique sur la réponse avec laquelle fusionner (ou re-clique pour annuler)." : "🔗 Deux réponses veulent dire la même chose ? Clique sur l'une puis sur l'autre pour les fusionner."}</p>
        <div class="lobby-actions"><button id="pp-next" class="btn btn-secondary">Suivant ▶</button><p id="pp-err" class="error-msg"></p></div>` : ""}`;
    if (!host) return;
    $("pp-next").onclick = () => api.action("next");
    box.querySelectorAll(".pp-group").forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.key;
        if (!picked) { picked = k; renderReveal(); return; }
        if (picked === k) { picked = null; renderReveal(); return; }
        const from = picked;
        picked = null;
        api.action("merge", { from, into: k }).then((r) => { if (r.error && $("pp-err")) $("pp-err").textContent = r.error; });
      };
    });
  }

  // ===================================================================
  //  CLASSEMENT FINAL
  // ===================================================================
  function renderOver() {
    const box = $("pp-over");
    const host = api.isHost();
    const pl = st.playlist;
    if (pl?.final) finishEndLocal = Date.now() + pl.finishLeft;
    const key = "o" + st.history.length + host + !!pl?.final;
    if (shownKey === key) return;
    shownKey = key;
    const sorted = [...st.who].sort((a, b) => (playerOf(b)?.score || 0) - (playerOf(a)?.score || 0));
    const medal = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
    box.innerHTML = `
      <div class="card qn-over">
        <h2 class="go-banner">🏆 Classement</h2>
        <ol class="s10-rank">${sorted.map((id, i) => `
          <li style="animation-delay:${i * 0.12}s"><span class="s10-medal">${medal(i)}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="gain">${playerOf(id)?.score || 0} pts</span></li>`).join("")}
        </ol>
        <div class="s10-recap">${st.history.map((h) => {
          const top = h.groups[0];
          return `<div class="s10-rround"><h3>${esc(h.prompt)}</h3>
            <p>${top ? `🤝 <b>${esc(top.label)}</b> ×${top.ids.length}` : "😴"}${h.groups.length > 1 ? ` <span class="muted">· ${h.groups.length} réponses différentes</span>` : ""}</p></div>`;
        }).join("")}
        </div>
        ${pl?.final
          ? `<p class="go-final">Classement dans <b id="pp-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
             ${host ? `<div class="go-actions"><button id="pp-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`
          : host ? `<div class="go-actions">
              <button id="pp-again" class="btn btn-primary">🔁 Rejouer</button>
              <button id="pp-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="pp-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="pp-over-error" class="error-msg"></p>`
          : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    if (!host) return;
    $("pp-again") && ($("pp-again").onclick = () => api.action("start").then((r) => { if (r.error) $("pp-over-error").textContent = r.error; }));
    $("pp-to-setup") && ($("pp-to-setup").onclick = () => api.action("setup"));
    $("pp-finish").onclick = pl?.final ? () => api.action("finish") : finishGame;
  }

  function finishGame() {
    if (confirm("Terminer « Pense pareil » ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  CHRONO
  // ===================================================================
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!st) return;
    const fin = $("pp-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const left = Math.max(0, endLocal - Date.now());
    const sec = $("pp-sec");
    if (sec) { sec.textContent = Math.ceil(left / 1000) + " s"; sec.classList.toggle("urgent", st.phase === "answer" && left <= 5000); }
    const bar = $("pp-bar");
    const total = st.phase === "answer" ? st.settings.answerTime : st.phase === "propose" ? 60 + 40 * (st.perPlayer || 1) : 20;
    if (bar) bar.style.width = Math.min(100, (100 * left) / (total * 1000)) + "%";
  }
})();
