/* Robot Fight shell: UI polish helpers (no fight logic).
   - Slider fill (--pct) for the Settings sheet.
   - Hover tick (Kenney CC0 UI clip via S.sfx, so it follows the Settings volume) on shell menu buttons.
   - Skips drawing the hidden arena while a full-screen menu covers it (fighter select), and while the
     pause card is up with Settings closed. Only the draw call is skipped: the game loop, physics and
     animation still run exactly as before. The renderer instance is picked up from scene.onBeforeRender,
     so js/game.js is untouched. */
(function () {
  'use strict';
  const S = window.RFShell;
  if (!S) return;

  /* ---------- settings sliders ---------- */
  function fill(el) {
    const min = +el.min || 0;
    const max = +el.max || 1;
    el.style.setProperty('--pct', `${((+el.value - min) / (max - min || 1)) * 100}%`);
  }
  function fillAll() { document.querySelectorAll('#setp input[type=range]').forEach(fill); }
  document.addEventListener('input', (e) => { if (e.target.matches && e.target.matches('#setp input[type=range]')) fill(e.target); }, true);
  document.addEventListener('dblclick', () => requestAnimationFrame(fillAll), true);
  const setp = document.getElementById('setp');
  if (setp) new MutationObserver(() => { if (!setp.classList.contains('hidden')) requestAnimationFrame(fillAll); }).observe(setp, { attributes: true, attributeFilter: ['class'] });

  /* ---------- hover tick on shell buttons (fighter select has its own) ---------- */
  let lastTick = 0;
  let lastEl = null;
  document.addEventListener('pointerover', (e) => {
    const f = e.target.closest && e.target.closest('#rfs .rfs-f');
    if (!f || f === lastEl || f.closest('.fs')) return;
    lastEl = f;
    const now = performance.now();
    if (now - lastTick < 60) return;
    lastTick = now;
    S.sfx('tick');
  });

  /* ---------- skip drawing the covered arena ---------- */
  function covered() {
    if (document.body.classList.contains('fs-open')) return true;
    return S.state.screen === 'pause' && S.state.paused && !S.settingsOpen();
  }
  let hooked = false;
  function hookRenderer() {
    const scene = S.api && S.api.p1 && S.api.p1.root && S.api.p1.root.parent;
    if (!scene || hooked) return;
    hooked = true;
    const prev = scene.onBeforeRender;
    scene.onBeforeRender = function (renderer, ...rest) {
      scene.onBeforeRender = prev; // one-shot: just grab the renderer
      if (renderer && !renderer.__rfsSkip) {
        renderer.__rfsSkip = true;
        const draw = renderer.render;
        let lastW = 0;
        let lastH = 0;
        let lastScreen = '';
        renderer.render = function (sc, cam) {
          const el = this.domElement;
          const resized = el.width !== lastW || el.height !== lastH;
          const changed = S.state.screen !== lastScreen;
          lastScreen = S.state.screen;
          // Main-canvas scene draws only; keep the first frame after a resize or screen change.
          if (sc === scene && this.getRenderTarget() === null && covered() && !resized && !changed) return;
          lastW = el.width;
          lastH = el.height;
          return draw.call(this, sc, cam);
        };
      }
      return prev.call(this, renderer, ...rest);
    };
  }
  S.on('ready', hookRenderer);
  S.on('ready', fillAll);
})();
