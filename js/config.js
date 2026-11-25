// Mixamo-rigged Sketchfab "Robot character" (assetfactory, Free Standard).
// Animations from Mixamo. Idle/walk/strafe use real clips; hips XZ root motion is stripped.
// World scale: the octagon (mat, cage, platform, physics bounds) and both robots grow together
// (10% over the original). Speeds, reach, capsules, gravity and cage height follow this.
export const WORLD_SCALE = 1.10;
// Cameras keep the original (pre-scale) standoff so the slightly larger robots fill the frame.
// Look-at height still follows SIZE + matTop.
export const CAM_SIZE = 1.12;
// Robot size: every robot-relative distance (reach, spacing, capsules, wires) scales by this.
export const SIZE = 1.12 * WORLD_SCALE;
// Root padding that keeps a fighter capsule inside the cage (chest sphere is 0.48*SIZE).
export const CAGE_PAD = 0.48 * SIZE + 0.14;

// Flip / backflip clips kept in the GLB so joint limits can still be fitted from them,
// but they are not loaded into the fight mixer (they read as a back or side flip kick).
export const UNUSED_CLIPS = ['FlipKick', 'SpinFlipKick', 'ChapaGiratoria', 'MeiaLuaDeCompasso', 'Backflip', 'BackFlipToUppercut'];

// Shared robot-move energy (thruster dash, shoulder charge, ground slam, overheat). Costs are absolute points
// on a 0–energyMax pool that refills after a short delay.
export const SPECIAL = {
  energyMax: 100,
  regen: 18,
  regenDelay: 0.45,
  dashCost: 32,
  chargeCost: 38,
  slamCost: 50,
  overheatCost: 100, // the whole bar
  // Shoulder charge: a thruster rush with the shoulder down; stops on the body.
  charge: { dist: 2.4 * SIZE, time: 0.42, damage: 9, knock: 0.4, hitGap: 1.22 * SIZE, recover: 0.38 },
  // Ground slam: hop, then both fists into the mat; a shockwave ring along the floor.
  // The wave must travel out and reach the body (bodyReach = body radius it counts as touching);
  // damage falls off with distance (falloff 0.4 = 60% at the edge of the ring).
  slam: { damage: 10, knock: 0.55, radius: 1.8 * SIZE, up: 0.34, down: 0.1, recover: 0.5, hop: 0.38 * SIZE, bodyReach: 0.3 * SIZE, falloff: 0.4 },
  // Overheat super (full bar): a short vent-up, then a heat burst all around. Afterwards the
  // energy bar stays empty for a while (the robot is cooling down).
  overheat: { damage: 16, knock: 1, radius: 2.45 * SIZE, charge: 0.5, recover: 0.5, cooldown: 3.2 },
  dash: {
    dist: 1.65 * SIZE,
    time: 0.32, // bell-shaped burst: ~6.4 m/s average, ~9.5 m/s peak
    invuln: 0.12,
  },
};

