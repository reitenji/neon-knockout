import { describe, expect, it } from 'vitest';
import type { Ack } from './model';
import { matchInputSchema, roomCreateSchema, roomJoinSchema, sessionResumeSchema } from './protocol';
import type { ClientToServerEvents } from './protocol';

const acknowledgedReadyHandler: ClientToServerEvents['lobby:ready'] = (_payload, acknowledge) => {
  acknowledge({ ok: true, data: null });
};

describe('shared input boundary protocol', () => {
  it('rejects client-owned position and non-boolean buttons', () => {
    expect(roomCreateSchema.parse({ name: 'Ada' })).toEqual({ name: 'Ada' });
    expect(matchInputSchema.safeParse({ seq: 2, up: true, down: false, left: false, right: false, dash: false, x: 999 }).success).toBe(false);
    expect(matchInputSchema.safeParse({ seq: 2, up: 1, down: false, left: false, right: false, dash: false }).success).toBe(false);
  });

  it('normalizes valid room codes and rejects invalid codes for join and resume', () => {
    expect(roomJoinSchema.parse({ name: 'Ada', roomCode: ' ab2z ' })).toEqual({ name: 'Ada', roomCode: 'AB2Z' });
    expect(sessionResumeSchema.parse({ roomCode: ' ab2z ', resumeToken: 'token' })).toEqual({ roomCode: 'AB2Z', resumeToken: 'token' });
    expect(roomJoinSchema.safeParse({ name: 'Ada', roomCode: 'O0I1' }).success).toBe(false);
    expect(sessionResumeSchema.safeParse({ roomCode: 'bad!' , resumeToken: 'token' }).success).toBe(false);
  });

  it('acknowledges state-changing lobby actions', () => {
    let acknowledgement: Ack<null> | undefined;

    acknowledgedReadyHandler({ ready: true }, (value) => {
      acknowledgement = value;
    });

    expect(acknowledgement).toEqual({ ok: true, data: null });
  });
});
