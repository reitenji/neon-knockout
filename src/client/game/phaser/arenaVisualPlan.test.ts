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
      { phase: 'REGULATION', remainingMs: 24_000, platformProgress: 0.35 },
      { nowMs: 420, reducedMotion: false }
    );

    expect(visuals.currentVertices[0]).toEqual({ x: 265, y: 111 });
    expect(visuals.currentVertices[7]).toEqual({ x: 182, y: 194 });
    expect(visuals.panelBands).toHaveLength(4);
    expect(visuals.minimumOutlineAlpha).toBeGreaterThan(0.3);
    expect(visuals.activeBoundaryAlpha).toBeGreaterThan(visuals.minimumOutlineAlpha);
    expect(visuals.activeBoundaryWidth).toBeGreaterThan(6);
    expect(visuals.cornerNodeRadius).toBeGreaterThan(8);
    expect(visuals.warningPulse).toBeGreaterThan(0);
    expect(visuals.dangerChevronCount).toBe(8);
  });

  it('keeps the warning readable but suppresses telegraph pulsing under reduced motion', () => {
    const visuals = buildArenaVisualModel(
      { phase: 'REGULATION', remainingMs: 24_000, platformProgress: 0.35 },
      { nowMs: 420, reducedMotion: true }
    );

    expect(visuals.minimumOutlineAlpha).toBeGreaterThan(0.2);
    expect(visuals.warningPulse).toBe(0);
    expect(visuals.cornerNodeRadius).toBeCloseTo(8.7, 4);
  });
});
