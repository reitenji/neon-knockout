import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, MatchPlayer, MatchSnapshot, Vec2 } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import { ArenaInput, type ArenaInputSource } from './ArenaInput.js';
import { ArenaSession } from './ArenaSession.js';

const idleAction = { kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0 } as const;

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p-local', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, facing: { x: 0, y: -1 }, overload: 0,
    lastProcessedInputSeq: -1, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

function snapshot(local = player()): MatchSnapshot {
  return {
    tick: 1, phase: 'REGULATION', remainingMs: 100_000, platformProgress: 0,
    scores: { 'p-local': 0 }, players: [local], winnerPlayerId: null, resultReason: null
  };
}

class Bridge implements GamePresentationBridge {
  connected = true;
  current: MatchSnapshot | null = snapshot();
  readonly sent: InputFrame[] = [];
  readonly snapshotListeners = new Set<(snapshot: MatchSnapshot) => void>();
  readonly connectionListeners = new Set<(connected: boolean) => void>();
  readonly eventListeners = new Set<(event: GameEvent) => void>();
  readonly mutedListeners = new Set<(muted: boolean) => void>();

  getSnapshot = (): MatchSnapshot | null => this.current;
  isConnected = (): boolean => this.connected;
  subscribeSnapshot = (listener: (value: MatchSnapshot) => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };
  subscribeConnected = (listener: (connected: boolean) => void): (() => void) => {
    this.connectionListeners.add(listener);
    listener(this.connected);
    return () => this.connectionListeners.delete(listener);
  };
  subscribeEvent = (listener: (event: GameEvent) => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  };
  subscribeMuted = (listener: (muted: boolean) => void): (() => void) => {
    this.mutedListeners.add(listener);
    return () => this.mutedListeners.delete(listener);
  };
  sendInput = (frame: InputFrame): void => { this.sent.push(frame); };

  setConnected(connected: boolean): void {
    this.connected = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }
}

function controls(): ArenaInputSource & {
  held: Record<'up' | 'down' | 'left' | 'right' | 'dash', boolean>;
  pointer: { world: Vec2; leftDown: boolean; rightDown: boolean };
} {
  const held = { up: false, down: false, left: false, right: false, dash: false };
  const pointer = { world: { x: 100, y: 0 }, leftDown: false, rightDown: false };
  return {
    held, pointer,
    movement: () => ({ ...held }),
    pointerState: () => ({ x: 0, y: 0, leftDown: pointer.leftDown, rightDown: pointer.rightDown }),
    projectPointer: () => pointer.world,
    reset() {
      for (const key of Object.keys(held) as Array<keyof typeof held>) held[key] = false;
    }
  };
}

describe('ArenaSession', () => {
  it('stops immediately on disconnect and keeps held pointer input suppressed through reconnect until release', () => {
    const bridge = new Bridge();
    const source = controls();
    const input = new ArenaInput(source);
    let now = 0;
    const session = new ArenaSession(bridge, 'p-local', input, () => now);
    session.start();

    source.held.right = true;
    source.pointer.rightDown = true;
    const predicted = session.step(16)!;
    expect(predicted.position.x).toBeGreaterThan(100);
    expect(bridge.sent.at(-1)?.heavy).toBe(true);

    bridge.setConnected(false);
    expect(session.getLocalPresentation()?.position).toEqual({ x: 100, y: 100 });
    expect(session.getLocalPresentation()?.actionStart).toBeNull();
    now += 17;
    session.step(16);
    expect(bridge.sent).toHaveLength(1);

    bridge.setConnected(true);
    now += 17;
    session.step(16);
    expect(bridge.sent.at(-1)?.heavy).toBe(false);

    source.pointer.rightDown = false;
    now += 17;
    session.step(16);
    source.pointer.rightDown = true;
    now += 17;
    session.step(16);
    expect(bridge.sent.at(-1)?.heavy).toBe(true);
  });

  it('subscribes once, disposes connection/snapshot listeners, and never sends after disposal', () => {
    const bridge = new Bridge();
    const session = new ArenaSession(bridge, 'p-local', new ArenaInput(controls()), () => 0);

    session.start();
    session.start();
    expect(bridge.connectionListeners).toHaveLength(1);
    expect(bridge.snapshotListeners).toHaveLength(1);

    session.dispose();
    session.dispose();
    expect(bridge.connectionListeners).toHaveLength(0);
    expect(bridge.snapshotListeners).toHaveLength(0);
    session.step(16);
    expect(bridge.sent).toHaveLength(0);
  });

  it('samples aim from the visible predicted position so pointer-at-center retains facing', () => {
    const bridge = new Bridge();
    const source = controls();
    source.held.right = true;
    let now = 0;
    const session = new ArenaSession(bridge, 'p-local', new ArenaInput(source), () => now);
    session.start();

    const moved = session.step(16)!;
    expect(moved.position.x).toBeGreaterThan(100);
    expect(moved.facing).toEqual({ x: 0, y: -1 });

    source.held.right = false;
    source.pointer.world = moved.position;
    now += 17;
    const centered = session.step(16)!;
    expect(centered.facing).toEqual({ x: 0, y: -1 });
  });
});
