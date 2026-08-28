import { describe, expect, it } from 'vitest';
import type { InputFrame, MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import {
  INTERPOLATION_DELAY_MS,
  REMOTE_SNAP_DISTANCE,
  PredictionBuffer,
  SnapshotTimeline,
  interpolateRemotePlayer
} from './prediction.js';

const idleAction = { kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0 } as const;

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p-1', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, overload: 0,
    lastProcessedInputSeq: -1, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

function frame(seq: number, overrides: Partial<InputFrame> = {}): InputFrame {
  return { seq, moveX: 0, moveY: 0, aimX: 1, aimY: 0, quick: false, heavy: false, dash: false, ...overrides };
}

function snapshot(tick: number, players: readonly MatchPlayer[]): MatchSnapshot {
  return {
    tick, phase: 'REGULATION', remainingMs: 100_000, platformProgress: 0,
    scores: Object.fromEntries(players.map((value) => [value.playerId, 0])), players,
    winnerPlayerId: null, resultReason: null
  };
}

describe('PredictionBuffer', () => {
  it('replays unacknowledged movement through shared kinematics and reconciles position, velocity, and facing', () => {
    const prediction = new PredictionBuffer('p-1');
    const canonical = player();
    const first = prediction.predict(frame(0, { moveX: 1, aimX: 0, aimY: -1 }), canonical, 16);
    const second = prediction.predict(frame(1, { moveX: 1, aimX: 0, aimY: -1 }), canonical, 16);

    expect(second.position.x).toBeGreaterThan(first.position.x);
    expect(second.velocity.x).toBeGreaterThan(first.velocity.x);
    expect(second.facing).toEqual({ x: 0, y: -1 });

    const reconciled = prediction.reconcile(player({ lastProcessedInputSeq: 0 }), 16);
    expect(prediction.pendingSequences()).toEqual([1]);
    expect(reconciled.position.x).toBeGreaterThan(100);
    expect(reconciled.facing).toEqual({ x: 0, y: -1 });
  });

  it('predicts only local action starts and never invents hit, knockout, overload, or score state', () => {
    const prediction = new PredictionBuffer('p-1');
    const presentation = prediction.predict(frame(0, { quick: true }), player(), 16);
    expect(presentation.actionStart).toEqual({ kind: 'QUICK_1', phase: 'WINDUP', comboStep: 1, chargeMs: 0 });
    expect(presentation).not.toHaveProperty('scores');
    expect(presentation).not.toHaveProperty('overload');
    expect(presentation).not.toHaveProperty('hit');
    expect(presentation).not.toHaveProperty('knockout');
  });

  it('starts local heavy-charge presentation while the right button is held without predicting an outcome', () => {
    const prediction = new PredictionBuffer('p-1');
    const presentation = prediction.predict(frame(0, { heavy: true }), player(), 100);
    expect(presentation.actionStart).toEqual({ kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: 100 });
    expect(presentation).not.toHaveProperty('scores');
    expect(presentation).not.toHaveProperty('hit');
  });

  it('keeps a predicted quick committed so a following dash is not predicted', () => {
    const prediction = new PredictionBuffer('p-1');
    const canonical = player({ position: { x: 640, y: 360 } });

    expect(prediction.predict(frame(0, { quick: true }), canonical, 16).actionStart?.kind).toBe('QUICK_1');
    const afterQuick = prediction.predict(frame(1, { dash: true }), canonical, 16);

    expect(afterQuick.actionStart).toBeNull();
    expect(afterQuick.velocity.x).not.toBe(760);
  });

  it('accumulates held heavy across frames and slows movement only after the entry threshold', () => {
    const prediction = new PredictionBuffer('p-1');
    const canonical = player({ position: { x: 640, y: 360 } });

    const belowThreshold = prediction.predict(frame(0, { moveX: 1, heavy: true }), canonical, 100);
    const atThreshold = prediction.predict(frame(1, { moveX: -1, heavy: true }), canonical, 80);

    expect(belowThreshold.velocity.x).toBe(240);
    expect(atThreshold.actionStart?.chargeMs).toBe(180);
    expect(atThreshold.velocity.x).toBeCloseTo(134.4, 5);
  });

  it('lets dash cancel an uncommitted heavy charge and restarts charge from zero after dash', () => {
    const prediction = new PredictionBuffer('p-1');
    const canonical = player({ position: { x: 640, y: 360 } });

    prediction.predict(frame(0, { heavy: true }), canonical, 100);
    const dash = prediction.predict(frame(1, { heavy: true, dash: true }), canonical, 16);
    const restartedCharge = prediction.predict(frame(2, { heavy: true }), canonical, 140);

    expect(dash.actionStart?.kind).toBe('DASH');
    expect(restartedCharge.actionStart).toEqual({
      kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: 140
    });
  });

  it('commits heavy on release after the threshold and blocks a following dash', () => {
    const prediction = new PredictionBuffer('p-1');
    const canonical = player({ position: { x: 640, y: 360 } });

    prediction.predict(frame(0, { heavy: true }), canonical, 100);
    prediction.predict(frame(1, { heavy: true }), canonical, 80);
    const release = prediction.predict(frame(2), canonical, 16);
    const afterRelease = prediction.predict(frame(3, { dash: true }), canonical, 16);

    expect(release.actionStart).toEqual({
      kind: 'HEAVY', phase: 'WINDUP', comboStep: 0, chargeMs: 180
    });
    expect(afterRelease.actionStart).toBeNull();
    expect(afterRelease.velocity.x).not.toBe(760);
  });

  it('does not predict dash or attack starts while canonical state forbids acting', () => {
    const blockedPlayers = [
      player({ dashCooldownRemainingMs: 100 }),
      player({ dashRemainingMs: 100, velocity: { x: 760, y: 0 } }),
      player({ hitstunRemainingMs: 100, action: { ...idleAction, kind: 'HITSTUN' } }),
      player({ respawnRemainingMs: 100, action: { ...idleAction, kind: 'RESPAWNING' } }),
      player({ action: { kind: 'QUICK_1', phase: 'ACTIVE', comboStep: 1, chargeMs: 0 } })
    ];

    for (const blocked of blockedPlayers) {
      const prediction = new PredictionBuffer('p-1');
      const result = prediction.predict(
        frame(0, { moveX: 1, quick: true, heavy: true, dash: true }),
        blocked,
        16
      );
      expect(result.actionStart, blocked.action.kind ?? 'COOLDOWN').toBeNull();
    }
  });

  it('advances canonical dash cooldown before allowing a later fresh dash edge', () => {
    const prediction = new PredictionBuffer('p-1');
    const coolingDown = player({ position: { x: 640, y: 360 }, dashCooldownRemainingMs: 20 });

    expect(prediction.predict(frame(0, { dash: true }), coolingDown, 16).actionStart).toBeNull();
    expect(prediction.predict(frame(1), coolingDown, 16).actionStart).toBeNull();
    const started = prediction.predict(frame(2, { dash: true }), coolingDown, 16);

    expect(started.actionStart).toEqual({ kind: 'DASH', phase: 'ACTIVE', comboStep: 0, chargeMs: 0 });
    expect(started.velocity.x).toBe(760);
  });

  it('uses reduced steering and outward void pull when predicting outside the contracted platform', () => {
    const prediction = new PredictionBuffer('p-1');
    const outside = player({ position: { x: 640, y: 50 }, facing: { x: 1, y: 0 } });

    const result = prediction.predict(frame(0, { moveX: 1 }), outside, 100, 0);

    expect(result.velocity.x).toBeCloseTo(108, 5);
    expect(result.velocity.y).toBeCloseTo(-36, 5);
    expect(result.position).toEqual({ x: 650.8, y: 46.4 });
  });

  it('never predicts movement past a respawn timer without a canonical spawn snapshot', () => {
    const prediction = new PredictionBuffer('p-1');
    const respawning = player({
      position: { x: 640, y: 360 },
      respawnRemainingMs: 10,
      action: { ...idleAction, kind: 'RESPAWNING' }
    });

    expect(prediction.predict(frame(0, { moveX: 1 }), respawning, 16).position).toEqual({ x: 640, y: 360 });
    expect(prediction.predict(frame(1, { moveX: 1 }), respawning, 16).position).toEqual({ x: 640, y: 360 });
  });
});

describe('SnapshotTimeline', () => {
  it('renders remote snapshots seventy milliseconds behind receipt time', () => {
    const timeline = new SnapshotTimeline();
    const previous = snapshot(1, [player({ position: { x: 100, y: 100 } })]);
    const current = snapshot(2, [player({ position: { x: 200, y: 100 } })]);
    timeline.push(previous, 1_000);
    timeline.push(current, 1_100);
    const sampled = timeline.sample(1_000 + INTERPOLATION_DELAY_MS + 50)!;
    expect(sampled.previous).toBe(previous);
    expect(sampled.current).toBe(current);
    expect(sampled.alpha).toBe(0.5);
    expect(INTERPOLATION_DELAY_MS).toBe(70);
  });

  it('interpolates the outer remote position but snaps above the named threshold', () => {
    const previous = player({ position: { x: 100, y: 100 } });
    const nearby = player({ position: { x: 140, y: 120 } });
    expect(interpolateRemotePlayer(previous, nearby, 0.5)).toEqual({ x: 120, y: 110 });
    const far = player({ position: { x: 100 + REMOTE_SNAP_DISTANCE + 1, y: 100 } });
    expect(interpolateRemotePlayer(previous, far, 0.1)).toEqual(far.position);
  });
});
