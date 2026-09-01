import { describe, expect, it } from 'vitest';
import type { FighterView } from './FighterView.js';
import { PhaserImpactAdapter } from './PhaserImpactAdapter.js';

class FakeObject {
  alpha = 1;
  scaleX = 1;
  scaleY = 1;
  rotation = 0;
  text = '';
  fixedWidth = 0;
  fixedHeight = 0;
  destroyed = 0;

  constructor(public x = 0, public y = 0, readonly color: number | null = null) {}
  setOrigin(): this { return this; }
  setStrokeStyle(): this { return this; }
  setRotation(value: number): this { this.rotation = value; return this; }
  setScale(x: number, y = x): this { this.scaleX = x; this.scaleY = y; return this; }
  setAlpha(value: number): this { this.alpha = value; return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setText(value: string): this { this.text = value; return this; }
  setFixedSize(width: number, height: number): this { this.fixedWidth = width; this.fixedHeight = height; return this; }
  setBlendMode(): this { return this; }
  setDepth(): this { return this; }
  destroy(): void { this.destroyed += 1; }
}

class FakeTween {
  removed = 0;
  private readonly listeners = new Map<string, Array<() => void>>();
  once(event: string, listener: () => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string): void {
    const listeners = this.listeners.get(event) ?? [];
    this.listeners.delete(event);
    for (const listener of listeners) listener();
  }
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
      text: (x: number, y: number, value: string) => {
        const object = addObject('text', x, y);
        object.text = value;
        return object;
      }
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

  it('keeps same-frame non-knockout camera nudges separate', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    adapter.nudgeCamera({ x: 1, y: 0 }, 0.75);
    adapter.nudgeCamera({ x: -1, y: 0.5 }, 1);

    expect(stub.tweens).toHaveLength(2);
  });

