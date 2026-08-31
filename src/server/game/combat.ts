import { GAME } from '../../shared/constants.js';
import { profileForAttack } from '../../shared/combat/profiles.js';
import type { AttackKind, GameEvent } from '../../shared/model.js';
import { clamp, dot, normalize, subtract } from './geometry.js';
import type { AttackRuntime, MatchState, MutableMatchPlayer } from './state.js';

const compareStableIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const MIN_EFFECTIVE_IMPULSE = GAME.quickCombo[0].baseImpulse *
  (1 + (GAME.quickCombo[0].overloadGain / GAME.maxOverload) * 0.9);
const MAX_EFFECTIVE_IMPULSE = GAME.heavyAttack.maxImpulse * 1.9;

type AttackTuning = Readonly<{
  range: number;
  arcDeg: number;
  overloadGain: number;
  baseImpulse: number;
  activeMs: number;
  recoveryMs: number;
}>;

function activePlayer(player: MutableMatchPlayer): boolean {
  return player.connected && player.respawnRemainingMs <= 0;
}

function quickTuning(kind: AttackKind): (typeof GAME.quickCombo)[number] | null {
  if (kind === 'HEAVY') return null;
  return GAME.quickCombo[Number(kind.at(-1)) - 1];
}

function tuningFor(attack: AttackRuntime): AttackTuning {
  const quick = quickTuning(attack.kind);
  if (quick) return { ...quick };
  const chargeProgress = clamp(
    (attack.chargeMs - GAME.heavyEnterChargeMs) /
      (GAME.heavyMaxChargeMs - GAME.heavyEnterChargeMs),
    0,
    1
  );
  return {
    range: GAME.heavyAttack.range,
    arcDeg: GAME.heavyAttack.arcDeg,
    overloadGain: GAME.heavyAttack.minOverloadGain +
      (GAME.heavyAttack.maxOverloadGain - GAME.heavyAttack.minOverloadGain) * chargeProgress,
    baseImpulse: GAME.heavyAttack.minImpulse +
      (GAME.heavyAttack.maxImpulse - GAME.heavyAttack.minImpulse) * chargeProgress,
    activeMs: GAME.heavyActiveMs,
    recoveryMs: GAME.heavyRecoveryMs
  };
}

function beginAttack(state: MatchState, player: MutableMatchPlayer, kind: AttackKind, chargeMs = 0): void {
  const quick = quickTuning(kind);
  const profile = profileForAttack(kind);
  player.attack = {
    attackId: state.nextAttackId++,
    kind,
    profileId: profile.id,
    phase: 'WINDUP',
    phaseRemainingMs: quick?.windupMs ?? GAME.heavyWindupMs,
    phaseElapsedMs: 0,
    previousActiveProgress: 0,
    lockedFacing: { x: player.latestInput.aimX, y: player.latestInput.aimY },
    chargeMs,
    hitPlayerIds: new Set(),
    resolvedPlayerIds: new Set()
  };
  player.comboStep = kind === 'HEAVY' ? 0 : Number(kind.at(-1)) as 1 | 2 | 3;
  player.chargeMs = 0;
  player.charging = false;
  player.bufferedQuick = false;
  player.protectionRemainingMs = 0;
}

function advanceAttack(player: MutableMatchPlayer, elapsedMs: number): void {
  let remainingElapsed = elapsedMs;
  while (player.attack && remainingElapsed > 0) {
    if (remainingElapsed < player.attack.phaseRemainingMs) {
      player.attack.phaseRemainingMs -= remainingElapsed;
      return;
    }
    remainingElapsed -= player.attack.phaseRemainingMs;
    const tuning = tuningFor(player.attack);
    if (player.attack.phase === 'WINDUP') {
      player.attack.phase = 'ACTIVE';
      player.attack.phaseRemainingMs = tuning.activeMs;
    } else if (player.attack.phase === 'ACTIVE') {
      player.attack.phase = 'RECOVERY';
      player.attack.phaseRemainingMs = tuning.recoveryMs;
      player.stats.completedAttacks += 1;
    } else {
      player.attack = null;
    }
  }
}

export function advanceCombatTimers(state: MatchState, stepMs: number): void {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return;
  const elapsedMs = Math.max(0, stepMs);
  for (const playerId of Object.keys(state.players).sort(compareStableIds)) {
    const player = state.players[playerId];
    if (!player.connected) continue;
    const wasCommitted = Boolean(player.attack) || player.hitstunRemainingMs > 0 ||
      player.dashRemainingMs > 0 || player.respawnRemainingMs > 0;
    player.hitstunRemainingMs = Math.max(0, player.hitstunRemainingMs - elapsedMs);
    if (player.respawnRemainingMs <= 0) {
      player.protectionRemainingMs = Math.max(0, player.protectionRemainingMs - elapsedMs);
    }
    advanceAttack(player, elapsedMs);
    if (wasCommitted || player.attack || player.hitstunRemainingMs > 0 || player.dashRemainingMs > 0) {
      player.chargeMs = 0;
      player.charging = false;
    } else if (player.latestInput.heavy && player.respawnRemainingMs <= 0) {
      player.chargeMs = Math.min(GAME.heavyMaxChargeMs, player.chargeMs + elapsedMs);
      player.charging = player.chargeMs >= GAME.heavyEnterChargeMs;
    }
  }
}

