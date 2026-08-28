import { GAME } from '../../shared/constants.js';
import { normalizeAim, normalizeAxes } from '../../shared/kinematics.js';
import type { GameEvent, InputFrame, MatchPhase, MatchPlayer, MatchSnapshot } from '../../shared/model.js';
import { advanceCombatTimers, resolveAttackHits, startActions } from './combat.js';
import { clamp, isKnockedOut } from './geometry.js';
import { advancePlayers, chooseSafestSpawn, platformAt, separateActivePlayers } from './movement.js';
import { createEmptyInput, type MatchState, type MutableMatchPlayer } from './state.js';

const compareStableIds = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

function eventMetadata(state: MatchState): Readonly<{ eventId: number; tick: number }> {
  return { eventId: state.nextEventId++, tick: state.tick };
}

function phaseRemaining(state: MatchState): number {
  return state.phase === 'COUNTDOWN' ? state.countdownRemainingMs : state.remainingMs;
}

function phaseEvent(state: MatchState, phase: MatchPhase): GameEvent {
  return { type: 'PHASE', ...eventMetadata(state), phase, remainingMs: phaseRemaining(state) };
}

function isFiniteInput(input: InputFrame): boolean {
  return Number.isSafeInteger(input.seq) &&
    Number.isFinite(input.moveX) && Number.isFinite(input.moveY) &&
    Number.isFinite(input.aimX) && Number.isFinite(input.aimY);
}

function acceptInputs(state: MatchState, inputs: ReadonlyMap<string, InputFrame>): void {
  for (const playerId of Object.keys(state.players).sort(compareStableIds)) {
    const player = state.players[playerId];
    const input = inputs.get(playerId);
    if (!player.connected || !input || !isFiniteInput(input) || input.seq <= player.lastProcessedInputSeq) continue;
    const movement = normalizeAxes(input.moveX, input.moveY);
    const facing = normalizeAim(input.aimX, input.aimY, player.facing);
    player.latestInput = {
      ...input,
      moveX: movement.x,
      moveY: movement.y,
      aimX: facing.x,
      aimY: facing.y
    };
    player.lastProcessedInputSeq = input.seq;
  }
}

function advanceMatchClocks(state: MatchState, stepMs: number, events: GameEvent[]): void {
  const elapsedMs = Math.max(0, stepMs);
  state.nowMs += elapsedMs;
  if (state.phase === 'COUNTDOWN') {
    state.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - elapsedMs);
    if (state.countdownRemainingMs === 0) {
      state.phase = 'REGULATION';
      events.push(phaseEvent(state, 'REGULATION'));
    }
  } else if (state.phase === 'REGULATION') {
    state.remainingMs = Math.max(0, state.remainingMs - elapsedMs);
  }
}

function respawnPlayer(state: MatchState, player: MutableMatchPlayer, events: GameEvent[]): void {
  player.position = chooseSafestSpawn(state, player.playerId);
  player.velocity = { x: 0, y: 0 };
  player.hitstunRemainingMs = 0;
  player.dashRemainingMs = 0;
  player.dashInvulnerabilityRemainingMs = 0;
  player.attack = null;
  player.comboStep = 0;
  player.chargeMs = 0;
  player.charging = false;
  player.bufferedQuick = false;
  player.lastAttackerId = null;
  player.lastAttackerAtMs = null;
  if (player.resetOverloadOnRespawn) player.overload = 0;
  player.resetOverloadOnRespawn = false;
  player.protectionRemainingMs = GAME.respawnProtectionMs;
  events.push({ type: 'RESPAWN', ...eventMetadata(state), playerId: player.playerId, position: { ...player.position } });
}

function advanceRespawns(state: MatchState, stepMs: number, events: GameEvent[]): void {
  const elapsedMs = Math.max(0, stepMs);
  for (const playerId of Object.keys(state.players).sort(compareStableIds)) {
    const player = state.players[playerId];
    if (!player.connected || player.respawnRemainingMs <= 0) continue;
    player.respawnRemainingMs = Math.max(0, player.respawnRemainingMs - elapsedMs);
    if (player.respawnRemainingMs === 0) respawnPlayer(state, player, events);
  }
}

function updateContraction(state: MatchState): void {
  if (state.phase === 'SUDDEN_DEATH') {
    state.contraction = 1;
    return;
  }
  const contractionStartRemaining = GAME.contractionWarningLeadMs - GAME.contractionWarningMs;
  state.contraction = clamp(
    (contractionStartRemaining - state.remainingMs) / GAME.contractionDurationMs,
    0,
    1
  );
}

