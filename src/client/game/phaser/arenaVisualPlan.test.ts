import { describe, expect, it } from 'vitest';
import { ARENA } from '../../../shared/constants.js';
import { buildArenaVisualModel, interpolateArenaVertices } from './arenaVisualPlan.js';

describe('arenaVisualPlan', () => {
  it('interpolates the arena footprint exactly between regulation and minimum octagons', () => {
    expect(interpolateArenaVertices(0)).toEqual(ARENA.regulationVertices);
    expect(interpolateArenaVertices(1)).toEqual(ARENA.minimumVertices);

    const midpoint = interpolateArenaVertices(0.5);
    expect(midpoint[0]).toEqual({ x: 280, y: 120 });
    expect(midpoint[4]).toEqual({ x: 1_000, y: 600 });
  });

  it('arms a readable contraction warning with brighter current edges and corner nodes during the lead window', () => {
    const visuals = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 57_500, platformProgress: 0.5 },
      { nowMs: 420, reducedMotion: false }
    );

    expect(visuals.currentVertices[0]).toEqual({ x: 280, y: 120 });
    expect(visuals.currentVertices[7]).toEqual({ x: 200, y: 200 });
    expect(visuals.panelBands).toHaveLength(4);
    expect(visuals.minimumOutlineAlpha).toBeGreaterThan(0.3);
    expect(visuals.activeBoundaryAlpha).toBeGreaterThan(0.6);
    expect(visuals.activeBoundaryWidth).toBeGreaterThan(6);
    expect(visuals.cornerNodeRadius).toBeGreaterThan(8);
    expect(visuals.warningPulse).toBeGreaterThan(0);
    expect(visuals.dangerChevronCount).toBe(8);
  });

  it('keeps the warning readable but suppresses telegraph pulsing under reduced motion', () => {
    const visuals = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 57_500, platformProgress: 0.5 },
      { nowMs: 420, reducedMotion: true }
    );

    expect(visuals.minimumOutlineAlpha).toBeGreaterThan(0.2);
    expect(visuals.warningPulse).toBe(0);
    expect(visuals.cornerNodeRadius).toBe(9);
  });

  it('derives warning emphasis from 78 to 75 seconds remaining', () => {
    const before = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 78_001, platformProgress: 0 },
      { reducedMotion: true }
    );
    const start = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 78_000, platformProgress: 0 },
      { reducedMotion: true }
    );
    const midpoint = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 76_500, platformProgress: 0 },
      { reducedMotion: true }
    );
    const complete = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 75_000, platformProgress: 0 },
      { reducedMotion: true }
    );

    expect(before.minimumOutlineAlpha).toBe(0.18);
    expect(start.minimumOutlineAlpha).toBe(0.18);
    expect(midpoint.minimumOutlineAlpha).toBeCloseTo(0.37, 8);
    expect(complete.minimumOutlineAlpha).toBeCloseTo(0.56, 8);
  });
});
