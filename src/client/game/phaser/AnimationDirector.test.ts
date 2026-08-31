import { describe, expect, it } from 'vitest';
import { GAME } from '../../../shared/constants.js';
import type { MatchAction, MatchPlayer } from '../../../shared/model.js';
import { AnimationDirector, type FighterAnimationTarget } from './AnimationDirector.js';
import type { FighterAnimationName, FighterPose } from './animationPlan.js';

const idleAction: MatchAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
};

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 640, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
    overload: 0, lastProcessedInputSeq: 0, action: idleAction,
    dashRemainingMs: 0, dashCooldownRemainingMs: 0, hitstunRemainingMs: 0,
    respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

function action(overrides: Partial<MatchAction>): MatchAction {
  return { ...idleAction, ...overrides };
}

class RecordingTarget implements FighterAnimationTarget {
  readonly states: FighterAnimationName[] = [];
  readonly poses: FighterPose[] = [];

  applyAnimationPose(pose: FighterPose, state: FighterAnimationName): void {
    this.poses.push(pose);
    this.states.push(state);
  }
}

describe('AnimationDirector', () => {
  it('keeps elapsed progress when a duplicate movement snapshot arrives', () => {
    const director = new AnimationDirector(false);
    const target = new RecordingTarget();
    const moving = player({ velocity: { x: 180, y: 0 } });

    director.apply(moving, target, 1_000);
    director.apply(moving, target, 1_105);

    expect(target.states).toEqual(['move', 'move']);
    expect(target.poses[1]).not.toEqual(target.poses[0]);
    expect(target.poses[1]).toMatchObject({ bodyX: 2.4, bodyRotation: -0.035 });
  });

  it('chains combo steps without an idle pose between them', () => {
    const director = new AnimationDirector(false);
    const target = new RecordingTarget();
    const first = player({ action: action({ kind: 'QUICK_1', phase: 'ACTIVE', comboStep: 1 }) });
    const second = player({ action: action({ kind: 'QUICK_2', phase: 'WINDUP', comboStep: 2 }) });

    director.apply(first, target, 0);
    director.apply(first, target, 120);
    director.apply(second, target, 121);

    expect(target.states).toEqual(['quick-1', 'quick-1', 'quick-2']);
    expect(target.poses.at(-1)).not.toMatchObject({
      bodyX: 0, bodyY: 0, bodyRotation: 0, leftArmAngle: -0.08, rightArmAngle: 0.08
    });
  });

  it('starts a predicted local attack on the next rendered frame', () => {
    const director = new AnimationDirector(false);
    const target = new RecordingTarget();

    director.apply(player(), target, 0);
    const state = director.apply(
      player(),
      target,
      16,
      action({ kind: 'QUICK_1', phase: 'WINDUP', comboStep: 1 })
    );

    expect(state).toBe('quick-1');
    expect(target.states).toEqual(['idle', 'quick-1']);
  });

  it('returns from knockout to an authored respawn and then control within 700ms', () => {
    const director = new AnimationDirector(false);
    const target = new RecordingTarget();

    expect(director.apply(player({
      action: action({ kind: 'RESPAWNING' }),
      respawnRemainingMs: GAME.knockoutToControlMs
    }), target, 0)).toBe('knockout');
    expect(director.apply(player({
      action: action({ kind: 'RESPAWNING' }),
      respawnRemainingMs: 439
    }), target, 261)).toBe('respawn');
    expect(director.apply(player(), target, GAME.knockoutToControlMs)).toBe('idle');
  });

  it('uses the 180ms reconnect entry without restarting it on duplicate snapshots', () => {
    const director = new AnimationDirector(false);
    const target = new RecordingTarget();
    const reconnecting = player({
      action: action({ kind: 'RESPAWNING' }),
      respawnRemainingMs: GAME.reconnectWarpMs
    });

    director.apply(player(), target, 400);
    expect(director.apply(reconnecting, target, 500)).toBe('reconnect');
    expect(director.apply(player({
      action: action({ kind: 'RESPAWNING' }),
      respawnRemainingMs: 90
    }), target, 590)).toBe('reconnect');
    expect(target.poses[2]).not.toEqual(target.poses[1]);
    expect(director.apply(player(), target, 680)).toBe('idle');
  });

  it('cancels the protection pose as soon as an attack is predicted', () => {
    const director = new AnimationDirector(false);
    const target = new RecordingTarget();
    const protectedPlayer = player({ protectionRemainingMs: 600 });

    expect(director.apply(protectedPlayer, target, 0)).toBe('protected');
    expect(director.apply(
      protectedPlayer,
      target,
      16,
      action({ kind: 'QUICK_1', phase: 'WINDUP', comboStep: 1 })
    )).toBe('quick-1');
  });
});
