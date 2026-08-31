import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAttackCapsule } from '../../../shared/combat/geometry.js';
import { profileForAttack } from '../../../shared/combat/profiles.js';
import type { MatchAction, MatchPlayer } from '../../../shared/model.js';

vi.mock('phaser', () => ({
  default: {
    BlendModes: { ADD: 'ADD' },
    Math: {
      Vector2: class Vector2 {
        constructor(public x: number, public y: number) {}
      }
    }
  }
}));

import { createFighterView } from './FighterView.js';

type LineStyle = Readonly<{ width: number; color: number; alpha: number }>;
type FillStyle = Readonly<{ color: number; alpha: number }>;
type DrawCommand =
  | Readonly<{ kind: 'clear' }>
  | Readonly<{ kind: 'line'; from: Readonly<{ x: number; y: number }>; to: Readonly<{ x: number; y: number }>; style: LineStyle }>
  | Readonly<{ kind: 'circle'; x: number; y: number; radius: number; style: FillStyle }>
  | Readonly<{ kind: 'arc'; x: number; y: number; radius: number; start: number; end: number; style: LineStyle }>
  | Readonly<{ kind: 'fill-points'; points: readonly Readonly<{ x: number; y: number }>[]; closeShape: boolean; style: FillStyle }>;

class FakeDisplayObject {
  x = 0;
  y = 0;
  rotation = 0;
  scaleX = 1;
  scaleY = 1;
  alpha = 1;
  destroyed = 0;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  setOrigin(): this { return this; }
  setTint(): this { return this; }
  setBlendMode(): this { return this; }
  setDepth(): this { return this; }
  setPosition(x: number, y: number): this { this.x = x; this.y = y; return this; }
  setRotation(rotation: number): this { this.rotation = rotation; return this; }
  setScale(x: number, y = x): this { this.scaleX = x; this.scaleY = y; return this; }
  setAlpha(alpha: number): this { this.alpha = alpha; return this; }
  destroy(): void { this.destroyed += 1; }
}

class FakeContainer extends FakeDisplayObject {
  readonly children: unknown[] = [];
  add(children: unknown | unknown[]): this {
    this.children.push(...(Array.isArray(children) ? children : [children]));
    return this;
  }
  destroy(): void { this.destroyed += 1; }
}

class FakeGraphics extends FakeDisplayObject {
  readonly commands: DrawCommand[] = [];
  visible = true;
  private line: LineStyle = { width: 0, color: 0, alpha: 0 };
  private fill: FillStyle = { color: 0, alpha: 0 };

  clear(): this { this.commands.push({ kind: 'clear' }); return this; }
  lineStyle(width: number, color: number, alpha: number): this {
    this.line = { width, color, alpha };
    return this;
  }
  fillStyle(color: number, alpha: number): this { this.fill = { color, alpha }; return this; }
  lineBetween(fromX: number, fromY: number, toX: number, toY: number): this {
    this.commands.push({
      kind: 'line', from: { x: fromX, y: fromY }, to: { x: toX, y: toY }, style: this.line
    });
    return this;
  }
  fillCircle(x: number, y: number, radius: number): this {
    this.commands.push({ kind: 'circle', x, y, radius, style: this.fill });
    return this;
  }
  beginPath(): this { return this; }
  arc(x: number, y: number, radius: number, start: number, end: number): this {
    this.commands.push({ kind: 'arc', x, y, radius, start, end, style: this.line });
    return this;
  }
  strokePath(): this { return this; }
  setVisible(visible: boolean): this { this.visible = visible; return this; }
  fillPoints(points: readonly Readonly<{ x: number; y: number }>[], closeShape: boolean): this {
    this.commands.push({ kind: 'fill-points', points, closeShape, style: this.fill });
    return this;
  }
  strokePoints(): this { return this; }
}

class FakeImage extends FakeDisplayObject {}

class FakeText extends FakeDisplayObject {
  constructor(x: number, y: number, public text: string) { super(x, y); }
  setText(text: string): this { this.text = text; return this; }
}

function sceneHarness() {
  const graphics: FakeGraphics[] = [];
  const containers: FakeContainer[] = [];
  const scene = {
    time: { now: 0 },
    add: {
      container(x: number, y: number) {
        const container = new FakeContainer(x, y);
        containers.push(container);
        return container;
      },
      graphics() {
        const value = new FakeGraphics();
        graphics.push(value);
        return value;
      },
      image(x: number, y: number) { return new FakeImage(x, y); },
      text(x: number, y: number, text: string) { return new FakeText(x, y, text); }
    }
  };
  return { scene, graphics, containers };
}

const idleAction: MatchAction = {
  kind: null, phase: 'IDLE', comboStep: 0, chargeMs: 0, charging: false,
  attackId: null, profileId: null, lockedFacing: null, activeProgress: 0, hitTargetIds: []
};

function player(overrides: Partial<MatchPlayer> = {}): MatchPlayer {
  return {
    playerId: 'p1', name: 'Ada', chassis: 'RIFT', accent: 0,
    position: { x: 300, y: 360 }, velocity: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, overload: 0,
    lastProcessedInputSeq: 0, action: idleAction, dashRemainingMs: 0, dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0, respawnRemainingMs: 0, protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 },
    ...overrides
  };
}

