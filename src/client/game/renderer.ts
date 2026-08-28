import { ARENA, GAME } from '../../shared/constants.js';
import type { GameEvent, MatchCore, MatchPlayer, MatchSnapshot, Team, Vec2 } from '../../shared/model.js';

export const RENDER_LAYERS = [
  'floor-grid',
  'reactors',
  'barriers',
  'core-pads',
  'cores',
  'player-shadows',
  'players-trails',
  'name-labels',
  'event-particles'
] as const;

export type RenderLayer = (typeof RENDER_LAYERS)[number];

export const MAX_CANVAS_DPR = 3;

export type ArenaViewport = Readonly<{
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  contentWidth: number;
  contentHeight: number;
}>;

export type RenderFrameOptions = Readonly<{
  viewport: ArenaViewport;
  snapshot: MatchSnapshot;
  previousSnapshot: MatchSnapshot | null;
  interpolationAlpha: number;
  localPlayerId: string;
  predictedLocalPosition: Vec2 | null;
  floorImage: CanvasImageSource | null;
  particles: AuthoritativeParticles | null;
  nowMs?: number;
  reducedMotion?: boolean;
  onLayer?: (layer: RenderLayer) => void;
}>;

type Particle = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  bornAtMs: number;
  durationMs: number;
  radius: number;
  color: string;
};

type MutablePosition = { x: number; y: number };

const CYAN = '#25d9f8';
const CYAN_SOFT = 'rgb(37 217 248 / 0.38)';
const AMBER = '#ffb347';
const AMBER_SOFT = 'rgb(255 179 71 / 0.38)';
const GRAPHITE = '#101820';
const TEAM_ORDER: readonly Team[] = ['CYAN', 'AMBER'];
const playerPositionScratch: MutablePosition = { x: 0, y: 0 };
const corePositionScratch: MutablePosition = { x: 0, y: 0 };

function teamColor(team: Team): string {
  return team === 'CYAN' ? CYAN : AMBER;
}

function teamSoftColor(team: Team): string {
  return team === 'CYAN' ? CYAN_SOFT : AMBER_SOFT;
}

export function resizeCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number, dpr: number): boolean {
  const safeWidth = Math.max(1, Math.round(cssWidth));
  const safeHeight = Math.max(1, Math.round(cssHeight));
  const safeDpr = Math.max(1, Math.min(MAX_CANVAS_DPR, dpr));
  const backingWidth = Math.max(1, Math.round(safeWidth * safeDpr));
  const backingHeight = Math.max(1, Math.round(safeHeight * safeDpr));
  const changed = canvas.width !== backingWidth || canvas.height !== backingHeight;

  if (changed) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }
  canvas.style.width = `${safeWidth}px`;
  canvas.style.height = `${safeHeight}px`;
  return changed;
}

export function fitArena(
  viewportWidth: number,
  viewportHeight: number,
  arenaWidth = ARENA.width,
  arenaHeight = ARENA.height
): ArenaViewport {
  const safeWidth = Math.max(1, viewportWidth);
  const safeHeight = Math.max(1, viewportHeight);
  const scale = Math.min(safeWidth / arenaWidth, safeHeight / arenaHeight);
  const contentWidth = arenaWidth * scale;
  const contentHeight = arenaHeight * scale;
  return {
    viewportWidth: safeWidth,
    viewportHeight: safeHeight,
    scale,
    offsetX: (safeWidth - contentWidth) / 2,
    offsetY: (safeHeight - contentHeight) / 2,
    contentWidth,
    contentHeight
  };
}

function findPlayer(snapshot: MatchSnapshot | null, playerId: string): MatchPlayer | null {
  if (!snapshot) return null;
  for (const player of snapshot.players) {
    if (player.playerId === playerId) return player;
  }
  return null;
}

function findCore(snapshot: MatchSnapshot | null, coreId: string): MatchCore | null {
  if (!snapshot) return null;
  for (const core of snapshot.cores) {
    if (core.coreId === coreId) return core;
  }
  return null;
}

function writePlayerPosition(
  player: MatchPlayer,
  previous: MatchSnapshot | null,
  alpha: number,
  localPlayerId: string,
  predictedLocalPosition: Vec2 | null,
  output: MutablePosition
): void {
  if (player.playerId === localPlayerId && predictedLocalPosition) {
    output.x = predictedLocalPosition.x;
    output.y = predictedLocalPosition.y;
    return;
  }
  const older = findPlayer(previous, player.playerId);
  if (!older) {
    output.x = player.position.x;
    output.y = player.position.y;
    return;
  }
  output.x = older.position.x + (player.position.x - older.position.x) * alpha;
  output.y = older.position.y + (player.position.y - older.position.y) * alpha;
}