// Named moves (keys / pad / CPU / API brains). Strikes play a Mixamo clip through the normal
// strike system (contact, hitstun, recovery) with their own damage and recovery; spin and fly
// are procedural layers on top (spinning backfist = RightHook + a full turn; flying kick =
// SideKick + a hop forward). knock = chance a clean hit knocks down. range = root-to-root reach of
// a lunging move (the others use the clip's measured reach plus a strike step).
export const MOVES = {
  // turn: radians the body squares into the target over the hit (the uppercut clip throws off-line).
  uppercut: { kind: 'punch', clip: 'Uppercut', damage: 8, recover: 0.3, label: 'Uppercut', stepGap: 0.45 * SIZE, turn: -0.6, range: 1.45 * SIZE },
  elbow: { kind: 'punch', clip: 'ElbowPunching', damage: 6.5, recover: 0.22, label: 'Elbow', stepGap: 0.5 * SIZE },
  spin_backfist: { kind: 'punch', clip: 'RightHook', damage: 9, recover: 0.36, label: 'Spinning backfist',
    spin: 1, slow: 0.8, lunge: 0.85 * SIZE, range: 2.0 * SIZE },
  knee: { kind: 'kick', clip: 'KneeKickLead', damage: 9, recover: 0.32, label: 'Knee strike', stepGap: 0.5 * SIZE },
  sweep_kick: { kind: 'kick', clip: 'LegSweep', damage: 6, recover: 0.42, knock: 0.85, label: 'Sweep kick' },
  flying_kick: { kind: 'kick', clip: 'SideKick', damage: 11, recover: 0.5, label: 'Flying kick',
    hop: 0.42 * SIZE, lunge: 1.25 * SIZE, range: 2.85 * SIZE },
};
export const ROBOT_MOVES = ['shoulder_charge', 'ground_slam', 'overheat'];
export const MOVE_IDS = [...Object.keys(MOVES), ...ROBOT_MOVES];

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
    // Uppercut and ElbowPunching are their own moves now (MOVES below), not random punches.
    punchVariants: ['Punching', 'PunchCombo', 'LeadJab', 'RightHook'],
    punchRight: ['Punching', 'PunchCombo', 'LeadJab', 'RightHook'],
    punchLeft: [],

    // --- kicks (standing, front-facing). Flip-kick clips stay in the GLB for joint
    // fitting but are not mapped here and are not loaded into the mixer.
    kick: 'Kicking',
    // KneeKickLead (knee strike) and LegSweep (sweep kick) are their own moves now (MOVES below).
    kickVariants: ['Kicking', 'MmaKick', 'RoundhouseKick', 'SideKick', 'MeiaLuaDeFrente'],
    kickSpecial: [],
    flipSpecial: [],
    jumpKicks: [],

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
      legL: ['Reaction', 'Stunned'], // HitOnLegs is a sweep to the mat: heavy leg knockdowns only
      legR: ['Reaction', 'Stunned'],
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

