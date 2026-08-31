export type FighterAnimationName =
  | 'idle'
  | 'move'
  | 'quick-1'
  | 'quick-2'
  | 'quick-3'
  | 'heavy-charge'
  | 'heavy-release'
  | 'dash'
  | 'hit'
  | 'knockout'
  | 'respawn'
  | 'reconnect'
  | 'protected';

export type FighterPose = Readonly<{
  bodyX: number;
  bodyY: number;
  bodyRotation: number;
  bodyScale: number;
  leftArmAngle: number;
  rightArmAngle: number;
  coreScale: number;
  coreAlpha: number;
  trailIntensity: number;
  artAlpha: number;
}>;

export type FighterKeyframe = Readonly<{ atMs: number; pose: FighterPose }>;

export type FighterAnimationPlan = Readonly<{
  name: FighterAnimationName;
  durationMs: number;
  transitionMs: number;
  loop: boolean;
  keyframes: readonly FighterKeyframe[];
}>;

const NEUTRAL: FighterPose = Object.freeze({
  bodyX: 0,
  bodyY: 0,
  bodyRotation: 0,
  bodyScale: 1,
  leftArmAngle: -0.08,
  rightArmAngle: 0.08,
  coreScale: 1,
  coreAlpha: 0.92,
  trailIntensity: 0,
  artAlpha: 1
});

function pose(overrides: Partial<FighterPose> = {}): FighterPose {
  return Object.freeze({ ...NEUTRAL, ...overrides });
}

function frame(atMs: number, overrides: Partial<FighterPose> = {}): FighterKeyframe {
  return Object.freeze({ atMs, pose: pose(overrides) });
}

function plan(
  name: FighterAnimationName,
  durationMs: number,
  loop: boolean,
  transitionMs: number,
  keyframes: readonly FighterKeyframe[]
): FighterAnimationPlan {
  return Object.freeze({ name, durationMs, loop, transitionMs, keyframes: Object.freeze(keyframes) });
}

