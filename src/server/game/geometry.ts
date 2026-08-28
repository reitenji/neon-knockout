import type { Rect, Vec2 } from '../../shared/model.js';
import { ARENA, GAME } from '../../shared/constants.js';

export function circleIntersectsRect(position: Vec2, radius: number, rect: Rect): boolean {
  const nearestX = Math.max(rect.x, Math.min(position.x, rect.x + rect.width));
  const nearestY = Math.max(rect.y, Math.min(position.y, rect.y + rect.height));
  const dx = position.x - nearestX;
  const dy = position.y - nearestY;
  return dx * dx + dy * dy <= radius * radius;
}

export function movePlayer(position: Vec2, direction: Vec2, elapsedMs: number, carrying: boolean): Vec2 {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0) return position;

  const distance = GAME.moveSpeed * (carrying ? GAME.carrierMultiplier : 1) * (elapsedMs / 1_000);
  return {
    x: position.x + (direction.x / length) * distance,
    y: position.y + (direction.y / length) * distance
  };
}

export function pushCircle(
  position: Vec2,
  direction: Vec2,
  distance: number,
  radius: number,
  obstacles: readonly Rect[]
): Vec2 {
  const length = Math.hypot(direction.x, direction.y);
  if (length === 0 || distance <= 0) return position;

  const unit = { x: direction.x / length, y: direction.y / length };
  let current = position;
  let remaining = distance;

  while (remaining > 0) {
    const step = Math.min(1, remaining);
    const candidate = { x: current.x + unit.x * step, y: current.y + unit.y * step };
    if (
      candidate.x < radius ||
      candidate.x > ARENA.width - radius ||
      candidate.y < radius ||
      candidate.y > ARENA.height - radius ||
      obstacles.some((obstacle) => circleIntersectsRect(candidate, radius, obstacle))
    ) {
      break;
    }
    current = candidate;
    remaining -= step;
  }

  return current;
}

export function separatePlayers(
  players: Record<string, { position: Vec2 }>,
  stablePlayerIds: readonly string[] = Object.keys(players).sort()
): void {
  const playerIds = stablePlayerIds;
  const minimumDistance = GAME.playerRadius * 2;

  for (let pass = 0; pass < 2; pass += 1) {
    const passPositions = playerIds.map((playerId) => players[playerId].position);
    const corrections = playerIds.map(() => ({ x: 0, y: 0 }));

    for (let leftIndex = 0; leftIndex < playerIds.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < playerIds.length; rightIndex += 1) {
        const leftPosition = passPositions[leftIndex];
        const rightPosition = passPositions[rightIndex];
        const dx = rightPosition.x - leftPosition.x;
        const dy = rightPosition.y - leftPosition.y;
        const distance = Math.hypot(dx, dy);
        if (distance >= minimumDistance) continue;

        const direction = distance === 0 ? { x: 1, y: 0 } : { x: dx / distance, y: dy / distance };
        const correction = (minimumDistance - distance) / 2;
        corrections[leftIndex].x -= direction.x * correction;
        corrections[leftIndex].y -= direction.y * correction;
        corrections[rightIndex].x += direction.x * correction;
        corrections[rightIndex].y += direction.y * correction;
      }
    }

    for (let playerIndex = 0; playerIndex < playerIds.length; playerIndex += 1) {
      const correction = corrections[playerIndex];
      players[playerIds[playerIndex]].position = pushCircle(
        passPositions[playerIndex],
        correction,
        Math.hypot(correction.x, correction.y),
        GAME.playerRadius,
        ARENA.obstacles
      );
    }
  }
}
