import type { Vec2 } from '../model.js';
import { sampleWeaponPoint, type AttackProfile } from './profiles.js';

export type HurtCircle = Readonly<{ center: Vec2; radius: number }>;
export type SweptCapsule = Readonly<{ from: Vec2; to: Vec2; radius: number }>;

export function buildAttackCapsule(
  origin: Vec2,
  facing: Vec2,
  profile: AttackProfile,
  previousProgress: number,
  currentProgress: number,
): SweptCapsule {
  return {
    from: sampleWeaponPoint(origin, facing, profile, previousProgress),
    to: sampleWeaponPoint(origin, facing, profile, currentProgress),
    radius: profile.thickness / 2,
  };
}

function distanceSquared(left: Vec2, right: Vec2): number {
  const x = left.x - right.x;
  const y = left.y - right.y;
  return x * x + y * y;
}

function pointToSegmentDistanceSquared(point: Vec2, from: Vec2, to: Vec2): number {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const lengthSquared = x * x + y * y;
  if (lengthSquared === 0) return distanceSquared(point, from);
  const progress = Math.max(0, Math.min(1, ((point.x - from.x) * x + (point.y - from.y) * y) / lengthSquared));
  return distanceSquared(point, { x: from.x + x * progress, y: from.y + y * progress });
}

function closestPointOnSegment(point: Vec2, from: Vec2, to: Vec2): Vec2 {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const lengthSquared = x * x + y * y;
  if (lengthSquared === 0) return from;
  const progress = Math.max(0, Math.min(1, ((point.x - from.x) * x + (point.y - from.y) * y) / lengthSquared));
  return { x: from.x + x * progress, y: from.y + y * progress };
}

function orientation(from: Vec2, to: Vec2, point: Vec2): number {
  return (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
}

function onSegment(from: Vec2, to: Vec2, point: Vec2): boolean {
  return point.x >= Math.min(from.x, to.x)
    && point.x <= Math.max(from.x, to.x)
    && point.y >= Math.min(from.y, to.y)
    && point.y <= Math.max(from.y, to.y);
}

function segmentsIntersect(leftFrom: Vec2, leftTo: Vec2, rightFrom: Vec2, rightTo: Vec2): boolean {
  const leftRightFrom = orientation(leftFrom, leftTo, rightFrom);
  const leftRightTo = orientation(leftFrom, leftTo, rightTo);
  const rightLeftFrom = orientation(rightFrom, rightTo, leftFrom);
  const rightLeftTo = orientation(rightFrom, rightTo, leftTo);
  if ((leftRightFrom > 0) !== (leftRightTo > 0) && (rightLeftFrom > 0) !== (rightLeftTo > 0)) return true;
  return (leftRightFrom === 0 && onSegment(leftFrom, leftTo, rightFrom))
    || (leftRightTo === 0 && onSegment(leftFrom, leftTo, rightTo))
    || (rightLeftFrom === 0 && onSegment(rightFrom, rightTo, leftFrom))
    || (rightLeftTo === 0 && onSegment(rightFrom, rightTo, leftTo));
}

function segmentDistanceSquared(leftFrom: Vec2, leftTo: Vec2, rightFrom: Vec2, rightTo: Vec2): number {
  if (segmentsIntersect(leftFrom, leftTo, rightFrom, rightTo)) return 0;
  return Math.min(
    pointToSegmentDistanceSquared(leftFrom, rightFrom, rightTo),
    pointToSegmentDistanceSquared(leftTo, rightFrom, rightTo),
    pointToSegmentDistanceSquared(rightFrom, leftFrom, leftTo),
    pointToSegmentDistanceSquared(rightTo, leftFrom, leftTo),
  );
}

export function capsuleIntersectsCircle(capsule: SweptCapsule, circle: HurtCircle): boolean {
  const radius = capsule.radius + circle.radius;
  return pointToSegmentDistanceSquared(circle.center, capsule.from, capsule.to) <= radius * radius;
}

export function capsulesIntersect(left: SweptCapsule, right: SweptCapsule): boolean {
  const radius = left.radius + right.radius;
  return segmentDistanceSquared(left.from, left.to, right.from, right.to) <= radius * radius;
}

export function nearestCircleBoundaryPointToCapsule(capsule: SweptCapsule, circle: HurtCircle): Vec2 {
  const nearestAxisPoint = closestPointOnSegment(circle.center, capsule.from, capsule.to);
  let normalX = nearestAxisPoint.x - circle.center.x;
  let normalY = nearestAxisPoint.y - circle.center.y;

  if (distanceSquared(nearestAxisPoint, circle.center) === 0) {
    const axisX = capsule.to.x - capsule.from.x;
    const axisY = capsule.to.y - capsule.from.y;
    if (axisX === 0 && axisY === 0) {
      normalX = 1;
      normalY = 0;
    } else {
      const magnitude = Math.hypot(axisX, axisY);
      const directionX = axisX / magnitude;
      const directionY = axisY / magnitude;
      const backward = {
        x: circle.center.x - directionX * circle.radius,
        y: circle.center.y - directionY * circle.radius
      };
      const forward = {
        x: circle.center.x + directionX * circle.radius,
        y: circle.center.y + directionY * circle.radius
      };
      const backwardDistance = pointToSegmentDistanceSquared(backward, capsule.from, capsule.to);
      const forwardDistance = pointToSegmentDistanceSquared(forward, capsule.from, capsule.to);
      if (backwardDistance <= forwardDistance) return backward;
      return forward;
    }
  }

  const magnitude = Math.hypot(normalX, normalY);
  return {
    x: circle.center.x + (normalX / magnitude) * circle.radius,
    y: circle.center.y + (normalY / magnitude) * circle.radius
  };
}
