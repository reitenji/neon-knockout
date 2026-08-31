import Phaser from 'phaser';
import { GAME } from '../../../shared/constants.js';
import type { MatchPhase, Vec2 } from '../../../shared/model.js';
import { buildArenaVisualModel, type ArenaVisualModel, type ArenaVisualState } from './arenaVisualPlan.js';

export interface ArenaView {
  apply(state: ArenaVisualState, nowMs?: number): void;
  destroy(): void;
}

type GraphicsLike = Pick<
  Phaser.GameObjects.Graphics,
  'fillStyle' | 'lineStyle' | 'fillPoints' | 'strokePoints' | 'fillCircle' | 'strokeCircle' | 'beginPath' |
  'moveTo' | 'lineTo' | 'strokePath' | 'clear' | 'destroy'
>;

type ArenaSceneLike = Pick<Phaser.Scene, 'add'> & {
  add: Pick<Phaser.Scene['add'], 'graphics'>;
};

const COLORS = Object.freeze({
  shellShadow: 0x000000,
  outerShell: 0x071018,
  recessedDeck: 0x0d1a24,
  coreDeck: 0x132434,
  shellStroke: 0x20313d,
  recessStroke: 0x314556,
  luminousEdge: 0x97efff,
  nodeFill: 0x081017,
  nodeGlow: 0x6fe8ff,
  minimumWarning: 0xff8a5b,
  minimumHighlight: 0xffd6c4,
  activeBoundary: 0xff9968,
  activeHighlight: 0xfff0d8,
  dangerFill: 0x441d14
});

function offsetVertices(vertices: readonly Vec2[], offset: Vec2): readonly Vec2[] {
  return vertices.map((vertex) => ({ x: vertex.x + offset.x, y: vertex.y + offset.y }));
}

function toMutablePoints(vertices: readonly Vec2[]): Phaser.Math.Vector2[] {
  return vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })) as Phaser.Math.Vector2[];
}

function lerpPoint(start: Vec2, end: Vec2, amount: number): Vec2 {
  return {
    x: start.x + (end.x - start.x) * amount,
    y: start.y + (end.y - start.y) * amount
  };
}

function normalize(vector: Vec2): Vec2 {
  const length = Math.hypot(vector.x, vector.y);
  if (length <= Number.EPSILON) return { x: 0, y: -1 };
  return { x: vector.x / length, y: vector.y / length };
}

function signedArea(vertices: readonly Vec2[]): number {
  let total = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    total += current.x * next.y - next.x * current.y;
  }
  return total;
}

function inwardNormal(start: Vec2, end: Vec2, vertices: readonly Vec2[]): Vec2 {
  const edge = { x: end.x - start.x, y: end.y - start.y };
  const orientation = signedArea(vertices) >= 0 ? -1 : 1;
  return normalize({ x: edge.y * orientation, y: -edge.x * orientation });
}

function drawStaticShell(shell: GraphicsLike, detail: GraphicsLike): void {
  const model = buildArenaVisualModel({ phase: 'COUNTDOWN', remainingMs: 3_000, platformProgress: 0 });
  const regulationPoints = toMutablePoints(model.regulationVertices);
  const shadowPoints = toMutablePoints(offsetVertices(model.regulationVertices, model.voidShadowOffset));
  const recessedPoints = toMutablePoints(model.recessedVertices);
  const corePoints = toMutablePoints(model.corePlatformVertices);
  shell.fillStyle(COLORS.shellShadow, 0.34);
  shell.fillPoints(shadowPoints, true, true);
  shell.fillStyle(COLORS.outerShell, 1);
  shell.fillPoints(regulationPoints, true, true);
  shell.fillStyle(COLORS.recessedDeck, 1);
  shell.fillPoints(recessedPoints, true, true);
  shell.fillStyle(COLORS.coreDeck, 1);
  shell.fillPoints(corePoints, true, true);
  shell.lineStyle(18, COLORS.shellShadow, 0.48);
  shell.strokePoints(regulationPoints, true, true);
  shell.lineStyle(8, COLORS.shellStroke, 1);
  shell.strokePoints(regulationPoints, true, true);
  shell.lineStyle(3, COLORS.recessStroke, 0.9);
  shell.strokePoints(recessedPoints, true, true);

  detail.lineStyle(3, COLORS.luminousEdge, 0.34);
  detail.strokePoints(regulationPoints, true, true);
  for (const band of model.panelBands) {
    detail.lineStyle(2, COLORS.luminousEdge, 0.08);
    detail.strokePoints(toMutablePoints(band), true, true);
  }
  for (const vertex of model.regulationVertices) {
    detail.fillStyle(COLORS.nodeFill, 0.95);
    detail.fillCircle(vertex.x, vertex.y, 14);
    detail.fillStyle(COLORS.nodeGlow, 0.22);
    detail.fillCircle(vertex.x, vertex.y, 10);
    detail.lineStyle(2, COLORS.nodeGlow, 0.75);
    detail.strokeCircle(vertex.x, vertex.y, 12);
  }
}

