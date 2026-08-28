import { describe, expect, it } from 'vitest';

import { ARENA, GAME } from '../../shared/constants.js';
import type { Team } from '../../shared/model.js';
import { forceDelivery, setPlayerConnected, snapshotMatch, stepMatch } from './simulation.js';
import { createMatchState } from './state.js';
import type { MatchPlayerSeed, MatchState, MutableMatchCore, MutableMatchPlayer } from './state.js';

const idleInput = {
  seq: -1,
  up: false,
  down: false,
  left: false,
  right: false,
  dash: false
} as const;

function player(playerId: string, team: Team, x: number, y: number): MutableMatchPlayer {
  return {
    playerId,
    name: playerId,
    team,
    position: { x, y },
    carriedCoreId: null,
    lastProcessedInputSeq: -1,
    dashRemainingMs: 0,
    dashCooldownRemainingMs: 0,
    stunRemainingMs: 0,
    stunnedTick: null,
    stats: { deliveries: 0, tackles: 0 },
    connected: true,
    latestInput: idleInput,
    previousDashPressed: false,
    tackledPlayerIds: new Set()
  };
}

function looseCore(coreId: string, x: number, y: number, padIndex = 0): MutableMatchCore {
  return {
    coreId,
    position: { x, y },
    carrierId: null,
    golden: false,
    padIndex,
    blockedPlayerId: null,
    blockedRemainingMs: 0,
    looseRemainingMs: 8_000,
    droppedTick: null
  };
}

function matchFixture(players: readonly MutableMatchPlayer[]): MatchState {
  return {
    tick: 0,
    seed: 1,
    phase: 'REGULATION',
    pausedPhase: null,
    countdownRemainingMs: 0,
    remainingMs: 180_000,
    score: { CYAN: 0, AMBER: 0 },
    players: Object.fromEntries(players.map((entry) => [entry.playerId, entry])),
    cores: {},
    pads: [],
    winner: null
  };
}

function seeds(count: number): MatchPlayerSeed[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `p-${index + 1}`,
    name: `P${index + 1}`,
    team: index % 2 === 0 ? 'CYAN' : 'AMBER'
  }));
}

