// ===================================================================
//  CLASSEMENT — Client (s'affiche dans le hub Le Bordel)
//  Le juge choisit le thème -> tout le monde classe 5 choses
//  (le juge selon ses goûts, les autres en devinant) -> révélation.
// ===================================================================

(() => {
  let api = null, root = null;
  let st = null;
  let rafId = null;
  let endLocal = 0, finishEndLocal = 0;
  let shownPhase = null, shownKey = null;
  let order = [];               // mon classement en cours : 5 places (indice de la chose, ou null si vide)
  let sent = false;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => api.escapeHtml(s);
  const me = () => api.myId();
  const playerOf = (id) => st?.players.find((p) => p.id === id);
  const pseudoOf = (id) => playerOf(id)?.pseudo || "?";
  const N = 5;
  const PICK_S = 30;

  window.GAMES.classement = {
    mount(rootEl, hubApi) {
      api = hubApi; root = rootEl; st = null; shownPhase = shownKey = null;
      root.innerHTML = `<div id="cl-root"></div>`;
      api.setTheme("theme-ocean");
      rafId = requestAnimationFrame(frame);
    },
    update(state) {
      st = state;
      endLocal = Date.now() + (st.left || 0);
      // Écran complet seulement au changement de phase ; le reste par petits bouts.
      if (st.phase !== shownPhase) { shownPhase = st.phase; shownKey = null; renderPhase(); }
      else renderUpdate();
    },
    unmount() { cancelAnimationFrame(rafId); root.innerHTML = ""; },
  };

  function renderPhase() {
    const r = $("cl-root");
    r.innerHTML = st.phase === "setup" ? setupHtml() : `<div id="cl-${st.phase}"></div>`;
    if (st.phase === "setup") {
      $("cl-start").onclick = () => { $("cl-error").textContent = ""; api.action("start").then((x) => { if (x.error) $("cl-error").textContent = x.error; }); };
      $("cl-finish-setup").onclick = finishGame;
    }
    renderUpdate();
  }

  function renderUpdate() {
    if (st.phase === "setup") renderSetup();
    else if (st.phase === "pick") renderPick();
    else if (st.phase === "rank") renderRank();
    else if (st.phase === "reveal") renderReveal();
    else renderOver();
  }

  const topHtml = (label) => `
    <div class="qn-top"><span class="pill">${label}</span><span class="qn-sec" id="cl-sec"></span></div>
    <div class="qn-bar"><i id="cl-bar"></i></div>`;
  const roundLabel = () => `Manche ${st.round}/${st.rounds}`;
  const judgeHtml = () => `<div class="cl-judge">${api.avatar(playerOf(st.judge), "mini-avatar qn-big")}
    <span><b>${esc(pseudoOf(st.judge))}</b>${st.judge === me() ? " (toi !)" : ""} est le juge</span></div>`;
  const chipsHtml = (ids, doneIds) => `<div class="qn-who">${ids.map((id) =>
    `<span class="qn-chip ${doneIds.includes(id) ? "done" : ""}">${api.avatar(playerOf(id))} ${esc(pseudoOf(id))}${id === st.judge ? " ⚖️" : ""}</span>`).join("")}</div>`;

  // ===================================================================
  //  RÉGLAGES
  // ===================================================================
  function setupHtml() {
    return `
      <div class="logo imp-logo">
        <span class="logo-icon">📊</span>
        <h1>CLASSEMENT</h1>
        <p class="tagline">Tu le connais si bien que ça ?</p>
      </div>
      <div class="pt-setup-grid">
        <div class="card"><h2>⚙️ Réglages</h2><div id="cl-settings" class="settings"></div></div>
        <div class="card">
          <h2>📜 Règles</h2>
          <ul class="pt-help">
            <li>⚖️ À chaque manche, un <b>juge</b> choisit un thème (ex. « Un fast-food »).</li>
            <li>📋 5 choses s'affichent. Le juge les <b>classe selon ses goûts</b>, du 1er au 5e.</li>
            <li>🔮 Les autres essaient de <b>deviner son classement</b>, en même temps.</li>
            <li>🏆 <b>2 pts</b> par chose à la bonne place, <b>1 pt</b> à une place près. Le juge gagne la <b>moyenne</b> des autres (sois sincère !).</li>
          </ul>
        </div>
      </div>
      <div class="lobby-actions">
        <button id="cl-start" class="btn btn-primary btn-big">Lancer la partie</button>
        <p id="cl-hint" class="muted"></p>
        <p id="cl-error" class="error-msg"></p>
        <button id="cl-finish-setup" class="btn btn-ghost hidden">Terminer le jeu</button>
      </div>`;
  }

  function renderSetup() {
    const s = st.settings, host = api.isHost();
    const panel = $("cl-settings");
    panel.className = "settings" + (host ? "" : " locked");
    const chips = (key, list) => `<div class="cat-chips">${list.map(([v, label]) =>
      `<button class="cat-chip ${s[key] === v ? "on" : ""}" data-key="${key}" data-v="${v}" ${host ? "" : "disabled"}>${label}</button>`).join("")}</div>`;
    panel.innerHTML = `
      <div class="setting-block"><label>Chacun est juge</label>${chips("laps", [[1, "1 fois"], [2, "2 fois"]])}</div>
      <div class="setting-block"><label>Temps pour classer</label>${chips("rankTime", [[60, "60 s"], [90, "90 s"], [120, "2 min"]])}</div>
      ${host ? "" : '<p class="settings-note">Seul l\'hôte peut modifier les réglages.</p>'}`;
    if (host) panel.querySelectorAll("[data-key]").forEach((b) => {
      b.onclick = () => api.action("settings", { settings: { [b.dataset.key]: Number(b.dataset.v) } });
    });
    const n = st.players.filter((p) => p.connected).length;
    const played = st.players.some((p) => p.score > 0);
    $("cl-start").style.display = host ? "" : "none";
    $("cl-start").disabled = n < 3;
    $("cl-finish-setup").classList.toggle("hidden", !host);
    $("cl-finish-setup").textContent = played ? "Terminer le jeu (points de soirée)" : "Retour au menu";
    $("cl-hint").textContent = !host ? "En attente que l'hôte lance la partie…"
      : n < 3 ? `Il faut au moins 3 joueurs (${n}/3).` : `${n} joueurs · ${n * s.laps} manches · ~${Math.round((n * s.laps * (10 + s.rankTime * 0.7 + 14)) / 60)} min de jeu.`;
  }

  // ===================================================================
  //  1. LE JUGE CHOISIT LE THÈME
  // ===================================================================
  function renderPick() {
    const box = $("cl-pick");
    const key = "p" + st.round;
    if (shownKey === key) return;
    shownKey = key;
    const mine = st.judge === me();
    box.innerHTML = `
      ${topHtml("⚖️ " + roundLabel() + " · Choix du thème")}
      ${judgeHtml()}
      <h2 class="s10-h">${mine ? "Choisis le thème !" : `${esc(pseudoOf(st.judge))} choisit le thème…`}</h2>
      <div class="s10-themes">${st.choices.map((th, i) => `
        <button class="s10-tcard" data-i="${i}" style="animation-delay:${i * 0.1}s" ${mine ? "" : "disabled"}>
          <span class="s10-ttitle">${esc(th.title)}</span>
          <span class="s10-scale">1er = ${esc(th.top)} · 5e = ${esc(th.bottom)}</span>
        </button>`).join("")}
      </div>`;
    if (mine) box.querySelectorAll(".s10-tcard").forEach((b) => {
      b.onclick = () => api.action("theme", { index: Number(b.dataset.i) });
    });
  }

  // ===================================================================
  //  2. TOUT LE MONDE CLASSE
  // ===================================================================
  function renderRank() {
    const box = $("cl-rank");
    const key = "r" + st.round;
    const playing = st.who.includes(me());
    const isJudge = st.judge === me();
    if (shownKey !== key) {
      shownKey = key; order = Array(N).fill(null); sent = false;
      box.innerHTML = `
        ${topHtml("📋 " + roundLabel())}
        ${judgeHtml()}
        <div class="s10-theme cl-theme"><div class="s10-theme-title">${esc(st.theme.title)}</div></div>
        ${playing ? `
          <p class="cl-ask">${isJudge ? "🤫 Classe ces 5 choses <b>selon TES goûts</b>." : `🔮 Comment <b>${esc(pseudoOf(st.judge))}</b> les a classées ?`}
            <span class="muted">Glisse les réponses sur l'échelle (ou clique-les dans l'ordre, du 1er au 5e).</span></p>
          <div class="cl-board">
            <div class="cl-pool" id="cl-pool"></div>
            <div class="cl-ladderwrap">
              <div class="cl-endlab top">⬆️ 1er = ${esc(st.theme.top)}</div>
              <ol class="cl-ladder" id="cl-ladder"></ol>
              <div class="cl-endlab bottom">⬇️ 5e = ${esc(st.theme.bottom)}</div>
            </div>
          </div>
          <div class="lobby-actions">
            <button id="cl-send" class="btn btn-primary btn-big" disabled>Valider</button>
            <p id="cl-msg" class="muted qn-write-msg"></p>
          </div>`
          : `<h2 class="s10-h">👀 Tu regardes.</h2>`}
        <div id="cl-done"></div>`;
      if (playing) {
        $("cl-send").onclick = () => {
          if (order.includes(null)) return;
          api.action("rank", { list: order }).then((r) => {
            sent = !r.error;
            const msg = $("cl-msg");
            if (msg) msg.textContent = r.error ? "⚠️ " + r.error : "✅ Envoyé ! Tu peux encore changer et renvoyer.";
          });
        };
        drawBoard();
      }
    }
    $("cl-done").innerHTML = chipsHtml(st.who, st.doneIds);
  }

  // Les choses à classer (à gauche) et l'échelle 1 → 5 (à droite).
  // On peut CLIQUER (la chose va à la première place libre / retourne dans la liste)
  // ou GLISSER-DÉPOSER (sur une place, entre deux places pour échanger, ou dans la liste pour l'enlever).
  function drawBoard() {
    $("cl-pool").innerHTML = st.items.map((txt, i) => order.includes(i) ? ""
      : `<button class="cl-item" data-i="${i}">${esc(txt)}</button>`).join("") || '<p class="muted">Tout est classé 👍</p>';
    $("cl-ladder").innerHTML = Array.from({ length: N }, (_, k) => {
      const i = order[k];
      const empty = i === null;
      return `<li class="cl-slot ${empty ? "empty" : ""}" data-k="${k}"><span class="cl-pos">${k + 1}</span>
        ${empty ? '<span class="muted">glisse ici…</span>' : `<span class="cl-grip">⠿</span><span class="cl-txt">${esc(st.items[i])}</span><span class="cl-x">✕</span>`}</li>`;
    }).join("");

    // --- Clic ---
    $("cl-pool").querySelectorAll(".cl-item").forEach((b) => {
      b.onclick = () => { const k = order.indexOf(null); if (k >= 0) { order[k] = Number(b.dataset.i); drawBoard(); } };
    });
    $("cl-ladder").querySelectorAll(".cl-slot:not(.empty)").forEach((sl) => {
      sl.onclick = () => { order[Number(sl.dataset.k)] = null; drawBoard(); };
    });

    // --- Glisser-déposer (fait maison : marche à la souris comme au doigt) ---
    $("cl-pool").querySelectorAll(".cl-item").forEach((b) => grab(b, { i: Number(b.dataset.i), k: null }));
    $("cl-ladder").querySelectorAll(".cl-slot:not(.empty)").forEach((sl) => grab(sl, { i: order[Number(sl.dataset.k)], k: Number(sl.dataset.k) }));

    const btn = $("cl-send");
    btn.disabled = order.includes(null);
    btn.textContent = sent ? "Renvoyer" : "Valider";
  }

  // On appuie sur une chose : si on bouge de plus de 6 px, on la porte (une copie suit le pointeur).
  // On lâche sur une place = elle y va (si la place était prise : échange, ou l'ancienne retourne dans la liste).
  // On lâche sur la liste = elle sort du classement. Sans bouger = c'est un simple clic.
  let drag = null;
  function grab(el, from) {
    el.style.touchAction = "none";
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      drag = { el, from, x0: e.clientX, y0: e.clientY, ghost: null, moved: false };
      document.addEventListener("pointermove", onDragMove);
      document.addEventListener("pointerup", onDragEnd, { once: true });
    };
  }
  function dropTarget(x, y) {
    const under = document.elementFromPoint(x, y);
    return under?.closest(".cl-slot") || under?.closest("#cl-pool") || null;
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      const r = drag.el.getBoundingClientRect();
      drag.dx = drag.x0 - r.left; drag.dy = drag.y0 - r.top;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "cl-ghost";
      drag.ghost.textContent = st.items[drag.from.i];
      drag.ghost.style.width = r.width + "px";
      document.body.appendChild(drag.ghost);
      drag.el.classList.add("dragging");
    }
    drag.ghost.style.left = e.clientX - drag.dx + "px";
    drag.ghost.style.top = e.clientY - drag.dy + "px";
    document.querySelectorAll(".cl-board .over").forEach((el) => el.classList.remove("over"));
    dropTarget(e.clientX, e.clientY)?.classList.add("over");
  }
  function onDragEnd(e) {
    document.removeEventListener("pointermove", onDragMove);
    const d = drag;
    drag = null;
    if (!d || !d.moved) return;   // pas bougé : le clic normal s'en occupe
    d.ghost.remove();
    // Le clic qui suit le lâcher ne doit rien faire.
    const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => document.removeEventListener("click", stop, { capture: true }), 50);
    const target = dropTarget(e.clientX, e.clientY);
    if (target?.classList.contains("cl-slot")) {
      const k = Number(target.dataset.k), there = order[k];
      if (d.from.k !== null) order[d.from.k] = there;   // échange entre deux places
      order[k] = d.from.i;
    } else if (target?.id === "cl-pool" && d.from.k !== null) {
      order[d.from.k] = null;
    }
    if ($("cl-pool")) drawBoard();
  }

  // ===================================================================
  //  3. RÉVÉLATION
  // ===================================================================
  function renderReveal() {
    const box = $("cl-reveal");
    const key = "v" + st.round;
    if (shownKey === key) return;
    shownKey = key;
    const truth = st.ranks[st.judge];
    const guessers = st.who.filter((id) => id !== st.judge && st.ranks[id]);
    const t = st.theme;
    let body;
    if (!truth) body = `<p class="qn-status">😴 ${esc(pseudoOf(st.judge))} n'a pas classé à temps : personne ne marque.</p>`;
    else {
      // Une colonne par joueur : vert = bonne place, jaune = à une place près.
      const col = (id) => {
        const list = st.ranks[id];
        return `<div class="cl-col ${id === st.judge ? "judge" : ""}">
          <div class="cl-colhead">${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b>${id === st.judge ? " ⚖️" : ""}</div>
          ${list.map((i, k) => {
            const d = Math.abs(truth.indexOf(i) - k);
            const cls = id === st.judge ? "" : d === 0 ? "ok" : d === 1 ? "near" : "far";
            return `<div class="cl-cell ${cls}" style="animation-delay:${0.3 + k * 0.15}s"><span class="cl-pos">${k + 1}</span>${esc(st.items[i])}</div>`;
          }).join("")}
          <div class="cl-gain">+${st.gains[id] || 0}</div>
        </div>`;
      };
      body = `
        <p class="cl-ends"><span>⬆️ 1er = ${esc(t.top)}</span><span>⬇️ 5e = ${esc(t.bottom)}</span></p>
        <div class="cl-cols">${col(st.judge)}${guessers.map(col).join("")}</div>
        <p class="muted cl-legend">🟩 bonne place = 2 pts · 🟨 à une place près = 1 pt · le juge gagne la moyenne des autres</p>`;
    }
    box.innerHTML = `
      <div class="qn-top"><span class="pill">🔍 ${roundLabel()} · Révélation</span></div>
      <div class="s10-theme cl-theme"><div class="s10-theme-title">${esc(t.title)}</div></div>
      ${body}
      <div class="lobby-actions" id="cl-host"></div>`;
    if (api.isHost()) {
      $("cl-host").innerHTML = `<button id="cl-next" class="btn btn-secondary">Suivant ▶</button>`;
      $("cl-next").onclick = () => api.action("next");
    }
  }

  // ===================================================================
  //  CLASSEMENT FINAL
  // ===================================================================
  function renderOver() {
    const box = $("cl-over");
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
        <h2 class="go-banner">🏆 Classement final</h2>
        <ol class="s10-rank">${sorted.map((id, i) => `
          <li style="animation-delay:${i * 0.12}s"><span class="s10-medal">${medal(i)}</span>${api.avatar(playerOf(id))}<b>${esc(pseudoOf(id))}</b><span class="gain">${playerOf(id)?.score || 0} pts</span></li>`).join("")}
        </ol>
        <div class="s10-recap">${st.history.filter((h) => h.truth).map((h) => `
          <div class="s10-rround"><h3>${api.avatar(playerOf(h.judge))} ${esc(pseudoOf(h.judge))} · ${esc(h.theme)}</h3>
            <ol class="cl-recap">${h.truth.map((i) => `<li>${esc(h.items[i])}</li>`).join("")}</ol>
          </div>`).join("")}
        </div>
        ${pl?.final
          ? `<p class="go-final">Classement dans <b id="cl-fin-sec">${Math.ceil(pl.finishLeft / 1000)}</b> s</p>
             ${host ? `<div class="go-actions"><button id="cl-finish" class="btn btn-primary">Voir le classement maintenant</button></div>` : ""}`
          : host ? `<div class="go-actions">
              <button id="cl-again" class="btn btn-primary">🔁 Rejouer</button>
              <button id="cl-to-setup" class="btn btn-secondary">Réglages</button>
              <button id="cl-finish" class="btn btn-secondary">🏁 Terminer le jeu</button>
            </div><p id="cl-over-error" class="error-msg"></p>`
          : `<p class="muted">En attente de l'hôte…</p>`}
      </div>`;
    if (!host) return;
    $("cl-again") && ($("cl-again").onclick = () => api.action("start").then((r) => { if (r.error) $("cl-over-error").textContent = r.error; }));
    $("cl-to-setup") && ($("cl-to-setup").onclick = () => api.action("setup"));
    $("cl-finish").onclick = pl?.final ? () => api.action("finish") : finishGame;
  }

  function finishGame() {
    if (confirm("Terminer « Classement » ? Le classement actuel donne les points de soirée.")) api.action("finish");
  }

  // ===================================================================
  //  CHRONO
  // ===================================================================
  function frame() {
    rafId = requestAnimationFrame(frame);
    if (!st) return;
    const fin = $("cl-fin-sec");
    if (fin) fin.textContent = Math.max(0, Math.ceil((finishEndLocal - Date.now()) / 1000));
    const left = Math.max(0, endLocal - Date.now());
    const sec = $("cl-sec");
    if (sec) { sec.textContent = Math.ceil(left / 1000) + " s"; sec.classList.toggle("urgent", left <= 5000); }
    const bar = $("cl-bar");
    if (bar) bar.style.width = Math.min(100, (100 * left) / ((st.phase === "pick" ? PICK_S : st.settings.rankTime) * 1000)) + "%";
  }
})();
