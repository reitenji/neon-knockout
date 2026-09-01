import { describe, expect, it } from 'vitest';
import {
  buildAttackCapsule,
  capsuleIntersectsCircle,
  capsulesIntersect,
  nearestCircleBoundaryPointToCapsule
} from './geometry.js';
import { profileForAttack, sampleWeaponPoint } from './profiles.js';

describe('shared combat geometry', () => {
  it('hits when a swept capsule crosses a hurt circle between 60 Hz samples', () => {
    const profile = profileForAttack('QUICK_1');
    const capsule = buildAttackCapsule({ x: 0, y: 0 }, { x: 1, y: 0 }, profile, 0, (1000 / 60) / profile.activeMs);
    const circle = {
      center: { x: (capsule.from.x + capsule.to.x) / 2, y: (capsule.from.y + capsule.to.y) / 2 },
      radius: 1,
    };

    expect(capsuleIntersectsCircle({ from: capsule.from, to: capsule.from, radius: capsule.radius }, circle)).toBe(false);
    expect(capsuleIntersectsCircle({ from: capsule.to, to: capsule.to, radius: capsule.radius }, circle)).toBe(false);
    expect(capsuleIntersectsCircle(capsule, circle)).toBe(true);
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
    const diagonal = Math.SQRT1_2;
    const expected = [
      { facing: { x: 1, y: 0 }, point: { x: 82.8, y: -27.4 } },
      { facing: { x: diagonal, y: diagonal }, point: { x: 14 + 87.2 * diagonal, y: -9 + 50.4 * diagonal } },
      { facing: { x: 0, y: 1 }, point: { x: 32.4, y: 59.8 } },
      { facing: { x: -diagonal, y: diagonal }, point: { x: 14 - 50.4 * diagonal, y: -9 + 87.2 * diagonal } },
      { facing: { x: -1, y: 0 }, point: { x: -54.8, y: 9.4 } },
      { facing: { x: -diagonal, y: -diagonal }, point: { x: 14 - 87.2 * diagonal, y: -9 - 50.4 * diagonal } },
      { facing: { x: 0, y: -1 }, point: { x: -4.4, y: -77.8 } },
      { facing: { x: diagonal, y: -diagonal }, point: { x: 14 + 50.4 * diagonal, y: -9 - 87.2 * diagonal } },
    ];

    for (const entry of expected) {
      const point = sampleWeaponPoint(origin, entry.facing, profile, 0.4);
      expect(point.x).toBeCloseTo(entry.point.x, 10);
      expect(point.y).toBeCloseTo(entry.point.y, 10);
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

  it('returns the hurt-circle boundary point nearest the swept capsule axis', () => {
    expect(nearestCircleBoundaryPointToCapsule(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, radius: 2 },
      { center: { x: 5, y: 10 }, radius: 4 }
    )).toEqual({ x: 5, y: 6 });
  });

  it('uses a deterministic boundary fallback when the capsule axis crosses the circle center', () => {
    expect(nearestCircleBoundaryPointToCapsule(
      { from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, radius: 2 },
      { center: { x: 5, y: 0 }, radius: 4 }
    )).toEqual({ x: 1, y: 0 });
  });

  it('uses the nearest boundary point when the circle center sits on a segment endpoint', () => {
    expect(nearestCircleBoundaryPointToCapsule(
      { from: { x: 5, y: 0 }, to: { x: 10, y: 0 }, radius: 2 },
      { center: { x: 5, y: 0 }, radius: 4 }
    )).toEqual({ x: 9, y: 0 });
  });

  it('uses a deterministic positive-x boundary point for a degenerate centered capsule', () => {
    expect(nearestCircleBoundaryPointToCapsule(
      { from: { x: 5, y: 7 }, to: { x: 5, y: 7 }, radius: 2 },
      { center: { x: 5, y: 7 }, radius: 4 }
    )).toEqual({ x: 9, y: 7 });
  });
});
