import { devices, type BrowserContextOptions, type Page } from '@playwright/test';
import type { MatchPlayer } from '../../src/shared/model.js';
import {
  assertNoUnexpectedErrors,
  expect,
  openPlayer,
  sampleAnimationFrameDurations,
  test,
  type E2eGame
} from './fixtures.js';

test.use({
  gameplayTransportOptions: {
    impairment: {
      oneWayDelayMs: 25,
      jitterSequenceMs: [0, 2, -1, 3],
      dropEveryNthPacket: null,
      reorderWindow: 0
    }
  }
});

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

type ObservedInput = Readonly<{
  sequence: number;
  quick: boolean;
}>;

type TouchObservation = Readonly<{
  trustedStarts: number;
  trustedEnds: number;
}>;

const iphone = devices['iPhone 13'];
const iphoneContext = {
  userAgent: iphone.userAgent,
  viewport: iphone.viewport,
  screen: iphone.screen,
  deviceScaleFactor: iphone.deviceScaleFactor,
  isMobile: iphone.isMobile,
  hasTouch: iphone.hasTouch
} satisfies BrowserContextOptions;

function player(game: E2eGame, roomCode: string, playerId: string): MatchPlayer {
  const candidate = game.harness.matchSnapshot(roomCode)?.players.find((value) => value.playerId === playerId);
  if (!candidate) throw new Error(`Missing authoritative WebKit mobile player ${playerId}.`);
  return candidate;
}

async function latestObservedSequence(page: Page): Promise<number> {
  return page.evaluate(() => {
    const observer = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: { inputs?: ObservedInput[] };
    }).__NEON_E2E_INPUT_OBSERVER__;
    return observer?.inputs?.at(-1)?.sequence ?? -1;
  });
}

async function observedQuickAfter(page: Page, sequence: number): Promise<ObservedInput | null> {
  return page.evaluate((afterSequence) => {
    const observer = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: { inputs?: ObservedInput[] };
    }).__NEON_E2E_INPUT_OBSERVER__;
    return observer?.inputs?.find((input) => input.sequence > afterSequence && input.quick) ?? null;
  }, sequence);
}

function observeTrustedTouchOnQuick(): void {
  const scope = window as typeof window & {
    __NEON_E2E_TOUCH_OBSERVER__?: { trustedStarts: number; trustedEnds: number };
  };
  scope.__NEON_E2E_TOUCH_OBSERVER__ = { trustedStarts: 0, trustedEnds: 0 };
  const targetsQuick = (event: TouchEvent): boolean =>
    event.target instanceof Element && event.target.closest('[aria-label="Hızlı saldırı"]') !== null;
  window.addEventListener('touchstart', (event) => {
    if (event.isTrusted && targetsQuick(event)) scope.__NEON_E2E_TOUCH_OBSERVER__!.trustedStarts += 1;
  }, { capture: true });
  window.addEventListener('touchend', (event) => {
    if (event.isTrusted && targetsQuick(event)) scope.__NEON_E2E_TOUCH_OBSERVER__!.trustedEnds += 1;
  }, { capture: true });
}

async function touchObservation(page: Page): Promise<TouchObservation | null> {
  return page.evaluate(() => (window as typeof window & {
    __NEON_E2E_TOUCH_OBSERVER__?: TouchObservation;
  }).__NEON_E2E_TOUCH_OBSERVER__ ?? null);
}

