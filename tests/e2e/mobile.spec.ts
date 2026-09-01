import type { Browser, ConsoleMessage } from '@playwright/test';
import type { MatchPlayer } from '../../src/shared/model.js';
import {
  assertNoUnexpectedErrors,
  expect,
  openPlayer,
  test,
  type E2eGame,
  type PlayerPage
} from './fixtures.js';

async function openMobilePlayer(browser: Browser, origin: string): Promise<PlayerPage> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const issues = { pageErrors: [] as string[], consoleErrors: [] as string[] };
  page.on('pageerror', (error) => issues.pageErrors.push(error.message));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') issues.consoleErrors.push(`${message.type()}: ${message.text()}`);
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'NEON KNOCKOUT' })).toBeVisible();
  return { context, page, issues };
}

function player(game: E2eGame, roomCode: string, playerId: string): MatchPlayer {
  const candidate = game.harness.matchSnapshot(roomCode)?.players.find((value) => value.playerId === playerId);
  if (!candidate) throw new Error(`Missing authoritative mobile player ${playerId}.`);
  return candidate;
}

async function waitForNeutral(game: E2eGame, roomCode: string, playerId: string): Promise<void> {
  await expect.poll(() => {
    const candidate = player(game, roomCode, playerId);
    return candidate.action.kind === null && candidate.hitstunRemainingMs === 0 &&
      candidate.dashRemainingMs === 0 && candidate.respawnRemainingMs === 0;
  }).toBe(true);
}

test('portrait phone lobby rotates into a real touch-controlled authoritative match', async ({ browser, game }) => {
  const host = await openMobilePlayer(browser, game.origin);
  const guest = await openPlayer(browser, game.origin);
  try {
    await expect(host.page.getByRole('button', { name: 'Oda Kur' })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Odaya Katıl' })).toBeVisible();
    await expect(host.page.getByRole('alert')).toHaveCount(0);

    await host.page.getByLabel('Oyuncu adı').fill('Mobil Ada');
    await host.page.getByRole('button', { name: 'Oda Kur' }).click();
    await expect(host.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();
    const code = await host.page.getByTestId('room-code').textContent();
    if (!code) throw new Error('Mobile host room code was not rendered.');

    await guest.page.getByLabel('Oyuncu adı').fill('Linus');
    await guest.page.getByLabel('Oda kodu').fill(code);
    await guest.page.getByRole('button', { name: 'Odaya Katıl' }).click();
    await expect(guest.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();

    await host.page.getByRole('button', { name: 'WRAITH gövdesini seç' }).click();
    await guest.page.getByRole('button', { name: 'PULSE gövdesini seç' }).click();
    await host.page.getByRole('button', { name: 'Hazırım' }).click();
    await guest.page.getByRole('button', { name: 'Hazırım' }).click();
    await expect(host.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await host.page.getByRole('button', { name: 'Maçı Başlat' }).click();

    await expect(host.page.getByRole('dialog', { name: 'Telefonu yatay çevir' })).toBeVisible();
    await expect(host.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeAttached();
    await expect.poll(() => game.harness.matchSnapshot(code)?.phase, { timeout: 12_000 }).toBe('REGULATION');
    const initial = game.harness.matchSnapshot(code);
    const hostPlayerId = initial?.players.find((candidate) => candidate.name === 'Mobil Ada')?.playerId;
    const guestPlayerId = initial?.players.find((candidate) => candidate.name === 'Linus')?.playerId;
    if (!hostPlayerId || !guestPlayerId) throw new Error('Mobile match players were not available.');

    await host.page.setViewportSize({ width: 667, height: 375 });
    await expect(host.page.getByRole('dialog', { name: 'Telefonu yatay çevir' })).toHaveCount(0);
    const touchControls = host.page.getByLabel('Dokunmatik kontroller');
    await expect(touchControls).toBeVisible();
    await expect(host.page.getByRole('application', { name: 'Yön pedi' })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Hızlı saldırı' })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Charge saldırı' })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Dash' })).toBeVisible();

    game.harness.placePlayer(code, hostPlayerId, { x: 520, y: 360 }, { x: 1, y: 0 });
    game.harness.placePlayer(code, guestPlayerId, { x: 900, y: 360 }, { x: -1, y: 0 });
    await waitForNeutral(game, code, hostPlayerId);

    const pad = host.page.getByRole('application', { name: 'Yön pedi' });
    const padBox = await pad.boundingBox();
    if (!padBox) throw new Error('Touch joystick was not measurable.');
    const movementStart = player(game, code, hostPlayerId).position.x;
    await host.page.mouse.move(padBox.x + padBox.width / 2, padBox.y + padBox.height / 2);
    await host.page.mouse.down();
    await host.page.mouse.move(padBox.x + padBox.width - 3, padBox.y + padBox.height / 2, { steps: 2 });
    await expect.poll(() => player(game, code, hostPlayerId).position.x).toBeGreaterThan(movementStart + 12);
    await host.page.mouse.up();

    await waitForNeutral(game, code, hostPlayerId);
    const quick = host.page.getByRole('button', { name: 'Hızlı saldırı' });
    const quickBox = await quick.boundingBox();
    if (!quickBox) throw new Error('Quick touch button was not measurable.');
    await host.page.mouse.move(quickBox.x + quickBox.width / 2, quickBox.y + quickBox.height / 2);
    await host.page.mouse.down();
    await expect.poll(() => player(game, code, hostPlayerId).action.kind).toBe('QUICK_1');
    await host.page.mouse.up();

    await waitForNeutral(game, code, hostPlayerId);
    const heavy = host.page.getByRole('button', { name: 'Charge saldırı' });
    const heavyBox = await heavy.boundingBox();
    if (!heavyBox) throw new Error('Heavy touch button was not measurable.');
    await host.page.mouse.move(heavyBox.x + heavyBox.width / 2, heavyBox.y + heavyBox.height / 2);
    await host.page.mouse.down();
    await expect.poll(() => player(game, code, hostPlayerId).action.chargeMs).toBeGreaterThanOrEqual(180);
    await host.page.mouse.up();
    await expect.poll(() => player(game, code, hostPlayerId).action.kind).toBe('HEAVY');

    await waitForNeutral(game, code, hostPlayerId);
    const dash = host.page.getByRole('button', { name: 'Dash' });
    const dashBox = await dash.boundingBox();
    if (!dashBox) throw new Error('Dash touch button was not measurable.');
    await host.page.mouse.move(dashBox.x + dashBox.width / 2, dashBox.y + dashBox.height / 2);
    await host.page.mouse.down();
    await expect.poll(() => {
      const candidate = player(game, code, hostPlayerId);
      return candidate.dashRemainingMs > 0 || candidate.dashCooldownRemainingMs > 0;
    }).toBe(true);
    await host.page.mouse.up();

    expect(player(game, code, hostPlayerId).lastProcessedInputSeq).toBeGreaterThan(0);
    await assertNoUnexpectedErrors(game, host, guest);
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});
