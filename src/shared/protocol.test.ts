import { describe, expect, it } from 'vitest';
import type { Ack } from './model';
import * as protocol from './protocol';
import type { ClientToServerEvents } from './protocol';

const acknowledgedReadyHandler: ClientToServerEvents['lobby:ready'] = (_payload, acknowledge) => {
  acknowledge({ ok: true, data: null });
};

describe('shared input boundary protocol', () => {
  it('accepts normalized combat input payloads and rejects the legacy button shape', () => {
    expect(protocol.roomCreateSchema.parse({ name: 'Ada' })).toEqual({ name: 'Ada' });
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 2,
        moveX: 0.8,
        moveY: -0.6,
        aimX: 1,
        aimY: 0,
        quick: true,
        heavy: false,
        dash: false
      }).success
    ).toBe(true);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 2,
        up: true,
        down: false,
        left: false,
        right: false,
        dash: false
      }).success
    ).toBe(false);
    expect(
      protocol.matchInputSchema.safeParse({
        seq: 2,
        moveX: Number.NaN,
        moveY: 0,
        aimX: 1,
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

  it('exposes chassis selection instead of legacy team selection', () => {
    expect('lobbyChassisSchema' in protocol).toBe(true);
    expect('lobbyTeamSchema' in protocol).toBe(false);
    expect(
      (protocol as Record<string, { parse: (value: unknown) => unknown }>).lobbyChassisSchema.parse({
        chassis: 'RIFT'
      })
    ).toEqual({ chassis: 'RIFT' });
  });

  it('acknowledges state-changing lobby actions', () => {
    let acknowledgement: Ack<null> | undefined;

    acknowledgedReadyHandler({ ready: true }, (value) => {
      acknowledgement = value;
    });

    expect(acknowledgement).toEqual({ ok: true, data: null });
  });
});
