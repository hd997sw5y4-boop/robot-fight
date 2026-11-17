/* Window Workshop Games — Robot Fight game shell: core (namespace, hook, input, loop).
   Plain script (no bundler). Drives fights through the public js/api.js (startFight / getState /
   setFighterConfig), loaded with a dynamic import so it is the same module instance game.js uses.
   js/game.js only calls window.RFShellHook for input override, pause, and a read handle. */
(function () {
  'use strict';
  const S = (window.RFShell = window.RFShell || {});
  const listeners = {};

  S.api = null;
  S.state = { screen: 'boot', mode: null, paused: false, padSwap: false };
  S.on = (n, f) => { (listeners[n] = listeners[n] || []).push(f); };
  S.emit = (n, ...a) => {
    for (const f of listeners[n] || []) {
      try { f(...a); } catch (e) { console.error('[shell]', e); }
    }
  };

  /* ---------- small helpers ---------- */
  S.load = (k, d) => {
    try { const v = localStorage.getItem('rfs_' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; }
  };
  S.save = (k, v) => { try { localStorage.setItem('rfs_' + k, JSON.stringify(v)); } catch (_) {} };
  S.$ = (sel, root) => (root || document).querySelector(sel);
  S.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  S.esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  S.settingsOpen = () => { const p = document.getElementById('setp'); return !!p && !p.classList.contains('hidden'); };
  S.sfx = (n) => { try { if (S.audio) S.audio.playSfx(n); } catch (_) {} };
  S.unlockAudio = () => { try { if (S.audio) S.audio.unlockAudio(); } catch (_) {} };
  S.openSettings = () => { const b = document.getElementById('settingsBtn'); if (b && !S.settingsOpen()) b.click(); };
  S.fighters = () => (S.api ? [S.api.p1, S.api.p2] : []);

  /* ---------- hook used by js/game.js ---------- */
  let handle = null;
  window.RFShellHook = {
    onReady(h) { handle = h; tryReady(); },
    paused() { return S.state.paused; },
    input(side) { return S.inputFor ? S.inputFor(side) : null; },
  };
  const modUrl = (p) => new URL(p, document.baseURI).href;
  Promise.all([import(modUrl('js/api.js')), import(modUrl('js/audio.js'))]).then(([fight, audio]) => {
    S.fight = fight;
    S.audio = audio;
    tryReady();
  }).catch((e) => console.error('[shell] could not load the fight API', e));
  function tryReady() {
    if (S.api || !handle || !S.fight) return;
    const st = S.fight.getFightState();
    if (!st || !st.ready) { setTimeout(tryReady, 50); return; }
    S.api = handle;
    S.emit('ready');
  }

  /* ---------- keyboard ---------- */
  const down = new Set();
  S.keyDown = (code) => down.has(code);
  const NAV = {
    ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
    Enter: 'ok', NumpadEnter: 'ok', Space: 'ok', Escape: 'back', Backspace: 'back',
  };
  const VERSUS_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'Quote', 'Period']);

  window.addEventListener('keydown', (e) => {
    down.add(e.code);
    if (S.settingsOpen()) return; // the settings sheet owns keys while open
    if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (S.menuActive && S.menuActive()) {
      S.unlockAudio();
      // Menus own every key: the game never sees them (no stray restarts or settings toggles).
      e.stopImmediatePropagation();
      const act = NAV[e.code];
      if (!act) return;
      e.preventDefault();
      if (!e.repeat || act !== 'back') S.nav(act);
      return;
    }
    if (S.state.screen === 'fight' && S.fightKey) {
      if (S.fightKey(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      // Between rounds the shell runs the flow; keep game-level restart keys out of it.
      if (S.match && S.match.phase !== 'fight' && /^(Enter|NumpadEnter|Space|KeyR)$/.test(e.code)) {
        e.preventDefault(); e.stopImmediatePropagation(); return;
      }
      if (S.state.mode === 'versus' && VERSUS_KEYS.has(e.code)) e.preventDefault();
    }
  }, true);
  window.addEventListener('keyup', (e) => down.delete(e.code), true);
  window.addEventListener('blur', () => down.clear());

  /* ---------- gamepads ---------- */
  S.pads = () => {
    const list = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    return list.filter((p) => p.connected !== false).sort((a, b) => a.index - b.index);
  };
  S.readPad = (gp) => {
    const inp = { sidestep: 0, inout: 0, punch: false, kick: false, block: false };
    if (!gp) return inp;
    const b = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed);
    const dead = 0.28;
    if (Math.abs(gp.axes[0] || 0) > dead) inp.sidestep += gp.axes[0];
    if (Math.abs(gp.axes[1] || 0) > dead) inp.inout -= gp.axes[1];
    if (b(14)) inp.sidestep -= 1;
    if (b(15)) inp.sidestep += 1;
    if (b(12)) inp.inout += 1;
    if (b(13)) inp.inout -= 1;
    inp.punch = b(0);
    inp.kick = b(1);
    inp.block = b(2) || b(4) || b(5) || b(7);
    return inp;
  };
  const padPrev = new Map();
  const rep = { dir: null, t: 0 };
  function pollPads(dt) {
    const pads = S.pads();
    let dir = null;
    for (const gp of pads) {
      const prev = padPrev.get(gp.index) || [];
      const now = gp.buttons.map((x) => !!(x && x.pressed));
      const edge = (i) => now[i] && !prev[i];
      if (S.menuActive && S.menuActive() && !S.settingsOpen()) {
        if (edge(0) || edge(9)) S.nav('ok');
        else if (edge(1) || edge(8)) S.nav('back');
      } else if (S.state.screen === 'fight' && edge(9) && !S.settingsOpen() && S.togglePause) {
        S.togglePause();
      }
      const ax = gp.axes[0] || 0;
      const ay = gp.axes[1] || 0;
      if (now[12] || ay < -0.6) dir = 'up';
      else if (now[13] || ay > 0.6) dir = 'down';
      else if (now[14] || ax < -0.6) dir = 'left';
      else if (now[15] || ax > 0.6) dir = 'right';
      padPrev.set(gp.index, now);
    }
    if (!(S.menuActive && S.menuActive()) || S.settingsOpen()) { rep.dir = dir; rep.t = 0.5; return; }
    if (dir && dir !== rep.dir) { S.nav(dir); rep.t = 0.42; }
    else if (dir) { rep.t -= dt; if (rep.t <= 0) { S.nav(dir); rep.t = 0.13; } }
    rep.dir = dir;
  }
  window.addEventListener('gamepadconnected', (e) => {
    S.toast('Gamepad connected' + (e.gamepad && e.gamepad.id ? ' — ' + e.gamepad.id.split('(')[0].trim() : ''));
    S.emit('pads');
  });
  window.addEventListener('gamepaddisconnected', () => {
    S.toast('Gamepad disconnected');
    S.emit('pads');
    S.emit('paddrop');
  });

  /* ---------- toast ---------- */
  let toastT = null;
  S.toast = (msg) => {
    let el = document.getElementById('rfsToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'rfsToast';
      el.className = 'rfs-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => el.classList.remove('on'), 2600);
  };

  /* ---------- shell clock + loop (runs before the game tick each frame) ---------- */
  S.time = 0;
  const timers = [];
  S.after = (sec, fn) => { const t = { at: S.time + sec, fn }; timers.push(t); return t; };
  S.clearTimers = () => { timers.length = 0; };
  S.frozen = () => S.state.paused || S.settingsOpen() || document.hidden;
  let last = performance.now();
  function frame(now) {
    const raw = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      pollPads(raw);
      const dt = S.frozen() ? 0 : raw;
      S.time += dt;
      for (let i = timers.length - 1; i >= 0; i--) {
        if (timers[i].at <= S.time) { const t = timers.splice(i, 1)[0]; t.fn(); }
      }
      if (S.api) S.emit('frame', dt, raw);
    } catch (e) { console.error('[shell]', e); }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
