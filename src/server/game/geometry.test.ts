import { describe, expect, it } from 'vitest';

import { GAME } from '../../shared/constants.js';
import { circleIntersectsRect, movePlayer, pushCircle, separatePlayers } from './geometry.js';

describe('game geometry', () => {
  it('keeps diagonal movement at the base speed', () => {
    const next = movePlayer({ x: 100, y: 100 }, { x: 1, y: 1 }, 1_000, false);

    expect(Math.hypot(next.x - 100, next.y - 100)).toBeCloseTo(GAME.moveSpeed, 5);
  });

  it('keeps pushed circles inside the arena boundary', () => {
    const next = pushCircle({ x: 25, y: 100 }, { x: -1, y: 0 }, 10, 20, []);

    expect(next).toEqual({ x: 20, y: 100 });
  });

  it('stops tackle push at the last valid point before a wall', () => {
    const wall = { x: 240, y: 250, width: 40, height: 100 };
    const result = pushCircle({ x: 205, y: 300 }, { x: 1, y: 0 }, 52, 20, [wall]);

    expect(result.x).toBe(219);
    expect(circleIntersectsRect(result, 20, wall)).toBe(false);
  });

  it('separates identical centers in stable player-id order', () => {
    const players = {
      'p-b': { position: { x: 100, y: 100 } },
      'p-a': { position: { x: 100, y: 100 } }
    };

    separatePlayers(players);

    expect(players['p-a'].position).toEqual({ x: 80, y: 100 });
    expect(players['p-b'].position).toEqual({ x: 120, y: 100 });
  });
});