function recentAttacker(state: MatchState, target: MutableMatchPlayer): string | null {
  if (!target.lastAttackerId || target.lastAttackerAtMs === null) return null;
  if (state.nowMs - target.lastAttackerAtMs > 4_000) return null;
  const attacker = state.players[target.lastAttackerId];
  return attacker && attacker.playerId !== target.playerId ? attacker.playerId : null;
}

function knockoutTransition(state: MatchState, targetId: string, forcedAttackerId?: string): readonly GameEvent[] {
  const target = state.players[targetId];
  if (!target || !target.connected || target.respawnRemainingMs > 0 || state.phase === 'FINISHED') return [];
  const forced = forcedAttackerId && forcedAttackerId !== targetId && state.players[forcedAttackerId]
    ? forcedAttackerId
    : null;
  const credited = forced ?? recentAttacker(state, target);
  target.stats.falls += 1;
  if (credited) {
    state.scores[credited] += 1;
    state.players[credited].stats.knockouts += 1;
  }
  target.respawnRemainingMs = GAME.knockoutToControlMs;
  target.resetOverloadOnRespawn = true;
  target.protectionRemainingMs = 0;
  target.velocity = { x: 0, y: 0 };
  target.hitstunRemainingMs = 0;
  target.attack = null;
  target.comboStep = 0;
  target.chargeMs = 0;
  target.charging = false;
  target.bufferedQuick = false;
  target.latestInput = { ...target.latestInput, quick: false, heavy: false, dash: false };
  return [{
    type: 'KNOCKOUT',
    ...eventMetadata(state),
    attackerId: credited,
    targetId,
    scoreAwardedTo: credited,
    scores: { ...state.scores }
  }];
}

function resolveBoundaries(state: MatchState): readonly GameEvent[] {
  const events: GameEvent[] = [];
  const platform = platformAt(state.contraction);
  for (const playerId of Object.keys(state.players).sort(compareStableIds)) {
    const player = state.players[playerId];
    if (player.connected && player.respawnRemainingMs <= 0 &&
      isKnockedOut(player.position, platform, GAME.knockoutDistance)) {
      events.push(...knockoutTransition(state, playerId));
    }
  }
  return events;
}

function finishMatch(state: MatchState, winnerPlayerId: string | null, reason: 'TARGET_SCORE' | 'TIME' | 'SUDDEN_DEATH' | 'NO_CONTEST'): GameEvent {
  state.phase = 'FINISHED';
  state.winnerPlayerId = winnerPlayerId;
  state.resultReason = reason;
  return { type: 'RESULT', ...eventMetadata(state), winnerPlayerId, reason, scores: { ...state.scores } };
}

function uniqueLeader(state: MatchState): string | null {
  const ranked = Object.keys(state.scores).sort((left, right) =>
    state.scores[right] - state.scores[left] || compareStableIds(left, right));
  if (ranked.length === 0 || (ranked[1] && state.scores[ranked[0]] === state.scores[ranked[1]])) return null;
  return ranked[0];
}

function evaluateResult(state: MatchState): readonly GameEvent[] {
  if (state.phase === 'FINISHED') return [];
  const targetWinner = Object.keys(state.scores)
    .filter((playerId) => state.scores[playerId] >= GAME.targetScore)
    .sort((left, right) => state.scores[right] - state.scores[left] || compareStableIds(left, right))[0];
  if (targetWinner) return [finishMatch(state, targetWinner, 'TARGET_SCORE')];
  if (state.phase === 'REGULATION' && state.remainingMs === 0) {
    const winner = uniqueLeader(state);
    if (winner) return [finishMatch(state, winner, 'TIME')];
    state.phase = 'SUDDEN_DEATH';
    state.contraction = 1;
    return [phaseEvent(state, 'SUDDEN_DEATH')];
  }
  if (state.phase === 'SUDDEN_DEATH') {
    const winner = uniqueLeader(state);
    if (winner) return [finishMatch(state, winner, 'SUDDEN_DEATH')];
  }
  return [];
}

