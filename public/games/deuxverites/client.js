// ===================================================================
//  2 VÉRITÉS, 1 MENSONGE — Client (s'affiche dans le hub Le Bordel)
//  Thème -> 3 phrases dont 1 fausse -> un joueur à la fois : on vote
//  pour le mensonge -> révélation -> classement.
// ===================================================================

(() => {
  let api = null, root = null;
  let st = null;
  let rafId = null;
  let endLocal = 0, finishEndLocal = 0, stepStartLocal = 0;
  let shownPhase = null, shownKey = null;
  let myVote = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const DRUM_MS = 1500;
  const LETTERS = ["A", "B", "C"];

  window.GAMES.deuxverites = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl; st = null; shownPhase = shownKey = null;
      root.innerHTML = `<div id="dv-root"></div>`;
      api.setTheme("theme-sunset");
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
    const r = $("dv-root");
    r.innerHTML = st.phase === "setup" ? setupHtml() : `<div id="dv-${st.phase}"></div>`;
    if (st.phase === "setup") {
      $("dv-start").onclick = () => { $("dv-error").textContent = ""; api.action("start").then((x) => { if (x.error) $("dv-error").textContent = x.error; }); };
      $("dv-finish-setup").onclick = finishGame;
    }
    renderUpdate();
  }

  function renderUpdate() {
    if (st.phase === "setup") renderSetup();
    else if (st.phase === "write") renderWrite();
    else if (st.phase === "guess") renderGuess();
    else if (st.phase === "reveal") renderReveal();
    else renderOver();
  }

  const topHtml = (label, bar = true) => `
    <div class="qn-top"><span class="pill">${label}</span><span class="qn-sec" id="dv-sec"></span></div>
    ${bar ? '<div class="qn-bar"><i id="dv-bar"></i></div>' : ""}`;
  const roundLabel = () => `Manche ${st.round}/${st.settings.rounds}`;
  const themeHtml = (hint = false) => `<div class="s10-theme dv-theme"><div class="s10-theme-title">${esc(st.turn?.theme || st.theme.title)}</div>${hint ? `<div class="s10-scale">${esc(st.theme.hint)}</div>` : ""}</div>`;
  const authorHtml = (t) => `<div class="s10-author">${api.avatar(playerOf(t.id), "mini-avatar qn-big")}<b>${esc(pseudoOf(t.id))}</b>${t.id === me() ? " <span class='muted'>(toi)</span>" : ""}</div>`;
  const chipsHtml = (ids, doneIds) => `<div class="qn-who">${ids.map((id) =>
    `<span class="qn-chip ${doneIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))} ${esc(pseudoOf(id))}</span>`).join("")}</div>`;

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function setupHtml() {
    return `
      <div class="logo imp-logo">
        <span class="logo-icon">🤥</span>
        <h1>2 VÉRITÉS, 1 MENSONGE</h1>
        <p class="tagline">Tes potes te connaissent vraiment ?</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="dv-settings" class="settings"></div></div>
        <div class="card">
          <h2>📜 Règles</h2>
          <ul class="pt-help">
            <li>🎲 Un <b>thème</b> est proposé (ex. « Mes vacances ») : garde-le, pioche-en un autre 🎲 ou <b>écris le tien</b> (réglage).</li>
            <li>✍️ Chacun écrit <b>3 phrases sur lui</b> : 2 vraies, <b>1 fausse</b> (tu coches laquelle).</li>
            <li>🔍 Un joueur à la fois : ses phrases s'affichent dans le désordre, les autres <b>votent pour le mensonge</b>. Il peut se défendre au micro !</li>
            <li>🏆 <b>+1</b> si tu trouves le mensonge. L'auteur gagne <b>+1 par joueur piégé</b>.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="dv-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="dv-hint" class="muted"></p>
        <p id="dv-error" class="error-msg"></p>
        <button id="dv-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>`;
  }

  function renderSetup() {
    const s = st.settings, host = api.isHost();
    const panel = $("dv-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Les thèmes</label><div class="cat-chips">
        ${[["joueurs", "✍️ Chacun choisit le sien"], ["banque", "🎲 Le même pour tous"]].map(([v, label]) =>
          `<button class="cat-chip ${s.themes === v ? "on" : ""}" data-themes="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}
      </div></div>
      <div class="setting-block"><label>Manches (1 thème par manche)</label>${chips("rounds", [[1, "1"], [2, "2"], [3, "3"]])}</div>
      <div class="setting-block"><label>Temps pour écrire</label>${chips("writeTime", [[120, "2 min"], [180, "3 min"], [240, "4 min"]])}</div>
      <div class="setting-block"><label>Temps pour voter (par joueur)</label>${chips("guessTime", [[35, "35 s"], [50, "50 s"], [70, "70 s"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    if (host) panel.querySelectorAll("[data-themes]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { themes: b.dataset.themes } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("dv-start").style.display = host ? "" : "none";
    $("dv-start").disabled = n < 3;
    $("dv-finish-setup").classList.toggle("hidden", !host);
    $("dv-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("dv-hint").textContent = !host ? "En attente que l'hôte lance la partie…"
      : n < 3 ? `Il faut au moins 3 joueurs (${n}/3).` : `${n} joueurs · ~${Math.round((s.rounds * (s.writeTime * 0.8 + n * (s.guessTime * 0.8 + 9))) / 60)} min de jeu.`;
  }

  // ===================================================================
  //  1. ÉCRIRE SES 3 PHRASES
  // ===================================================================
  function renderWrite() {
    const box = $("dv-write");
    const key = "w" + st.round;
    const playing = st.who.includes(me());
    if (shownKey !== key) {
      shownKey = key;
      box.innerHTML = `
        ${topHtml("✍️ " + roundLabel())}
        ${themeHtml(true)}
        <div class="card s10-write dv-write">
          ${playing ? `
            ${st.settings.themes === "joueurs" ? `
              <div class="dv-mytheme">
                <label>🎯 Ton thème <span class="muted">(garde celui-ci, change-le ou 🎲)</span></label>
                <div class="qn-line"><input id="dv-theme-in" class="qn-input" maxlength="60" value="${esc(st.theme.title)}" autocomplete="off" />
                  <button id="dv-dice" class="btn btn-secondary qn-dice" title="Un autre thème">🎲</button></div>
              </div>` : ""}
            <h2 class="s10-h">3 phrases sur toi… dont une fausse 😏</h2>
            ${[0, 1, 2].map((i) => `
              <div class="dv-line">
                <input class="qn-input dv-input" maxlength="110" placeholder="${["J'ai déjà…", "Je suis…", "Une fois, j'ai…"][i]}" autocomplete="off" />
                <label class="dv-lie"><input type="radio" name="dv-lie" value="${i}" /><span>🤥 Mensonge</span></label>
              </div>`).join("")}
            <button id="dv-send" class="btn btn-primary btn-big">Envoyer</button>
            <p id="dv-msg" class="muted qn-write-msg"></p>`
            : `<h2>Tu regardes cette partie 👀</h2>`}
          <div id="dv-done"></div>
        </div>`;
      if (playing) {
        const inputs = [...box.querySelectorAll(".dv-input")];
        inputs[0].focus();
        // La ligne cochée « mensonge » est surlignée en rouge.
        box.querySelectorAll('input[name="dv-lie"]').forEach((r) => {
          r.onchange = () => box.querySelectorAll(".dv-line").forEach((l, i) => l.classList.toggle("is-lie", i === Number(r.value) && r.checked));
        });
        const send = () => {
          const lie = box.querySelector('input[name="dv-lie"]:checked');
          api.action("write", { lines: inputs.map((i) => i.value), lie: lie ? Number(lie.value) : -1, theme: $("dv-theme-in")?.value || "" }).then((r) => {
            const msg = $("dv-msg");
            if (msg) msg.textContent = r.error ? "⚠️ " + r.error : "✅ Envoyé ! Tu peux encore modifier et renvoyer.";
          });
        };
        $("dv-send").onclick = send;
        if ($("dv-dice")) $("dv-dice").onclick = () => api.action("random").then((r) => {
          if (!r.title) return;
          $("dv-theme-in").value = r.title;
          const hint = box.querySelector(".dv-theme .s10-scale"), title = box.querySelector(".dv-theme .s10-theme-title");
          if (title) title.textContent = r.title;
          if (hint) hint.textContent = r.hint;
        });
        if ($("dv-theme-in")) $("dv-theme-in").addEventListener("input", (e) => {
          const title = box.querySelector(".dv-theme .s10-theme-title"), hint = box.querySelector(".dv-theme .s10-scale");
          if (title) title.textContent = e.target.value || st.theme.title;
          if (hint) hint.textContent = "✍️ Ton propre thème";
        });
        inputs.forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); }));
      }
    }
    $("dv-done").innerHTML = chipsHtml(st.who, st.doneIds);
  }

  // ===================================================================
  //  2. VOTER POUR LE MENSONGE
  // ===================================================================
  function renderGuess() {
    const box = $("dv-guess"), t = st.turn;
    const key = "g" + st.round + "-" + t.num;
    const mine = t.id === me();
    const playing = st.who.includes(me()) && !mine;
    if (shownKey !== key) {
      shownKey = key; myVote = null;
      box.innerHTML = `
        ${topHtml(`🔍 ${roundLabel()} · Joueur ${t.num}/${t.total}`)}
        ${themeHtml()}
        ${authorHtml(t)}
        <p class="dv-ask">${mine ? "🎤 Ce sont tes phrases : <b>défends-toi</b> (ou embrouille-les) au micro !" : playing ? "🤥 Laquelle est le <b>mensonge</b> ? Clique dessus (tu peux changer d'avis)." : "👀 Tu regardes."}</p>
        <div class="dv-cards" id="dv-cards">${t.lines.map((l, i) => `
          <button class="dv-card" data-i="${i}" style="animation-delay:${i * 0.12}s" ${playing ? "" : "disabled"}>
            <span class="dv-letter">${LETTERS[i]}</span><span class="dv-text">${esc(l)}</span>
          </button>`).join("")}
        </div>
        <div id="dv-voted"></div>`;
      if (playing) box.querySelectorAll(".dv-card").forEach((b) => {
        b.onclick = () => {
          myVote = Number(b.dataset.i);
          box.querySelectorAll(".dv-card").forEach((c) => c.classList.toggle("mine", Number(c.dataset.i) === myVote));
          api.action("vote", { index: myVote });
        };
      });
    }
    $("dv-voted").innerHTML = chipsHtml(st.who.filter((id) => id !== t.id), t.votedIds);
  }

  // ===================================================================
  //  3. RÉVÉLATION
  // ===================================================================
  function renderReveal() {
    const box = $("dv-reveal"), t = st.turn;
    const key = "r" + st.round + "-" + t.num;
    stepStartLocal = Date.now() - t.elapsed;
    if (shownKey === key) return;
    shownKey = key;
    const fooled = t.gains[t.id] || 0;
    const found = Object.entries(t.votes).filter(([, v]) => v === t.lie).map(([id]) => id);
    box.innerHTML = `
      ${topHtml(`🎯 ${roundLabel()} · Joueur ${t.num}/${t.total}`, false)}
      ${themeHtml()}
      ${authorHtml(t)}
      <div class="s10-drum" id="dv-drum">🥁 🥁 🥁</div>
      <div class="hidden" id="dv-result">
        <div class="dv-cards">${t.lines.map((l, i) => {
          const voters = Object.entries(t.votes).filter(([, v]) => v === i).map(([id]) => api.avatar(playerOf(id))).join("");
          return `<div class="dv-card ${i === t.lie ? "lie" : "truth"}">
            <span class="dv-tag">${i === t.lie ? "🤥 MENSONGE" : "✅ VRAI"}</span>
            <span class="dv-text">${esc(l)}</span>
            <span class="dv-voters">${voters}</span>
          </div>`;
        }).join("")}</div>
        <p class="dv-verdict">${found.length ? `🎯 Trouvé par ${found.map((id) => `<b>${esc(pseudoOf(id))}</b>`).join(", ")} (+1)` : "😱 Personne n'a trouvé !"}
          · 🤥 <b>${esc(pseudoOf(t.id))}</b> a piégé <b>${fooled}</b> joueur${fooled > 1 ? "s" : ""} (+${fooled})</p>
      </div>
      <div class="lobby-actions" id="dv-host"></div>`;
    if (api.isHost()) {
      $("dv-host").innerHTML = `<button id="dv-next" class="btn btn-secondary">Suivant ▶</button>`;
      $("dv-next").onclick = () => api.action("next");
    }
  }

  // ===================================================================
  //  CLASSEMENT FINAL
  // ===================================================================
  function renderOver() {
    const box = $("dv-over");
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
        <h3 class="dv-recap-title">🤥 Les mensonges de la partie</h3>
        <div class="s10-recap">${st.history.map((h) => `
          <div class="s10-rround"><h3>${api.avatar(playerOf(h.id))} ${esc(pseudoOf(h.id))} · <span class="muted">${esc(h.theme)}</span></h3>
            <p>« ${esc(h.lines[h.lie])} »</p><p class="muted">a piégé ${h.fooled}/${h.voters}</p></div>`).join("")}
        </div>
        ${pl?.final
          ? `<p class="go-final">Classement dans <b id="dv-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
             ${host ? `<div class="go-actions"><button id="dv-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`
          : host ? `<div class="go-actions">
              <button id="dv-again" class="btn btn-primary">🔁 Rejouer</button>
              <button id="dv-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="dv-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="dv-over-error" class="error-msg"></p>`
          : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    if (!host) return;
    $("dv-again") && ($("dv-again").onclick = () => api.action("start").then((r) => { if (r.error) $("dv-over-error").textContent = r.error; }));
    $("dv-to-setup") && ($("dv-to-setup").onclick = () => api.action("setup"));
    $("dv-finish").onclick = pl?.final ? () => api.action("finish") : finishGame;
  }

  function finishGame() {
    if (confirm("Terminer « 2 vérités, 1 mensonge » ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  CHRONO + SUSPENSE
  // ===================================================================
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!st) return;
    const fin = $("dv-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const left = Math.max(0, endLocal - Date.now());
    const sec = $("dv-sec");
    if (sec) {
      sec.textContent = st.phase === "reveal" ? "" : Math.ceil(left / 1000) + " s";
      sec.classList.toggle("urgent", st.phase !== "reveal" && left <= 5000);
    }
    const bar = $("dv-bar");
    if (bar) bar.style.width = Math.min(100, (100 * left) / ((st.phase === "write" ? st.settings.writeTime : st.settings.guessTime) * 1000)) + "%";
    if (st.phase === "reveal") {
      const res = $("dv-result"), drum = $("dv-drum");
      if (res && res.classList.contains("hidden") && Date.now() - stepStartLocal >= DRUM_MS) { res.classList.remove("hidden"); drum.classList.add("hidden"); }
    }
  }
})();
