import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAME } from '../../shared/constants.js';
import { createGameServer } from './createGameServer.js';

type ScheduledTimeout = Readonly<{
  callback: () => void;
  delayMs: number;
  handle: ReturnType<typeof setTimeout>;
}>;

describe('createGameServer low-jitter scheduling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('anchors future room advances to monotonic tick deadlines after callback work and delayed turns', async () => {
    let clockMs = 0;
    let nextHandleId = 1;
    const scheduled: ScheduledTimeout[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => clockMs);
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay) => {
      const handle = { id: nextHandleId++ } as unknown as ReturnType<typeof setTimeout>;
      scheduled.push({ callback: callback as () => void, delayMs: Number(delay), handle });
      return handle;
    });
    vi.spyOn(globalThis, 'clearTimeout').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'setInterval').mockImplementation(() =>
      ({ id: nextHandleId++ }) as unknown as ReturnType<typeof setInterval>);
    vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    const server = createGameServer({ host: '127.0.0.1', port: 0, clientDirectory: false });
    const elapsed: number[] = [];
    vi.spyOn(server.rooms, 'advance').mockImplementation((elapsedMs) => {
      elapsed.push(elapsedMs);
      clockMs += 5;
    });

    try {
      await server.start();
      const stepMs = 1_000 / GAME.tickRate;

      expect(scheduled).toHaveLength(1);
      expect(scheduled[0]?.delayMs).toBeCloseTo(stepMs, 8);

      clockMs = 20;
      scheduled[0]!.callback();
      expect(elapsed).toEqual([20]);
      expect(scheduled).toHaveLength(2);
      expect(scheduled[1]?.delayMs).toBeCloseTo(stepMs * 2 - 25, 8);

      clockMs = 70;
      scheduled[1]!.callback();
      expect(elapsed).toEqual([20, 50]);
      expect(scheduled).toHaveLength(3);
      expect(scheduled[2]?.delayMs).toBeCloseTo(stepMs * 5 - 75, 8);

      const staleCallback = scheduled[2]!.callback;
      await server.stop();
      clockMs = 100;
      staleCallback();
      expect(elapsed).toEqual([20, 50]);
      expect(scheduled).toHaveLength(3);
    } finally {
      await server.stop();
    }
  });

  it('dispatches a match publication without adding another event-loop turn', () => {
    const deferredCallbacks: Array<() => void> = [];
    vi.spyOn(globalThis, 'setImmediate').mockImplementation((callback) => {
      deferredCallbacks.push(callback);
      return { id: deferredCallbacks.length } as unknown as ReturnType<typeof setImmediate>;
    });
    vi.spyOn(globalThis, 'clearImmediate').mockImplementation(() => undefined);
    const server = createGameServer({ clientDirectory: false });

    const matchRoom = server.rooms.createRoom('host-socket', 'Grace');
    server.rooms.joinRoom('guest-socket', matchRoom.roomCode, 'Linus');
    server.rooms.setReady('host-socket', true);
    server.rooms.setReady('guest-socket', true);
    const deferredBeforeStart = deferredCallbacks.length;
    server.rooms.startMatch('host-socket');

    expect(deferredCallbacks).toHaveLength(deferredBeforeStart + 1);
  });
});
