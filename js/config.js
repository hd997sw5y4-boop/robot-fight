// Fighter model + animation map. Swap `url` and `animations` later for a
// Mixamo-rigged Sketchfab "Robot character" (assetfactory, Free Standard).
export const MODEL = {
  url: './models/RobotExpressive.glb',
  source: 'RobotExpressive by Tomás Laulhé, CC0 1.0 (three.js examples)',
  // Fitted to ~1.85 units tall on load; this is a fallback scale.
  scale: 1,
  targetHeight: 2.45,
  footOffset: 0,
  animations: {
    idle: 'Idle',
    walk: 'Walking',
    run: 'Running',
    punch: 'Punch',
    kick: 'Jump', // stand-in until a Mixamo kick is available
    hit: 'No',
    ko: 'Death',
  },
  colors: {
    p1: 0x2f74ff,
    p2: 0xe23b3b,
  },
};

export const ARENA = {
  // Distance from center to a flat side of the cage (world units).
  apothem: 6.1,
  floorY: 0,
  floorThickness: 0.28,
};

export const COMBAT = {
  maxHealth: 100,
  moveSpeed: 3.4,
  blockMoveSpeed: 1.4,
  punch: { damage: 10, range: 1.35, cooldown: 0.55, active: [0.22, 0.48] },
  kick: { damage: 15, range: 1.6, cooldown: 0.75, active: [0.28, 0.55] },
  blockReduction: 0.82,
  hitStun: 0.42,
  hitInvuln: 0.28,
  knockback: 1.6,
  separate: 0.85,
};

export const GFX_PRESETS = {
  low: { pixelCap: 1, shadows: false, shadowSize: 512, exposure: 1.05 },
  high: { pixelCap: 2, shadows: true, shadowSize: 2048, exposure: 1.15 },
};
