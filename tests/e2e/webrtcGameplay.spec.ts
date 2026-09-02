import type { MatchPlayer } from '../../src/shared/model.js';
import type { Page } from '@playwright/test';
import {
  assertNoUnexpectedErrors,
  createTwoPlayerMatch,
  expect,
  test,
  type E2eGame,
  type MatchPages
} from './fixtures.js';

function player(game: E2eGame, match: MatchPages, playerId: string): MatchPlayer {
  const candidate = game.harness.matchSnapshot(match.code)?.players.find((value) => value.playerId === playerId);
  if (!candidate) throw new Error(`Missing authoritative WebRTC player ${playerId}.`);
  return candidate;
}

async function waitForNeutral(game: E2eGame, match: MatchPages, playerId: string): Promise<void> {
  await expect.poll(() => {
    const candidate = player(game, match, playerId);
    return candidate.action.kind === null && candidate.hitstunRemainingMs === 0 &&
      candidate.dashRemainingMs === 0 && candidate.respawnRemainingMs === 0;
  }).toBe(true);
}

async function expectNumericPing(match: MatchPages): Promise<void> {
  for (const page of [match.host.page, match.guest.page]) {
    const roster = page.getByRole('region', { name: 'Oyuncu listesi' });
    await expect(roster.getByRole('listitem')).toHaveCount(2);
    await expect(roster.getByLabel(/^Ada ağ telemetrisi: Ping \d+ ms$/)).toHaveCount(1, { timeout: 10_000 });
    await expect(roster.getByLabel(/^Linus ağ telemetrisi: Ping \d+ ms$/)).toHaveCount(1, { timeout: 10_000 });
    await expect(roster).not.toContainText(/RTT|Delay|Rollback|\bRB\b/);
  }
}

type ObservedInput = Readonly<{
  sequence: number;
  sampledAtMs: number;
  moveX: number;
  moveY: number;
  quick: boolean;
  heavy: boolean;
  dash: boolean;
}>;

async function latestObservedSequence(page: Page): Promise<number> {
  return page.evaluate(() => {
    const observer = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: { inputs?: ObservedInput[] };
    }).__NEON_E2E_INPUT_OBSERVER__;
    return observer?.inputs?.at(-1)?.sequence ?? -1;
  });
}

async function waitForObservedInput(
  page: Page,
  afterSequence: number,
  expected: Partial<Pick<ObservedInput, 'moveX' | 'moveY' | 'quick' | 'heavy' | 'dash'>>
): Promise<ObservedInput> {
  await page.waitForFunction(({ afterSequence: after, expected: fields }) => {
    const observer = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: { inputs?: ObservedInput[] };
    }).__NEON_E2E_INPUT_OBSERVER__;
    return observer?.inputs?.some((input) => input.sequence > after &&
      Object.entries(fields).every(([key, value]) => input[key as keyof ObservedInput] === value));
  }, { afterSequence, expected });
  return page.evaluate(({ afterSequence: after, expected: fields }) => {
    const observer = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: { inputs?: ObservedInput[] };
    }).__NEON_E2E_INPUT_OBSERVER__;
    const input = observer?.inputs?.find((candidate) => candidate.sequence > after &&
      Object.entries(fields).every(([key, value]) => candidate[key as keyof ObservedInput] === value));
    if (!input) throw new Error('Exact browser input sequence was not observed.');
    return input;
  }, { afterSequence, expected });
}

async function expectAcceptedSource(
  game: E2eGame,
  playerId: string,
  sequence: number,
  source: 'webrtc' | 'websocket' | 'polling'
): Promise<void> {
  await expect.poll(() => game.harness.acceptedInputs(playerId).find(
    (record) => record.sequence === sequence
  )?.source).toBe(source);
}

function dropFirstQuickWebRtcFrame(): void {
  const originalCreateDataChannel = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function createDataChannel(label, options) {
    const channel = originalCreateDataChannel.call(this, label, options);
    if (label !== 'match-fast') return channel;
    const mutable = channel as unknown as { send(data: unknown): void };
    const send = mutable.send.bind(channel);
    mutable.send = (data: unknown): void => {
      if (typeof data === 'string') {
        try {
          const message = JSON.parse(data) as { kind?: unknown; payload?: { quick?: unknown } };
          const scope = window as typeof window & { __NEON_E2E_DROPPED_QUICK__?: boolean };
          if (message.kind === 'input' && message.payload?.quick === true && !scope.__NEON_E2E_DROPPED_QUICK__) {
            scope.__NEON_E2E_DROPPED_QUICK__ = true;
            return;
          }
        } catch {
          // Non-JSON data remains owned by the real channel.
        }
      }
      send(data);
    };
    return channel;
  };
}

