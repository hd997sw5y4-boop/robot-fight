// Mixamo-rigged Sketchfab "Robot character" (assetfactory, Free Standard).
// Animations from Mixamo. Idle/walk/strafe use real clips; hips XZ root motion is stripped.
// World scale: the octagon (mat, cage, platform, physics bounds) and both robots grow together
// (10% over the original). Speeds, reach, capsules, gravity and cage height follow this.
export const WORLD_SCALE = 1.10;
// Cameras keep the original (pre-scale) standoff so the slightly larger robots fill the frame
// and the view stays inside the stadium bowl (LED barrier at ~15.6 m). Look-at height still
// follows SIZE + matTop.
export const CAM_SIZE = 1.12;
// Robot size: every robot-relative distance (reach, spacing, capsules, wires) scales by this.
export const SIZE = 1.12 * WORLD_SCALE;

export const MODEL = {
  url: './models/RobotFighter.glb',
  source: "Robot character by assetfactory (Sketchfab Free Standard); animations from Mixamo",
  scale: 1,
  targetHeight: 2.45 * SIZE,
  footOffset: 0,
  animations: {
    // Clip map grouped like the Mixamo library (robot-fight-assets/animations/):
    // idle-stance, movement, punches, kicks, combos, blocks-dodges,
    // hits-reactions, knockdowns-getups, ko, taunts-special.
    // Array contents and clip names are unchanged.

    // --- idle-stance ---
    idle: 'FightingIdle',
    idleVariants: ['FightingIdle'], // guard stance only: no relaxed / breathing idle (robots don't tire)
    idleInjured: 'InjuredStumbleIdle',

    // --- movement ---
    walkForward: 'Walking',
    walkBack: 'WalkingBackwards',
    strafeLeft: 'JogStrafeLeft',
    strafeRight: 'JogStrafeRight',

    // --- punches + combos (PunchCombo is the combo in this list) ---
    punch: 'Punching',
    punchVariants: ['Punching', 'PunchCombo', 'ElbowPunching', 'LeadJab', 'RightHook', 'Uppercut'],
    punchRight: ['Punching', 'PunchCombo', 'ElbowPunching', 'LeadJab', 'RightHook', 'Uppercut'],
    punchLeft: [],

    // --- kicks (specials / jump kicks) ---
    kick: 'Kicking',
    kickVariants: ['Kicking', 'MmaKick', 'RoundhouseKick', 'SideKick', 'MeiaLuaDeFrente', 'LegSweep', 'KneeKickLead'],
    kickSpecial: ['FlipKick', 'ChapaGiratoria', 'SpinFlipKick', 'MeiaLuaDeCompasso'],
    flipSpecial: ['FlipKick', 'ChapaGiratoria', 'SpinFlipKick', 'MeiaLuaDeCompasso'],
    // Airborne moves: the root holds the clip's own height (no grounding pull) until landing.
    jumpKicks: ['FlipKick', 'SpinFlipKick'],

    // --- blocks-dodges ---
    dodgeBack: null, // 'Backflip' removed (lands on its hands and crawls back up: read as climbing)
    dodgeFront: 'FrontFlip',
    dodgeVariants: ['Dodging', 'DodgingBack'],
    block: 'CenterBlock',
    blockVariants: ['CenterBlock', 'BodyBlock', 'LeftBlock', 'RightBlock'],

    // --- hits-reactions ---
    hit: 'Stunned',
    hitByPart: {
      head: ['HeadHit', 'HitOnSideOfHead', 'Reaction'],
      torso: ['HitToBody', 'BigStomachHit', 'Reaction'],
      armL: ['HitToBody', 'Stunned', 'Reaction'],
      armR: ['HitToBody', 'Stunned', 'Reaction'],
      legL: ['HitOnLegs', 'Reaction'],
      legR: ['HitOnLegs', 'Reaction'],
    },
    stunned: 'Stunned',
    hitHeavy: 'StumbleBackwards', // also used in knockdowns-getups

    // --- knockdowns-getups ---
    knockdownVariants: ['KnockedDown', 'LivershotKnockdown', 'StumbleBackwards'],
    getUp: 'GettingUp',

    // --- ko ---
    ko: 'KnockedOut',
    koVariants: ['KnockedOut', 'StandingReactDeathBackward', 'Defeated'],

    // --- taunts-special ---
    victory: 'Victory',
    victoryVariants: ['Victory', 'VictoryIdle', 'Taunt'],
  },
  colors: {
    p1: 0x2f74ff,
    p2: 0xe23b3b,
  },
};

