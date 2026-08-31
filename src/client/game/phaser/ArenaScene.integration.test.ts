import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameEvent, MatchPlayer, MatchSnapshot } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';
import type { PlayerPresentation } from '../prediction.js';

const probes = vi.hoisted(() => ({
  arenaApply: vi.fn(),
  arenaDestroy: vi.fn(),
  impactIngest: vi.fn(),
  impactDispose: vi.fn(),
  audioPlayEvent: vi.fn(),
  audioPlayCue: vi.fn(),
  audioSetMuted: vi.fn(),
  audioDispose: vi.fn(),
  fighterApply: vi.fn(),
  fighterDestroy: vi.fn(),
  createFighterView: vi.fn(),
  pulseApply: vi.fn(),
  pulseDestroy: vi.fn(),
  createPulseView: vi.fn(),
  sessionDispose: vi.fn(),
  sessionPresentation: vi.fn<() => PlayerPresentation | null>(() => null)
}));

class FakeEvents {
  private readonly listeners = new Map<string, Array<{ listener: () => void; context?: unknown }>>();
  once(event: string, listener: () => void, context?: unknown): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), { listener, context }]);
  }
  on(): void {}
  off(): void {}
  emit(event: string): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    for (const { listener, context } of listeners) listener.call(context);
  }
}

vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {
      events = new FakeEvents();
      cameras = { main: { setBackgroundColor: vi.fn(), scrollX: 0, scrollY: 0 } };
      sound = { locked: false, add: vi.fn(), unlock: vi.fn() };
      time = { now: 0 };
      add = {
        graphics: () => ({
          fillStyle() { return this; }, fillPoints() { return this; }, lineStyle() { return this; }, strokePoints() { return this; }
        })
      };
      constructor() {}
    },
    Math: { Vector2: class Vector2 { constructor(public x: number, public y: number) {} } },
    Scenes: { Events: { SHUTDOWN: 'shutdown', DESTROY: 'destroy' } }
  }
}));

vi.mock('./ArenaInput.js', () => ({
  ArenaInput: class ArenaInput {},
  createPhaserInputSource: () => ({})
}));

vi.mock('./ArenaSession.js', () => ({
  ArenaSession: class ArenaSession {
    private removeSnapshot: (() => void) | null = null;
    constructor(
      private readonly bridge: GamePresentationBridge,
      _playerId: string,
      _input: unknown,
      _now: () => number,
      private readonly onSnapshot: (snapshot: MatchSnapshot, receivedAtMs: number) => void
    ) {}
    start(): void {
      const snapshot = this.bridge.getSnapshot();
      if (snapshot) this.onSnapshot(snapshot, 0);
      this.removeSnapshot = this.bridge.subscribeSnapshot((next) => this.onSnapshot(next, 0));
    }
    step(): void {}
    getLocalPresentation(): PlayerPresentation | null { return probes.sessionPresentation(); }
    dispose(): void { this.removeSnapshot?.(); this.removeSnapshot = null; probes.sessionDispose(); }
  }
}));

vi.mock('./ArenaView.js', () => ({
  createArenaView: () => ({ apply: probes.arenaApply, destroy: probes.arenaDestroy })
}));

vi.mock('./FighterView.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./FighterView.js')>()),
  createFighterView: (...args: unknown[]) => {
    probes.createFighterView(...args);
    return {
      outer: { x: 100, y: 100 }, content: {},
      apply: probes.fighterApply, destroy: probes.fighterDestroy
    };
  }
}));

vi.mock('./PulseView.js', () => ({
  createPulseView: (...args: unknown[]) => {
    probes.createPulseView(...args);
    return { apply: probes.pulseApply, destroy: probes.pulseDestroy };
  }
}));

vi.mock('./ImpactFx.js', () => ({
  ImpactFx: class ImpactFx {
    ingest = probes.impactIngest;
    dispose = probes.impactDispose;
  }
}));

vi.mock('./GameAudio.js', () => ({
  GAME_AUDIO_ASSETS: {},
  GameAudio: class GameAudio {
    playEvent = probes.audioPlayEvent;
    playCue = probes.audioPlayCue;
    setMuted = probes.audioSetMuted;
    dispose = probes.audioDispose;
  }
}));

vi.mock('./PhaserImpactAdapter.js', () => ({ PhaserImpactAdapter: class PhaserImpactAdapter {} }));
vi.mock('./PhaserAudioAdapter.js', () => ({ PhaserAudioAdapter: class PhaserAudioAdapter {} }));

