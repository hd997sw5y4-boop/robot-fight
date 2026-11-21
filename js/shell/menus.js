/* Robot Fight shell: title, main menu, fighter select, arcade ladder, results, ending,
   pause, credits, training panel, versus controls bar. Keyboard / mouse / gamepad. */
(function () {
  'use strict';
  const S = window.RFShell;
  const esc = S.esc;
  const MENU_SCREENS = ['title', 'main', 'select', 'ladder', 'results', 'ending', 'pause', 'credits', 'tourney', 'tourney-results'];
  const ORBIT_SCREENS = ['title', 'main', 'credits'];
  const SELECT_SCREEN = 'select';

  /* ---------- persisted choices ---------- */
  const preset = (id) => S.PRESETS.find((p) => p.id === id) || S.PRESETS[0];
  const fromPreset = (id) => { const p = preset(id); return { preset: p.id, primary: p.primary, accent: p.accent }; };
  function asFighterId(saved, fallback) {
    if (typeof saved === 'string' && S.fighterOf && S.fighterOf(saved)) return saved;
    if (saved === 'random') return 'random';
    if (saved && typeof saved === 'object') {
      const map = { cobalt: 'aeropike', crimson: 'voltfang', graphite: 'bulwark', mint: 'hexwren', violet: 'mirrorjack', ember: 'voltfang', arctic: 'sprocket', rose: 'overseer' };
      if (saved.preset && map[saved.preset] && S.fighterOf(map[saved.preset])) return map[saved.preset];
    }
    return fallback;
  }
  const sel = {
    p1: Object.assign(fromPreset('cobalt'), S.load('p1', {})),
    p2: Object.assign(fromPreset('crimson'), S.load('p2', {})),
    p1Id: asFighterId(S.load('p1Id', null) || S.load('p1', {}), 'aeropike'),
    p2Id: asFighterId(S.load('p2Id', null), 'sprocket'),
    opp: S.load('opp', 'sprocket'),
    dummyBlock: !!S.load('dummyBlock', false),
  };
  if (sel.opp && sel.opp !== 'random' && !(S.fighterOf && S.fighterOf(sel.opp))) sel.opp = 'sprocket';
  if (!sel.p2Id || (sel.p2Id !== 'random' && !(S.fighterOf && S.fighterOf(sel.p2Id)))) sel.p2Id = (sel.opp && sel.opp !== 'random') ? sel.opp : 'sprocket';
  function syncSelPaint() {
    const a = S.fighterOf && S.fighterOf(sel.p1Id);
    if (a) sel.p1 = { preset: a.id, primary: a.primary, accent: a.accent };
    const b = S.fighterOf && S.fighterOf(sel.p2Id === 'random' ? null : sel.p2Id);
    if (b) sel.p2 = { preset: b.id, primary: b.primary, accent: b.accent };
  }
  syncSelPaint();
  const paintName = (pt) => {
    const p = S.PRESETS.find((x) => x.primary === pt.primary && x.accent === pt.accent);
    return p ? p.name : 'Custom';
  };
  S.arcade = { idx: 0, continues: 0, total: null };

  /* ---------- DOM ---------- */
  const root = document.createElement('div');
  root.id = 'rfs';
  root.className = 'rfs';
  document.body.appendChild(root);

  const KEYS_SOLO = `
    <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> or arrows <span>move</span></li>
    <li><kbd>J</kbd> <span>punch</span> <kbd>K</kbd> <span>kick</span> <kbd>L</kbd> <span>block</span></li>
    <li><kbd>Q</kbd> <span>rocket punch</span> <kbd>E</kbd> <span>dash forward</span> <kbd>X</kbd> <span>dash back</span></li>
    <li><kbd>I</kbd> <span>stomp / ground punch a downed robot</span></li>
    <li><kbd>Y</kbd> <span>front flip</span></li>
    <li>Hold <kbd>Shift</kbd> <span>run forward / back</span></li>
    <li><kbd>V</kbd> <span>camera view: arena, fighting, 3rd person, 1st person, broadcast</span> <kbd>C</kbd> <span>broadcast on/off</span></li>
    <li><kbd>Esc</kbd> / <kbd>P</kbd> <span>pause</span></li>
    <li>Mouse drag <span>spin camera</span> · wheel <span>zoom</span> · double-click <span>reset view</span></li>`;
  const KEYS_P1 = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>F</kbd> punch · <kbd>G</kbd> kick · <kbd>H</kbd> block · <kbd>Q</kbd> rocket punch · <kbd>E</kbd> dash forward · <kbd>X</kbd> dash back · <kbd>T</kbd> ground attack · hold <kbd>Left Shift</kbd> run';
  const KEYS_P2 = '<kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move · <kbd>.</kbd> punch · <kbd>/</kbd> kick · <kbd>Right Shift</kbd> block · <kbd>[</kbd> rocket punch · <kbd>]</kbd> dash forward · <kbd>;</kbd> dash back · <kbd>,</kbd> ground attack · hold <kbd>Right Ctrl</kbd> run';
  const PAD = '<li><span>Left stick / D-pad</span> move · <span class="ps">✕</span> punch · <span class="ps">○</span> kick · <span class="ps">□</span> block · <span class="ps">△</span> ground · <span class="ps">L1</span> rocket punch · <span class="ps">R2</span> dash (stick back = back dash) · hold <span class="ps">L2</span>/<span class="ps">L3</span> run · <span class="ps">R1</span>+forward front flip · <span class="ps">Options</span> pause</li>';


const PAD_SVG = `<svg viewBox="0 0 760 390" class="ps-svg" role="img" aria-label="Controller diagram">
  <defs>
    <linearGradient id="psBody" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#2a3040"/>
      <stop offset="1" stop-color="#161922"/>
    </linearGradient>
    <linearGradient id="psFace" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a4154"/>
      <stop offset="1" stop-color="#232838"/>
    </linearGradient>
  </defs>
  <!-- Body: original rounded gamepad silhouette, no logos -->
  <path fill="url(#psBody)" stroke="#8ea0c8" stroke-width="2.2" d="M170 128 C 210 70, 300 58, 380 58 C 460 58, 550 70, 590 128 C 660 148, 720 210, 718 268 C 716 330, 650 348, 600 318 C 560 348, 470 358, 380 358 C 290 358, 200 348, 160 318 C 110 348, 44 330, 42 268 C 40 210, 100 148, 170 128 Z"/>
  <rect x="300" y="92" width="160" height="10" rx="5" fill="#7ad7ff" opacity=".85"/>
  <ellipse cx="380" cy="200" rx="86" ry="58" fill="url(#psFace)" stroke="#6f7d99" stroke-width="1.5"/>
  <text x="380" y="196" text-anchor="middle" class="ps-lab muted">Touch pad</text>
  <!-- Left stick -->
  <circle cx="250" cy="230" r="36" fill="#12151c" stroke="#9aa8c4" stroke-width="2"/>
  <circle cx="250" cy="230" r="16" fill="#2c3344"/>
  <!-- Right stick -->
  <circle cx="510" cy="230" r="36" fill="#12151c" stroke="#9aa8c4" stroke-width="2"/>
  <circle cx="510" cy="230" r="16" fill="#2c3344"/>
  <!-- D-pad -->
  <g fill="#12151c" stroke="#9aa8c4" stroke-width="1.6">
    <rect x="148" y="136" width="18" height="52" rx="4"/>
    <rect x="131" y="153" width="52" height="18" rx="4"/>
  </g>
  <!-- Face buttons -->
  <g font-size="13" font-weight="800" text-anchor="middle" dominant-baseline="middle">
    <circle cx="596" cy="128" r="16" fill="#1a1d26" stroke="#5ad0a8" stroke-width="2"/><text fill="#8eecc8" x="596" y="128">△</text>
    <circle cx="626" cy="158" r="16" fill="#1a1d26" stroke="#e07a7a" stroke-width="2"/><text fill="#f0a0a0" x="626" y="158">○</text>
    <circle cx="566" cy="158" r="16" fill="#1a1d26" stroke="#d6a0e8" stroke-width="2"/><text fill="#e2b8f0" x="566" y="158">□</text>
    <circle cx="596" cy="188" r="16" fill="#1a1d26" stroke="#8eb6f0" stroke-width="2"/><text fill="#b8d2ff" x="596" y="189">✕</text>
  </g>
  <!-- Shoulders -->
  <rect x="168" y="64" width="86" height="18" rx="7" fill="#1c202b" stroke="#9aa8c4" stroke-width="1.5"/>
  <rect x="168" y="44" width="86" height="16" rx="7" fill="#252a36" stroke="#9aa8c4" stroke-width="1.5"/>
  <rect x="506" y="64" width="86" height="18" rx="7" fill="#1c202b" stroke="#9aa8c4" stroke-width="1.5"/>
  <rect x="506" y="44" width="86" height="16" rx="7" fill="#252a36" stroke="#9aa8c4" stroke-width="1.5"/>
  <text x="211" y="56" text-anchor="middle" class="ps-lab">L2</text>
  <text x="211" y="77" text-anchor="middle" class="ps-lab">L1</text>
  <text x="549" y="56" text-anchor="middle" class="ps-lab">R2</text>
  <text x="549" y="77" text-anchor="middle" class="ps-lab">R1</text>
  <!-- Options / Create -->
  <rect x="430" y="118" width="22" height="10" rx="3" fill="#c5cee0"/>
  <rect x="308" y="118" width="22" height="10" rx="3" fill="#c5cee0"/>
  <!-- External labels -->
  <g class="ps-call">
    <text x="70" y="54">L2 Run</text>
    <text x="70" y="86">L1 Rocket punch</text>
    <text x="70" y="154">D-pad Move</text>
    <text x="70" y="236">Left stick Move</text>
    <text x="70" y="268">L3 (click) Run</text>
    <text x="690" y="54" text-anchor="end">R2 Dash</text>
    <text x="690" y="74" text-anchor="end">Stick back + R2: back dash</text>
    <text x="690" y="96" text-anchor="end">R1 + forward Flip</text>
    <text x="690" y="128" text-anchor="end">△ Ground</text>
    <text x="690" y="158" text-anchor="end">○ Kick</text>
    <text x="690" y="188" text-anchor="end">□ Block</text>
    <text x="690" y="218" text-anchor="end">✕ Punch</text>
    <text x="690" y="248" text-anchor="end">Right stick</text>
    <text x="380" y="28" text-anchor="middle">Options — Pause</text>
  </g>
</svg>`;

  function screen(name, html, cls) {
    const el = document.createElement('section');
    el.className = 'rfs-screen ' + (cls || '');
    el.dataset.screen = name;
    el.innerHTML = html;
    root.appendChild(el);
    return el;
  }

  const brand = '<div class="rfs-brand"><small>Window Workshop Games</small><b>Robot Fight</b></div>';

  screen('title', `
    <div class="rfs-title">
      ${brand}
      <p class="rfs-tag">Nine steel brawlers. One octagon. Parts fly.</p>
      <button type="button" class="rfs-f rfs-press" data-act="start">Press <kbd>Enter</kbd> · <kbd>A</kbd> · or click to start</button>
    </div>
    <div class="rfs-foot">© Window Workshop Games</div>`, 'rfs-center');

  screen('main', `
    <div class="rfs-mainwrap">
      <div class="rfs-col">
        ${brand}
        <nav class="rfs-menu" aria-label="Main menu">
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="fight"><b>Fight</b><small>Quick match vs a CPU robot</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="arcade"><b>Arcade</b><small>Climb the nine-robot ladder</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="versus"><b>Versus</b><small>Two players, one keyboard or two gamepads</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="training"><b>Training</b><small>Practice on a dummy, no timer</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="watch"><b>Bot vs Bot</b><small>Sit back and watch two CPUs fight</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="watch" data-loop="1"><b>CPU vs CPU</b><small>Back-to-back CPU fights, looping, with a fight log</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="tournament"><b>AI Tournament</b><small>Round-robin API brains, Elo and results</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="settings"><b>Settings</b><small>Graphics, sound, CPU difficulty, round time</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="credits"><b>Credits</b></button>
        </nav>
      </div>
      <aside class="rfs-card rfs-controls" aria-label="Controls">
        <h3>Controls</h3>
        <div class="rfs-ctrl-tabs" role="tablist">
          <button type="button" class="rfs-f rfs-ctrl-tab is-on" role="tab" aria-selected="true" data-ctrl-tab="kb">Keyboard</button>
          <button type="button" class="rfs-f rfs-ctrl-tab" role="tab" aria-selected="false" data-ctrl-tab="pad">Controller</button>
        </div>
        <div class="rfs-ctrl-pane is-on" data-ctrl-pane="kb">
          <h4>Solo</h4><ul>${KEYS_SOLO}</ul>
          <h4>Versus</h4><ul><li><em>P1</em> ${KEYS_P1}</li><li><em>P2</em> ${KEYS_P2}</li><li><kbd>V</kbd> camera view (arena, fighting, 3rd person, 1st person)</li><li>Gamepad 1 → P1, gamepad 2 → P2</li></ul>
          <h4>Menus</h4><ul><li>Arrows / WASD / D-pad · <kbd>Enter</kbd> or <kbd>A</kbd> select · <kbd>Esc</kbd> or <kbd>B</kbd> back</li></ul>
        </div>
        <div class="rfs-ctrl-pane" data-ctrl-pane="pad">
          <div class="ps-pad" aria-label="DualSense-style controller layout">${PAD_SVG}</div>
          <ul class="ps-legend">${PAD}</ul>
          <p class="rfs-note">Mapped to a DualSense in Chrome&rsquo;s standard gamepad layout. Gamepad 1 → P1, gamepad 2 → P2.</p>
        </div>
      </aside>
    </div>`);

  const selEl = screen('select', '<div class="rfs-selwrap"></div>');
  const ladderEl = screen('ladder', '<div class="rfs-card rfs-ladder"></div>', 'rfs-left');
  const resultsEl = screen('results', '<div class="rfs-card rfs-results"></div>', 'rfs-center rfs-dim');
  const endingEl = screen('ending', '<div class="rfs-card rfs-results rfs-ending"></div>', 'rfs-center rfs-dim');
  const pauseEl = screen('pause', '<div class="rfs-card rfs-pause"></div>', 'rfs-center rfs-dim');
  screen('credits', `
    <div class="rfs-card rfs-credits">
      <h2>Credits</h2>
      <p class="rfs-lead"><b>Robot Fight</b> — a Window Workshop Games production.</p>
      <ul>
        <li><b>Robot fighter model:</b> “Robot character” by assetfactory on Sketchfab, Sketchfab Free Standard license (recolored in-game).</li>
        <li><b>Teal fighter model:</b> “Teal” by Lagst on Sketchfab, Sketchfab Standard license.</li>
        <li><b>Draugr fighter model:</b> “Draugr - General purpose humanoid bot” by Lagst on Sketchfab, Sketchfab Standard license.</li>
        <li><b>Animations:</b> Mixamo (Adobe) — fighting idle, walks, strafes, punches, kicks, blocks, hits, knockouts, get-ups, dodges, flips, and victory/taunt clips.</li>
        <li><b>Arena textures:</b> Metal009, Metal008 (scratched metal), and Rust004 from ambientCG, CC0 1.0 — mixed into the chrome mat.</li>
        <li><b>HDRI environment:</b> Industrial Pipe and Valve 01 2K from Poly Haven, CC0 1.0.</li>
        <li><b>3D engine:</b> three.js r187, MIT license.</li>
        <li><b>Physics:</b> cannon-es, MIT license.</li>
        <li><b>Sound effects:</b> CC0 and royalty-free recordings (no credit required). Metal impacts, tools, slams, and machine/spring hydraulics from rubberduck and Ogrebane on OpenGameArt; metal interactions from Iwan “qubodup” Gabovitch; metal footsteps on concrete from Thimras; mech stomp from hc / qubodup; additional metal hits from Brian MacIntosh; electrical sparks and buzz from Brian MacIntosh / BMacZero; fight bells, UI and heavy impact layers (pitched down) from Kenney; crowd ambience and reactions from Mixkit; announcer lines are original, voiced with Kokoro TTS (Apache-2.0); arena hum looped from yd’s Factory ambiance (OpenGameArt, CC0). Arena reverb and the sub-thump layer are synthesized in the game. Full sources are in CREDITS/LICENSES.md.</li>
        <li><b>Settings panel look and volume taper:</b> adapted from Window Workshop Games UI.</li>
      </ul>
      <p class="rfs-note">CPU fighters, names, and paint schemes are original to this game. Full license notes are in README.md, models/CREDITS.md, and CREDITS/LICENSES.md.</p>
      <button type="button" class="rfs-f rfs-btn rfs-small" data-act="back">Back</button>
    </div>`, 'rfs-center rfs-dim');

  const trainEl = document.createElement('div');
  trainEl.className = 'rfs-card rfs-train';
  document.body.appendChild(trainEl);
  const vbar = document.createElement('div');
  vbar.className = 'rfs-vbar';
  vbar.innerHTML = `<div><em>P1</em> ${KEYS_P1}</div><div><em>P2</em> ${KEYS_P2}</div>`;
  document.body.appendChild(vbar);

  /* ---------- screens + focus ---------- */
  const lastFocus = {};
  S.menuActive = () => MENU_SCREENS.includes(S.state.screen);
  S.showScreen = (name) => {
    const prev = S.state.screen;
    if (prev && MENU_SCREENS.includes(prev) && document.activeElement && root.contains(document.activeElement)) {
      lastFocus[prev] = document.activeElement;
    }
    S.state.screen = name;
    S.$$('.rfs-screen', root).forEach((el) => el.classList.toggle('on', el.dataset.screen === name));
    const b = document.body.classList;
    b.add('rfs-on');
    b.toggle('rfs-menu', MENU_SCREENS.includes(name) && name !== 'pause' && name !== 'results');
    b.toggle('rfs-versus', S.state.mode === 'versus' && (name === 'fight' || name === 'pause'));
    b.toggle('rfs-training', S.state.mode === 'training' && name === 'fight');
    b.toggle('rfs-dimmed', name === 'pause' || name === 'results');
    b.toggle('rfs-matchhud', !!S.state.mode && S.state.mode !== 'training');
    if (name === 'fight') {
      if (document.activeElement && root.contains(document.activeElement)) document.activeElement.blur();
      if (S.api) S.api.match.camLock = false;
      return;
    }
    focusScreen(name);
  };
  function focusScreen(name) {
    const scr = S.$(`.rfs-screen[data-screen="${name}"]`, root);
    if (!scr) return;
    const keep = lastFocus[name];
    const target = (keep && scr.contains(keep) && keep.isConnected) ? keep : (S.$('[data-autofocus]', scr) || S.$('.rfs-f', scr));
    if (target) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  }
  function focusables() {
    const scr = S.$('.rfs-screen.on', root);
    return scr ? S.$$('.rfs-f', scr).filter((el) => !el.disabled && el.offsetParent !== null) : [];
  }
  S.nav = (act) => {
    if (act === 'ok') {
      const a = document.activeElement;
      if (a && root.contains(a) && a.classList.contains('rfs-f')) a.click();
      else { const f = focusables()[0]; if (f) f.focus(); }
      return;
    }
    if (act === 'back') return back();
    const list = focusables();
    if (!list.length) return;
    const cur = document.activeElement;
    if (!list.includes(cur)) { list[0].focus(); return; }
    const r0 = cur.getBoundingClientRect();
    const cx = r0.left + r0.width / 2;
    const cy = r0.top + r0.height / 2;
    let best = null;
    let bestScore = Infinity;
    for (const el of list) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      let main;
      let side;
      if (act === 'up') { main = -dy; side = dx; } else if (act === 'down') { main = dy; side = dx; } else if (act === 'left') { main = -dx; side = dy; } else { main = dx; side = dy; }
      if (main <= 4) continue;
      const score = main + Math.abs(side) * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { best.focus({ preventScroll: false }); S.sfx('tick'); }
  };
  root.addEventListener('pointermove', (e) => {
    const f = e.target.closest && e.target.closest('.rfs-f');
    if (f && document.activeElement !== f && root.contains(f)) f.focus({ preventScroll: true });
  });

  function back() {
    const s = S.state.screen;
    if (s === 'title') return;
    if (s === 'main') return S.showScreen('title');
    if (s === 'credits' || s === 'select' || s === 'tourney' || s === 'tourney-results') return S.showScreen('main');
    if (s === 'ladder') return S.showScreen('select');
    if (s === 'pause') return resume();
    if (s === 'results' || s === 'ending') return toMain();
  }

  /* ---------- actions ---------- */
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    S.sfx('click');
    const act = b.dataset.act;
    cancelAutoRematch();
    if (act === 'cancelAuto') return;
    if (act === 'start') S.showScreen('main');
    else if (act === 'mode') {
      if (b.dataset.loop === '1' && window.RFSetLoopCpu) window.RFSetLoopCpu(true);
      else if (b.dataset.loop === '1') {
        try { localStorage.setItem('rf_loop_cpu', '1'); localStorage.setItem('rf_autorematch', '1'); } catch (_) {}
      }
      openSelect(b.dataset.mode);
    }
    else if (act === 'tournament') { if (S.openTournament) S.openTournament(); }
    else if (act === 'settings') S.openSettings();
    else if (act === 'credits') S.showScreen('credits');
    else if (act === 'back') back();
    else if (act === 'menu') toMain();
    else if (act === 'go') startFromSelect();
    else if (act === 'preset') setPaint(b.dataset.side, fromPreset(b.dataset.preset));
    else if (act === 'swatch') setPaint(b.dataset.side, { [b.dataset.k]: b.dataset.c, preset: null });
    else if (act === 'opp') { sel.opp = b.dataset.opp; S.save('opp', sel.opp); paintSelect(); previewOpponent(); }
    else if (act === 'dummy') { sel.dummyBlock = b.dataset.v === 'block'; S.save('dummyBlock', sel.dummyBlock); paintSelect(); }
    else if (act === 'swap') { S.state.padSwap = !S.state.padSwap; paintPads(); }
    else if (act === 'ladderGo') startArcadeFight();
    else if (act === 'rematch') { S.state.paused = false; S.restartMatch(); }
    else if (act === 'retry') { S.arcade.continues += 1; startArcadeFight(); }
    else if (act === 'next') { renderLadder(); S.showScreen('ladder'); }
    else if (act === 'fighters') { const m = S.state.mode; S.abortMatch(sel.p1, sel.p2); openSelect(m); }
    else if (act === 'resume') resume();
    else if (act === 'restart') { S.state.paused = false; S.restartMatch(); }
    else if (act === 'reset') { resume(); S.trainingReset(); }
    else if (act === 'pauseSettings') S.openSettings();
    else if (act === 'ending') renderEnding();
  });

  function toMain() {
    S.abortMatch(sel.p1, sel.p2);
    S.showScreen('main');
  }

  /* ---------- fighter select ---------- */
  function swatchRow(side, k) {
    return S.SWATCHES.map((c) => `<button type="button" class="rfs-f rfs-swatch" data-act="swatch" data-side="${side}" data-k="${k}" data-c="${c}" style="--c:${c}" aria-label="${k} ${c}"></button>`).join('');
  }
  function paintPanel(side, label) {
    return `<section class="rfs-card rfs-panel" data-side="${side}">
      <header><small>${label}</small><b class="rfs-pname"></b></header>
      <div class="rfs-lbl">Paint presets</div>
      <div class="rfs-presets">${S.PRESETS.map((p) => `<button type="button" class="rfs-f rfs-preset" data-act="preset" data-side="${side}" data-preset="${p.id}"><i style="--a:${p.primary};--b:${p.accent}"></i><span>${p.name}</span></button>`).join('')}</div>
      <div class="rfs-lbl">Primary <small>body · arms</small></div><div class="rfs-sw">${swatchRow(side, 'primary')}</div>
      <div class="rfs-lbl">Accent <small>head · legs</small></div><div class="rfs-sw">${swatchRow(side, 'accent')}</div>
    </section>`;
  }
  const MODE_INFO = {
    fight: ['Fight', 'Quick match · best of 3'],
    arcade: ['Arcade', 'Nine opponents · rising difficulty'],
    versus: ['Versus', 'Local two-player · best of 3'],
    training: ['Training', 'Dummy · no timer'],
    watch: ['Bot vs Bot', 'Watch two CPUs · best of 3'],
    tournament: ['AI Tournament', 'API vs API · round-robin'],
  };
  function modeInfo(mode) {
    const row = MODE_INFO[mode] || ['', ''];
    if (mode === 'training' || mode === 'arcade') return row;
    const n = (S.bestOf && S.bestOf(true)) || 3;
    const tag = n === 1 ? 'single round' : 'best of ' + n;
    return [row[0], row[1].replace(/best of \d+|single round/, tag)];
  }
  function openSelect(mode) {
    if (S.fighterSelect && S.fighterSelect.open(mode)) return; // [fighter-select hook] new select screen
    S.state.mode = mode;
    const [title, sub] = modeInfo(mode);
    let right = '';
    if (mode === 'versus') right = paintPanel('p2', 'Player 2');
    else if (mode === 'fight' || mode === 'watch') {
      right = `<section class="rfs-card rfs-panel rfs-opps"><header><small>Opponent</small><b>Choose a CPU</b></header>
        <div class="rfs-opplist">
          <button type="button" class="rfs-f rfs-opp" data-act="opp" data-opp="random"><i style="--a:#9aabff;--b:#4a505c"></i><span><b>Random</b><small>Any of the nine</small></span></button>
          ${S.ROSTER.map((o) => `<button type="button" class="rfs-f rfs-opp" data-act="opp" data-opp="${o.id}"><i style="--a:${o.primary};--b:${o.accent}"></i><span><b>${esc(o.name)}</b><small>${esc(o.style)} · ${esc(o.title)}</small></span></button>`).join('')}
        </div>
        <p class="rfs-note">CPU difficulty: <b class="rfs-cpu"></b> (change in Settings)</p></section>`;
    } else if (mode === 'training') {
      right = `<section class="rfs-card rfs-panel"><header><small>Training dummy</small><b>Behavior</b></header>
        <div class="rfs-seg"><button type="button" class="rfs-f" data-act="dummy" data-v="idle">Stand idle</button><button type="button" class="rfs-f" data-act="dummy" data-v="block">Hold block</button></div>
        <p class="rfs-note">No timer. Press <kbd>R</kbd> to reset damage and health, <kbd>B</kbd> to toggle blocking, <kbd>Esc</kbd> for the menu.</p></section>`;
    } else {
      right = `<section class="rfs-card rfs-panel"><header><small>Arcade ladder</small><b>Nine opponents</b></header>
        <ol class="rfs-mini">${S.ROSTER.map((o) => `<li><i style="--a:${o.primary};--b:${o.accent}"></i>${esc(o.name)} <small>${esc(o.style)}</small></li>`).join('')}</ol>
        <p class="rfs-note">Lose a fight and you can continue from the same rung.</p></section>`;
    }
    S.$('.rfs-selwrap', selEl).innerHTML = `
      <header class="rfs-selhead"><small>${sub}</small><b>${title}</b></header>
      <div class="rfs-left">${paintPanel('p1', mode === 'versus' ? 'Player 1' : mode === 'watch' ? 'Blue corner CPU' : 'Your robot')}</div>
      <div class="rfs-right">${right}</div>
      <div class="rfs-selfoot">
        ${mode === 'versus' ? '<div class="rfs-pads"><span class="rfs-padtxt"></span><button type="button" class="rfs-f rfs-btn rfs-small" data-act="swap">Swap gamepads</button></div>' : ''}
        <button type="button" class="rfs-f rfs-btn rfs-small" data-act="back">Back</button>
        <button type="button" class="rfs-f rfs-btn rfs-go" data-act="go" data-autofocus>${mode === 'arcade' ? 'To the ladder' : 'Start'}</button>
      </div>`;
    delete lastFocus.select;
    paintSelect();
    paintPads();
    previewSelect();
    S.showScreen('select');
  }
  function paintSelect() {
    for (const side of ['p1', 'p2']) {
      const panel = S.$(`.rfs-panel[data-side="${side}"]`, selEl);
      if (!panel) continue;
      const pt = sel[side];
      S.$('.rfs-pname', panel).textContent = paintName(pt);
      S.$$('.rfs-preset', panel).forEach((b) => b.setAttribute('aria-pressed', String(paintName(pt) === preset(b.dataset.preset).name)));
      S.$$('.rfs-swatch', panel).forEach((b) => b.setAttribute('aria-pressed', String(pt[b.dataset.k] === b.dataset.c)));
    }
    S.$$('.rfs-opp', selEl).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.opp === sel.opp)));
    S.$$('[data-act="dummy"]', selEl).forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.v === 'block') === sel.dummyBlock)));
    const cpu = S.$('.rfs-cpu', selEl);
    if (cpu) { const c = S.cpuSetting(); cpu.textContent = c[0].toUpperCase() + c.slice(1); }
  }
  function paintPads() {
    const t = S.$('.rfs-padtxt', selEl);
    if (!t) return;
    const n = S.pads().length;
    const a = S.state.padSwap ? 'P2' : 'P1';
    const b = S.state.padSwap ? 'P1' : 'P2';
    t.textContent = n === 0 ? 'No gamepads — keyboard only' : n === 1 ? `1 gamepad → ${a} (other player on keyboard)` : `Gamepad 1 → ${a} · Gamepad 2 → ${b}`;
  }
  S.on('pads', paintPads);
  function setPaint(side, patch) {
    Object.assign(sel[side], patch);
    S.save(side, sel[side]);
    paintSelect();
    previewSelect();
  }
  function cfgFromFighter(id, fallbackName) {
    const o = (id && id !== 'random' && S.fighterOf && S.fighterOf(id)) || null;
    if (!o) {
      return { name: fallbackName || 'Random', primary: '#4a505c', accent: '#9aabff', profile: 'sprocket', color: S.hex('#4a505c') };
    }
    return { id: o.id, name: o.name, primary: o.primary, accent: o.accent, profile: o.profile || o.id, skin: o.skin, color: S.hex(o.primary) };
  }
  function previewOpponent() {
    if ((S.state.mode !== 'fight' && S.state.mode !== 'watch') || !S.api) return;
    const id = sel.opp === 'random' ? 'random' : sel.opp;
    if (S.api.previewSelectFighter) S.api.previewSelectFighter('p2', cfgFromFighter(id, 'Random'));
    else if (S.api.p2) {
      const o = cfgFromFighter(id, 'Random');
      S.paint(S.api.p2, o.primary, o.accent);
    }
  }
  function previewSelect() {
    if (!S.api) return;
    const m = S.state.mode;
    const left = cfgFromFighter(sel.p1Id, 'Blue');
    let right;
    if (m === 'versus') right = cfgFromFighter(sel.p2Id, 'Red');
    else if (m === 'fight' || m === 'watch') right = cfgFromFighter(sel.opp, 'Random');
    else if (m === 'training') right = { name: 'Dummy', primary: '#4a505c', accent: '#9aabff', profile: 'sprocket', color: S.hex('#4a505c') };
    else right = cfgFromFighter((S.arcade && S.ROSTER[S.arcade.idx] && S.ROSTER[S.arcade.idx].id) || S.ROSTER[0].id);
    if (S.api.showSelectPreview) S.api.showSelectPreview({ p1: left, p2: right });
    else {
      if (S.api.p1) S.paint(S.api.p1, left.primary, left.accent);
      if (S.api.p2) S.paint(S.api.p2, right.primary, right.accent);
    }
  }

  const sideCfg = (id, labelPrefix, extra) => {
    const o = cfgFromFighter(id);
    const name = o.name || 'Fighter';
    return Object.assign({
      name,
      label: (labelPrefix ? labelPrefix + ' · ' : '') + name,
      paint: { primary: o.primary, accent: o.accent },
      profile: o.profile,
      skin: o.skin,
      color: o.color,
    }, extra || {});
  };
  const p1Cfg = (versus) => sideCfg(sel.p1Id, versus ? 'P1' : (S.state.mode === 'watch' ? 'CPU' : 'You'));
  const oppCfg = (o) => sideCfg(o.id, 'CPU');

  function startFromSelect() {
    const mode = S.state.mode;
    if (mode === 'arcade') {
      S.arcade = { idx: 0, continues: 0, total: [0, 1].map(() => ({ hits: 0, damage: 0, parts: 0, blocked: 0 })) };
      renderLadder();
      S.showScreen('ladder');
      return;
    }
    if (mode === 'fight') {
      const o = sel.opp === 'random' ? S.ROSTER[Math.floor(Math.random() * S.ROSTER.length)] : S.opponent(sel.opp);
      S.startMatch({ mode, p1: p1Cfg(false), p2: oppCfg(o), opp: o });
    } else if (mode === 'watch') {
      const o = sel.opp === 'random' ? S.ROSTER[Math.floor(Math.random() * S.ROSTER.length)] : S.opponent(sel.opp);
      S.startMatch({ mode, p1: sideCfg(sel.p1Id, 'CPU'), p2: oppCfg(o), opp: o });
    } else if (mode === 'versus') {
      const right = sel.p2Id === 'random' ? S.ROSTER[Math.floor(Math.random() * S.ROSTER.length)] : (S.fighterOf(sel.p2Id) || S.ROSTER[0]);
      S.startMatch({ mode, p1: p1Cfg(true), p2: sideCfg(right.id, 'P2') });
    } else {
      S.startMatch({ mode, p1: p1Cfg(false), p2: { name: 'Dummy', label: 'Training dummy', paint: { primary: '#4a505c', accent: '#9aabff' } }, dummyBlock: sel.dummyBlock });
    }
  }

  // [fighter-select hook] shared choices + start, used by js/shell/fighter-select.js.
  S.selectHooks = { sel, MODE_INFO, modeInfo, fromPreset, paintName, setPaint, previewSelect, cfgFromFighter, syncSelPaint, start: startFromSelect };

  /* ---------- arcade ---------- */
  function renderLadder() {
    const a = S.arcade;
    const o = S.ROSTER[a.idx];
    S.$('.rfs-ladder', ladderEl).innerHTML = `
      <header class="rfs-selhead"><small>Arcade · fight ${a.idx + 1} of ${S.ROSTER.length}${a.continues ? ' · continues used: ' + a.continues : ''}</small><b>The Ladder</b></header>
      <ol class="rfs-rungs">${S.ROSTER.map((r, i) => {
        const st = i < a.idx ? 'beaten' : i === a.idx ? 'next' : 'locked';
        return `<li class="${st}"><i style="--a:${r.primary};--b:${r.accent}"></i>
          <span><b>${esc(r.name)}</b><small>${esc(r.title)} · ${esc(r.style)}</small></span>
          <em class="rfs-diff" aria-label="Difficulty ${i + 1} of ${S.ROSTER.length}">${'<u></u>'.repeat(i + 1)}${'<u class="off"></u>'.repeat(Math.max(0, S.ROSTER.length - 1 - i))}</em>
          <strong>${st === 'beaten' ? 'Beaten' : st === 'next' ? 'Next' : ''}</strong></li>`;
      }).join('')}</ol>
      <p class="rfs-blurb"><b>${esc(o.name)}:</b> ${esc(o.blurb)}</p>
      <div class="rfs-row">
        <button type="button" class="rfs-f rfs-btn rfs-small" data-act="menu">Main menu</button>
        <button type="button" class="rfs-f rfs-btn rfs-go" data-act="ladderGo" data-autofocus>Fight ${esc(o.name)}</button>
      </div>`;
    delete lastFocus.ladder;
    if (S.api) S.paint(S.api.p2, o.primary, o.accent);
  }
  function startArcadeFight() {
    const o = S.ROSTER[S.arcade.idx];
    S.startMatch({ mode: 'arcade', p1: p1Cfg(false), p2: oppCfg(o), opp: o });
  }

  /* ---------- results ---------- */
  const METHOD = { KO: 'KO', TKO: 'TKO', Decision: 'Decision', Draw: 'Draw' };
  function statsTable(total, cfg, wins) {
    // Counters that a build does not track stay undefined and their rows are left out (no made-up numbers).
    const has = (k) => typeof total[0][k] === 'number' && typeof total[1][k] === 'number';
    const acc = (i) => (total[i].thrown > 0 ? Math.min(100, Math.round((total[i].hits / total[i].thrown) * 100)) + '%' : '–');
    const rows = [
      ['Rounds won', wins ? wins[0] : '–', wins ? wins[1] : '–'],
      has('thrown') && ['Strikes thrown', total[0].thrown, total[1].thrown],
      ['Strikes landed', total[0].hits, total[1].hits],
      has('thrown') && ['Accuracy', acc(0), acc(1)],
      has('kd') && ['Knockdowns', total[0].kd, total[1].kd],
      ['Damage dealt', Math.round(total[0].damage), Math.round(total[1].damage)],
      ['Parts destroyed', total[0].parts, total[1].parts],
      ['Parts lost', total[1].parts, total[0].parts],
      ['Hits blocked', total[0].blocked, total[1].blocked],
    ].filter(Boolean);
    const head = (p) => `<th><i style="--a:${p.paint.primary};--b:${p.paint.accent}"></i>${esc(p.name)}</th>`;
    return `<table class="rfs-stats"><thead><tr><th></th>${head(cfg.p1)}${head(cfg.p2)}</tr></thead><tbody>${rows.map((r) => {
      const lowWins = r[0] === 'Parts lost';
      const hi = typeof r[1] === 'number' && r[1] !== r[2] ? ((r[1] > r[2]) !== lowWins ? 1 : 2) : 0;
      return `<tr><td>${r[0]}</td><td class="${hi === 1 ? 'hi' : ''}">${r[1]}</td><td class="${hi === 2 ? 'hi' : ''}">${r[2]}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  S.on('matchEnd', (w) => {
    const M = S.match;
    const cfg = M.cfg;
    const mode = cfg.mode;
    if (mode === 'tournament') {
      if (S.onTournamentMatchEnd) S.onTournamentMatchEnd(w, M);
      return;
    }
    const winner = w == null ? null : (w === 0 ? cfg.p1 : cfg.p2);
    const title = w == null ? 'Match drawn' : (mode !== 'versus' && mode !== 'watch' && w === 0 ? 'You win' : winner.name + ' wins');
    const last = M.rounds[M.rounds.length - 1];
    // Method and round of victory: the last round the match winner took (the deciding one).
    const won = w == null ? null : [...M.rounds].reverse().find((r) => r.winner === w);
    const sub = w == null ? 'Even on rounds and damage.'
      : won ? `${M.wins[w]}–${M.wins[1 - w]} · won by ${METHOD[won.method]} in round ${won.n}`
      : `${M.wins[w]}–${M.wins[1 - w]} · won on damage after ${M.rounds.length} rounds`;
    let buttons = '';
    if (mode === 'arcade') {
      const a = S.arcade;
      for (let i = 0; i < 2; i++) for (const k of ['hits', 'damage', 'parts', 'blocked', 'thrown', 'kd']) if (typeof M.total[i][k] === 'number') a.total[i][k] = (a.total[i][k] || 0) + M.total[i][k];
      if (w === 0) {
        a.idx += 1;
        buttons = a.idx >= S.ROSTER.length
          ? '<button type="button" class="rfs-f rfs-btn rfs-go" data-act="ending" data-autofocus>Claim the title</button>'
          : `<button type="button" class="rfs-f rfs-btn rfs-small" data-act="menu">Main menu</button><button type="button" class="rfs-f rfs-btn rfs-go" data-act="next" data-autofocus>Next: ${esc(S.ROSTER[a.idx].name)}</button>`;
      } else {
        buttons = '<button type="button" class="rfs-f rfs-btn rfs-small" data-act="menu">Give up</button><button type="button" class="rfs-f rfs-btn rfs-go" data-act="retry" data-autofocus>Continue</button>';
      }
    } else {
      buttons = `<button type="button" class="rfs-f rfs-btn rfs-small" data-act="menu">Main menu</button>
        <button type="button" class="rfs-f rfs-btn rfs-small" data-act="fighters">Change fighters</button>
        <button type="button" class="rfs-f rfs-btn rfs-go" data-act="rematch" data-autofocus>Rematch</button>`;
    }
    S.$('.rfs-results', resultsEl).innerHTML = `
      <header class="rfs-selhead"><small>${esc(MODE_INFO[mode][0])}${mode === 'arcade' ? ' · ' + esc(cfg.opp.name) : ''}</small><b>${esc(title)}</b></header>
      <p class="rfs-sub">${esc(sub)}</p>
      <div class="rfs-chips">${M.rounds.map((r) => `<span class="${r.winner === 0 ? 'p1' : r.winner === 1 ? 'p2' : ''}">R${r.n} · ${r.winner == null ? 'Draw' : esc(r.winner === 0 ? cfg.p1.name : cfg.p2.name)} · ${METHOD[r.method]}</span>`).join('')}</div>
      ${statsTable(M.total, cfg, M.wins)}
      <div class="rfs-row">${buttons}</div>`;
    delete lastFocus.results;
    S.sfx(w === 0 || mode === 'versus' ? 'ko' : 'click');
    setTimeout(() => S.showScreen('results'), 250);
    if (mode === 'watch' && autoRematchOn()) startAutoRematch();
  });

  /* ---------- auto rematch (Bot vs Bot, Settings > Fight, off by default) ---------- */
  const AUTO_SECS = 6;
  let autoTimer = null;
  function autoRematchOn() {
    try { return localStorage.getItem('rf_autorematch') === '1' || localStorage.getItem('rf_loop_cpu') === '1'; } catch (_) { return false; }
  }
  function loopCpuOn() {
    try { return localStorage.getItem('rf_loop_cpu') === '1'; } catch (_) { return false; }
  }
  function cancelAutoRematch() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = null;
    const el = S.$('.rfs-auto', resultsEl);
    if (el) el.remove();
  }
  function startAutoRematch() {
    cancelAutoRematch();
    const box = S.$('.rfs-results', resultsEl);
    if (!box) return;
    const p = document.createElement('p');
    p.className = 'rfs-auto rfs-sub';
    const secs = loopCpuOn() ? 2 : AUTO_SECS;
    p.innerHTML = 'Next match in <b>' + secs + '</b>s <button type="button" class="rfs-f rfs-btn rfs-small" data-act="cancelAuto">Cancel</button>';
    box.appendChild(p);
    let left = secs;
    autoTimer = setInterval(() => {
      if (S.state.paused || document.hidden) return; // hold while paused or in another tab
      left -= 1;
      const b2 = p.querySelector('b');
      if (b2) b2.textContent = String(Math.max(0, left));
      if (left <= 0) {
        cancelAutoRematch();
        if (S.match && S.match.phase === 'match-end' && autoRematchOn()) { S.state.paused = false; S.restartMatch(); }
      }
    }, 1000);
  }

  function renderEnding() {
    const a = S.arcade;
    const cfg = { p1: p1Cfg(false), p2: { name: 'Ladder', paint: { primary: '#1b1e26', accent: '#e23b3b' } } };
    S.$('.rfs-ending', endingEl).innerHTML = `
      <header class="rfs-selhead"><small>Arcade complete</small><b>Octagon Champion</b></header>
      <p class="rfs-sub">Overseer Prime is scrap. All nine robots fell to your ${esc(paintName(sel.p1))} brawler${a.continues ? ` after ${a.continues} continue${a.continues > 1 ? 's' : ''}` : ' without a single continue'}.</p>
      ${statsTable(a.total, cfg, null)}
      <p class="rfs-note">Thanks for playing — Window Workshop Games</p>
      <div class="rfs-row"><button type="button" class="rfs-f rfs-btn rfs-small" data-act="credits">Credits</button><button type="button" class="rfs-f rfs-btn rfs-go" data-act="menu" data-autofocus>Main menu</button></div>`;
    delete lastFocus.ending;
    S.abortMatch(sel.p1, sel.p2);
    S.showScreen('ending');
  }

  /* ---------- pause ---------- */
  function renderPause() {
    const mode = S.state.mode;
    S.$('.rfs-pause', pauseEl).innerHTML = `
      <header class="rfs-selhead"><small>${esc(MODE_INFO[mode][0])}</small><b>Paused</b></header>
      <nav class="rfs-menu">
        <button type="button" class="rfs-f rfs-btn" data-act="resume" data-autofocus><b>Resume</b></button>
        ${mode === 'training' ? '<button type="button" class="rfs-f rfs-btn" data-act="reset"><b>Reset dummy</b></button>' : '<button type="button" class="rfs-f rfs-btn" data-act="restart"><b>Restart match</b></button>'}
        <button type="button" class="rfs-f rfs-btn" data-act="pauseSettings"><b>Settings</b></button>
        <button type="button" class="rfs-f rfs-btn" data-act="menu"><b>Quit to main menu</b></button>
      </nav>
      <ul class="rfs-keys">${mode === 'versus' ? `<li><em>P1</em> ${KEYS_P1}</li><li><em>P2</em> ${KEYS_P2}</li>` : KEYS_SOLO}${PAD}</ul>`;
    delete lastFocus.pause;
  }
  function openPause() {
    if (S.state.screen !== 'fight' || !S.match.cfg) return;
    S.state.paused = true;
    renderPause();
    S.showScreen('pause');
  }
  function resume() {
    S.state.paused = false;
    S.showScreen('fight');
  }
  S.togglePause = () => { if (S.state.screen === 'pause') resume(); else openPause(); };
  S.fightKey = (e) => {
    if (e.repeat) return false;
    if (e.code === 'Escape' || e.code === 'KeyP') { openPause(); return true; }
    if (S.state.mode === 'training') {
      if (e.code === 'KeyR') { S.trainingReset(); return true; }
      if (e.code === 'KeyB') { S.toggleDummyBlock(); return true; }
    }
    return false;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && S.state.screen === 'fight' && S.match.phase !== 'match-end') openPause();
  });
  S.on('paddrop', () => { if (S.state.mode === 'versus' && S.state.screen === 'fight') openPause(); });

  /* ---------- training panel ---------- */
  S.paintTraining = () => {
    const t = S.match.train || { hits: 0, damage: 0, combo: 0, best: 0 };
    trainEl.innerHTML = `<b>Training</b>
      <span>Hits <em>${t.hits}</em></span><span>Damage <em>${Math.round(t.damage)}</em></span><span>Combo <em>${t.combo}</em></span><span>Best <em>${t.best}</em></span>
      <button type="button" data-k="b">Dummy: ${S.match.dummyBlock ? 'Blocking' : 'Idle'} <kbd>B</kbd></button>
      <button type="button" data-k="r">Reset <kbd>R</kbd></button>
      <button type="button" data-k="esc">Menu <kbd>Esc</kbd></button>`;
  };
  trainEl.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.k === 'r') S.trainingReset();
    else if (b.dataset.k === 'b') S.toggleDummyBlock();
    else openPause();
    b.blur();
  });

  /* ---------- menu camera: slow orbit behind title / main / credits ---------- */
  let orbitA = 0.35;
  S.on('frame', (dt, raw) => {
    const api = S.api;
    const onSelect = S.state.screen === SELECT_SCREEN && !S.match.cfg;
    if ((!ORBIT_SCREENS.includes(S.state.screen) && !onSelect) || !api.camera || !api.match) return;
    if (S.match.cfg && !onSelect) return;
    api.match.camLock = true;
    orbitA += raw * (onSelect ? 0.055 : 0.07);
    const mt = (api.ARENA && api.ARENA.matTop) || 0.9;
    if (onSelect) {
      // High enough to frame both robots and the glowing pads, not a low leg shot.
      const r = 8.8;
      const y = mt + 3.55 + Math.sin(orbitA * 0.7) * 0.2;
      api.camera.position.set(Math.sin(orbitA) * r, y, Math.cos(orbitA) * r);
      api.camera.lookAt(0, mt + 1.05, 0);
    } else {
      // Slow high orbit of the empty cage (robots are not in the scene on the menu).
      const r = 10.4;
      const y = mt + 5.4 + Math.sin(orbitA * 0.7) * 0.28;
      api.camera.position.set(Math.sin(orbitA) * r, y, Math.cos(orbitA) * r);
      api.camera.lookAt(0, mt + 1.35, 0);
    }
  });
  // Leaving the orbit / select screens hands the camera back to the game, and
  // leaving select unstages the preview robots so the main menu stays empty.
  const baseShow = S.showScreen;
  S.showScreen = (name) => {
    const was = S.state.screen;
    if (S.api && was === SELECT_SCREEN && name !== SELECT_SCREEN && name !== 'fight' && name !== 'ladder') {
      try { if (S.api.hideSelectPreview) S.api.hideSelectPreview(); } catch (e) { console.warn('[select]', e); }
    }
    if (S.api && !ORBIT_SCREENS.includes(name) && name !== SELECT_SCREEN) S.api.match.camLock = false;
    baseShow(name);
  };

  /* ---------- settings sheet integration (no edits to settings.js) ---------- */

  function setCtrlTab(which, fromPad) {
    S.$$('.rfs-ctrl-tab').forEach((b) => {
      const on = b.dataset.ctrlTab === which;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', String(on));
    });
    S.$$('.rfs-ctrl-pane').forEach((p) => p.classList.toggle('is-on', p.dataset.ctrlPane === which));
    if (!fromPad) S._ctrlTabLock = which;
  }
  const HINT_KB = '<kbd>A</kbd>/<kbd>D</kbd> sidestep · <kbd>W</kbd>/<kbd>S</kbd> in/out · <kbd>J</kbd> punch · <kbd>K</kbd> kick · <kbd>L</kbd> block · <kbd>Q</kbd> rocket · <kbd>E</kbd> dash · <kbd>X</kbd> back dash · <kbd>I</kbd> ground · <kbd>V</kbd> camera · <kbd>Esc</kbd> pause';
  const HINT_PS = '<span class="ps">LS</span>/<span class="ps">D-pad</span> move · <span class="ps">✕</span> punch · <span class="ps">○</span> kick · <span class="ps">□</span> block · <span class="ps">△</span> ground · <span class="ps">L1</span> rocket · <span class="ps">R2</span> dash · <span class="ps">L2</span> run · <span class="ps">R1</span>+fwd flip · <span class="ps">Options</span> pause';
  function paintControlsHint() {
    const el = document.getElementById('controlsHint');
    if (!el) return;
    const pad = S.pads && S.pads()[0];
    el.classList.toggle('ps-hint', !!pad);
    el.innerHTML = pad ? HINT_PS : HINT_KB;
  }
  root.addEventListener('click', (e) => {
    const tab = e.target.closest && e.target.closest('[data-ctrl-tab]');
    if (!tab || !root.contains(tab)) return;
    setCtrlTab(tab.dataset.ctrlTab);
  });
  S.on('pads', () => {
    paintControlsHint();
    if (S._ctrlTabLock) return;
    setCtrlTab(S.pads && S.pads().length ? 'pad' : 'kb', true);
  });

  function watchSettings() {
    const panel = document.getElementById('setp');
    if (!panel) return;
    let wasOpen = S.settingsOpen();
    new MutationObserver(() => {
      const open = S.settingsOpen();
      if (wasOpen && !open && S.menuActive()) { focusScreen(S.state.screen); paintSelect(); }
      wasOpen = open;
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
    // The bottom hint says "Esc settings"; in the shell Esc opens the pause menu (Settings is inside it).
    S.$$('#controlsHint kbd').forEach((k) => {
      const n = k.nextSibling;
      if (k.textContent === 'Esc' && n && n.nodeType === 3) n.textContent = n.textContent.replace('settings', 'pause');
    });
    // Round time option 0 stays labelled "Off" (a real no-timer fight, not a 90s default).
  }

  // Wheel over the menus should scroll/ignore, not zoom the game camera.
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  S.on('ready', () => {
    watchSettings();
    S.toMenuState(sel.p1, sel.p2);
    paintControlsHint();
    S.showScreen('title');
  });
})();