export const LOOP_CLIPS = ['GuardUpper',
  // idle-stance
  'FightingIdle', 'InjuredStumbleIdle', 'Idle',
  // taunts-special
  'VictoryIdle',
  // movement
  'Walking', 'WalkingBackwards', 'JogStrafeLeft', 'JogStrafeRight',
];

export const ARENA = {
  // Distance from center to a flat side of the cage (world units).
  apothem: 6.1 * WORLD_SCALE,
  floorY: 0,
  floorThickness: 0.28,
  // Raised octagon stage: mat top sits 0.9 m above the arena floor (STADIUM.floorY).
  // Visual floor-mesh top and physics plane share this Y so feet and colliders agree.
  matTop: 0.9,
  // Short MMA cage (waist-to-chest). Visuals and physics share this height for the
  // visible rail; physics also uses a taller extension of the same wall so jump-outs stay in.
  cage: true,
  cageHeight: 1.48 * WORLD_SCALE,
  // Two-bone stance IK is off: the solver was twisting legs and lifting feet off the mat.
  stanceIK: false,
  // HDRI environment + backdrop (on by default via settings.js; the player's toggle is saved).
  // Swap the file here when a final space/sky pick lands.
  // Poly Haven Industrial Pipe and Valve 01 2K (CC0), Ezequiel's pick.
  hdriUrl: './hdris/industrial_pipe_and_valve_01_2k.hdr',
};

export const COMBAT = {
  maxHealth: 100,
  moveSpeed: 3.4 * SIZE,
  runMul: 1.5, // Shift: forward speed multiplier (on top of footworkMul)
  footworkMul: 2.0, // base forward/back stepping speed vs the clip; walk anim speeds up to match
  runBackMul: 1.35, // Shift: backward speed multiplier
  blockMoveSpeed: 1.4 * SIZE,
  // reach: root-to-root distance where the strike visibly lands (the AI fights from here).
  // range: outer gate; the hit itself needs the fist/foot to touch the body (see strikeContact).
  // recover: idle time after the attack ends (x whiffMul when it missed).
  punch: { damage: 5, reach: 1.62 * SIZE, range: 2.25 * SIZE, recover: 0.2, activeFrac: [0.2, 0.78] },
  kick: { damage: 8, reach: 1.68 * SIZE, range: 2.2 * SIZE, recover: 0.36, activeFrac: [0.26, 0.8] },
  // Extra idle after a clip by strike class (60 fps targets: jab 16-20f, hook/elbow 22-28f,
  // knee/kick 28-36f, spinning 36-44f); the clip's own follow-through covers part of it.
  recoverByClip: {
    // punches + combos
    LeadJab: 0.18, Punching: 0.2, PunchCombo: 0.26, ElbowPunching: 0.26, RightHook: 0.26, Uppercut: 0.28,
    // kicks
    Kicking: 0.36, MmaKick: 0.36, SideKick: 0.36, KneeKickLead: 0.32, LegSweep: 0.38, RoundhouseKick: 0.42,
    MeiaLuaDeFrente: 0.44, FlipKick: 0.5, ChapaGiratoria: 0.5, SpinFlipKick: 0.55, MeiaLuaDeCompasso: 0.55,
  },
  whiffMul: 1.6,
  punchSpeed: 1.45,      // punch clip playback (damage slows it again)
  kickSpeed: 1.28,
  playerRecoverMul: 0.55, // the player's post-attack pause vs the table above
  cpuRecoverMul: 0.85,    // CPU stays readable, a little snappier than the table
  inputBuffer: 0.3,      // seconds an early attack press is remembered
  contactHold: 0.1,      // after a fist/foot connects it is pulled back this soon
  knockdownForce: 4.6,   // a heavy blow at least this hard knocks down (heavy counters always do)
  kickKnockChance: 0.25,  // other heavy kicks knock down this often
  punchLunge: 0.68 * SIZE, // metres a strike steps forward into the swing (stops on contact)
  kickLunge: 0.55 * SIZE,
  strikeGap: 1.3 * SIZE,   // chest-gap guard; lunges no longer wait for a wide opening
  bodyRadius: 0.27 * SIZE, // striking distance to the body surface (contact itself uses skeleton capsules, game.js CAPS)
  fistShell: 0.16 * SIZE,  // fist surface beyond the hand bone (contact tolerance)
  kickShell: 0.15 * SIZE,
  blockReduction: 0.82,
  hitStun: 0.34,       // light hitstun
  hitStunHeavy: 1.05,  // hooks, body shots, most kicks: a few stumble steps before recover
  counterExtra: 0.17,  // caught mid-swing: +10f
  blockStunTail: 0.08, // guard stays locked this long after its pushback
  hitInvuln: 0.08,     // only stops one blow registering twice; combos can land
  hitRock: 0.42 * SIZE,       // metres a light hit knocks a robot back (walked out with the back-step)
  stumbleForce: 3.8,   // impact force that turns a hit into a stepped stumble-back
  stumbleDist: 1.05 * SIZE,   // metres travelled over the StumbleBackwards steps
  separate: 1.1 * SIZE,       // soft spacing: closer than this, the CPU steps back (with its walk)
  separateDown: 0.6 * SIZE,   // how close a robot may walk to one lying on the mat (ground attacks)
  separateHard: 0.92 * SIZE,  // emergency push-apart only (physics capsules normally keep 0.95)
  downRest: 0.85,      // seconds lying still before getting up (same every time: robots don't tire)
  downMax: 4.2,        // safety: get up by this long after the knockdown started
  getupTime: 1.25,     // the GettingUp clip is played over about this long
  // Flips (Y front flip, U jump kick; pad RB+toward front flip, R3 jump kick). No back flip.
  dodge: {
    back: 1.75 * SIZE,      // metres a back flip carries the robot away
    frontPast: 1.0 * SIZE,  // a front flip lands this far beyond the opponent (when there's room)
    frontShort: 1.0 * SIZE, // otherwise it just goes this far forward (never into the body)
    cooldown: 2.2,          // seconds between flips
    ringMargin: 0.75 * SIZE, // landing spot stays this far inside the ring
    maxLegDamage: 0.55,     // a leg damaged past this (or a lost leg / foot) can't flip
  },
  jumpKickTravel: 0.6 * SIZE, // a jump kick closes up to this much distance in the air
  // Stomp / ground punch on a downed robot (key I, pad Y).
  ground: {
    reach: 1.05 * SIZE,      // nearest lying body segment must be this close (root XZ)
    stompReach: 0.8 * SIZE,    // closer than this it's a stomp, else a ground punch
    stompDamage: 8,
    poundDamage: 6,
    perKnockdown: 2,    // per attacker, per knockdown
    recover: 0.55,
    poundBow: 1.15,     // radians of forward bow spread over the spine (procedural)
    stompBow: 0.3,
  },
};

