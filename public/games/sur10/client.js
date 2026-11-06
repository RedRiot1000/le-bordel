// ===================================================================
//  SUR 10 — Client (s'affiche dans le hub Le Bordel)
//  Vote du thème -> note secrète + indice -> on devine chaque joueur
//  -> révélation (réglette 0-10) -> classement.
// ===================================================================

(() => {
  let api = null, root = null;
  let st = null;
  let rafId = null;
  let endLocal = 0, finishEndLocal = 0, stepStartLocal = 0;
  let shownPhase = null, shownKey = null;
  let myNote = null;            // ma note secrète de la manche (gardée ici, jamais renvoyée par le serveur)
  let pickNote = null;          // note sélectionnée (écriture)
  let pickGuess = null;         // note sélectionnée (devinette)
  let sentGuess = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const DRUM_MS = 1300;          // suspense avant d'afficher la vraie note
  const THEME_S = 30;

  window.GAMES.sur10 = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl; st = null; shownPhase = shownKey = null; myNote = null;
      root.innerHTML = `<div id="s10-root"></div>`;
      api.setTheme("theme-violet");
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      endLocal = Date.now() + (st.left || 0);
      // Écran complet seulement au changement de phase ; le reste par petits bouts
      // (sinon ce qu'on tape s'efface et les animations se rejouent).
      if (st.phase !== shownPhase) { shownPhase = st.phase; shownKey = null; renderPhase(); }
      else renderUpdate();
    },
    unmount() { cancelAnimationFrame(rafId); root.innerHTML = ""; },
  };

  function renderPhase() {
    const r = $("s10-root");
    r.innerHTML = st.phase === "setup" ? setupHtml() : `<div id="s10-${st.phase}"></div>`;
    if (st.phase === "setup") {
      $("s10-start").onclick = () => { $("s10-error").textContent = ""; api.action("start").then((x) => { if (x.error) $("s10-error").textContent = x.error; }); };
      $("s10-finish-setup").onclick = finishGame;
    }
    renderUpdate();
  }

  function renderUpdate() {
    if (st.phase === "setup") renderSetup();
    else if (st.phase === "theme") renderTheme();
    else if (st.phase === "write") renderWrite();
    else if (st.phase === "guess") renderGuess();
    else if (st.phase === "reveal") renderReveal();
    else renderOver();
  }

  // Le haut de l'écran : étiquette + chrono + barre.
  const topHtml = (label, bar = true) => `
    <div class="qn-top"><span class="pill">${label}</span><span class="qn-sec" id="s10-sec"></span></div>
    ${bar ? '<div class="qn-bar"><i id="s10-bar"></i></div>' : ""}`;
  const roundLabel = () => `Manche ${st.round}/${st.settings.rounds}`;
  const chipsHtml = (ids, doneIds) => `<div class="qn-who">${ids.map((id) =>
    `<span class="qn-chip ${doneIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))} ${esc(pseudoOf(id))}</span>`).join("")}</div>`;
  const themeHtml = () => `<div class="s10-theme"><div class="s10-theme-title">${esc(st.theme.title)}</div><div class="s10-scale">${esc(st.theme.scale)}</div></div>`;
  const notesHtml = (cls, sel, disabled = false) => `<div class="s10-notes">${Array.from({ length: 11 }, (_, n) =>
    `<button class="s10-note ${cls} ${sel === n ? "on" : ""}" data-n="${n}" ${disabled ? "disabled" : ""}>${n}</button>`).join("")}</div>`;

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function setupHtml() {
    return `
      <div class="logo imp-logo">
        <span class="logo-icon">🔟</span>
        <h1>SUR 10</h1>
        <p class="tagline">Donne un exemple, les autres devinent ta note.</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="s10-settings" class="settings"></div></div>
        <div class="card">
          <h2>📜 Règles</h2>
          <ul class="pt-help">
            <li>🤫 Choisis une <b>note de 0 à 10</b>, en secret.</li>
            <li>💡 Écris un exemple qui vaut cette note pour toi. Thème « Un jeu vidéo », note 10 : « Rust ».</li>
            <li>🔍 Les autres <b>devinent ta note</b>.</li>
            <li>🏆 Plus tu es proche, plus tu marques.</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="s10-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="s10-hint" class="muted"></p>
        <p id="s10-error" class="error-msg"></p>
        <button id="s10-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>`;
  }

  function renderSetup() {
    const s = st.settings, host = api.isHost();
    const panel = $("s10-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Manches (1 thème par manche)</label>${chips("rounds", [[1, "1"], [2, "2"], [3, "3"], [5, "5"]])}</div>
      <div class="setting-block"><label>Temps pour la note + l'indice</label>${chips("writeTime", [[90, "90 s"], [120, "2 min"], [180, "3 min"]])}</div>
      <div class="setting-block"><label>Temps pour deviner (par joueur)</label>${chips("guessTime", [[30, "30 s"], [40, "40 s"], [60, "60 s"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("s10-start").style.display = host ? "" : "none";
    $("s10-start").disabled = n < 3;
    $("s10-finish-setup").classList.toggle("hidden", !host);
    $("s10-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("s10-hint").textContent = !host ? "En attente que l'hôte lance la partie…"
      : n < 3 ? `Il faut au moins 3 joueurs (${n}/3).` : `${n} joueurs · ~${Math.round((s.rounds * (THEME_S + s.writeTime * 0.7 + n * (s.guessTime * 0.7 + 10))) / 60)} min de jeu.`;
  }

  // ===================================================================
  //  1. VOTE DU THÈME
  // ===================================================================
  function renderTheme() {
    const box = $("s10-theme"), tv = st.themeVote;
    const key = "t" + st.round;
    const playing = st.who.includes(me());
    if (shownKey !== key) {
      shownKey = key;
      box.innerHTML = `
        ${topHtml("🗳️ " + roundLabel() + " · Choix du thème")}
        <h2 class="s10-h">Sur quel thème on joue ?</h2>
        <div class="s10-themes">${tv.choices.map((th, i) => `
          <button class="s10-tcard" data-i="${i}" style="animation-delay:${i * 0.1}s" ${playing ? "" : "disabled"}>
            <span class="s10-ttitle">${esc(th.title)}</span>
            <span class="s10-scale">${esc(th.scale)}</span>
            <span class="s10-tvotes" id="s10-tv-${i}"></span>
          </button>`).join("")}
        </div>
        <p class="qn-status" id="s10-tstatus"></p>`;
      box.querySelectorAll(".s10-tcard").forEach((b) => {
        b.onclick = () => api.action("theme", { index: Number(b.dataset.i) });
      });
    }
    // Seulement les votes (la carte ne rejoue pas son animation).
    const mine = tv.votes[me()];
    tv.choices.forEach((_, i) => {
      const voters = Object.entries(tv.votes).filter(([, v]) => v === i).map(([id]) => api.avatar(playerOf(id))).join("");
      $("s10-tv-" + i).innerHTML = voters;
      box.querySelector(`.s10-tcard[data-i="${i}"]`).classList.toggle("mine", mine === i);
    });
    $("s10-tstatus").textContent = !playing ? "👀 Tu regardes." : mine === undefined ? "👉 Clique sur un thème !" : "✅ Voté (tu peux changer d'avis)";
  }

  // ===================================================================
  //  2. NOTE SECRÈTE + INDICE
  // ===================================================================
  function renderWrite() {
    const box = $("s10-write");
    const key = "w" + st.round;
    const playing = st.who.includes(me());
    if (shownKey !== key) {
      shownKey = key; pickNote = null; myNote = null;
      box.innerHTML = `
        ${topHtml("✍️ " + roundLabel())}
        ${themeHtml()}
        <div class="card s10-write">
          ${playing ? `
            <h2 class="s10-h">1. Ta note secrète 🤫</h2>
            <div id="s10-wnotes">${notesHtml("w", null)}</div>
            <h2 class="s10-h">2. Ton indice</h2>
            <p class="muted">Un truc qui vaut <b id="s10-wn">ta note</b> pour toi. Personne ne verra ta note avant la révélation.</p>
            <div class="qn-line"><input id="s10-clue" class="qn-input" maxlength="80" placeholder="Ex. : Rust" autocomplete="off" /></div>
            <button id="s10-send" class="btn btn-primary btn-big">Envoyer</button>
            <p id="s10-wmsg" class="muted qn-write-msg"></p>`
            : `<h2>Tu regardes cette partie 👀</h2><p class="muted">Tu joueras à la prochaine.</p>`}
          <div id="s10-done"></div>
        </div>`;
      if (playing) {
        const bindNotes = () => box.querySelectorAll(".s10-note.w").forEach((b) => {
          b.onclick = () => {
            pickNote = Number(b.dataset.n);
            $("s10-wnotes").innerHTML = notesHtml("w", pickNote);
            $("s10-wn").textContent = pickNote + "/10";
            bindNotes();
            $("s10-clue").focus();
          };
        });
        bindNotes();
        const send = () => {
          if (pickNote === null) { $("s10-wmsg").textContent = "⚠️ Choisis d'abord ta note (0 à 10)."; return; }
          const note = pickNote;
          api.action("write", { note, clue: $("s10-clue").value }).then((r) => {
            if (!r.error) myNote = note;
            const msg = $("s10-wmsg");   // (disparu si l'écran est déjà passé à la suite)
            if (msg) msg.textContent = r.error ? "⚠️ " + r.error : `✅ Envoyé (${note}/10) ! Tu peux encore modifier et renvoyer.`;
          });
        };
        $("s10-send").onclick = send;
        $("s10-clue").addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
      }
    }
    $("s10-done").innerHTML = chipsHtml(st.who, st.doneIds);
  }

  // ===================================================================
  //  3. ON DEVINE UN JOUEUR
  // ===================================================================
  const clueHtml = (t) => `
    <div class="s10-clue">
      <div class="s10-author">${api.avatar(playerOf(t.id), "mini-avatar qn-big")}<b>${esc(pseudoOf(t.id))}</b><span class="muted">a écrit :</span></div>
      <div class="s10-clue-text">« ${esc(t.clue)} »</div>
    </div>`;

  function renderGuess() {
    const box = $("s10-guess"), t = st.turn;
    const key = "g" + st.round + "-" + t.num;
    const mineTurn = t.id === me();
    const playing = st.who.includes(me()) && !mineTurn;
    if (shownKey !== key) {
      shownKey = key; pickGuess = null; sentGuess = false;
      box.innerHTML = `
        ${topHtml("🔍 " + roundLabel() + " · Joueur " + t.num + "/" + t.total)}
        ${themeHtml()}
        ${clueHtml(t)}
        <div class="card s10-guessbox">
          ${mineTurn ? `<h2 class="s10-h">🤫 C'est ton indice !</h2>
              <p class="s10-mine">Les autres essaient de deviner ta note${myNote !== null ? ` (<b>${myNote}/10</b>)` : ""}. Ne dis rien… ou bluffe 😏</p>`
            : playing ? `<h2 class="s10-h">Quelle note a mis ${esc(pseudoOf(t.id))} ?</h2>
              <div id="s10-gnotes">${notesHtml("g", null)}</div>
              <button id="s10-gsend" class="btn btn-primary btn-big" disabled>Valider</button>
              <p id="s10-gmsg" class="muted qn-write-msg"></p>`
            : `<h2 class="s10-h">👀 Tu regardes.</h2>`}
          <div id="s10-guessed"></div>
        </div>`;
      if (playing) {
        const bindNotes = () => box.querySelectorAll(".s10-note.g").forEach((b) => {
          b.onclick = () => {
            if (sentGuess) return;
            pickGuess = Number(b.dataset.n);
            $("s10-gnotes").innerHTML = notesHtml("g", pickGuess);
            $("s10-gsend").disabled = false;
            $("s10-gsend").textContent = `Valider ${pickGuess}/10`;
            bindNotes();
          };
        });
        bindNotes();
        $("s10-gsend").onclick = () => {
          if (pickGuess === null || sentGuess) return;
          sentGuess = true;
          $("s10-gsend").disabled = true;
          $("s10-gnotes").innerHTML = notesHtml("g", pickGuess, true);
          api.action("guess", { value: pickGuess }).then((r) => {
            const msg = $("s10-gmsg");
            if (msg) msg.textContent = r.error ? "⚠️ " + r.error : `✅ Tu as dit ${pickGuess}/10. Attends les autres…`;
          });
        };
      }
    }
    $("s10-guessed").innerHTML = chipsHtml(st.who.filter((id) => id !== t.id), t.guessedIds);
  }

  // ===================================================================
  //  4. RÉVÉLATION (réglette 0 → 10)
  // ===================================================================
  function renderReveal() {
    const box = $("s10-reveal"), t = st.turn;
    const key = "r" + st.round + "-" + t.num;
    stepStartLocal = Date.now() - t.elapsed;
    if (shownKey === key) return;   // déjà affichée : on garde l'animation
    shownKey = key;
    // Les devineurs rangés par case de la réglette.
    const byCell = Array.from({ length: 11 }, () => []);
    for (const [id, v] of Object.entries(t.guesses)) byCell[v].push(id);
    const rows = Object.entries(t.guesses).sort((a, b) => Math.abs(a[1] - t.note) - Math.abs(b[1] - t.note));
    const authorGain = t.gains[t.id] || 0;
    box.innerHTML = `
      ${topHtml("🎯 " + roundLabel() + " · Joueur " + t.num + "/" + t.total, false)}
      ${themeHtml()}
      ${clueHtml(t)}
      <div class="s10-drum" id="s10-drum">🥁 🥁 🥁</div>
      <div class="s10-result hidden" id="s10-result">
        <div class="s10-ruler">${byCell.map((ids, n) => `
          <div class="s10-cell ${n === t.note ? "true" : ""}">
            <div class="s10-cnum">${n}</div>
            <div class="s10-cguess">${ids.map((id) => api.avatar(playerOf(id))).join("")}</div>
          </div>`).join("")}
        </div>
        <div class="s10-verdict">${esc(pseudoOf(t.id))} avait mis <b class="s10-big">${t.note}/10</b></div>
        <ul class="s10-rows">
          ${rows.map(([id, v]) => `<li>${api.avatar(playerOf(id))}<span class="name">${esc(pseudoOf(id))}</span>
            <span class="muted">a dit</span> <b>${v}</b><span class="gain ${t.gains[id] ? "" : "zero"}">+${t.gains[id] || 0}</span></li>`).join("") || '<li class="muted">Personne n\'a deviné…</li>'}
          <li class="author">✍️ ${api.avatar(playerOf(t.id))}<span class="name">${esc(pseudoOf(t.id))}</span>
            <span class="muted">${authorGain ? "bon indice !" : "personne n'a trouvé 😅"}</span><span class="gain ${authorGain ? "" : "zero"}">+${authorGain}</span></li>
        </ul>
      </div>
      <div class="lobby-actions" id="s10-host"></div>`;
    if (api.isHost()) {
      $("s10-host").innerHTML = `<button id="s10-next" class="btn btn-secondary">Suivant ▶</button>`;
      $("s10-next").onclick = () => api.action("next");
    }
  }

  // ===================================================================
  //  CLASSEMENT FINAL
  // ===================================================================
  function renderOver() {
    const box = $("s10-over");
    const host = api.isHost();
    const pl = st.playlist;
    if (pl?.final) finishEndLocal = Date.now() + pl.finishLeft;
    const key = "o" + st.history.length + host + !!pl?.final;
    if (shownKey === key) return;
    shownKey = key;
    const sorted = [...st.who].sort((a, b) => (playerOf(b)?.score || 0) - (playerOf(a)?.score || 0));
    const medal = (i) => ["🥇", "🥈", "🥉"][i] || `${i + 1}.`;
    // Le récap : par manche, les indices et leurs notes.
    const rounds = [];
    for (const h of st.history) (rounds[h.round - 1] ||= { theme: h.theme, list: [] }).list.push(h);
    box.innerHTML = `
      <div class="card qn-over">
        <h2 class="go-banner">🏆 Classement</h2>
        <ol class="s10-rank">${sorted.map((id, i) => `
          <li style="animation-delay:${i * 0.12}s"><span class="s10-medal">${medal(i)}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="gain">${playerOf(id)?.score || 0} pts</span></li>`).join("")}
        </ol>
        <div class="s10-recap">${rounds.filter(Boolean).map((r) => `
          <div class="s10-rround"><h3>${esc(r.theme)}</h3>
            <ul>${r.list.map((h) => `<li>${api.avatar(playerOf(h.id))}<span>${esc(pseudoOf(h.id))}</span><i>« ${esc(h.clue)} »</i><b>${h.note}/10</b></li>`).join("")}</ul>
          </div>`).join("")}
        </div>
        ${pl?.final
          ? `<p class="go-final">Classement dans <b id="s10-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
             ${host ? `<div class="go-actions"><button id="s10-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`
          : host ? `<div class="go-actions">
              <button id="s10-again" class="btn btn-primary">🔁 Rejouer</button>
              <button id="s10-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="s10-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="s10-over-error" class="error-msg"></p>`
          : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    if (!host) return;
    $("s10-again") && ($("s10-again").onclick = () => api.action("start").then((r) => { if (r.error) $("s10-over-error").textContent = r.error; }));
    $("s10-to-setup") && ($("s10-to-setup").onclick = () => api.action("setup"));
    $("s10-finish").onclick = pl?.final ? () => api.action("finish") : finishGame;
  }

  function finishGame() {
    if (confirm("Terminer « Sur 10 » ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  CHRONO + SUSPENSE DE LA RÉVÉLATION
  // ===================================================================
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!st) return;
    const fin = $("s10-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const left = Math.max(0, endLocal - Date.now());
    const sec = $("s10-sec");
    if (sec) {
      sec.textContent = st.phase === "reveal" ? "" : Math.ceil(left / 1000) + " s";
      sec.classList.toggle("urgent", st.phase !== "reveal" && left <= 5000);
    }
    const bar = $("s10-bar");
    if (bar) {
      const total = (st.phase === "theme" ? THEME_S : st.phase === "write" ? st.settings.writeTime : st.settings.guessTime) * 1000;
      bar.style.width = Math.min(100, (100 * left) / total) + "%";
    }
    if (st.phase === "reveal") {
      const res = $("s10-result"), drum = $("s10-drum");
      if (res && res.classList.contains("hidden") && Date.now() - stepStartLocal >= DRUM_MS) { res.classList.remove("hidden"); drum.classList.add("hidden"); }
    }
  }
})();
