import {
  buildAttackCapsule,
  capsuleIntersectsCircle,
  capsulesIntersect,
  type SweptCapsule
} from '../../shared/combat/geometry.js';
import { profileForAttack, type AttackProfile } from '../../shared/combat/profiles.js';
import { GAME } from '../../shared/constants.js';
import type { AttackKind, GameEvent } from '../../shared/model.js';
import { clamp, normalize, subtract } from './geometry.js';
import type { AttackRuntime, MatchState, MutableMatchPlayer } from './state.js';

export type ActiveAttackShape = Readonly<{
  playerId: string;
  attackId: number;
  kind: AttackKind;
  capsule: SweptCapsule;
}>;

export type ActiveAttackSlice = Readonly<{
  playerId: string;
  attack: AttackRuntime;
  previousProgress: number;
  currentProgress: number;
  enteredActive: boolean;
}>;

const shapeRuntimeAssociations = new WeakMap<
  ActiveAttackShape,
  Readonly<{ state: MatchState; tick: number; attack: AttackRuntime }>
>();

export function buildActiveAttackShapes(
  state: MatchState,
  slices: readonly ActiveAttackSlice[]
): readonly ActiveAttackShape[] {
  return slices.map((slice) => {
    const shape: ActiveAttackShape = {
      playerId: slice.playerId,
      attackId: slice.attack.attackId,
      kind: slice.attack.kind,
      capsule: buildAttackCapsule(
        state.players[slice.playerId].position,
        slice.attack.lockedFacing,
        profileForAttack(slice.attack.kind),
        slice.previousProgress,
        slice.currentProgress
      )
    };
    shapeRuntimeAssociations.set(shape, { state, tick: state.tick, attack: slice.attack });
    return shape;
  });
}

const compareStableIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const QUICK_ONE_PROFILE = profileForAttack('QUICK_1');
const HEAVY_PROFILE = profileForAttack('HEAVY');
const QUICK_ONE_OVERLOAD = chargedValue(QUICK_ONE_PROFILE.overloadGain, 0);
const MIN_EFFECTIVE_IMPULSE = chargedValue(QUICK_ONE_PROFILE.baseImpulse, 0) *
  (1 + (QUICK_ONE_OVERLOAD / GAME.maxOverload) * 0.9);
const MAX_EFFECTIVE_IMPULSE = chargedValue(HEAVY_PROFILE.baseImpulse, GAME.heavyMaxChargeMs) * 1.9;

function activePlayer(player: MutableMatchPlayer): boolean {
  return player.connected && player.respawnRemainingMs <= 0;
}

function runtimeForShape(
  state: MatchState,
  shape: ActiveAttackShape
): Readonly<{ player: MutableMatchPlayer; attack: AttackRuntime }> | null {
  const player = state.players[shape.playerId];
  if (!player || !activePlayer(player)) return null;
  const association = shapeRuntimeAssociations.get(shape);
  if (association) {
    if (association.state !== state || association.tick !== state.tick ||
      association.attack.attackId !== shape.attackId || association.attack.kind !== shape.kind) {
      return null;
    }
    return { player, attack: association.attack };
  }
  if (player.attack?.attackId !== shape.attackId || player.attack.kind !== shape.kind) return null;
  return { player, attack: player.attack };
}

function shapeMidpoint(shape: ActiveAttackShape): Readonly<{ x: number; y: number }> {
  return {
    x: (shape.capsule.from.x + shape.capsule.to.x) / 2,
    y: (shape.capsule.from.y + shape.capsule.to.y) / 2
  };
}

function clashImpact(left: ActiveAttackShape, right: ActiveAttackShape): Readonly<{ x: number; y: number }> {
  const leftMidpoint = shapeMidpoint(left);
  const rightMidpoint = shapeMidpoint(right);
  return {
    x: (leftMidpoint.x + rightMidpoint.x) / 2,
    y: (leftMidpoint.y + rightMidpoint.y) / 2
  };
}

