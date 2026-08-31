import { GAME } from '../../../shared/constants.js';
import type { MatchAction, MatchPlayer } from '../../../shared/model.js';
import {
  animationPlanFor,
  blendPoses,
  chargePoseAt,
  heavyReleasePlanFrom,
  poseAt,
  type FighterAnimationName,
  type FighterAnimationPlan,
  type FighterPose
} from './animationPlan.js';

export interface FighterAnimationTarget {
  applyAnimationPose(pose: FighterPose, state: FighterAnimationName): void;
}

export type AnimatedMatchPlayer = MatchPlayer & Readonly<{
  reconnectRemainingMs?: number | null;
}>;

type AnimationRuntime = {
  state: FighterAnimationName;
  plan: FighterAnimationPlan;
  startedAtMs: number;
  transitionFrom: FighterPose | null;
  lastPose: FighterPose;
  attackId: number | null;
};

function animationStateFor(
  player: AnimatedMatchPlayer,
  predictedAction: MatchAction | null,
  reconnectWarp: boolean
): FighterAnimationName {
  if ((player.reconnectRemainingMs ?? 0) > 0 || reconnectWarp) return 'reconnect';
  if (player.respawnRemainingMs > 0 || player.action.kind === 'RESPAWNING') {
    return player.respawnRemainingMs > animationPlanFor('respawn', false).durationMs
      ? 'knockout'
      : 'respawn';
  }
  if (player.hitstunRemainingMs > 0 || player.action.kind === 'HITSTUN') return 'hit';

  const action = predictedAction ?? player.action;
  if (action.charging) return 'heavy-charge';
  if (action.kind === 'QUICK_1') return 'quick-1';
  if (action.kind === 'QUICK_2') return 'quick-2';
  if (action.kind === 'QUICK_3') return 'quick-3';
  if (action.kind === 'HEAVY') return 'heavy-release';
  if (action.kind === 'DASH' || player.dashRemainingMs > 0) return 'dash';

  if (player.protectionRemainingMs > 0) return 'protected';
  return player.velocity.x * player.velocity.x + player.velocity.y * player.velocity.y > 144
    ? 'move'
    : 'idle';
}

function attackIdFor(action: MatchAction): number | null {
  return action.kind === 'QUICK_1' || action.kind === 'QUICK_2' ||
    action.kind === 'QUICK_3' || action.kind === 'HEAVY'
    ? action.attackId
    : null;
}

function planFor(
  state: FighterAnimationName,
  action: MatchAction,
  reducedMotion: boolean
): FighterAnimationPlan {
  return state === 'heavy-release'
    ? heavyReleasePlanFrom(action.chargeMs, reducedMotion)
    : animationPlanFor(state, reducedMotion);
}

export class AnimationDirector {
  private readonly runtimes = new WeakMap<FighterAnimationTarget, AnimationRuntime>();

  constructor(private readonly reducedMotion: boolean) {}

  apply(
    player: AnimatedMatchPlayer,
    target: FighterAnimationTarget,
    nowMs: number,
    predictedAction: MatchAction | null = null
  ): FighterAnimationName {
    let runtime = this.runtimes.get(target);
    const reconnectWarp = player.respawnRemainingMs > 0 &&
      player.respawnRemainingMs <= GAME.reconnectWarpMs &&
      (!runtime || (runtime.state !== 'knockout' && runtime.state !== 'respawn'));
    let state = animationStateFor(player, predictedAction, reconnectWarp);
    const action = predictedAction ?? player.action;
    const attackId = attackIdFor(action);
    const keepsPredictedRelease = runtime?.state === 'heavy-release' &&
      runtime.attackId === null &&
      predictedAction === null &&
      nowMs - runtime.startedAtMs < runtime.plan.durationMs &&
      (state === 'heavy-charge' || state === 'idle' || state === 'move' || state === 'protected');
    if (keepsPredictedRelease) state = 'heavy-release';

    if (!runtime) {
      const plan = planFor(state, action, this.reducedMotion);
      const initialPose = state === 'heavy-charge'
        ? chargePoseAt(action.chargeMs, this.reducedMotion)
        : poseAt(plan, 0);
      runtime = { state, plan, startedAtMs: nowMs, transitionFrom: null, lastPose: initialPose, attackId };
      this.runtimes.set(target, runtime);
    } else if (
      runtime.state !== state ||
      (attackId !== null && runtime.attackId !== null && runtime.attackId !== attackId)
    ) {
      const plan = planFor(state, action, this.reducedMotion);
      runtime = {
        state,
        plan,
        startedAtMs: nowMs,
        transitionFrom: plan.transitionMs > 0 ? runtime.lastPose : null,
        lastPose: plan.transitionMs > 0 ? runtime.lastPose : poseAt(plan, 0),
        attackId
      };
      this.runtimes.set(target, runtime);
    } else if (attackId !== null && runtime.attackId === null) {
      runtime.attackId = attackId;
    }

    const elapsedMs = Math.max(0, nowMs - runtime.startedAtMs);
    const authoredPose = runtime.state === 'heavy-charge'
      ? chargePoseAt(action.chargeMs, this.reducedMotion)
      : poseAt(runtime.plan, elapsedMs);
    const transitionProgress = runtime.plan.transitionMs > 0
      ? elapsedMs / runtime.plan.transitionMs
      : 1;
    const nextPose = runtime.transitionFrom && transitionProgress < 1
      ? blendPoses(runtime.transitionFrom, authoredPose, transitionProgress)
      : authoredPose;

    runtime.lastPose = nextPose;
    if (transitionProgress >= 1) runtime.transitionFrom = null;
    target.applyAnimationPose(nextPose, state);
    return state;
  }

  forget(target: FighterAnimationTarget): void {
    this.runtimes.delete(target);
  }
}
