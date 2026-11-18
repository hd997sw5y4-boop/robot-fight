/* Robot Fight shell: per-fighter stat profiles for the UI (fighter select + tale of the tape).
   Read-only. It looks for a profile getter / table in the game's public surfaces:
     - js/config.js exports whose name contains "profile" (function(side) or a table keyed by side),
     - js/api.js exports (S.fight) and the game's read handle (S.api) with "profile" in the name.
   When one exists, each side's numbers come from it (absolute values, or multipliers on the shared
   tuning). When none exists, both sides show the current shared stats and no strengths /
   weaknesses lines: nothing here makes numbers up. */
import * as CFG from '../config.js';

const S = window.RFShell;
const { COMBAT, DAMAGE } = CFG;

// Fixed bar ceilings so the two sides compare honestly (a bigger value is always a longer bar).
export const STAT_SCALE = { power: 12, speed: 5, armor: 400, reach: 2.5, recovery: 2 };
const LABEL = { power: 'Power', speed: 'Speed', armor: 'Armor', reach: 'Reach', recovery: 'Recovery' };
const UNIT = { power: 'dmg', speed: 'm/s', armor: 'hp', reach: 'm', recovery: '×' };
const ADJ = { power: ['Hard hitter', 'Light hitter'], speed: ['Fast', 'Slow'], armor: ['Tough armor', 'Thin armor'], reach: ['Long reach', 'Short reach'], recovery: ['Quick recovery', 'Slow recovery'] };

const partHp = Object.values(DAMAGE.parts).reduce((a, p) => a + p.hp, 0);
export function baseStats() {
  return {
    power: (COMBAT.punch.damage + COMBAT.kick.damage) / 2,
    speed: COMBAT.moveSpeed,
    armor: partHp,
    reach: COMBAT.kick.reach,
  };
}

/* ---------- finding the profile source ---------- */
const SIDE_KEYS = { p1: ['p1', 'blue', 'P1', 'Blue', 'BLUE', 0], p2: ['p2', 'red', 'P2', 'Red', 'RED', 1] };
function fromSource(src, side) {
  if (!src) return null;
  if (typeof src === 'function') { try { return src(side) || null; } catch (_) { return null; } }
  if (typeof src === 'object') {
    for (const k of SIDE_KEYS[side]) if (src[k] && typeof src[k] === 'object') return src[k];
  }
  return null;
}
function candidates() {
  const out = [];
  const scan = (obj) => {
    if (!obj) return;
    let keys = [];
    try { keys = Object.keys(obj); } catch (_) { return; }
    for (const k of keys) if (/profile/i.test(k) && !/^ai/i.test(k)) { try { out.push(obj[k]); } catch (_) {} }
  };
  scan(CFG);
  if (S) { scan(S.fight); scan(S.api); }
  return out;
}
export function rawProfile(side) {
  for (const src of candidates()) {
    const p = fromSource(src, side);
    if (p && typeof p === 'object') return p;
  }
  return null;
}

/* ---------- normalizing whatever shape it has ---------- */
const ABS = { power: ['power', 'damage', 'dmg'], speed: ['speed', 'moveSpeed'], armor: ['armor', 'partHp', 'hp'], reach: ['reach'] };
const MUL = {
  power: ['powerMul', 'damageMul', 'dmgMul', 'powerScale', 'damageScale', 'powerMult', 'damageMult'],
  speed: ['speedMul', 'moveSpeedMul', 'moveMul', 'speedScale', 'speedMult'],
  armor: ['armorMul', 'hpMul', 'partHpMul', 'toughness', 'armorScale', 'hpScale', 'partHpScale', 'armorMult'],
  reach: ['reachMul', 'reachScale', 'reachMult'],
  recovery: ['recoveryMul', 'recovery', 'recoveryScale'],
  cooldown: ['cooldownMul', 'cooldownScale', 'recoverMul'],
};
const MUL_BELOW = { power: 3, speed: 2, armor: 5, reach: 1.4 };
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
function pick(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) { const v = num(obj[k]); if (v != null) return v; }
  return null;
}
const list = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean) : typeof v === 'string' && v.trim() ? v.split(/\s*[,;·]\s*/).filter(Boolean) : []);

