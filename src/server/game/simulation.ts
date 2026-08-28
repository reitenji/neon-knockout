import type { GameEvent, InputFrame, MatchSnapshot, Team, Vec2 } from '../../shared/model.js';
import { ARENA, GAME } from '../../shared/constants.js';
import { circleIntersectsRect, movePlayer, pushCircle, separatePlayers } from './geometry.js';
import type { MatchState } from './state.js';

const compareStableIds = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function snapshotMatch(state: MatchState): MatchSnapshot {
  return {
    tick: state.tick,
    phase: state.phase,
    remainingMs:
      state.phase === 'COUNTDOWN' || (state.phase === 'PAUSED' && state.pausedPhase === 'COUNTDOWN')
        ? state.countdownRemainingMs
        : state.remainingMs,
    score: { ...state.score },
    players: Object.values(state.players)
      .filter((player) => player.connected)
      .sort((left, right) => compareStableIds(left.playerId, right.playerId))
      .map((player) => ({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
        position: { ...player.position },
        carriedCoreId: player.carriedCoreId,
        lastProcessedInputSeq: player.lastProcessedInputSeq,
        dashRemainingMs: player.dashRemainingMs,
        dashCooldownRemainingMs: player.dashCooldownRemainingMs,
        stunRemainingMs: player.stunRemainingMs,
        stats: { ...player.stats }
      })),
    cores: Object.values(state.cores)
      .sort((left, right) => compareStableIds(left.coreId, right.coreId))
      .map((core) => ({
        coreId: core.coreId,
        position: { ...core.position },
        carrierId: core.carrierId,
        golden: core.golden
      })),
    winner: state.winner
  };
}

export function setPlayerConnected(
  state: MatchState,
  playerId: string,
  connected: boolean
): readonly GameEvent[] {
  const player = state.players[playerId];
  if (!player || player.connected === connected) return [];
  player.connected = connected;
  const events: GameEvent[] = [];

  if (!connected) {
    player.latestInput = {
      ...player.latestInput,
      up: false,
      down: false,
      left: false,
      right: false,
      dash: false
    };
    player.previousDashPressed = false;
    if (player.carriedCoreId !== null) {
      const core = state.cores[player.carriedCoreId];
      player.carriedCoreId = null;
      if (core) {
        core.carrierId = null;
        core.position = player.position;
        core.blockedPlayerId = null;
        core.blockedRemainingMs = 0;
        core.looseRemainingMs = GAME.coreReturnMs;
        core.droppedTick = state.tick;
        events.push({ type: 'DROP', playerId, coreId: core.coreId, position: player.position });
      }
    }
  }

  const connectedCount = Object.values(state.players).filter((candidate) => candidate.connected).length;
  if (
    connectedCount < 2 &&
    (state.phase === 'COUNTDOWN' || state.phase === 'REGULATION' || state.phase === 'SUDDEN_DEATH')
  ) {
    state.pausedPhase = state.phase;
    state.phase = 'PAUSED';
    events.push({ type: 'PHASE', phase: 'PAUSED' });
  } else if (connectedCount >= 2 && state.phase === 'PAUSED') {
    state.phase = state.pausedPhase ?? 'REGULATION';
    state.pausedPhase = null;
    events.push({ type: 'PHASE', phase: state.phase });
  }

  return events;
}

export function forceDelivery(state: MatchState, team: Team): readonly GameEvent[] {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return [];
  const player = Object.values(state.players)
    .filter((candidate) => candidate.connected && candidate.team === team)
    .sort((left, right) => compareStableIds(left.playerId, right.playerId))[0];
  if (!player) return [];

  const coreId = Object.keys(state.cores).sort()[0] ?? `forced-core-${state.score.CYAN + state.score.AMBER + 1}`;
  const core = state.cores[coreId];
  if (core?.carrierId) state.players[core.carrierId].carriedCoreId = null;
  if (core) {
    const pad = state.pads.find((candidate) => candidate.coreId === coreId);
    if (pad && !core.golden) pad.respawnRemainingMs = GAME.coreRespawnMs;
    delete state.cores[coreId];
  }
  player.stats.deliveries += 1;
  state.score[team] += 1;

  const events: GameEvent[] = [
    { type: 'SCORE', team, playerId: player.playerId, coreId, score: { ...state.score } }
  ];
  if (state.phase === 'SUDDEN_DEATH') {
    finishMatch(state, team, events);
  } else {
    evaluateMatchTransitions(state, Object.keys(state.players).sort(), events);
  }
  return events;
}

