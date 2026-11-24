'use strict';
/* Excited announcer (Voice D / Kokoro Apache-2.0, original lines).
   Catalog lives in sounds/announcer/manifest.json. Clips are dry; js/audio.js
   adds the PA band and a light send into the arena reverb. One voice channel,
   no immediate repeats, crowd ducking via the audio bus. */
import { playVoiceClip, stopVoice, voiceClipDuration, isVoiceBusy, unlockAudio, registerSoundFiles } from './audio.js';

const MANIFEST_URL = './sounds/announcer/manifest.json?v=excited-d-2';

const RANK = {
  ko: 1, decision: 1, draw: 1, winner: 1, winnerBlue: 1, winnerRed: 1, rematch: 1,
  intro: 2, introBlue: 2, introRed: 2, fight: 2,
  round: 2, round1: 2, round2: 2, round3: 2, round4: 2, round5: 2, roundFinal: 2,
  roundEnd: 3, last10: 3,
  knockdown: 4, headOff: 4,
  tear: 5,
  getup: 6,
  lowHp: 7,
  jumpKick: 8, dodge: 8, combo: 8,
  bigHit: 9,
};

const CUT_RANK = 3; // ranks 1-3 may cut a lower line
const GAP_HIGH = 300;   // ms after a line before another rank 1-3
const GAP_LOW = 1600;   // ms after a line before a rank 4-9
const STALE_LOW = 1000;
const STALE_HEAVY = 1500;

let manifest = null;
let manifestWait = null;
let lastPick = new Map();
let lastEndedAt = 0;
let lastRank = 0;
let playingRank = 0;
let introHoldUntil = 0;  // performance.now()
let introHoldSecs = 1.05;
let packageQueue = [];
let queued = null; // { event, opts, at, stale }
let cooldownUntil = new Map();
let lowHpSaid = [false, false];
let last10Said = false;
let getupArmed = false; // set on knockdown, consumed on get-up
let pendingTear = null;
let matchToken = 0;

function now() { return performance.now(); }

function loadManifest() {
  if (manifest) return Promise.resolve(manifest);
  if (manifestWait) return manifestWait;
  manifestWait = fetch(MANIFEST_URL).then((r) => {
    if (!r.ok) throw new Error('announcer manifest ' + r.status);
    return r.json();
  }).then((m) => {
    manifest = m;
    const files = [];
    if (m.events) for (const list of Object.values(m.events)) for (const f of list) files.push('announcer/' + f);
    registerSoundFiles(files);
    return m;
  }).catch((err) => {
    manifestWait = null;
    console.warn('Announcer manifest failed to load', err);
    return null;
  });
  return manifestWait;
}
loadManifest();

function pool(event) {
  return (manifest && manifest.events && manifest.events[event]) || [];
}

function pick(event) {
  const list = pool(event).filter((f) => voiceClipDuration(f) > 0);
  if (!list.length) return null;
  const last = lastPick.get(event);
  const opts = (list.length > 1 && last != null) ? list.filter((x) => x !== last) : list;
  const file = opts[Math.floor(Math.random() * opts.length)];
  lastPick.set(event, file);
  return file;
}

function durationOf(file) {
  const d = voiceClipDuration(file);
  if (d > 0) return d;
  const id = String(file || '').replace(/\.mp3$/, '');
  const rec = manifest && manifest.clips && manifest.clips[id];
  return (rec && rec.duration_s) || 1.2;
}

function busy() { return isVoiceBusy() || packageQueue.length > 0; }

function clearPackage() { packageQueue = []; }

function onLineEnd() {
  lastEndedAt = now();
  playingRank = 0;
  if (packageQueue.length) {
    const next = packageQueue.shift();
    startClip(next.event, next.file, 0.12, next.rank);
    return;
  }
  if (queued) {
    const q = queued;
    queued = null;
    if (now() - q.at <= (RANK[q.event] <= 3 ? 8000 : (q.event === 'knockdown' || q.event === 'tear' || q.event === 'headOff' ? STALE_HEAVY : STALE_LOW))) {
      announce(q.event, { ...q.opts, delay: 0.08, retry: true });
    }
  }
}

function startClip(event, file, delay, rank) {
  playingRank = rank;
  const dur = playVoiceClip(file, { delay, onended: onLineEnd });
  if (!dur) {
    playingRank = 0;
    return 0;
  }
  return dur;
}

function armCooldown(event) {
  const t = now();
  if (event === 'bigHit') cooldownUntil.set('bigHit', t + 10000);
  if (event === 'tear' || event === 'headOff') cooldownUntil.set('tear', t + 8000);
  if (event === 'jumpKick' || event === 'dodge') cooldownUntil.set('flash', t + 8000);
  if (event === 'combo') cooldownUntil.set('combo', t + 8000);
  if (event === 'last10') last10Said = true;
}

function cooling(event) {
  const t = now();
  if (event === 'bigHit' && t < (cooldownUntil.get('bigHit') || 0)) return true;
  if ((event === 'tear' || event === 'headOff') && t < (cooldownUntil.get('tear') || 0)) return true;
  if ((event === 'jumpKick' || event === 'dodge') && t < (cooldownUntil.get('flash') || 0)) return true;
  if (event === 'combo' && t < (cooldownUntil.get('combo') || 0)) return true;
  if (event === 'last10' && last10Said) return true;
  return false;
}

function resolveEvent(event, opts) {
  if (event === 'round') {
    if (opts.final) return 'roundFinal';
    const n = Math.max(1, Math.min(5, opts.n || 1));
    return 'round' + n;
  }
  if (event === 'winner') {
    if (opts.side === 0) return 'winnerBlue';
    if (opts.side === 1) return 'winnerRed';
    return 'winner';
  }
  return event;
}

