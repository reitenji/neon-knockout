import { describe, expect, it } from 'vitest';
import type { GameEvent, InputFrame, MatchPlayer, MatchSnapshot } from '../../../shared/model.js';
import { DEFAULT_ROOM_SETTINGS } from '../../../shared/roomSettings.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import { ArenaInput, type ArenaInputSource } from './ArenaInput.js';
import { ArenaSession } from './ArenaSession.js';

const idleAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
} as const;

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return { playerId: 'p-local', name: 'Ada', chassis: 'RIFT', accent: 0, position: { x: 100, y: 100 }, velocity: { x: 0, y: 0 }, facing: { x: 0, y: -1 }, overload: 0, lastProcessedInputSeq: -1, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0, hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0, stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 }, ...overrides };
}

function snapshot(local = player()): MatchSnapshot {
  return { tick: 1, phase: 'REGULATION', remainingMs: 100_000, platformProgress: 0, settings: DEFAULT_ROOM_SETTINGS, scores: { 'p-local': 0 }, pingMs: { 'p-local': null }, players: [local], pulses: [], winnerPlayerId: null, resultReason: null };
}

class Bridge implements GamePresentationBridge {
  connected = true;
  current: MatchSnapshot | null = snapshot();
  readonly sent: InputFrame[] = [];
  readonly snapshotListeners = new Set<(value: MatchSnapshot) => void>();
  readonly connectionListeners = new Set<(value: boolean) => void>();
  readonly eventListeners = new Set<(value: GameEvent) => void>();
  readonly mutedListeners = new Set<(value: boolean) => void>();
  getSnapshot = (): MatchSnapshot | null => this.current;
  isConnected = (): boolean => this.connected;
  subscribeSnapshot = (listener: (value: MatchSnapshot) => void): (() => void) => { this.snapshotListeners.add(listener); return () => this.snapshotListeners.delete(listener); };
  subscribeConnected = (listener: (value: boolean) => void): (() => void) => { this.connectionListeners.add(listener); listener(this.connected); return () => this.connectionListeners.delete(listener); };
  subscribeEvent = (listener: (value: GameEvent) => void): (() => void) => { this.eventListeners.add(listener); return () => this.eventListeners.delete(listener); };
  subscribeMuted = (listener: (value: boolean) => void): (() => void) => { this.mutedListeners.add(listener); return () => this.mutedListeners.delete(listener); };
  sendInput = (frame: InputFrame): void => { this.sent.push(frame); };
  setConnected(connected: boolean): void { this.connected = connected; for (const listener of this.connectionListeners) listener(connected); }
}

function controls(): ArenaInputSource & { movementHeld: Record<'up' | 'down' | 'left' | 'right' | 'dash', boolean>; attackHeld: Record<'quick' | 'heavy', boolean> } {
  const movementHeld = { up: false, down: false, left: false, right: false, dash: false };
  const attackHeld = { quick: false, heavy: false };
  return {
    movementHeld, attackHeld, movement: () => ({ ...movementHeld }), attack: () => ({ ...attackHeld }),
    reset() {},
    dispose() {}
  };
}

describe('ArenaSession', () => {
  it('clears countdown-held combat without forcing a fresh release when regulation begins', () => {
    const bridge = new Bridge();
    bridge.current = { ...snapshot(), phase: 'COUNTDOWN' };
    const source = controls();
    let now = 0;
    const session = new ArenaSession(bridge, 'p-local', new ArenaInput(source), () => now);
    session.start();

    source.attackHeld.quick = true;
    source.movementHeld.right = true;
    session.step(16);
    expect(bridge.sent).toHaveLength(0);

    bridge.current = snapshot(player({ lastProcessedInputSeq: -1 }));
    for (const listener of bridge.snapshotListeners) listener(bridge.current);
    now += 17;
    session.step(16);

    expect(bridge.sent.at(-1)).toMatchObject({ quick: true, moveX: 1, aimX: 1, aimY: 0 });
  });

  it('stops immediately on disconnect and suppresses held keyboard combat through reconnect until release', () => {
    const bridge = new Bridge();
    const source = controls();
    let now = 0;
    const session = new ArenaSession(bridge, 'p-local', new ArenaInput(source), () => now);
    session.start();
    source.movementHeld.right = true;
    source.attackHeld.heavy = true;
    expect(session.step(16)!.position.x).toBeGreaterThan(100);
    expect(bridge.sent.at(-1)?.heavy).toBe(true);
    bridge.setConnected(false);
    expect(session.getLocalPresentation()?.position).toEqual({ x: 100, y: 100 });
    now += 17;
    session.step(16);
    expect(bridge.sent).toHaveLength(1);
    bridge.setConnected(true);
    now += 17;
    session.step(16);
    expect(bridge.sent.at(-1)?.heavy).toBe(false);
    source.movementHeld.right = false;
    source.attackHeld.heavy = false;
    now += 17;
    session.step(16);
    source.movementHeld.right = true;
    source.attackHeld.heavy = true;
    now += 17;
    session.step(16);
    expect(bridge.sent.at(-1)?.heavy).toBe(true);
  });

  it('subscribes once, disposes connection and snapshot listeners, and never sends after disposal', () => {
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
});
