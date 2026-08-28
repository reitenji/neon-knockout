import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

import { createArenaView } from './ArenaView.js';

type RecordedCall = Readonly<{ method: string; args: readonly unknown[] }>;

class RecordingGraphics {
  readonly calls: RecordedCall[] = [];
  destroyed = 0;

  fillStyle(...args: readonly unknown[]) { this.calls.push({ method: 'fillStyle', args }); return this; }
  lineStyle(...args: readonly unknown[]) { this.calls.push({ method: 'lineStyle', args }); return this; }
  fillPoints(...args: readonly unknown[]) { this.calls.push({ method: 'fillPoints', args }); return this; }
  strokePoints(...args: readonly unknown[]) { this.calls.push({ method: 'strokePoints', args }); return this; }
  fillCircle(...args: readonly unknown[]) { this.calls.push({ method: 'fillCircle', args }); return this; }
  strokeCircle(...args: readonly unknown[]) { this.calls.push({ method: 'strokeCircle', args }); return this; }
  beginPath(...args: readonly unknown[]) { this.calls.push({ method: 'beginPath', args }); return this; }
  moveTo(...args: readonly unknown[]) { this.calls.push({ method: 'moveTo', args }); return this; }
  lineTo(...args: readonly unknown[]) { this.calls.push({ method: 'lineTo', args }); return this; }
  strokePath(...args: readonly unknown[]) { this.calls.push({ method: 'strokePath', args }); return this; }
  clear(...args: readonly unknown[]) { this.calls.push({ method: 'clear', args }); return this; }
  destroy() { this.destroyed += 1; }
}

function scene() {
  const graphics: RecordingGraphics[] = [];
  return {
    graphics,
    add: {
      graphics() {
        const next = new RecordingGraphics();
        graphics.push(next);
        return next;
      }
    }
  };
}

describe('ArenaView', () => {
  it('draws a layered sci-fi shell with recessed fills, luminous edges, and corner nodes instead of a flat octagon', () => {
    const stub = scene();
    createArenaView(stub as never, { reducedMotion: false });

    expect(stub.graphics).toHaveLength(3);
    expect(stub.graphics[0]?.calls.filter((call) => call.method === 'fillPoints')).toHaveLength(4);
    expect(stub.graphics[0]?.calls.filter((call) => call.method === 'strokePoints').length).toBeGreaterThanOrEqual(3);
    expect(stub.graphics[1]?.calls.filter((call) => call.method === 'fillCircle')).toHaveLength(16);
    expect(stub.graphics[1]?.calls.filter((call) => call.method === 'strokeCircle')).toHaveLength(8);
  });

  it('renders contraction warning chevrons and a bright contracted boundary on the overlay layer', () => {
    const stub = scene();
    const arena = createArenaView(stub as never, { reducedMotion: false });

    arena.apply({ phase: 'REGULATION', remainingMs: 24_000, platformProgress: 0.35 }, 420);

    const overlay = stub.graphics[2]!;
    expect(overlay.calls[0]).toEqual({ method: 'clear', args: [] });
    expect(overlay.calls.some((call) => call.method === 'fillPoints')).toBe(true);
    expect(overlay.calls.filter((call) => call.method === 'strokePoints').length).toBeGreaterThanOrEqual(2);
    expect(overlay.calls.filter((call) => call.method === 'strokePath')).toHaveLength(8);
    expect(overlay.calls.filter((call) => call.method === 'fillCircle').length).toBeGreaterThanOrEqual(8);
  });

  it('destroys every owned graphics layer exactly once', () => {
    const stub = scene();
    const arena = createArenaView(stub as never, { reducedMotion: true });

    arena.destroy();
    arena.destroy();

    expect(stub.graphics.map((graphic) => graphic.destroyed)).toEqual([1, 1, 1]);
  });
});