export function stepMatch(
  state: MatchState,
  inputs: ReadonlyMap<string, InputFrame>,
  stepMs: number
): readonly GameEvent[] {
  const events: GameEvent[] = [];
  const playerIds = Object.keys(state.players).sort();
  const coreIds = Object.keys(state.cores).sort();

  normalizeInputs(state, playerIds, inputs);
  startDashes(state, playerIds);
  const previousPositions = movePlayers(state, playerIds, stepMs);
  resolveObstacleAndBoundaryCollisions(state, playerIds, previousPositions);
  resolvePlayerSeparation(state, playerIds);
  resolveTackles(state, playerIds, events);
  updateDroppedCoreLocks(state, coreIds, stepMs);
  resolvePickups(state, playerIds, coreIds, events);
  resolveReactorDeliveries(state, playerIds, events);
  advanceTimers(state, playerIds, coreIds, stepMs);
  evaluateMatchTransitions(state, playerIds, events);
  state.tick += 1;
  return events;
}

function resolvePlayerSeparation(state: MatchState, playerIds: readonly string[]): void {
  if (state.phase === 'PAUSED' || state.phase === 'FINISHED') return;
  const connectedPlayerIds = playerIds.filter((playerId) => state.players[playerId].connected);
  separatePlayers(state.players, connectedPlayerIds);
  for (const playerId of connectedPlayerIds) {
    const player = state.players[playerId];
    if (player.carriedCoreId !== null) state.cores[player.carriedCoreId].position = player.position;
  }
}

function updateDroppedCoreLocks(state: MatchState, coreIds: readonly string[], stepMs: number): void {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return;
  for (const coreId of coreIds) {
    const core = state.cores[coreId];
    if (!core || core.blockedPlayerId === null || core.droppedTick === state.tick) continue;
    core.blockedRemainingMs = Math.max(0, core.blockedRemainingMs - stepMs);
    if (core.blockedRemainingMs === 0) core.blockedPlayerId = null;
  }
}

function resolveReactorDeliveries(
  state: MatchState,
  playerIds: readonly string[],
  events: GameEvent[]
): void {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return;

  for (const playerId of playerIds) {
    const player = state.players[playerId];
    if (!player.connected || player.carriedCoreId === null) continue;
    if (!circleIntersectsRect(player.position, GAME.playerRadius, ARENA.reactors[player.team])) continue;

    const core = state.cores[player.carriedCoreId];
    if (!core) continue;
    player.carriedCoreId = null;
    player.stats.deliveries += 1;
    state.score[player.team] += 1;
    const pad = state.pads.find((candidate) => candidate.coreId === core.coreId);
    if (pad && !core.golden) pad.respawnRemainingMs = GAME.coreRespawnMs;
    delete state.cores[core.coreId];
    events.push({
      type: 'SCORE',
      team: player.team,
      playerId,
      coreId: core.coreId,
      score: { ...state.score }
    });
  }
}

function movePlayers(
  state: MatchState,
  playerIds: readonly string[],
  stepMs: number
): Readonly<Record<string, Vec2>> {
  const previousPositions: Record<string, Vec2> = {};
  const active = state.phase === 'REGULATION' || state.phase === 'SUDDEN_DEATH';

  for (const playerId of playerIds) {
    const player = state.players[playerId];
    previousPositions[playerId] = player.position;
    if (!active || !player.connected || player.stunRemainingMs > 0) continue;
    const direction = {
      x: Number(player.latestInput.right) - Number(player.latestInput.left),
      y: Number(player.latestInput.down) - Number(player.latestInput.up)
    };
    const dashScale = player.dashRemainingMs > 0 ? GAME.dashMultiplier : 1;
    player.position = movePlayer(
      player.position,
      direction,
      stepMs * dashScale,
      player.carriedCoreId !== null
    );
  }

  return previousPositions;
}

function resolveObstacleAndBoundaryCollisions(
  state: MatchState,
  playerIds: readonly string[],
  previousPositions: Readonly<Record<string, Vec2>>
): void {
  for (const playerId of playerIds) {
    const player = state.players[playerId];
    const previous = previousPositions[playerId];
    const direction = {
      x: player.position.x - previous.x,
      y: player.position.y - previous.y
    };
    player.position = pushCircle(
      previous,
      direction,
      Math.hypot(direction.x, direction.y),
      GAME.playerRadius,
      ARENA.obstacles
    );
    if (player.carriedCoreId !== null) {
      state.cores[player.carriedCoreId].position = player.position;
    }
  }
}