// Alternate bodies. Each GLB holds only a mesh rebound onto RobotFighter's exact Mixamo
// skeleton (same 65 bone names and rest rotations), so it plays the robot's clips, joint
// limits, footwork and damage as is. `paint: false` keeps the model's own textures (no team
// tint, no shell paint, no chrome mask); `visor: false` skips the neon eyes (Teal, Draugr, Fixer, Rivet,
// Blix, Ginger and Ghoul have their own faces). Blix, Ginger and Ghoul are Mixamo characters (Ch19 /
// Ch14 / Parasite; Ch19's rig is prefixed mixamorig1:), baked onto the same skeleton by bone name with
// their own weights. A body GLB may carry its own take of a shared clip by name (Ghoul's Victory and
// Taunt are the Parasite's own pounce); it replaces that clip for this fighter only.
export const SKINS = {
  teal: {
    url: './models/TealFighter.glb',
    source: 'Teal by Lagst (Sketchfab Free Standard); animations from Mixamo',
    paint: false,
    visor: false,
  },
  fixer: {
    url: './models/FixerFighter.glb',
    source: 'Fixer Robot by Lagst (Sketchfab Standard); animations from Mixamo',
    paint: false,
    visor: false,
  },
  rivet: {
    url: './models/RivetFighter.glb',
    source: 'Robot by Lagst (Sketchfab Standard), named Rivet in game; animations from Mixamo',
    paint: false,
    visor: false,
  },
  blix: {
    url: './models/BlixFighter.glb',
    source: 'Mixamo character Ch19 (Adobe), named Blix in game; animations from Mixamo',
    paint: false,
    visor: false,
  },
  ginger: {
    url: './models/GingerFighter.glb',
    source: 'Mixamo character Ch14 (Adobe), named Ginger in game; animations from Mixamo',
    paint: false,
    visor: false,
  },
  ghoul: {
    url: './models/GhoulFighter.glb',
    source: 'Mixamo character Parasite (Adobe) and its Mixamo animation, named Ghoul in game; other animations from Mixamo',
    paint: false,
    visor: false,
  },
  draugr: {
    url: './models/DraugrFighter.glb',
    source: 'Draugr - General purpose humanoid bot by Lagst (Sketchfab Standard); animations from Mixamo',
    paint: false,
    visor: false,
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
  // Raised octagon stage: mat top sits 0.9 m above the arena floor (ARENA.floorY).
  // Visual floor-mesh top and physics plane share this Y so feet and colliders agree.
  matTop: 0.9,
  // Visual cage is off: chain-link and rails block the camera. Physics keeps an
  // invisible ring wall (see physics.js) so fighters and loose parts stay on the mat.
  cage: false,
  cageHeight: 1.48 * WORLD_SCALE,
  // HDRI is used for robot/mat reflections only (on by default; toggle saved).
  // The surround stays a dark void. Poly Haven Industrial Pipe and Valve 01 2K (CC0).
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
    // punches + combos (named moves use MOVES[id].recover)
    LeadJab: 0.18, Punching: 0.2, PunchCombo: 0.26, RightHook: 0.26,
    // kicks
    Kicking: 0.36, MmaKick: 0.36, SideKick: 0.36, RoundhouseKick: 0.42,
    MeiaLuaDeFrente: 0.44,
  },
  whiffMul: 1.6,
  punchSpeed: 1.45,      // punch clip playback (damage slows it again)
  kickSpeed: 1.28,
  playerRecoverMul: 0.55, // the player's post-attack pause vs the table above
  cpuRecoverMul: 1,       // CPU uses the recovery table; the player stays snappier
  inputBuffer: 0.3,      // seconds an early attack press is remembered
  contactHold: 0.1,      // after a fist/foot connects it is pulled back this soon
  knockdownForce: 4.6,   // a heavy blow at least this hard knocks down (heavy counters always do)
  kickKnockChance: 0.25,  // other heavy kicks knock down this often
  punchStep: 0.9 * SIZE,   // longest step into a strike: lead foot steps, back foot follows (stops on contact)
  kickStep: 0.55 * SIZE,
  strikeGap: 1.3 * SIZE,   // chest-gap guard; steps in don't wait for a wide opening
  bodyRadius: 0.27 * SIZE, // striking distance to the body surface (contact itself uses skeleton capsules, game.js CAPS)
  fistShell: 0.2 * SIZE,   // fist surface beyond the hand bone (contact tolerance)
  kickShell: 0.15 * SIZE,
  blockReduction: 0.82,
  // Hitstun at 60 fps: light 18f, heavy 32f, counter = heavy + 10f.
  hitStun: 0.30,
  hitStunHeavy: 0.53,
  counterExtra: 0.17,
  // Mutual freeze on connect (attacker and defender). No gravity change — time just holds.
  hitStopLight: 0.05,
  hitStopHeavy: 0.08,
  hitStopCounter: 0.12,
  blockStunTail: 0.08, // guard stays locked this long after its pushback
  hitInvuln: 0.08,     // only stops one blow registering twice; combos can land
  hitRock: 0.42 * SIZE,       // metres a light hit knocks a robot back (walked out with the back-step)
  stumbleForce: 3.8,   // impact force that turns a hit into a stepped stumble-back
  stumbleDist: 1.05 * SIZE,   // metres travelled over the StumbleBackwards steps
  separate: 1.1 * SIZE,       // soft spacing: closer than this, the CPU steps back (with its walk)
  separateDown: 0.6 * SIZE,   // how close a robot may walk to one lying on the mat (ground attacks)
  separateHard: 0.92 * SIZE,  // emergency push-apart only (physics capsules normally keep 0.95)
  downRest: 0.85,      // first knockdown, after the body has settled (later ones add time)
  downRestStep: 0.45,  // each further knockdown stays down longer
  downRestCap: 1.8,    // lying-still cap (plus the fall itself)
  downMax: 5.2,        // safety: get up by this long after the knockdown started
  getupTime: 1.05,     // GettingUp plays over about this long (blended, never a snap)
  // Front flip dodge (Y, or R1 + forward). No back flip and no jump / flip kicks.
  dodge: {
    back: 1.75 * SIZE,      // metres a back flip carries the robot away
    frontPast: 1.0 * SIZE,  // a front flip lands this far beyond the opponent (when there's room)
    frontShort: 1.0 * SIZE, // otherwise it just goes this far forward (never into the body)
    cooldown: 2.2,          // seconds between flips
    ringMargin: 0.75 * SIZE, // landing spot stays this far inside the ring
    maxLegDamage: 0.55,     // a leg damaged past this (or a lost leg / foot) can't flip
  },
  // Stomp / ground punch on a downed robot (key I, pad Y).
  ground: {
    reach: 1.05 * SIZE,      // nearest lying body segment must be this close (root XZ)
    stompReach: 0.8 * SIZE,    // closer than this it's a stomp, else a ground punch
    stompDamage: 10,
    poundDamage: 8,
    perKnockdown: 3,    // per attacker, per knockdown (still can't pin: hits don't delay the get-up)
    recover: 0.55,
    poundBow: 1.25,     // radians of forward bow spread over the spine (procedural)
    stompBow: 0.5,      // the body leans into the stomp
    stompSpeed: 0.85,   // stomp clip playback: slower reads as a heavy, deliberate stamp
    poundSpeed: 0.95,
  },
};

