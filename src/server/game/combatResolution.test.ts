import { describe, expect, it } from 'vitest';

import { GAME } from '../../shared/constants.js';
import { profileForAttack } from '../../shared/combat/profiles.js';
import type { AttackKind, Vec2 } from '../../shared/model.js';
import {
  buildActiveAttackShapes,
  resolveMeleeInteractions,
  type ActiveAttackShape,
  type ActiveAttackSlice
} from './combatResolution.js';
import { createMatchState, type AttackRuntime, type MatchState } from './state.js';

function createState(): MatchState {
  const state = createMatchState([
    { playerId: 'p4', name: 'Katherine', chassis: 'WRAITH', accent: 3 },
    { playerId: 'p2', name: 'Linus', chassis: 'BASTION', accent: 1 },
    { playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0 },
    { playerId: 'p3', name: 'Grace', chassis: 'PULSE', accent: 2 }
  ], 7);
  state.phase = 'REGULATION';
  state.players.p1.position = { x: 580, y: 360 };
  state.players.p2.position = { x: 650, y: 360 };
  state.players.p3.position = { x: 720, y: 360 };
  state.players.p4.connected = false;
  return state;
}

function attack(
  state: MatchState,
  playerId: string,
  attackId: number,
  kind: AttackKind,
  lockedFacing: Vec2 = { x: 1, y: 0 }
): AttackRuntime {
  const profile = profileForAttack(kind);
  const runtime: AttackRuntime = {
    attackId,
    kind,
    profileId: profile.id,
    phase: 'ACTIVE',
    phaseRemainingMs: profile.activeMs,
    phaseElapsedMs: 0,
    previousActiveProgress: 0,
    lockedFacing,
    chargeMs: kind === 'HEAVY' ? GAME.heavyMaxChargeMs : 0,
    hitPlayerIds: new Set(),
    resolvedPlayerIds: new Set()
  };
  state.players[playerId].attack = runtime;
  return runtime;
}

function shape(
  playerId: string,
  runtime: AttackRuntime,
  from: Vec2,
  to: Vec2,
  radius = 6
): ActiveAttackShape {
  return {
    playerId,
    attackId: runtime.attackId,
    kind: runtime.kind,
    capsule: { from, to, radius }
  };
}

