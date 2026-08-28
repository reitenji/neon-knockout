import { describe, expect, it } from 'vitest';
import type { RoomState } from '../../shared/model.js';
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

function roomManagerFixture(): {
  manager: RoomManager;
  clock: FakeClock;
  bytes: DeterministicBytes;
  publications: RoomPublication[];
  roomState: (roomCode: string) => RoomState;
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
  return { manager, clock, bytes, publications, roomState };
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

function startTwoPlayerRoom(fixture: ReturnType<typeof roomManagerFixture>): {
  roomCode: string;
  host: ReturnType<RoomManager['createRoom']>;
  guest: ReturnType<RoomManager['joinRoom']>;
} {
  const host = fixture.manager.createRoom('c-1', 'Ada');
  const guest = fixture.manager.joinRoom('c-2', host.roomCode, 'Linus');
  fixture.manager.setReady('c-1', true);
  fixture.manager.setReady('c-2', true);
  fixture.manager.startMatch('c-1');
  return { roomCode: host.roomCode, host, guest };
}

describe('RoomManager', () => {
  it('retries four-character room-code collisions', () => {
    const { manager, bytes } = roomManagerFixture();
    bytes.queue(4, [0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1]);

    expect(manager.createRoom('c-1', 'Ada').roomCode).toBe('AAAA');
    expect(manager.createRoom('c-2', 'Linus').roomCode).toBe('BBBB');
  });

  it('counts reconnect reservations toward capacity, restores identity, and expires the renewed reservation', () => {
    const { manager, clock } = roomManagerFixture();
    const host = manager.createRoom('c-1', 'Ada');
    const joined = Array.from({ length: 7 }, (_, index) =>
      manager.joinRoom(`c-${index + 2}`, host.roomCode, `P${index + 2}`)
    );

    manager.disconnect('c-8');
    expectErrorCode(() => manager.joinRoom('c-9', host.roomCode, 'Ninth'), 'ROOM_FULL');
    const resumed = manager.resume('c-10', host.roomCode, joined[6].resumeToken);
    expect(resumed).toMatchObject({ playerId: joined[6].playerId, resumed: true });

    manager.disconnect('c-10');
    clock.advance(20_001);
    manager.advance(0);
    expect(manager.joinRoom('c-9', host.roomCode, 'Ninth').roomCode).toBe(host.roomCode);
    expectErrorCode(() => manager.resume('c-11', host.roomCode, joined[6].resumeToken), 'INVALID_RESUME_TOKEN');
  });

  it('alternates tied assignments, ignores reservations for balance, and permits only balanced switches', () => {
    const { manager, roomState } = roomManagerFixture();
    const host = manager.createRoom('c-1', 'Ada');
    manager.joinRoom('c-2', host.roomCode, 'P2');
    manager.joinRoom('c-3', host.roomCode, 'P3');
    manager.joinRoom('c-4', host.roomCode, 'P4');
    manager.joinRoom('c-5', host.roomCode, 'P5');
    expect(roomState(host.roomCode).players.map((player) => player.team)).toEqual([
      'CYAN',
      'AMBER',
      'AMBER',
      'CYAN',
      'CYAN'
    ]);

    expectErrorCode(() => manager.setTeam('c-2', 'CYAN'), 'UNBALANCED_TEAM');
    manager.setTeam('c-5', 'AMBER');
    expect(roomState(host.roomCode).players.find((player) => player.name === 'P5')?.team).toBe('AMBER');

    manager.disconnect('c-4');
    manager.joinRoom('c-6', host.roomCode, 'P6');
    expect(roomState(host.roomCode).players.find((player) => player.name === 'P6')?.team).toBe('CYAN');
  });

  it('does not consume a tied team assignment when a join name is invalid', () => {
    const { manager, roomState } = roomManagerFixture();
    const host = manager.createRoom('c-1', 'Ada');
    manager.joinRoom('c-2', host.roomCode, 'Linus');

    expectErrorCode(() => manager.joinRoom('c-3', host.roomCode, 'A'), 'INVALID_NAME');
    manager.joinRoom('c-4', host.roomCode, 'Grace');

    expect(roomState(host.roomCode).players.find((player) => player.name === 'Grace')?.team).toBe('AMBER');
  });

  it('migrates host permanently and keeps the resumed former host as a member', () => {
    const { manager, roomState } = roomManagerFixture();
    const first = manager.createRoom('c-1', 'Ada');
    const second = manager.joinRoom('c-2', first.roomCode, 'Linus');

    manager.disconnect('c-1');
    expect(roomState(first.roomCode).hostPlayerId).toBe(second.playerId);
    manager.resume('c-3', first.roomCode, first.resumeToken);
    expect(roomState(first.roomCode).hostPlayerId).toBe(second.playerId);
  });

  it('removes stale connection mappings immediately and after reservation expiry', () => {
    const { manager, clock } = roomManagerFixture();
    const first = manager.createRoom('c-1', 'Ada');
    manager.disconnect('c-1');
    expect(manager.createRoom('c-1', 'Linus').roomCode).not.toBe(first.roomCode);

    clock.advance(20_001);
    manager.advance(0);
    expectErrorCode(() => manager.setReady('missing', true), 'PLAYER_NOT_FOUND');
  });

  it('does not replay an input queued by a disconnected connection after resume', () => {
    const fixture = roomManagerFixture();
    const { roomCode, host } = startTwoPlayerRoom(fixture);
    const started = fixture.publications.find(
      (publication): publication is Extract<RoomPublication, { type: 'MATCH_STARTED' }> =>
        publication.type === 'MATCH_STARTED'
    );
    const initialX = started?.snapshot.players.find((player) => player.playerId === host.playerId)?.position.x;
    expect(initialX).toBeDefined();

    fixture.manager.applyInput('c-1', {
      seq: 1,
      up: false,
      down: false,
      left: false,
      right: true,
      dash: false
    });
    fixture.manager.disconnect('c-1');
    fixture.manager.resume('c-3', roomCode, host.resumeToken);
    for (let index = 0; index < 61; index += 1) fixture.manager.advance(50);

    const latest = [...fixture.publications].reverse().find(
      (publication): publication is Extract<RoomPublication, { type: 'MATCH_SNAPSHOT' }> =>
        publication.type === 'MATCH_SNAPSHOT'
    );
    expect(latest?.snapshot.players.find((player) => player.playerId === host.playerId)?.position.x).toBe(initialX);
  });

  it('enforces player count, populated teams, readiness, and host ownership before start', () => {
    const single = roomManagerFixture();
    single.manager.createRoom('single-host', 'Ada');
    single.manager.setReady('single-host', true);
    expectErrorCode(() => single.manager.startMatch('single-host'), 'NOT_ENOUGH_PLAYERS');

    const normal = roomManagerFixture();
    const host = normal.manager.createRoom('c-1', 'Ada');
    normal.manager.joinRoom('c-2', host.roomCode, 'Linus');
    expectErrorCode(() => normal.manager.startMatch('c-2'), 'NOT_HOST');
    expectErrorCode(() => normal.manager.startMatch('c-1'), 'NOT_READY');

    const oneTeam = roomManagerFixture();
    const first = oneTeam.manager.createRoom('c-1', 'Ada');
    oneTeam.manager.joinRoom('c-2', first.roomCode, 'Linus');
    oneTeam.manager.joinRoom('c-3', first.roomCode, 'Grace');
    oneTeam.manager.disconnect('c-1');
    oneTeam.manager.setReady('c-2', true);
    oneTeam.manager.setReady('c-3', true);
    expectErrorCode(() => oneTeam.manager.startMatch('c-2'), 'UNBALANCED_TEAM');
  });

  it('starts a ready room and rejects new joins during countdown', () => {
    const { manager, publications, roomState } = roomManagerFixture();
    const host = manager.createRoom('c-1', 'Ada');
    manager.joinRoom('c-2', host.roomCode, 'Linus');
    manager.joinRoom('c-3', host.roomCode, 'Reserved');
    manager.disconnect('c-3');
    manager.setReady('c-1', true);
    manager.setReady('c-2', true);

    manager.startMatch('c-1');

    expect(roomState(host.roomCode).phase).toBe('COUNTDOWN');
    expect(publications.some((event) => event.type === 'MATCH_STARTED')).toBe(true);
    expectErrorCode(() => manager.joinRoom('c-3', host.roomCode, 'Grace'), 'MATCH_IN_PROGRESS');
    expectErrorCode(() => manager.setReady('c-1', true), 'INVALID_PHASE');
    for (let index = 0; index < 60; index += 1) manager.advance(50);
    expect(roomState(host.roomCode).phase).toBe('MATCH');
    expectErrorCode(() => manager.joinRoom('c-3', host.roomCode, 'Grace'), 'MATCH_IN_PROGRESS');
  });

  it('advances at 30 Hz, snapshots at 20 Hz, and discards catch-up beyond five steps', () => {
    const fixture = roomManagerFixture();
    startTwoPlayerRoom(fixture);
    fixture.publications.length = 0;

    for (let index = 0; index < 20; index += 1) fixture.manager.advance(50);
    const paced = fixture.publications.filter(
      (event): event is Extract<RoomPublication, { type: 'MATCH_SNAPSHOT' }> => event.type === 'MATCH_SNAPSHOT'
    );
    expect(paced).toHaveLength(20);
    expect(paced.at(-1)?.snapshot.tick).toBe(30);

    fixture.publications.length = 0;
    fixture.manager.advance(1_000);
    const capped = fixture.publications.filter(
      (event): event is Extract<RoomPublication, { type: 'MATCH_SNAPSHOT' }> => event.type === 'MATCH_SNAPSHOT'
    );
    expect(capped).toHaveLength(5);
    expect(capped.at(-1)?.snapshot.tick).toBe(35);
    fixture.manager.advance(0);
    expect(fixture.publications.filter((event) => event.type === 'MATCH_SNAPSHOT')).toHaveLength(5);
  });

  it('drops a carried core, pauses below two players, resumes, and aborts when grace expires', () => {
    const fixture = roomManagerFixture();
    const { roomCode, host } = startTwoPlayerRoom(fixture);
    for (let index = 0; index < 60; index += 1) fixture.manager.advance(50);
    expect(fixture.roomState(roomCode).phase).toBe('MATCH');

    fixture.manager.applyInput('c-1', {
      seq: 1,
      up: false,
      down: false,
      left: false,
      right: true,
      dash: false
    });
    for (let index = 0; index < 40; index += 1) fixture.manager.advance(50);
    expect(
      fixture.publications.some((publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'PICKUP')
    ).toBe(true);

    fixture.manager.disconnect('c-1');
    expect(
      fixture.publications.some((publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'DROP')
    ).toBe(true);
    expect(
      fixture.publications.some(
        (publication) =>
          publication.type === 'MATCH_EVENT' && publication.event.type === 'PHASE' && publication.event.phase === 'PAUSED'
      )
    ).toBe(true);

    fixture.manager.resume('c-3', roomCode, host.resumeToken);
    expect(
      fixture.publications.some(
        (publication) =>
          publication.type === 'MATCH_EVENT' && publication.event.type === 'PHASE' && publication.event.phase === 'REGULATION'
      )
    ).toBe(true);

    fixture.manager.disconnect('c-3');
    fixture.clock.advance(20_001);
    fixture.manager.advance(0);
    expect(fixture.roomState(roomCode).phase).toBe('LOBBY');
    expect(fixture.roomState(roomCode).players).toHaveLength(1);
  });

  it('waits for the reservation that can still restore two players before aborting', () => {
    const fixture = roomManagerFixture();
    const host = fixture.manager.createRoom('c-1', 'Ada');
    const second = fixture.manager.joinRoom('c-2', host.roomCode, 'Linus');
    fixture.manager.joinRoom('c-3', host.roomCode, 'Grace');
    fixture.manager.setReady('c-1', true);
    fixture.manager.setReady('c-2', true);
    fixture.manager.setReady('c-3', true);
    fixture.manager.startMatch('c-1');
    for (let index = 0; index < 60; index += 1) fixture.manager.advance(50);

    fixture.manager.disconnect('c-3');
    fixture.clock.advance(19_000);
    fixture.manager.disconnect('c-2');
    fixture.clock.advance(1_001);
    fixture.manager.advance(0);

    expect(fixture.roomState(host.roomCode).phase).toBe('MATCH');
    expect(fixture.roomState(host.roomCode).players).toHaveLength(2);
    fixture.manager.resume('c-4', host.roomCode, second.resumeToken);
    expect(fixture.roomState(host.roomCode).players.filter((player) => player.connected)).toHaveLength(2);
  });

  it('keeps an empty room through grace and closes it at the exact deadline', () => {
    const fixture = roomManagerFixture();
    const host = fixture.manager.createRoom('c-1', 'Ada');
    fixture.manager.disconnect('c-1');
    fixture.clock.advance(19_999);
    fixture.manager.advance(0);
    fixture.manager.resume('c-2', host.roomCode, host.resumeToken);
    expect(fixture.publications.some((publication) => publication.type === 'ROOM_CLOSED')).toBe(false);

    fixture.manager.disconnect('c-2');
    fixture.clock.advance(20_000);
    fixture.manager.advance(0);
    expect(
      fixture.publications.some(
        (publication) => publication.type === 'ROOM_CLOSED' && publication.roomCode === host.roomCode
      )
    ).toBe(true);
    expectErrorCode(() => fixture.manager.resume('c-3', host.roomCode, host.resumeToken), 'ROOM_NOT_FOUND');
  });

  it('publishes results, enforces result actions, and resets readiness and match state', () => {
    const fixture = roomManagerFixture();
    const { roomCode } = startTwoPlayerRoom(fixture);
    for (let index = 0; index < 60; index += 1) fixture.manager.advance(50);
    for (let score = 0; score < 7; score += 1) fixture.manager.deliverCore(roomCode, 'CYAN');

    expect(fixture.roomState(roomCode).phase).toBe('RESULT');
    expect(
      fixture.publications.some(
        (publication) => publication.type === 'MATCH_EVENT' && publication.event.type === 'RESULT'
      )
    ).toBe(true);
    expect(fixture.roomState(roomCode).players.find((player) => player.team === 'CYAN')?.stats.deliveries).toBe(7);

    fixture.manager.setResultReady('c-1', true);
    fixture.manager.setResultReady('c-2', true);
    expect(fixture.roomState(roomCode).players.every((player) => player.ready)).toBe(true);
    expectErrorCode(() => fixture.manager.returnToLobby('c-2'), 'NOT_HOST');
    fixture.manager.returnToLobby('c-1');
    expect(fixture.roomState(roomCode).phase).toBe('LOBBY');
    expect(fixture.roomState(roomCode).players.every((player) => !player.ready)).toBe(true);
    expect(fixture.roomState(roomCode).players.map((player) => player.team)).toEqual(['CYAN', 'AMBER']);

    fixture.manager.setReady('c-1', true);
    fixture.manager.setReady('c-2', true);
    fixture.manager.startMatch('c-1');
    const rematch = [...fixture.publications].reverse().find(
      (publication): publication is Extract<RoomPublication, { type: 'MATCH_STARTED' }> =>
        publication.type === 'MATCH_STARTED'
    );
    expect(rematch?.snapshot.score).toEqual({ CYAN: 0, AMBER: 0 });
    expect(rematch?.snapshot.players.every((player) => player.stats.deliveries === 0 && player.stats.tackles === 0)).toBe(true);
  });

  it('keeps the result screen when a migrated host outlives an expired reservation', () => {
    const fixture = roomManagerFixture();
    const { roomCode, guest } = startTwoPlayerRoom(fixture);
    for (let index = 0; index < 60; index += 1) fixture.manager.advance(50);
    for (let score = 0; score < 7; score += 1) fixture.manager.deliverCore(roomCode, 'CYAN');

    fixture.manager.disconnect('c-1');
    expect(fixture.roomState(roomCode).hostPlayerId).toBe(guest.playerId);
    fixture.clock.advance(20_000);
    fixture.manager.advance(0);

    expect(fixture.roomState(roomCode).phase).toBe('RESULT');
    expect(fixture.roomState(roomCode).players.map((player) => player.playerId)).toEqual([guest.playerId]);
    fixture.manager.returnToLobby('c-2');
    expect(fixture.roomState(roomCode).phase).toBe('LOBBY');
  });
});
