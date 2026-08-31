import { describe, expect, it } from 'vitest';
import type { GameEvent, MatchPlayer, MatchSnapshot, Vec2 } from '../../../shared/model.js';
import { DEFAULT_ROOM_SETTINGS } from '../../../shared/roomSettings.js';
import { ImpactFx, type ImpactFxAdapter } from './ImpactFx.js';

const idleAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
} as const;

function player(playerId: string, name: string, position: Vec2): MatchPlayer {
  return {
    playerId, name, chassis: 'RIFT', accent: 0, position, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 },
    overload: 0, lastProcessedInputSeq: 0, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 }
  };
}

function snapshot(): MatchSnapshot {
  return {
    tick: 30, phase: 'REGULATION', remainingMs: 90_000, platformProgress: 0,
    settings: DEFAULT_ROOM_SETTINGS,
    scores: { attacker: 2, target: 0 },
    players: [player('attacker', 'Ada', { x: 200, y: 360 }), player('target', 'Bora', { x: 300, y: 360 })],
    pulses: [],
    winnerPlayerId: null, resultReason: null
  };
}

type RecordedCall = Readonly<{ method: string; args: readonly unknown[] }>;

class RecordingAdapter implements ImpactFxAdapter {
  readonly calls: RecordedCall[] = [];
  disposed = 0;

  flashTarget(...args: Parameters<ImpactFxAdapter['flashTarget']>): void { this.record('flashTarget', args); }
  holdHitPose(...args: Parameters<ImpactFxAdapter['holdHitPose']>): void { this.record('holdHitPose', args); }
  emitDirectionalParticles(...args: Parameters<ImpactFxAdapter['emitDirectionalParticles']>): void {
    this.record('emitDirectionalParticles', args);
  }
  pulseOverload(...args: Parameters<ImpactFxAdapter['pulseOverload']>): void { this.record('pulseOverload', args); }
  emitKnockbackTrail(...args: Parameters<ImpactFxAdapter['emitKnockbackTrail']>): void {
    this.record('emitKnockbackTrail', args);
  }
  emitClash(...args: Parameters<ImpactFxAdapter['emitClash']>): void { this.record('emitClash', args); }
  emitPerfectDodge(...args: Parameters<ImpactFxAdapter['emitPerfectDodge']>): void {
    this.record('emitPerfectDodge', args);
  }
  emitPulseSpawn(...args: Parameters<ImpactFxAdapter['emitPulseSpawn']>): void { this.record('emitPulseSpawn', args); }
  emitPulseBreak(...args: Parameters<ImpactFxAdapter['emitPulseBreak']>): void { this.record('emitPulseBreak', args); }
  nudgeCamera(...args: Parameters<ImpactFxAdapter['nudgeCamera']>): void { this.record('nudgeCamera', args); }
  emitKnockoutBurst(...args: Parameters<ImpactFxAdapter['emitKnockoutBurst']>): void {
    this.record('emitKnockoutBurst', args);
  }
  emitEdgeStreak(...args: Parameters<ImpactFxAdapter['emitEdgeStreak']>): void { this.record('emitEdgeStreak', args); }
  pulseScore(...args: Parameters<ImpactFxAdapter['pulseScore']>): void { this.record('pulseScore', args); }
  announceKnockout(...args: Parameters<ImpactFxAdapter['announceKnockout']>): void {
    this.record('announceKnockout', args);
  }
  emitRespawn(...args: Parameters<ImpactFxAdapter['emitRespawn']>): void { this.record('emitRespawn', args); }
  dispose(): void { this.disposed += 1; }

  private record(method: string, args: readonly unknown[]): void { this.calls.push({ method, args }); }
}

function hit(eventId = 7): GameEvent {
  return {
    eventId, tick: 30, type: 'HIT', attackerId: 'attacker', targetId: 'target', attack: 'QUICK_2',
    impactPosition: { x: 280, y: 360 }, impulse: 380, resultingOverload: 47
  };
}