function writeCorePosition(
  core: MatchCore,
  previous: MatchSnapshot | null,
  alpha: number,
  output: MutablePosition
): void {
  const older = findCore(previous, core.coreId);
  if (!older || older.carrierId !== core.carrierId) {
    output.x = core.position.x;
    output.y = core.position.y;
    return;
  }
  output.x = older.position.x + (core.position.x - older.position.x) * alpha;
  output.y = older.position.y + (core.position.y - older.position.y) * alpha;
}

function drawFloorAndGrid(
  context: CanvasRenderingContext2D,
  floorImage: CanvasImageSource | null
): void {
  context.fillStyle = '#070c11';
  context.fillRect(0, 0, ARENA.width, ARENA.height);
  if (floorImage) {
    context.globalAlpha = 0.84;
    context.drawImage(floorImage, 0, 0, ARENA.width, ARENA.height);
    context.globalAlpha = 1;
  }

  context.strokeStyle = 'rgb(87 124 145 / 0.11)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 80; x < ARENA.width; x += 80) {
    context.moveTo(x, 0);
    context.lineTo(x, ARENA.height);
  }
  for (let y = 80; y < ARENA.height; y += 80) {
    context.moveTo(0, y);
    context.lineTo(ARENA.width, y);
  }
  context.stroke();
  context.strokeStyle = 'rgb(96 145 168 / 0.38)';
  context.lineWidth = 2;
  context.strokeRect(1, 1, ARENA.width - 2, ARENA.height - 2);
}

