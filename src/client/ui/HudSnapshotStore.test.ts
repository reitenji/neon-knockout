import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import { DEFAULT_ROOM_SETTINGS } from '../../shared/roomSettings.js';
import type { GamePresentationBridge } from '../game/GamePresentationBridge.js';
import { createHudSnapshotStore } from './HudSnapshotStore.js';

const idleAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
} as const;

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p-local', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 640, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, overload: 20,
    lastProcessedInputSeq: 0, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

function snapshot(tick = 0, overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    tick,
    phase: 'REGULATION',
    remainingMs: 90_000 - tick,
    platformProgress: 0,
    settings: DEFAULT_ROOM_SETTINGS,
    scores: { 'p-local': 0 },
    network: { 'p-local': { currentMs: 20, medianMs: 20, jitterMs: 1, transport: 'websocket' } },
    players: [player()],
    pulses: [],
    winnerPlayerId: null,
    resultReason: null,
    ...overrides
  };
}

class Bridge implements GamePresentationBridge {
  current: MatchSnapshot | null;
  readonly snapshotListeners = new Set<(value: MatchSnapshot) => void>();

  constructor(initial: MatchSnapshot | null = snapshot()) {
    this.current = initial;
  }

  getSnapshot = (): MatchSnapshot | null => this.current;
  isConnected = (): boolean => true;
  subscribeSnapshot = (listener: (value: MatchSnapshot) => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };
  subscribeConnected = (): (() => void) => () => undefined;
  subscribeEvent = (): (() => void) => () => undefined;
  subscribeMuted = (): (() => void) => () => undefined;
  sendInput = (): void => undefined;

  publish(next: MatchSnapshot): void {
    this.current = next;
    for (const listener of this.snapshotListeners) listener(next);
  }
}

describe('createHudSnapshotStore', () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => vi.useRealTimers());

  it('coalesces a 60-publication combat burst to the newest tick once per 50ms', () => {
    const bridge = new Bridge(snapshot(0));
    const store = createHudSnapshotStore(bridge);
    const notify = vi.fn();
    store.subscribe(notify);
    const initial = store.getSnapshot();

    for (let tick = 1; tick <= 60; tick += 1) bridge.publish(snapshot(tick));

    expect(notify).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toBe(initial);
    vi.advanceTimersByTime(49);
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify).toHaveBeenCalledOnce();
    expect(store.getSnapshot()?.tick).toBe(60);

    for (let tick = 61; tick <= 120; tick += 1) bridge.publish(snapshot(tick));
    vi.advanceTimersByTime(50);
    expect(notify).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot()?.tick).toBe(120);
  });

  it('notifies synchronously for each structural HUD change', () => {
    const bridge = new Bridge(snapshot());
    const store = createHudSnapshotStore(bridge);
    const notify = vi.fn();
    store.subscribe(notify);

    bridge.publish(snapshot(1, { phase: 'SUDDEN_DEATH' }));
    expect(notify).toHaveBeenCalledTimes(1);
    bridge.publish(snapshot(2, { phase: 'SUDDEN_DEATH', scores: { 'p-local': 1 } }));
    expect(notify).toHaveBeenCalledTimes(2);
    bridge.publish(snapshot(3, { phase: 'SUDDEN_DEATH', scores: { 'p-local': 1 }, players: [player({ name: 'Nora' })] }));
    expect(notify).toHaveBeenCalledTimes(3);
    bridge.publish(snapshot(4, { phase: 'SUDDEN_DEATH', scores: { 'p-local': 1 }, players: [player(), player({ playerId: 'p-rival' })] }));
    expect(notify).toHaveBeenCalledTimes(4);
    bridge.publish(snapshot(5, { phase: 'SUDDEN_DEATH', scores: { 'p-local': 1 }, players: [player(), player({ playerId: 'p-rival' })], winnerPlayerId: 'p-local' }));
    expect(notify).toHaveBeenCalledTimes(5);
    bridge.publish(snapshot(6, { phase: 'SUDDEN_DEATH', scores: { 'p-local': 1 }, players: [player(), player({ playerId: 'p-rival' })], winnerPlayerId: 'p-local', resultReason: 'TARGET_SCORE' }));
    expect(notify).toHaveBeenCalledTimes(6);
  });

  it('cancels a pending callback when disposed', () => {
    const bridge = new Bridge(snapshot());
    const store = createHudSnapshotStore(bridge);
    const notify = vi.fn();
    store.subscribe(notify);

    bridge.publish(snapshot(1));
    expect(vi.getTimerCount()).toBe(1);
    store.dispose();

    expect(vi.getTimerCount()).toBe(0);
    vi.runOnlyPendingTimers();
    expect(notify).not.toHaveBeenCalled();
    expect(bridge.snapshotListeners).toHaveLength(0);
  });

  it('starts a replacement bridge from that bridge current snapshot', () => {
    const firstBridge = new Bridge(snapshot(1));
    const secondSnapshot = snapshot(99, { phase: 'PAUSED' });
    const secondBridge = new Bridge(secondSnapshot);
    const firstStore = createHudSnapshotStore(firstBridge);
    const secondStore = createHudSnapshotStore(secondBridge);

    expect(firstStore.getSnapshot()?.tick).toBe(1);
    expect(secondStore.getSnapshot()).toBe(secondSnapshot);
  });
});
