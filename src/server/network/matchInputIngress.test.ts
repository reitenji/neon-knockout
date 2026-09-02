import { describe, expect, it, vi } from 'vitest';
import { GAME } from '../../shared/constants.js';
import type { InputFrame, MatchSnapshot, SessionWelcome } from '../../shared/model.js';
import { RoomManager, type RoomPublication } from '../rooms/roomManager.js';
import { createMatchInputIngress } from './matchInputIngress.js';

const input = (overrides: Partial<InputFrame> = {}): InputFrame => ({
  seq: 0,
  moveX: 0,
  moveY: 0,
  aimX: 1,
  aimY: 0,
  quick: false,
  heavy: false,
  dash: false,
  ...overrides
});

function player(snapshot: MatchSnapshot, playerId: string) {
  const value = snapshot.players.find((candidate) => candidate.playerId === playerId);
  if (!value) throw new Error(`Missing player ${playerId} in authoritative snapshot.`);
  return value;
}

function fixture(startMatch = true): {
  rooms: RoomManager;
  host: SessionWelcome;
  snapshot: () => MatchSnapshot;
} {
  const publications: RoomPublication[] = [];
  let randomByte = 0;
  const rooms = new RoomManager({
    now: () => 0,
    randomBytes: (size) => new Uint8Array(size).fill(randomByte++),
    publish: (publication) => publications.push(publication)
  });
  const host = rooms.createRoom('host-socket', 'Ada');
  rooms.joinRoom('guest-socket', host.roomCode, 'Linus');
  const snapshot = (): MatchSnapshot => {
    const publication = [...publications].reverse().find(
      (candidate): candidate is Extract<RoomPublication, { type: 'MATCH_STARTED' | 'MATCH_SNAPSHOT' }> =>
        (candidate.type === 'MATCH_STARTED' || candidate.type === 'MATCH_SNAPSHOT') && candidate.roomCode === host.roomCode
    );
    if (!publication) throw new Error('No match snapshot was published.');
    return publication.snapshot;
  };
  const advanceToMatch = (): void => {
    for (let step = 0; step < 60; step += 1) rooms.advance(50);
  };

  if (startMatch) {
    rooms.setReady('host-socket', true);
    rooms.setReady('guest-socket', true);
    rooms.startMatch('host-socket');
    advanceToMatch();
  }

  return { rooms, host, snapshot };
}

function finishMatch(subject: ReturnType<typeof fixture>): void {
  const guest = subject.snapshot().players.find((candidate) => candidate.playerId !== subject.host.playerId);
  if (!guest) throw new Error('Missing guest player.');
  for (let knockout = 0; knockout < GAME.targetScore; knockout += 1) {
    subject.rooms.forceKnockout(subject.host.roomCode, subject.host.playerId, guest.playerId);
    if (knockout < GAME.targetScore - 1) {
      for (let step = 0; step < 14; step += 1) subject.rooms.advance(50);
    }
  }
}

