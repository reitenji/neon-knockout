import { describe, expect, it } from 'vitest';
import { GAME } from '../../shared/constants.js';
import type { Chassis, InputFrame, MatchSnapshot, RoomState } from '../../shared/model.js';
import { DomainError } from './domainError.js';
import { RoomManager, type RoomPublication } from './roomManager.js';

class FakeClock {
  private value = 1_000;

  readonly now = (): number => this.value;

  advance(elapsedMs: number): void {
    this.value += elapsedMs;
  }
}

class DeterministicBytes {
  private readonly queues = new Map<number, Uint8Array[]>();
  private readonly counters = new Map<number, number>();

  queue(size: number, ...values: number[][]): void {
    this.queues.set(size, values.map((value) => Uint8Array.from(value)));
  }

  readonly next = (size: number): Uint8Array => {
    const queued = this.queues.get(size)?.shift();
    if (queued) return queued;
    const value = this.counters.get(size) ?? 0;
    this.counters.set(size, value + 1);
    return Uint8Array.from({ length: size }, () => value);
  };
}

function fixture(): {
  manager: RoomManager;
  clock: FakeClock;
  bytes: DeterministicBytes;
  publications: RoomPublication[];
  roomState: (roomCode: string) => RoomState;
  snapshot: (roomCode: string) => MatchSnapshot;
} {
  const clock = new FakeClock();
  const bytes = new DeterministicBytes();
  const publications: RoomPublication[] = [];
  const manager = new RoomManager({ now: clock.now, randomBytes: bytes.next, publish: (event) => publications.push(event) });
  const roomState = (roomCode: string): RoomState => {
    const event = [...publications].reverse().find(
      (candidate): candidate is Extract<RoomPublication, { type: 'ROOM_STATE' }> =>
        candidate.type === 'ROOM_STATE' && candidate.roomCode === roomCode
    );
    if (!event) throw new Error(`No room state published for ${roomCode}`);
    return event.state;
  };
  const snapshot = (roomCode: string): MatchSnapshot => {
    const event = [...publications].reverse().find(
      (candidate): candidate is Extract<RoomPublication, { type: 'MATCH_STARTED' | 'MATCH_SNAPSHOT' }> =>
        (candidate.type === 'MATCH_STARTED' || candidate.type === 'MATCH_SNAPSHOT') && candidate.roomCode === roomCode
    );
    if (!event) throw new Error(`No match snapshot published for ${roomCode}`);
    return event.snapshot;
  };
  return { manager, clock, bytes, publications, roomState, snapshot };
}

function expectErrorCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }
}

function readyAndStart(subject: ReturnType<typeof fixture>, playerCount = 2): {
  roomCode: string;
  players: ReturnType<RoomManager['createRoom']>[];
} {
  const host = subject.manager.createRoom('c-1', 'Ada');
  const players = [host];
  for (let index = 2; index <= playerCount; index += 1) {
    players.push(subject.manager.joinRoom(`c-${index}`, host.roomCode, `P${index}`));
  }
  for (let index = 1; index <= playerCount; index += 1) subject.manager.setReady(`c-${index}`, true);
  subject.manager.startMatch('c-1');
  return { roomCode: host.roomCode, players };
}

function advanceCountdown(subject: ReturnType<typeof fixture>): void {
  for (let index = 0; index < 60; index += 1) subject.manager.advance(50);
}

const idleInput = (seq: number): InputFrame => ({
  seq,
  moveX: 0,
  moveY: 0,
  aimX: 1,
  aimY: 0,
  quick: false,
  heavy: false,
  dash: false
});

