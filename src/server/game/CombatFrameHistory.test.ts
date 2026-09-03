import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_SETTINGS } from '../../shared/roomSettings.js';
import { CombatFrameHistory } from './CombatFrameHistory.js';
import { createMatchState } from './state.js';

function stateAt(tick: number) {
  const state = createMatchState([
    { playerId: 'p1', name: 'One', accent: 0 },
    { playerId: 'p2', name: 'Two', accent: 1 }
  ], 0, DEFAULT_ROOM_SETTINGS);
  state.tick = tick;
  state.players.p1.position = { x: tick * 10, y: 200 };
  return state;
}

describe('CombatFrameHistory', () => {
  it('stores immutable collision and eligibility data without retaining mutable match references', () => {
    const state = stateAt(7);
    state.players.p1.connected = false;
    state.players.p1.respawnRemainingMs = 20;
    state.players.p1.protectionRemainingMs = 30;
    state.players.p1.dashInvulnerabilityRemainingMs = 40;
    const history = new CombatFrameHistory();

    history.capture(state);
    state.players.p1.position = { x: 999, y: state.players.p1.position.y };
    state.players.p1.connected = true;

    const frame = history.get(7);
    expect(frame?.players.p1).toMatchObject({
      playerId: 'p1',
      position: { x: 70, y: 200 },
      connected: false,
      respawning: true,
      protected: true,
      dashInvulnerable: true
    });
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame?.players)).toBe(true);
    expect(Object.isFrozen(frame?.players.p1)).toBe(true);
    expect(Object.isFrozen(frame?.players.p1.position)).toBe(true);
  });

  it('keeps exactly twelve exact-tick frames and reports wrapped oldest and latest ticks', () => {
    const history = new CombatFrameHistory();
    for (let tick = 0; tick <= 12; tick += 1) history.capture(stateAt(tick));

    expect(history.get(0)).toBeNull();
    expect(history.get(1)?.tick).toBe(1);
    expect(history.get(7)?.players.p1.position.x).toBe(70);
    expect(history.get(12)?.tick).toBe(12);
    expect(history.oldestTick()).toBe(1);
    expect(history.latestTick()).toBe(12);
  });

  it('clears every retained frame', () => {
    const history = new CombatFrameHistory();
    history.capture(stateAt(4));

    history.clear();

    expect(history.get(4)).toBeNull();
    expect(history.oldestTick()).toBeNull();
    expect(history.latestTick()).toBeNull();
  });
});