function advanceTimers(
  state: MatchState,
  playerIds: readonly string[],
  coreIds: readonly string[],
  stepMs: number
): void {
  if (state.phase === 'PAUSED' || state.phase === 'FINISHED') return;
  for (const playerId of playerIds) {
    const player = state.players[playerId];
    player.dashRemainingMs = Math.max(0, player.dashRemainingMs - stepMs);
    player.dashCooldownRemainingMs = Math.max(0, player.dashCooldownRemainingMs - stepMs);
    if (player.stunnedTick !== state.tick) {
      player.stunRemainingMs = Math.max(0, player.stunRemainingMs - stepMs);
      if (player.stunRemainingMs === 0) player.stunnedTick = null;
    }
  }
  if (state.phase === 'REGULATION' || state.phase === 'SUDDEN_DEATH') {
    for (const coreId of coreIds) {
      const core = state.cores[coreId];
      if (!core) continue;
      if (core.carrierId !== null || core.golden || core.padIndex === null || core.droppedTick === state.tick) continue;
      core.looseRemainingMs = Math.max(0, core.looseRemainingMs - stepMs);
      if (core.looseRemainingMs > 0) continue;
      core.position = ARENA.corePads[core.padIndex];
      core.looseRemainingMs = GAME.coreReturnMs;
      core.blockedPlayerId = null;
      core.blockedRemainingMs = 0;
      core.droppedTick = null;
    }
    for (const pad of state.pads) {
      if (pad.respawnRemainingMs === null) continue;
      pad.respawnRemainingMs = Math.max(0, pad.respawnRemainingMs - stepMs);
      if (pad.respawnRemainingMs > 0) continue;
      state.cores[pad.coreId] = {
        coreId: pad.coreId,
        position: ARENA.corePads[pad.padIndex],
        carrierId: null,
        golden: false,
        padIndex: pad.padIndex,
        blockedPlayerId: null,
        blockedRemainingMs: 0,
        looseRemainingMs: GAME.coreReturnMs,
        droppedTick: null
      };
      pad.respawnRemainingMs = null;
    }
  }
  if (state.phase === 'COUNTDOWN') {
    state.countdownRemainingMs = Math.max(0, state.countdownRemainingMs - stepMs);
  } else if (state.phase === 'REGULATION') {
    state.remainingMs = Math.max(0, state.remainingMs - stepMs);
  }
}

function evaluateMatchTransitions(
  state: MatchState,
  playerIds: readonly string[],
  events: GameEvent[]
): void {
  if (state.phase === 'COUNTDOWN' && state.countdownRemainingMs <= 0) {
    state.phase = 'REGULATION';
    events.push({ type: 'PHASE', phase: 'REGULATION' });
    return;
  }

  if (state.phase === 'REGULATION') {
    const targetDelivery = events.find(
      (event) => event.type === 'SCORE' && event.score[event.team] >= GAME.targetScore
    );
    if (targetDelivery?.type === 'SCORE') {
      finishMatch(state, targetDelivery.team, events);
    } else if (state.remainingMs <= 0 && state.score.CYAN !== state.score.AMBER) {
      finishMatch(state, state.score.CYAN > state.score.AMBER ? 'CYAN' : 'AMBER', events);
    } else if (state.remainingMs <= 0) {
      enterSuddenDeath(state, playerIds, events);
    }
  } else if (state.phase === 'SUDDEN_DEATH' && state.score.CYAN !== state.score.AMBER) {
    finishMatch(state, state.score.CYAN > state.score.AMBER ? 'CYAN' : 'AMBER', events);
  }
}

function enterSuddenDeath(state: MatchState, playerIds: readonly string[], events: GameEvent[]): void {
  for (const playerId of playerIds) state.players[playerId].carriedCoreId = null;
  state.cores = {
    'golden-core': {
      coreId: 'golden-core',
      position: ARENA.corePads[1],
      carrierId: null,
      golden: true,
      padIndex: null,
      blockedPlayerId: null,
      blockedRemainingMs: 0,
      looseRemainingMs: GAME.coreReturnMs,
      droppedTick: null
    }
  };
  for (const pad of state.pads) pad.respawnRemainingMs = null;
  state.phase = 'SUDDEN_DEATH';
  events.push({ type: 'PHASE', phase: 'SUDDEN_DEATH' });
}

function finishMatch(state: MatchState, winner: 'CYAN' | 'AMBER' | null, events: GameEvent[]): void {
  state.phase = 'FINISHED';
  state.winner = winner;
  events.push({ type: 'PHASE', phase: 'FINISHED' });
  events.push({ type: 'RESULT', winner, score: { ...state.score } });
}