export const GFX_PRESETS = {
  // minScale: how far auto-resolution may drop below the cap to hold frame rate.
  // High is the sharpest: native DPR (cap 2), canvas MSAA, no bloom/FXAA, dynamic res floored at 1.
  // Medium may scale a little but stays at or above Low's 1.0 effective ratio.
  // bloom: off. UnrealBloom was smearing leftover additive fixture glow into a white haze
  // over the cage centre. Exposure stays modest (ACES) so the metal mat stays a sharp mirror.
  // mirror: planar mat reflection resolution (High is full size; Medium is half).
  low: { pixelCap: 1, shadows: false, shadowSize: 512, exposure: 1.08, bloom: false, mirror: 0, minScale: 0.6 },
  // medium: Macs / Retina / integrated GPUs. Shadows and the mat mirror stay a step under High.
  medium: { pixelCap: 1.5, shadows: true, shadowSize: 1536, exposure: 1.14, bloom: false, mirror: 512, minScale: 0.8 },
  high: { pixelCap: 2, shadows: true, shadowSize: 2048, exposure: 1.18, bloom: false, mirror: 1024, minScale: 1 },
  // Ultra is desktop-first and never the default on phones, but it stays selectable there.
  // Bloom / GTAO / film finish are Ultra-only so High stays the previous sharp, haze-free look.
  // Shadows stay PCF (r187 dropped PCFSoft; PCF is the same filtered look) at 4096.
  ultra: { pixelCap: 2.5, shadows: true, shadowSize: 4096, exposure: 1.08, bloom: true, bloomStrength: 0.11, bloomRadius: 0.24, bloomThreshold: 0.88, mirror: 2048, minScale: 1, ao: true, filmic: true, envBoost: 1.04 },
  // phones/tablets (js/mobile.js): applied on top of low/high: pixel ratio and shadow caps.
  // iOS additionally caps pixel ratio at 1.5 and forces shadows off (see gfxPreset in game.js).
  mobile: { pixelCap: 1.25, shadowSize: 1024 }, // phones stay capped; High sharpness is a desktop budget
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
  sprocket: { id: 'sprocket', name: 'Sprocket', blurb: 'Fresh off the line. Even stats, no sharp edge, and nothing obvious to exploit.',
    strengths: ['No weak side'], weaknesses: ['No sharp edge'],
    stats: { speed: 6, power: 6, armor: 6, reach: 6, recovery: 6, toughness: 6 } },
  teal: { id: 'teal', name: 'Teal', blurb: 'A light, long-legged scrapper with a smile on its screen. Quick hands, quick feet, thin plating.',
    strengths: ['Long Legs', 'Quick Recovery'], weaknesses: ['Thin Armor'],
    stats: { speed: 7, power: 6, armor: 5, reach: 7, recovery: 7, toughness: 4 } },
  draugr: { id: 'draugr', name: 'Draugr', blurb: 'A tall labor frame that keeps walking forward. Heavy hands and parts that refuse to break, but slow to reset after a swing.',
    strengths: ['Heavy Hands', 'Tough Parts'], weaknesses: ['Slow Recovery'],
    stats: { speed: 5, power: 7, armor: 6, reach: 6, recovery: 4, toughness: 8 } },
  fixer: { id: 'fixer', name: 'Fixer', blurb: 'A stocky repair frame with oversized tool arms. Shrugs off hits and resets fast, but has to walk in close to land.',
    strengths: ['Heavy Armor', 'Quick Recovery'], weaknesses: ['Short Reach', 'Slow Feet'],
    stats: { speed: 4, power: 6, armor: 8, reach: 4, recovery: 8, toughness: 6 } },
  rivet: { id: 'rivet', name: 'Rivet', blurb: 'A wide-shouldered loader frame. Long arms and a crushing swing, but it takes a long time to reset after one.',
    strengths: ['Huge Power', 'Long Reach'], weaknesses: ['Slow Recovery'],
    stats: { speed: 5, power: 9, armor: 7, reach: 7, recovery: 3, toughness: 5 } },
  ginger: { id: 'ginger', name: 'Ginger', blurb: 'A pint-sized alley cat. Never stops moving and bounces straight back up, but short arms and a light frame.',
    strengths: ['Fast Feet', 'Quick Recovery'], weaknesses: ['Short Reach', 'Light Frame'],
    stats: { speed: 9, power: 4, armor: 4, reach: 3, recovery: 9, toughness: 6 } },
  blix: { id: 'blix', name: 'Blix', blurb: 'A wiry goblin scrapper with a mean streak. Sneaky quick hands and long arms, but one clean shot rattles it.',
    strengths: ['Quick Hands', 'Long Reach'], weaknesses: ['Glass Jaw'],
    stats: { speed: 7, power: 6, armor: 4, reach: 8, recovery: 7, toughness: 3 } },
  ghoul: { id: 'ghoul', name: 'Ghoul', blurb: 'A lurching parasite host. Slow on its feet, but it soaks up punishment and hits like a falling wall.',
    strengths: ['Iron Chin', 'Heavy Hands'], weaknesses: ['Slow Feet'],
    stats: { speed: 3, power: 8, armor: 6, reach: 6, recovery: 5, toughness: 9 } },
  // Aliases so older configs that name these ids still resolve (stats only; not on the roster).
  striker: { id: 'striker', name: 'Striker', blurb: 'A long-reach striker that darts in, pokes, and is gone before you can plant a heavy shot.',
    strengths: ['High Speed', 'Long Reach'], weaknesses: ['Thin Armor'],
    stats: { speed: 8, power: 5, armor: 4, reach: 9, recovery: 7, toughness: 3 } },
  bruiser: { id: 'bruiser', name: 'Bruiser', blurb: 'Walks forward behind a raised guard and hits heavy. Slow to start and to recover.',
    strengths: ['Heavy Armor', 'Tough Parts'], weaknesses: ['Slow', 'Slow Recovery'],
    stats: { speed: 3, power: 6, armor: 9, reach: 5, recovery: 4, toughness: 9 } },
};
export const SIDE_PROFILE = { p1: 'sprocket', p2: 'sprocket' };
export const STAT_BAR_KEYS = ['power', 'speed', 'armor', 'reach', 'recovery'];
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
  if (!FIGHTER_PROFILES[side]) {
    const api = (typeof window !== 'undefined' && window.RFShell && window.RFShell.api) || null;
    const f = api && (side === 'p2' ? api.p2 : side === 'p1' ? api.p1 : null);
    const live = f && f.config && f.config.profile;
    if (live && FIGHTER_PROFILES[live]) side = live;
  }
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