function drawChevron(
  overlay: GraphicsLike,
  start: Vec2,
  end: Vec2,
  vertices: readonly Vec2[],
  inset: number,
  alpha: number
): void {
  const first = lerpPoint(start, end, 0.32);
  const second = lerpPoint(start, end, 0.68);
  const middle = lerpPoint(start, end, 0.5);
  const normal = inwardNormal(start, end, vertices);
  const tip = { x: middle.x + normal.x * inset, y: middle.y + normal.y * inset };
  overlay.lineStyle(2, COLORS.minimumHighlight, alpha);
  overlay.beginPath();
  overlay.moveTo(first.x, first.y);
  overlay.lineTo(tip.x, tip.y);
  overlay.lineTo(second.x, second.y);
  overlay.strokePath();
}

function warningIsVisible(state: ArenaVisualState): boolean {
  return state.platformProgress > 0 || state.phase === 'SUDDEN_DEATH' ||
    (state.phase === 'REGULATION' && state.remainingMs <= GAME.contractionWarningRemainingMs);
}

type VisualSignature = Readonly<{
  phase: MatchPhase;
  remainingMs: number;
  platformProgress: number;
  nowMs: number;
}>;

function visualSignature(
  state: ArenaVisualState,
  nowMs: number,
  reducedMotion: boolean
): VisualSignature {
  const visibleWarning = warningIsVisible(state);
  return {
    phase: state.phase,
    remainingMs: visibleWarning ? state.remainingMs : 0,
    platformProgress: state.platformProgress,
    nowMs: visibleWarning && !reducedMotion ? nowMs : 0
  };
}

function sameVisualSignature(left: VisualSignature | null, right: VisualSignature): boolean {
  return left !== null && left.phase === right.phase && left.remainingMs === right.remainingMs &&
    left.platformProgress === right.platformProgress && left.nowMs === right.nowMs;
}

function drawDynamicTelegraph(overlay: GraphicsLike, state: ArenaVisualState, model: ArenaVisualModel): void {
  const minimumPoints = toMutablePoints(model.minimumVertices);
  const currentPoints = toMutablePoints(model.currentVertices);
  overlay.clear();
  overlay.fillStyle(COLORS.dangerFill, model.dangerFillAlpha);
  overlay.fillPoints(currentPoints, true, true);
  overlay.lineStyle(4, COLORS.minimumWarning, model.minimumOutlineAlpha);
  overlay.strokePoints(minimumPoints, true, true);
  overlay.lineStyle(model.activeBoundaryWidth, COLORS.activeBoundary, model.activeBoundaryAlpha * 0.55);
  overlay.strokePoints(currentPoints, true, true);
  overlay.lineStyle(2, COLORS.activeHighlight, model.activeBoundaryAlpha);
  overlay.strokePoints(currentPoints, true, true);

  const chevronInset = 14 + state.platformProgress * 18 + model.warningPulse * 4;
  for (let index = 0; index < model.currentVertices.length; index += 1) {
    const start = model.currentVertices[index]!;
    const end = model.currentVertices[(index + 1) % model.currentVertices.length]!;
    drawChevron(overlay, start, end, model.currentVertices, chevronInset, model.minimumOutlineAlpha);
  }

  for (const vertex of model.currentVertices) {
    overlay.fillStyle(COLORS.activeBoundary, model.activeBoundaryAlpha);
    overlay.fillCircle(vertex.x, vertex.y, model.cornerNodeRadius);
  }
}

export function createArenaView(
  scene: ArenaSceneLike,
  options: Readonly<{ reducedMotion?: boolean }> = {}
): ArenaView {
  const reducedMotion = options.reducedMotion ?? false;
  const shell = scene.add.graphics() as GraphicsLike;
  const detail = scene.add.graphics() as GraphicsLike;
  const overlay = scene.add.graphics() as GraphicsLike;
  let destroyed = false;
  let lastVisualSignature: VisualSignature | null = null;

  drawStaticShell(shell, detail);

  return {
    apply(state, nowMs = 0) {
      if (destroyed) return;
      const signature = visualSignature(state, nowMs, reducedMotion);
      if (sameVisualSignature(lastVisualSignature, signature)) return;
      lastVisualSignature = signature;
      const model = buildArenaVisualModel(state, {
        nowMs,
        reducedMotion: reducedMotion || !warningIsVisible(state)
      });
      drawDynamicTelegraph(overlay, state, model);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      shell.destroy();
      detail.destroy();
      overlay.destroy();
    }
  };
}

export type { ArenaVisualState } from './arenaVisualPlan.js';
