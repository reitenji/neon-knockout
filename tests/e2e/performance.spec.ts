import type { Browser } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import type { Ack, InputFrame, MatchPlayer, ServerError, SessionWelcome } from '../../src/shared/model.js';
import type { ClientToServerEvents, ServerToClientEvents } from '../../src/shared/protocol.js';
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

test.use({
  launchOptions: {
    args: process.platform === 'darwin' ? ['--use-angle=metal'] : [],
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

function frameMetrics(durations: readonly number[]): Readonly<{ medianFps: number; p95FrameMs: number }> {
  const sorted = [...durations].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
  return { medianFps: 1_000 / median, p95FrameMs: p95 };
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