test('Playwright WebKit turns one trusted mobile tap into one authoritative WebRTC quick attack', async ({ browser, game }, testInfo) => {
  expect(testInfo.project.name).toBe('mobile-webkit');
  expect(testInfo.project.use.browserName).toBe('webkit');

  const host = await openPlayer(browser, game.origin, {
    contextOptions: iphoneContext,
    observeInput: true,
    initScript: observeTrustedTouchOnQuick
  });
  const guest = await openPlayer(browser, game.origin);
  try {
    await host.page.bringToFront();
    await host.page.getByLabel('Oyuncu adı').fill('Safari Ada');
    await host.page.getByRole('button', { name: 'Oda Kur' }).click();
    await expect(host.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();
    const code = await host.page.getByTestId('room-code').textContent();
    if (!code) throw new Error('WebKit host room code was not rendered.');

    await guest.page.getByLabel('Oyuncu adı').fill('Safari Linus');
    await guest.page.getByLabel('Oda kodu').fill(code);
    await guest.page.getByRole('button', { name: 'Odaya Katıl' }).click();
    await expect(guest.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();

    await host.page.getByRole('button', { name: 'WRAITH gövdesini seç' }).click();
    await guest.page.getByRole('button', { name: 'PULSE gövdesini seç' }).click();
    await host.page.getByRole('button', { name: 'Hazırım' }).click();
    await guest.page.getByRole('button', { name: 'Hazırım' }).click();
    await host.page.bringToFront();
    await expect(host.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await host.page.getByRole('button', { name: 'Maçı Başlat' }).click();

    await expect(host.page.getByRole('dialog', { name: 'Telefonu yatay çevir' })).toBeVisible();
    await expect(host.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeAttached();
    await expect.poll(() => game.harness.matchSnapshot(code)?.phase, { timeout: 12_000 }).toBe('REGULATION');
    const initial = game.harness.matchSnapshot(code);
    const hostPlayerId = initial?.players.find((candidate) => candidate.name === 'Safari Ada')?.playerId;
    if (!hostPlayerId) throw new Error('WebKit host player was not available in the authoritative match.');

    await host.page.setViewportSize({ width: 844, height: 390 });
    await expect(host.page.getByRole('dialog', { name: 'Telefonu yatay çevir' })).toHaveCount(0);
    await expect(host.page.getByLabel('Dokunmatik kontroller')).toBeVisible();
    await expect(host.page.getByRole('application', { name: 'Yön pedi' })).toBeVisible();
    const quick = host.page.getByRole('button', { name: 'Hızlı saldırı' });
    await expect(quick).toBeVisible();
    await host.page.bringToFront();
    const frameDurations = await sampleAnimationFrameDurations(host.page);
    expect(percentile95(frameDurations)).toBeLessThan(33);

    await expect.poll(() => game.harness.transportMode(hostPlayerId), { timeout: 10_000 }).toBe('webrtc');
    const completedBefore = player(game, code, hostPlayerId).stats.completedAttacks;
    const marker = await latestObservedSequence(host.page);
    const quickBox = await quick.boundingBox();
    if (!quickBox) throw new Error('WebKit quick touch button was not measurable.');
    await host.page.touchscreen.tap(quickBox.x + quickBox.width / 2, quickBox.y + quickBox.height / 2);
    await expect.poll(() => touchObservation(host.page))
      .toEqual({ trustedStarts: 1, trustedEnds: 1 });

    await expect.poll(() => observedQuickAfter(host.page, marker)).not.toBeNull();
    const sampledInput = await observedQuickAfter(host.page, marker);
    if (!sampledInput) throw new Error('WebKit trusted touch did not produce a quick input.');

    await expect.poll(() => game.harness.acceptedInputs(hostPlayerId).find(
      (record) => record.sequence === sampledInput.sequence
    )?.source).toBe('webrtc');
    const acceptedRecord = game.harness.acceptedInputs(hostPlayerId).find(
      (record) => record.sequence === sampledInput.sequence
    );
    if (!acceptedRecord) throw new Error('WebKit gameplay input source was not recorded.');
    testInfo.annotations.push({ type: 'gameplay-transport', description: acceptedRecord.source });
    const generation = game.harness.transportGeneration(hostPlayerId);
    expect(generation?.generationId).not.toBeNull();
    expect(generation?.negotiationCount).toBeGreaterThan(0);
    await expect.poll(() => {
      const authoritative = player(game, code, hostPlayerId);
      return authoritative.lastProcessedInputSeq >= sampledInput.sequence && authoritative.action.kind;
    }).toBe('QUICK_1');
    await expect.poll(() => player(game, code, hostPlayerId).stats.completedAttacks)
      .toBe(completedBefore + 1);
    await host.page.waitForTimeout(250);
    expect(player(game, code, hostPlayerId).stats.completedAttacks).toBe(completedBefore + 1);
    await expect(host.page.getByRole('alert')).toHaveCount(0);
    await assertNoUnexpectedErrors(game, host, guest);
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});
