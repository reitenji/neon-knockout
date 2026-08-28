import { describe, expect, it } from 'vitest';
import { ARENA } from '../../shared/constants.js';
import type { MatchSnapshot } from '../../shared/model.js';
import { RENDER_LAYERS, fitArena, renderFrame, resizeCanvas } from './renderer.js';

class ContextStub {
  readonly calls: string[] = [];
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  globalAlpha = 1;
  shadowBlur = 0;
  shadowColor = '';
  lineCap: CanvasLineCap = 'butt';
  save() { this.calls.push('save'); }
  restore() { this.calls.push('restore'); }
  clearRect() { this.calls.push('clearRect'); }
  fillRect() { this.calls.push('fillRect'); }
  strokeRect() { this.calls.push('strokeRect'); }
  beginPath() { this.calls.push('beginPath'); }
  closePath() { this.calls.push('closePath'); }
  arc() { this.calls.push('arc'); }
  fill() { this.calls.push('fill'); }
  stroke() { this.calls.push('stroke'); }
  moveTo() { this.calls.push('moveTo'); }
  lineTo() { this.calls.push('lineTo'); }
  drawImage() { this.calls.push('drawImage'); }
  fillText() { this.calls.push('fillText'); }
  translate() { this.calls.push('translate'); }
  scale() { this.calls.push('scale'); }
  rotate() { this.calls.push('rotate'); }
}

function snapshot(): MatchSnapshot {
  return {
    tick: 1,
    phase: 'REGULATION',
    remainingMs: 120_000,
    score: { CYAN: 2, AMBER: 1 },
    players: [
      {
        playerId: 'p-1',
        name: 'Ada',
        team: 'CYAN',
        position: { x: 180, y: 220 },
        carriedCoreId: null,
        lastProcessedInputSeq: 2,
        dashRemainingMs: 0,
        dashCooldownRemainingMs: 0,
        stunRemainingMs: 0,
        stats: { deliveries: 0, tackles: 0 }
      }
    ],
    cores: [{ coreId: 'core-1', position: { x: 640, y: 360 }, carrierId: null, golden: false }],
    winner: null
  };
}

describe('renderer helpers', () => {
  it('sizes the backing canvas for device pixel ratio and preserves CSS dimensions', () => {
    const canvas = { width: 0, height: 0, style: { width: '', height: '' } } as HTMLCanvasElement;

    const changed = resizeCanvas(canvas, 640, 360, 2);

    expect(changed).toBe(true);
    expect(canvas.width).toBe(1280);
    expect(canvas.height).toBe(720);
    expect(canvas.style.width).toBe('640px');
    expect(canvas.style.height).toBe('360px');
    expect(resizeCanvas(canvas, 640, 360, 2)).toBe(false);
  });

  it('computes a centered 1280×720 letterbox transform', () => {
    const fit = fitArena(800, 400, ARENA.width, ARENA.height);

    expect(fit.scale).toBeCloseTo(400 / ARENA.height, 4);
    expect(fit.offsetX).toBeGreaterThan(0);
    expect(fit.offsetY).toBe(0);
    expect(fit.contentWidth).toBeCloseTo(ARENA.width * fit.scale, 4);
    expect(fit.contentHeight).toBe(400);
  });

  it('renders the authoritative arena in the required stable layer order', () => {
    const context = new ContextStub() as unknown as CanvasRenderingContext2D;
    const layers: string[] = [];

    renderFrame(context, {
      viewport: fitArena(1280, 720, ARENA.width, ARENA.height),
      snapshot: snapshot(),
      previousSnapshot: null,
      interpolationAlpha: 1,
      localPlayerId: 'p-1',
      predictedLocalPosition: { x: 180, y: 220 },
      floorImage: null,
      particles: null,
      onLayer: (layer) => layers.push(layer)
    });

    expect(layers).toEqual(RENDER_LAYERS);
    expect((context as unknown as ContextStub).calls).toContain('fillText');
  });
});
