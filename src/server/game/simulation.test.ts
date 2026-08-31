import { describe, expect, it } from 'vitest';
import { ARENA, GAME } from '../../shared/constants.js';
import type { InputFrame } from '../../shared/model.js';
import { advanceCombatTimers } from './combat.js';
import { forceKnockout, resumePausedMatch, setMatchPaused, setPlayerConnected, snapshotMatch, stepMatch } from './simulation.js';
import { createMatchState, type MatchState } from './state.js';

const idle = (seq: number, overrides: Partial<InputFrame> = {}): InputFrame => ({
  seq, moveX: 0, moveY: 0, aimX: 1, aimY: 0, quick: false, heavy: false, dash: false, ...overrides
});
const seeds = () => [
  { playerId: 'p1', name: 'Ada', accent: 0 as const, chassis: 'RIFT' as const },
  { playerId: 'p2', name: 'Linus', accent: 1 as const, chassis: 'BASTION' as const }
];
function regulationState(): MatchState {
  const state = createMatchState(seeds(), 0);
  state.phase = 'REGULATION';
  return state;
}

describe('authoritative match simulation', () => {
  it('snapshots scores as a record and connected players in stable order', () => {
    const snapshot = snapshotMatch(createMatchState(seeds().reverse(), 0));
    expect(snapshot).toMatchObject({ tick: 0, phase: 'COUNTDOWN', remainingMs: GAME.countdownMs, scores: { p1: 0, p2: 0 } });
    expect(snapshot.players.map((player) => player.playerId)).toEqual(['p1', 'p2']);
  });

  it('unlocks regulation after countdown without applying gameplay in that countdown step', () => {
    const state = createMatchState(seeds(), 0);
    const original = state.players.p1.position;
    const events = stepMatch(state, new Map([['p1', idle(0, { moveX: 1 })]]), GAME.countdownMs);
    expect(state.phase).toBe('REGULATION');
    expect(state.players.p1.position).toEqual(original);
    expect(events).toContainEqual(expect.objectContaining({ type: 'PHASE', phase: 'REGULATION' }));
  });

  it('accepts only newer finite inputs and normalizes movement and aim', () => {
    const state = regulationState();
    stepMatch(state, new Map([['p1', idle(4, { moveX: 2, moveY: 2, aimX: 3, aimY: 4 })]]), 0);
    expect(state.players.p1.latestInput.seq).toBe(4);
    expect(state.players.p1.latestInput.moveX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(state.players.p1.latestInput.moveY).toBeCloseTo(Math.SQRT1_2, 12);
    expect(state.players.p1.latestInput.aimX).toBeCloseTo(0.6, 12);
    expect(state.players.p1.latestInput.aimY).toBeCloseTo(0.8, 12);
    stepMatch(state, new Map([['p1', idle(3, { moveX: -1 })]]), 0);
    stepMatch(state, new Map([['p1', idle(5, { aimX: Number.NaN })]]), 0);
    expect(state.players.p1.latestInput.seq).toBe(4);
  });

  it('emits monotonic event IDs and ticks for ordered hits and knockouts', () => {
    const state = regulationState();
    state.players.p1.position = { x: 600, y: 360 };
    state.players.p2.position = { x: 650, y: 360 };
    stepMatch(state, new Map([['p1', idle(0, { quick: true })]]), 0);
    const events = [
      ...stepMatch(
        state,
        new Map([['p1', idle(1)]]),
        GAME.quickCombo[0].windupMs + GAME.quickCombo[0].activeMs
      ),
      ...forceKnockout(state, 'p1', 'p2')
    ];
    expect(events.map((event) => event.type)).toEqual(['HIT', 'KNOCKOUT']);
    expect(events.map((event) => event.eventId)).toEqual([1, 2]);
    expect(events[0].tick).toBeLessThanOrEqual(events[1].tick);
  });

  it('resolves the terminal active sweep slice when the same 60 Hz step enters recovery', () => {
    const state = regulationState();
    state.players.p1.position = { x: 600, y: 360 };
    state.players.p2.position = { x: 642, y: 392 };
    stepMatch(state, new Map([['p1', idle(0, { quick: true })]]), 0);
    advanceCombatTimers(state, GAME.quickCombo[0].windupMs + 50);

    const events = stepMatch(state, new Map([['p1', idle(1)]]), 1_000 / 60);

    expect(state.players.p1.attack?.phase).toBe('RECOVERY');
    expect(events).toEqual([expect.objectContaining({ type: 'HIT', attackerId: 'p1', targetId: 'p2' })]);
  });

  it('allows an attack on the exact step an active dash expires', () => {
    const state = regulationState();
    state.players.p1.dashRemainingMs = 1;
    const events = stepMatch(state, new Map([['p1', idle(0, { quick: true })]]), 1);
    expect(events).toEqual([]);
    expect(state.players.p1.attack?.kind).toBe('QUICK_1');
  });

  it('does not turn a held dash during a committed attack into a delayed dash', () => {
    const state = regulationState();
    stepMatch(state, new Map([['p1', idle(0, { heavy: true })]]), GAME.heavyMaxChargeMs);
    stepMatch(state, new Map([['p1', idle(1)]]), 0);
    stepMatch(state, new Map([['p1', idle(2, { dash: true })]]), GAME.heavyWindupMs);
    stepMatch(state, new Map([['p1', idle(3, { dash: true })]]), GAME.heavyActiveMs);
    stepMatch(state, new Map([['p1', idle(4, { dash: true })]]), GAME.heavyRecoveryMs);
    expect(state.players.p1.dashRemainingMs).toBe(0);

    stepMatch(state, new Map([['p1', idle(5)]]), 0);
    stepMatch(state, new Map([['p1', idle(6, { dash: true })]]), 0);
    expect(state.players.p1.dashRemainingMs).toBe(GAME.dashDurationMs);
  });

  it('credits the last opponent inside four seconds and never credits a self-fall', () => {
    const credited = regulationState();
    credited.players.p2.lastAttackerId = 'p1';
    credited.players.p2.lastAttackerAtMs = credited.nowMs - 4_000;
    credited.players.p2.position = { x: 640, y: 0 };
    expect(stepMatch(credited, new Map(), 0)).toContainEqual(expect.objectContaining({
      type: 'KNOCKOUT', targetId: 'p2', scoreAwardedTo: 'p1', scores: { p1: 1, p2: 0 }
    }));
    const selfFall = regulationState();
    selfFall.players.p2.position = { x: 640, y: 0 };
    expect(stepMatch(selfFall, new Map(), 0)).toContainEqual(expect.objectContaining({
      type: 'KNOCKOUT', attackerId: null, targetId: 'p2', scoreAwardedTo: null
    }));
    expect(selfFall.scores).toEqual({ p1: 0, p2: 0 });
    expect(selfFall.players.p2.stats.falls).toBe(1);
  });

  it('expires knockout credit after four seconds', () => {
    const state = regulationState();
    state.players.p2.lastAttackerId = 'p1';
    state.players.p2.lastAttackerAtMs = state.nowMs - 4_001;
    state.players.p2.position = { x: 640, y: 0 };
    expect(stepMatch(state, new Map(), 0)).toContainEqual(expect.objectContaining({ type: 'KNOCKOUT', scoreAwardedTo: null }));
  });

  it('finishes for the first target scorer in stable simultaneous-boundary order', () => {
    const state = createMatchState([
      { playerId: 'z-scorer', name: 'Zoe', accent: 3, chassis: 'WRAITH' },
      { playerId: 'p2', name: 'Linus', accent: 1, chassis: 'BASTION' },
      { playerId: 'a-scorer', name: 'Ada', accent: 0, chassis: 'RIFT' },
      { playerId: 'p1', name: 'Grace', accent: 2, chassis: 'PULSE' }
    ], 0);
    state.phase = 'REGULATION';
    state.scores['z-scorer'] = GAME.targetScore - 1;
    state.scores['a-scorer'] = GAME.targetScore - 1;
    state.players.p1.position = { x: 500, y: 0 };
    state.players.p1.lastAttackerId = 'z-scorer';
    state.players.p1.lastAttackerAtMs = state.nowMs;
    state.players.p2.position = { x: 780, y: 0 };
    state.players.p2.lastAttackerId = 'a-scorer';
    state.players.p2.lastAttackerAtMs = state.nowMs;

    const events = stepMatch(state, new Map(), 0);

    expect(events.map((event) => event.type)).toEqual(['KNOCKOUT', 'RESULT']);
    expect(events.map((event) => event.eventId)).toEqual([1, 2]);
    expect(events[0]).toMatchObject({ targetId: 'p1', scoreAwardedTo: 'z-scorer' });
    expect(events[1]).toMatchObject({ winnerPlayerId: 'z-scorer', reason: 'TARGET_SCORE' });
    expect(state.scores['z-scorer']).toBe(GAME.targetScore);
    expect(state.scores['a-scorer']).toBe(GAME.targetScore - 1);
    expect(state.players.p2.stats.falls).toBe(0);
    expect(state.players.p2.respawnRemainingMs).toBe(0);
  });

  it('does not credit a recent attacker knocked out earlier in the same boundary phase', () => {
    const state = regulationState();
    state.players.p1.position = { x: 500, y: 0 };
    state.players.p2.position = { x: 780, y: 0 };
    state.players.p2.lastAttackerId = 'p1';
    state.players.p2.lastAttackerAtMs = state.nowMs;

    const events = stepMatch(state, new Map(), 0);

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'KNOCKOUT', targetId: 'p1', scoreAwardedTo: null });
    expect(events[1]).toMatchObject({ type: 'KNOCKOUT', targetId: 'p2', scoreAwardedTo: null });
    expect(events.map((event) => event.eventId)).toEqual([1, 2]);
    expect(state.scores).toEqual({ p1: 0, p2: 0 });
    expect(state.players.p1.stats.knockouts).toBe(0);
  });

  it('returns control at 700 ms with a deterministic spawn and 650 ms protection', () => {
    const state = regulationState();
    forceKnockout(state, 'p1', 'p2');
    expect(stepMatch(state, new Map(), GAME.knockoutToControlMs - 1)).toEqual([]);
    const events = stepMatch(state, new Map(), 1);
    expect(events).toContainEqual(expect.objectContaining({ type: 'RESPAWN', playerId: 'p2' }));
    expect(state.players.p2.position).toEqual(ARENA.spawnAnchors[3]);
    expect(state.players.p2.overload).toBe(0);
    expect(state.players.p2.protectionRemainingMs).toBe(GAME.respawnProtectionMs);
  });

  it('warns for three seconds, contracts for seventeen, and stays at minimum size', () => {
    const state = regulationState();
    state.remainingMs = 30_000;
    stepMatch(state, new Map(), 2_999);
    expect(state.contraction).toBe(0);
    stepMatch(state, new Map(), 1);
    expect(state.contraction).toBe(0);
    stepMatch(state, new Map(), 8_500);
    expect(state.contraction).toBeCloseTo(0.5, 8);
    stepMatch(state, new Map(), 8_500);
    expect(state.contraction).toBe(1);
  });

  it('finishes regulation for a unique timed leader', () => {
    const state = regulationState();
    state.scores = { p1: 2, p2: 1 };
    state.remainingMs = 1;
    expect(stepMatch(state, new Map(), 1)).toContainEqual(expect.objectContaining({ type: 'RESULT', winnerPlayerId: 'p1', reason: 'TIME' }));
  });

  it('enters sudden death for tied leaders and ends on the next unique score', () => {
    const state = regulationState();
    state.scores = { p1: 2, p2: 2 };
    state.remainingMs = 1;
    expect(stepMatch(state, new Map(), 1)).toContainEqual(expect.objectContaining({ type: 'PHASE', phase: 'SUDDEN_DEATH' }));
    expect(forceKnockout(state, 'p1', 'p2')).toContainEqual(expect.objectContaining({ type: 'RESULT', winnerPlayerId: 'p1', reason: 'SUDDEN_DEATH' }));
  });

  it('finishes immediately at the target score', () => {
    const state = regulationState();
    state.scores.p1 = GAME.targetScore - 1;
    const events = forceKnockout(state, 'p1', 'p2');
    expect(events.map((event) => event.type)).toEqual(['KNOCKOUT', 'RESULT']);
    expect(events.map((event) => event.eventId)).toEqual([1, 2]);
    expect(events[1]).toMatchObject({ winnerPlayerId: 'p1', reason: 'TARGET_SCORE' });
  });

  it('disconnects without awards and reconnects after a 180 ms warp with preserved state', () => {
    const state = regulationState();
    const player = state.players.p2;
    player.overload = 73;
    player.stats = { knockouts: 2, falls: 3, landedHits: 4, completedAttacks: 5 };
    state.scores.p2 = 2;
    expect(setPlayerConnected(state, 'p2', false)).toEqual([]);
    expect(snapshotMatch(state).players.map(({ playerId }) => playerId)).toEqual(['p1']);
    expect(player.stats).toEqual({ knockouts: 2, falls: 3, landedHits: 4, completedAttacks: 5 });
    expect(setPlayerConnected(state, 'p2', true)).toEqual([]);
    expect(player.respawnRemainingMs).toBe(GAME.reconnectWarpMs);
    expect(stepMatch(state, new Map(), GAME.reconnectWarpMs - 1)).toEqual([]);
    expect(stepMatch(state, new Map(), 1)).toContainEqual(expect.objectContaining({ type: 'RESPAWN', playerId: 'p2' }));
    expect(player.overload).toBe(73);
    expect(player.protectionRemainingMs).toBe(GAME.respawnProtectionMs);
    expect(player.stats).toEqual({ knockouts: 2, falls: 3, landedHits: 4, completedAttacks: 5 });
  });

  it('freezes every combat clock while paused and resumes the prior phase', () => {
    const state = regulationState();
    state.players.p1.hitstunRemainingMs = 500;
    const paused = setMatchPaused(state, 8_000);
    const before = snapshotMatch(state);
    expect(stepMatch(state, new Map(), 1_000)).toEqual([]);
    expect(snapshotMatch(state)).toEqual(before);
    const resumed = resumePausedMatch(state);
    expect(paused).toContainEqual(expect.objectContaining({ type: 'PHASE', phase: 'PAUSED' }));
    expect(resumed).toContainEqual(expect.objectContaining({ type: 'PHASE', phase: 'REGULATION' }));
  });

  it('replays identical inputs to identical final state and ordered events', () => {
    const replay = () => {
      const state = regulationState();
      state.players.p1.position = { x: 600, y: 360 };
      state.players.p2.position = { x: 650, y: 360 };
      const events = [
        ...stepMatch(state, new Map([['p1', idle(0, { quick: true })]]), 0),
        ...stepMatch(state, new Map([['p1', idle(1)]]), 130),
        ...forceKnockout(state, 'p1', 'p2'),
        ...stepMatch(state, new Map(), 700)
      ];
      return JSON.stringify({ state, events });
    };
    expect(replay()).toBe(replay());
  });
});
