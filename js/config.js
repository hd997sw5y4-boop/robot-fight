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

export const LOOP_CLIPS = [
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
  // HDRI environment (Poly Haven industrial_pipe_and_valve_01, CC0). Off by default; toggle in Settings.
  // When on, the HDRI is used as scene.environment (PMREM) and as a dim, blurred backdrop.
  // Arena lights stay on either way.
  hdri: false,
  hdriUrl: './hdris/industrial_pipe_and_valve_01_2k.hdr',
  // Two-bone stance IK is off: the solver was twisting legs and lifting feet off the mat.
  stanceIK: false,
};

export const COMBAT = {
  maxHealth: 100,
  moveSpeed: 3.4,
  blockMoveSpeed: 1.4,
  punch: { damage: 10, range: 1.35, cooldown: 0.55, activeFrac: [0.30, 0.62] },
  kick: { damage: 15, range: 1.7, cooldown: 0.8, activeFrac: [0.38, 0.68] },
  blockReduction: 0.82,
  hitStun: 0.62,
  hitInvuln: 0.28,
  knockback: 1.6,
  separate: 0.85,
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
  dent: { radius: 0.32, depth: 0.085, maxDepth: 0.22, colorDarken: 0.7 },
  heavySmoke: 0.5,
  punchArm: 'armR',
};
