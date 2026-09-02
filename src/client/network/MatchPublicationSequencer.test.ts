import { describe, expect, it } from 'vitest';
import type {
  MatchEventPublication,
  MatchSnapshotPublication,
  MatchStartedPublication
} from '../../shared/gameplayTransport.js';
import type { GameEvent, MatchSnapshot } from '../../shared/model.js';
import { createMatchPublicationSequencer } from './MatchPublicationSequencer.js';

const snapshot = (tick = 1): MatchSnapshot => ({
  tick,
  phase: 'REGULATION',
  remainingMs: 10_000,
  platformProgress: 0,
  settings: { durationMs: 120_000, knockoutTarget: 5 },
  scores: {},
  network: {},
  players: [],
  pulses: [],
  winnerPlayerId: null,
  resultReason: null
});

const started = (overrides: Partial<MatchStartedPublication> = {}): MatchStartedPublication => ({
  matchEpoch: 1,
  eventCursor: 0,
  snapshot: snapshot(),
  ...overrides
});

const event = (eventId: number): GameEvent => ({
  eventId,
  tick: eventId,
  type: 'PHASE',
  phase: 'REGULATION',
  remainingMs: 10_000
});

const eventPublication = (matchEpoch: number, value: GameEvent): MatchEventPublication => ({
  matchEpoch,
  event: value
});

const snapshotPublication = (
  matchEpoch: number,
  value = snapshot()
): MatchSnapshotPublication => ({
  matchEpoch,
  eventCursor: 0,
  snapshot: value
});

function createHarness() {
  const publishedStarts: MatchSnapshot[] = [];
  const publishedSnapshots: MatchSnapshot[] = [];
  const publishedEvents: GameEvent[] = [];
  const gapCallbacks: (() => void)[] = [];
  const clearedTimers: number[] = [];
  const timers = new Map<number, () => void>();
  let nextTimerId = 1;

  const sequencer = createMatchPublicationSequencer({
    onStarted: (value) => publishedStarts.push(value),
    onSnapshot: (value) => publishedSnapshots.push(value),
    onEvent: (value) => publishedEvents.push(value),
    onTransportGap: () => gapCallbacks.push(() => undefined),
    setTimeoutFn: ((callback: () => void, delay: number) => {
      expect(delay).toBe(2_000);
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    }) as typeof window.setTimeout,
    clearTimeoutFn: ((id: number) => {
      clearedTimers.push(id);
      timers.delete(id);
    }) as typeof window.clearTimeout
  });

  return {
    sequencer,
    publishedStarts,
    publishedSnapshots,
    publishedEvents,
    gapCallbacks,
    clearedTimers,
    timers,
    runTimers: () => {
      for (const [id, callback] of [...timers]) {
        timers.delete(id);
        callback();
      }
    }
  };
}

