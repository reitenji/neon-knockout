import { describe, expect, it } from 'vitest';
import { GAME } from '../../shared/constants.js';
import type { InputFrame, MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import {
  INTERPOLATION_DELAY_MS,
  PredictionBuffer,
  SnapshotTimeline,
  blendPredictedPosition,
  interpolateSnapshot,
  predictInputPosition
} from './prediction.js';

function input(seq: number, overrides: Partial<InputFrame> = {}): InputFrame {
  return {
    seq,
    up: false,
    down: false,
    left: false,
    right: false,
    dash: false,
    ...overrides
  };
}

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p-1',
    name: 'Ada',
    team: 'CYAN',
    position: { x: 100, y: 300 },
    carriedCoreId: null,
    lastProcessedInputSeq: -1,
    dashRemainingMs: 0,
    dashCooldownRemainingMs: 0,
    stunRemainingMs: 0,
    stats: { deliveries: 0, tackles: 0 },
    ...overrides
  };
}

function snapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    tick: 1,
    phase: 'REGULATION',
    remainingMs: 1_000,
    score: { CYAN: 0, AMBER: 0 },
    players: [player(), player({ playerId: 'p-2', team: 'AMBER', position: { x: 220, y: 140 } })],
    cores: [],
    winner: null,
    ...overrides
  };
}

describe('PredictionBuffer', () => {
  it('drops acknowledged input and replays the remaining frames', () => {
    const buffer = new PredictionBuffer('p-1');
    buffer.push(input(1, { right: true }));
    buffer.push(input(2, { right: true }));

    const position = buffer.reconcile(player({ lastProcessedInputSeq: 1 }), 1_000 / GAME.tickRate);

    expect(position.x).toBeGreaterThan(100);
    expect(buffer.pendingSequences()).toEqual([2]);
  });

  it('uses carrier speed, dash scale, stun state, boundaries, and public barrier geometry', () => {
    const stepMs = 100;
    const normal = predictInputPosition(player(), input(1, { right: true }), stepMs);
    const carrying = predictInputPosition(
      player({ carriedCoreId: 'core-1' }),
      input(1, { right: true }),
      stepMs
    );
    const dashing = predictInputPosition(
      player({ dashRemainingMs: GAME.dashMs }),
      input(1, { right: true }),
      stepMs
    );
    const stunned = predictInputPosition(
      player({ stunRemainingMs: GAME.tackleStunMs }),
      input(1, { right: true }),
      stepMs
    );
    const barrier = predictInputPosition(
      player({ position: { x: 330, y: 175 } }),
      input(1, { right: true }),
      1_000
    );

    expect(normal.x - 100).toBeCloseTo(GAME.moveSpeed * 0.1, 3);
    expect(carrying.x - 100).toBeCloseTo(GAME.moveSpeed * GAME.carrierMultiplier * 0.1, 3);
    expect(dashing.x - 100).toBeCloseTo(GAME.moveSpeed * GAME.dashMultiplier * 0.1, 3);
    expect(stunned).toEqual({ x: 100, y: 300 });
    expect(barrier.x).toBeLessThanOrEqual(340);
  });

  it('does not predict a new dash while the authoritative cooldown remains active', () => {
    const coolingDown = player({ dashRemainingMs: 0, dashCooldownRemainingMs: 900 });
    const buffer = new PredictionBuffer('p-1');

    const position = buffer.predict(input(1, { right: true, dash: true }), coolingDown, 100);

    expect(position.x - coolingDown.position.x).toBeCloseTo(GAME.moveSpeed * 0.1, 3);
  });

  it('blends small corrections but snaps divergences at 140 pixels', () => {
    expect(blendPredictedPosition({ x: 120, y: 120 }, { x: 126, y: 126 }, 0.35)).toEqual({
      x: 122.1,
      y: 122.1
    });
    expect(blendPredictedPosition({ x: 0, y: 0 }, { x: 139, y: 0 }, 0.35)).toEqual({
      x: 48.65,
      y: 0
    });
    expect(blendPredictedPosition({ x: 0, y: 0 }, { x: 140, y: 0 }, 0.35)).toEqual({
      x: 140,
      y: 0
    });
  });
});

describe('snapshot interpolation', () => {
  it('samples remote motion against the explicit 100 ms render delay', () => {
    const timeline = new SnapshotTimeline();
    const previous = snapshot();
    const current = snapshot({
      tick: 2,
      players: [
        player({ position: { x: 140, y: 300 } }),
        player({ playerId: 'p-2', team: 'AMBER', position: { x: 260, y: 180 } })
      ]
    });
    timeline.push(previous, 1_000);
    timeline.push(current, 1_100);

    const frame = timeline.sample(1_000 + INTERPOLATION_DELAY_MS + 50);
    if (!frame) throw new Error('EXPECTED_INTERPOLATION_FRAME');
    expect(frame.previous).toBe(previous);
    expect(frame.current).toBe(current);
    expect(frame.alpha).toBeCloseTo(0.5, 4);
  });

  it('interpolates remote players while replacing only the local position', () => {
    const result = interpolateSnapshot(
      snapshot(),
      snapshot({
        tick: 2,
        players: [
          player({ position: { x: 140, y: 300 } }),
          player({ playerId: 'p-2', team: 'AMBER', position: { x: 260, y: 180 } })
        ]
      }),
      0.5,
      'p-1',
      { x: 150, y: 310 }
    );

    expect(result.players.find((entry) => entry.playerId === 'p-1')?.position).toEqual({ x: 150, y: 310 });
    expect(result.players.find((entry) => entry.playerId === 'p-2')?.position).toEqual({ x: 240, y: 160 });
  });
});
