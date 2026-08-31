import { describe, expect, it } from 'vitest';
import { GAME } from '../../../shared/constants.js';
import {
  animationPlanFor,
  poseAt,
  type FighterAnimationName
} from './animationPlan.js';

describe('animationPlanFor', () => {
  it('authors every fighter state and blends idle/move within 80 milliseconds', () => {
    const states: FighterAnimationName[] = [
      'idle', 'move', 'quick-1', 'quick-2', 'quick-3', 'heavy-charge',
      'heavy-release', 'dash', 'hit', 'knockout', 'respawn', 'reconnect', 'protected'
    ];

    for (const state of states) {
      const plan = animationPlanFor(state, false);
      expect(plan.keyframes.length, state).toBeGreaterThan(1);
      expect(plan.durationMs, state).toBeGreaterThan(0);
    }

    expect(animationPlanFor('idle', false).transitionMs).toBeLessThanOrEqual(80);
    expect(animationPlanFor('move', false).transitionMs).toBeLessThanOrEqual(80);
  });

  it('samples poses from elapsed milliseconds instead of rendered frame counts', () => {
    const plan = animationPlanFor('move', false);

    const atStart = poseAt(plan, 0);
    const at105 = poseAt(plan, 105);

    expect(atStart.bodyX).toBe(0);
    expect(at105).toMatchObject({ bodyX: 2.4, bodyRotation: -0.035, trailIntensity: 0.36 });
    expect(poseAt(plan, 105)).toEqual(at105);
    expect(at105).not.toEqual(atStart);
  });

  it('fits knockout and respawn poses inside the 600ms control-return contract', () => {
    const knockout = animationPlanFor('knockout', false);
    const respawn = animationPlanFor('respawn', false);

    expect(knockout.durationMs + respawn.durationMs).toBe(GAME.knockoutToControlMs);
    expect(animationPlanFor('reconnect', false).durationMs).toBe(GAME.reconnectWarpMs);
  });

  it('removes looping bob and shortens trails when reduced motion is enabled', () => {
    const reducedIdle = animationPlanFor('idle', true);
    const regularDash = animationPlanFor('dash', false);
    const reducedDash = animationPlanFor('dash', true);

    expect(reducedIdle.keyframes.every(({ pose }) => pose.bodyY === 0)).toBe(true);
    expect(Math.max(...reducedDash.keyframes.map(({ pose }) => pose.trailIntensity))).toBeGreaterThan(0);
    expect(Math.max(...reducedDash.keyframes.map(({ pose }) => pose.trailIntensity)))
      .toBeLessThan(Math.max(...regularDash.keyframes.map(({ pose }) => pose.trailIntensity)));
  });
});
