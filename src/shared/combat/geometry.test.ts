import { describe, expect, it } from 'vitest';
import { buildAttackCapsule, capsuleIntersectsCircle, capsulesIntersect } from './geometry.js';
import { profileForAttack, sampleWeaponPoint } from './profiles.js';

describe('shared combat geometry', () => {
  it('hits when a swept capsule crosses a hurt circle between 60 Hz samples', () => {
    const capsule = buildAttackCapsule({ x: 0, y: 0 }, { x: 1, y: 0 }, profileForAttack('QUICK_1'), 0, 1 / 3);

    expect(capsuleIntersectsCircle(capsule, { center: { x: 55, y: -24 }, radius: 1 })).toBe(true);
  });

  it('does not hit a circle one epsilon outside combined radii', () => {
    expect(capsuleIntersectsCircle(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, radius: 2 },
      { center: { x: 5, y: 4.001 }, radius: 2 },
    )).toBe(false);
  });

  it('is rotationally symmetric across eight facings', () => {
    const origin = { x: 14, y: -9 };
    const profile = profileForAttack('QUICK_3');
    const localDistance = Math.hypot(
      sampleWeaponPoint({ x: 0, y: 0 }, { x: 1, y: 0 }, profile, 0.4).x,
      sampleWeaponPoint({ x: 0, y: 0 }, { x: 1, y: 0 }, profile, 0.4).y,
    );

    for (let index = 0; index < 8; index += 1) {
      const angle = index * Math.PI / 4;
      const facing = { x: Math.cos(angle), y: Math.sin(angle) };
      const point = sampleWeaponPoint(origin, facing, profile, 0.4);
      expect(Math.hypot(point.x - origin.x, point.y - origin.y)).toBeCloseTo(localDistance, 10);
    }
  });

  it('detects crossing attack capsules regardless of argument order', () => {
    const horizontal = { from: { x: -10, y: 0 }, to: { x: 10, y: 0 }, radius: 1 };
    const vertical = { from: { x: 0, y: -10 }, to: { x: 0, y: 10 }, radius: 1 };

    expect(capsulesIntersect(horizontal, vertical)).toBe(true);
    expect(capsulesIntersect(vertical, horizontal)).toBe(true);
  });

  it('treats a zero-length sweep as a circle', () => {
    expect(capsuleIntersectsCircle(
      { from: { x: 3, y: 4 }, to: { x: 3, y: 4 }, radius: 2 },
      { center: { x: 6.5, y: 4 }, radius: 1.5 },
    )).toBe(true);
  });
});