import Phaser from 'phaser';
import { scopeBridgeToPlayer } from '../GamePresentationBridge.js';
import { ArenaScene } from './ArenaScene.js';
import { capsuleForAttackTelegraph } from './FighterView.js';

const idleAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
} as const;

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 300, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, overload: 0,
    lastProcessedInputSeq: 0, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

function snapshot(overrides: Partial<MatchSnapshot> = {}): MatchSnapshot {
  return {
    tick: 10, phase: 'REGULATION', remainingMs: 82_000, platformProgress: 0.35,
    scores: { p1: 0 }, players: [player()], pulses: [], winnerPlayerId: null, resultReason: null,
    ...overrides
  };
}

class Bridge implements GamePresentationBridge {
  current: MatchSnapshot = snapshot();
  readonly snapshotListeners = new Set<(snapshot: MatchSnapshot) => void>();
  readonly eventListeners = new Set<(event: GameEvent) => void>();
  readonly muteListeners = new Set<(muted: boolean) => void>();
  eventUnsubscribes = 0;
  muteUnsubscribes = 0;

  getSnapshot = (): MatchSnapshot => this.current;
  isConnected = (): boolean => true;
  subscribeSnapshot = (listener: (snapshot: MatchSnapshot) => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  };
  subscribeConnected = (): (() => void) => () => undefined;
  subscribeEvent = (listener: (event: GameEvent) => void): (() => void) => {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); this.eventUnsubscribes += 1; };
  };
  subscribeMuted = (listener: (muted: boolean) => void): (() => void) => {
    this.muteListeners.add(listener);
    listener(true);
    return () => { this.muteListeners.delete(listener); this.muteUnsubscribes += 1; };
  };
  sendInput = (): void => undefined;
  emitEvent(event: GameEvent): void { for (const listener of this.eventListeners) listener(event); }
  publish(snapshot: MatchSnapshot): void {
    this.current = snapshot;
    for (const listener of this.snapshotListeners) listener(snapshot);
  }
}

