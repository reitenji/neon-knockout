import { expect, test as base, type Browser, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import { createGameServer, type GameServer } from '../../src/server/network/createGameServer.js';
import type { MatchSnapshot } from '../../src/shared/model.js';

const REGULATION_TIMEOUT_MS = 12_000;

export type BrowserIssueLog = Readonly<{ pageErrors: string[]; consoleErrors: string[] }>;

export type E2eGame = Readonly<{
  origin: string;
  server: GameServer;
  harness: NonNullable<GameServer['testHarness']>;
}>;

export const test = base.extend<{ game: E2eGame }>({
  game: [async ({ browser }, provideGame) => {
    void browser;
    const server = createGameServer({ host: '127.0.0.1', port: 0, enableTestHarness: true });
    const { origin } = await server.start();
    if (!server.testHarness) throw new Error('E2E server requires its in-process test harness.');
    try {
      await provideGame({ origin, server, harness: server.testHarness });
    } finally {
      await server.stop();
    }
  }, { scope: 'worker' }]
});

export { expect };

export type PlayerPage = Readonly<{
  context: BrowserContext;
  page: Page;
  issues: BrowserIssueLog;
}>;

export type MatchPages = Readonly<{
  code: string;
  host: PlayerPage;
  guest: PlayerPage;
  hostPlayerId: string;
  guestPlayerId: string;
  close(): Promise<void>;
}>;

function errorText(message: ConsoleMessage): string {
  return `${message.type()}: ${message.text()}`;
}

export async function openPlayer(browser: Browser, origin: string): Promise<PlayerPage> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const issues = { pageErrors: [], consoleErrors: [] };
  page.on('pageerror', (error) => issues.pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') issues.consoleErrors.push(errorText(message));
  });
  await page.goto(origin);
  await expect(page.getByRole('heading', { name: 'NEON KNOCKOUT' })).toBeVisible();
  return { context, page, issues };
}

async function chooseChassisAndReady(player: PlayerPage, chassis: string): Promise<void> {
  await player.page.getByRole('button', { name: `${chassis} gövdesini seç` }).click();
  await player.page.getByRole('button', { name: 'Hazırım' }).click();
}

function playerId(snapshot: MatchSnapshot, name: string): string {
  const player = snapshot.players.find((candidate) => candidate.name === name);
  if (!player) throw new Error(`Missing ${name} in match snapshot.`);
  return player.playerId;
}

export async function createTwoPlayerMatch(browser: Browser, game: E2eGame): Promise<MatchPages> {
  const host = await openPlayer(browser, game.origin);
  const guest = await openPlayer(browser, game.origin);
  try {
    await host.page.getByLabel('Oyuncu adı').fill('Ada');
    await host.page.getByRole('button', { name: 'Oda Kur' }).click();
    await expect(host.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();
    const code = await host.page.getByTestId('room-code').textContent();
    if (!code) throw new Error('Host room code was not rendered.');

    await guest.page.getByLabel('Oyuncu adı').fill('Linus');
    await guest.page.getByLabel('Oda kodu').fill(code);
    await guest.page.getByRole('button', { name: 'Odaya Katıl' }).click();
    await expect(guest.page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();

    await chooseChassisAndReady(host, 'WRAITH');
    await chooseChassisAndReady(guest, 'PULSE');
    await expect(host.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await host.page.getByRole('button', { name: 'Maçı Başlat' }).click();
    await expect(host.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeVisible();
    await expect(guest.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeVisible();
    await expect.poll(() => game.harness.matchSnapshot(code)?.phase, { timeout: REGULATION_TIMEOUT_MS }).toBe('REGULATION');
    const snapshot = game.harness.matchSnapshot(code);
    if (!snapshot) throw new Error('Match snapshot was not available after the countdown.');
    return {
      code,
      host,
      guest,
      hostPlayerId: playerId(snapshot, 'Ada'),
      guestPlayerId: playerId(snapshot, 'Linus'),
      close: async () => { await Promise.all([host.context.close(), guest.context.close()]); }
    };
  } catch (error) {
    await Promise.all([host.context.close(), guest.context.close()]);
    throw error;
  }
}

export async function assertNoBrowserErrors(...players: readonly PlayerPage[]): Promise<void> {
  for (const player of players) {
    expect(player.issues.pageErrors, `page errors for ${await player.page.title()}`).toEqual([]);
    expect(player.issues.consoleErrors, `console errors for ${await player.page.title()}`).toEqual([]);
  }
}