test('a dropped first quick frame remains one authoritative WebRTC action despite newer neutral samples', async ({ browser, game }) => {
  const match = await createTwoPlayerMatch(browser, game, undefined, {
    observeInput: true,
    hostInitScript: dropFirstQuickWebRtcFrame
  });
  try {
    await expect.poll(() => game.harness.transportMode(match.hostPlayerId), { timeout: 10_000 }).toBe('webrtc');
    await waitForNeutral(game, match, match.hostPlayerId);
    const completedBefore = player(game, match, match.hostPlayerId).stats.completedAttacks;
    const marker = await latestObservedSequence(match.host.page);

    await match.host.page.keyboard.down('j');
    const droppedInput = await waitForObservedInput(match.host.page, marker, { quick: true });
    await match.host.page.keyboard.up('j');
    await expect.poll(() => player(game, match, match.hostPlayerId).action.kind).toBe('QUICK_1');
    await waitForNeutral(game, match, match.hostPlayerId);
    await match.host.page.waitForTimeout(250);

    expect(await match.host.page.evaluate(() =>
      (window as typeof window & { __NEON_E2E_DROPPED_QUICK__?: boolean }).__NEON_E2E_DROPPED_QUICK__
    )).toBe(true);
    const records = game.harness.acceptedInputs(match.hostPlayerId);
    expect(records.some((record) => record.sequence === droppedInput.sequence)).toBe(false);
    expect(records.some((record) => record.sequence > droppedInput.sequence && record.source === 'webrtc')).toBe(true);
    expect(player(game, match, match.hostPlayerId).stats.completedAttacks).toBe(completedBefore + 1);
    await assertNoUnexpectedErrors(game, match.host, match.guest);
  } finally {
    await match.close();
  }
});