function moveToRecovery(player: MutableMatchPlayer, attack: AttackRuntime): void {
  if (attack.phase === 'RECOVERY') return;
  attack.phase = 'RECOVERY';
  attack.phaseRemainingMs = profileForAttack(attack.kind).recoveryMs;
  attack.phaseElapsedMs = 0;
  attack.previousActiveProgress = 1;
  player.stats.completedAttacks += 1;
}

function applyOppositeRecoil(left: MutableMatchPlayer, right: MutableMatchPlayer, amount: number): void {
  const fallback = compareStableIds(left.playerId, right.playerId) <= 0
    ? { x: 1, y: 0 }
    : { x: -1, y: 0 };
  const direction = normalize(subtract(right.position, left.position), fallback);
  left.velocity = {
    x: left.velocity.x - direction.x * amount,
    y: left.velocity.y - direction.y * amount
  };
  right.velocity = {
    x: right.velocity.x + direction.x * amount,
    y: right.velocity.y + direction.y * amount
  };
}

function chargedValue(
  value: number | Readonly<{ minimum: number; maximum: number }>,
  chargeMs: number
): number {
  if (typeof value === 'number') return value;
  const progress = clamp(
    (chargeMs - GAME.heavyEnterChargeMs) / (GAME.heavyMaxChargeMs - GAME.heavyEnterChargeMs),
    0,
    1
  );
  return value.minimum + (value.maximum - value.minimum) * progress;
}

function attackEffects(profile: AttackProfile, attack: AttackRuntime): Readonly<{
  overloadGain: number;
  baseImpulse: number;
}> {
  return {
    overloadGain: chargedValue(profile.overloadGain, attack.chargeMs),
    baseImpulse: chargedValue(profile.baseImpulse, attack.chargeMs)
  };
}

function hitstunFor(impulse: number): number {
  const progress = clamp(
    (impulse - MIN_EFFECTIVE_IMPULSE) / (MAX_EFFECTIVE_IMPULSE - MIN_EFFECTIVE_IMPULSE),
    0,
    1
  );
  return 90 + progress * 140;
}

