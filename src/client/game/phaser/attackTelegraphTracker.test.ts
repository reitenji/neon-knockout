import { describe, expect, it } from 'vitest';

import type { MatchAction, MatchPlayer } from '../../../shared/model.js';
import { AttackTelegraphTracker } from './attackTelegraphTracker.js';

const idleAction: MatchAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
};

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p1',
    name: 'Ada',
    chassis: 'RIFT',
    accent: 0,
    position: { x: 300, y: 360 },
    velocity: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    overload: 0,
    lastProcessedInputSeq: 0,
    action: idleAction,
    dashRemainingMs: 0,
    dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0,
    respawnRemainingMs: 0,
    protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

describe('AttackTelegraphTracker', () => {
  it('keeps a provisional local quick sweep visible while authoritative acknowledgement is still in windup', () => {
    const tracker = new AttackTelegraphTracker();
    const previous = player();
    const windupAcknowledged = player({
      action: {
        ...idleAction,
        kind: 'QUICK_1',
        phase: 'WINDUP',
        attackId: 14,
        profileId: 'quick-1',
        lockedFacing: { x: 0, y: -1 }
      }
    });

    tracker.telegraph(
      'p1',
      previous,
      previous,
      { ...idleAction, kind: 'QUICK_1', phase: 'WINDUP', comboStep: 1 },
      { x: 0, y: -1 },
      0,
      true
    );
    const telegraph = tracker.telegraph(
      'p1',
      previous,
      windupAcknowledged,
      null,
      { x: 0, y: -1 },
      80,
      true
    );

    expect(telegraph).toEqual(expect.objectContaining({
      profileId: 'quick-1',
      facing: { x: 0, y: -1 },
      active: true
    }));
    expect((telegraph as { currentProgress: number; previousProgress: number }).currentProgress)
      .toBeGreaterThan((telegraph as { previousProgress: number }).previousProgress);
  });

  it('keeps a provisional local heavy-release sweep visible while authoritative acknowledgement is still in windup', () => {
    const tracker = new AttackTelegraphTracker();
    const previous = player({ action: { ...idleAction, chargeMs: 340, charging: true } });
    const windupAcknowledged = player({
      action: {
        ...idleAction,
        kind: 'HEAVY',
        phase: 'WINDUP',
        chargeMs: 340,
        attackId: 15,
        profileId: 'heavy-melee',
        lockedFacing: { x: -1, y: 0 }
      }
    });

    tracker.telegraph(
      'p1',
      previous,
      previous,
      { ...idleAction, kind: 'HEAVY', phase: 'WINDUP', chargeMs: 340, lockedFacing: { x: -1, y: 0 } },
      { x: 0, y: -1 },
      0,
      true
    );
    const telegraph = tracker.telegraph(
      'p1',
      previous,
      windupAcknowledged,
      null,
      { x: 0, y: -1 },
      150,
      true
    );

    expect(telegraph).toEqual(expect.objectContaining({
      profileId: 'heavy-melee',
      facing: { x: -1, y: 0 },
      active: true
    }));
    expect((telegraph as { currentProgress: number; previousProgress: number }).currentProgress)
      .toBeGreaterThan((telegraph as { previousProgress: number }).previousProgress);
  });
});
