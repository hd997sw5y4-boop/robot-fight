// Stride speeds in GLB/local units (multiply by the fighter's model.scale at runtime).
// Walking/strafe: planted-foot treadmill speed on in-place clips.
// LongStepForward / StepBackward: hips XZ net travel before root-motion strip, then confirmed on feet.
export const CLIP_SPEEDS = {
  Walking: 0.006885,
  WalkingBackwards: 0.00682,
  JogStrafeLeft: 0.02764,
  JogStrafeRight: 0.02764,
  LongStepForward: 0.011236,
  StepBackward: 0.006675,
  // Slightly longer, quicker steps than the backward walk (same local units).
  StumbleBackwards: 0.00785,
};