  it('coalesces same-frame knockout camera nudges only', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    adapter.nudgeKnockoutCamera(10, { x: 1, y: 0 }, 0.75);
    adapter.nudgeKnockoutCamera(10, { x: -1, y: 0.5 }, 1);

    expect(stub.tweens).toHaveLength(1);
  });

  it('caps presentation hit-stop at 35ms', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    adapter.holdHitPose('p1', 999);

    expect(stub.tweens.at(-1)?.config.duration).toBe(35);
  });

  it('renders clash, perfect dodge, pulse spawn, and pulse break with distinct bounded palettes', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);
    const baseline = stub.objects.length;

    adapter.emitClash({ x: 260, y: 360 }, 'HEAVY');
    adapter.emitPerfectDodge({ x: 280, y: 360 });
    adapter.emitPulseSpawn({ x: 300, y: 360 });
    adapter.emitPulseBreak({ x: 340, y: 360 });

    const colors = new Set(stub.objects.map(({ object }) => object.color));
    expect(colors).toContain(0xf6d743);
    expect(colors).toContain(0x9ef25b);
    expect(colors).toContain(0x6ee7f2);
    expect(colors).toContain(0xff5fa2);
    expect(stub.objects.length - baseline).toBeLessThanOrEqual(40);
  });

  it('renders knockout, score, announcer, and respawn feedback as larger ephemeral layers', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);
    const baseline = stub.objects.length;

    adapter.emitKnockoutBurst({ x: 300, y: 360 }, 1);
    adapter.emitEdgeStreak({ x: 300, y: 360 }, { x: -1, y: 0 });
    adapter.pulseScore('p1', 3);
    adapter.announceKnockout('Ada', 'Bora');
    adapter.emitRespawn('p1', { x: 640, y: 360 });

    expect(stub.objects.filter(({ kind }) => kind === 'circle').length).toBeGreaterThanOrEqual(16 + 1);
    expect(stub.objects.filter(({ kind }) => kind === 'text')).toHaveLength(24);
    expect(stub.objects.filter(({ kind }) => kind === 'rectangle').length).toBeGreaterThanOrEqual(56);
    expect(stub.objects.length - baseline).toBe(1);
  });

  it('keeps three simultaneous knockout presentations readable without overwriting texts', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);
    const baseline = stub.objects.length;

    for (const [index, x] of [300, 340, 380].entries()) {
      adapter.emitKnockoutBurst({ x, y: 360 }, 1);
      adapter.emitEdgeStreak({ x, y: 360 }, { x: index % 2 === 0 ? -1 : 1, y: 0 });
      adapter.pulseScore('p1', index + 1);
      adapter.announceKnockout(`Ada ${index + 1}`, `Bora ${index + 1}`);
    }

    expect(stub.objects).toHaveLength(baseline);
    expect(stub.objects.filter(({ kind }) => kind === 'text')).toHaveLength(24);
    expect(stub.objects.filter(({ kind }) => kind === 'circle')).toHaveLength(16);
    expect(stub.objects.filter(({ kind }) => kind === 'rectangle')).toHaveLength(56);
    expect(stub.objects.filter(({ kind }) => kind === 'text').slice(0, 9).map(({ object }) => object.text)).toEqual([
      'RING OUT', '+1', 'Ada 1  >  Bora 1',
      'RING OUT', '+1', 'Ada 2  >  Bora 2',
      'RING OUT', '+1', 'Ada 3  >  Bora 3'
    ]);
  });

  it('caps simultaneous knockout presentation allocations at the 8-player pool bound', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    for (let index = 0; index < 9; index += 1) {
      adapter.emitKnockoutBurst({ x: 300 + index * 20, y: 360 }, 1);
      adapter.emitEdgeStreak({ x: 300 + index * 20, y: 360 }, { x: -1, y: 0 });
      adapter.pulseScore('p1', index + 1);
      adapter.announceKnockout(`Ada ${index + 1}`, `Bora ${index + 1}`);
    }

    expect(stub.objects).toHaveLength(96);
    expect(stub.objects.filter(({ kind }) => kind === 'text')).toHaveLength(24);
    expect(stub.objects.filter(({ kind }) => kind === 'circle')).toHaveLength(16);
    expect(stub.objects.filter(({ kind }) => kind === 'rectangle')).toHaveLength(56);
  });

  it('prewarms the full 8-player knockout pool before gameplay so the first 1-8 knockouts add no new objects', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);
    const prewarmedCount = stub.objects.length;

    expect(prewarmedCount).toBe(96);

    for (let index = 0; index < 8; index += 1) {
      adapter.emitKnockoutBurst({ x: 300 + index * 20, y: 360 }, 1);
      adapter.emitEdgeStreak({ x: 300 + index * 20, y: 360 }, { x: -1, y: 0 });
      adapter.pulseScore('p1', index + 1);
      adapter.announceKnockout(`Ada ${index + 1}`, `Bora ${index + 1}`);
    }

    expect(stub.objects).toHaveLength(prewarmedCount);
  });

  it('prewarms non-empty fixed-size knockout text textures before the first ring-out', () => {
    const stub = harness();
    new PhaserImpactAdapter(stub.scene as never, () => stub.view);

    const texts = stub.objects.filter(({ kind }) => kind === 'text').map(({ object }) => object);
    expect(texts).toHaveLength(24);
    expect(texts.every(({ text, fixedWidth, fixedHeight }) =>
      text.length > 0 && fixedWidth > 0 && fixedHeight > 0)).toBe(true);
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

  it('releases completed or stopped tweens from retention while keeping disposal idempotent for live tweens', () => {
    const stub = harness();
    const adapter = new PhaserImpactAdapter(stub.scene as never, () => stub.view);
    adapter.flashTarget('p1', 0.8);
    adapter.holdHitPose('p1', 35);
    adapter.nudgeCamera({ x: 1, y: 0 }, 0.5);

    const completedTween = stub.tweens[0]!.tween;
    const stoppedTween = stub.tweens[1]!.tween;
    const liveTween = stub.tweens[2]!.tween;
    completedTween.emit('complete');
    stoppedTween.emit('stop');

    adapter.dispose();
    adapter.dispose();

    expect(completedTween.removed).toBe(0);
    expect(stoppedTween.removed).toBe(0);
    expect(liveTween.removed).toBe(1);
  });
});