const REGULAR_PLANS: Readonly<Record<FighterAnimationName, FighterAnimationPlan>> = Object.freeze({
  idle: plan('idle', 1_200, true, 72, [
    frame(0),
    frame(300, { bodyY: -2.2, bodyRotation: -0.012, leftArmAngle: -0.12, rightArmAngle: 0.05, coreScale: 1.08, coreAlpha: 1 }),
    frame(600, { bodyY: 0, coreScale: 0.96, coreAlpha: 0.78 }),
    frame(900, { bodyY: 2.1, bodyRotation: 0.012, leftArmAngle: -0.04, rightArmAngle: 0.12, coreScale: 1.08, coreAlpha: 1 }),
    frame(1_200)
  ]),
  move: plan('move', 420, true, 68, [
    frame(0, { bodyX: 0, bodyY: 0, bodyRotation: 0.02, leftArmAngle: -0.2, rightArmAngle: 0.17, trailIntensity: 0.18 }),
    frame(105, { bodyX: 2.4, bodyY: -1.5, bodyRotation: -0.035, bodyScale: 1.025, leftArmAngle: 0.12, rightArmAngle: -0.19, coreScale: 1.07, trailIntensity: 0.36 }),
    frame(210, { bodyX: 0, bodyY: 0.6, bodyRotation: 0.02, leftArmAngle: 0.22, rightArmAngle: -0.14, trailIntensity: 0.22 }),
    frame(315, { bodyX: 2.1, bodyY: -1.4, bodyRotation: 0.045, bodyScale: 1.02, leftArmAngle: -0.17, rightArmAngle: 0.2, coreScale: 1.06, trailIntensity: 0.34 }),
    frame(420, { bodyX: 0, bodyY: 0, bodyRotation: 0.02, leftArmAngle: -0.2, rightArmAngle: 0.17, trailIntensity: 0.18 })
  ]),
  'quick-1': plan('quick-1', 230, false, 0, [
    frame(0, { bodyX: -2, bodyRotation: -0.08, leftArmAngle: -0.56, rightArmAngle: 0.22, coreScale: 1.12 }),
    frame(70, { bodyX: 4.5, bodyRotation: 0.12, bodyScale: 1.04, leftArmAngle: 0.72, rightArmAngle: -0.1, coreScale: 1.28, trailIntensity: 0.72 }),
    frame(130, { bodyX: 2, bodyRotation: 0.06, leftArmAngle: 0.42, rightArmAngle: -0.04, trailIntensity: 0.34 }),
    frame(230, { bodyX: -1.2, bodyRotation: -0.045, leftArmAngle: -0.32, rightArmAngle: 0.18, coreScale: 1.04 })
  ]),
  'quick-2': plan('quick-2', 250, false, 0, [
    frame(0, { bodyX: -1.2, bodyRotation: -0.045, leftArmAngle: -0.3, rightArmAngle: 0.28, coreScale: 1.04 }),
    frame(65, { bodyX: 4.8, bodyRotation: -0.13, bodyScale: 1.045, leftArmAngle: 0.08, rightArmAngle: -0.74, coreScale: 1.32, trailIntensity: 0.78 }),
    frame(130, { bodyX: 2.2, bodyRotation: -0.07, leftArmAngle: 0.02, rightArmAngle: -0.4, trailIntensity: 0.36 }),
    frame(250, { bodyX: -1.5, bodyRotation: 0.06, leftArmAngle: -0.38, rightArmAngle: 0.34, coreScale: 1.07 })
  ]),
  'quick-3': plan('quick-3', 390, false, 0, [
    frame(0, { bodyX: -2.5, bodyY: 1, bodyRotation: 0.08, bodyScale: 0.97, leftArmAngle: -0.56, rightArmAngle: 0.5, coreScale: 1.2 }),
    frame(115, { bodyX: 6.5, bodyY: -2, bodyRotation: 0.2, bodyScale: 1.08, leftArmAngle: 0.9, rightArmAngle: -0.82, coreScale: 1.46, coreAlpha: 1, trailIntensity: 1 }),
    frame(185, { bodyX: 4, bodyRotation: -0.11, leftArmAngle: 0.58, rightArmAngle: -0.5, trailIntensity: 0.62 }),
    frame(390, { bodyX: -1.4, bodyRotation: -0.05, leftArmAngle: -0.28, rightArmAngle: 0.26, coreScale: 1.08 })
  ]),
  'heavy-charge': plan('heavy-charge', 700, false, 0, [
    frame(0, { bodyX: -2, bodyScale: 0.98, leftArmAngle: -0.34, rightArmAngle: 0.34, coreScale: 1.1, coreAlpha: 0.78 }),
    frame(350, { bodyX: -4, bodyY: 1.5, bodyRotation: -0.025, bodyScale: 0.94, leftArmAngle: -0.66, rightArmAngle: 0.64, coreScale: 1.55, coreAlpha: 1, trailIntensity: 0.14 }),
    frame(700, { bodyX: -5, bodyY: -1, bodyRotation: 0.025, bodyScale: 0.92, leftArmAngle: -0.78, rightArmAngle: 0.76, coreScale: 1.9, coreAlpha: 1, trailIntensity: 0.22 })
  ]),
  'heavy-release': plan('heavy-release', 520, false, 0, [
    frame(0, { bodyX: -5, bodyScale: 0.92, leftArmAngle: -0.78, rightArmAngle: 0.76, coreScale: 1.9, coreAlpha: 1, trailIntensity: 0.18 }),
    frame(70, { bodyX: 8, bodyY: -1, bodyRotation: 0.16, bodyScale: 1.12, leftArmAngle: 1.02, rightArmAngle: -1.02, coreScale: 1.25, trailIntensity: 1 }),
    frame(160, { bodyX: 5, bodyRotation: -0.08, leftArmAngle: 0.72, rightArmAngle: -0.66, coreScale: 0.92, trailIntensity: 0.7 }),
    frame(520, { bodyX: 0, bodyRotation: 0, leftArmAngle: -0.08, rightArmAngle: 0.08, coreScale: 1 })
  ]),
  dash: plan('dash', 140, false, 0, [
    frame(0, { bodyX: -4, bodyRotation: -0.08, bodyScale: 0.94, leftArmAngle: -0.48, rightArmAngle: 0.48, trailIntensity: 0.42 }),
    frame(40, { bodyX: 7, bodyRotation: 0.04, bodyScale: 1.08, leftArmAngle: -0.64, rightArmAngle: 0.62, coreScale: 1.28, trailIntensity: 1 }),
    frame(105, { bodyX: 4, bodyRotation: 0.02, bodyScale: 1.04, leftArmAngle: -0.5, rightArmAngle: 0.5, trailIntensity: 0.76 }),
    frame(140, { bodyX: 0, trailIntensity: 0.22 })
  ]),
  hit: plan('hit', 180, false, 0, [
    frame(0, { bodyX: 3, bodyRotation: 0.1, bodyScale: 1.05, coreScale: 1.3, coreAlpha: 1 }),
    frame(35, { bodyX: -6, bodyY: 2, bodyRotation: -0.18, bodyScale: 0.91, leftArmAngle: -0.72, rightArmAngle: 0.68, coreScale: 0.72, coreAlpha: 0.45, trailIntensity: 0.58 }),
    frame(95, { bodyX: 2.5, bodyRotation: 0.08, bodyScale: 1.03, coreScale: 1.15, coreAlpha: 1 }),
    frame(180)
  ]),
  knockout: plan('knockout', 260, false, 0, [
    frame(0, { bodyX: -2, bodyRotation: -0.1, bodyScale: 1.02, coreScale: 1.3, coreAlpha: 1, trailIntensity: 0.6 }),
    frame(90, { bodyX: 7, bodyY: 6, bodyRotation: 0.75, bodyScale: 0.84, leftArmAngle: -1.1, rightArmAngle: 1.05, coreScale: 0.72, coreAlpha: 0.5, trailIntensity: 1 }),
    frame(260, { bodyX: 12, bodyY: 12, bodyRotation: 1.7, bodyScale: 0.32, leftArmAngle: -1.35, rightArmAngle: 1.3, coreScale: 0.2, coreAlpha: 0, trailIntensity: 0.18, artAlpha: 0 })
  ]),
  respawn: plan('respawn', 340, false, 0, [
    frame(0, { bodyY: 9, bodyScale: 0.18, leftArmAngle: -0.9, rightArmAngle: 0.9, coreScale: 2, coreAlpha: 0, artAlpha: 0 }),
    frame(70, { bodyY: 5, bodyScale: 0.55, leftArmAngle: -0.5, rightArmAngle: 0.5, coreScale: 1.7, coreAlpha: 1, artAlpha: 0.55 }),
    frame(185, { bodyY: -2, bodyScale: 1.12, leftArmAngle: -0.14, rightArmAngle: 0.14, coreScale: 1.35, coreAlpha: 1, artAlpha: 1 }),
    frame(340)
  ]),
  reconnect: plan('reconnect', 180, false, 0, [
    frame(0, { bodyX: -8, bodyScale: 0.82, leftArmAngle: -0.42, rightArmAngle: 0.42, coreScale: 1.8, coreAlpha: 0, artAlpha: 0 }),
    frame(60, { bodyX: 4, bodyScale: 1.08, coreScale: 1.45, coreAlpha: 1, artAlpha: 0.7, trailIntensity: 0.35 }),
    frame(120, { bodyX: -1.5, bodyScale: 0.98, coreScale: 1.1, coreAlpha: 0.75, artAlpha: 1 }),
    frame(180)
  ]),
  protected: plan('protected', 420, true, 48, [
    frame(0, { coreScale: 1.15, coreAlpha: 0.72, artAlpha: 0.7 }),
    frame(210, { bodyScale: 1.025, coreScale: 1.35, coreAlpha: 1, artAlpha: 0.88 }),
    frame(420, { coreScale: 1.15, coreAlpha: 0.72, artAlpha: 0.7 })
  ])
});

