import type { Rect, Team, Vec2 } from './model';

const freezeRect = (rect: Rect): Readonly<Rect> => Object.freeze(rect);

const freezePoint = (point: Vec2): Readonly<Vec2> => Object.freeze(point);

export const GAME = Object.freeze({
  tickRate: 30,
  snapshotRate: 20,
  matchMs: 180_000,
  targetScore: 7,
  reconnectGraceMs: 20_000,
  maxPlayers: 8,
  playerRadius: 20,
  moveSpeed: 250,
  carrierMultiplier: 0.82,
  dashMultiplier: 2.35,
  dashMs: 160,
  dashCooldownMs: 1_800,
  tackleStunMs: 280,
  selfPickupLockMs: 650,
  coreReturnMs: 8_000,
  coreRespawnMs: 2_500
});

const reactors: Readonly<Record<Team, Readonly<Rect>>> = Object.freeze({
  CYAN: freezeRect({ x: 0, y: 250, width: 100, height: 220 }),
  AMBER: freezeRect({ x: 1180, y: 250, width: 100, height: 220 })
});

const spawns: Readonly<Record<Team, readonly Readonly<Vec2>[]>> = Object.freeze({
  CYAN: Object.freeze([freezePoint({ x: 160, y: 260 }), freezePoint({ x: 160, y: 360 }), freezePoint({ x: 160, y: 460 })]),
  AMBER: Object.freeze([freezePoint({ x: 1120, y: 260 }), freezePoint({ x: 1120, y: 360 }), freezePoint({ x: 1120, y: 460 })])
});

export const ARENA = Object.freeze({
  width: 1280,
  height: 720,
  reactors,
  spawns,
  corePads: Object.freeze([
    freezePoint({ x: 640, y: 220 }),
    freezePoint({ x: 640, y: 360 }),
    freezePoint({ x: 640, y: 500 })
  ]),
  obstacles: Object.freeze([
    freezeRect({ x: 360, y: 140, width: 170, height: 70 }),
    freezeRect({ x: 750, y: 140, width: 170, height: 70 }),
    freezeRect({ x: 360, y: 510, width: 170, height: 70 }),
    freezeRect({ x: 750, y: 510, width: 170, height: 70 })
  ])
});