export const GFX_PRESETS = {
  // minScale: how far auto-resolution may drop below the cap to hold frame rate.
  // bloom: off. UnrealBloom was smearing leftover additive fixture glow into a white haze
  // over the cage centre. Exposure stays modest (ACES) so the metal mat stays a sharp mirror.
  // mirror: planar mat reflection resolution (Medium renders it at half size).
  low: { pixelCap: 1, shadows: false, shadowSize: 512, exposure: 1.08, bloom: false, mirror: 0, minScale: 0.6 },
  // medium: Macs / Retina / integrated GPUs. Jumbotron at 10 fps; debris and HDRI as High.
  // Crowd/seat/truss layout is the Low stadium layout on every graphics setting.
  medium: { pixelCap: 1.25, shadows: true, shadowSize: 1024, exposure: 1.12, bloom: false, mirror: 512, minScale: 0.55 },
  high: { pixelCap: 1.25, shadows: true, shadowSize: 1024, exposure: 1.15, bloom: false, mirror: 512, minScale: 0.5 },
  // phones/tablets (js/mobile.js): applied on top of low/high: pixel ratio and shadow caps.
  mobile: { pixelCap: 1.25, shadowSize: 1024 }, // phones share the 1 / 1.25 caps
};

// Per-part wrecking. Names in `bind` are normalized (lowercase, no "mixamorig",
// dots, colons, or underscores) so Mixamo bones like mixamorig:Head / LeftArm match.
// Torso can be crushed but stays attached.
// Per-fighter stat profiles. Each stat is a 1-10 rating; every profile spends the same total
// (STAT_BUDGET), so fighters differ but none is strictly better. A rating maps to a fight-code
// multiplier around 1.0 (statMul): 6 -> 1.00, each point = 5%.
//   speed:     walk speeds, strike playback speed and (CPU) reaction speed
//   power:     damage dealt
//   armor:     damage taken is divided by it
//   reach:     strike range the fighter (and its AI) works at
//   recovery:  hitstun, attack recovery, time down, get-up speed, dodge cooldown
//   toughness: part hit points (how much a head/arm/leg takes before it fails)
export const STAT_KEYS = ['speed', 'power', 'armor', 'reach', 'recovery', 'toughness'];
export const STAT_BUDGET = 36;
export const FIGHTER_PROFILES = {
  striker: { id: 'striker', name: 'Striker', blurb: 'Fast feet, quick hands, recovers fast. Lighter hits and plating.',
    strengths: ['Fast footwork', 'Quick strikes', 'Quick recovery'], weaknesses: ['Light hitter', 'Thin armor'],
    stats: { speed: 9, power: 5, armor: 5, reach: 6, recovery: 7, toughness: 4 } },
  bruiser: { id: 'bruiser', name: 'Bruiser', blurb: 'Hits hard, heavy plating, tough parts. Slow to move and to recover.',
    strengths: ['Hard hitter', 'Heavy armor', 'Tough parts'], weaknesses: ['Slow', 'Slow recovery'],
    stats: { speed: 4, power: 6, armor: 7, reach: 6, recovery: 5, toughness: 8 } },
};
export const SIDE_PROFILE = { p1: 'striker', p2: 'bruiser' };
export const statMul = (rating) => 1 + (rating - 6) * 0.05;