describe('ImpactFx', () => {
  it('turns one authoritative hit into the complete directional feedback stack exactly once', () => {
    const adapter = new RecordingAdapter();
    const effects = new ImpactFx(adapter);

    expect(effects.ingest(hit(), snapshot())).toBe(true);
    expect(effects.ingest(hit(), snapshot())).toBe(false);

    expect(adapter.calls.map((call) => call.method)).toEqual([
      'flashTarget', 'holdHitPose', 'emitDirectionalParticles', 'pulseOverload', 'emitKnockbackTrail', 'nudgeCamera'
    ]);
    expect(adapter.calls[0]?.args).toEqual(['target', 0.5]);
    expect(adapter.calls[2]?.args).toEqual([{ x: 280, y: 360 }, { x: 1, y: 0 }, 0.5]);
    expect(adapter.calls[3]?.args).toEqual(['target', 47, 0.5]);
    expect(adapter.calls[4]?.args).toEqual(['target', { x: 1, y: 0 }, 0.5]);
    expect(adapter.calls[5]?.args).toEqual([{ x: 1, y: 0 }, 0.5]);
    expect(adapter.calls[1]?.args[1]).toBeLessThanOrEqual(35);
  });

  it('keeps hit readability but suppresses camera motion and hit-stop when reduced motion is active', () => {
    const adapter = new RecordingAdapter();
    const effects = new ImpactFx(adapter, { reducedMotion: true });

    effects.ingest(hit(), snapshot());

    expect(adapter.calls.map((call) => call.method)).toEqual([
      'flashTarget', 'emitDirectionalParticles', 'pulseOverload', 'emitKnockbackTrail'
    ]);
  });

  it('gives clash, perfect dodge, pulse spawn, and pulse break distinct deduplicated feedback routes', () => {
    const adapter = new RecordingAdapter();
    const effects = new ImpactFx(adapter);
    const events: GameEvent[] = [
      {
        eventId: 10, tick: 31, type: 'CLASH', playerIds: ['attacker', 'target'], attackIds: [4, 5],
        impactPosition: { x: 250, y: 360 }, strength: 'HEAVY'
      },
      {
        eventId: 11, tick: 31, type: 'PERFECT_DODGE', playerId: 'target', attackerId: 'attacker',
        attackId: 4, source: 'QUICK_1', projectileId: null, impactPosition: { x: 290, y: 360 }, refundedMs: 550
      },
      {
        eventId: 12, tick: 31, type: 'PULSE_SPAWN', projectileId: 8, ownerPlayerId: 'attacker',
        originatingAttackId: 6, position: { x: 240, y: 360 }
      },
      {
        eventId: 13, tick: 32, type: 'PULSE_BREAK', projectileId: 8, breakerPlayerId: 'target',
        breakerAttackId: 7, impactPosition: { x: 330, y: 360 }
      }
    ];

    for (const event of events) {
      expect(effects.ingest(event, snapshot())).toBe(true);
      expect(effects.ingest(event, snapshot())).toBe(false);
    }

    expect(adapter.calls.filter(({ method }) => method === 'emitClash')).toEqual([
      { method: 'emitClash', args: [{ x: 250, y: 360 }, 'HEAVY'] }
    ]);
    expect(adapter.calls.filter(({ method }) => method === 'emitPerfectDodge')).toEqual([
      { method: 'emitPerfectDodge', args: [{ x: 290, y: 360 }] }
    ]);
    expect(adapter.calls.filter(({ method }) => method === 'emitPulseSpawn')).toEqual([
      { method: 'emitPulseSpawn', args: [{ x: 240, y: 360 }] }
    ]);
    expect(adapter.calls.filter(({ method }) => method === 'emitPulseBreak')).toEqual([
      { method: 'emitPulseBreak', args: [{ x: 330, y: 360 }] }
    ]);
  });

  it('keeps clash flashes and particles in reduced motion while removing displacement and hit-stop', () => {
    const adapter = new RecordingAdapter();
    const effects = new ImpactFx(adapter, { reducedMotion: true });
    effects.ingest({
      eventId: 14, tick: 32, type: 'CLASH', playerIds: ['attacker', 'target'], attackIds: [8, 9],
      impactPosition: { x: 250, y: 360 }, strength: 'QUICK'
    }, snapshot());

    expect(adapter.calls.map(({ method }) => method)).toEqual(['flashTarget', 'flashTarget', 'emitClash']);
  });

  it('adds a larger edge burst, score pulse, announcer, and camera response for a knockout', () => {
    const adapter = new RecordingAdapter();
    const effects = new ImpactFx(adapter);
    const event: GameEvent = {
      eventId: 8, tick: 31, type: 'KNOCKOUT', attackerId: 'attacker', targetId: 'target',
      scoreAwardedTo: 'attacker', scores: { attacker: 3, target: 0 }
    };

    effects.ingest(event, snapshot());

    expect(adapter.calls).toEqual([
      { method: 'emitKnockoutBurst', args: [{ x: 300, y: 360 }, 1] },
      { method: 'emitEdgeStreak', args: [{ x: 300, y: 360 }, { x: -1, y: 0 }] },
      { method: 'pulseScore', args: ['attacker', 3] },
      { method: 'announceKnockout', args: ['Ada', 'Bora'] },
      { method: 'nudgeCamera', args: [{ x: -1, y: 0 }, 1] }
    ]);
  });

  it('renders respawn feedback once and disposes adapter-owned resources idempotently', () => {
    const adapter = new RecordingAdapter();
    const effects = new ImpactFx(adapter);
    const event: GameEvent = {
      eventId: 9, tick: 32, type: 'RESPAWN', playerId: 'target', position: { x: 640, y: 360 }
    };

    effects.ingest(event, snapshot());
    effects.dispose();
    effects.dispose();

    expect(adapter.calls).toEqual([{ method: 'emitRespawn', args: ['target', { x: 640, y: 360 }] }]);
    expect(adapter.disposed).toBe(1);
    expect(effects.ingest({ ...event, eventId: 10 }, snapshot())).toBe(false);
  });
});