test('WebRTC carries gameplay, falls back without reload, and activates freshly after lobby return', async ({ browser, game }) => {
  const match = await createTwoPlayerMatch(browser, game, undefined, { observeInput: true });
  try {
    await expect.poll(() => [
      game.harness.transportMode(match.hostPlayerId),
      game.harness.transportMode(match.guestPlayerId)
    ], { timeout: 10_000 }).toEqual(['webrtc', 'webrtc']);
    const firstHostGeneration = game.harness.transportGeneration(match.hostPlayerId);
    const firstGuestGeneration = game.harness.transportGeneration(match.guestPlayerId);
    expect(firstHostGeneration?.generationId).toEqual(expect.any(String));
    expect(firstGuestGeneration?.generationId).toEqual(expect.any(String));
    await expectNumericPing(match);

    const movementStart = player(game, match, match.hostPlayerId);
    await match.host.page.keyboard.down('d');
    await expect.poll(() => {
      const current = player(game, match, match.hostPlayerId);
      return current.lastProcessedInputSeq > movementStart.lastProcessedInputSeq &&
        current.position.x > movementStart.position.x + 12;
    }).toBe(true);
    await match.host.page.keyboard.up('d');
    await waitForNeutral(game, match, match.hostPlayerId);

    const quickStartSequence = player(game, match, match.hostPlayerId).lastProcessedInputSeq;
    const quickObserverMarker = await latestObservedSequence(match.host.page);
    await match.host.page.keyboard.down('j');
    const quickInput = await waitForObservedInput(match.host.page, quickObserverMarker, { quick: true });
    await expectAcceptedSource(game, match.hostPlayerId, quickInput.sequence, 'webrtc');
    await expect.poll(() => {
      const current = player(game, match, match.hostPlayerId);
      return current.lastProcessedInputSeq > quickStartSequence && current.action.kind === 'QUICK_1';
    }).toBe(true);
    await match.host.page.keyboard.up('j');
    await waitForNeutral(game, match, match.hostPlayerId);

    const heavyStartSequence = player(game, match, match.hostPlayerId).lastProcessedInputSeq;
    await match.host.page.keyboard.down('k');
    await expect.poll(() => {
      const current = player(game, match, match.hostPlayerId);
      return current.lastProcessedInputSeq > heavyStartSequence && current.action.chargeMs >= 180;
    }).toBe(true);
    await match.host.page.keyboard.up('k');
    await expect.poll(() => player(game, match, match.hostPlayerId).action.kind).toBe('HEAVY');
    await waitForNeutral(game, match, match.hostPlayerId);

    const navigationCount = await match.guest.page.evaluate(() => performance.getEntriesByType('navigation').length);
    await game.harness.dropWebRtc(match.guestPlayerId);
    await expect.poll(() => game.harness.transportMode(match.guestPlayerId)).toMatch(/^(websocket|polling)$/);
    const guestFallbackSource = game.harness.transportMode(match.guestPlayerId);
    if (guestFallbackSource !== 'websocket' && guestFallbackSource !== 'polling') {
      throw new Error('Guest did not enter a Socket.IO fallback transport.');
    }
    const fallbackSequence = player(game, match, match.guestPlayerId).lastProcessedInputSeq;
    const fallbackObserverMarker = await latestObservedSequence(match.guest.page);
    await match.guest.page.keyboard.down('j');
    const fallbackInput = await waitForObservedInput(match.guest.page, fallbackObserverMarker, { quick: true });
    await expectAcceptedSource(game, match.guestPlayerId, fallbackInput.sequence, guestFallbackSource);
    await expect.poll(() => player(game, match, match.guestPlayerId).lastProcessedInputSeq)
      .toBeGreaterThan(fallbackSequence);
    await expect.poll(() => player(game, match, match.guestPlayerId).action.kind, {
      timeout: 1_500,
      intervals: [5]
    }).toBe('QUICK_1');
    await match.guest.page.keyboard.up('j');
    expect(await match.guest.page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationCount);

    for (let score = 1; score <= 5; score += 1) {
      game.harness.forceKnockout(match.code, match.hostPlayerId, match.guestPlayerId);
      await expect.poll(() => game.harness.matchSnapshot(match.code)?.scores[match.hostPlayerId]).toBe(score);
      if (score < 5) {
        await expect.poll(() => player(game, match, match.guestPlayerId).respawnRemainingMs).toBeGreaterThan(0);
        await waitForNeutral(game, match, match.guestPlayerId);
      }
    }
    await expect(match.host.page.getByRole('heading', { name: 'Ada Kazandı' })).toBeVisible();
    await game.harness.dropWebRtc(match.hostPlayerId);
    await expect.poll(() => game.harness.transportMode(match.hostPlayerId)).toMatch(/^(websocket|polling)$/);

    await match.host.page.getByRole('button', { name: 'Lobiye Dön' }).click();
    await expect(match.host.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();
    await expect(match.guest.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();
    await expect.poll(() => [
      game.harness.transportMode(match.hostPlayerId),
      game.harness.transportMode(match.guestPlayerId)
    ], { timeout: 10_000 }).toEqual(['webrtc', 'webrtc']);
    const rematchHostGeneration = game.harness.transportGeneration(match.hostPlayerId);
    const rematchGuestGeneration = game.harness.transportGeneration(match.guestPlayerId);
    expect(rematchHostGeneration?.generationId).not.toBe(firstHostGeneration?.generationId);
    expect(rematchGuestGeneration?.generationId).not.toBe(firstGuestGeneration?.generationId);
    expect(rematchHostGeneration?.negotiationCount).toBe((firstHostGeneration?.negotiationCount ?? 0) + 1);
    expect(rematchGuestGeneration?.negotiationCount).toBe((firstGuestGeneration?.negotiationCount ?? 0) + 1);

    await match.host.page.getByRole('button', { name: 'Hazırım' }).click();
    await match.guest.page.getByRole('button', { name: 'Hazırım' }).click();
    await expect(match.host.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await match.host.page.getByRole('button', { name: 'Maçı Başlat' }).click();
    await expect.poll(() => game.harness.matchSnapshot(match.code)?.phase, { timeout: 12_000 }).toBe('REGULATION');
    expect(game.harness.transportMode(match.hostPlayerId)).toBe('webrtc');
    expect(game.harness.transportMode(match.guestPlayerId)).toBe('webrtc');
    const rematchSequence = player(game, match, match.hostPlayerId).lastProcessedInputSeq;
    const hostRematchMarker = await latestObservedSequence(match.host.page);
    await match.host.page.keyboard.down('d');
    const hostRematchInput = await waitForObservedInput(match.host.page, hostRematchMarker, { moveX: 1 });
    await expectAcceptedSource(game, match.hostPlayerId, hostRematchInput.sequence, 'webrtc');
    await expect.poll(() => player(game, match, match.hostPlayerId).lastProcessedInputSeq).toBeGreaterThan(rematchSequence);
    await match.host.page.keyboard.up('d');
    const guestRematchMarker = await latestObservedSequence(match.guest.page);
    await match.guest.page.keyboard.down('a');
    const guestRematchInput = await waitForObservedInput(match.guest.page, guestRematchMarker, { moveX: -1 });
    await expectAcceptedSource(game, match.guestPlayerId, guestRematchInput.sequence, 'webrtc');
    await match.guest.page.keyboard.up('a');

    await assertNoUnexpectedErrors(game, match.host, match.guest);
  } finally {
    await match.close();
  }
}, 60_000);