export const DAMAGE = {
  parts: {
    head: { hp: 40, label: 'Head', detach: true },
    torso: { hp: 55, label: 'Torso', detach: false },
    armL: { hp: 34, label: 'Left arm', detach: true },
    armR: { hp: 34, label: 'Right arm', detach: true },
    legL: { hp: 44, label: 'Left leg', detach: true },
    legR: { hp: 44, label: 'Right leg', detach: true },
  },
  order: ['head', 'torso', 'armL', 'armR', 'legL', 'legR'],
  bind: {
    head: ['head', 'neck', 'headend', 'headtopend'],
    torso: ['torso', 'body', 'hips', 'abdomen', 'spine', 'spine1', 'spine2', 'chest', 'pelvis'],
    armL: [
      'shoulderl', 'upperarml', 'lowerarml', 'arml', 'handl', 'leftshoulder', 'leftarm',
      'leftforearm', 'lefthand', 'palm1l', 'palm2l', 'palm3l', 'thumbl', 'thumb2l',
      'indexl', 'index2l', 'middle1l', 'middle2l', 'ring1l', 'ring2l',
      'leftindex1', 'leftindex2', 'leftindex3', 'leftmiddle1', 'leftmiddle2', 'leftmiddle3',
      'leftring1', 'leftring2', 'leftring3', 'leftpinky1', 'leftpinky2', 'leftpinky3',
      'leftthumb1', 'leftthumb2', 'leftthumb3', 'lefthandindex', 'lefthandthumb',
    ],
    armR: [
      'shoulderr', 'upperarmr', 'lowerarmr', 'armr', 'handr', 'rightshoulder', 'rightarm',
      'rightforearm', 'righthand', 'palm1r', 'palm2r', 'palm3r', 'thumbr', 'thumb2r',
      'indexr', 'index2r', 'middle1r', 'middle2r', 'ring1r', 'ring2r',
      'rightindex1', 'rightindex2', 'rightindex3', 'rightmiddle1', 'rightmiddle2', 'rightmiddle3',
      'rightring1', 'rightring2', 'rightring3', 'rightpinky1', 'rightpinky2', 'rightpinky3',
      'rightthumb1', 'rightthumb2', 'rightthumb3', 'righthandindex', 'righthandthumb',
    ],
    legL: [
      'upperlegl', 'lowerlegl', 'legl', 'footl', 'leftupleg', 'leftleg', 'leftfoot',
      'lefttoebase', 'lefttoe', 'toel',
    ],
    legR: [
      'upperlegr', 'lowerlegr', 'legr', 'footr', 'rightupleg', 'rightleg', 'rightfoot',
      'righttoebase', 'righttoe', 'toer',
    ],
  },
  skip: ['rootnode', 'robotarmature', 'bone', 'poletargetl', 'poletargetr', 'poletargetlend', 'poletargetrend'],
  // Smaller breakables inside the limbs. `root` = normalized bone names; every bone below them
  // belongs to the sub-part (deepest sub-part wins). They break off as their own debris.
  sub: {
    handL: { parent: 'armL', hp: 20, label: 'Left hand', root: ['lefthand'] },
    thumbL: { parent: 'handL', hp: 6, label: 'Left thumb', root: ['lefthandthumb1'] },
    fingersL: { parent: 'handL', hp: 6, label: 'Left index + middle', root: ['lefthandindex1', 'lefthandmiddle1'] },
    fingersL2: { parent: 'handL', hp: 6, label: 'Left ring + pinky', root: ['lefthandring1', 'lefthandpinky1'] },
    handR: { parent: 'armR', hp: 20, label: 'Right hand', root: ['righthand'] },
    thumbR: { parent: 'handR', hp: 6, label: 'Right thumb', root: ['righthandthumb1'] },
    fingersR: { parent: 'handR', hp: 6, label: 'Right index + middle', root: ['righthandindex1', 'righthandmiddle1'] },
    fingersR2: { parent: 'handR', hp: 6, label: 'Right ring + pinky', root: ['righthandring1', 'righthandpinky1'] },
    footL: { parent: 'legL', hp: 32, label: 'Left foot', root: ['leftfoot'] },
    toesL: { parent: 'footL', hp: 12, label: 'Left toes', root: ['lefttoebase'] },
    footR: { parent: 'legR', hp: 32, label: 'Right foot', root: ['rightfoot'] },
    toesR: { parent: 'footR', hp: 12, label: 'Right toes', root: ['righttoebase'] },
  },
  subOrder: ['handL', 'thumbL', 'fingersL', 'fingersL2', 'handR', 'thumbR', 'fingersR', 'fingersR2', 'footL', 'toesL', 'footR', 'toesR'],
  oil: { maxDrops: 140, maxPuddles: 36, puddleMaxR: 0.42 },
  dent: { radius: 0.32, depth: 0.085, maxDepth: 0.22, colorDarken: 0.7,
    // Per-part scaling: head dents go deeper, wider and darker, and show from the first hits.
    part: { head: { depth: 1.9, radius: 1.15, maxDepth: 1.15, darken: 1.35, min: 0.7 } } },
  heavySmoke: 0.5,
  punchArm: 'armR',
};

