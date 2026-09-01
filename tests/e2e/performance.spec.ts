import type { Browser } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import type { Ack, InputFrame, MatchPlayer, ServerError, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
import { GAME } from '../../src/shared/constants.js';
import {
  assertNoUnexpectedErrors,
  expect,
  openPlayer,
  test,
  type E2eGame,
  type PlayerPage
} from './fixtures.js';

const FRAME_SAMPLES = 181;
const COMPANION_COUNT = 7;
const COMPANION_INPUT_MS = 3_800;
const ACK_TIMEOUT_MS = 2_000;
const RING_OUT_EFFECT_SAMPLE_FRAMES = 72;

test.use({
  launchOptions: {
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-renderer-backgrounding',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])
    ],
    headless: process.platform !== 'darwin'
  }
});

type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>;
type AckEvent = Exclude<keyof ClientToServerEvents, 'match:input'>;

const COMPANION_LAYOUT = [
  { position: { x: 640, y: 190 }, facing: { x: 1, y: 0 } },
  { position: { x: 820, y: 260 }, facing: { x: 0, y: 1 } },
  { position: { x: 820, y: 460 }, facing: { x: -1, y: 0 } },
  { position: { x: 640, y: 530 }, facing: { x: -1, y: 0 } },
  { position: { x: 460, y: 460 }, facing: { x: 0, y: -1 } },
  { position: { x: 460, y: 260 }, facing: { x: 0, y: -1 } },
  { position: { x: 350, y: 360 }, facing: { x: 0, y: 1 } }
] as const;

async function emitSuccess<T>(socket: GameClient, event: AckEvent, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), ACK_TIMEOUT_MS);
    const emit = socket.emit.bind(socket) as (
      eventName: string,
      eventPayload: unknown,
      acknowledge: (acknowledgement: Ack<T>) => void
    ) => void;
    emit(event, payload, (acknowledgement) => {
      clearTimeout(timer);
      if (acknowledgement.ok) resolve(acknowledgement.data);
      else reject(new Error(`${acknowledgement.error.code}: ${acknowledgement.error.message}`));
    });
  });
}

async function connectClient(origin: string): Promise<GameClient> {
  const client: GameClient = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting performance client')), ACK_TIMEOUT_MS);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    client.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return client;
}