export function resetAnnouncerRound() {
  lowHpSaid = [false, false];
  last10Said = false;
  getupArmed = false;
  pendingTear = null;
  queued = null;
}

export function resetAnnouncerMatch() {
  resetAnnouncerRound();
  cooldownUntil = new Map();
  packageQueue = [];
  introHoldSecs = 1.05;
  introHoldUntil = 0;
  matchToken += 1;
}

export function announceIntroSeconds() {
  if (introHoldUntil && now() < introHoldUntil) return Math.max(0.2, (introHoldUntil - now()) / 1000);
  return introHoldSecs;
}

function setIntroHold(seconds) {
  introHoldSecs = Math.max(1.05, seconds);
  introHoldUntil = now() + introHoldSecs * 1000;
}

function playPackage(steps, holdPad) {
  // steps: [{ event, file, rank }]
  if (!steps.length) return 0;
  clearPackage();
  stopVoice();
  const first = steps[0];
  const rest = steps.slice(1);
  packageQueue = rest;
  const d0 = startClip(first.event, first.file, 0.05, first.rank);
  let total = d0 + 0.05;
  for (const s of rest) total += durationOf(s.file) + 0.12;
  setIntroHold(total + (holdPad || 0.25));
  return total;
}

export function announce(event, opts = {}) {
  unlockAudio();
  if (event === 'lowHp') {
    const side = opts.side === 1 ? 1 : 0;
    if (lowHpSaid[side]) return false;
  }

  const go = () => announceReady(event, opts);
  if (!manifest) {
    loadManifest().then(() => {
      if (now() - (opts._t0 || now()) < 2500 || opts.retry) go();
    });
    opts._t0 = opts._t0 || now();
    // First click of a match: clips may still be decoding.
    return false;
  }
  return go();
}

function announceReady(event, opts) {
  // Match / rematch openers build a short walkout package and set the intro hold.
  if (event === 'round' || event === 'rematch') {
    if (opts.matchStart) resetAnnouncerMatch();
    else resetAnnouncerRound();
    if (opts.rematch && opts.matchStart) {
      const file = pick('rematch');
      if (!file) return false;
      const dur = startClip('rematch', file, opts.delay || 0.2, 1);
      setIntroHold(dur + 0.3);
      armCooldown('rematch');
      return true;
    }
    if (opts.matchStart) {
      const steps = [];
      for (const ev of ['intro', 'introBlue', 'introRed']) {
        const file = pick(ev);
        if (file) steps.push({ event: ev, file, rank: 2 });
      }
      if (steps.length) {
        playPackage(steps, 0.25);
        return true;
      }
    }
    event = 'round';
  }

  const key = resolveEvent(event, opts);
  const rank = RANK[key] || 9;
  if (!pool(key).length) return false;
  if (cooling(key)) return false;

  if (key === 'lowHp') {
    const side = opts.side === 1 ? 1 : 0;
    if (lowHpSaid[side]) return false;
    lowHpSaid[side] = true;
  }
  if (key === 'getup') {
    if (!getupArmed) return false;
    getupArmed = false;
  }
  if (key === 'knockdown') getupArmed = true;

  // A knockdown / head / KO on the same blow cancels a pending tear.
  if (key === 'knockdown' || key === 'headOff' || key === 'ko') pendingTear = null;
  if (key === 'tear' && !opts._tearFired) {
    pendingTear = now();
    const wait = opts.delay != null ? opts.delay : 0.22;
    setTimeout(() => {
      if (pendingTear && now() - pendingTear >= wait * 1000 - 20) {
        pendingTear = null;
        announceReady('tear', { ...opts, delay: 0, _tearFired: true });
      }
    }, wait * 1000);
    return true;
  }
  const ev = key;
  const evRank = RANK[ev] || rank;

  const t = now();
  if (busy() || isVoiceBusy()) {
    const canCut = evRank <= CUT_RANK && evRank < (playingRank || 99);
    if (canCut) {
      clearPackage();
      stopVoice();
    } else {
      // Queue depth one: keep the higher priority, else the newer event.
      if (!queued || evRank < (RANK[queued.event] || 9) || evRank === (RANK[queued.event] || 9)) {
        queued = { event: ev, opts, at: t };
      }
      return false;
    }
  }

  // Global gap after the previous line (skipped when we just cut).
  if (lastEndedAt && t - lastEndedAt < (evRank <= 3 ? GAP_HIGH : GAP_LOW) && evRank > CUT_RANK) {
    queued = { event: ev, opts, at: t };
    return false;
  }

  const file = pick(ev);
  if (!file) return false;
  const delay = opts.delay || 0;
  const dur = startClip(ev, file, delay, evRank);
  if (!dur) {
    // Still decoding: retry once.
    if (!opts.retry) {
      setTimeout(() => announce(event, { ...opts, delay: 0, retry: true }), 180);
    }
    return false;
  }
  if (ev === 'round' || ev === 'round1' || ev === 'round2' || ev === 'round3' || ev === 'round4' || ev === 'round5' || ev === 'roundFinal') {
    setIntroHold(delay + dur + 0.15);
  }
  armCooldown(ev);
  return true;
}

export { loadManifest };

if (typeof window !== 'undefined') {
  window.RFAnnounce = announce;
  window.RFAnnounceIntroSecs = announceIntroSeconds;
  window.RFAnnounceReset = resetAnnouncerMatch;
}