describe('RoomManager FFA lifecycle', () => {
  it('retries room-code collisions and assigns the lowest unused accent with cycling chassis defaults', () => {
    const subject = fixture();
    subject.bytes.queue(4, [0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1]);

    const firstRoom = subject.manager.createRoom('first', 'Ada');
    expect(firstRoom.roomCode).toBe('AAAA');
    expect(subject.manager.createRoom('second', 'Linus').roomCode).toBe('BBBB');

    for (let index = 2; index <= 8; index += 1) {
      subject.manager.joinRoom(`first-${index}`, firstRoom.roomCode, `P${index}`);
    }
    const state = subject.roomState(firstRoom.roomCode);
    expect(state.players.map((player) => player.accent)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(state.players.map((player) => player.chassis)).toEqual([
      'RIFT', 'BASTION', 'PULSE', 'WRAITH', 'RIFT', 'BASTION', 'PULSE', 'WRAITH'
    ]);

    subject.manager.disconnect('first-3');
    expectErrorCode(() => subject.manager.joinRoom('ninth', firstRoom.roomCode, 'Ninth'), 'ROOM_FULL');
    subject.clock.advance(GAME.reconnectGraceMs);
    subject.manager.advance(0);
    subject.manager.joinRoom('replacement', firstRoom.roomCode, 'Ninth');
    expect(subject.roomState(firstRoom.roomCode).players.at(-1)).toMatchObject({ accent: 2, chassis: 'RIFT' });
  });

  it('validates chassis changes and resets readiness only when the chassis changes', () => {
    const subject = fixture();
    const room = subject.manager.createRoom('c-1', 'Ada');
    subject.manager.setReady('c-1', true);

    subject.manager.setChassis('c-1', 'PULSE');
    expect(subject.roomState(room.roomCode).players[0]).toMatchObject({ chassis: 'PULSE', ready: false });
    subject.manager.setReady('c-1', true);
    subject.manager.setChassis('c-1', 'PULSE');
    expect(subject.roomState(room.roomCode).players[0].ready).toBe(true);
    expectErrorCode(() => subject.manager.setChassis('c-1', 'CORE' as Chassis), 'INVALID_CHASSIS');
  });

  it('starts FFA matches with two through eight connected ready players and enforces host/start rules', () => {
    const single = fixture();
    single.manager.createRoom('single', 'Ada');
    single.manager.setReady('single', true);
    expectErrorCode(() => single.manager.startMatch('single'), 'NOT_ENOUGH_PLAYERS');

    for (const count of [2, 8]) {
      const subject = fixture();
      const host = subject.manager.createRoom('c-1', 'Ada');
      for (let index = 2; index <= count; index += 1) {
        subject.manager.joinRoom(`c-${index}`, host.roomCode, `P${index}`);
      }
      expectErrorCode(() => subject.manager.startMatch('c-2'), 'NOT_HOST');
      expectErrorCode(() => subject.manager.startMatch('c-1'), 'NOT_READY');
      for (let index = 1; index <= count; index += 1) subject.manager.setReady(`c-${index}`, true);
      subject.manager.startMatch('c-1');
      expect(subject.roomState(host.roomCode).phase).toBe('COUNTDOWN');
      expect(subject.snapshot(host.roomCode).players).toHaveLength(count);
      expectErrorCode(() => subject.manager.joinRoom('late', host.roomCode, 'Late'), 'MATCH_IN_PROGRESS');
    }
  });

  it('simulates at 60 Hz, publishes at 30 Hz, and keeps only monotonic input', () => {
    const subject = fixture();
    const { roomCode, players } = readyAndStart(subject);
    subject.publications.length = 0;
    subject.manager.applyInput('c-1', idleInput(5));
    subject.manager.applyInput('c-1', { ...idleInput(4), moveX: -1 });

    advanceCountdown(subject);

    const snapshots = subject.publications.filter(
      (publication): publication is Extract<RoomPublication, { type: 'MATCH_SNAPSHOT' }> =>
        publication.type === 'MATCH_SNAPSHOT'
    );
    expect(snapshots).toHaveLength(90);
    expect(snapshots.at(-1)?.snapshot.tick).toBe(180);
    expect(snapshots.at(-1)?.snapshot.players.find((player) => player.playerId === players[0].playerId)?.lastProcessedInputSeq).toBe(5);
    expect(subject.roomState(roomCode).phase).toBe('MATCH');
  });

  it('continues with two connected players and disconnects without score or statistics penalties', () => {
    const subject = fixture();
    const { roomCode, players } = readyAndStart(subject, 3);
    advanceCountdown(subject);
    subject.manager.forceKnockout(roomCode, players[0].playerId, players[1].playerId);
    subject.manager.advance(50);
    const before = subject.manager.debugRoom(roomCode);
    const beforeStats = subject.snapshot(roomCode).players.find((player) => player.playerId === players[1].playerId)?.stats;
    expect(beforeStats?.falls).toBe(1);

    subject.manager.disconnect('c-2');

    expect(subject.manager.debugRoom(roomCode)).toMatchObject({ phase: 'MATCH', connectedCount: 2, reservedCount: 1 });
    expect(subject.manager.debugRoom(roomCode)?.scores).toEqual(before?.scores);
    expect(subject.roomState(roomCode).players.find((player) => player.playerId === players[1].playerId)?.stats).toEqual(beforeStats);
    expect(subject.publications.filter(
      (publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'KNOCKOUT'
    )).toHaveLength(1);
  });

  it('pauses below two, keeps reservation clocks authoritative, and resumes identity at a stable 180 ms warp anchor', () => {
    const subject = fixture();
    const { roomCode, players } = readyAndStart(subject);
    advanceCountdown(subject);
    subject.manager.forceKnockout(roomCode, players[0].playerId, players[1].playerId);
    for (let index = 0; index < 14; index += 1) subject.manager.advance(50);
    const scoreBefore = subject.manager.debugRoom(roomCode)?.scores;
    const statsBefore = subject.snapshot(roomCode).players.find((player) => player.playerId === players[0].playerId)?.stats;

    subject.manager.disconnect('c-1');
    const pausedTick = subject.manager.debugRoom(roomCode)?.tick;
    expect(subject.roomState(roomCode).pauseRemainingMs).toBe(GAME.reconnectGraceMs);
    subject.clock.advance(19_999);
    subject.manager.advance(1_000);
    expect(subject.manager.debugRoom(roomCode)?.tick).toBe(pausedTick);
    expect(subject.roomState(roomCode).players.find((player) => player.playerId === players[0].playerId)?.reconnectRemainingMs).toBe(GAME.reconnectGraceMs);

    expect(subject.manager.resume('c-3', roomCode, players[0].resumeToken)).toMatchObject({
      playerId: players[0].playerId,
      resumed: true
    });
    const warp = subject.snapshot(roomCode).players.find((player) => player.playerId === players[0].playerId);
    expect(warp).toMatchObject({ respawnRemainingMs: GAME.reconnectWarpMs, stats: statsBefore });
    expect(subject.manager.debugRoom(roomCode)?.scores).toEqual(scoreBefore);
    expect(subject.roomState(roomCode).pauseRemainingMs).toBeNull();

    for (let index = 0; index < 4; index += 1) subject.manager.advance(50);
    const restored = subject.snapshot(roomCode).players.find((player) => player.playerId === players[0].playerId);
    const respawn = [...subject.publications].reverse().find(
      (publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'RESPAWN' &&
        publication.event.playerId === players[0].playerId
    );
    expect(restored?.respawnRemainingMs).toBe(0);
    expect(respawn?.type === 'MATCH_EVENT' && respawn.event.type === 'RESPAWN' ? respawn.event.position : null).toEqual(warp?.position);
  });

  it('waits for the last viable opponent reservation before publishing one no-contest result and resetting the lobby', () => {
    const subject = fixture();
    const { roomCode, players } = readyAndStart(subject, 3);
    advanceCountdown(subject);
    subject.manager.forceKnockout(roomCode, players[0].playerId, players[2].playerId);
    subject.manager.disconnect('c-3');
    subject.clock.advance(19_000);
    subject.manager.disconnect('c-2');
    const preserved = subject.roomState(roomCode).players.map(({ playerId, chassis, accent }) => ({ playerId, chassis, accent }));
    subject.publications.length = 0;

    subject.clock.advance(1_000);
    subject.manager.advance(0);
    expect(subject.manager.debugRoom(roomCode)).toMatchObject({ phase: 'MATCH', connectedCount: 1, reservedCount: 1 });
    expect(subject.publications.some(
      (publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'RESULT'
    )).toBe(false);

    subject.clock.advance(19_000);
    subject.manager.advance(0);
    const noContests = subject.publications.filter(
      (publication): publication is Extract<RoomPublication, { type: 'MATCH_EVENT' }> =>
        publication.type === 'MATCH_EVENT' && publication.event.type === 'RESULT' && publication.event.reason === 'NO_CONTEST'
    );
    expect(noContests).toHaveLength(1);
    expect(noContests[0].event.winnerPlayerId).toBeNull();
    expect(subject.roomState(roomCode)).toMatchObject({ phase: 'LOBBY', result: null, pauseRemainingMs: null });
    expect(subject.roomState(roomCode).players.map(({ playerId, chassis, accent }) => ({ playerId, chassis, accent }))).toEqual([
      preserved[0]
    ]);
    expect(subject.roomState(roomCode).players[0].stats).toEqual({ knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 });
    expect(subject.manager.debugRoom(roomCode)?.scores).toBeNull();
  });

  it('migrates the host immediately and never takes ownership back on resume', () => {
    const subject = fixture();
    const first = subject.manager.createRoom('c-1', 'Ada');
    const second = subject.manager.joinRoom('c-2', first.roomCode, 'Linus');

    subject.manager.disconnect('c-1');
    expect(subject.roomState(first.roomCode).hostPlayerId).toBe(second.playerId);
    subject.manager.resume('c-3', first.roomCode, first.resumeToken);
    expect(subject.roomState(first.roomCode).hostPlayerId).toBe(second.playerId);
  });

  it('publishes five forced knockouts, records a player result, and resets only match state for a rematch', () => {
    const subject = fixture();
    const { roomCode, players } = readyAndStart(subject);
    const identities = subject.roomState(roomCode).players.map(({ playerId, chassis, accent }) => ({ playerId, chassis, accent }));
    advanceCountdown(subject);

    for (let knockout = 0; knockout < GAME.targetScore; knockout += 1) {
      subject.manager.forceKnockout(roomCode, players[0].playerId, players[1].playerId);
      if (knockout < GAME.targetScore - 1) {
        for (let index = 0; index < 14; index += 1) subject.manager.advance(50);
      }
    }

    expect(subject.publications.filter(
      (publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'KNOCKOUT'
    )).toHaveLength(GAME.targetScore);
    expect(subject.roomState(roomCode)).toMatchObject({
      phase: 'RESULT',
      result: { winnerPlayerId: players[0].playerId, reason: 'TARGET_SCORE' }
    });
    expect(subject.roomState(roomCode).players.find((player) => player.playerId === players[0].playerId)?.stats.knockouts).toBe(5);
    expect(subject.roomState(roomCode).players.find((player) => player.playerId === players[1].playerId)?.stats.falls).toBe(5);

    subject.manager.setResultReady('c-1', true);
    subject.manager.setResultReady('c-2', true);
    subject.manager.startMatch('c-1');
    expect(subject.roomState(roomCode).players.map(({ playerId, chassis, accent }) => ({ playerId, chassis, accent }))).toEqual(identities);
    expect(subject.snapshot(roomCode)).toMatchObject({
      tick: 0,
      scores: { [players[0].playerId]: 0, [players[1].playerId]: 0 },
      winnerPlayerId: null,
      resultReason: null
    });
    expect(subject.roomState(roomCode).players.every((player) =>
      !player.ready && Object.values(player.stats).every((value) => value === 0)
    )).toBe(true);
  });

  it('returns debug copies without tokens or deadlines and closes an empty room at the exact deadline', () => {
    const subject = fixture();
    const host = subject.manager.createRoom('c-1', 'Ada');
    const debug = subject.manager.debugRoom(host.roomCode);
    expect(debug).toMatchObject({ phase: 'LOBBY', connectedCount: 1, reservedCount: 0, tick: null, scores: null });
    expect(JSON.stringify(debug)).not.toMatch(/token|expires|timestamp/iu);
    (debug?.playerIds as string[]).push('tamper');
    expect(subject.manager.debugRoom(host.roomCode)?.playerIds).toEqual([host.playerId]);

    subject.manager.disconnect('c-1');
    subject.clock.advance(GAME.reconnectGraceMs - 1);
    subject.manager.advance(0);
    expect(subject.manager.debugRoom(host.roomCode)).not.toBeNull();
    subject.clock.advance(1);
    subject.manager.advance(0);
    expect(subject.manager.debugRoom(host.roomCode)).toBeNull();
    expect(subject.publications.filter(
      (publication) => publication.type === 'ROOM_CLOSED' && publication.roomCode === host.roomCode
    )).toHaveLength(1);
  });
});