function reducedPlan(name: FighterAnimationName): FighterAnimationPlan {
  const regular = REGULAR_PLANS[name];
  const keyframes = regular.keyframes.map(({ atMs, pose: regularPose }) => frame(atMs, {
    ...regularPose,
    bodyY: name === 'idle' || name === 'protected' ? 0 : regularPose.bodyY * 0.35,
    bodyRotation: regularPose.bodyRotation * 0.55,
    trailIntensity: Math.min(regularPose.trailIntensity * 0.32, 0.32)
  }));
  return plan(name, regular.durationMs, regular.loop, Math.min(regular.transitionMs, 48), keyframes);
}

export function animationPlanFor(
  state: FighterAnimationName,
  reducedMotion: boolean
): FighterAnimationPlan {
  return reducedMotion ? reducedPlan(state) : REGULAR_PLANS[state];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

export function blendPoses(from: FighterPose, to: FighterPose, amount: number): FighterPose {
  const t = clamp(amount, 0, 1);
  return {
    bodyX: lerp(from.bodyX, to.bodyX, t),
    bodyY: lerp(from.bodyY, to.bodyY, t),
    bodyRotation: lerp(from.bodyRotation, to.bodyRotation, t),
    bodyScale: lerp(from.bodyScale, to.bodyScale, t),
    leftArmAngle: lerp(from.leftArmAngle, to.leftArmAngle, t),
    rightArmAngle: lerp(from.rightArmAngle, to.rightArmAngle, t),
    coreScale: lerp(from.coreScale, to.coreScale, t),
    coreAlpha: lerp(from.coreAlpha, to.coreAlpha, t),
    trailIntensity: lerp(from.trailIntensity, to.trailIntensity, t),
    artAlpha: lerp(from.artAlpha, to.artAlpha, t)
  };
}

export function poseAt(plan: FighterAnimationPlan, elapsedMs: number): FighterPose {
  const boundedElapsed = plan.loop
    ? ((Math.max(0, elapsedMs) % plan.durationMs) + plan.durationMs) % plan.durationMs
    : clamp(elapsedMs, 0, plan.durationMs);
  const first = plan.keyframes[0];
  const last = plan.keyframes.at(-1);
  if (!first || !last) return NEUTRAL;
  if (boundedElapsed <= first.atMs) return first.pose;
  if (boundedElapsed >= last.atMs) return last.pose;

  for (let index = 1; index < plan.keyframes.length; index += 1) {
    const next = plan.keyframes[index];
    const previous = plan.keyframes[index - 1];
    if (!next || !previous || boundedElapsed > next.atMs) continue;
    const span = Math.max(1, next.atMs - previous.atMs);
    return blendPoses(previous.pose, next.pose, (boundedElapsed - previous.atMs) / span);
  }
  return last.pose;
}
