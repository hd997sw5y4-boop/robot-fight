'use strict';
/* Public fight hooks for the menu / arcade shell (js/shell/*).
   Import this module instead of reaching into game internals.
   The game remains playable on its own if the shell is absent. */

export const AI_PERSONALITIES = {
  easy:       { personality: 'easy',       think: [0.45, 0.85], react: 0.18, punch: 0.32, kick: 0.14, special: 0.05, block: 0.18, aggression: 0.65, dodge: 0.04 },
  normal:     { personality: 'normal',     think: [0.22, 0.25], react: 0.4,  punch: 0.5,  kick: 0.25, special: 0.22, block: 0.13, aggression: 1, dodge: 0.12 },
  hard:       { personality: 'hard',       think: [0.06, 0.10], react: 0.78, punch: 0.65, kick: 0.34, special: 0.45, block: 0.34, aggression: 1.55, dodge: 0.32, recoverMul: 0.6, ground: 0.7 },
  aggressive: { personality: 'aggressive', think: [0.12, 0.2],  react: 0.4,  punch: 0.62, kick: 0.3,  special: 0.4,  block: 0.08, aggression: 1.4, dodge: 0.08 },
  defensive:  { personality: 'defensive',  think: [0.2, 0.32],  react: 0.7,  punch: 0.32, kick: 0.16, special: 0.1,  block: 0.32, aggression: 0.7, dodge: 0.3 },
};

export function defaultFighterConfig(side) {
  const isP1 = side === 'p1';
  return {
    id: side,
    name: isP1 ? 'BLUE' : 'RED',
    color: isP1 ? 0x2a6bff : 0xd31f1f,
    control: isP1 ? 'player' : 'cpu',
    // useSettings: fight uses the Settings CPU difficulty (outside the shell, and any
    // shell start that does not pass its own `ai` table).
    ai: { useSettings: true },
  };
}

let runtime = null;
let endListeners = [];

export function registerFightRuntime(rt) {
  runtime = rt;
}

export function startFight(opts = {}) {
  if (!runtime || !runtime.startFight) throw new Error('Fight runtime is not ready');
  return runtime.startFight(opts);
}

export function endFight(reason) {
  if (!runtime || !runtime.endFight) return;
  return runtime.endFight(reason);
}

export function getFightState() {
  return runtime && runtime.getState ? runtime.getState() : null;
}

// Push both CPU brains into an exchange (CPU vs CPU stall guard).
export function nudgeFighters() {
  if (runtime && runtime.nudge) runtime.nudge();
}

export function setFighterConfig(id, cfg) {
  if (!runtime || !runtime.setFighterConfig) return null;
  return runtime.setFighterConfig(id, cfg);
}

export function onFightEnd(fn) {
  if (typeof fn !== 'function') return () => {};
  endListeners.push(fn);
  return () => { endListeners = endListeners.filter((x) => x !== fn); };
}

export function notifyFightEnd(result) {
  for (const fn of endListeners) {
    try { fn(result); } catch (_) {}
  }
}
