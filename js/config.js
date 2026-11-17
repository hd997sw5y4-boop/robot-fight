// Mixamo-rigged Sketchfab "Robot character" (assetfactory, Free Standard).
// Animations from Mixamo. Idle/walk/strafe use real clips; hips XZ root motion is stripped.
export const MODEL = {
  url: './models/RobotFighter.glb',
  source: "Robot character by assetfactory (Sketchfab Free Standard); animations from Mixamo",
  scale: 1,
  targetHeight: 2.45,
  footOffset: 0,
  animations: {
    idle: 'FightingIdle',
    idleVariants: ['FightingIdle', 'Idle'],
    idleInjured: 'InjuredStumbleIdle',
    walkForward: 'Walking',
    walkBack: 'WalkingBackwards',
    strafeLeft: 'JogStrafeLeft',
    strafeRight: 'JogStrafeRight',
    punch: 'Punching',
    punchVariants: ['Punching', 'PunchCombo', 'ElbowPunching', 'LeadJab', 'RightHook', 'Uppercut'],
    punchRight: ['Punching', 'PunchCombo', 'ElbowPunching', 'LeadJab', 'RightHook', 'Uppercut'],
    punchLeft: [],
    kick: 'Kicking',
    kickVariants: ['Kicking', 'MmaKick', 'RoundhouseKick', 'SideKick', 'MeiaLuaDeFrente', 'LegSweep', 'KneeKickLead'],
    kickSpecial: ['FlipKick', 'ChapaGiratoria', 'SpinFlipKick', 'MeiaLuaDeCompasso'],
    flipSpecial: ['FlipKick', 'ChapaGiratoria', 'Backflip', 'FrontFlip', 'BackFlipToUppercut', 'SpinFlipKick', 'MeiaLuaDeCompasso'],
    victory: 'Victory',
    victoryVariants: ['Victory', 'VictoryIdle', 'Taunt'],
    dodgeVariants: ['Dodging', 'DodgingBack'],
    knockdownVariants: ['KnockedDown', 'LivershotKnockdown', 'StumbleBackwards'],
    koVariants: ['KnockedOut', 'StandingReactDeathBackward', 'Defeated'],
    block: 'CenterBlock',
    blockVariants: ['CenterBlock', 'BodyBlock', 'LeftBlock', 'RightBlock'],
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
    ko: 'KnockedOut',
    getUp: 'GettingUp',
    hitHeavy: 'StumbleBackwards',
  },
  colors: {
    p1: 0x2f74ff,
    p2: 0xe23b3b,
  },
};

export const LOOP_CLIPS = ['GuardUpper', 
  'FightingIdle', 'InjuredStumbleIdle', 'Idle', 'VictoryIdle',
  'Walking', 'WalkingBackwards', 'JogStrafeLeft', 'JogStrafeRight',
];

export const ARENA = {
  // Distance from center to a flat side of the cage (world units).
  apothem: 6.1,
  floorY: 0,
  floorThickness: 0.28,
  // Visual floor-mesh top and physics plane share this Y so feet and colliders agree.
  matTop: 0,
  // Visible fence/posts/rails. Physics ring walls stay on either way so fighters and debris stay in.
  // Set true later to bring the cage back.
  cage: false,
  // Two-bone stance IK is off: the solver was twisting legs and lifting feet off the mat.
  stanceIK: false,
  // HDRI environment + backdrop. Swap the file here when a final space/sky pick lands.
  // Poly Haven Industrial Pipe and Valve 01 2K (CC0), Ezequiel's pick.
  hdri: true,
  hdriUrl: './hdris/industrial_pipe_and_valve_01_2k.hdr',
};