// Read-only fighter stats for the UI (fighter select, tale of the tape): the profile's ratings,
// the multipliers fight code applies, and the real resulting numbers. Pass a side ('p1'/'p2')
// or a profile id ('striker'/'bruiser'). Returns a fresh frozen object every call.
export function getFighterStats(sideOrId = 'p1') {
  const id = FIGHTER_PROFILES[sideOrId] ? sideOrId : (SIDE_PROFILE[sideOrId] || 'striker');
  const p = FIGHTER_PROFILES[id];
  const mul = {};
  for (const k of STAT_KEYS) mul[k] = +statMul(p.stats[k]).toFixed(3);
  const partHp = Object.values(DAMAGE.parts).reduce((a, q) => a + Math.round(q.hp * mul.toughness), 0);
  const r2 = (v) => +v.toFixed(2);
  return Object.freeze({
    id: p.id, name: p.name, blurb: p.blurb,
    ratings: Object.freeze({ ...p.stats }), total: STAT_KEYS.reduce((a, k) => a + p.stats[k], 0), budget: STAT_BUDGET,
    mul: Object.freeze(mul),
    real: Object.freeze({
      moveSpeed: r2(COMBAT.moveSpeed * mul.speed),            // m/s
      strikeSpeed: r2(mul.speed),                              // x clip speed
      punchDamage: r2(COMBAT.punch.damage * mul.power),
      kickDamage: r2(COMBAT.kick.damage * mul.power),
      damageTaken: r2(1 / mul.armor),                          // x incoming damage
      punchReach: r2(COMBAT.punch.reach * mul.reach),          // m
      kickReach: r2(COMBAT.kick.reach * mul.reach),            // m
      hitStun: r2(COMBAT.hitStun / mul.recovery),              // s
      downRest: r2(COMBAT.downRest / mul.recovery),            // s
      partHp,                                                  // total part hit points
    }),
  });
}

// The shape the fighter-select / tale-of-the-tape reader (js/shell/profiles.js) expects:
// absolute stats in its units (power = mean strike damage, speed = m/s, armor = effective part
// hit points = part hp x armor, reach = kick reach in m) plus a recovery multiplier.
export function fighterProfile(side = 'p1') {
  const g = getFighterStats(side);
  const p = FIGHTER_PROFILES[g.id];
  return {
    id: g.id, name: g.name, blurb: g.blurb,
    stats: {
      power: +((g.real.punchDamage + g.real.kickDamage) / 2).toFixed(2),
      speed: g.real.moveSpeed,
      armor: Math.round(g.real.partHp * g.mul.armor),
      reach: g.real.kickReach,
    },
    recovery: g.mul.recovery,
    strengths: p.strengths.slice(), weaknesses: p.weaknesses.slice(),
    ratings: g.ratings,
  };
}
if (typeof window !== 'undefined') { window.RFFighterStats = getFighterStats; window.RFFighterProfile = fighterProfile; }
