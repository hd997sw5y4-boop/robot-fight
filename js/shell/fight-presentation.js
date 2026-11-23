/* Robot Fight shell: fight presentation (UI only, no fight logic).
   - Tale of the tape + short camera intro before Round 1 (Enter / click skips). The game's own
     1.05 s intro phase is held at its start while the card is up, through the read handle's
     match object, so nothing in the fight runs early or late; the camera uses the same
     match.camLock the menu orbit already uses and is handed back to the game afterwards.
   - Round break card: each robot's damage map (live part health, green → red) + round stats.
   - Knockdown count (1–10) while a robot is in its existing 'down' state.
   - Hit / combo pop-ups from the shell's own health-drop tracking (js/shell/match.js).
   Everything reads existing state; anything a build doesn't expose is left out. */
(function () {
  'use strict';
  const S = window.RFShell;
  if (!S) return;
  const esc = S.esc;
  const PARTS = [
    ['head', 'Head'], ['torso', 'Torso'], ['armR', 'Right arm'], ['armL', 'Left arm'], ['legR', 'Right leg'], ['legL', 'Left leg'],
  ];
  // Front view (robot faces you, so its right arm is on your left).
  const SHAPES = {
    head: '<rect x="39" y="4" width="22" height="22" rx="7"/>',
    torso: '<path d="M31 31h38l-4 50H35z"/>',
    armR: '<path d="M27 32l-10 4-6 54h11l7-40z"/>',
    armL: '<path d="M73 32l10 4 6 54H78l-7-40z"/>',
    legR: '<path d="M36 85h13l-2 78H33z"/>',
    legL: '<path d="M51 85h13l3 78H53z"/>',
  };

  function mk(id, cls) {
    let el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = cls;
      document.body.appendChild(el);
    }
    return el;
  }
  const side = (i) => (i === 0 ? 'p1' : 'p2');
  const cfgOf = (i) => S.match && S.match.cfg && S.match.cfg[side(i)];
  const swatch = (p) => `<i class="fp-sw" style="--a:${esc(p.paint.primary)};--b:${esc(p.paint.accent)}"></i>`;

  /* ---------- part health (damage map) ---------- */
  function partFrac(f, id) {
    const p = f && f.parts && f.parts[id];
    if (!p || !(p.max > 0)) return null;
    if (p.detached) return 0;
    return Math.max(0, Math.min(1, p.hp / p.max));
  }
  function damageMap(f) {
    let known = 0;
    const body = PARTS.map(([id, label]) => {
      const fr = partFrac(f, id);
      if (fr == null) return `<g class="fp-pt na">${SHAPES[id]}</g>`;
      known += 1;
      const lost = f.parts[id].detached;
      const col = lost ? '#2a2e3a' : `hsl(${Math.round(fr * 120)} 78% 50%)`;
      return `<g class="fp-pt${lost ? ' lost' : ''}" style="--c:${col}"><title>${label}: ${lost ? 'lost' : Math.round(fr * 100) + '%'}</title>${SHAPES[id]}</g>`;
    }).join('');
    if (!known) return '';
    return `<svg class="fp-map" viewBox="0 0 100 168" role="img" aria-label="Damage map">${body}</svg>`;
  }

  /* ---------- tale of the tape ---------- */
  const tapeEl = mk('fpTape', 'fp-tape');
  const TAPE_SECS = 4.6;
  const tape = { on: false, t: 0, done: null, cam: null };
  function robotStats() {
    const fs = S.fighterSelect && S.fighterSelect.ROBOTS && S.fighterSelect.ROBOTS.find((r) => !r.locked);
    return (fs && fs.stats) || [];
  }
  function heightOf(f) {
    // Top of the head in the current pose (Mixamo HeadTop_End), relative to the root.
    if (!f || !f.root || !S.api || !S.api.THREE) return null;
    const v = new S.api.THREE.Vector3();
    let top = -Infinity;
    f.root.updateMatrixWorld(true);
    // Head bones only (a raised guard puts the fists above the head); all bones if the head isn't mapped.
    const headBones = f.parts && f.parts.head && f.parts.head.bones && f.parts.head.bones.length ? f.parts.head.bones : null;
    const visit = (o) => { o.getWorldPosition(v); if (v.y > top) top = v.y; };
    if (headBones) headBones.forEach(visit);
    else f.root.traverse((o) => { if (o.isBone) visit(o); });
    const h = top - f.root.position.y;
    return h > 0.5 && h < 5 ? h : null;
  }
  function renderTape() {
    const M = S.match;
    const fs = S.fighters();
    const hs = fs.map(heightOf);
    // Per-side profile numbers when the game provides them (js/shell/profiles.js); otherwise the shared tuning.
    let prof = null;
    try { prof = S.profiles && S.profiles.sideProfiles(); } catch (_) { prof = null; }
    const rows = []; // [label, [text1, text2], [num1, num2]]
    if (hs[0] != null || hs[1] != null) rows.push(['Height', hs.map((h) => (h == null ? '–' : h.toFixed(2) + ' m')), hs]);
    if (prof) {
      const keys = prof[0].stats.map((x) => x.k);
      for (const k of keys) {
        const a = prof[0].stats.find((x) => x.k === k);
        const b = prof[1].stats.find((x) => x.k === k);
        const txt = (x) => (x ? `${+(+x.v).toFixed(2)} ${x.unit}` : '–');
        rows.push([a.label, [txt(a), txt(b)], [a ? a.v : null, b ? b.v : null]]);
      }
    } else {
      for (const st of robotStats()) { const v = `${+(+st.v).toFixed(2)} ${st.unit}`; rows.push([st.label, [v, v], [st.v, st.v]]); }
    }
    // Better value per row (only a real difference; Height is information, not better/worse).
    const better = (r) => {
      const [a, b] = r[2];
      if (r[0] === 'Height' || a == null || b == null || !(Math.abs(a - b) > Math.max(Math.abs(a), Math.abs(b)) * 0.005)) return -1;
      return a > b ? 0 : 1;
    };
    const traits = (pr) => {
      if (!pr || !pr.real || (!pr.strengths.length && !pr.weaknesses.length)) return '';
      return `<div class="fp-ttraits">${pr.strengths.length ? `<p class="up"><b>Strengths</b> ${pr.strengths.map(esc).join(' · ')}</p>` : ''}${pr.weaknesses.length ? `<p class="down"><b>Weaknesses</b> ${pr.weaknesses.map(esc).join(' · ')}</p>` : ''}</div>`;
    };
    const col = (i) => {
      const c = M.cfg[side(i)];
      const pr = prof && prof[i];
      return `<div class="fp-tside ${side(i)}">
        <small>${i === 0 ? 'Blue corner' : 'Red corner'}</small>
        <b>${esc(c.name)}</b>${pr && pr.real && pr.tag ? `<em class="fp-tstyle">${esc(pr.tag)}</em>` : ''}
        <span class="fp-tcol">${swatch(c)}${esc(c.label || '')}</span>
        ${traits(pr)}
      </div>`;
    };
    const mode = { fight: 'Quick match', arcade: 'Arcade', versus: 'Versus', watch: 'Bot vs Bot' }[M.cfg.mode] || '';
    tapeEl.innerHTML = `<div class="fp-tcard" role="dialog" aria-label="Tale of the tape">
      <header><small>${esc(mode)}${M.cfg.mode === 'arcade' && M.cfg.opp ? ' · ' + esc(M.cfg.opp.name) : ''} · best of 3</small><b>Tale of the tape</b></header>
      <div class="fp-tgrid">${col(0)}<div class="fp-tvs">VS</div>${col(1)}</div>
      ${rows.length ? `<table class="fp-trows">${rows.map((r) => { const w = better(r); return `<tr><td class="${w === 0 ? 'hi' : ''}">${esc(r[1][0])}</td><th>${esc(r[0])}</th><td class="${w === 1 ? 'hi' : ''}">${esc(r[1][1])}</td></tr>`; }).join('')}</table>` : ''}
      <footer><i class="fp-tbar"><i></i></i><span><kbd>Enter</kbd> or click to skip</span></footer>
    </div>`;
  }
  // Head / upper-chest world point for a hero bust shot. Never uses a fraction of height
  // as a world Y (that framed the legs once SIZE/matTop grew past the old 1.8 m fallback).
  function aimPoint(f) {
    const THREE = S.api && S.api.THREE;
    if (!f || !f.root || !THREE) return null;
    const v = new THREE.Vector3();
    let head = null, chest = null, bboxTop = null;
    f.root.updateMatrixWorld(true);
    f.root.traverse((o) => {
      if (!o.isBone) return;
      const k = String(o.name || '');
      o.getWorldPosition(v);
      if (/HeadTop_End/i.test(k) || /(^|[:._])Head$/.test(k)) {
        if (!head || /HeadTop_End/i.test(k)) head = v.clone();
      } else if (/Spine2|Neck/i.test(k)) {
        if (!chest) chest = v.clone();
      }
    });
    try {
      const box = new THREE.Box3().setFromObject(f.model || f.root);
      if (box.max.y > box.min.y) {
        bboxTop = new THREE.Vector3(
          (box.min.x + box.max.x) * 0.5,
          box.min.y + (box.max.y - box.min.y) * 0.84,
          (box.min.z + box.max.z) * 0.5,
        );
      }
    } catch (_) { /* ignore */ }
    if (head && chest) return head.clone().lerp(chest, 0.28);
    return head || chest || bboxTop || f.root.position.clone().setY(f.root.position.y + 2.0);
  }
  function camShots() {
    const api = S.api;
    const [a, b] = S.fighters();
    if (!api || !api.camera || !api.THREE || !a || !b) return null;
    const V = api.THREE.Vector3;
    const pa = a.root.position.clone();
    const pb = b.root.position.clone();
    const mid = pa.clone().add(pb).multiplyScalar(0.5);
    const d = pb.clone().sub(pa).setY(0);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    d.normalize();
    const n = new V(-d.z, 0, d.x);
    const toCam = api.camera.position.clone().sub(mid).setY(0);
    if (toCam.dot(n) < 0) n.negate();
    const lookA = aimPoint(a);
    const lookB = aimPoint(b);
    const close = (look, toward) => ({
      from: look.clone().addScaledVector(toward, 1.15).addScaledVector(n, 2.35).setY(look.y + 0.06),
      to: look.clone().addScaledVector(toward, 0.95).addScaledVector(n, 2.6).setY(look.y + 0.04),
      look: look.clone(),
    });
    const lookWide = lookA.clone().add(lookB).multiplyScalar(0.5);
    const wide = Math.max(7.4, pa.distanceTo(pb) * 1.55);
    return [
      { t0: 0, t1: 1.7, ...close(lookA, d) },
      { t0: 1.7, t1: 3.25, ...close(lookB, d.clone().negate()) },
      { t0: 3.25, t1: TAPE_SECS,
        from: lookWide.clone().addScaledVector(n, wide * 1.08).setY(lookWide.y + 1.15),
        to: lookWide.clone().addScaledVector(n, wide).setY(lookWide.y + 0.85),
        look: lookWide.clone(),
      },
    ];
  }
  const ease = (x) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);
  function stepCam(dt) {
    const api = S.api;
    if (!tape.cam || !api || !api.match) return;
    api.match.camLock = true;
    const shot = tape.cam.find((s) => tape.t < s.t1) || tape.cam[tape.cam.length - 1];
    const k = ease((tape.t - shot.t0) / (shot.t1 - shot.t0));
    const pos = shot.from.clone().lerp(shot.to, k);
    const cam = api.camera;
    if (!tape.look) { cam.position.copy(pos); tape.look = shot.look.clone(); } // first frame: cut in
    const a = dt > 0 ? 1 - Math.pow(0.00008, dt) : 0; // ease between hero shots and into the two-shot
    cam.position.lerp(pos, a);
    tape.look.lerp(shot.look, a);
    cam.lookAt(tape.look);
    S.$$('.fp-tside', tapeEl).forEach((el, i) => el.classList.toggle('hot', shot === tape.cam[i]));
  }
  function endTape(skipped) {
    if (!tape.on) return;
    tape.on = false;
    document.body.classList.remove('fp-tape-on');
    tapeEl.classList.remove('on');
    if (S.api && S.api.match) S.api.match.camLock = false; // the game's camera takes over again
    const done = tape.done;
    tape.done = null;
    if (skipped) S.sfx('click');
    if (done) done();
  }
  S.tape = {
    start(done) {
      const M = S.match;
      if (!M || !M.cfg || M.cfg.mode === 'training' || !S.api || !S.api.match) return false;
      renderTape();
      tape.on = true;
      tape.t = 0;
      tape.look = null;
      tape.done = done;
      tape.cam = camShots();
      document.body.classList.add('fp-tape-on');
      void tapeEl.offsetWidth;
      tapeEl.classList.add('on');
      S.sfx('confirm');
      return true;
    },
    skip() { endTape(true); },
    get on() { return tape.on; },
  };
  tapeEl.addEventListener('click', () => endTape(true));

  /* ---------- round break ---------- */
  const brkEl = mk('fpBreak', 'fp-break');
  const BREAK_SECS = 5;
  const brk = { on: false, next: null, left: 0 };
  const METHOD = { KO: 'knockout', Part: 'part loss', TKO: 'part loss', Decision: 'decision', Draw: 'draw' };
  function statList(s) {
    if (!s) return '';
    const rows = [];
    if (typeof s.thrown === 'number') rows.push(['Strikes', `${s.hits} / ${s.thrown}`]);
    else rows.push(['Strikes landed', s.hits]);
    if (s.thrown > 0) rows.push(['Accuracy', Math.min(100, Math.round((s.hits / s.thrown) * 100)) + '%']);
    rows.push(['Damage dealt', Math.round(s.damage)]);
    if (typeof s.kd === 'number') rows.push(['Knockdowns', s.kd]);
    rows.push(['Parts destroyed', s.parts], ['Blocks', s.blocked]);
    return `<dl class="fp-stats">${rows.map((r) => `<div><dt>${r[0]}</dt><dd>${esc(r[1])}</dd></div>`).join('')}</dl>`;
  }
  function renderBreak(rec) {
    const M = S.match;
    const fs = S.fighters();
    const who = rec.winner == null ? 'Round ' + rec.n + ' drawn' : esc(cfgOf(rec.winner).name) + ' takes round ' + rec.n;
    const how = rec.winner == null ? '' : ' by ' + (METHOD[rec.method] || rec.method);
    const col = (i) => {
      const c = cfgOf(i);
      return `<section class="fp-bside ${side(i)}${rec.winner === i ? ' won' : ''}">
        <header>${swatch(c)}<b>${esc(c.name)}</b><span class="fp-bpips">${[0, 1].map((k) => `<i class="${M.wins[i] > k ? 'won' : ''}"></i>`).join('')}</span></header>
        <div class="fp-bbody">${damageMap(fs[i])}${statList(rec.stats && rec.stats[i])}</div>
      </section>`;
    };
    brkEl.innerHTML = `<div class="fp-bcard" role="dialog" aria-label="Round break">
      <header class="fp-bhead"><small>Round break</small><b>${who}${how}</b></header>
      <div class="fp-bgrid">${col(0)}${col(1)}</div>
      <footer><span>Round ${rec.n + 1} in <b class="fp-bleft">${BREAK_SECS}</b>s</span><span><kbd>Enter</kbd> or click to continue</span></footer>
    </div>`;
  }
  function endBreak(skipped) {
    if (!brk.on) return;
    brk.on = false;
    brkEl.classList.remove('on');
    document.body.classList.remove('fp-break-on');
    const next = brk.next;
    brk.next = null;
    if (skipped) S.sfx('click');
    if (next) next();
  }
  S.roundBreak = {
    show(rec, next) {
      const M = S.match;
      if (!M || !M.cfg || M.cfg.mode === 'training' || !rec) return false;
      S.clearCall();
      renderBreak(rec);
      brk.on = true;
      brk.next = next;
      brk.left = BREAK_SECS;
      document.body.classList.add('fp-break-on');
      void brkEl.offsetWidth;
      brkEl.classList.add('on');
      S.sfx('confirm');
      return true;
    },
    skip() { endBreak(true); },
    get on() { return brk.on; },
  };
  brkEl.addEventListener('click', () => endBreak(true));

  /* ---------- knockdown count ---------- */
  const cntEl = mk('fpCount', 'fp-count');
  cntEl.setAttribute('aria-live', 'polite');
  const down = [null, null];
  function stepCount() {
    const M = S.match;
    const fs = S.fighters();
    let show = null;
    for (let i = 0; i < 2; i++) {
      const f = fs[i];
      const isDown = M && M.cfg && M.phase === 'fight' && f && f.state === 'down';
      if (isDown) {
        if (!down[i]) down[i] = { t0: S.time, n: 0 };
        const n = Math.min(10, 1 + Math.floor(S.time - down[i].t0));
        if (n !== down[i].n) { down[i].n = n; down[i].bump = true; }
        show = i;
      } else down[i] = null;
    }
    if (show == null) { cntEl.classList.remove('on'); return; }
    const d = down[show];
    if (d.bump) {
      d.bump = false;
      const c = cfgOf(show);
      cntEl.className = 'fp-count on ' + side(show);
      cntEl.innerHTML = `<small>${esc(c ? c.name : '')} down</small><b>${d.n}</b>`;
      if (d.n > 1) S.sfx('tick');
    }
  }

  /* ---------- hit / combo pop-ups ---------- */
  const popEl = mk('fpPops', 'fp-pops');
  const combo = [{ n: 0, t: -9 }, { n: 0, t: -9 }];
  S.on('hit', (by, dmg, blocked) => {
    if (S.state.screen !== 'fight') return;
    const c = combo[by];
    let big;
    let cls = side(by);
    if (blocked) { big = 'Blocked'; cls = side(1 - by) + ' blk'; }
    else {
      c.n = S.time - c.t < 1.1 ? c.n + 1 : 1;
      c.t = S.time;
      big = c.n > 1 ? `${c.n} hit combo` : 'Hit';
      if (c.n > 1) cls += ' combo';
    }
    const el = document.createElement('div');
    el.className = 'fp-pop ' + cls;
    el.innerHTML = `<b>${esc(big)}</b>${dmg >= 0.5 ? `<span>−${Math.round(dmg)}</span>` : ''}`;
    S.$$('.fp-pop.' + cls.split(' ')[0], popEl).forEach((o) => o.remove());
    popEl.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  });

  /* ---------- per frame ---------- */
  S.on('frame', (dt) => {
    if (tape.on) {
      const api = S.api;
      // Hold the game's own pre-round intro at its start while the card is up.
      if (api && api.match && api.match.phase === 'intro') api.match.introT = 0;
      tape.t += dt;
      stepCam(dt);
      const bar = S.$('.fp-tbar > i', tapeEl);
      if (bar) bar.style.transform = `scaleX(${Math.min(1, tape.t / TAPE_SECS)})`;
      if (tape.t >= TAPE_SECS) endTape(false);
    }
    if (brk.on && dt > 0) {
      const before = Math.ceil(brk.left);
      brk.left -= dt;
      const now = Math.max(0, Math.ceil(brk.left));
      if (now !== before) { const b = S.$('.fp-bleft', brkEl); if (b) b.textContent = String(now); }
      if (brk.left <= 0) endBreak(false);
    }
    stepCount();
  });

  /* ---------- keys + cleanup ---------- */
  const baseKey = S.fightKey;
  S.fightKey = (e) => {
    if ((tape.on || brk.on) && /^(Enter|NumpadEnter|Space)$/.test(e.code) && !S.state.paused) {
      if (!e.repeat) { if (tape.on) endTape(true); else endBreak(true); }
      return true;
    }
    return baseKey ? baseKey(e) : false;
  };
  function cleanup() {
    tape.on = false; tape.done = null;
    brk.on = false; brk.next = null;
    tapeEl.classList.remove('on');
    brkEl.classList.remove('on');
    cntEl.classList.remove('on');
    popEl.innerHTML = '';
    down[0] = down[1] = null;
    combo[0].n = combo[1].n = 0;
    document.body.classList.remove('fp-tape-on', 'fp-break-on');
  }
  for (const k of ['startMatch', 'abortMatch']) {
    const base = S[k];
    if (typeof base === 'function') S[k] = (...a) => { cleanup(); return base(...a); };
  }
  S.on('roundBegin', () => { cntEl.classList.remove('on'); popEl.innerHTML = ''; combo[0].n = combo[1].n = 0; });
})();