function normalize(p) {
  const base = baseStats();
  const absObj = p.stats && typeof p.stats === 'object' ? p.stats : null;
  const mulObj = ['mul', 'mult', 'mults', 'multipliers', 'scale', 'mods', 'modifiers'].map((k) => p[k]).find((o) => o && typeof o === 'object') || null;
  const v = {};
  let changed = false;
  for (const k of Object.keys(base)) {
    let x = pick(absObj, ABS[k]);
    if (x == null) {
      const m = pick(p, MUL[k]) ?? pick(mulObj, [k, ...MUL[k], ...ABS[k]]);
      if (m != null) x = base[k] * m;
    }
    if (x == null) {
      // A bare number on the profile: read small values as multipliers of the shared tuning
      // (e.g. damage: 1.15), larger ones as absolute values in the same units.
      const raw = pick(p, ABS[k]);
      if (raw != null) x = raw < MUL_BELOW[k] ? base[k] * raw : raw;
    }
    if (x != null && Math.abs(x - base[k]) > 1e-6) changed = true;
    v[k] = x != null ? x : base[k];
  }
  // Recovery: shown only when the profile gives it (higher = recovers faster).
  let rec = pick(p, MUL.recovery) ?? pick(mulObj, ['recovery', ...MUL.recovery]);
  const cd = pick(p, MUL.cooldown) ?? pick(mulObj, ['cooldown', ...MUL.cooldown]);
  if (rec == null && cd != null && cd > 0) rec = 1 / cd;
  if (rec != null) { v.recovery = rec; changed = true; }
  const name = [p.name, p.style, p.archetype, p.label, p.title, p.tag, p.id].find((s) => typeof s === 'string' && s.trim());
  return {
    real: true,
    name: name || '',
    tag: name ? name.toUpperCase() : '',
    blurb: typeof p.blurb === 'string' ? p.blurb : typeof p.desc === 'string' ? p.desc : typeof p.description === 'string' ? p.description : '',
    v,
    changed,
    strengths: list(p.strengths || p.pros || p.strong),
    weaknesses: list(p.weaknesses || p.cons || p.weak),
  };
}

/* ---------- public: both sides at once (strengths compare one side to the other) ---------- */
export function sideProfiles() {
  const base = baseStats();
  const out = ['p1', 'p2'].map((side) => {
    const p = rawProfile(side);
    return p ? normalize(p) : { real: false, name: '', tag: '', blurb: '', v: { ...base }, changed: false, strengths: [], weaknesses: [] };
  });
  const keys = Object.keys(STAT_SCALE).filter((k) => out[0].v[k] != null || out[1].v[k] != null);
  for (let i = 0; i < 2; i++) {
    const me = out[i];
    me.stats = keys.filter((k) => me.v[k] != null).map((k) => ({ k, label: LABEL[k], v: me.v[k], unit: UNIT[k] }));
    // No text from the profile: top / bottom stats against the other fighter (only real differences).
    if (me.real && !me.strengths.length && !me.weaknesses.length) {
      const other = out[1 - i];
      const diffs = keys.filter((k) => me.v[k] != null && other.v[k] != null && other.v[k] !== 0)
        .map((k) => ({ k, d: me.v[k] / other.v[k] - 1 })).filter((x) => Math.abs(x.d) > 0.02);
      me.strengths = diffs.filter((x) => x.d > 0).sort((a, b) => b.d - a.d).slice(0, 2).map((x) => ADJ[x.k][0]);
      me.weaknesses = diffs.filter((x) => x.d < 0).sort((a, b) => a.d - b.d).slice(0, 2).map((x) => ADJ[x.k][1]);
    }
  }
  return out;
}
export const anyProfile = () => sideProfiles().some((p) => p.real);

if (S) S.profiles = { sideProfiles, STAT_SCALE, anyProfile };