export const COMBAT = {
  maxHealth: 100,
  moveSpeed: 3.4,
  runMul: 1.5, // Shift: forward speed multiplier (on top of footworkMul)
  footworkMul: 1.5, // base forward/back stepping speed vs the clip; walk anim speeds up to match
  runBackMul: 1.35, // Shift: backward speed multiplier
  blockMoveSpeed: 1.4,
  // reach: root-to-root distance where the strike visibly lands (the AI fights from here).
  // range: outer gate; the hit itself needs the fist/foot to touch the body (see strikeContact).
  // recover: idle time after the attack ends (x whiffMul when it missed).
  punch: { damage: 10, reach: 1.2, range: 1.75, cooldown: 0.5, recover: 0.2, activeFrac: [0.2, 0.78] },
  kick: { damage: 15, reach: 1.55, range: 2.05, cooldown: 0.85, recover: 0.36, activeFrac: [0.26, 0.8] },
  // Extra idle after a clip by strike class (60 fps targets: jab 16-20f, hook/elbow 22-28f,
  // knee/kick 28-36f, spinning 36-44f); the clip's own follow-through covers part of it.
  recoverByClip: {
    LeadJab: 0.18, Punching: 0.2, PunchCombo: 0.26, ElbowPunching: 0.26, RightHook: 0.26, Uppercut: 0.28,
    Kicking: 0.36, MmaKick: 0.36, SideKick: 0.36, KneeKickLead: 0.32, LegSweep: 0.38, RoundhouseKick: 0.42,
    MeiaLuaDeFrente: 0.44, FlipKick: 0.5, ChapaGiratoria: 0.5, SpinFlipKick: 0.55, MeiaLuaDeCompasso: 0.55,
  },
  whiffMul: 2.0,
  punchLunge: 0.12, // metres a strike steps in when slightly out of reach (small enough to hide)
  kickLunge: 0.1,
  strikeGap: 1.2,   // no lunge inside this gap; it would drive the body into the opponent
  bodyRadius: 0.36, // defender body capsule used for fist/foot contact
  blockReduction: 0.82,
  hitStun: 0.3,        // light hitstun (18f)
  hitStunHeavy: 0.53,  // hooks, body shots, most kicks (32f)
  counterExtra: 0.17,  // caught mid-swing: +10f
  blockStunTail: 0.08, // guard stays locked this long after its pushback
  hitStopLight: 0.05,
  hitStopHeavy: 0.08,
  hitStopCounter: 0.12,
  koSlowMo: 0.3,       // seconds of mild slow motion on a KO
  hitInvuln: 0.22,
  hitRock: 0.26,       // metres a light hit knocks a robot back (walked out with the back-step)
  stumbleForce: 3.8,   // impact force that turns a hit into a stepped stumble-back
  stumbleDist: 0.75,   // metres travelled over the StumbleBackwards steps
  separate: 1.05,      // soft spacing: closer than this, the robot steps back (with its walk)
  separateHard: 0.8,   // emergency push-apart only (physics capsules normally keep this)
  downRest: [0.85, 1.5], // seconds lying still before getting up: first knockdown, later ones
  downMax: 3.4,        // safety: get up even if the ragdoll never fully settles
  getupTime: 1.25,     // the GettingUp clip is played over about this long
};

export const GFX_PRESETS = {
  low: { pixelCap: 1, shadows: false, shadowSize: 512, exposure: 1.4 },
  high: { pixelCap: 2, shadows: true, shadowSize: 2048, exposure: 1.55 },
};

// Per-part wrecking. Names in `bind` are normalized (lowercase, no "mixamorig",
// dots, colons, or underscores) so Mixamo bones like mixamorig:Head / LeftArm match.
// Torso can be crushed but stays attached.
export const DAMAGE = {
  parts: {
    head: { hp: 32, label: 'Head', detach: true },
    torso: { hp: 55, label: 'Torso', detach: false },
    armL: { hp: 28, label: 'Left arm', detach: true },
    armR: { hp: 28, label: 'Right arm', detach: true },
    legL: { hp: 28, label: 'Left leg', detach: true },
    legR: { hp: 28, label: 'Right leg', detach: true },
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
    handL: { parent: 'armL', hp: 30, label: 'Left hand', root: ['lefthand'] },
    thumbL: { parent: 'handL', hp: 9, label: 'Left thumb', root: ['lefthandthumb1'] },
    fingersL: { parent: 'handL', hp: 10, label: 'Left index + middle', root: ['lefthandindex1', 'lefthandmiddle1'] },
    fingersL2: { parent: 'handL', hp: 10, label: 'Left ring + pinky', root: ['lefthandring1', 'lefthandpinky1'] },
    handR: { parent: 'armR', hp: 30, label: 'Right hand', root: ['righthand'] },
    thumbR: { parent: 'handR', hp: 9, label: 'Right thumb', root: ['righthandthumb1'] },
    fingersR: { parent: 'handR', hp: 10, label: 'Right index + middle', root: ['righthandindex1', 'righthandmiddle1'] },
    fingersR2: { parent: 'handR', hp: 10, label: 'Right ring + pinky', root: ['righthandring1', 'righthandpinky1'] },
    footL: { parent: 'legL', hp: 32, label: 'Left foot', root: ['leftfoot'] },
    toesL: { parent: 'footL', hp: 12, label: 'Left toes', root: ['lefttoebase'] },
    footR: { parent: 'legR', hp: 32, label: 'Right foot', root: ['rightfoot'] },
    toesR: { parent: 'footR', hp: 12, label: 'Right toes', root: ['righttoebase'] },
  },
  subOrder: ['handL', 'thumbL', 'fingersL', 'fingersL2', 'handR', 'thumbR', 'fingersR', 'fingersR2', 'footL', 'toesL', 'footR', 'toesR'],
  oil: { maxDrops: 140, maxPuddles: 36, puddleMaxR: 0.42 },
  dent: { radius: 0.32, depth: 0.085, maxDepth: 0.22, colorDarken: 0.7 },
  heavySmoke: 0.5,
  punchArm: 'armR',
};
