import { profileForAttack, sampleWeaponPoint } from '../../shared/combat/profiles.js';
import { GAME } from '../../shared/constants.js';
import type { GameEvent } from '../../shared/model.js';
import { normalize } from './geometry.js';
import type { AttackRuntime, MatchState, MutableMatchPlayer, PulseRuntime } from './state.js';

function forwardMostHeavyProgress(): number {
  const path = profileForAttack('HEAVY').weaponPath;
  let forwardMostIndex = 0;
  for (let index = 1; index < path.length; index += 1) {
    if (path[index].x > path[forwardMostIndex].x) forwardMostIndex = index;
  }
  return forwardMostIndex / (path.length - 1);
}

export function spawnNeonPulse(
  state: MatchState,
  owner: MutableMatchPlayer,
  attack: AttackRuntime
): Readonly<{ pulse: PulseRuntime; event: GameEvent }> | null {
  if (attack.kind !== 'HEAVY' || attack.chargeMs !== GAME.heavyMaxChargeMs) return null;
  if (Object.values(state.pulses).some((pulse) =>
    pulse.ownerPlayerId === owner.playerId && pulse.originatingAttackId === attack.attackId)) {
    return null;
  }

  const direction = normalize(attack.lockedFacing, { x: 1, y: 0 });
  const position = sampleWeaponPoint(
    owner.position,
    direction,
    profileForAttack('HEAVY'),
    forwardMostHeavyProgress()
  );
  const projectileId = state.nextProjectileId++;
  const pulse: PulseRuntime = {
    projectileId,
    ownerPlayerId: owner.playerId,
    originatingAttackId: attack.attackId,
    position: { ...position },
    previousPosition: { ...position },
    velocity: { x: direction.x * GAME.pulseSpeed, y: direction.y * GAME.pulseSpeed },
    radius: GAME.pulseRadius,
    remainingMs: GAME.pulseLifetimeMs,
    hitPlayerIds: attack.hitPlayerIds
  };
  state.pulses[projectileId] = pulse;
  return {
    pulse,
    event: {
      type: 'PULSE_SPAWN',
      eventId: state.nextEventId++,
      tick: state.tick,
      projectileId,
      ownerPlayerId: owner.playerId,
      originatingAttackId: attack.attackId,
      position: { ...position }
    }
  };
}

export function advancePulses(state: MatchState, stepMs: number): void {
  const elapsedMs = Math.max(0, stepMs);
  for (const projectileId of Object.keys(state.pulses).map(Number).sort((left, right) => left - right)) {
    const pulse = state.pulses[projectileId];
    const travelMs = Math.min(elapsedMs, pulse.remainingMs);
    pulse.previousPosition = { ...pulse.position };
    pulse.position = {
      x: pulse.position.x + pulse.velocity.x * travelMs / 1_000,
      y: pulse.position.y + pulse.velocity.y * travelMs / 1_000
    };
    pulse.remainingMs = Math.max(0, pulse.remainingMs - elapsedMs);
    if (pulse.remainingMs === 0) removePulse(state, projectileId);
  }
}

export function removePulse(state: MatchState, projectileId: number): void {
  delete state.pulses[projectileId];
}

export function removePulsesOwnedBy(state: MatchState, playerId: string): void {
  for (const pulse of Object.values(state.pulses)) {
    if (pulse.ownerPlayerId === playerId) removePulse(state, pulse.projectileId);
  }
}

export function clearPulses(state: MatchState): void {
  for (const projectileId of Object.keys(state.pulses)) delete state.pulses[Number(projectileId)];
}