describe('ArenaScene live presentation integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    probes.sessionPresentation.mockReturnValue(null);
  });

  it('builds the visible sweep capsule from shared profile points and thickness', () => {
    expect(capsuleForAttackTelegraph({ x: 300, y: 360 }, {
      profileId: 'quick-1',
      facing: { x: 1, y: 0 },
      previousProgress: 0,
      currentProgress: 1 / 3,
      active: true
    })).toEqual({ from: { x: 334, y: 328 }, to: { x: 358, y: 344 }, radius: 6 });
  });

  it('wires live arena state, canonical feedback/audio, persisted mute, reduced motion, and idempotent teardown', () => {
    const bridge = new Bridge();
    const scene = new ArenaScene(scopeBridgeToPlayer(bridge, 'p1'), true);
    scene.create();
    scene.update();

    expect(probes.arenaApply).toHaveBeenCalledWith(
      { phase: 'REGULATION', remainingMs: 82_000, platformProgress: 0.35 },
      expect.any(Number)
    );
    expect(probes.createFighterView).toHaveBeenCalledWith(scene, expect.objectContaining({ playerId: 'p1' }), true, {
      reducedMotion: true
    });
    expect(probes.audioSetMuted).toHaveBeenCalledWith(true);

    probes.sessionPresentation.mockReturnValue({
      position: { x: 300, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
      actionStart: { ...idleAction, kind: 'QUICK_1', phase: 'WINDUP', comboStep: 1 }
    });
    scene.update();
    scene.update();
    expect(probes.audioPlayCue).toHaveBeenCalledTimes(1);
    expect(probes.audioPlayCue).toHaveBeenCalledWith('quick', 1);

    const event: GameEvent = {
      eventId: 21, tick: 10, type: 'RESPAWN', playerId: 'p1', position: { x: 640, y: 360 }
    };
    bridge.emitEvent(event);
    bridge.emitEvent(event);
    expect(probes.impactIngest).toHaveBeenCalledTimes(1);
    expect(probes.impactIngest).toHaveBeenCalledWith(event, expect.objectContaining({ tick: 10 }));
    expect(probes.audioPlayEvent).toHaveBeenCalledTimes(1);

    (scene.events as unknown as FakeEvents).emit(Phaser.Scenes.Events.SHUTDOWN);
    (scene.events as unknown as FakeEvents).emit(Phaser.Scenes.Events.DESTROY);
    expect(probes.arenaDestroy).toHaveBeenCalledTimes(1);
    expect(probes.impactDispose).toHaveBeenCalledTimes(1);
    expect(probes.audioDispose).toHaveBeenCalledTimes(1);
    expect(probes.sessionDispose).toHaveBeenCalledTimes(1);
    expect(bridge.eventUnsubscribes).toBe(1);
    expect(bridge.muteUnsubscribes).toBe(1);
  });

  it('passes authoritative attack and charge direction state to every fighter view', () => {
    const bridge = new Bridge();
    bridge.current = snapshot({
      players: [
        player({
          facing: { x: 0, y: -1 },
          action: {
            ...idleAction,
            kind: 'HEAVY',
            phase: 'ACTIVE',
            chargeMs: 700,
            attackId: 15,
            profileId: 'heavy-melee',
            lockedFacing: { x: -1, y: 0 },
            activeProgress: 0.5
          }
        }),
        player({
          playerId: 'p2',
          facing: { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
          action: { ...idleAction, chargeMs: 350, charging: true }
        })
      ]
    });
    const scene = new ArenaScene(scopeBridgeToPlayer(bridge, 'p1'), false);

    scene.create();
    scene.update();

    expect(probes.fighterApply).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'p1' }),
      expect.any(Object),
      expect.any(Object),
      null,
      {
        profileId: 'heavy-melee', facing: { x: -1, y: 0 },
        previousProgress: 0.5, currentProgress: 0.5, active: true
      },
      { facing: { x: -1, y: 0 }, progress: 1, pulseReady: true }
    );
    expect(probes.fighterApply).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'p2' }),
      expect.any(Object),
      { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
      null,
      null,
      { facing: { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, progress: 0.5, pulseReady: false }
    );
  });

  it('reconciles authoritative pulse views by projectile ID without duplicates and clears them on removal or result', () => {
    const bridge = new Bridge();
    const authoritativePulse = {
      projectileId: 9, ownerPlayerId: 'p1', originatingAttackId: 4,
      position: { x: 350, y: 360 }, velocity: { x: 900, y: 0 }, radius: 18,
      remainingMs: 400, hitTargetIds: []
    } as const;
    bridge.current = snapshot({ pulses: [authoritativePulse] });
    const scene = new ArenaScene(scopeBridgeToPlayer(bridge, 'p1'), false);

    scene.create();
    scene.update();
    scene.update();
    expect(probes.createPulseView).toHaveBeenCalledTimes(1);

    bridge.publish(snapshot({
      tick: 11,
      pulses: [{ ...authoritativePulse, position: { x: 410, y: 360 }, remainingMs: 330 }]
    }));
    scene.update();
    expect(probes.createPulseView).toHaveBeenCalledTimes(1);
    expect(probes.pulseApply).toHaveBeenLastCalledWith(expect.objectContaining({
      projectileId: 9, position: { x: 410, y: 360 }
    }));

    bridge.publish(snapshot({ tick: 12, pulses: [] }));
    scene.update();
    expect(probes.pulseDestroy).toHaveBeenCalledTimes(1);

    bridge.publish(snapshot({ tick: 13, phase: 'FINISHED', pulses: [authoritativePulse] }));
    scene.update();
    expect(probes.createPulseView).toHaveBeenCalledTimes(1);
  });

  it('does not recreate consumed or result-cleared pulses from a stale snapshot', () => {
    const bridge = new Bridge();
    const authoritativePulse = {
      projectileId: 19, ownerPlayerId: 'p1', originatingAttackId: 14,
      position: { x: 350, y: 360 }, velocity: { x: 900, y: 0 }, radius: 18,
      remainingMs: 400, hitTargetIds: []
    } as const;
    bridge.current = snapshot({ pulses: [authoritativePulse] });
    const scene = new ArenaScene(scopeBridgeToPlayer(bridge, 'p1'), false);
    scene.create();
    scene.update();

    bridge.emitEvent({
      eventId: 40, tick: 10, type: 'PULSE_BREAK', projectileId: 19,
      breakerPlayerId: 'p1', breakerAttackId: 15, impactPosition: { x: 360, y: 360 }
    });
    scene.update();
    expect(probes.pulseDestroy).toHaveBeenCalledTimes(1);
    expect(probes.createPulseView).toHaveBeenCalledTimes(1);

    bridge.publish(snapshot({ tick: 11, pulses: [{ ...authoritativePulse, projectileId: 20 }] }));
    scene.update();
    expect(probes.createPulseView).toHaveBeenCalledTimes(2);

    bridge.emitEvent({
      eventId: 41, tick: 11, type: 'RESULT', winnerPlayerId: 'p1', reason: 'TARGET_SCORE', scores: { p1: 5 }
    });
    scene.update();
    expect(probes.pulseDestroy).toHaveBeenCalledTimes(2);
    expect(probes.createPulseView).toHaveBeenCalledTimes(2);
  });
});