describe('MatchInputIngress', () => {
  it('returns INVALID_PAYLOAD for malformed input without reaching the room manager', () => {
    const { rooms } = fixture();
    const ingress = createMatchInputIngress({
      connectionId: 'host-socket', rooms, now: () => 0, logger: { error: vi.fn() }
    });

    expect(ingress.accept({ seq: 7 }, 'websocket')).toEqual({
      status: 'error',
      error: { code: 'INVALID_PAYLOAD', message: 'İstek verisi geçersiz.', recoverable: true }
    });
  });

  it('accepts each increasing input sequence once and drops duplicates or lower sequences', () => {
    const subject = fixture();
    const ingress = createMatchInputIngress({
      connectionId: 'host-socket', rooms: subject.rooms, now: () => 0, logger: { error: vi.fn() }
    });

    expect(ingress.accept(input({ seq: 7 }), 'websocket')).toEqual({ status: 'accepted' });
    expect(ingress.accept(input({ seq: 7 }), 'webrtc')).toEqual({ status: 'dropped' });
    expect(ingress.accept(input({ seq: 6 }), 'webrtc')).toEqual({ status: 'dropped' });
    subject.rooms.advance(50);

    expect(player(subject.snapshot(), subject.host.playerId).lastProcessedInputSeq).toBe(7);
  });

  it('silently drops input after the match enters the result phase', () => {
    const subject = fixture();
    const logger = { error: vi.fn() };
    const ingress = createMatchInputIngress({ connectionId: 'host-socket', rooms: subject.rooms, now: () => 0, logger });
    finishMatch(subject);

    expect(ingress.accept(input({ seq: 7 }), 'websocket')).toEqual({ status: 'dropped' });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('silently drops frames that exceed the accepted input bucket', () => {
    const subject = fixture();
    const ingress = createMatchInputIngress({ connectionId: 'host-socket', rooms: subject.rooms, now: () => 0, logger: { error: vi.fn() } });
    for (let seq = 0; seq < GAME.maxInputFramesPerSecond; seq += 1) {
      expect(ingress.accept(input({ seq }), 'websocket')).toEqual({ status: 'accepted' });
    }
    expect(ingress.accept(input({ seq: GAME.maxInputFramesPerSecond }), 'websocket')).toEqual({ status: 'dropped' });
  });

  it('silently drops frames that exceed the incoming input bucket before the accepted bucket', () => {
    const subject = fixture();
    const ingress = createMatchInputIngress({ connectionId: 'host-socket', rooms: subject.rooms, now: () => 0, logger: { error: vi.fn() } });

    expect(ingress.accept(input({ seq: 0 }), 'websocket')).toEqual({ status: 'accepted' });
    for (let attempt = 1; attempt < GAME.inputRateLimitPerSecond; attempt += 1) {
      expect(ingress.accept(input({ seq: 0 }), 'websocket')).toEqual({ status: 'dropped' });
    }

    expect(ingress.accept(input({ seq: 1 }), 'websocket')).toEqual({ status: 'dropped' });
  });

  it('maps a room domain failure to a safe server error', () => {
    const subject = fixture(false);
    const ingress = createMatchInputIngress({
      connectionId: 'host-socket', rooms: subject.rooms, now: () => 0, logger: { error: vi.fn() }
    });

    expect(ingress.accept(input({ seq: 7 }), 'websocket')).toEqual({
      status: 'error',
      error: { code: 'INVALID_PHASE', message: 'Bu işlem şu anda kullanılamaz.', recoverable: true }
    });
  });

  it('resets ingress state without bypassing the room manager sequence guard', () => {
    const subject = fixture();
    const ingress = createMatchInputIngress({
      connectionId: 'host-socket', rooms: subject.rooms, now: () => 0, logger: { error: vi.fn() }
    });
    expect(ingress.accept(input({ seq: 7 }), 'websocket')).toEqual({ status: 'accepted' });
    subject.rooms.advance(50);

    ingress.reset();
    expect(ingress.accept(input({ seq: 0 }), 'websocket')).toEqual({ status: 'accepted' });
    subject.rooms.advance(50);

    expect(player(subject.snapshot(), subject.host.playerId).lastProcessedInputSeq).toBe(7);
  });

  it('records only accepted input with its exact gameplay transport source', () => {
    const subject = fixture();
    const onAccepted = vi.fn();
    const ingress = createMatchInputIngress({
      connectionId: 'host-socket', rooms: subject.rooms, now: () => 0,
      logger: { error: vi.fn() }, onAccepted
    });

    expect(ingress.accept(input({ seq: 21 }), 'webrtc')).toEqual({ status: 'accepted' });
    expect(ingress.accept(input({ seq: 21 }), 'websocket')).toEqual({ status: 'dropped' });
    expect(ingress.accept(input({ seq: 22 }), 'websocket')).toEqual({ status: 'accepted' });

    expect(onAccepted).toHaveBeenCalledTimes(2);
    expect(onAccepted).toHaveBeenNthCalledWith(1, input({ seq: 21 }), 'webrtc');
    expect(onAccepted).toHaveBeenNthCalledWith(2, input({ seq: 22 }), 'websocket');
  });
});
