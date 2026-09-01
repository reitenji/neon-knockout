import type { ConsoleMessage } from '@playwright/test';
import { assertNoUnexpectedErrors, expect, test } from './fixtures.js';

test('the shipped browser client falls back to polling when WebSocket is unavailable', async ({ browser, game }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.addInitScript(() => {
    Object.defineProperty(window, 'WebSocket', {
      configurable: true,
      value: class BlockedWebSocket {
        binaryType = 'blob';
        readyState = 0;
        onopen: ((event: Event) => void) | null = null;
        onclose: ((event: Event) => void) | null = null;
        onmessage: ((event: Event) => void) | null = null;
        onerror: ((event: Event) => void) | null = null;

        constructor() {
          window.setTimeout(() => this.onerror?.(new Event('error')), 0);
        }

        close(): void { this.readyState = 3; }
        send(): void {}
      }
    });
  });
  const page = await context.newPage();
  const issues = { pageErrors: [] as string[], consoleErrors: [] as string[] };
  const pollingRequests: string[] = [];
  page.on('pageerror', (error) => issues.pageErrors.push(error.message));
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') issues.consoleErrors.push(`${message.type()}: ${message.text()}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/socket.io') && url.searchParams.get('transport') === 'polling') {
      pollingRequests.push(request.url());
    }
  });

  try {
    await page.goto(game.origin);
    await expect(page.getByText('Bağlı', { exact: true })).toBeVisible();
    await page.getByLabel('Oyuncu adı').fill('Fallback Ada');
    await page.getByRole('button', { name: 'Oda Kur' }).click();
    await expect(page.getByRole('region', { name: 'Oda lobisi' })).toBeVisible();
    expect(pollingRequests.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Odadan Çık' }).click();
    await expect(page.getByRole('heading', { name: 'NEON KNOCKOUT' })).toBeVisible();
    await assertNoUnexpectedErrors(game, { context, page, issues });
  } finally {
    await context.close();
  }
});
