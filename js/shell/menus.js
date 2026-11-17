/* Robot Fight shell: title, main menu, fighter select, arcade ladder, results, ending,
   pause, credits, training panel, versus controls bar. Keyboard / mouse / gamepad. */
(function () {
  'use strict';
  const S = window.RFShell;
  const esc = S.esc;
  const MENU_SCREENS = ['title', 'main', 'select', 'ladder', 'results', 'ending', 'pause', 'credits'];
  const ORBIT_SCREENS = ['title', 'main', 'credits'];

  /* ---------- persisted choices ---------- */
  const preset = (id) => S.PRESETS.find((p) => p.id === id) || S.PRESETS[0];
  const fromPreset = (id) => { const p = preset(id); return { preset: p.id, primary: p.primary, accent: p.accent }; };
  const sel = {
    p1: Object.assign(fromPreset('cobalt'), S.load('p1', {})),
    p2: Object.assign(fromPreset('crimson'), S.load('p2', {})),
    opp: S.load('opp', 'random'),
    dummyBlock: !!S.load('dummyBlock', false),
  };
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
    <li><kbd>Esc</kbd> / <kbd>P</kbd> <span>pause</span></li>`;
  const KEYS_P1 = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move · <kbd>F</kbd> punch · <kbd>G</kbd> kick · <kbd>H</kbd> block';
  const KEYS_P2 = '<kbd>←</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>→</kbd> move · <kbd>.</kbd> punch · <kbd>/</kbd> kick · <kbd>Right Shift</kbd> block';
  const PAD = '<li><span>Stick / D-pad</span> move · <kbd>A</kbd> punch · <kbd>B</kbd> kick · <kbd>X</kbd>/shoulder block · <kbd>Start</kbd> pause</li>';

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
      <p class="rfs-tag">Six steel brawlers. One octagon. Parts fly.</p>
      <button type="button" class="rfs-f rfs-press" data-act="start">Press <kbd>Enter</kbd> · <kbd>A</kbd> · or click to start</button>
    </div>
    <div class="rfs-foot">© Window Workshop Games</div>`, 'rfs-center');

  screen('main', `
    <div class="rfs-mainwrap">
      <div class="rfs-col">
        ${brand}
        <nav class="rfs-menu" aria-label="Main menu">
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="fight"><b>Fight</b><small>Quick match vs a CPU robot</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="arcade"><b>Arcade</b><small>Climb the six-robot ladder</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="versus"><b>Versus</b><small>Two players, one keyboard or two gamepads</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="mode" data-mode="training"><b>Training</b><small>Practice on a dummy, no timer</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="settings"><b>Settings</b><small>Graphics, sound, CPU difficulty, round time</small></button>
          <button type="button" class="rfs-f rfs-btn" data-act="credits"><b>Credits</b></button>
        </nav>
      </div>
      <aside class="rfs-card rfs-controls" aria-label="Controls">
        <h3>Controls</h3>
        <h4>Solo</h4><ul>${KEYS_SOLO}</ul>
        <h4>Versus</h4><ul><li><em>P1</em> ${KEYS_P1}</li><li><em>P2</em> ${KEYS_P2}</li><li>Gamepad 1 → P1, gamepad 2 → P2</li></ul>
        <h4>Gamepad</h4><ul>${PAD}</ul>
        <h4>Menus</h4><ul><li>Arrows / WASD / D-pad · <kbd>Enter</kbd> or <kbd>A</kbd> select · <kbd>Esc</kbd> or <kbd>B</kbd> back</li></ul>
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
        <li><b>Animations:</b> Mixamo (Adobe) — fighting idle, walks, strafes, punches, kicks, blocks, hits, knockouts, get-ups.</li>
        <li><b>Arena metal textures:</b> Metal009 from ambientCG, CC0 1.0.</li>
        <li><b>3D engine:</b> three.js r187, MIT license.</li>
        <li><b>Settings panel look and volume taper:</b> adapted from Window Workshop Games UI.</li>
      </ul>
      <p class="rfs-note">CPU fighters, names, and paint schemes are original to this game. Full license notes are in README.md and models/CREDITS.md.</p>
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
    if (s === 'credits' || s === 'select') return S.showScreen('main');
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
    if (act === 'start') S.showScreen('main');
    else if (act === 'mode') openSelect(b.dataset.mode);
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
    arcade: ['Arcade', 'Six opponents · rising difficulty'],
    versus: ['Versus', 'Local two-player · best of 3'],
    training: ['Training', 'Dummy · no timer'],
  };
  function openSelect(mode) {
    S.state.mode = mode;
    const [title, sub] = MODE_INFO[mode];
    let right = '';
    if (mode === 'versus') right = paintPanel('p2', 'Player 2');
    else if (mode === 'fight') {
      right = `<section class="rfs-card rfs-panel rfs-opps"><header><small>Opponent</small><b>Choose a CPU</b></header>
        <div class="rfs-opplist">
          <button type="button" class="rfs-f rfs-opp" data-act="opp" data-opp="random"><i style="--a:#9aabff;--b:#4a505c"></i><span><b>Random</b><small>Any of the six</small></span></button>
          ${S.ROSTER.map((o) => `<button type="button" class="rfs-f rfs-opp" data-act="opp" data-opp="${o.id}"><i style="--a:${o.primary};--b:${o.accent}"></i><span><b>${esc(o.name)}</b><small>${esc(o.style)} · ${esc(o.title)}</small></span></button>`).join('')}
        </div>
        <p class="rfs-note">CPU difficulty: <b class="rfs-cpu"></b> (change in Settings)</p></section>`;
    } else if (mode === 'training') {
      right = `<section class="rfs-card rfs-panel"><header><small>Training dummy</small><b>Behavior</b></header>
        <div class="rfs-seg"><button type="button" class="rfs-f" data-act="dummy" data-v="idle">Stand idle</button><button type="button" class="rfs-f" data-act="dummy" data-v="block">Hold block</button></div>
        <p class="rfs-note">No timer. Press <kbd>R</kbd> to reset damage and health, <kbd>B</kbd> to toggle blocking, <kbd>Esc</kbd> for the menu.</p></section>`;
    } else {
      right = `<section class="rfs-card rfs-panel"><header><small>Arcade ladder</small><b>Six opponents</b></header>
        <ol class="rfs-mini">${S.ROSTER.map((o) => `<li><i style="--a:${o.primary};--b:${o.accent}"></i>${esc(o.name)} <small>${esc(o.style)}</small></li>`).join('')}</ol>
        <p class="rfs-note">Lose a fight and you can continue from the same rung.</p></section>`;
    }
    S.$('.rfs-selwrap', selEl).innerHTML = `
      <header class="rfs-selhead"><small>${sub}</small><b>${title}</b></header>
      <div class="rfs-left">${paintPanel('p1', mode === 'versus' ? 'Player 1' : 'Your robot')}</div>
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
  function previewOpponent() {
    if (S.state.mode !== 'fight' || !S.api) return;
    const o = sel.opp === 'random' ? { primary: '#4a505c', accent: '#9aabff' } : S.opponent(sel.opp);
    S.paint(S.api.p2, o.primary, o.accent);
  }
  function previewSelect() {
    if (!S.api) return;
    const m = S.state.mode;
    S.paint(S.api.p1, sel.p1.primary, sel.p1.accent);
    if (m === 'versus') S.paint(S.api.p2, sel.p2.primary, sel.p2.accent);
    else if (m === 'fight') previewOpponent();
    else if (m === 'training') S.paint(S.api.p2, '#4a505c', '#9aabff');
    else S.paint(S.api.p2, S.ROSTER[0].primary, S.ROSTER[0].accent);
  }

  const p1Cfg = (versus) => ({
    name: 'Player 1', label: (versus ? 'P1 · ' : 'You · ') + paintName(sel.p1),
    paint: { primary: sel.p1.primary, accent: sel.p1.accent },
  });
  const oppCfg = (o) => ({ name: o.name, label: o.name + ' · CPU', paint: { primary: o.primary, accent: o.accent } });

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
    } else if (mode === 'versus') {
      S.startMatch({ mode, p1: p1Cfg(true), p2: { name: 'Player 2', label: 'P2 · ' + paintName(sel.p2), paint: { primary: sel.p2.primary, accent: sel.p2.accent } } });
    } else {
      S.startMatch({ mode, p1: p1Cfg(false), p2: { name: 'Dummy', label: 'Training dummy', paint: { primary: '#4a505c', accent: '#9aabff' } }, dummyBlock: sel.dummyBlock });
    }
  }

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
          <em class="rfs-diff" aria-label="Difficulty ${i + 1} of 6">${'<u></u>'.repeat(i + 1)}${'<u class="off"></u>'.repeat(5 - i)}</em>
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
    const rows = [
      ['Rounds won', wins ? wins[0] : '–', wins ? wins[1] : '–'],
      ['Hits landed', total[0].hits, total[1].hits],
      ['Damage dealt', Math.round(total[0].damage), Math.round(total[1].damage)],
      ['Parts destroyed', total[0].parts, total[1].parts],
      ['Hits blocked', total[0].blocked, total[1].blocked],
    ];
    const head = (p) => `<th><i style="--a:${p.paint.primary};--b:${p.paint.accent}"></i>${esc(p.name)}</th>`;
    return `<table class="rfs-stats"><thead><tr><th></th>${head(cfg.p1)}${head(cfg.p2)}</tr></thead><tbody>${rows.map((r) => {
      const hi = typeof r[1] === 'number' && r[1] !== r[2] ? (r[1] > r[2] ? 1 : 2) : 0;
      return `<tr><td>${r[0]}</td><td class="${hi === 1 ? 'hi' : ''}">${r[1]}</td><td class="${hi === 2 ? 'hi' : ''}">${r[2]}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  S.on('matchEnd', (w) => {
    const M = S.match;
    const cfg = M.cfg;
    const mode = cfg.mode;
    const winner = w == null ? null : (w === 0 ? cfg.p1 : cfg.p2);
    const title = w == null ? 'Match drawn' : (mode !== 'versus' && w === 0 ? 'You win' : winner.name + ' wins');
    const last = M.rounds[M.rounds.length - 1];
    const sub = w == null ? 'Even on rounds and damage.' : `${M.wins[w]}–${M.wins[1 - w]} · final round by ${METHOD[last.method]}`;
    let buttons = '';
    if (mode === 'arcade') {
      const a = S.arcade;
      for (let i = 0; i < 2; i++) for (const k of ['hits', 'damage', 'parts', 'blocked']) a.total[i][k] += M.total[i][k];
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
  });

  function renderEnding() {
    const a = S.arcade;
    const cfg = { p1: p1Cfg(false), p2: { name: 'Ladder', paint: { primary: '#1b1e26', accent: '#e23b3b' } } };
    S.$('.rfs-ending', endingEl).innerHTML = `
      <header class="rfs-selhead"><small>Arcade complete</small><b>Octagon Champion</b></header>
      <p class="rfs-sub">Overseer Prime is scrap. All six robots fell to your ${esc(paintName(sel.p1))} brawler${a.continues ? ` after ${a.continues} continue${a.continues > 1 ? 's' : ''}` : ' without a single continue'}.</p>
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
    if (!ORBIT_SCREENS.includes(S.state.screen) || S.match.cfg || !api.camera || !api.match) return;
    api.match.camLock = true;
    orbitA += raw * 0.07;
    const r = 5.3; // inside the ring so posts and rails never block the robots
    api.camera.position.set(Math.sin(orbitA) * r, 2.2 + Math.sin(orbitA * 0.7) * 0.2, Math.cos(orbitA) * r);
    api.camera.lookAt(0, 1.15, 0);
  });
  // Leaving the orbit screens hands the camera back to the game.
  const baseShow = S.showScreen;
  S.showScreen = (name) => {
    if (S.api && !ORBIT_SCREENS.includes(name)) S.api.match.camLock = false;
    baseShow(name);
  };

  /* ---------- settings sheet integration (no edits to settings.js) ---------- */
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
    const off = S.$('#setRound option[value="0"]');
    if (off) off.textContent = 'Default (90 seconds)';
  }

  // Wheel over the menus should scroll/ignore, not zoom the game camera.
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  S.on('ready', () => {
    watchSettings();
    S.toMenuState(sel.p1, sel.p2);
    S.showScreen('title');
  });
})();