describe('shared-shape melee resolution', () => {
  it('lands a visible swept-capsule contact and rejects a one-pixel near miss', () => {
    const hitState = createState();
    const hitAttack = attack(hitState, 'p1', 1, 'QUICK_1');
    const visible = shape('p1', hitAttack, { x: 620, y: 340 }, { x: 660, y: 380 });

    expect(resolveMeleeInteractions(hitState, [visible])).toEqual([
      expect.objectContaining({ type: 'HIT', attackerId: 'p1', targetId: 'p2' })
    ]);

    const missState = createState();
    missState.players.p2.position = { x: 660, y: 411 };
    const missAttack = attack(missState, 'p1', 1, 'QUICK_1');
    const nearMiss = shape('p1', missAttack, { x: 620, y: 340 }, { x: 660, y: 380 });

    expect(resolveMeleeInteractions(missState, [nearMiss])).toEqual([]);
    expect(missState.players.p2.overload).toBe(0);
  });

  it('resolves one target once per attack and every overlapping target in stable player-id order', () => {
    const state = createState();
    state.players.p3.position = { x: 650, y: 360 };
    state.players.p4.connected = true;
    state.players.p4.position = { x: 650, y: 360 };
    const runtime = attack(state, 'p1', 1, 'QUICK_1');
    const sweep = shape('p1', runtime, { x: 620, y: 340 }, { x: 660, y: 380 });

    const first = resolveMeleeInteractions(state, [sweep]);
    const repeated = resolveMeleeInteractions(state, [sweep]);

    expect(first.map((event) => event.type === 'HIT' ? event.targetId : '')).toEqual(['p2', 'p3', 'p4']);
    expect(repeated).toEqual([]);
    expect([...runtime.resolvedPlayerIds].sort()).toEqual(['p2', 'p3', 'p4']);
    expect([...runtime.hitPlayerIds].sort()).toEqual(['p2', 'p3', 'p4']);
    expect(state.players.p1.stats.landedHits).toBe(1);
  });

  it('cancels quick/quick before hurt circles with opposite 90-unit recoil and no hit effects', () => {
    const state = createState();
    const left = attack(state, 'p1', 2, 'QUICK_1');
    const right = attack(state, 'p2', 1, 'QUICK_2');
    const events = resolveMeleeInteractions(state, [
      shape('p1', left, { x: 640, y: 340 }, { x: 660, y: 380 }),
      shape('p2', right, { x: 660, y: 340 }, { x: 640, y: 380 })
    ]);

    expect(events).toEqual([expect.objectContaining({
      type: 'CLASH', playerIds: ['p2', 'p1'], attackIds: [1, 2], strength: 'QUICK'
    })]);
    expect(left.phase).toBe('RECOVERY');
    expect(right.phase).toBe('RECOVERY');
    expect(state.players.p1.velocity).toEqual({ x: -90, y: 0 });
    expect(state.players.p2.velocity).toEqual({ x: 90, y: 0 });
    expect(state.players.p1.overload).toBe(0);
    expect(state.players.p2.overload).toBe(0);
    expect(state.players.p1.hitstunRemainingMs).toBe(0);
    expect(state.players.p2.hitstunRemainingMs).toBe(0);
  });

  it('lets heavy break quick while heavy remains active without clash recoil or hitstun', () => {
    const state = createState();
    const quick = attack(state, 'p1', 2, 'QUICK_1');
    const heavy = attack(state, 'p2', 1, 'HEAVY');
    const events = resolveMeleeInteractions(state, [
      shape('p1', quick, { x: 640, y: 340 }, { x: 660, y: 380 }),
      shape('p2', heavy, { x: 660, y: 340 }, { x: 640, y: 380 }, 10)
    ]);

    expect(events[0]).toMatchObject({
      type: 'CLASH', playerIds: ['p2', 'p1'], attackIds: [1, 2], strength: 'HEAVY'
    });
    expect(heavy.phase).toBe('ACTIVE');
    expect(quick.phase).toBe('RECOVERY');
    expect(state.players.p1.velocity).toEqual({ x: 0, y: 0 });
    expect(state.players.p2.velocity).toEqual({ x: 0, y: 0 });
    expect(state.players.p1.hitstunRemainingMs).toBe(0);
    expect(state.players.p2.hitstunRemainingMs).toBe(0);
  });

  it('cancels heavy/heavy with opposite 150-unit recoil and no overload or hitstun', () => {
    const state = createState();
    const left = attack(state, 'p1', 1, 'HEAVY');
    const right = attack(state, 'p2', 2, 'HEAVY');
    const events = resolveMeleeInteractions(state, [
      shape('p2', right, { x: 660, y: 340 }, { x: 640, y: 380 }, 10),
      shape('p1', left, { x: 640, y: 340 }, { x: 660, y: 380 }, 10)
    ]);

    expect(events).toEqual([expect.objectContaining({ type: 'CLASH', strength: 'HEAVY' })]);
    expect(left.phase).toBe('RECOVERY');
    expect(right.phase).toBe('RECOVERY');
    expect(state.players.p1.velocity).toEqual({ x: -150, y: 0 });
    expect(state.players.p2.velocity).toEqual({ x: 150, y: 0 });
    expect(state.players.p1.overload).toBe(0);
    expect(state.players.p2.overload).toBe(0);
    expect(state.players.p1.hitstunRemainingMs).toBe(0);
    expect(state.players.p2.hitstunRemainingMs).toBe(0);
  });

  it('cancels an uncommitted heavy charge only after a confirmed normal hit', () => {
    const state = createState();
    state.players.p2.chargeMs = GAME.heavyEnterChargeMs;
    state.players.p2.charging = true;
    const runtime = attack(state, 'p1', 1, 'QUICK_1');

    expect(resolveMeleeInteractions(state, [
      shape('p1', runtime, { x: 620, y: 340 }, { x: 660, y: 380 })
    ])).toEqual([expect.objectContaining({ type: 'HIT', targetId: 'p2' })]);
    expect(state.players.p2.chargeMs).toBe(0);
    expect(state.players.p2.charging).toBe(false);
  });

  it('refunds exactly 550 ms only for the first avoided attack of a dash and resolves every contact', () => {
    const state = createState();
    state.players.p2.dashInvulnerabilityRemainingMs = 1;
    state.players.p2.dashCooldownRemainingMs = 900;
    const first = attack(state, 'p1', 1, 'QUICK_1');
    const second = attack(state, 'p3', 2, 'QUICK_2', { x: -1, y: 0 });
    const shapes = [
      shape('p3', second, { x: 674, y: 360 }, { x: 680, y: 360 }),
      shape('p1', first, { x: 620, y: 360 }, { x: 626, y: 360 })
    ];

    const events = resolveMeleeInteractions(state, shapes);
    const repeated = resolveMeleeInteractions(state, shapes);

    expect(events).toEqual([expect.objectContaining({
      type: 'PERFECT_DODGE', playerId: 'p2', attackerId: 'p1', attackId: 1,
      source: 'QUICK_1', projectileId: null, refundedMs: 550
    })]);
    expect(repeated).toEqual([]);
    expect(state.players.p2.dashCooldownRemainingMs).toBe(350);
    expect(state.players.p2.perfectDodgeConsumed).toBe(true);
    expect(first.resolvedPlayerIds.has('p2')).toBe(true);
    expect(second.resolvedPlayerIds.has('p2')).toBe(true);
    expect(first.hitPlayerIds.size).toBe(0);
    expect(second.hitPlayerIds.size).toBe(0);
  });

  it.each([
    ['east', { x: 1, y: 0 }, { x: 34, y: -32 }, { x: 42, y: 32 }],
    ['south-east', { x: Math.SQRT1_2, y: Math.SQRT1_2 }, { x: 46.6690476, y: 1.4142136 }, { x: 7.0710678, y: 52.3259018 }],
    ['south', { x: 0, y: 1 }, { x: 32, y: 34 }, { x: -32, y: 42 }],
    ['south-west', { x: -Math.SQRT1_2, y: Math.SQRT1_2 }, { x: -1.4142136, y: 46.6690476 }, { x: -52.3259018, y: 7.0710678 }],
    ['west', { x: -1, y: 0 }, { x: -34, y: 32 }, { x: -42, y: -32 }],
    ['north-west', { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }, { x: -46.6690476, y: -1.4142136 }, { x: -7.0710678, y: -52.3259018 }],
    ['north', { x: 0, y: -1 }, { x: -32, y: -34 }, { x: 32, y: -42 }],
    ['north-east', { x: Math.SQRT1_2, y: -Math.SQRT1_2 }, { x: 1.4142136, y: -46.6690476 }, { x: 52.3259018, y: -7.0710678 }]
  ] as const)('builds the quick sweep from immutable locked facing toward %s', (_name, facing, from, to) => {
    const state = createState();
    state.players.p1.position = { x: 0, y: 0 };
    const runtime = attack(state, 'p1', 1, 'QUICK_1', facing);
    state.players.p1.latestInput = { ...state.players.p1.latestInput, aimX: -facing.x, aimY: -facing.y };
    const slice: ActiveAttackSlice = {
      playerId: 'p1', attack: runtime, previousProgress: 0, currentProgress: 1, enteredActive: true
    };

    const [built] = buildActiveAttackShapes(state, [slice]);

    expect(built.capsule.from.x).toBeCloseTo(from.x, 6);
    expect(built.capsule.from.y).toBeCloseTo(from.y, 6);
    expect(built.capsule.to.x).toBeCloseTo(to.x, 6);
    expect(built.capsule.to.y).toBeCloseTo(to.y, 6);
  });
});
