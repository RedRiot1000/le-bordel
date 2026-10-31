// ===================================================================
//  IMPOSTER — Client (s'affiche dans le hub Le Bordel)
// ===================================================================

(() => {
  let api = null;
  let root = null;
  let st = null;        // état public du jeu reçu du serveur
  let myRole = null;    // { word, isMrWhite, role, allies }
  let myVote = null;    // mon vote en cours (id de la cible)
  let timerLoop = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const pseudoOf = (id) => st.players.find((p) => p.id === id)?.pseudo || "?";
  const playerOf = (id) => st.players.find((p) => p.id === id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const send = (type, data) => api.action(type, data);

  // Minuteurs (en secondes).
  const TIMER_STEP = 15;
  const TIMER_MIN = 5;
  const TIMER_MAX = 600;

  const PHASE_LABELS = {
    clues: "🗣️ Tour d'indices",
    vote: "🗳️ Vote",
    mrwhite_guess: "🕵️ Devinette de Mr White",
    result: "📢 Résultat",
    gameOver: "🏁 Fin de la manche",
  };

  // ===================================================================
  //  SQUELETTE HTML
  // ===================================================================
  const TEMPLATE = `
    <!-- Réglages avant la 1re manche -->
    <div id="imp-setup" class="hidden">
      <div class="logo imp-logo">
        <span class="logo-icon">🕵️</span>
        <h1>IMPOSTER</h1>
        <p class="tagline">Un mot. Un intrus. Démasquez-le.</p>
      </div>
      <div class="card">
        <h2>⚙️ Réglages</h2>
        <div id="settings-panel" class="settings"></div>
      </div>
      <div class="lobby-actions">
        <button id="imp-start" class="btn btn-primary btn-big">Lancer la manche</button>
        <p id="imp-hint" class="muted"></p>
        <p id="imp-setup-error" class="error-msg"></p>
        <button id="imp-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>
    </div>

    <!-- Partie en cours -->
    <div id="imp-play" class="hidden">
      <div class="game-topbar">
        <span class="pill" id="game-round">Manche 1</span>
        <span class="phase-label" id="game-phase">—</span>
        <span id="timer-pill" class="timer-pill hidden">⏱️ —</span>
        <button id="btn-scores" class="btn btn-ghost">🏆 Scores</button>
      </div>
      <div id="secret-card" class="secret-card"></div>
      <div id="players-strip" class="players-strip"></div>
      <div id="action-zone" class="action-zone"></div>

      <div id="scoreboard" class="scoreboard hidden">
        <div class="scoreboard-inner card">
          <h2>🏆 Scores Imposter</h2>
          <ul id="scoreboard-list"></ul>
          <p class="muted">À la fin du jeu, ce classement donne les points de soirée.</p>
          <br />
          <button id="btn-close-scores" class="btn btn-secondary">Fermer</button>
        </div>
      </div>
    </div>`;

  // ===================================================================
  //  BRANCHEMENT DANS LE HUB
  // ===================================================================
  window.GAMES.imposter = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl;
      st = null; myRole = null; myVote = null;
      root.innerHTML = TEMPLATE;

      $("imp-start").onclick = () => {
        $("imp-setup-error").textContent = "";
        send("start").then((r) => { if (r.error) $("imp-setup-error").textContent = r.error; });
      };
      $("imp-finish-setup").onclick = finishGame;
      $("btn-scores").onclick = showScores;
      $("btn-close-scores").onclick = () => $("scoreboard").classList.add("hidden");

      timerLoop = setInterval(tickTimer, 250);
    },

    update(state) {
      const prevPhase = st?.phase;
      st = state;
      api.setTheme(st.theme);
      if (st.phase === "setup") {
        myRole = null;
        $("imp-play").classList.add("hidden");
        $("imp-setup").classList.remove("hidden");
        // On ne redessine pas les réglages pendant que l'hôte tape dans une case.
        if (!document.activeElement?.classList.contains("num-input")) renderSettings();
        renderStartArea();
      } else {
        if (st.phase === "vote" && prevPhase !== "vote") myVote = null;
        $("imp-setup").classList.add("hidden");
        $("imp-play").classList.remove("hidden");
        renderGame();
      }
    },

    message(type, payload) {
      if (type !== "yourRole") return;
      myRole = payload;
      if (st && st.phase !== "setup") renderGame();
    },

    unmount() {
      clearInterval(timerLoop);
      root.innerHTML = "";
    },
  };

  function finishGame() {
    if (confirm("Terminer Imposter ? Le classement actuel donne les points de soirée.")) send("finish");
  }

  // ===================================================================
  //  RÉGLAGES (hôte)
  // ===================================================================
  function renderSettings() {
    const s = st.settings;
    const host = api.isHost();
    const panel = $("settings-panel");
    panel.className = "settings" + (host ? "" : " locked");

    const stepper = (key, value, min, max) => `
      <div class="stepper" data-key="${key}">
        <button data-act="dec" ${!host || value <= min ? "disabled" : ""}>−</button>
        <span class="num">${value}</span>
        <button data-act="inc" ${!host || value >= max ? "disabled" : ""}>+</button>
      </div>`;

    // Minuteur : boutons de 15 en 15 + case où l'on tape le nombre soi-même.
    const timerField = (key, value) => `
      <div class="stepper timer-field" data-timer="${key}">
        <button data-step="-${TIMER_STEP}" ${!host || value <= TIMER_MIN ? "disabled" : ""}>−${TIMER_STEP}</button>
        <input class="num-input" type="number" inputmode="numeric" min="${TIMER_MIN}" max="${TIMER_MAX}"
               value="${value}" ${host ? "" : "disabled"} title="Tape un nombre de secondes puis Entrée" />
        <span class="unit">s</span>
        <button data-step="${TIMER_STEP}" ${!host || value >= TIMER_MAX ? "disabled" : ""}>+${TIMER_STEP}</button>
      </div>`;

    const toggle = (key, checked) => `
      <label class="switch">
        <input type="checkbox" data-key="${key}" ${checked ? "checked" : ""} ${host ? "" : "disabled"} />
        <span class="track"></span>
      </label>`;

    panel.innerHTML = `
      <div class="setting"><label>Nombre d'Undercover</label><div class="val">${stepper("undercoverCount", s.undercoverCount, 1, 4)}</div></div>
      <div class="setting"><label>Mr White activé</label><div class="val">${toggle("mrWhiteEnabled", s.mrWhiteEnabled)}</div></div>
      ${s.mrWhiteEnabled ? `<div class="setting"><label>Nombre de Mr White</label><div class="val">${stepper("mrWhiteCount", s.mrWhiteCount, 1, 2)}</div></div>` : ""}
      <div class="setting"><label>Rôles cachés</label><div class="val">${toggle("roleHidden", s.roleReveal === "hidden")}</div></div>
      <div class="setting"><label>Les imposteurs se connaissent</label><div class="val">${toggle("impostorsKnowEachOther", s.impostorsKnowEachOther)}</div></div>
      <div class="setting"><label>Tours d'indices</label><div class="val">${stepper("clueRounds", s.clueRounds, 1, 6)}</div></div>
      <div class="setting"><label>Mode Chaos 🌀</label><div class="val">${toggle("chaosMode", s.chaosMode)}</div></div>
      <div class="setting"><label>Minuteur activé</label><div class="val">${toggle("timersEnabled", s.timers.enabled)}</div></div>
      ${s.timers.enabled ? `
        <div class="setting"><label>⏱️ Temps par indice</label><div class="val">${timerField("clue", s.timers.clue)}</div></div>
        <div class="setting"><label>⏱️ Temps pour voter</label><div class="val">${timerField("vote", s.timers.vote)}</div></div>
        <div class="setting"><label>⏱️ Temps de devinette</label><div class="val">${timerField("guess", s.timers.guess)}</div></div>
      ` : ""}

      <div class="setting-block">
        <label>Catégories de mots</label>
        <div class="cat-chips">
          ${(st.allCategories || []).map((c) => {
            const on = s.categories.includes(c);
            return `<button class="cat-chip ${on ? "on" : ""}" data-cat="${esc(c)}" ${host ? "" : "disabled"}>${esc(c)}</button>`;
          }).join("")}
        </div>
      </div>

      <details class="scoring-block">
        <summary>🏆 Barème de points (internes à Imposter)</summary>
        <div class="setting"><label>Victoire des civils</label><div class="val">${stepper("score_civilWin", s.scoring.civilWin, 0, 20)}</div></div>
        <div class="setting"><label>Undercover gagnant</label><div class="val">${stepper("score_undercoverWin", s.scoring.undercoverWin, 0, 20)}</div></div>
        <div class="setting"><label>Mr White devine</label><div class="val">${stepper("score_mrWhiteGuess", s.scoring.mrWhiteGuess, 0, 20)}</div></div>
        <div class="setting"><label>Mr White survit</label><div class="val">${stepper("score_mrWhiteSurvive", s.scoring.mrWhiteSurvive, 0, 20)}</div></div>
        <div class="setting"><label>Bonus bon vote</label><div class="val">${stepper("score_voteBonus", s.scoring.voteBonus, 0, 10)}</div></div>
      </details>

      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}
    `;

    if (!host) return;

    panel.querySelectorAll(".stepper[data-key]").forEach((el) => {
      el.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => applySettingChange(el.dataset.key, btn.dataset.act === "inc" ? 1 : -1);
      });
    });

    // Minuteurs : boutons ±15 et saisie libre (validée par Entrée ou en quittant la case).
    panel.querySelectorAll(".timer-field").forEach((el) => {
      const key = el.dataset.timer;
      const input = el.querySelector("input");
      el.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => setTimer(key, st.settings.timers[key] + Number(btn.dataset.step));
      });
      // En quittant la case (clic ailleurs, Tab ou Entrée), on envoie ce qui a été tapé.
      input.onblur = () => {
        if (input.value !== String(st.settings.timers[key])) setTimer(key, Number(input.value));
      };
      input.onkeydown = (e) => { if (e.key === "Enter") input.blur(); };
      input.onfocus = () => input.select();
    });
    panel.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.onchange = () => applyToggleChange(cb.dataset.key, cb.checked);
    });
    panel.querySelectorAll(".cat-chip").forEach((chip) => {
      chip.onclick = () => {
        const cat = chip.dataset.cat;
        const cur = st.settings.categories;
        let next = cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat];
        if (next.length === 0) next = [cat];   // au moins une catégorie
        send("settings", { settings: { categories: next } });
      };
    });
  }

  function applySettingChange(key, delta) {
    const s = st.settings;
    const patch = {};

    if (key.startsWith("score_")) {
      const field = key.slice(6);
      patch.scoring = { ...s.scoring, [field]: clamp(s.scoring[field] + delta, 0, 20) };
      send("settings", { settings: patch });
      return;
    }
    switch (key) {
      case "undercoverCount": patch.undercoverCount = clamp(s.undercoverCount + delta, 1, 4); break;
      case "mrWhiteCount":    patch.mrWhiteCount = clamp(s.mrWhiteCount + delta, 1, 2); break;
      case "clueRounds":      patch.clueRounds = clamp(s.clueRounds + delta, 1, 6); break;
    }
    send("settings", { settings: patch });
  }

  // Change un minuteur (en secondes, borné entre TIMER_MIN et TIMER_MAX).
  function setTimer(key, value) {
    // (case vide ou n'importe quoi tapé -> on garde l'ancienne valeur)
    const v = value > 0 ? clamp(Math.round(value), TIMER_MIN, TIMER_MAX) : st.settings.timers[key];
    send("settings", { settings: { timers: { ...st.settings.timers, [key]: v } } });
  }

  function applyToggleChange(key, checked) {
    const patch = {};
    switch (key) {
      case "mrWhiteEnabled":         patch.mrWhiteEnabled = checked; break;
      case "roleHidden":             patch.roleReveal = checked ? "hidden" : "announced"; break;
      case "impostorsKnowEachOther": patch.impostorsKnowEachOther = checked; break;
      case "chaosMode":              patch.chaosMode = checked; break;
      case "timersEnabled":          patch.timers = { ...st.settings.timers, enabled: checked }; break;
    }
    send("settings", { settings: patch });
  }

  function renderStartArea() {
    const host = api.isHost();
    const startBtn = $("imp-start");
    const hint = $("imp-hint");
    const played = st.players.some((p) => p.score > 0) || st.round;
    $("imp-finish-setup").classList.toggle("hidden", !host);
    $("imp-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    if (!host) {
      startBtn.style.display = "none";
      hint.textContent = "En attente que l'hôte lance la manche…";
      return;
    }
    startBtn.style.display = "";
    const n = st.players.length;
    const s = st.settings;
    const impostors = s.undercoverCount + (s.mrWhiteEnabled ? s.mrWhiteCount : 0);
    startBtn.disabled = !(n >= 3 && impostors >= 1 && impostors < n);
    if (n < 3) hint.textContent = `Il faut au moins 3 joueurs (${n}/3).`;
    else if (impostors >= n) hint.textContent = "Trop d'imposteurs pour le nombre de joueurs.";
    else hint.textContent = `${n} joueurs • ${impostors} imposteur(s) • ${n - impostors} civils`;
  }

  // ===================================================================
  //  ÉCRAN DE JEU
  // ===================================================================
  function renderGame() {
    const r = st.round;
    if (!r) return;
    $("game-round").textContent = "Manche " + r.number;
    $("game-phase").textContent = PHASE_LABELS[st.phase] || "";
    renderSecretCard();
    renderPlayersStrip();
    renderActionZone();
  }

  function roleName(role) {
    return role === "civil" ? "Civil" : role === "undercover" ? "Undercover" : "Mr White";
  }

  // --- Carte secrète (mon mot / mon rôle) ---
  function renderSecretCard() {
    const card = $("secret-card");
    const r = st.round;
    const inRound = r.seating.includes(me());

    if (!inRound) {
      card.className = "secret-card";
      card.innerHTML = `<span class="secret-tag">SPECTATEUR</span>
        <p class="secret-sub">Tu es arrivé en cours de manche : tu joues à la prochaine !</p>`;
      return;
    }
    if (!myRole) { card.innerHTML = '<p class="muted">Distribution en cours…</p>'; return; }

    if (myRole.isMrWhite) {
      card.className = "secret-card mrwhite";
      card.innerHTML = `<span class="secret-tag">TON RÔLE</span>
        <div class="secret-word">🕵️ Mr WHITE</div>
        <p class="secret-sub">Tu n'as aucun mot. Écoute les autres et fais semblant !</p>`;
    } else {
      card.className = "secret-card";
      const roleLine = myRole.role
        ? `<p class="secret-sub">Tu es <b>${myRole.role === "undercover" ? "Undercover" : "Civil"}</b></p>`
        : `<p class="secret-sub">Donne des indices sans trop en dire…</p>`;
      card.innerHTML = `<span class="secret-tag">TON MOT</span>
        <div class="secret-word">${esc(myRole.word || "")}</div>
        ${roleLine}`;
    }
    if (myRole.allies && myRole.allies.length > 1) {
      card.innerHTML += `<p class="secret-allies">🤝 Imposteurs : ${myRole.allies.map(esc).join(", ")}</p>`;
    }
    if (!r.alive.includes(me())) {
      card.innerHTML += `<p class="secret-elim">💀 Tu as été éliminé — tu es spectateur.</p>`;
    }
  }

  // --- Bandeau des joueurs (places + indices) ---
  function renderPlayersStrip() {
    const strip = $("players-strip");
    const r = st.round;
    strip.innerHTML = r.seating.map((id) => {
      const p = playerOf(id);
      if (!p) return "";
      const elim = r.eliminated.find((e) => e.playerId === id);
      const isCurrent = st.phase === "clues" && r.currentPlayerId === id;
      const isMe = id === me();
      const clues = r.clues.filter((c) => c.playerId === id)
        .map((c) => `<span class="clue">${c.absent ? "—" : esc(c.text)}</span>`).join("");
      const cls = "player-card" + (isCurrent ? " current" : "") + (elim ? " eliminated" : "") +
        (isMe ? " me" : "") + (p.connected ? "" : " offline");
      return `
        <div class="${cls}">
          <div class="pc-head">
            ${api.avatar(p, "avatar")}
            <span class="pc-name">${esc(p.pseudo)}${isMe ? " (toi)" : ""}</span>
            ${elim ? `<span class="pc-role role-${elim.role}">${roleName(elim.role)}</span>` : ""}
          </div>
          <div class="clues">${clues || '<span class="clue empty">…</span>'}</div>
        </div>`;
    }).join("");
  }

  // --- Zone d'action selon la phase ---
  function renderActionZone() {
    const zone = $("action-zone");
    const r = st.round;
    const host = api.isHost();
    const iAmAlive = r.alive.includes(me());

    // ---- INDICES ----
    if (st.phase === "clues") {
      const progress = `<p class="muted">Tour d'indices ${r.clueRoundNum}/${r.clueRoundsTarget}</p>`;
      if (r.currentPlayerId === me()) {
        // On ne redessine pas si on est déjà en train d'écrire (évite de perdre le texte).
        if ($("clue-text")) return;
        zone.innerHTML = `${progress}
          <div class="clue-input">
            <input id="clue-text" type="text" maxlength="40" placeholder="Ton indice…" autocomplete="off" />
            <button id="clue-send" class="btn btn-primary">Envoyer</button>
          </div>
          <p id="clue-error" class="error-msg"></p>`;
        const go = () => {
          send("clue", { text: $("clue-text").value.trim() }).then((res) => {
            if (res.error) $("clue-error").textContent = res.error;
            else if ($("clue-text")) { $("clue-text").value = ""; $("clue-error").textContent = ""; }
          });
        };
        $("clue-send").onclick = go;
        $("clue-text").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        $("clue-text").focus();
      } else {
        zone.innerHTML = `${progress}<p class="waiting">⏳ C'est au tour de <b>${esc(pseudoOf(r.currentPlayerId))}</b>…</p>`;
      }
      return;
    }

    // ---- VOTE ----
    if (st.phase === "vote") {
      const voted = (r.votedIds || []).length;
      if (!iAmAlive) {
        zone.innerHTML = `<p class="waiting">Les joueurs en vie votent… (${voted} vote(s))</p>`;
        return;
      }
      const voters = r.alive.filter((id) => playerOf(id)?.connected).length;
      const buttons = r.alive.filter((id) => id !== me()).map((id) =>
        `<button class="vote-btn ${myVote === id ? "chosen" : ""}" data-id="${id}">${esc(pseudoOf(id))}</button>`
      ).join("");
      zone.innerHTML = `<p class="muted">Qui est l'imposteur ? (${voted}/${voters} ont voté)</p>
        <div class="vote-grid">${buttons}</div>`;
      zone.querySelectorAll(".vote-btn").forEach((b) => {
        b.onclick = () => {
          myVote = b.dataset.id;
          send("vote", { targetId: myVote });
          renderActionZone();
        };
      });
      return;
    }

    // ---- DEVINETTE MR WHITE ----
    if (st.phase === "mrwhite_guess") {
      if (r.guesserId === me()) {
        if ($("guess-text")) return;
        zone.innerHTML = `<p class="waiting">Tu es démasqué ! Devine le mot des civils pour gagner :</p>
          <div class="clue-input">
            <input id="guess-text" type="text" maxlength="40" placeholder="Le mot des civils…" autocomplete="off" />
            <button id="guess-send" class="btn btn-primary">Deviner</button>
          </div>`;
        const go = () => send("guess", { guess: $("guess-text").value });
        $("guess-send").onclick = go;
        $("guess-text").addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
        $("guess-text").focus();
      } else {
        zone.innerHTML = `<p class="waiting">🕵️ <b>${esc(pseudoOf(r.guesserId))}</b> était Mr White et tente de deviner le mot…</p>`;
      }
      return;
    }

    // ---- RÉSULTAT D'UN VOTE ----
    if (st.phase === "result") {
      let msg;
      if (r.result?.tie) {
        msg = "🤝 Égalité au vote ! Personne n'est éliminé. Un tour d'indices de plus.";
      } else {
        msg = `<b>${esc(pseudoOf(r.result.eliminatedId))}</b> est éliminé… c'était <b class="role-${r.result.role}">${roleName(r.result.role)}</b> !`;
      }
      zone.innerHTML = `<p class="result-msg">${msg}</p>` +
        (host ? `<button id="continue-btn" class="btn btn-primary">Continuer</button>`
              : `<p class="muted">En attente de l'hôte…</p>`);
      if (host) $("continue-btn").onclick = () => send("continue");
      return;
    }

    // ---- FIN DE MANCHE ----
    if (st.phase === "gameOver") {
      const o = r.outcome;
      const banner = o.winnerSide === "civils" ? "🟢 Les Civils gagnent !"
                   : o.winnerSide === "mrwhite" ? "⚪ Mr White gagne !"
                   : "🔴 Les Imposteurs gagnent !";
      const roles = o.roles.map((x) =>
        `<li><b>${esc(pseudoOf(x.playerId))}</b> — <span class="role-${x.role}">${roleName(x.role)}</span>${x.word ? " (" + esc(x.word) + ")" : ""}</li>`
      ).join("");
      zone.innerHTML = `
        <div class="gameover">
          <h2 class="go-banner">${banner}</h2>
          <p class="go-pair">Mot des civils : <b>${esc(o.pair.civil)}</b> • Undercover : <b>${esc(o.pair.undercover)}</b></p>
          <ul class="go-roles">${roles}</ul>
          ${host ? `<div class="go-actions">
              <button id="next-round" class="btn btn-primary">Nouvelle manche</button>
              <button id="to-setup" class="btn btn-secondary">Réglages</button>
              <button id="to-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div>
            <p id="go-error" class="error-msg"></p>` : `<p class="muted">En attente de l'hôte pour la suite…</p>`}
        </div>`;
      if (host) {
        $("next-round").onclick = () => send("start").then((res) => {
          if (res.error) $("go-error").textContent = res.error;
        });
        $("to-setup").onclick = () => send("setup");
        $("to-finish").onclick = finishGame;
      }
    }
  }

  // --- Tableau des scores Imposter ---
  function showScores() {
    const sorted = [...st.players].sort((a, b) => b.score - a.score);
    $("scoreboard-list").innerHTML = sorted.map((p, i) =>
      `<li><span class="rank">${i + 1}</span> <span class="name">${esc(p.pseudo)}</span> <span class="pts">${p.score} pts</span></li>`
    ).join("");
    $("scoreboard").classList.remove("hidden");
  }

  // --- Compte à rebours (d'après la date de fin envoyée par le serveur) ---
  function tickTimer() {
    const pill = $("timer-pill");
    if (!pill) return;
    const deadline = st?.round?.deadline;
    if (!st || !["clues", "vote", "mrwhite_guess"].includes(st.phase) || !deadline) {
      pill.classList.add("hidden");
      return;
    }
    const rem = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    pill.textContent = "⏱️ " + rem + "s";
    pill.classList.remove("hidden");
    pill.classList.toggle("urgent", rem <= 5);
  }
})();