describe('match publication sequencer', () => {
  it('publishes duplicate start safety copies only once', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));

    expect(harness.publishedStarts).toHaveLength(1);
  });

  it('orders event 2 before event 1 across different sources', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
    harness.sequencer.acceptEvent(eventPublication(4, event(2)));
    harness.sequencer.acceptEvent(eventPublication(4, event(1)));

    expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([1, 2]);
  });

  it('never regresses current-epoch snapshots arriving with ticks 0, 2, 1', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, snapshot: snapshot(0) }));
    harness.sequencer.acceptSnapshot(snapshotPublication(4, snapshot(2)));
    harness.sequencer.acceptSnapshot(snapshotPublication(4, snapshot(1)));

    expect([
      ...harness.publishedStarts,
      ...harness.publishedSnapshots
    ].map((value) => value.tick)).toEqual([0, 2]);
  });

  it('retains only the highest-tick future snapshot before its start', () => {
    const harness = createHarness();

    harness.sequencer.acceptSnapshot(snapshotPublication(5, snapshot(8)));
    harness.sequencer.acceptSnapshot(snapshotPublication(5, snapshot(3)));
    harness.sequencer.acceptStarted(started({ matchEpoch: 5, snapshot: snapshot(0) }));

    expect(harness.publishedSnapshots.map((value) => value.tick)).toEqual([8]);
  });

  it('resets snapshot tick ordering for a newer rematch epoch', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, snapshot: snapshot(20) }));
    harness.sequencer.acceptSnapshot(snapshotPublication(4, snapshot(21)));
    harness.sequencer.acceptStarted(started({ matchEpoch: 5, snapshot: snapshot(0) }));
    harness.sequencer.acceptSnapshot(snapshotPublication(5, snapshot(1)));
    harness.sequencer.acceptSnapshot(snapshotPublication(5, snapshot(0)));

    expect(harness.publishedStarts.map((value) => value.tick)).toEqual([20, 0]);
    expect(harness.publishedSnapshots.map((value) => value.tick)).toEqual([21, 1]);
  });

  it('waits for matching start before publishing a snapshot or event', () => {
    const harness = createHarness();

    harness.sequencer.acceptSnapshot(snapshotPublication(4, snapshot(4)));
    harness.sequencer.acceptEvent(eventPublication(4, event(1)));

    expect(harness.publishedSnapshots).toHaveLength(0);
    expect(harness.publishedEvents).toHaveLength(0);

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));

    expect(harness.publishedStarts).toHaveLength(1);
    expect(harness.publishedSnapshots.map((value) => value.tick)).toEqual([4]);
    expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([1]);
  });

  it('rejects stale epochs after a newer start and resets for a rematch', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
    harness.sequencer.acceptEvent(eventPublication(4, event(1)));
    harness.sequencer.acceptStarted(started({ matchEpoch: 5, eventCursor: 0 }));
    harness.sequencer.acceptEvent(eventPublication(4, event(2)));
    harness.sequencer.acceptSnapshot(snapshotPublication(4, snapshot(40)));
    harness.sequencer.acceptEvent(eventPublication(5, event(1)));

    expect(harness.publishedStarts).toHaveLength(2);
    expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([1, 1]);
    expect(harness.publishedSnapshots).toHaveLength(0);
  });

  it('retains only the active start marker across rematch churn without weakening epoch barriers', () => {
    const NativeSet = globalThis.Set;
    const observedSets: Set<unknown>[] = [];

    class ObservedSet<T> extends NativeSet<T> {
      constructor(values?: readonly T[] | null) {
        super(values);
        observedSets.push(this as Set<unknown>);
      }
    }

    globalThis.Set = ObservedSet as SetConstructor;
    try {
      const harness = createHarness();

      for (let matchEpoch = 1; matchEpoch <= 1_024; matchEpoch += 1) {
        harness.sequencer.acceptStarted(started({ matchEpoch }));
      }

      expect(observedSets).toHaveLength(1);
      expect(observedSets[0]?.size).toBe(1);

      harness.sequencer.acceptStarted(started({ matchEpoch: 1 }));
      harness.sequencer.acceptEvent(eventPublication(1_025, event(1)));

      expect(harness.publishedStarts).toHaveLength(1_024);
      expect(harness.publishedEvents).toHaveLength(0);

      harness.sequencer.acceptStarted(started({ matchEpoch: 1_025 }));

      expect(harness.publishedStarts).toHaveLength(1_025);
      expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([1]);
      expect(observedSets[0]?.size).toBe(1);
    } finally {
      globalThis.Set = NativeSet;
    }
  });

  it('waits for a newer epoch start and uses its non-zero event cursor', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 3 }));
    harness.sequencer.acceptEvent(eventPublication(5, event(5)));
    harness.sequencer.acceptSnapshot(snapshotPublication(5, snapshot(5)));

    expect(harness.publishedEvents).toHaveLength(0);
    expect(harness.publishedSnapshots).toHaveLength(0);

    harness.sequencer.acceptStarted(started({ matchEpoch: 5, eventCursor: 5 }));
    harness.sequencer.acceptEvent(eventPublication(5, event(5)));
    harness.sequencer.acceptEvent(eventPublication(5, event(6)));

    expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([6]);
    expect(harness.publishedSnapshots.map((value) => value.tick)).toEqual([5]);
  });

  it('does not publish a future-epoch event before its matching start', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
    harness.sequencer.acceptEvent(eventPublication(5, event(1)));

    expect(harness.publishedEvents).toHaveLength(0);

    harness.sequencer.acceptStarted(started({ matchEpoch: 5, eventCursor: 0 }));

    expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([1]);
  });

  it('admits an active epoch gap event when another epoch fills the buffer cap', () => {
    const harness = createHarness();

    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
    for (let eventId = 1_001; eventId <= 1_256; eventId += 1) {
      harness.sequencer.acceptEvent(eventPublication(5, event(eventId)));
    }

    harness.sequencer.acceptEvent(eventPublication(4, event(1)));

    expect(harness.publishedEvents.map((value) => value.eventId)).toEqual([1]);
  });

  it('calls the transport-gap fallback after an unresolved two-second gap', () => {
    const harness = createHarness();

    harness.sequencer.acceptEvent(eventPublication(4, event(2)));
    expect(harness.gapCallbacks).toHaveLength(0);

    harness.runTimers();

    expect(harness.gapCallbacks).toHaveLength(1);
  });

  it('caps buffered events at 256 until the missing event arrives', () => {
    const harness = createHarness();

    for (let eventId = 2; eventId <= 258; eventId += 1) {
      harness.sequencer.acceptEvent(eventPublication(4, event(eventId)));
    }
    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));
    harness.sequencer.acceptEvent(eventPublication(4, event(1)));

    expect(harness.publishedEvents).toHaveLength(256);
    expect(harness.publishedEvents.at(-1)?.eventId).toBe(256);
  });

  it('disposes idempotently by clearing timers and buffered publications', () => {
    const harness = createHarness();

    harness.sequencer.acceptEvent(eventPublication(4, event(2)));
    harness.sequencer.acceptSnapshot(snapshotPublication(4));
    harness.sequencer.dispose();
    harness.sequencer.dispose();
    harness.runTimers();
    harness.sequencer.acceptStarted(started({ matchEpoch: 4, eventCursor: 0 }));

    expect(harness.clearedTimers).toHaveLength(1);
    expect(harness.gapCallbacks).toHaveLength(0);
    expect(harness.publishedStarts).toHaveLength(0);
    expect(harness.publishedSnapshots).toHaveLength(0);
    expect(harness.publishedEvents).toHaveLength(0);
  });
});