function normalizeInputs(
  state: MatchState,
  playerIds: readonly string[],
  inputs: ReadonlyMap<string, InputFrame>
): void {
  for (const playerId of playerIds) {
    const player = state.players[playerId];
    const input = inputs.get(playerId);
    if (!player.connected || !input || input.seq <= player.lastProcessedInputSeq) continue;
    player.latestInput = input;
    player.lastProcessedInputSeq = input.seq;
  }
}

function startDashes(state: MatchState, playerIds: readonly string[]): void {
  const active = state.phase === 'REGULATION' || state.phase === 'SUDDEN_DEATH';
  for (const playerId of playerIds) {
    const player = state.players[playerId];
    const risingEdge = player.latestInput.dash && !player.previousDashPressed;
    if (active && player.connected && risingEdge && player.dashCooldownRemainingMs <= 0) {
      player.dashRemainingMs = GAME.dashMs;
      player.dashCooldownRemainingMs = GAME.dashCooldownMs;
      player.tackledPlayerIds.clear();
    }
    player.previousDashPressed = player.latestInput.dash;
  }
}

function resolveTackles(state: MatchState, playerIds: readonly string[], events: GameEvent[]): void {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return;

  const contactDistanceSquared = (GAME.playerRadius * 2) ** 2;
  for (const attackerId of playerIds) {
    const attacker = state.players[attackerId];
    if (!attacker.connected || attacker.dashRemainingMs <= 0) continue;

    for (const targetId of playerIds) {
      const target = state.players[targetId];
      if (
        targetId === attackerId ||
        !target.connected ||
        target.team === attacker.team ||
        target.carriedCoreId === null ||
        attacker.tackledPlayerIds.has(targetId)
      ) {
        continue;
      }
      const dx = target.position.x - attacker.position.x;
      const dy = target.position.y - attacker.position.y;
      if (dx * dx + dy * dy > contactDistanceSquared) continue;

      const core = state.cores[target.carriedCoreId];
      if (!core) continue;
      const dropPosition = target.position;
      target.carriedCoreId = null;
      core.carrierId = null;
      core.position = dropPosition;
      core.blockedPlayerId = targetId;
      core.blockedRemainingMs = GAME.selfPickupLockMs;
      core.looseRemainingMs = GAME.coreReturnMs;
      core.droppedTick = state.tick;
      target.stunRemainingMs = GAME.tackleStunMs;
      target.stunnedTick = state.tick;

      const sameCenter = dx === 0 && dy === 0;
      const pushDirection = sameCenter
        ? { x: attackerId < targetId ? 1 : -1, y: 0 }
        : { x: dx, y: dy };
      target.position = pushCircle(
        target.position,
        pushDirection,
        52,
        GAME.playerRadius,
        ARENA.obstacles
      );

      attacker.tackledPlayerIds.add(targetId);
      attacker.stats.tackles += 1;
      events.push({ type: 'DROP', playerId: targetId, coreId: core.coreId, position: dropPosition });
      events.push({ type: 'TACKLE', attackerId, targetPlayerId: targetId, coreId: core.coreId });
    }
  }
}

function resolvePickups(
  state: MatchState,
  playerIds: readonly string[],
  coreIds: readonly string[],
  events: GameEvent[]
): void {
  if (state.phase !== 'REGULATION' && state.phase !== 'SUDDEN_DEATH') return;

  const pickupDistanceSquared = GAME.playerRadius ** 2;
  for (const coreId of coreIds) {
    const core = state.cores[coreId];
    if (core.carrierId !== null || core.droppedTick === state.tick) continue;

    let winnerId: string | null = null;
    let winnerDistanceSquared = Number.POSITIVE_INFINITY;
    for (const playerId of playerIds) {
      const candidate = state.players[playerId];
      if (
        !candidate.connected ||
        candidate.carriedCoreId !== null ||
        (core.blockedPlayerId === playerId && core.blockedRemainingMs > 0)
      ) {
        continue;
      }
      const distanceSquared =
        (candidate.position.x - core.position.x) ** 2 + (candidate.position.y - core.position.y) ** 2;
      if (distanceSquared <= pickupDistanceSquared && distanceSquared < winnerDistanceSquared) {
        winnerId = playerId;
        winnerDistanceSquared = distanceSquared;
      }
    }

    if (winnerId === null) continue;
    const winner = state.players[winnerId];
    core.carrierId = winner.playerId;
    winner.carriedCoreId = core.coreId;
    events.push({ type: 'PICKUP', playerId: winner.playerId, coreId: core.coreId });
  }
}
