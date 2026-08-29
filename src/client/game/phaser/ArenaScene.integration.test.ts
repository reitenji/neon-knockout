import { describe, expect, it, vi } from 'vitest';
import type { GameEvent, MatchPlayer, MatchSnapshot } from '../../../shared/model.js';
import type { GamePresentationBridge } from '../GamePresentationBridge.js';

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
  sessionDispose: vi.fn()
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
    }
    step(): void {}
    getLocalPresentation(): null { return null; }
    dispose(): void { probes.sessionDispose(); }
  }
}));

vi.mock('./ArenaView.js', () => ({
  createArenaView: () => ({ apply: probes.arenaApply, destroy: probes.arenaDestroy })
}));

vi.mock('./FighterView.js', () => ({
  createFighterView: (...args: unknown[]) => {
    probes.createFighterView(...args);
    return {
      outer: { x: 100, y: 100 }, content: {},
      apply: probes.fighterApply, destroy: probes.fighterDestroy
    };
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

const idleAction = { kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0 } as const;

function player(): MatchPlayer {
  return {
    playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 300, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, overload: 0,
    lastProcessedInputSeq: 0, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 }
  };
}

function snapshot(): MatchSnapshot {
  return {
    tick: 10, phase: 'REGULATION', remainingMs: 82_000, platformProgress: 0.35,
    scores: { p1: 0 }, players: [player()], winnerPlayerId: null, resultReason: null
  };
}

class Bridge implements GamePresentationBridge {
  readonly eventListeners = new Set<(event: GameEvent) => void>();
  readonly muteListeners = new Set<(muted: boolean) => void>();
  eventUnsubscribes = 0;
  muteUnsubscribes = 0;

  getSnapshot = (): MatchSnapshot => snapshot();
  isConnected = (): boolean => true;
  subscribeSnapshot = (): (() => void) => () => undefined;
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
}

describe('ArenaScene live presentation integration', () => {
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
});