function drawReactors(context: CanvasRenderingContext2D): void {
  for (const team of TEAM_ORDER) {
    const reactor = ARENA.reactors[team];
    const color = teamColor(team);
    const centerX = team === 'CYAN' ? reactor.x + 54 : reactor.x + reactor.width - 54;
    const centerY = reactor.y + reactor.height / 2;
    context.fillStyle = 'rgb(8 15 21 / 0.92)';
    context.fillRect(reactor.x, reactor.y, reactor.width, reactor.height);
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.strokeRect(reactor.x + 2, reactor.y + 2, reactor.width - 4, reactor.height - 4);
    context.beginPath();
    context.arc(centerX, centerY, 48, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 0.38;
    context.beginPath();
    context.arc(centerX, centerY, 31, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.globalAlpha = 1;
    context.beginPath();
    context.arc(centerX, centerY, 13, 0, Math.PI * 2);
    context.fillStyle = '#efffff';
    context.shadowBlur = 24;
    context.shadowColor = color;
    context.fill();
    context.shadowBlur = 0;
  }
}

function drawBarriers(context: CanvasRenderingContext2D): void {
  for (const obstacle of ARENA.obstacles) {
    context.fillStyle = '#111a22';
    context.fillRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height);
    context.strokeStyle = '#3b5363';
    context.lineWidth = 2;
    context.strokeRect(obstacle.x + 1, obstacle.y + 1, obstacle.width - 2, obstacle.height - 2);
    context.fillStyle = 'rgb(165 205 222 / 0.12)';
    context.fillRect(obstacle.x + 9, obstacle.y + 8, obstacle.width - 18, 3);
  }
}

function drawCorePads(context: CanvasRenderingContext2D): void {
  for (const pad of ARENA.corePads) {
    context.strokeStyle = 'rgb(141 184 203 / 0.38)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(pad.x, pad.y, 36, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 0.45;
    context.beginPath();
    context.arc(pad.x, pad.y, 24, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
  }
}

function drawCores(
  context: CanvasRenderingContext2D,
  snapshot: MatchSnapshot,
  previousSnapshot: MatchSnapshot | null,
  alpha: number,
  localPlayerId: string,
  predictedLocalPosition: Vec2 | null
): void {
  for (const core of snapshot.cores) {
    if (core.carrierId === localPlayerId && predictedLocalPosition) {
      corePositionScratch.x = predictedLocalPosition.x;
      corePositionScratch.y = predictedLocalPosition.y;
    } else {
      writeCorePosition(core, previousSnapshot, alpha, corePositionScratch);
    }
    const carried = core.carrierId !== null;
    const x = carried ? corePositionScratch.x + 24 : corePositionScratch.x;
    const y = carried ? corePositionScratch.y - 20 : corePositionScratch.y;
    const color = core.golden ? '#ffd36b' : '#78efff';
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.globalAlpha = 0.58;
    context.beginPath();
    context.arc(x, y, carried ? 13 : 19, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = '#f4ffff';
    context.shadowBlur = core.golden ? 30 : 22;
    context.shadowColor = color;
    context.beginPath();
    context.arc(x, y, carried ? 7 : 10, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
  }
}

function drawPlayerShadow(
  context: CanvasRenderingContext2D,
  player: MatchPlayer,
  previousSnapshot: MatchSnapshot | null,
  alpha: number,
  localPlayerId: string,
  predictedLocalPosition: Vec2 | null
): void {
  writePlayerPosition(player, previousSnapshot, alpha, localPlayerId, predictedLocalPosition, playerPositionScratch);
  const x = playerPositionScratch.x;
  const y = playerPositionScratch.y;
  context.fillStyle = 'rgb(0 0 0 / 0.55)';
  context.beginPath();
  context.arc(x + 5, y + 8, GAME.playerRadius + 6, 0, Math.PI * 2);
  context.fill();
}

function drawDrone(
  context: CanvasRenderingContext2D,
  player: MatchPlayer,
  previousSnapshot: MatchSnapshot | null,
  alpha: number,
  localPlayerId: string,
  predictedLocalPosition: Vec2 | null,
  reducedMotion: boolean
): void {
  writePlayerPosition(player, previousSnapshot, alpha, localPlayerId, predictedLocalPosition, playerPositionScratch);
  const x = playerPositionScratch.x;
  const y = playerPositionScratch.y;
  const older = findPlayer(previousSnapshot, player.playerId);
  const deltaX = older ? player.position.x - older.position.x : player.team === 'CYAN' ? 1 : -1;
  const deltaY = older ? player.position.y - older.position.y : 0;
  const travelLength = Math.hypot(deltaX, deltaY);
  const facing = travelLength > 0.1 ? Math.atan2(deltaY, deltaX) : player.team === 'CYAN' ? 0 : Math.PI;
  const color = teamColor(player.team);

  if (!reducedMotion && player.dashRemainingMs > 0) {
    const unitX = Math.cos(facing);
    const unitY = Math.sin(facing);
    context.strokeStyle = teamSoftColor(player.team);
    context.lineCap = 'round';
    context.lineWidth = 12;
    context.beginPath();
    context.moveTo(x - unitX * 18, y - unitY * 18);
    context.lineTo(x - unitX * 82, y - unitY * 82);
    context.stroke();
    context.lineWidth = 4;
    context.strokeStyle = color;
    context.beginPath();
    context.moveTo(x - unitX * 12, y - unitY * 12);
    context.lineTo(x - unitX * 58, y - unitY * 58);
    context.stroke();
    context.lineCap = 'butt';
  }

  context.save();
  context.translate(x, y);
  context.rotate(facing);
  context.fillStyle = GRAPHITE;
  context.strokeStyle = color;
  context.lineWidth = player.playerId === localPlayerId ? 3 : 2;
  for (let vane = 0; vane < 4; vane += 1) {
    context.save();
    context.rotate((Math.PI / 2) * vane);
    context.fillRect(14, -6, 15, 12);
    context.strokeRect(14, -6, 15, 12);
    context.restore();
  }
  context.beginPath();
  context.arc(0, 0, GAME.playerRadius, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.fillStyle = color;
  context.shadowBlur = 14;
  context.shadowColor = color;
  context.beginPath();
  context.arc(0, 0, 7, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  if (player.stunRemainingMs > 0) {
    context.globalAlpha = 0.72;
    context.strokeStyle = '#ff5d6c';
    context.lineWidth = 3;
    context.beginPath();
    context.arc(0, 0, GAME.playerRadius + 8, 0.28, Math.PI * 1.46);
    context.stroke();
    context.globalAlpha = 1;
  }
  context.restore();
}

function drawPlayerName(
  context: CanvasRenderingContext2D,
  player: MatchPlayer,
  previousSnapshot: MatchSnapshot | null,
  alpha: number,
  localPlayerId: string,
  predictedLocalPosition: Vec2 | null
): void {
  writePlayerPosition(player, previousSnapshot, alpha, localPlayerId, predictedLocalPosition, playerPositionScratch);
  const x = playerPositionScratch.x;
  const y = playerPositionScratch.y;
  context.fillStyle = player.team === 'CYAN' ? '#8ff1ff' : '#ffd08e';
  context.font = '600 14px Inter, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'bottom';
  context.fillText(player.name, x, y - 29);
}

function eventOrigin(event: GameEvent, snapshot: MatchSnapshot): readonly [number, number, Team | null] | null {
  if (event.type === 'DROP') return [event.position.x, event.position.y, null];
  if (event.type === 'SCORE') {
    const reactor = ARENA.reactors[event.team];
    return [
      event.team === 'CYAN' ? reactor.x + 54 : reactor.x + reactor.width - 54,
      reactor.y + reactor.height / 2,
      event.team
    ];
  }
  if (event.type === 'PICKUP') {
    const player = findPlayer(snapshot, event.playerId);
    return player ? [player.position.x, player.position.y, player.team] : null;
  }
  if (event.type === 'TACKLE') {
    const player = findPlayer(snapshot, event.targetPlayerId);
    return player ? [player.position.x, player.position.y, player.team] : null;
  }
  if (event.type === 'PHASE' && event.phase === 'SUDDEN_DEATH') return [ARENA.width / 2, ARENA.height / 2, null];
  return null;
}

export class AuthoritativeParticles {
  private readonly particles: Particle[] = [];
  private sequence = 0;

  ingest(event: GameEvent, snapshot: MatchSnapshot, nowMs: number): void {
    const origin = eventOrigin(event, snapshot);
    if (!origin) return;
    const count = event.type === 'SCORE' ? 16 : event.type === 'TACKLE' ? 10 : 7;
    const color = event.type === 'PHASE' ? '#ffd36b' : origin[2] ? teamColor(origin[2]) : '#dffcff';
    for (let index = 0; index < count; index += 1) {
      if (this.particles.length >= 64) this.particles.shift();
      const angle = ((this.sequence * 47 + index * 61) % 360) * (Math.PI / 180);
      const speed = 45 + ((this.sequence + index * 17) % 80);
      this.particles.push({
        x: origin[0],
        y: origin[1],
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        bornAtMs: nowMs,
        durationMs: event.type === 'SCORE' ? 620 : 380,
        radius: event.type === 'SCORE' ? 4 : 3,
        color
      });
    }
    this.sequence += count;
  }

  draw(context: CanvasRenderingContext2D, nowMs: number, reducedMotion: boolean): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      const elapsedMs = nowMs - particle.bornAtMs;
      if (elapsedMs >= particle.durationMs) {
        this.particles.splice(index, 1);
        continue;
      }
      const progress = reducedMotion ? 0 : elapsedMs / 1_000;
      context.globalAlpha = 1 - elapsedMs / particle.durationMs;
      context.fillStyle = particle.color;
      context.beginPath();
      context.arc(
        particle.x + particle.velocityX * progress,
        particle.y + particle.velocityY * progress,
        particle.radius,
        0,
        Math.PI * 2
      );
      context.fill();
    }
    context.globalAlpha = 1;
  }
}

function announceLayer(options: RenderFrameOptions, layer: RenderLayer): void {
  options.onLayer?.(layer);
}

export function renderFrame(context: CanvasRenderingContext2D, options: RenderFrameOptions): void {
  const alpha = Math.max(0, Math.min(1, options.interpolationAlpha));
  const reducedMotion = options.reducedMotion ?? false;
  context.save();
  context.clearRect(0, 0, options.viewport.viewportWidth, options.viewport.viewportHeight);
  context.translate(options.viewport.offsetX, options.viewport.offsetY);
  context.scale(options.viewport.scale, options.viewport.scale);

  announceLayer(options, 'floor-grid');
  drawFloorAndGrid(context, options.floorImage);

  announceLayer(options, 'reactors');
  drawReactors(context);

  announceLayer(options, 'barriers');
  drawBarriers(context);

  announceLayer(options, 'core-pads');
  drawCorePads(context);

  announceLayer(options, 'cores');
  drawCores(
    context,
    options.snapshot,
    options.previousSnapshot,
    alpha,
    options.localPlayerId,
    options.predictedLocalPosition
  );

  announceLayer(options, 'player-shadows');
  for (const player of options.snapshot.players) {
    drawPlayerShadow(
      context,
      player,
      options.previousSnapshot,
      alpha,
      options.localPlayerId,
      options.predictedLocalPosition
    );
  }

  announceLayer(options, 'players-trails');
  for (const player of options.snapshot.players) {
    drawDrone(
      context,
      player,
      options.previousSnapshot,
      alpha,
      options.localPlayerId,
      options.predictedLocalPosition,
      reducedMotion
    );
  }

  announceLayer(options, 'name-labels');
  for (const player of options.snapshot.players) {
    drawPlayerName(
      context,
      player,
      options.previousSnapshot,
      alpha,
      options.localPlayerId,
      options.predictedLocalPosition
    );
  }

  announceLayer(options, 'event-particles');
  options.particles?.draw(context, options.nowMs ?? performance.now(), reducedMotion);
  context.restore();
}