export function stepMatch(
  state: MatchState,
  inputs: ReadonlyMap<string, InputFrame>,
  stepMs: number
): readonly GameEvent[] {
  if (state.phase === 'FINISHED') return [];
  if (state.phase === 'PAUSED') {
    if (state.pauseRemainingMs !== null) {
      state.pauseRemainingMs = Math.max(0, state.pauseRemainingMs - Math.max(0, stepMs));
      if (state.pauseRemainingMs === 0) return [finishMatch(state, null, 'NO_CONTEST')];
    }
    return [];
  }

  const activeAtStart = state.phase === 'REGULATION' || state.phase === 'SUDDEN_DEATH';
  const events: GameEvent[] = [];
  state.tick += 1;
  acceptInputs(state, inputs);
  advanceCombatTimers(state, stepMs);
  advanceRespawns(state, stepMs, events);
  advanceMatchClocks(state, stepMs, events);
  updateContraction(state);
  if (!activeAtStart) return events;
  startActions(state, stepMs);
  advancePlayers(state, stepMs);
  separateActivePlayers(state);
  events.push(...resolveAttackHits(state));
  events.push(...resolveBoundaries(state));
  events.push(...evaluateResult(state));
  return events;
}

function snapshotPlayer(player: MutableMatchPlayer): MatchPlayer {
  const action = player.respawnRemainingMs > 0
    ? { kind: 'RESPAWNING' as const, phase: 'IDLE' as const }
    : player.hitstunRemainingMs > 0
      ? { kind: 'HITSTUN' as const, phase: 'IDLE' as const }
      : player.dashRemainingMs > 0
        ? { kind: 'DASH' as const, phase: 'IDLE' as const }
        : player.attack
          ? { kind: player.attack.kind, phase: player.attack.phase }
          : { kind: null, phase: 'IDLE' as const };
  return {
    playerId: player.playerId,
    name: player.name,
    chassis: player.chassis,
    accent: player.accent,
    position: { ...player.position },
    velocity: { ...player.velocity },
    facing: { ...player.facing },
    overload: player.overload,
    lastProcessedInputSeq: player.lastProcessedInputSeq,
    action: {
      ...action,
      comboStep: player.comboStep,
      chargeMs: player.attack?.kind === 'HEAVY' ? player.attack.chargeMs : player.chargeMs
    },
    dashRemainingMs: player.dashRemainingMs,
    dashCooldownRemainingMs: player.dashCooldownRemainingMs,
    hitstunRemainingMs: player.hitstunRemainingMs,
    respawnRemainingMs: player.respawnRemainingMs,
    protectionRemainingMs: player.protectionRemainingMs,
    stats: { ...player.stats }
  };
}

export function snapshotMatch(state: MatchState): MatchSnapshot {
  return {
    tick: state.tick,
    phase: state.phase,
    remainingMs: phaseRemaining(state),
    platformProgress: state.contraction,
    scores: { ...state.scores },
    players: Object.keys(state.players)
      .filter((playerId) => state.players[playerId].connected)
      .sort(compareStableIds)
      .map((playerId) => snapshotPlayer(state.players[playerId])),
    winnerPlayerId: state.winnerPlayerId,
    resultReason: state.resultReason
  };
}

export function setPlayerConnected(state: MatchState, playerId: string, connected: boolean): readonly GameEvent[] {
  const player = state.players[playerId];
  if (!player || player.connected === connected) return [];
  player.connected = connected;
  player.latestInput = createEmptyInput();
  player.previousQuick = false;
  player.previousHeavy = false;
  player.previousDash = false;
  player.attack = null;
  player.comboStep = 0;
  player.chargeMs = 0;
  player.charging = false;
  player.bufferedQuick = false;
  player.velocity = { x: 0, y: 0 };
  player.hitstunRemainingMs = 0;
  player.dashRemainingMs = 0;
  player.dashInvulnerabilityRemainingMs = 0;
  player.protectionRemainingMs = 0;
  player.resetOverloadOnRespawn = false;
  player.respawnRemainingMs = connected ? GAME.reconnectWarpMs : 0;
  if (connected) player.position = chooseSafestSpawn(state, playerId);
  return [];
}

export function forceKnockout(state: MatchState, attackerId: string, targetId: string): readonly GameEvent[] {
  const events = [...knockoutTransition(state, targetId, attackerId)];
  if (events.length > 0) events.push(...evaluateResult(state));
  return events;
}

export function setMatchPaused(state: MatchState, remainingMs: number): readonly GameEvent[] {
  if (state.phase === 'PAUSED' || state.phase === 'FINISHED') return [];
  state.pausedPhase = state.phase;
  state.phase = 'PAUSED';
  state.pauseRemainingMs = Math.max(0, remainingMs);
  return [phaseEvent(state, 'PAUSED')];
}

export function resumePausedMatch(state: MatchState): readonly GameEvent[] {
  if (state.phase !== 'PAUSED' || !state.pausedPhase) return [];
  state.phase = state.pausedPhase;
  state.pausedPhase = null;
  state.pauseRemainingMs = null;
  return [phaseEvent(state, state.phase)];
}