export function resolveMeleeInteractions(
  state: MatchState,
  shapes: readonly ActiveAttackShape[]
): readonly GameEvent[] {
  const events: GameEvent[] = [];
  const canceledAttackIds = new Set<number>();
  const orderedShapes = [...shapes].sort((left, right) =>
    left.attackId - right.attackId || compareStableIds(left.playerId, right.playerId));

  for (let leftIndex = 0; leftIndex < orderedShapes.length; leftIndex += 1) {
    const leftShape = orderedShapes[leftIndex];
    const leftRuntime = runtimeForShape(state, leftShape);
    if (!leftRuntime || canceledAttackIds.has(leftShape.attackId)) continue;

    for (let rightIndex = leftIndex + 1; rightIndex < orderedShapes.length; rightIndex += 1) {
      const rightShape = orderedShapes[rightIndex];
      if (leftShape.playerId === rightShape.playerId || canceledAttackIds.has(rightShape.attackId)) continue;
      const rightRuntime = runtimeForShape(state, rightShape);
      if (!rightRuntime ||
        leftRuntime.attack.resolvedPlayerIds.has(rightShape.playerId) ||
        rightRuntime.attack.resolvedPlayerIds.has(leftShape.playerId) ||
        !capsulesIntersect(leftShape.capsule, rightShape.capsule)) {
        continue;
      }

      leftRuntime.attack.resolvedPlayerIds.add(rightShape.playerId);
      rightRuntime.attack.resolvedPlayerIds.add(leftShape.playerId);
      const leftHeavy = leftShape.kind === 'HEAVY';
      const rightHeavy = rightShape.kind === 'HEAVY';
      const strength = leftHeavy || rightHeavy ? 'HEAVY' : 'QUICK';

      if (leftHeavy === rightHeavy) {
        moveToRecovery(leftRuntime.player, leftRuntime.attack);
        moveToRecovery(rightRuntime.player, rightRuntime.attack);
        canceledAttackIds.add(leftShape.attackId);
        canceledAttackIds.add(rightShape.attackId);
        applyOppositeRecoil(
          leftRuntime.player,
          rightRuntime.player,
          leftHeavy ? GAME.heavyClashRecoil : GAME.quickClashRecoil
        );
      } else {
        const quickShape = leftHeavy ? rightShape : leftShape;
        const quickRuntime = leftHeavy ? rightRuntime : leftRuntime;
        moveToRecovery(quickRuntime.player, quickRuntime.attack);
        canceledAttackIds.add(quickShape.attackId);
      }

      events.push({
        type: 'CLASH',
        eventId: state.nextEventId++,
        tick: state.tick,
        playerIds: [leftShape.playerId, rightShape.playerId],
        attackIds: [leftShape.attackId, rightShape.attackId],
        impactPosition: clashImpact(leftShape, rightShape),
        strength
      });
      if (canceledAttackIds.has(leftShape.attackId)) break;
    }
  }

  for (const shape of orderedShapes) {
    if (canceledAttackIds.has(shape.attackId)) continue;
    const runtime = runtimeForShape(state, shape);
    if (!runtime) continue;
    const { player: attacker, attack } = runtime;
    const profile = profileForAttack(attack.kind);
    const effects = attackEffects(profile, attack);
    const targets = Object.values(state.players)
      .filter((target) =>
        target.playerId !== attacker.playerId &&
        activePlayer(target) &&
        target.protectionRemainingMs <= 0 &&
        !attack.resolvedPlayerIds.has(target.playerId) &&
        capsuleIntersectsCircle(shape.capsule, {
          center: target.position,
          radius: GAME.collisionRadius
        }))
      .sort((left, right) => compareStableIds(left.playerId, right.playerId));

    for (const target of targets) {
      attack.resolvedPlayerIds.add(target.playerId);
      if (target.dashInvulnerabilityRemainingMs > 0) {
        if (!target.perfectDodgeConsumed) {
          target.dashCooldownRemainingMs = Math.max(
            0,
            target.dashCooldownRemainingMs - GAME.perfectDodgeRefundMs
          );
          target.perfectDodgeConsumed = true;
          events.push({
            type: 'PERFECT_DODGE',
            eventId: state.nextEventId++,
            tick: state.tick,
            playerId: target.playerId,
            attackerId: attacker.playerId,
            attackId: attack.attackId,
            source: attack.kind,
            projectileId: null,
            impactPosition: { ...target.position },
            refundedMs: GAME.perfectDodgeRefundMs
          });
        }
        continue;
      }

      const firstLandedTarget = attack.hitPlayerIds.size === 0;
      attack.hitPlayerIds.add(target.playerId);
      if (firstLandedTarget) attacker.stats.landedHits += 1;
      target.overload = Math.min(GAME.maxOverload, target.overload + effects.overloadGain);
      const impulse = effects.baseImpulse * (1 + (target.overload / GAME.maxOverload) * 0.9);
      const direction = normalize(attack.lockedFacing, { x: 1, y: 0 });
      target.velocity = {
        x: target.velocity.x + direction.x * impulse,
        y: target.velocity.y + direction.y * impulse
      };
      target.hitstunRemainingMs = Math.max(target.hitstunRemainingMs, hitstunFor(impulse));
      target.lastAttackerId = attacker.playerId;
      target.lastAttackerAtMs = state.nowMs;
      target.chargeMs = 0;
      target.charging = false;
      events.push({
        type: 'HIT',
        eventId: state.nextEventId++,
        tick: state.tick,
        attackerId: attacker.playerId,
        targetId: target.playerId,
        attack: attack.kind,
        impactPosition: { ...target.position },
        impulse,
        resultingOverload: target.overload
      });
    }
  }

  return events;
}