function frameCommands(graphics: FakeGraphics): DrawCommand[] {
  const lastClear = graphics.commands.map((command) => command.kind).lastIndexOf('clear');
  return graphics.commands.slice(lastClear + 1);
}

describe('FighterView real graphics presentation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates no decorative ground-footprint polygons beneath the fighter', () => {
    const harness = sceneHarness();

    createFighterView(harness.scene as never, player(), true, { reducedMotion: true });

    expect(harness.graphics.flatMap((graphics) => graphics.commands)
      .filter((command) => command.kind === 'fill-points')).toEqual([]);
  });

  it('draws the exact shared swept capsule locally without transform scaling drift', () => {
    const harness = sceneHarness();
    const currentPlayer = player();
    const view = createFighterView(harness.scene as never, currentPlayer, true, { reducedMotion: true });
    const telegraph = {
      profileId: 'quick-1', facing: { x: 1, y: 0 },
      previousProgress: 0, currentProgress: 1 / 3, active: true
    } as const;

    view.apply(currentPlayer, { x: 300, y: 360 }, { x: 1, y: 0 }, null, telegraph, null);

    const expected = buildAttackCapsule(
      { x: 0, y: 0 }, { x: 1, y: 0 }, profileForAttack('QUICK_1'), 0, 1 / 3
    );
    const trail = harness.graphics[1]!;
    const commands = frameCommands(trail);
    expect(commands).toContainEqual({
      kind: 'line', from: expected.from, to: expected.to,
      style: expect.objectContaining({ width: expected.radius * 2 })
    });
    expect(commands.filter((command) => command.kind === 'circle')).toEqual([
      expect.objectContaining({ x: expected.from.x, y: expected.from.y, radius: expected.radius }),
      expect.objectContaining({ x: expected.to.x, y: expected.to.y, radius: expected.radius })
    ]);
    expect(trail).toMatchObject({ scaleX: 1, scaleY: 1 });
    expect(view.outer).toMatchObject({ x: 300, y: 360, scaleX: 1, scaleY: 1 });
  });

  it('renders eight directions, selected progress, and readiness with stronger local styling but identical information', () => {
    const localHarness = sceneHarness();
    const remoteHarness = sceneHarness();
    const canonicalCharge = {
      ...idleAction, chargeMs: 700, charging: true
    } satisfies MatchAction;
    const localPlayer = player();
    const remotePlayer = player({ playerId: 'p2', action: canonicalCharge });
    const localView = createFighterView(localHarness.scene as never, localPlayer, true, { reducedMotion: true });
    const remoteView = createFighterView(remoteHarness.scene as never, remotePlayer, false, { reducedMotion: true });
    const state = { facing: { x: 0, y: -1 }, progress: 0.5, pulseReady: true } as const;

    localView.apply(localPlayer, localPlayer.position, localPlayer.facing, canonicalCharge, null, state);
    remoteView.apply(remotePlayer, remotePlayer.position, remotePlayer.facing, null, null, state);

    const localCommands = frameCommands(localHarness.graphics[2]!);
    const remoteCommands = frameCommands(remoteHarness.graphics[2]!);
    const localTicks = localCommands.filter((command) => command.kind === 'line');
    const remoteTicks = remoteCommands.filter((command) => command.kind === 'line');
    const localArc = localCommands.find((command) => command.kind === 'arc');
    const remoteArc = remoteCommands.find((command) => command.kind === 'arc');
    const localReady = localCommands.find((command) => command.kind === 'circle');
    const remoteReady = remoteCommands.find((command) => command.kind === 'circle');

    expect(localTicks).toHaveLength(8);
    expect(remoteTicks).toHaveLength(8);
    expect(localTicks.filter((command) => command.style.width === 3.4)).toHaveLength(1);
    expect(remoteTicks.filter((command) => command.style.width === 2.6)).toHaveLength(1);
    expect(localArc).toEqual(expect.objectContaining({ radius: 59, start: -Math.PI / 2, end: Math.PI / 2 }));
    expect(remoteArc).toEqual(expect.objectContaining({ radius: 56, start: -Math.PI / 2, end: Math.PI / 2 }));
    expect(localReady).toEqual(expect.objectContaining({ x: expect.closeTo(0), y: -59, radius: 4 }));
    expect(remoteReady).toEqual(expect.objectContaining({ x: expect.closeTo(0), y: -56, radius: 3 }));
    expect(localCommands.map((command) => command.kind)).toEqual(remoteCommands.map((command) => command.kind));
  });

  it('renders the distinct local-predicted and remote-authoritative charge state shapes selected by the scene', () => {
    const localHarness = sceneHarness();
    const remoteHarness = sceneHarness();
    const staleLocalPlayer = player({
      facing: { x: 1, y: 0 },
      action: { ...idleAction, chargeMs: 175, charging: true }
    });
    const predictedLocalAction = { ...idleAction, chargeMs: 525, charging: true } satisfies MatchAction;
    const remotePlayer = player({
      playerId: 'p2',
      facing: { x: -1, y: 0 },
      action: { ...idleAction, chargeMs: 700, charging: true }
    });
    const localView = createFighterView(localHarness.scene as never, staleLocalPlayer, true, { reducedMotion: true });
    const remoteView = createFighterView(remoteHarness.scene as never, remotePlayer, false, { reducedMotion: true });

    localView.apply(
      staleLocalPlayer,
      { x: 312, y: 348 },
      { x: 0, y: -1 },
      predictedLocalAction,
      null,
      { facing: { x: 0, y: -1 }, progress: 0.75, pulseReady: false }
    );
    remoteView.apply(
      remotePlayer,
      remotePlayer.position,
      remotePlayer.facing,
      null,
      null,
      { facing: { x: -1, y: 0 }, progress: 1, pulseReady: true }
    );

    const localCommands = frameCommands(localHarness.graphics[2]!);
    const remoteCommands = frameCommands(remoteHarness.graphics[2]!);
    const localSelected = localCommands.find(
      (command) => command.kind === 'line' && command.style.width === 3.4
    );
    const remoteSelected = remoteCommands.find(
      (command) => command.kind === 'line' && command.style.width === 2.6
    );
    expect(localSelected).toEqual(expect.objectContaining({
      from: { x: expect.closeTo(0), y: -42 },
      to: { x: expect.closeTo(0), y: -56 }
    }));
    expect(remoteSelected).toEqual(expect.objectContaining({
      from: { x: -40, y: expect.closeTo(0) },
      to: { x: -53, y: expect.closeTo(0) }
    }));
    expect(localCommands.find((command) => command.kind === 'arc')).toEqual(expect.objectContaining({
      radius: 59, end: Math.PI
    }));
    expect(remoteCommands.find((command) => command.kind === 'arc')).toEqual(expect.objectContaining({
      radius: 56, end: Math.PI * 1.5
    }));
    expect(localCommands.some((command) => command.kind === 'circle')).toBe(false);
    expect(remoteCommands.find((command) => command.kind === 'circle')).toEqual(expect.objectContaining({
      x: -56, y: expect.closeTo(0), radius: 3
    }));
  });

  it('keeps a released charge indicator on its locked facing instead of the current presentation facing', () => {
    const harness = sceneHarness();
    const currentPlayer = player({
      facing: { x: 0, y: -1 },
      action: {
        ...idleAction, kind: 'HEAVY', phase: 'ACTIVE', chargeMs: 700, charging: false,
        attackId: 7, profileId: 'heavy-melee', lockedFacing: { x: -1, y: 0 }, activeProgress: 0.4
      }
    });
    const view = createFighterView(harness.scene as never, currentPlayer, true, { reducedMotion: true });

    view.apply(
      currentPlayer, currentPlayer.position, currentPlayer.facing, null, null,
      { facing: { x: -1, y: 0 }, progress: 1, pulseReady: true }
    );

    const indicator = frameCommands(harness.graphics[2]!);
    const selected = indicator.find((command) => command.kind === 'line' && command.style.width === 3.4);
    expect(view.content.rotation).toBeCloseTo(-Math.PI / 2);
    expect(selected).toEqual(expect.objectContaining({
      from: { x: -42, y: expect.closeTo(0) },
      to: { x: -56, y: expect.closeTo(0) }
    }));
  });

  it('skips unchanged vector redraws and redraws immediately when attack or charge state changes', () => {
    const harness = sceneHarness();
    const currentPlayer = player();
    const view = createFighterView(harness.scene as never, currentPlayer, true, { reducedMotion: true });
    const firstTelegraph = {
      profileId: 'quick-1', facing: { x: 1, y: 0 },
      previousProgress: 0, currentProgress: 0.5, active: true
    } as const;
    const firstCharge = {
      facing: { x: 0, y: -1 }, progress: 0.5, pulseReady: false
    } as const;

    view.apply(currentPlayer, currentPlayer.position, currentPlayer.facing, null, firstTelegraph, firstCharge);
    view.apply(currentPlayer, currentPlayer.position, currentPlayer.facing, null, firstTelegraph, firstCharge);

    const trail = harness.graphics[1]!;
    const indicator = harness.graphics[2]!;
    expect(trail.commands.filter((command) => command.kind === 'clear')).toHaveLength(1);
    expect(indicator.commands.filter((command) => command.kind === 'clear')).toHaveLength(1);

    view.apply(
      currentPlayer,
      currentPlayer.position,
      currentPlayer.facing,
      null,
      {
        profileId: 'heavy-melee', facing: { x: 0, y: 1 },
        previousProgress: 0.25, currentProgress: 0.75, active: true
      },
      { facing: { x: 1, y: 0 }, progress: 1, pulseReady: true }
    );

    expect(trail.commands.filter((command) => command.kind === 'clear')).toHaveLength(2);
    expect(indicator.commands.filter((command) => command.kind === 'clear')).toHaveLength(2);
    expect(frameCommands(indicator).some((command) => command.kind === 'circle')).toBe(true);
  });
});
