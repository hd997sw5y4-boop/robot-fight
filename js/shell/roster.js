/* Robot Fight shell: paint presets, CPU roster (original names), AI personalities, versus input. */
(function () {
  'use strict';
  const S = window.RFShell;

  S.PRESETS = [
    { id: 'cobalt', name: 'Cobalt', primary: '#2f74ff', accent: '#dfe6ff' },
    { id: 'crimson', name: 'Crimson', primary: '#e23b3b', accent: '#2a2d36' },
    { id: 'graphite', name: 'Graphite', primary: '#4a505c', accent: '#9aabff' },
    { id: 'mint', name: 'Mint', primary: '#3fd6a6', accent: '#1d2b3a' },
    { id: 'violet', name: 'Violet', primary: '#8b5cf6', accent: '#e9e3ff' },
    { id: 'ember', name: 'Ember', primary: '#ff7a2f', accent: '#262a33' },
    { id: 'arctic', name: 'Arctic', primary: '#dde8f5', accent: '#3d8bff' },
    { id: 'rose', name: 'Rose', primary: '#ff6fa8', accent: '#3a2340' },
  ];
  S.SWATCHES = ['#2f74ff', '#22c3e6', '#3fd6a6', '#7bd04a', '#8b5cf6', '#ff6fa8',
    '#e23b3b', '#ff7a2f', '#b08a6a', '#dde8f5', '#4a505c', '#1b1e26'];

  /* Six CPU opponents, easiest first. `prof` feeds the game's own AI knobs (think window,
     reaction-block chance, punch/kick/special/block mix) via api.js fighter config. */
  S.ROSTER = [
    { id: 'sprocket', name: 'Sprocket', title: 'The Rookie', style: 'Balanced', primary: '#22c3e6', accent: '#dde8f5',
      blurb: 'Fresh off the line. Swings wide and learns slowly.',
      prof: { think: [0.5, 0.7], react: 0.14, punch: 0.36, kick: 0.12, special: 0.04, block: 0.12 } },
    { id: 'hexwren', name: 'Hex Wren', title: 'The Ghost Step', style: 'Evasive', primary: '#3fd6a6', accent: '#3a2340',
      blurb: 'Circles, slips, and pokes when you overreach.',
      prof: { think: [0.34, 0.45], react: 0.32, punch: 0.34, kick: 0.2, special: 0.1, block: 0.1 } },
    { id: 'bulwark', name: 'Bulwark-9', title: 'The Wall', style: 'Tank', primary: '#5d6b4a', accent: '#b08a6a',
      blurb: 'Walks forward behind a raised guard and hits heavy.',
      prof: { think: [0.3, 0.38], react: 0.5, punch: 0.28, kick: 0.32, special: 0.22, block: 0.32 } },
    { id: 'voltfang', name: 'Volt Fang', title: 'The Rusher', style: 'Aggressive', primary: '#ff7a2f', accent: '#1b1e26',
      blurb: 'Never backs up. Throws hands until something breaks.',
      prof: { think: [0.16, 0.2], react: 0.2, punch: 0.62, kick: 0.26, special: 0.26, block: 0.04 } },
    { id: 'mirrorjack', name: 'Mirrorjack', title: 'The Counter', style: 'Counter-puncher', primary: '#dde8f5', accent: '#8b5cf6',
      blurb: 'Waits for your swing, blocks it, and answers instantly.',
      prof: { think: [0.13, 0.16], react: 0.74, punch: 0.36, kick: 0.2, special: 0.3, block: 0.2 } },
    { id: 'overseer', name: 'Overseer Prime', title: 'Final Boss', style: 'Boss', primary: '#1b1e26', accent: '#e23b3b',
      blurb: 'Reads everything. Goes berserk when its armor cracks.',
      prof: { think: [0.08, 0.12], react: 0.7, punch: 0.56, kick: 0.3, special: 0.45, block: 0.2 } },
  ];
  S.opponent = (id) => S.ROSTER.find((o) => o.id === id) || S.ROSTER[0];

  /* ---------- paint ---------- */
  // The API's setFighterConfig({ color }) tints the whole robot; on top of that the shell paints
  // primary on torso + arms and accent on head + legs, plus the accent on the visor glow.
  const ACCENT_PARTS = new Set(['head', 'legL', 'legR']);
  S.hex = (c) => parseInt(String(c).replace('#', ''), 16);
  S.paint = (f, primary, accent) => {
    if (!f || !f.model || !S.api) return;
    const THREE = S.api.THREE;
    const pri = new THREE.Color(primary);
    const acc = new THREE.Color(accent || primary);
    if (!f.__rfsPartOf) {
      const map = new Map();
      for (const [id, part] of Object.entries(f.parts || {})) {
        for (const m of [].concat(part.meshes || [], part.skinned || [])) if (!map.has(m)) map.set(m, id);
      }
      f.__rfsPartOf = map;
    }
    f.model.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name === 'rfVisor') {
        if (o.material && o.material.color) { o.material.color.copy(acc); if (o.material.emissive) o.material.emissive.copy(acc); }
        return;
      }
      const col = ACCENT_PARTS.has(f.__rfsPartOf.get(o)) ? acc : pri;
      for (const m of [].concat(o.material)) {
        if (!m || !m.color) continue;
        if (!m.userData.baseColor) m.userData.baseColor = new THREE.Color(1, 1, 1);
        m.color.copy(m.userData.baseColor).lerp(col, 0.78);
      }
    });
  };

  /* ---------- AI personality (fed to the game AI through api.js fighter config `ai`) ---------- */
  const DIFF = { easy: { think: 1.45, react: 0.6, atk: 0.8 }, normal: { think: 1, react: 1, atk: 1 }, hard: { think: 0.72, react: 1.18, atk: 1.1 } };
  const AGGR = { Balanced: 0.8, Evasive: 0.7, Tank: 0.9, Aggressive: 1.45, 'Counter-puncher': 0.85, Boss: 1.3 };
  S.aiFor = (opp, mode) => {
    const p = opp.prof;
    const cpu = (S.api && S.fight && S.cpuSetting && S.cpuSetting()) || 'normal';
    const d = mode === 'fight' ? (DIFF[cpu] || DIFF.normal) : DIFF.normal;
    return {
      personality: opp.id,
      think: [p.think[0] * d.think, p.think[1] * d.think],
      react: Math.min(0.88, p.react * d.react),
      punch: Math.min(0.75, p.punch * d.atk),
      kick: p.kick * d.atk,
      special: p.special,
      block: p.block,
      aggression: AGGR[opp.style] || 1,
    };
  };
  // CPU difficulty from the Settings sheet (read from its saved value; settings.js is not touched).
  S.cpuSetting = () => {
    const sel = document.getElementById('setCpu');
    return (sel && sel.value) || 'normal';
  };

  /* ---------- input: versus + training dummy ---------- */
  const P1K = { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], punch: ['KeyF'], kick: ['KeyG'], block: ['KeyH'], run: ['ShiftLeft'] };
  const P2K = { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'],
    punch: ['Period', 'Numpad1'], kick: ['Slash', 'Numpad2'], block: ['ShiftRight', 'Quote', 'Numpad3'], run: ['ControlRight', 'Numpad0'] };
  S.KEYMAP = { p1: P1K, p2: P2K };
  const anyDown = (codes) => codes.some(S.keyDown);
  function readSide(map, pad) {
    const inp = S.readPad(pad);
    if (anyDown(map.l)) inp.sidestep -= 1;
    if (anyDown(map.r)) inp.sidestep += 1;
    if (anyDown(map.u)) inp.inout += 1;
    if (anyDown(map.d)) inp.inout -= 1;
    inp.punch = inp.punch || anyDown(map.punch);
    inp.kick = inp.kick || anyDown(map.kick);
    inp.block = inp.block || anyDown(map.block);
    inp.run = inp.run || anyDown(map.run || []);
    inp.sidestep = Math.max(-1, Math.min(1, inp.sidestep));
    inp.inout = Math.max(-1, Math.min(1, inp.inout));
    return inp;
  }
  S.padFor = (side) => {
    const pads = S.pads();
    let i = side === 'p1' ? 0 : 1;
    if (S.state.padSwap) i = 1 - i;
    return pads[i] || null;
  };
  const p2Held = { punch: false, kick: false };
  const idle = () => ({ sidestep: 0, inout: 0, punch: false, kick: false, block: false });
  S.inputFor = (side) => {
    const m = S.match && S.match.cfg;
    if (!m) return idle(); // menus: both robots stand still
    if (S.match.phase !== 'fight') return idle(); // round over (decision) or between rounds
    if (m.mode === 'versus') {
      const map = side === 'p1' ? P1K : P2K;
      const inp = readSide(map, S.padFor(side));
      if (side === 'p1') return inp; // the game edge-detects P1 attacks itself
      const out = { ...inp, punch: inp.punch && !p2Held.punch, kick: inp.kick && !p2Held.kick };
      p2Held.punch = inp.punch;
      p2Held.kick = inp.kick;
      return out;
    }
    if (m.mode === 'watch') return null; // both robots run on the CPU brain
    if (m.mode === 'training' && side === 'p2') {
      return Object.assign(idle(), { block: !!S.match.dummyBlock });
    }
    return null;
  };
})();