async function createEightPlayerMatch(
  browser: Browser,
  game: E2eGame,
  companionErrors: ServerError[]
): Promise<Readonly<{ code: string; measured: PlayerPage; companions: readonly GameClient[]; welcomes: readonly SessionWelcome[] }>> {
  const measured = await openPlayer(browser, game.origin);
  const companions: GameClient[] = [];
  try {
    await measured.page.getByLabel('Oyuncu adı').fill('Player 1');
    await measured.page.getByRole('button', { name: 'Oda Kur' }).click();
    const code = await measured.page.getByTestId('room-code').textContent();
    if (!code) throw new Error('Measured player room code was not rendered.');

    for (let index = 0; index < COMPANION_COUNT; index += 1) {
      const client = await connectClient(game.origin);
      client.on('server:error', (error) => companionErrors.push(error));
      companions.push(client);
    }
    const welcomes = await Promise.all(companions.map((client, index) => emitSuccess<SessionWelcome>(
      client,
      'room:join',
      { name: `Player ${index + 2}`, roomCode: code }
    )));
    await Promise.all(companions.map((client, index) => emitSuccess<null>(client, 'lobby:chassis', {
      chassis: ['BASTION', 'PULSE', 'WRAITH', 'RIFT'][index % 4]
    })));
    await Promise.all(companions.map((client) => emitSuccess<null>(client, 'lobby:ready', { ready: true })));
    await measured.page.getByRole('button', { name: 'Hazırım' }).click();
    await expect(measured.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await measured.page.getByRole('button', { name: 'Maçı Başlat' }).click();
    await expect(measured.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeVisible();
    await expect.poll(() => game.harness.matchSnapshot(code)?.phase, { timeout: 12_000 }).toBe('REGULATION');
    return { code, measured, companions, welcomes };
  } catch (error) {
    for (const companion of companions) companion.disconnect();
    await measured.context.close();
    throw error;
  }
}

async function sampleFrameDurations(player: PlayerPage): Promise<number[]> {
  return player.page.evaluate((sampleCount) => new Promise<number[]>((resolve) => {
    const durations: number[] = [];
    let previous = performance.now();
    const sample = (now: number): void => {
      durations.push(now - previous);
      previous = now;
      if (durations.length >= sampleCount) resolve(durations.slice(1));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), FRAME_SAMPLES);
}

type SampledFrame = Readonly<{
  index: number;
  nowMs: number;
  durationMs: number;
  visibilityState: string;
  hasFocus: boolean;
}>;

async function sampleFrameTimeline(player: PlayerPage): Promise<readonly SampledFrame[]> {
  return player.page.evaluate((sampleCount) => new Promise<SampledFrame[]>((resolve) => {
    const frames: SampledFrame[] = [];
    let previous = performance.now();
    const sample = (now: number): void => {
      frames.push({
        index: frames.length,
        nowMs: now,
        durationMs: now - previous,
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus()
      });
      previous = now;
      if (frames.length >= sampleCount) resolve(frames.slice(1));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }), FRAME_SAMPLES);
}

async function markAfterAnimationFrames(
  player: PlayerPage,
  frameCount: number
): Promise<Readonly<{ nowMs: number; visibilityState: string; hasFocus: boolean }>> {
  return player.page.evaluate((framesToWait) => new Promise((resolve) => {
    let remaining = framesToWait;
    const sample = (): void => {
      remaining -= 1;
      if (remaining > 0) {
        requestAnimationFrame(sample);
        return;
      }
      resolve({
        nowMs: performance.now(),
        visibilityState: document.visibilityState,
        hasFocus: document.hasFocus()
      });
    };
    requestAnimationFrame(sample);
  }), frameCount);
}

function authoritativePlayer(game: E2eGame, code: string, playerId: string): MatchPlayer {
  const player = game.harness.matchSnapshot(code)?.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new Error(`Missing performance player ${playerId}.`);
  return player;
}

function companionInput(seq: number, index: number): InputFrame {
  const cycle = seq % 240;
  const facing = COMPANION_LAYOUT[index]!.facing;
  const moving = cycle < 8 || (cycle >= 50 && cycle < 58);
  return {
    seq,
    moveX: moving ? facing.x : 0,
    moveY: moving ? facing.y : 0,
    aimX: facing.x,
    aimY: facing.y,
    quick: cycle === 12,
    heavy: cycle >= 30 && cycle < 75,
    dash: cycle === 150
  };
}

async function driveCompanions(companions: readonly GameClient[]): Promise<void> {
  const startedAt = performance.now();
  let sequence = 0;
  while (performance.now() - startedAt < COMPANION_INPUT_MS) {
    for (let index = 0; index < companions.length; index += 1) {
      companions[index]!.emit('match:input', companionInput(sequence, index));
    }
    sequence += 1;
    await new Promise((resolve) => setTimeout(resolve, 1_000 / 60));
  }
}

async function placePlayers(
  game: E2eGame,
  code: string,
  measuredId: string,
  companionIds: readonly string[]
): Promise<void> {
  game.harness.placePlayer(code, measuredId, { x: 640, y: 360 }, { x: 1, y: 0 });
  for (let index = 0; index < companionIds.length; index += 1) {
    const layout = COMPANION_LAYOUT[index]!;
    game.harness.placePlayer(code, companionIds[index]!, layout.position, layout.facing);
  }
  await expect.poll(() => game.harness.matchSnapshot(code)?.players.length).toBe(8);
}

async function retainMeasuredAim(game: E2eGame, code: string, measured: PlayerPage, playerId: string): Promise<void> {
  for (const key of ['w', 'a', 's', 'd', 'j', 'k', 'Space']) await measured.page.keyboard.up(key);
  const before = authoritativePlayer(game, code, playerId).lastProcessedInputSeq;
  await measured.page.keyboard.down('d');
  await expect.poll(() => {
    const current = authoritativePlayer(game, code, playerId);
    return current.lastProcessedInputSeq > before && current.facing.x === 1 && current.facing.y === 0;
  }).toBe(true);
  const releaseSequence = authoritativePlayer(game, code, playerId).lastProcessedInputSeq;
  await measured.page.keyboard.up('d');
  await expect.poll(() => authoritativePlayer(game, code, playerId).lastProcessedInputSeq)
    .toBeGreaterThan(releaseSequence);
}

async function spawnLivePulseThroughMatchInput(
  game: E2eGame,
  code: string,
  client: GameClient,
  playerId: string
): Promise<NonNullable<ReturnType<E2eGame['harness']['matchSnapshot']>>['pulses'][number]> {
  const heldSequence = authoritativePlayer(game, code, playerId).lastProcessedInputSeq + 1;
  client.emit('match:input', {
    seq: heldSequence,
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    quick: false,
    heavy: true,
    dash: false
  });
  await expect.poll(() => authoritativePlayer(game, code, playerId).action.chargeMs)
    .toBe(GAME.heavyMaxChargeMs);

  client.emit('match:input', {
    seq: heldSequence + 1,
    moveX: 0,
    moveY: 0,
    aimX: 1,
    aimY: 0,
    quick: false,
    heavy: false,
    dash: false
  });
  await expect.poll(() => game.harness.matchSnapshot(code)?.pulses.find(
    (pulse) => pulse.ownerPlayerId === playerId
  ) ?? null, { timeout: ACK_TIMEOUT_MS, intervals: [10] }).not.toBeNull();

  const pulse = game.harness.matchSnapshot(code)?.pulses.find((candidate) => candidate.ownerPlayerId === playerId);
  if (!pulse) throw new Error('Production match input did not leave a live pulse.');
  return pulse;
}

function frameMetrics(durations: readonly number[]): Readonly<{ medianFps: number; p95FrameMs: number }> {
  const sorted = [...durations].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  return { medianFps: 1_000 / median, p95FrameMs: p95 };
}

function burstFrameMetrics(frames: readonly SampledFrame[]): Readonly<{
  maxFrameMs: number;
  maxFrameIndex: number;
  p95FrameMs: number;
  medianFps: number;
  surroundingFrames: readonly SampledFrame[];
}> {
  const durations = frames.map((frame) => frame.durationMs);
  const { medianFps, p95FrameMs } = frameMetrics(durations);
  let maxFrameIndex = 0;
  for (let index = 1; index < frames.length; index += 1) {
    if (frames[index]!.durationMs > frames[maxFrameIndex]!.durationMs) maxFrameIndex = index;
  }
  const windowStart = Math.max(0, maxFrameIndex - 3);
  const windowEnd = Math.min(frames.length, maxFrameIndex + 4);
  return {
    maxFrameMs: frames[maxFrameIndex]?.durationMs ?? 0,
    maxFrameIndex,
    p95FrameMs,
    medianFps,
    surroundingFrames: frames.slice(windowStart, windowEnd)
  };
}

function framesOverlappingInterval(
  frames: readonly SampledFrame[],
  intervalStartedAtMs: number,
  intervalFinishedAtMs: number
): readonly SampledFrame[] {
  return frames.filter((frame) => {
    const frameStartedAtMs = frame.nowMs - frame.durationMs;
    return frameStartedAtMs < intervalFinishedAtMs && frame.nowMs > intervalStartedAtMs;
  });
}

test('holds one LAN viewport frame budget while eight authoritative players fight', async ({ browser, game }, testInfo) => {
  const companionErrors: ServerError[] = [];
  const match = await createEightPlayerMatch(browser, game, companionErrors);
  try {
    const initial = game.harness.matchSnapshot(match.code);
    if (!initial) throw new Error('Eight-player performance snapshot was not available.');
    const measuredId = initial.players.find((player) => player.name === 'Player 1')?.playerId;
    if (!measuredId) throw new Error('Measured browser player was missing.');
    const companionIds = match.welcomes.map((welcome) => welcome.playerId);
    await placePlayers(game, match.code, measuredId, companionIds);
    await retainMeasuredAim(game, match.code, match.measured, measuredId);
    await expect(match.measured.page.getByRole('list', { name: 'Oyuncu sıralaması' }).getByRole('listitem')).toHaveCount(8);

    const before = authoritativePlayer(game, match.code, measuredId);
    const eventMarker = game.harness.recentEvents(match.code).at(-1)?.eventId ?? 0;
    const companionDrive = driveCompanions(match.companions);
    const samples = sampleFrameDurations(match.measured);
    await match.measured.page.keyboard.down('j');
    await match.measured.page.waitForTimeout(120);
    await match.measured.page.keyboard.up('j');
    await match.measured.page.waitForTimeout(520);
    await match.measured.page.keyboard.down('k');
    await match.measured.page.waitForTimeout(760);
    await match.measured.page.keyboard.up('k');
    await match.measured.page.waitForTimeout(700);
    await match.measured.page.keyboard.down('Space');
    await match.measured.page.waitForTimeout(120);
    await match.measured.page.keyboard.up('Space');
    const durations = await samples;
    await companionDrive;

    const after = authoritativePlayer(game, match.code, measuredId);
    const events = game.harness.recentEvents(match.code).filter((event) => event.eventId > eventMarker);
    expect(after.stats.completedAttacks).toBeGreaterThanOrEqual(before.stats.completedAttacks + 2);
    expect(after.position.x).toBeGreaterThan(before.position.x + 30);
    expect(events.some((event) => event.type === 'PULSE_SPAWN' && event.ownerPlayerId === measuredId)).toBe(true);
    expect(companionIds.every((playerId) => authoritativePlayer(game, match.code, playerId).stats.completedAttacks >= 2)).toBe(true);
    expect(new Set(events.filter((event) => event.type === 'PULSE_SPAWN').map((event) => event.ownerPlayerId)))
      .toEqual(new Set([measuredId, ...companionIds]));
    expect(game.server.rooms.debugRoom(match.code)).toMatchObject({ connectedCount: 8, reservedCount: 0 });
    expect(game.harness.matchSnapshot(match.code)?.players).toHaveLength(8);
    await expect(match.measured.page.getByRole('list', { name: 'Oyuncu sıralaması' }).getByRole('listitem')).toHaveCount(8);

    const { medianFps, p95FrameMs } = frameMetrics(durations);
    const metrics = {
      browserContexts: 1,
      authoritativePlayers: 8,
      viewport: '1280x720',
      samples: durations.length,
      medianFps: Number(medianFps.toFixed(2)),
      p95FrameMs: Number(p95FrameMs.toFixed(2))
    };
    testInfo.annotations.push({ type: 'performance', description: JSON.stringify(metrics) });
    console.info(`PERFORMANCE_METRICS ${JSON.stringify(metrics)}`);
    expect(medianFps).toBeGreaterThanOrEqual(58);
    expect(p95FrameMs).toBeLessThan(25);
    expect(companionErrors).toEqual([]);
    await assertNoUnexpectedErrors(game, match.measured);
  } finally {
    for (const companion of match.companions) companion.disconnect();
    await match.measured.context.close();
  }
}, 60_000);

test('holds browser frame time below 50 ms through four simultaneous hit-driven ring-out effects', async ({ browser, game }, testInfo) => {
  const companionErrors: ServerError[] = [];
  const match = await createEightPlayerMatch(browser, game, companionErrors);
  try {
    const initial = game.harness.matchSnapshot(match.code);
    if (!initial) throw new Error('Eight-player ring-out burst snapshot was not available.');
    const attackerA = initial.players.find((player) => player.name === 'Player 1')?.playerId;
    if (!attackerA) throw new Error('Measured browser attacker was missing.');
    const companionIds = match.welcomes.map((welcome) => welcome.playerId);
    if (companionIds.length !== 7) {
      throw new Error(`Expected 7 companion players, received ${match.welcomes.length}.`);
    }
    await expect(match.measured.page.getByRole('list', { name: 'Oyuncu sıralaması' }).getByRole('listitem')).toHaveCount(8);

    const eventMarker = game.harness.recentEvents(match.code).at(-1)?.eventId ?? 0;
    const pulseOwnerId = companionIds[0]!;
    const safePositions = [
      { x: 360, y: 180 },
      { x: 360, y: 540 },
      { x: 520, y: 180 },
      { x: 520, y: 540 },
      { x: 760, y: 180 },
      { x: 760, y: 540 },
      { x: 920, y: 180 }
    ] as const;
    game.harness.placePlayer(match.code, pulseOwnerId, { x: 360, y: 360 }, { x: 1, y: 0 });
    [attackerA, ...companionIds.filter((playerId) => playerId !== pulseOwnerId)].forEach((playerId, index) => {
      game.harness.placePlayer(match.code, playerId, safePositions[index]!, { x: 1, y: 0 });
    });
    const livePulse = await spawnLivePulseThroughMatchInput(
      game,
      match.code,
      match.companions[0]!,
      pulseOwnerId
    );
    expect(livePulse.remainingMs).toBeGreaterThan(250);

    const samples = sampleFrameTimeline(match.measured);
    const pairs = [
      { attackerId: attackerA, targetId: companionIds[0]!, attacker: { x: 1139, y: 360 }, target: { x: 1198, y: 360 }, facing: { x: 1, y: 0 } },
      { attackerId: companionIds[1]!, targetId: companionIds[2]!, attacker: { x: 141, y: 360 }, target: { x: 82, y: 360 }, facing: { x: -1, y: 0 } },
      { attackerId: companionIds[3]!, targetId: companionIds[4]!, attacker: { x: 640, y: 91 }, target: { x: 640, y: 32 }, facing: { x: 0, y: -1 } },
      { attackerId: companionIds[5]!, targetId: companionIds[6]!, attacker: { x: 640, y: 629 }, target: { x: 640, y: 688 }, facing: { x: 0, y: 1 } }
    ] as const;
    const targetIds = new Set(pairs.map((pair) => pair.targetId));
    const combatants = pairs.flatMap((pair) => [
      { playerId: pair.attackerId, position: pair.attacker, facing: pair.facing, overload: 0, attacking: true },
      { playerId: pair.targetId, position: pair.target, facing: pair.facing, overload: GAME.maxOverload, attacking: false }
    ]);
    const burstDispatchStarted = await match.measured.page.evaluate(() => ({
      nowMs: performance.now(),
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus()
    }));

    game.harness.runCombatScript(match.code, {
      preservePulses: true,
      players: combatants.map(({ playerId, position, facing, overload }) => ({
        playerId,
        position,
        facing,
        overload
      })),
      steps: [
        {
          elapsedMs: 0,
          inputs: combatants.map((player) => ({
            playerId: player.playerId,
            input: { seq: 0, moveX: 0, moveY: 0, aimX: player.facing.x, aimY: player.facing.y, quick: player.attacking, heavy: false, dash: false }
          }))
        },
        {
          elapsedMs: 70,
          inputs: combatants.map((player) => ({
            playerId: player.playerId,
            input: { seq: 1, moveX: 0, moveY: 0, aimX: player.facing.x, aimY: player.facing.y, quick: false, heavy: false, dash: false }
          }))
        },
        { elapsedMs: 1_000 / GAME.tickRate },
        { elapsedMs: 1_000 / GAME.tickRate },
        { elapsedMs: 1_000 / GAME.tickRate }
      ]
    });
    const pulseAfterBurst = game.harness.matchSnapshot(match.code)?.pulses.find(
      (pulse) => pulse.projectileId === livePulse.projectileId
    );
    expect(pulseAfterBurst).toMatchObject({
      projectileId: livePulse.projectileId,
      ownerPlayerId: pulseOwnerId,
      originatingAttackId: livePulse.originatingAttackId
    });
    expect(pulseAfterBurst?.remainingMs).toBeGreaterThan(0);
    expect(pulseAfterBurst?.remainingMs).toBeLessThan(livePulse.remainingMs);
    const burstDispatchFinished = await match.measured.page.evaluate(() => ({
      nowMs: performance.now(),
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus()
    }));

    const attackerNames = pairs.map((pair) => initial.players.find((player) => player.playerId === pair.attackerId)?.name);
    if (attackerNames.some((name) => !name)) throw new Error('Ring-out attacker name was missing.');
    for (const name of attackerNames) await expect(match.measured.page.getByLabel(`${name} skoru: 1 knockout`)).toBeVisible();
    await expect(match.measured.page.locator('.game-stage canvas')).toBeVisible();
    const ringOutEffectWindowCompleted = await markAfterAnimationFrames(
      match.measured,
      RING_OUT_EFFECT_SAMPLE_FRAMES
    );

    await expect.poll(() => {
      const events = game.harness.recentEvents(match.code).filter((event) => event.eventId > eventMarker);
      return events.filter((event) => event.type === 'KNOCKOUT' && targetIds.has(event.targetId)).length;
    }, { timeout: 12_000 }).toBe(4);

    const frames = await samples;
    const events = game.harness.recentEvents(match.code).filter((event) => event.eventId > eventMarker);
    const hits = events.filter((event): event is Extract<(typeof events)[number], { type: 'HIT' }> =>
      event.type === 'HIT' && targetIds.has(event.targetId));
    const knockouts = events.filter((event): event is Extract<(typeof events)[number], { type: 'KNOCKOUT' }> =>
      event.type === 'KNOCKOUT' && targetIds.has(event.targetId));
    const hitTick = hits[0]?.tick ?? null;
    const knockoutTick = knockouts[0]?.tick ?? null;
    const pulseSpawn = events.find((event): event is Extract<(typeof events)[number], { type: 'PULSE_SPAWN' }> =>
      event.type === 'PULSE_SPAWN' && event.projectileId === livePulse.projectileId);
    const globalMetrics = burstFrameMetrics(frames);
    const correlatedFrames = framesOverlappingInterval(
      frames,
      burstDispatchStarted.nowMs,
      ringOutEffectWindowCompleted.nowMs
    );
    expect(correlatedFrames).not.toHaveLength(0);
    const correlatedMetrics = burstFrameMetrics(correlatedFrames);

    const metrics = {
      browserContexts: 1,
      authoritativePlayers: 8,
      preExistingPulseId: livePulse.projectileId,
      simultaneousHits: hits.length,
      sameTickRingOuts: knockouts.length,
      hitTick,
      knockoutTick,
      burstDispatchStarted,
      burstDispatchFinished,
      ringOutEffectWindowCompleted,
      ringOutEffectSampleFrames: RING_OUT_EFFECT_SAMPLE_FRAMES,
      sampledFrames: frames.length,
      correlatedFrames: correlatedFrames.length,
      correlatedMaxFrameMs: Number(correlatedMetrics.maxFrameMs.toFixed(2)),
      correlatedMaxFrameIndex: correlatedMetrics.maxFrameIndex,
      correlatedSurroundingFrames: correlatedMetrics.surroundingFrames,
      globalMaxFrameMs: Number(globalMetrics.maxFrameMs.toFixed(2)),
      globalMaxFrameIndex: globalMetrics.maxFrameIndex,
      globalP95FrameMs: Number(globalMetrics.p95FrameMs.toFixed(2)),
      globalMedianFps: Number(globalMetrics.medianFps.toFixed(2)),
      globalSurroundingFrames: globalMetrics.surroundingFrames
    };
    testInfo.annotations.push({ type: 'performance', description: JSON.stringify(metrics) });
    console.info(`RING_OUT_BURST_METRICS ${JSON.stringify(metrics)}`);

    expect(hits).toHaveLength(4);
    expect(pulseSpawn).toMatchObject({
      ownerPlayerId: pulseOwnerId,
      projectileId: livePulse.projectileId,
      originatingAttackId: livePulse.originatingAttackId
    });
    expect(pulseSpawn?.tick).toBeLessThan(hitTick ?? Number.NEGATIVE_INFINITY);
    expect(new Set(hits.map((event) => event.tick))).toEqual(new Set([hitTick]));
    expect(hits.every((event) =>
      event.attack === 'QUICK_1' && event.resultingOverload === GAME.maxOverload
    )).toBe(true);
    expect(new Set(hits.map((event) => event.attackerId))).toEqual(new Set(pairs.map((pair) => pair.attackerId)));
    expect(new Set(hits.map((event) => event.targetId))).toEqual(new Set(pairs.map((pair) => pair.targetId)));
    expect(knockouts).toHaveLength(4);
    expect(events.filter((event) => event.type === 'KNOCKOUT')).toHaveLength(4);
    expect(new Set(knockouts.map((event) => event.tick))).toEqual(new Set([knockoutTick]));
    expect(knockoutTick).toBeGreaterThan(hitTick ?? Number.POSITIVE_INFINITY);
    expect(new Set(knockouts.map((event) => event.attackerId))).toEqual(new Set(pairs.map((pair) => pair.attackerId)));
    expect(new Set(knockouts.map((event) => event.targetId))).toEqual(new Set(pairs.map((pair) => pair.targetId)));
    expect(game.harness.matchSnapshot(match.code)?.scores).toMatchObject(
      Object.fromEntries(pairs.map((pair) => [pair.attackerId, 1]))
    );
    expect(events.some((event) => event.type === 'RESULT')).toBe(false);
    expect(burstDispatchStarted.visibilityState).toBe('visible');
    expect(burstDispatchStarted.hasFocus).toBe(true);
    expect(burstDispatchFinished.visibilityState).toBe('visible');
    expect(burstDispatchFinished.hasFocus).toBe(true);
    expect(ringOutEffectWindowCompleted.visibilityState).toBe('visible');
    expect(ringOutEffectWindowCompleted.hasFocus).toBe(true);
    expect(ringOutEffectWindowCompleted.nowMs).toBeGreaterThanOrEqual(burstDispatchStarted.nowMs);
    expect(correlatedFrames.every((frame) => frame.visibilityState === 'visible' && frame.hasFocus)).toBe(true);
    expect(correlatedMetrics.maxFrameMs).toBeLessThan(50);
    expect(companionErrors).toEqual([]);
    await assertNoUnexpectedErrors(game, match.measured);
  } finally {
    for (const companion of match.companions) companion.disconnect();
    await match.measured.context.close();
  }
}, 60_000);