describe('authoritative match simulation', () => {
  it('activates the canonical core pads for the match population', () => {
    const cases = [
      { count: 2, padIndices: [1] },
      { count: 4, padIndices: [0, 2] },
      { count: 6, padIndices: [0, 1, 2] }
    ] as const;

    for (const fixture of cases) {
      const state = createMatchState(seeds(fixture.count), 7);
      expect(state.phase).toBe('COUNTDOWN');
      expect(state.countdownRemainingMs).toBe(3_000);
      expect(state.remainingMs).toBe(GAME.matchMs);
      expect(state.pads.map((pad) => pad.padIndex)).toEqual(fixture.padIndices);
      expect(Object.values(state.cores).map((core) => core.position)).toEqual(
        fixture.padIndices.map((padIndex) => ARENA.corePads[padIndex])
      );
    }
  });

  it('snapshots only public fields in stable id order', () => {
    const state = matchFixture([player('p-b', 'CYAN', 200, 300), player('p-a', 'AMBER', 1_000, 300)]);
    state.cores['core-b'] = looseCore('core-b', 640, 500, 2);
    state.cores['core-a'] = looseCore('core-a', 640, 220, 0);

    const snapshot = snapshotMatch(state);
    state.players['p-a'].position = { x: 50, y: 50 };

    expect(snapshot.players.map((entry) => entry.playerId)).toEqual(['p-a', 'p-b']);
    expect(snapshot.cores.map((entry) => entry.coreId)).toEqual(['core-a', 'core-b']);
    expect(snapshot.players[0].position).toEqual({ x: 1_000, y: 300 });
    expect(snapshot.players[0]).toHaveProperty('dashCooldownRemainingMs', 0);
    expect(snapshot.players[0]).not.toHaveProperty('connected');
    expect(snapshot.cores[0]).not.toHaveProperty('blockedPlayerId');
  });

  it('publishes the countdown clock as the active remaining time', () => {
    const state = createMatchState(seeds(2), 1);
    state.countdownRemainingMs = 1_234;

    expect(snapshotMatch(state).remainingMs).toBe(1_234);
  });

  it('awards a contested core by distance then stable player id', () => {
    const state = matchFixture([player('p-b', 'CYAN', 641, 360), player('p-a', 'AMBER', 639, 360)]);
    state.cores['core-1'] = looseCore('core-1', 640, 360);

    stepMatch(state, new Map(), 1_000 / 30);

    expect(state.cores['core-1'].carrierId).toBe('p-a');
  });

  it('drops once, locks the former carrier, and credits one tackle', () => {
    const attacker = player('attacker', 'CYAN', 100, 100);
    const carrier = player('carrier', 'AMBER', 130, 100);
    carrier.carriedCoreId = 'core-1';
    const state = matchFixture([carrier, attacker]);
    state.cores['core-1'] = { ...looseCore('core-1', 130, 100), carrierId: 'carrier' };
    const inputs = new Map([
      ['attacker', { ...idleInput, seq: 0, dash: true }]
    ]);

    const events = stepMatch(state, inputs, 1_000 / 30);

    expect(events.filter((event) => event.type === 'DROP')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'TACKLE')).toHaveLength(1);
    expect(state.players['carrier'].carriedCoreId).toBeNull();
    expect(state.cores['core-1'].blockedPlayerId).toBe('carrier');
    expect(state.players['attacker'].stats.tackles).toBe(1);
    expect(state.players['carrier'].stunRemainingMs).toBe(GAME.tackleStunMs);
  });

  it('keeps movement locked through the final countdown tick', () => {
    const runner = player('runner', 'CYAN', 200, 300);
    const state = matchFixture([runner, player('other', 'AMBER', 1_000, 300)]);
    state.phase = 'COUNTDOWN';
    state.countdownRemainingMs = 100;
    const inputs = new Map([
      ['runner', { ...idleInput, seq: 0, right: true }]
    ]);

    const events = stepMatch(state, inputs, 100);

    expect(runner.position).toEqual({ x: 200, y: 300 });
    expect(state.countdownRemainingMs).toBe(0);
    expect(state.phase).toBe('REGULATION');
    expect(events).toContainEqual({ type: 'PHASE', phase: 'REGULATION' });
  });

  it('starts a dash only on the rising edge', () => {
    const runner = player('runner', 'CYAN', 200, 300);
    const state = matchFixture([runner, player('other', 'AMBER', 1_000, 300)]);
    const heldDash = new Map([
      ['runner', { ...idleInput, seq: 0, dash: true }]
    ]);

    stepMatch(state, heldDash, 100);
    expect(runner.dashRemainingMs).toBe(60);

    runner.dashCooldownRemainingMs = 0;
    stepMatch(state, heldDash, 100);
    expect(runner.dashRemainingMs).toBe(0);
  });

  it('does not restart a dash before its cooldown expires', () => {
    const runner = player('runner', 'CYAN', 200, 300);
    const state = matchFixture([runner, player('other', 'AMBER', 1_000, 300)]);

    stepMatch(state, new Map([['runner', { ...idleInput, seq: 0, dash: true }]]), 160);
    stepMatch(state, new Map([['runner', { ...idleInput, seq: 1 }]]), 0);
    stepMatch(state, new Map([['runner', { ...idleInput, seq: 2, dash: true }]]), 1);

    expect(runner.dashRemainingMs).toBe(0);
    expect(runner.dashCooldownRemainingMs).toBe(1_639);

    stepMatch(state, new Map([['runner', { ...idleInput, seq: 3 }]]), 1_639);
    stepMatch(state, new Map([['runner', { ...idleInput, seq: 4, dash: true }]]), 10);
    expect(runner.dashRemainingMs).toBe(150);
    expect(runner.dashCooldownRemainingMs).toBe(1_790);
  });

  it('slows a core carrier without slowing other players', () => {
    const carrier = player('carrier', 'CYAN', 200, 300);
    const runner = player('runner', 'AMBER', 200, 400);
    carrier.carriedCoreId = 'core-1';
    const state = matchFixture([runner, carrier]);
    state.cores['core-1'] = { ...looseCore('core-1', 200, 300), carrierId: 'carrier' };
    const inputs = new Map([
      ['carrier', { ...idleInput, seq: 0, right: true }],
      ['runner', { ...idleInput, seq: 0, right: true }]
    ]);

    stepMatch(state, inputs, 1_000);

    expect(carrier.position).toEqual({ x: 405, y: 300 });
    expect(runner.position).toEqual({ x: 450, y: 400 });
  });

  it('keeps a carried core attached through player separation', () => {
    const carrier = player('carrier', 'CYAN', 300, 300);
    carrier.carriedCoreId = 'core-1';
    const state = matchFixture([carrier, player('other', 'AMBER', 320, 300)]);
    state.cores['core-1'] = { ...looseCore('core-1', 300, 300), carrierId: 'carrier' };

    stepMatch(state, new Map(), 1_000 / 30);

    expect(carrier.position).toEqual({ x: 290, y: 300 });
    expect(state.cores['core-1'].position).toEqual(carrier.position);
  });

  it('scores only when a carrier enters its own reactor', () => {
    const cyan = player('cyan', 'CYAN', 1_220, 360);
    const amber = player('amber', 'AMBER', 1_220, 400);
    cyan.carriedCoreId = 'core-1';
    amber.carriedCoreId = 'core-2';
    const state = matchFixture([cyan, amber]);
    state.cores['core-1'] = { ...looseCore('core-1', 1_220, 360), carrierId: 'cyan' };
    state.cores['core-2'] = { ...looseCore('core-2', 1_220, 400), carrierId: 'amber' };

    stepMatch(state, new Map(), 1_000 / 30);

    expect(state.score).toEqual({ CYAN: 0, AMBER: 1 });
    expect(cyan.carriedCoreId).toBe('core-1');
    expect(amber.carriedCoreId).toBeNull();
  });

  it('returns an untouched loose core to its spawn pad', () => {
    const state = matchFixture([player('cyan', 'CYAN', 200, 300), player('amber', 'AMBER', 1_000, 300)]);
    state.pads = [{ padIndex: 0, coreId: 'core-1', respawnRemainingMs: null }];
    state.cores['core-1'] = {
      ...looseCore('core-1', 700, 360),
      looseRemainingMs: 50,
      blockedPlayerId: 'cyan',
      blockedRemainingMs: 50
    };

    stepMatch(state, new Map(), 100);

    expect(state.cores['core-1'].position).toEqual(ARENA.corePads[0]);
    expect(state.cores['core-1'].looseRemainingMs).toBe(GAME.coreReturnMs);
    expect(state.cores['core-1'].blockedPlayerId).toBeNull();
  });

  it('respawns a delivered pad core after the fixed delay', () => {
    const scorer = player('scorer', 'AMBER', 1_220, 360);
    scorer.carriedCoreId = 'core-1';
    const state = matchFixture([scorer, player('cyan', 'CYAN', 200, 300)]);
    state.pads = [{ padIndex: 1, coreId: 'core-1', respawnRemainingMs: null }];
    state.cores['core-1'] = { ...looseCore('core-1', 1_220, 360, 1), carrierId: 'scorer' };

    stepMatch(state, new Map(), 100);
    expect(state.cores['core-1']).toBeUndefined();
    expect(state.pads[0].respawnRemainingMs).toBe(2_400);

    stepMatch(state, new Map(), 2_399);
    expect(state.cores['core-1']).toBeUndefined();
    stepMatch(state, new Map(), 1);
    expect(state.cores['core-1'].position).toEqual(ARENA.corePads[1]);
  });

  it('finishes immediately when a delivery reaches the target score', () => {
    const scorer = player('scorer', 'AMBER', 1_220, 360);
    scorer.carriedCoreId = 'core-1';
    const state = matchFixture([scorer, player('cyan', 'CYAN', 200, 300)]);
    state.score.AMBER = GAME.targetScore - 1;
    state.cores['core-1'] = { ...looseCore('core-1', 1_220, 360), carrierId: 'scorer' };

    const events = stepMatch(state, new Map(), 1_000 / 30);

    expect(state.phase).toBe('FINISHED');
    expect(state.winner).toBe('AMBER');
    expect(events.at(-1)).toEqual({
      type: 'RESULT',
      winner: 'AMBER',
      score: { CYAN: 0, AMBER: GAME.targetScore }
    });
  });

  it('breaks simultaneous target deliveries by stable player order', () => {
    const cyan = player('p-b', 'CYAN', 60, 360);
    const amber = player('p-a', 'AMBER', 1_220, 360);
    cyan.carriedCoreId = 'core-cyan';
    amber.carriedCoreId = 'core-amber';
    const state = matchFixture([cyan, amber]);
    state.score = { CYAN: GAME.targetScore - 1, AMBER: GAME.targetScore - 1 };
    state.cores['core-cyan'] = { ...looseCore('core-cyan', 60, 360), carrierId: 'p-b' };
    state.cores['core-amber'] = { ...looseCore('core-amber', 1_220, 360), carrierId: 'p-a' };

    stepMatch(state, new Map(), 1_000 / 30);

    expect(state.score).toEqual({ CYAN: GAME.targetScore, AMBER: GAME.targetScore });
    expect(state.winner).toBe('AMBER');
  });

  it('declares the higher score as regulation time expires', () => {
    const state = matchFixture([player('cyan', 'CYAN', 200, 300), player('amber', 'AMBER', 1_000, 300)]);
    state.remainingMs = 1;
    state.score = { CYAN: 3, AMBER: 2 };

    stepMatch(state, new Map(), 1_000 / 30);

    expect(state.remainingMs).toBe(0);
    expect(state.phase).toBe('FINISHED');
    expect(state.winner).toBe('CYAN');
  });

  it('resolves a same-tick delivery before regulation expiry', () => {
    const scorer = player('scorer', 'AMBER', 1_220, 360);
    scorer.carriedCoreId = 'core-1';
    const state = matchFixture([scorer, player('cyan', 'CYAN', 200, 300)]);
    state.remainingMs = 1;
    state.cores['core-1'] = { ...looseCore('core-1', 1_220, 360), carrierId: 'scorer' };

    stepMatch(state, new Map(), 1_000 / 30);

    expect(state.score).toEqual({ CYAN: 0, AMBER: 1 });
    expect(state.phase).toBe('FINISHED');
    expect(state.winner).toBe('AMBER');
  });

  it('replaces regulation cores with one golden core on a tied expiry', () => {
    const state = matchFixture([player('cyan', 'CYAN', 200, 300), player('amber', 'AMBER', 1_000, 300)]);
    state.remainingMs = 1;
    state.score = { CYAN: 2, AMBER: 2 };
    state.pads = [{ padIndex: 0, coreId: 'core-1', respawnRemainingMs: null }];
    state.cores['core-1'] = looseCore('core-1', 640, 220);

    const events = stepMatch(state, new Map(), 1_000 / 30);

    expect(state.phase).toBe('SUDDEN_DEATH');
    expect(Object.values(state.cores)).toEqual([
      expect.objectContaining({ golden: true, position: { x: 640, y: 360 } })
    ]);
    expect(events.at(-1)).toEqual({ type: 'PHASE', phase: 'SUDDEN_DEATH' });
  });

  it('ends sudden death on the next forced delivery', () => {
    const state = matchFixture([player('cyan', 'CYAN', 200, 300), player('amber', 'AMBER', 1_000, 300)]);
    state.phase = 'SUDDEN_DEATH';
    state.score = { CYAN: 2, AMBER: 2 };
    state.cores['golden-core'] = { ...looseCore('golden-core', 640, 360), golden: true, padIndex: null };

    const events = forceDelivery(state, 'AMBER');

    expect(state.phase).toBe('FINISHED');
    expect(state.winner).toBe('AMBER');
    expect(events.map((event) => event.type)).toEqual(['SCORE', 'PHASE', 'RESULT']);
  });

  it('ends sudden death on the next reactor delivery', () => {
    const scorer = player('scorer', 'AMBER', 1_220, 360);
    scorer.carriedCoreId = 'golden-core';
    const state = matchFixture([scorer, player('cyan', 'CYAN', 200, 300)]);
    state.phase = 'SUDDEN_DEATH';
    state.score = { CYAN: 2, AMBER: 2 };
    state.cores['golden-core'] = {
      ...looseCore('golden-core', 1_220, 360),
      carrierId: 'scorer',
      golden: true,
      padIndex: null
    };

    stepMatch(state, new Map(), 1_000 / 30);

    expect(state.phase).toBe('FINISHED');
    expect(state.winner).toBe('AMBER');
  });

  it('drops a disconnected carrier and pauses the match timer', () => {
    const carrier = player('carrier', 'CYAN', 400, 360);
    carrier.carriedCoreId = 'core-1';
    const state = matchFixture([carrier, player('amber', 'AMBER', 900, 360)]);
    state.cores['core-1'] = { ...looseCore('core-1', 400, 360), carrierId: 'carrier' };

    const events = setPlayerConnected(state, 'carrier', false);
    const remainingBeforePause = state.remainingMs;
    stepMatch(state, new Map(), 1_000);

    expect(events.map((event) => event.type)).toEqual(['DROP', 'PHASE']);
    expect(state.phase).toBe('PAUSED');
    expect(carrier.carriedCoreId).toBeNull();
    expect(state.cores['core-1'].carrierId).toBeNull();
    expect(state.remainingMs).toBe(remainingBeforePause);
  });

  it('removes a disconnected avatar from authoritative snapshots', () => {
    const state = matchFixture([player('cyan', 'CYAN', 300, 300), player('amber', 'AMBER', 900, 300)]);

    setPlayerConnected(state, 'cyan', false);

    expect(snapshotMatch(state).players.map((entry) => entry.playerId)).toEqual(['amber']);
  });

  it('freezes player positions while the match is paused', () => {
    const cyan = player('cyan', 'CYAN', 300, 300);
    const amber = player('amber', 'AMBER', 300, 300);
    const state = matchFixture([cyan, amber]);
    state.phase = 'PAUSED';
    state.pausedPhase = 'REGULATION';

    stepMatch(state, new Map(), 100);

    expect(cyan.position).toEqual({ x: 300, y: 300 });
    expect(amber.position).toEqual({ x: 300, y: 300 });
  });

  it('freezes gameplay cooldowns while the match is paused', () => {
    const cyan = player('cyan', 'CYAN', 300, 300);
    cyan.dashCooldownRemainingMs = 100;
    cyan.stunRemainingMs = 100;
    const state = matchFixture([cyan, player('amber', 'AMBER', 900, 300)]);
    state.phase = 'PAUSED';
    state.pausedPhase = 'REGULATION';

    stepMatch(state, new Map(), 50);

    expect(cyan.dashCooldownRemainingMs).toBe(100);
    expect(cyan.stunRemainingMs).toBe(100);
  });

  it('unlocks the former carrier only after the self-pickup delay', () => {
    const formerCarrier = player('carrier', 'CYAN', 640, 360);
    const state = matchFixture([formerCarrier, player('amber', 'AMBER', 1_000, 300)]);
    state.cores['core-1'] = {
      ...looseCore('core-1', 640, 360),
      blockedPlayerId: 'carrier',
      blockedRemainingMs: 50
    };

    stepMatch(state, new Map(), 25);
    expect(state.cores['core-1'].carrierId).toBeNull();
    expect(state.cores['core-1'].blockedRemainingMs).toBe(25);

    stepMatch(state, new Map(), 25);
    expect(state.cores['core-1'].carrierId).toBe('carrier');
    expect(state.cores['core-1'].blockedPlayerId).toBeNull();
  });

  it('keeps a tackled player movement-locked through the final stun tick', () => {
    const target = player('target', 'CYAN', 200, 300);
    target.stunRemainingMs = 50;
    const state = matchFixture([target, player('amber', 'AMBER', 1_000, 300)]);
    const inputs = new Map([
      ['target', { ...idleInput, seq: 0, right: true }]
    ]);

    stepMatch(state, inputs, 25);
    expect(target.position).toEqual({ x: 200, y: 300 });
    expect(target.stunRemainingMs).toBe(25);
    stepMatch(state, inputs, 25);
    expect(target.position).toEqual({ x: 200, y: 300 });
    expect(target.stunRemainingMs).toBe(0);
    stepMatch(state, inputs, 100);
    expect(target.position).toEqual({ x: 225, y: 300 });
  });

  it('replays 900 scripted ticks identically across independent states', () => {
    const runReplay = () => {
      const state = createMatchState(seeds(2), 42);
      const cyan = state.players['p-1'];
      const amber = state.players['p-2'];
      cyan.position = { x: 620, y: 360 };
      amber.position = { x: 700, y: 360 };
      state.countdownRemainingMs = 1_000 / 30;
      const eventTypes: string[] = [];
      let delivered = false;
      let respawned = false;

      for (let tick = 0; tick < 900; tick += 1) {
        const cyanRight = tick >= 12 && tick <= 22;
        const amberLeft = tick >= 1 && tick <= 5;
        const amberRight = tick >= 6;
        const events = stepMatch(
          state,
          new Map([
            ['p-1', { ...idleInput, seq: tick, right: cyanRight }],
            ['p-2', { ...idleInput, seq: tick, left: amberLeft, right: amberRight, dash: tick === 1 }]
          ]),
          1_000 / 30
        );
        for (const event of events) {
          eventTypes.push(event.type);
          if (event.type === 'SCORE') delivered = true;
        }
        if (delivered && state.cores['core-1']) respawned = true;
      }

      return { snapshot: snapshotMatch(state), eventTypes, respawned };
    };

    const first = runReplay();
    const second = runReplay();

    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.eventTypes).toEqual(second.eventTypes);
    expect(first.eventTypes).toEqual(expect.arrayContaining(['PHASE', 'PICKUP', 'DROP', 'TACKLE', 'SCORE']));
    expect(first.respawned).toBe(true);
    expect(first.snapshot.remainingMs).toBeCloseTo(150_033.333, 3);
  });
});
