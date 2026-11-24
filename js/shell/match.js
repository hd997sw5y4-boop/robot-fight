/* Robot Fight shell: best-of-N rounds (Settings > Match, default 3), round timer, CPU vs CPU auto rounds (no clock), intros, KO / TKO / decision, stats, training.
   Each round is started with the public api.js startFight(); the shell owns the round clock
   (roundTime: 0 turns the game's own timer off) and the between-round flow. */
(function () {
  'use strict';
  const S = window.RFShell;
  // Best-of-N from Settings (1 / 3 / 5, default 3). Drawn rounds can push past best-of.
  S.bestOf = (fresh) => {
    if (!fresh && M.cfg && (M.cfg.bestOf === 1 || M.cfg.bestOf === 3 || M.cfg.bestOf === 5)) return M.cfg.bestOf;
    const sel = document.getElementById('setMatch');
    const v = sel ? +sel.value : 0;
    if (v === 1 || v === 3 || v === 5) return v;
    try {
      const s = localStorage.getItem('rf_match');
      if (s === '1' || s === '3' || s === '5') return +s;
    } catch (_) {}
    return 3;
  };
  const winsNeeded = () => Math.ceil(S.bestOf() / 2);
  const maxRounds = () => S.bestOf() + 2;

  const M = (S.match = { cfg: null, phase: 'idle', round: 0, wins: [0, 0], rounds: [], t: 0,
    timeLeft: null, stats: null, total: null, lastHp: [0, 0], dummyBlock: false, train: null });

  const STAT_KEYS = ['hits', 'damage', 'parts', 'blocked', 'thrown', 'kd'];
  const blankStats = () => [0, 1].map(() => ({ hits: 0, damage: 0, parts: 0, blocked: 0, thrown: 0, kd: 0 }));
  // Read-only presentation counters: attacks started and knockdowns are read off each fighter's
  // existing state (punch / kick / ground, down) once per frame. Nothing in the fight is changed.
  const ATTACK_STATES = new Set(['punch', 'kick', 'ground']);
  let prevSt = [null, null];
  let prevT = [0, 0];
  const partsDown = (f) => Object.values((f && f.parts) || {}).filter((p) => p && (p.detached || p.hp <= 0)).length;

  /* ---------- HUD bits injected next to the existing health bars ---------- */
  let hudReady = false;
  function ensureHud() {
    if (hudReady) return;
    hudReady = true;
    S.$$('#top .fighter-hud').forEach((hud, i) => {
      const pips = document.createElement('div');
      pips.className = 'rfs-pips';
      pips.id = 'rfsPips' + (i + 1);
      pips.setAttribute('aria-label', 'Rounds won');
      pips.innerHTML = '<i></i><i></i>';
      hud.appendChild(pips);
    });
    const wrap = S.$('#top .title-wrap');
    if (wrap) {
      const t = document.createElement('div');
      t.id = 'rfsTimer';
      t.className = 'rfs-timer';
      wrap.appendChild(t);
    }
    const call = document.createElement('div');
    call.id = 'rfsCall';
    call.className = 'rfs-call';
    call.setAttribute('aria-live', 'assertive');
    call.innerHTML = '<b></b><span></span>';
    document.body.appendChild(call);
  }

  S.call = (big, small, cls, hold) => {
    const el = document.getElementById('rfsCall');
    if (!el) return;
    el.querySelector('b').textContent = big || '';
    el.querySelector('span').textContent = small || '';
    el.className = 'rfs-call ' + (cls || '');
    void el.offsetWidth; // restart the animation
    el.classList.add('on');
    const token = (S.call._n = (S.call._n || 0) + 1);
    if (hold) S.after(hold, () => { if (S.call._n === token) el.classList.remove('on'); }); // shell clock: freezes while paused
  };
  S.clearCall = () => { const el = document.getElementById('rfsCall'); if (el) el.classList.remove('on'); };

  function paintHud() {
    const need = winsNeeded();
    const show = S.bestOf() > 1;
    for (let i = 0; i < 2; i++) {
      const el = document.getElementById('rfsPips' + (i + 1));
      if (!el) continue;
      el.style.display = show ? '' : 'none';
      if (el.children.length !== need) el.innerHTML = '<i></i>'.repeat(need);
      S.$$('i', el).forEach((pip, k) => pip.classList.toggle('won', M.wins[i] > k));
    }
    const t = document.getElementById('rfsTimer');
    if (t) {
      t.style.display = M.cfg && M.cfg.auto ? 'none' : ''; // CPU vs CPU: no clock shown
      if (M.timeLeft == null) { t.textContent = '∞'; t.classList.remove('low'); }
      else {
        const s = Math.max(0, Math.ceil(M.timeLeft));
        t.textContent = String(s);
        t.classList.toggle('low', s <= 10);
      }
    }
  }

  function paintBars() {
    const bars = S.$$('#top .bar > i');
    if (!M.cfg) { bars.forEach((b) => { b.style.background = ''; }); return; }
    if (bars[0]) bars[0].style.background = `linear-gradient(90deg, ${M.cfg.p1.paint.primary}, ${M.cfg.p1.paint.accent})`;
    if (bars[1]) bars[1].style.background = `linear-gradient(90deg, ${M.cfg.p2.paint.accent}, ${M.cfg.p2.paint.primary})`;
  }

  /* ---------- talking to the fight through api.js ---------- */
  function fighterCfg(p, side, cpuAi) {
    const cfg = {
      name: p.name || p.label,
      color: S.hex(p.paint.primary),
      control: cpuAi ? 'cpu' : (side === 'p1' || M.cfg.mode === 'versus' ? 'player' : 'cpu'),
    };
    if (p.profile) cfg.profile = p.profile;
    if (p.skin) cfg.skin = p.skin;
    if (cpuAi) cfg.ai = cpuAi;
    if (p.apiBrain) {
      const a = { provider: p.apiBrain.provider, base: p.apiBrain.base, model: p.apiBrain.model, entrantId: p.apiBrain.entrantId };
      cfg.apiBrain = a;
    }
    return cfg;
  }
  function launch(opts) {
    const st = S.fight.startFight(opts);
    const [a, b] = S.fighters();
    if (M.cfg) {
      S.paint(a, M.cfg.p1.paint.primary, M.cfg.p1.paint.accent);
      S.paint(b, M.cfg.p2.paint.primary, M.cfg.p2.paint.accent);
    }
    return st;
  }
  // Menu backdrop: the empty cage with a slow orbit. Robots spawn only when a fight starts.
  S.toMenuState = () => {};

  /* ---------- match flow ---------- */
  S.startMatch = (cfg) => {
    ensureHud();
    S.clearTimers();
    M.cfg = cfg;
    M.bestOf = cfg.bestOf || (cfg.mode === 'tournament' ? 1 : S.bestOf(true));
    if (M.cfg) M.cfg.bestOf = M.bestOf;
    M.wins = [0, 0];
    M.rounds = [];
    M.total = blankStats();
    M.dummyBlock = !!cfg.dummyBlock;
    M.train = { hits: 0, damage: 0, combo: 0, best: 0, lastHitT: -9 };
    S.state.mode = cfg.mode;
    S.state.paused = false;
    paintBars();
    S.showScreen('fight');
    beginRound(1);
  };

  function beginRound(n) {
    S.clearCall();
    const training = M.cfg.mode === 'training';
    const skipIntro = training || !!(M.cfg && M.cfg.skipIntro);
    const cpuAi = M.cfg.opp ? S.aiFor(M.cfg.opp, M.cfg.mode) : null;
    M.round = n;
    M.t = 0;
    M.stats = blankStats();
    prevSt = [null, null];
    prevT = [0, 0];
    M.phase = skipIntro ? 'fight' : 'intro';
    launch({
      p1: fighterCfg(M.cfg.p1, 'p1', null),
      p2: fighterCfg(M.cfg.p2, 'p2', cpuAi),
      round: n,
      roundTime: 0,
      skipIntro,
    });
    M.lastHp = S.fighters().map((f) => f.health);
    // CPU vs CPU auto rounds have no clock at all: a round lasts until a robot is knocked out.
    M.timeLeft = training || M.cfg.auto || !S.roundLength() ? null : S.roundLength();
    M.quietT = 0;
    paintHud();
    if (training) { S.paintTraining(); return; }
    const last = M.wins[0] === winsNeeded() - 1 && M.wins[1] === winsNeeded() - 1;
    // [announcer hook] matchStart plays the welcome + blue/red walkout; rematch skips that package.
    const matchStart = n === 1 && M.wins[0] === 0 && M.wins[1] === 0;
    const rematch = !!M.rematch && matchStart;
    M.rematch = false;
    const announce = () => {
      S.call(M.cfg.auto ? 'Round ' + M.cfg.autoN : last ? 'Final Round' : 'Round ' + n, M.cfg.p1.name + '  vs  ' + M.cfg.p2.name, 'round');
      if (window.RFAnnounce) window.RFAnnounce('round', { n, final: last, matchStart, rematch, delay: 0.25 });
      S.sfx('confirm');
    };
    S.emit('roundBegin', n);
    if (skipIntro) { announce(); return; }
    // [fight-presentation hook] Round 1 opens with the tale of the tape + camera intro; the round
    // call follows once it ends (or is skipped). Without the presentation layer: unchanged.
    if (n === 1 && S.tape && S.tape.start(announce)) return;
    announce();
  }

  // Round length: Settings "Round time". 0 / Off means no timer (null).
  S.roundLength = () => {
    const sel = document.getElementById('setRound');
    const r = sel ? +sel.value : 0;
    return r > 0 ? r : 0;
  };

  function endRound(winner, method) {
    if (M.phase !== 'fight') return;
    M.phase = 'round-end';
    if (winner != null) M.wins[winner] += 1;
    for (let i = 0; i < 2; i++) for (const k of STAT_KEYS) M.total[i][k] += M.stats[i][k];
    M.rounds.push({ n: M.round, winner, method, stats: M.stats });
    paintHud();
    const who = winner == null ? 'Nobody scores' : (winner === 0 ? M.cfg.p1.name : M.cfg.p2.name) + (M.cfg.auto ? ' wins' : ' takes round ' + M.round);
    const big = { KO: 'Knockout', Part: 'Part loss', TKO: 'Part loss', Decision: 'Decision', Draw: 'Draw' }[method] || method;
    const ko = method === 'KO' || method === 'Part' || method === 'TKO';
    S.call(big, who, 'end ' + (ko ? 'ko' : ''));
    // [announcer hook]
    const ev = ko ? 'ko' : (method === 'Decision' ? 'decision' : (method === 'Draw' ? 'draw' : 'roundEnd'));
    if (window.RFAnnounce) window.RFAnnounce(ev, { delay: ko ? 0.5 : 0.3, method, winner });
    const done = M.wins[0] >= winsNeeded() || M.wins[1] >= winsNeeded() || M.round >= maxRounds();
    S.emit('roundEnd', M.rounds[M.rounds.length - 1]);
    S.after(ko ? 3 : 2.5, () => {
      if (M.phase !== 'round-end') return;
      // CPU vs CPU: no results screen, straight into the next round with a fresh pair.
      if (M.cfg.auto) { if (S.autoNext) S.autoNext(); return; }
      if (done) return endMatch();
      // [fight-presentation hook] round break card (damage maps + round stats) before the next round.
      const next = () => { if (M.phase === 'round-end') beginRound(M.round + 1); };
      if (S.roundBreak && S.roundBreak.show(M.rounds[M.rounds.length - 1], next)) return;
      next();
    });
  }

  function endMatch() {
    M.phase = 'match-end';
    S.clearCall();
    let w = null;
    if (M.wins[0] !== M.wins[1]) w = M.wins[0] > M.wins[1] ? 0 : 1;
    else if (Math.abs(M.total[0].damage - M.total[1].damage) >= 1) w = M.total[0].damage > M.total[1].damage ? 0 : 1;
    M.winner = w;
    // [announcer hook] waits if a KO line is still on the channel.
    if (window.RFAnnounce) window.RFAnnounce('winner', { side: w, delay: 0.55 });
    S.emit('matchEnd', w);
  }

  // Time-out: more health left wins; if level, more damage dealt this round; else a drawn round.
  function decide() {
    const [a, b] = S.fighters();
    if (Math.abs(a.health - b.health) > 0.5) return endRound(a.health > b.health ? 0 : 1, 'Decision');
    const da = M.stats[0].damage;
    const db = M.stats[1].damage;
    if (Math.abs(da - db) >= 1) return endRound(da > db ? 0 : 1, 'Decision');
    endRound(null, 'Draw');
  }

  /* ---------- per-frame ---------- */
  function trackStats() {
    const fs = S.fighters();
    for (let i = 0; i < 2; i++) {
      const f = fs[i];
      const st = f.state;
      if (ATTACK_STATES.has(st) && (st !== prevSt[i] || (f.stateT || 0) < prevT[i])) M.stats[i].thrown += 1;
      if (st === 'down' && prevSt[i] !== 'down') { M.stats[1 - i].kd += 1; S.emit('knockdown', i); }
      prevSt[i] = st;
      prevT[i] = f.stateT || 0;
      const drop = M.lastHp[i] - f.health;
      if (drop > 0.01) {
        const by = 1 - i;
        M.stats[by].damage += drop;
        const blocked = f.blocking && f.health > 0;
        if (blocked) M.stats[i].blocked += 1;
        else M.stats[by].hits += 1;
        S.emit('hit', by, drop, blocked);
        if (M.cfg.mode === 'training' && i === 1) {
          const tr = M.train;
          tr.hits += 1;
          tr.damage += drop;
          tr.combo = S.time - tr.lastHitT < 1.1 ? tr.combo + 1 : 1;
          tr.best = Math.max(tr.best, tr.combo);
          tr.lastHitT = S.time;
          S.paintTraining();
        }
      }
      if (drop > 0.01) M.quietT = 0;
      M.lastHp[i] = f.health;
      M.stats[1 - i].parts = partsDown(f);
    }
  }

  S.on('frame', (dt) => {
    if (!M.cfg || M.phase === 'idle' || M.phase === 'match-end') return;
    const st = S.fight.getFightState();
    if (!st || !st.ready) return;
    if (M.phase === 'intro') {
      if (st.phase === 'fight') { M.phase = 'fight'; S.call('Spark up', '', 'fight', 0.9); }
      return;
    }
    if (M.phase !== 'fight') return;
    trackStats();
    if (M.cfg.mode === 'training') {
      if (st.over) {
        M.phase = 'round-end';
        S.call('K.O.', 'Dummy resets…', 'end ko', 1.3);
        S.after(1.8, () => { if (M.phase === 'round-end') beginRound(1); });
      }
      return;
    }
    if (st.over) {
      if (st.winner !== 'p1' && st.winner !== 'p2') return endRound(null, 'Draw');
      const loser = st.winner === 'p1' ? 1 : 0;
      const f = S.fighters()[loser];
      const p = (f && f.parts) || {};
      const gone = (id) => p[id] && p[id].detached;
      const partLoss = gone('head') || gone('legL') || gone('legR');
      endRound(1 - loser, partLoss ? 'Part' : 'KO');
      return;
    }
    // CPU vs CPU stall guard (no clock): after 10 s without damage, send both CPUs in.
    if (M.cfg.auto && st.phase === 'fight') {
      M.quietT = (M.quietT || 0) + dt;
      if (M.quietT > 10) { M.quietT = 5; if (S.fight.nudgeFighters) S.fight.nudgeFighters(); }
    }
    if (M.timeLeft != null && st.phase === 'fight') {
      const prev = M.timeLeft;
      M.timeLeft -= dt;
      if (prev > 10 && M.timeLeft <= 10 && window.RFAnnounce) window.RFAnnounce('last10'); // [announcer hook]
      if (M.timeLeft <= 0) { M.timeLeft = 0; paintHud(); decide(); return; }
      paintHud();
    }
  });

  /* ---------- training helpers ---------- */
  S.trainingReset = () => {
    if (!M.cfg || M.cfg.mode !== 'training') return;
    Object.assign(M.train, { hits: 0, damage: 0, combo: 0, best: 0 });
    beginRound(1);
    S.toast('Dummy and damage reset');
  };
  S.toggleDummyBlock = () => {
    M.dummyBlock = !M.dummyBlock;
    S.paintTraining();
    S.toast(M.dummyBlock ? 'Dummy: blocking' : 'Dummy: idle');
  };

  S.restartMatch = () => { if (M.cfg) { M.rematch = true; S.startMatch(M.cfg); } };
  S.abortMatch = (paintA, paintB) => {
    S.clearTimers();
    S.clearCall();
    M.phase = 'idle';
    M.cfg = null;
    M.timeLeft = null;
    S.state.paused = false;
    S.state.mode = null;
    paintBars();
    paintHud();
    S.toMenuState(paintA, paintB);
  };
})();
