import { ARENA, GAME } from '../../../shared/constants.js';
import type { GameEvent, MatchSnapshot, Vec2 } from '../../../shared/model.js';

const ARENA_CENTER: Vec2 = { x: ARENA.width / 2, y: ARENA.height / 2 };
const MAX_HIT_IMPULSE = GAME.heavyAttack.maxImpulse;
const MIN_HIT_STRENGTH = 0.35;

export interface ImpactFxAdapter {
  flashTarget(playerId: string, strength: number): void;
  holdHitPose(playerId: string, durationMs: number): void;
  emitDirectionalParticles(position: Vec2, direction: Vec2, strength: number): void;
  pulseOverload(playerId: string, overload: number, strength: number): void;
  emitKnockbackTrail(playerId: string, direction: Vec2, strength: number): void;
  nudgeCamera(direction: Vec2, strength: number): void;
  emitKnockoutBurst(position: Vec2, strength: number): void;
  emitEdgeStreak(position: Vec2, direction: Vec2): void;
  pulseScore(playerId: string, score: number): void;
  announceKnockout(attackerName: string | null, targetName: string): void;
  emitRespawn(playerId: string, position: Vec2): void;
  dispose(): void;
}

export class ImpactFx {
  private readonly consumedEventIds = new Set<number>();
  private readonly reducedMotion: boolean;
  private disposed = false;

  constructor(
    private readonly adapter: ImpactFxAdapter,
    options: Readonly<{ reducedMotion?: boolean }> = {}
  ) {
    this.reducedMotion = options.reducedMotion ?? false;
  }

  ingest(event: GameEvent, snapshot: MatchSnapshot): boolean {
    if (this.disposed || this.consumedEventIds.has(event.eventId)) return false;
    this.consumedEventIds.add(event.eventId);

    if (event.type === 'HIT') this.presentHit(event, snapshot);
    if (event.type === 'KNOCKOUT') this.presentKnockout(event, snapshot);
    if (event.type === 'RESPAWN') this.adapter.emitRespawn(event.playerId, event.position);
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.consumedEventIds.clear();
    this.adapter.dispose();
  }

  private presentHit(event: Extract<GameEvent, { type: 'HIT' }>, snapshot: MatchSnapshot): void {
    const attacker = snapshot.players.find((player) => player.playerId === event.attackerId);
    const target = snapshot.players.find((player) => player.playerId === event.targetId);
    const direction = normalize(
      attacker && target
        ? { x: target.position.x - attacker.position.x, y: target.position.y - attacker.position.y }
        : attacker?.facing ?? { x: 1, y: 0 }
    );
    const strength = clamp(event.impulse / MAX_HIT_IMPULSE, MIN_HIT_STRENGTH, 1);

    this.adapter.flashTarget(event.targetId, strength);
    this.adapter.holdHitPose(event.targetId, Math.round(70 + strength * 50));
    this.adapter.emitDirectionalParticles(event.impactPosition, direction, strength);
    this.adapter.pulseOverload(event.targetId, event.resultingOverload, strength);
    this.adapter.emitKnockbackTrail(event.targetId, direction, strength);
    if (!this.reducedMotion) this.adapter.nudgeCamera(direction, strength);
  }

  private presentKnockout(event: Extract<GameEvent, { type: 'KNOCKOUT' }>, snapshot: MatchSnapshot): void {
    const attacker = event.attackerId
      ? snapshot.players.find((player) => player.playerId === event.attackerId)
      : undefined;
    const target = snapshot.players.find((player) => player.playerId === event.targetId);
    const position = target?.position ?? ARENA_CENTER;
    const direction = normalize({ x: position.x - ARENA_CENTER.x, y: position.y - ARENA_CENTER.y });

    this.adapter.emitKnockoutBurst(position, 1);
    this.adapter.emitEdgeStreak(position, direction);
    if (event.scoreAwardedTo) {
      this.adapter.pulseScore(event.scoreAwardedTo, event.scores[event.scoreAwardedTo] ?? 0);
    }
    this.adapter.announceKnockout(attacker?.name ?? null, target?.name ?? event.targetId);
    if (!this.reducedMotion) this.adapter.nudgeCamera(direction, 1);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalize(vector: Vec2): Vec2 {
  const magnitude = Math.hypot(vector.x, vector.y);
  if (magnitude < Number.EPSILON) return { x: 1, y: 0 };
  return { x: vector.x / magnitude, y: vector.y / magnitude };
}