export function startActions(state: MatchState, timersElapsedMs = 0): void {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return;
  for (const playerId of Object.keys(state.players).sort(compareStableIds)) {
    const player = state.players[playerId];
    const quickEdge = player.latestInput.quick && !player.previousQuick;
    const heavyRelease = !player.latestInput.heavy && player.previousHeavy;
    const dashEdge = player.latestInput.dash && !player.previousDash;
    const canAct = activePlayer(player) && player.hitstunRemainingMs <= 0 &&
      player.dashRemainingMs <= Math.max(0, timersElapsedMs);

    if (!canAct || player.attack) {
      if (player.latestInput.dash) player.previousDash = true;
    }
    if (dashEdge && canAct && !player.attack) {
      player.chargeMs = 0;
      player.charging = false;
    }
    if (
      quickEdge && player.attack?.phase === 'RECOVERY' &&
      player.attack.kind !== 'HEAVY' && player.comboStep < 3 &&
      player.attack.phaseRemainingMs <= GAME.quickBufferMs
    ) {
      player.bufferedQuick = true;
    }

    let started = false;
    if (canAct && !player.attack && !dashEdge) {
      if (heavyRelease && player.chargeMs >= GAME.heavyEnterChargeMs) {
        beginAttack(state, player, 'HEAVY', Math.min(player.chargeMs, GAME.heavyMaxChargeMs));
        started = true;
      } else if ((player.bufferedQuick || quickEdge) && player.chargeMs === 0) {
        const nextStep = player.comboStep >= 1 && player.comboStep < 3 ? player.comboStep + 1 : 1;
        beginAttack(state, player, `QUICK_${nextStep}` as AttackKind);
        started = true;
      }
    }

    if (!player.latestInput.heavy && !started) {
      player.chargeMs = 0;
      player.charging = false;
    }
    if (!player.attack && !started) {
      player.comboStep = 0;
      player.bufferedQuick = false;
    }
    player.previousQuick = player.latestInput.quick;
    player.previousHeavy = player.latestInput.heavy;
  }
}

function hitstunFor(impulse: number): number {
  const progress = clamp(
    (impulse - MIN_EFFECTIVE_IMPULSE) / (MAX_EFFECTIVE_IMPULSE - MIN_EFFECTIVE_IMPULSE),
    0,
    1
  );
  return 90 + progress * 140;
}

function inAttackArc(attacker: MutableMatchPlayer, target: MutableMatchPlayer, tuning: AttackTuning): boolean {
  const delta = subtract(target.position, attacker.position);
  const distanceSquared = dot(delta, delta);
  if (distanceSquared > tuning.range * tuning.range || distanceSquared <= 1e-9) return false;
  const direction = normalize(delta);
  return dot(attacker.attack!.lockedFacing, direction) >= Math.cos((tuning.arcDeg * Math.PI) / 360);
}

export function resolveAttackHits(state: MatchState): readonly GameEvent[] {
  const events: GameEvent[] = [];
  const attackers = Object.values(state.players)
    .filter((player) => activePlayer(player) && player.attack?.phase === 'ACTIVE')
    .sort((left, right) =>
      left.attack!.attackId - right.attack!.attackId || compareStableIds(left.playerId, right.playerId));

  for (const attacker of attackers) {
    const attack = attacker.attack!;
    const tuning = tuningFor(attack);
    const targets = Object.values(state.players)
      .filter((target) =>
        target.playerId !== attacker.playerId && activePlayer(target) &&
        target.protectionRemainingMs <= 0 && target.dashInvulnerabilityRemainingMs <= 0 &&
        !attack.hitPlayerIds.has(target.playerId) && inAttackArc(attacker, target, tuning))
      .sort((left, right) => {
        const leftDelta = subtract(left.position, attacker.position);
        const rightDelta = subtract(right.position, attacker.position);
        return dot(leftDelta, leftDelta) - dot(rightDelta, rightDelta) || compareStableIds(left.playerId, right.playerId);
      });

    for (const target of targets) {
      const firstLandedTarget = attack.hitPlayerIds.size === 0;
      attack.hitPlayerIds.add(target.playerId);
      if (firstLandedTarget) attacker.stats.landedHits += 1;
      target.overload = Math.min(GAME.maxOverload, target.overload + tuning.overloadGain);
      const impulse = tuning.baseImpulse * (1 + (target.overload / GAME.maxOverload) * 0.9);
      const direction = normalize(attack.lockedFacing, { x: 1, y: 0 });
      target.velocity = {
        x: target.velocity.x + direction.x * impulse,
        y: target.velocity.y + direction.y * impulse
      };
      target.hitstunRemainingMs = Math.max(target.hitstunRemainingMs, hitstunFor(impulse));
      target.lastAttackerId = attacker.playerId;
      target.lastAttackerAtMs = state.nowMs;
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
