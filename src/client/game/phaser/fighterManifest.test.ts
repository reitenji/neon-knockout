import { describe, expect, it } from 'vitest';
import { FIGHTER_MANIFEST } from './fighterManifest.js';

describe('fighter presentation manifest', () => {
  it('keeps every chassis large enough to read as a fighter at arena scale', () => {
    expect(Object.fromEntries(
      Object.entries(FIGHTER_MANIFEST).map(([chassis, fighter]) => [chassis, fighter.scale])
    )).toEqual({
      RIFT: 0.81,
      BASTION: 0.83,
      PULSE: 0.78,
      WRAITH: 0.82
    });
  });
});
