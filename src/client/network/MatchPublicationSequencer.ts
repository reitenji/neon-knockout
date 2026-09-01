import type {
  MatchEventPublication,
  MatchSnapshotPublication,
  MatchStartedPublication
} from '../../shared/gameplayTransport.js';
import type { GameEvent, MatchSnapshot } from '../../shared/model.js';

const TRANSPORT_GAP_TIMEOUT_MS = 2_000;
const MAX_BUFFERED_EVENTS = 256;

type SequencerOptions = Readonly<{
  onStarted: (snapshot: MatchSnapshot) => void;
  onSnapshot: (snapshot: MatchSnapshot) => void;
  onEvent: (event: GameEvent) => void;
  onTransportGap: () => void;
  setTimeoutFn?: typeof window.setTimeout;
  clearTimeoutFn?: typeof window.clearTimeout;
}>;

export function createMatchPublicationSequencer(options: SequencerOptions): Readonly<{
  acceptStarted(publication: MatchStartedPublication): void;
  acceptSnapshot(publication: MatchSnapshotPublication): void;
  acceptEvent(publication: MatchEventPublication): void;
  dispose(): void;
}> {
  const setTimeoutFn = options.setTimeoutFn ?? (globalThis.setTimeout as typeof window.setTimeout);
  const clearTimeoutFn = options.clearTimeoutFn ?? (globalThis.clearTimeout as typeof window.clearTimeout);
  const pendingEvents = new Map<number, Map<number, GameEvent>>();
  const pendingSnapshots = new Map<number, MatchSnapshotPublication>();
  const startedEpochs = new Set<number>();
  let activeEpoch: number | null = null;
  let nextEventId = 0;
  let gapTimer: ReturnType<typeof window.setTimeout> | null = null;
  let gapNotified = false;
  let disposed = false;

  function bufferedEventCount(): number {
    let count = 0;
    for (const events of pendingEvents.values()) {
      count += events.size;
    }
    return count;
  }

  function clearStaleEpochs(): void {
    if (activeEpoch === null) {
      return;
    }

    for (const epoch of pendingEvents.keys()) {
      if (epoch < activeEpoch) {
        pendingEvents.delete(epoch);
      }
    }
    for (const epoch of pendingSnapshots.keys()) {
      if (epoch < activeEpoch) {
        pendingSnapshots.delete(epoch);
      }
    }
  }

  function hasUnresolvedGap(): boolean {
    if (activeEpoch === null) {
      return bufferedEventCount() > 0 || pendingSnapshots.size > 0;
    }

    for (const [epoch, events] of pendingEvents) {
      if (epoch > activeEpoch && events.size > 0) {
        return true;
      }
      if (epoch === activeEpoch && events.size > 0 && !events.has(nextEventId)) {
        return true;
      }
    }

    for (const epoch of pendingSnapshots.keys()) {
      if (epoch > activeEpoch) {
        return true;
      }
    }
    return false;
  }

  function refreshGapTimer(): void {
    if (!hasUnresolvedGap()) {
      if (gapTimer !== null) {
        clearTimeoutFn(gapTimer);
        gapTimer = null;
      }
      gapNotified = false;
      return;
    }

    if (gapTimer === null && !gapNotified) {
      gapTimer = setTimeoutFn(() => {
        gapTimer = null;
        if (disposed || !hasUnresolvedGap()) {
          return;
        }
        gapNotified = true;
        options.onTransportGap();
      }, TRANSPORT_GAP_TIMEOUT_MS);
    }
  }

  function publishContiguousEvents(epoch: number): void {
    const events = pendingEvents.get(epoch);
    if (events === undefined) {
      return;
    }

    while (events.has(nextEventId)) {
      const event = events.get(nextEventId);
      events.delete(nextEventId);
      if (event !== undefined) {
        options.onEvent(event);
      }
      nextEventId += 1;
    }

    for (const eventId of events.keys()) {
      if (eventId < nextEventId) {
        events.delete(eventId);
      }
    }
    if (events.size === 0) {
      pendingEvents.delete(epoch);
    }
  }

  function acceptStarted(publication: MatchStartedPublication): void {
    if (disposed || startedEpochs.has(publication.matchEpoch)) {
      return;
    }
    if (activeEpoch !== null && publication.matchEpoch < activeEpoch) {
      return;
    }

    startedEpochs.add(publication.matchEpoch);
    activeEpoch = publication.matchEpoch;
    nextEventId = publication.eventCursor + 1;
    clearStaleEpochs();

    options.onStarted(publication.snapshot);
    if (disposed) {
      return;
    }

    const queuedSnapshot = pendingSnapshots.get(publication.matchEpoch);
    if (queuedSnapshot !== undefined) {
      pendingSnapshots.delete(publication.matchEpoch);
      options.onSnapshot(queuedSnapshot.snapshot);
    }
    publishContiguousEvents(publication.matchEpoch);
    refreshGapTimer();
  }

  function acceptSnapshot(publication: MatchSnapshotPublication): void {
    if (disposed || (activeEpoch !== null && publication.matchEpoch < activeEpoch)) {
      return;
    }

    if (activeEpoch === publication.matchEpoch) {
      options.onSnapshot(publication.snapshot);
      return;
    }

    pendingSnapshots.set(publication.matchEpoch, publication);
    refreshGapTimer();
  }

  function acceptEvent(publication: MatchEventPublication): void {
    if (disposed || (activeEpoch !== null && publication.matchEpoch < activeEpoch)) {
      return;
    }
    if (activeEpoch === publication.matchEpoch && publication.event.eventId < nextEventId) {
      return;
    }

    let events = pendingEvents.get(publication.matchEpoch);
    if (events === undefined) {
      events = new Map<number, GameEvent>();
      pendingEvents.set(publication.matchEpoch, events);
    }
    if (events.has(publication.event.eventId)) {
      return;
    }

    if (bufferedEventCount() >= MAX_BUFFERED_EVENTS) {
      const highestEventId = Math.max(...events.keys());
      if (Number.isFinite(highestEventId) && publication.event.eventId < highestEventId) {
        events.delete(highestEventId);
      } else {
        return;
      }
    }

    events.set(publication.event.eventId, publication.event);
    publishContiguousEvents(publication.matchEpoch);
    refreshGapTimer();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    if (gapTimer !== null) {
      clearTimeoutFn(gapTimer);
      gapTimer = null;
    }
    pendingEvents.clear();
    pendingSnapshots.clear();
    startedEpochs.clear();
    gapNotified = false;
  }

  return { acceptStarted, acceptSnapshot, acceptEvent, dispose };
}
