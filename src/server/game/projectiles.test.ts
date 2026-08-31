import { describe, expect, it } from 'vitest';

import { GAME } from '../../shared/constants.js';
import { profileForAttack } from '../../shared/combat/profiles.js';
import {
  advancePulses,
  clearPulses,
  removePulse,
  removePulsesOwnedBy,
  spawnNeonPulse
} from './projectiles.js';
import { createMatchState, type AttackRuntime, type MatchState } from './state.js';

function state(): MatchState {
  const match = createMatchState([
    { playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0 },
    { playerId: 'p2', name: 'Linus', chassis: 'BASTION', accent: 1 }
  ], 7);
  match.phase = 'REGULATION';
  match.players.p1.position = { x: 100, y: 200 };
  return match;
}

function heavy(attackId: number, chargeMs: number = GAME.heavyMaxChargeMs): AttackRuntime {
  const profile = profileForAttack('HEAVY');
  return {
    attackId,
    kind: 'HEAVY',
    profileId: profile.id,
    phase: 'ACTIVE',
    phaseRemainingMs: profile.activeMs,
    phaseElapsedMs: 0,
    previousActiveProgress: 0,
    lockedFacing: { x: 0, y: 1 },
    chargeMs,
    hitPlayerIds: new Set(),
    resolvedPlayerIds: new Set()
  };
}

describe('authoritative Neon Pulse lifecycle', () => {
  it('spawns only at the exact full-charge threshold from the heavy path forward-most point', () => {
    const match = state();
    const below = heavy(1, GAME.heavyMaxChargeMs - 1);
    expect(spawnNeonPulse(match, match.players.p1, below)).toBeNull();

    const attack = heavy(2);
    const spawned = spawnNeonPulse(match, match.players.p1, attack);

    expect(spawned).toEqual({
      pulse: expect.objectContaining({
        projectileId: 1,
        ownerPlayerId: 'p1',
        originatingAttackId: 2,
        position: { x: 100, y: 274 },
        previousPosition: { x: 100, y: 274 },
        velocity: { x: 0, y: 900 },
        radius: 18,
        remainingMs: 400
      }),
      event: {
        type: 'PULSE_SPAWN', eventId: 1, tick: 0, projectileId: 1,
        ownerPlayerId: 'p1', originatingAttackId: 2, position: { x: 100, y: 274 }
      }
    });
    expect(spawned?.pulse.hitPlayerIds).toBe(attack.hitPlayerIds);
  });

  it('spawns one pulse per live originating attack and assigns stable projectile IDs', () => {
    const match = state();
    const firstAttack = heavy(9);
    const secondAttack = heavy(10);

    expect(spawnNeonPulse(match, match.players.p1, firstAttack)?.pulse.projectileId).toBe(1);
    expect(spawnNeonPulse(match, match.players.p1, firstAttack)).toBeNull();
    expect(spawnNeonPulse(match, match.players.p1, secondAttack)?.pulse.projectileId).toBe(2);
    expect(Object.keys(match.pulses)).toEqual(['1', '2']);
  });

  it('travels continuously at 900 units per second and expires at 400 ms after at most 360 units', () => {
    const match = state();
    const pulse = spawnNeonPulse(match, match.players.p1, heavy(1))!.pulse;

    advancePulses(match, 100);
    expect(pulse.previousPosition).toEqual({ x: 100, y: 274 });
    expect(pulse.position).toEqual({ x: 100, y: 364 });
    expect(pulse.remainingMs).toBe(300);

    advancePulses(match, 1_000);
    expect(pulse.position).toEqual({ x: 100, y: 634 });
    expect(pulse.remainingMs).toBe(0);
    expect(match.pulses).toEqual({});
  });

  it('removes one pulse, all pulses for an owner, and every pulse on match cleanup', () => {
    const match = state();
    spawnNeonPulse(match, match.players.p1, heavy(1));
    spawnNeonPulse(match, match.players.p1, heavy(2));
    const other = heavy(3);
    other.lockedFacing = { x: 1, y: 0 };
    spawnNeonPulse(match, match.players.p2, other);

    removePulse(match, 1);
    expect(Object.keys(match.pulses)).toEqual(['2', '3']);
    removePulsesOwnedBy(match, 'p1');
    expect(Object.keys(match.pulses)).toEqual(['3']);
    clearPulses(match);
    expect(match.pulses).toEqual({});
  });
});
