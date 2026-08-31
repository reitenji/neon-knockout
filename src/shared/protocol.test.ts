import { describe, expect, it } from 'vitest';
import type { Ack, MatchSnapshot, RoomState } from './model.js';
import * as protocol from './protocol.js';
import type { ClientToServerEvents } from './protocol.js';
import { ACCENTS, ARENA, CHASSIS, GAME } from './constants.js';

const acknowledgedReadyHandler: ClientToServerEvents['lobby:ready'] = (_payload, acknowledge) => {
  acknowledge({ ok: true, data: null });
};

describe('shared input boundary protocol', () => {
  it('accepts normalized combat input and rejects invalid axes or legacy directional buttons', () => {
    expect(protocol.roomCreateSchema.parse({ name: 'Ada' })).toEqual({ name: 'Ada' });
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 7,
        moveX: 1,
        moveY: 0,
        aimX: 0.6,
        aimY: -0.8,
        quick: true,
        heavy: false,
        dash: false
      }).success
    ).toBe(true);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 7,
        moveX: 1,
        moveY: 0,
        aimX: 0.6,
        aimY: -0.8,
        quick: true,
        heavy: false,
        dash: false,
        mouseX: 200
      }).success
    ).toBe(false);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 8,
        moveX: 1.01,
        moveY: 0,
        aimX: 1,
        aimY: 0,
        quick: false,
        heavy: false,
        dash: false
      }).success
    ).toBe(false);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 8,
        up: true,
        down: false,
        left: false,
        right: false,
        dash: false
      }).success
    ).toBe(false);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 8,
        moveX: Number.NaN,
        moveY: 0,
        aimX: 1,
        aimY: 0,
        quick: false,
        heavy: false,
        dash: false
      }).success
    ).toBe(false);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 8,
        moveX: 0,
        moveY: 0,
        aimX: Number.POSITIVE_INFINITY,
        aimY: 0,
        quick: false,
        heavy: false,
        dash: false
      }).success
    ).toBe(false);
  });

  it('normalizes valid room codes and rejects invalid codes for join and resume', () => {
    expect(protocol.roomJoinSchema.parse({ name: 'Ada', roomCode: ' ab2z ' })).toEqual({
      name: 'Ada',
      roomCode: 'AB2Z'
    });
    expect(protocol.sessionResumeSchema.parse({ roomCode: ' ab2z ', resumeToken: 'token' })).toEqual({
      roomCode: 'AB2Z',
      resumeToken: 'token'
    });
    expect(protocol.roomJoinSchema.safeParse({ name: 'Ada', roomCode: 'O0I1' }).success).toBe(false);
    expect(protocol.sessionResumeSchema.safeParse({ roomCode: 'bad!', resumeToken: 'token' }).success).toBe(false);
  });

  it('uses a strict chassis selection payload', () => {
    expect(CHASSIS).toEqual(['RIFT', 'BASTION', 'PULSE', 'WRAITH']);
    expect(protocol.lobbyChassisSchema.parse({ chassis: 'RIFT' })).toEqual({ chassis: 'RIFT' });
    expect(protocol.lobbyChassisSchema.safeParse({ chassis: 'RIFT', ignored: true }).success).toBe(false);
    expect(protocol.lobbyChassisSchema.safeParse({ chassis: 'MAGE' }).success).toBe(false);
  });

  it('acknowledges state-changing lobby actions', () => {
    let acknowledgement: Ack<null> | undefined;

    acknowledgedReadyHandler({ ready: true }, (value) => {
      acknowledgement = value;
    });

    expect(acknowledgement).toEqual({ ok: true, data: null });
  });

  it('serializes stable room and match snapshots', () => {
    const room: RoomState = {
      roomCode: 'AB2Z',
      phase: 'MATCH',
      hostPlayerId: 'p1',
      pauseRemainingMs: null,
      result: null,
      players: [
        {
          playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0, ready: true, connected: true,
          reconnectRemainingMs: null,
          stats: { knockouts: 1, falls: 0, landedHits: 2, completedAttacks: 3 }
        }
      ]
    };
    const snapshot: MatchSnapshot = {
      tick: 42,
      phase: 'REGULATION',
      remainingMs: GAME.regulationMs,
      platformProgress: 0,
      scores: { p1: 1 },
      players: [
        {
          playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0,
          position: { x: 640, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, overload: 8,
          lastProcessedInputSeq: 7,
          action: { kind: 'QUICK_1', phase: 'ACTIVE', comboStep: 1, chargeMs: 0 },
          dashRemainingMs: 0, dashCooldownRemainingMs: 0, hitstunRemainingMs: 0, respawnRemainingMs: 0,
          protectionRemainingMs: 0,
          stats: { knockouts: 1, falls: 0, landedHits: 2, completedAttacks: 3 }
        }
      ],
      winnerPlayerId: null,
      resultReason: null
    };

    expect(JSON.parse(JSON.stringify(room))).toEqual(room);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('exports the approved cadence, protection, palette, and arena geometry', () => {
    expect(GAME).toMatchObject({
      tickRate: 60, snapshotRate: 30, regulationMs: 120_000, targetScore: 5, minPlayers: 2,
      maxInputFramesPerSecond: 60, inputRateLimitPerSecond: 90,
      knockoutToControlMs: 700, respawnProtectionMs: 650
    });
    expect(ACCENTS).toHaveLength(8);
    expect(ARENA.regulationVertices).toHaveLength(8);
    expect(ARENA.minimumVertices).toHaveLength(8);
    expect(ARENA.spawnAnchors).toHaveLength(8);
    expect(ARENA.regulationVertices[0]).toEqual({ x: 230, y: 90 });
    expect(ARENA.minimumVertices[0]).toEqual({ x: 330, y: 150 });
    expect(ARENA.spawnAnchors[0]).toEqual({ x: 640, y: 190 });
  });
});
