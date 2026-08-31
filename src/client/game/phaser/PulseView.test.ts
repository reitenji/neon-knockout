import { describe, expect, it, vi } from 'vitest';
import type { MatchPulse } from '../../../shared/model.js';
import { createPulseView } from './PulseView.js';

vi.mock('phaser', () => ({ default: { BlendModes: { ADD: 'ADD' } } }));

class FakeGraphics {
  alpha = 1;
  readonly circles: Array<{ x: number; y: number; radius: number }> = [];
  clears = 0;

  clear(): this { this.clears += 1; this.circles.length = 0; return this; }
  fillStyle(): this { return this; }
  lineStyle(): this { return this; }
  fillCircle(x: number, y: number, radius: number): this { this.circles.push({ x, y, radius }); return this; }
  strokeCircle(): this { return this; }
  fillRoundedRect(): this { return this; }
  setBlendMode(): this { return this; }
  setDepth(): this { return this; }
  setAlpha(value: number): this { this.alpha = value; return this; }
}

class FakeContainer {
  x = 0;
  y = 0;
  rotation = 0;
  destroyed = 0;
  readonly children: unknown[] = [];

  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setRotation(rotation: number): this { this.rotation = rotation; return this; }
  setDepth(): this { return this; }
  add(children: unknown[]): this { this.children.push(...children); return this; }
  destroy(): void { this.destroyed += 1; }
}

function pulse(overrides: Partial<MatchPulse> = {}): MatchPulse {
  return {
    projectileId: 7,
    ownerPlayerId: 'p1',
    originatingAttackId: 11,
    position: { x: 320, y: 280 },
    velocity: { x: 900, y: 0 },
    radius: 18,
    remainingMs: 400,
    hitTargetIds: [],
    ...overrides
  };
}

describe('PulseView', () => {
  it('renders and updates one authoritative projectile position, heading, radius, and lifetime state', () => {
    const containers: FakeContainer[] = [];
    const graphics: FakeGraphics[] = [];
    const scene = {
      add: {
        container: () => {
          const value = new FakeContainer();
          containers.push(value);
          return value;
        },
        graphics: () => {
          const value = new FakeGraphics();
          graphics.push(value);
          return value;
        }
      }
    };
    const view = createPulseView(scene as never, pulse());

    expect(containers[0]).toMatchObject({ x: 320, y: 280, rotation: 0 });
    expect(graphics[0]?.circles).toContainEqual({ x: 0, y: 0, radius: 18 });

    view.apply(pulse({ position: { x: 410, y: 310 }, velocity: { x: 0, y: -900 }, remainingMs: 120 }));

    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({ x: 410, y: 310, rotation: -Math.PI / 2 });
    expect(graphics[0]?.clears).toBe(2);
    expect(graphics[0]?.alpha).toBeLessThan(1);
  });

  it('destroys its owned display tree idempotently and ignores later snapshots', () => {
    const container = new FakeContainer();
    const scene = { add: { container: () => container, graphics: () => new FakeGraphics() } };
    const view = createPulseView(scene as never, pulse());

    view.destroy();
    view.destroy();
    view.apply(pulse({ position: { x: 900, y: 600 } }));

    expect(container.destroyed).toBe(1);
    expect(container).toMatchObject({ x: 320, y: 280 });
  });
});
