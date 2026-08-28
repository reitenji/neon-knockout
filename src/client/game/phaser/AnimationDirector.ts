import { GAME } from '../../../shared/constants.js';
import type { MatchAction, MatchPlayer } from '../../../shared/model.js';
import {
  animationPlanFor,
  blendPoses,
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
  if (action.kind === 'QUICK_1') return 'quick-1';
  if (action.kind === 'QUICK_2') return 'quick-2';
  if (action.kind === 'QUICK_3') return 'quick-3';
  if (action.kind === 'HEAVY') return action.phase === 'WINDUP' ? 'heavy-charge' : 'heavy-release';
  if (action.kind === 'DASH' || player.dashRemainingMs > 0) return 'dash';

  if (player.protectionRemainingMs > 0) return 'protected';
  return player.velocity.x * player.velocity.x + player.velocity.y * player.velocity.y > 144
    ? 'move'
    : 'idle';
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
    const state = animationStateFor(player, predictedAction, reconnectWarp);

    if (!runtime) {
      const plan = animationPlanFor(state, this.reducedMotion);
      const initialPose = poseAt(plan, 0);
      runtime = { state, plan, startedAtMs: nowMs, transitionFrom: null, lastPose: initialPose };
      this.runtimes.set(target, runtime);
    } else if (runtime.state !== state) {
      const plan = animationPlanFor(state, this.reducedMotion);
      runtime = {
        state,
        plan,
        startedAtMs: nowMs,
        transitionFrom: plan.transitionMs > 0 ? runtime.lastPose : null,
        lastPose: plan.transitionMs > 0 ? runtime.lastPose : poseAt(plan, 0)
      };
      this.runtimes.set(target, runtime);
    }

    const elapsedMs = Math.max(0, nowMs - runtime.startedAtMs);
    const authoredPose = poseAt(runtime.plan, elapsedMs);
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
