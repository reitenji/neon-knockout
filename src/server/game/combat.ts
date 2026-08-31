import { GAME } from '../../shared/constants.js';
import { profileForAttack } from '../../shared/combat/profiles.js';
import type { AttackKind } from '../../shared/model.js';
import type { MatchState, MutableMatchPlayer } from './state.js';
import type { ActiveAttackSlice } from './combatResolution.js';

const compareStableIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function activePlayer(player: MutableMatchPlayer): boolean {
  return player.connected && player.respawnRemainingMs <= 0;
}

function beginAttack(state: MatchState, player: MutableMatchPlayer, kind: AttackKind, chargeMs = 0): void {
  const profile = profileForAttack(kind);
  player.attack = {
    attackId: state.nextAttackId++,
    kind,
    profileId: profile.id,
    phase: 'WINDUP',
    phaseRemainingMs: profile.windupMs,
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

function advanceAttack(
  player: MutableMatchPlayer,
  elapsedMs: number,
  activeSlices: ActiveAttackSlice[],
  activated: ActiveAttackSlice[]
): void {
  let remainingElapsed = elapsedMs;
  while (player.attack && remainingElapsed > 0) {
    const attack = player.attack;
    const profile = profileForAttack(attack.kind);
    const consumedMs = Math.min(remainingElapsed, attack.phaseRemainingMs);

    if (attack.phase === 'ACTIVE') {
      const previousProgress = attack.phaseElapsedMs / profile.activeMs;
      attack.phaseElapsedMs += consumedMs;
      attack.phaseRemainingMs -= consumedMs;
      remainingElapsed -= consumedMs;
      const currentProgress = attack.phaseElapsedMs / profile.activeMs;
      const slice = {
        playerId: player.playerId,
        attack,
        previousProgress,
        currentProgress,
        enteredActive: previousProgress === 0
      } satisfies ActiveAttackSlice;
      activeSlices.push(slice);
      attack.previousActiveProgress = currentProgress;
      if (attack.phaseRemainingMs === 0) {
        attack.phase = 'RECOVERY';
        attack.phaseRemainingMs = profile.recoveryMs;
        attack.phaseElapsedMs = 0;
        player.stats.completedAttacks += 1;
      }
      continue;
    }

    attack.phaseElapsedMs += consumedMs;
    attack.phaseRemainingMs -= consumedMs;
    remainingElapsed -= consumedMs;
    if (attack.phaseRemainingMs > 0) return;

    if (attack.phase === 'WINDUP') {
      attack.phase = 'ACTIVE';
      attack.phaseRemainingMs = profile.activeMs;
      attack.phaseElapsedMs = 0;
      attack.previousActiveProgress = 0;
      activated.push({
        playerId: player.playerId,
        attack,
        previousProgress: 0,
        currentProgress: 0,
        enteredActive: true
      });
    } else {
      player.attack = null;
    }
  }
}

export type CombatTimerAdvance = Readonly<{
  activeSlices: readonly ActiveAttackSlice[];
  activated: readonly ActiveAttackSlice[];
}>;

export function advanceCombatTimers(state: MatchState, stepMs: number): CombatTimerAdvance {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') {
    return { activeSlices: [], activated: [] };
  }
  const elapsedMs = Math.max(0, stepMs);
  const activeSlices: ActiveAttackSlice[] = [];
  const activated: ActiveAttackSlice[] = [];
  for (const playerId of Object.keys(state.players).sort(compareStableIds)) {
    const player = state.players[playerId];
    if (!player.connected) continue;
    const wasCommitted = Boolean(player.attack) || player.hitstunRemainingMs > 0 ||
      player.dashRemainingMs > 0 || player.respawnRemainingMs > 0;
    player.hitstunRemainingMs = Math.max(0, player.hitstunRemainingMs - elapsedMs);
    if (player.respawnRemainingMs <= 0) {
      player.protectionRemainingMs = Math.max(0, player.protectionRemainingMs - elapsedMs);
    }
    advanceAttack(player, elapsedMs, activeSlices, activated);
    if (wasCommitted || player.attack || player.hitstunRemainingMs > 0 || player.dashRemainingMs > 0) {
      player.chargeMs = 0;
      player.charging = false;
    } else if (player.latestInput.heavy && player.respawnRemainingMs <= 0) {
      player.chargeMs = Math.min(GAME.heavyMaxChargeMs, player.chargeMs + elapsedMs);
      player.charging = player.chargeMs >= GAME.heavyEnterChargeMs;
    }
  }
  return { activeSlices, activated };
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
