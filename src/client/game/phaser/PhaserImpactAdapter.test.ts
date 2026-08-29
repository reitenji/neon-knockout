import { describe, expect, it } from 'vitest';
import type { FighterView } from './FighterView.js';
import { PhaserImpactAdapter } from './PhaserImpactAdapter.js';

class FakeObject {
  alpha = 1;
  scaleX = 1;
  scaleY = 1;
  rotation = 0;
  destroyed = 0;

  constructor(public x = 0, public y = 0, readonly color: number | null = null) {}
  setOrigin(): this { return this; }
  setStrokeStyle(): this { return this; }
  setRotation(value: number): this { this.rotation = value; return this; }
  setScale(x: number, y = x): this { this.scaleX = x; this.scaleY = y; return this; }
  setAlpha(value: number): this { this.alpha = value; return this; }
  setBlendMode(): this { return this; }
  setDepth(): this { return this; }
  destroy(): void { this.destroyed += 1; }
}

class FakeTween {
  removed = 0;
  remove(): this { this.removed += 1; return this; }
}

function harness() {
  const objects: Array<{ kind: string; object: FakeObject }> = [];
  const tweens: Array<{ config: Record<string, unknown>; tween: FakeTween }> = [];
  const content = new FakeObject();
  const view = { outer: new FakeObject(300, 360), content } as unknown as FighterView;
  const addObject = (kind: string, x = 0, y = 0, color: number | null = null) => {
    const object = new FakeObject(x, y, color);
    objects.push({ kind, object });
    return object;
  };
  const scene = {
    add: {
      rectangle: (x: number, y: number, _w: number, _h: number, color: number) => addObject('rectangle', x, y, color),
      circle: (x: number, y: number, _radius: number, color: number) => addObject('circle', x, y, color),
      polygon: (x: number, y: number, _points: unknown, color: number) => addObject('polygon', x, y, color),
      text: (x: number, y: number) => addObject('text', x, y)
    },
    tweens: {
      add(config: Record<string, unknown>) {
        const tween = new FakeTween();
        tweens.push({ config, tween });
        return tween;
      }
    },
    cameras: { main: { scrollX: 0, scrollY: 0 } }
  };
  return { scene, objects, tweens, content, view };
}

describe('PhaserImpactAdapter', () => {
  it('uses fighter content plus directional sparks, overload text, and a streak without creating a black ellipse', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    adapter.flashTarget('p1', 0.5);
    adapter.holdHitPose('p1', 95);
    adapter.emitDirectionalParticles({ x: 280, y: 360 }, { x: 1, y: 0 }, 0.5);
    adapter.pulseOverload('p1', 47, 0.5);
    adapter.emitKnockbackTrail('p1', { x: 1, y: 0 }, 0.5);

    expect(stub.tweens.some(({ config }) => config.targets === stub.content && 'alpha' in config)).toBe(true);
    expect(stub.tweens.some(({ config }) => config.targets === stub.content && 'scaleX' in config)).toBe(true);
    expect(stub.objects.some(({ kind }) => kind === 'rectangle')).toBe(true);
    expect(stub.objects.some(({ kind }) => kind === 'text')).toBe(true);
    expect(stub.objects.some(({ kind }) => kind === 'ellipse')).toBe(false);
    expect(stub.objects.every(({ object }) => object.color !== 0x000000)).toBe(true);
  });

  it('creates directional camera movement rather than camera feedback hidden in a generic shake', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    adapter.nudgeCamera({ x: 1, y: -0.5 }, 0.75);

    expect(stub.tweens.at(-1)?.config).toMatchObject({
      targets: stub.scene.cameras.main,
      scrollX: 6,
      scrollY: -3,
      yoyo: true
    });
  });

  it('renders knockout, score, announcer, and respawn feedback as larger ephemeral layers', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    adapter.emitKnockoutBurst({ x: 300, y: 360 }, 1);
    adapter.emitEdgeStreak({ x: 300, y: 360 }, { x: -1, y: 0 });
    adapter.pulseScore('p1', 3);
    adapter.announceKnockout('Ada', 'Bora');
    adapter.emitRespawn('p1', { x: 640, y: 360 });

    expect(stub.objects.filter(({ kind }) => kind === 'circle').length).toBeGreaterThanOrEqual(3);
    expect(stub.objects.filter(({ kind }) => kind === 'text')).toHaveLength(3);
    expect(stub.objects.filter(({ kind }) => kind === 'rectangle').length).toBeGreaterThanOrEqual(8);
  });

  it('removes live tweens and visuals, restores fighter content, and disposes idempotently', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);
    adapter.flashTarget('p1', 0.8);
    adapter.emitRespawn('p1', { x: 640, y: 360 });
    stub.content.setAlpha(0.4).setScale(1.2);

    adapter.dispose();
    adapter.dispose();

    expect(stub.tweens.every(({ tween }) => tween.removed === 1)).toBe(true);
    expect(stub.objects.every(({ object }) => object.destroyed === 1)).toBe(true);
    expect(stub.content).toMatchObject({ alpha: 1, scaleX: 1, scaleY: 1 });
  });
});
