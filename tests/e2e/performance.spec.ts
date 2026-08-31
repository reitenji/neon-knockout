import type { Browser } from '@playwright/test';
import { assertNoBrowserErrors, expect, openPlayer, test, type PlayerPage } from './fixtures.js';

async function createEightFighterMatch(browser: Browser, origin: string): Promise<Readonly<{ code: string; players: readonly PlayerPage[] }>> {
  const players = await Promise.all(Array.from({ length: 8 }, () => openPlayer(browser, origin)));
  try {
    const host = players[0]!;
    await host.page.getByLabel('Oyuncu adı').fill('Player 1');
    await host.page.getByRole('button', { name: 'Oda Kur' }).click();
    const code = await host.page.getByTestId('room-code').textContent();
    if (!code) throw new Error('Host room code was not rendered.');
    for (let index = 1; index < players.length; index += 1) {
      const player = players[index]!;
      await player.page.getByLabel('Oyuncu adı').fill(`Player ${index + 1}`);
      await player.page.getByLabel('Oda kodu').fill(code);
      await player.page.getByRole('button', { name: 'Odaya Katıl' }).click();
    }
    for (let index = 0; index < players.length; index += 1) {
      const player = players[index]!;
      await player.page.getByRole('button', { name: `${['RIFT', 'BASTION', 'PULSE', 'WRAITH'][index % 4]} gövdesini seç` }).click();
      await player.page.getByRole('button', { name: 'Hazırım' }).click();
    }
    await expect(host.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await host.page.getByRole('button', { name: 'Maçı Başlat' }).click();
    await Promise.all(players.map((player) => expect(player.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeVisible()));
    return { code, players };
  } catch (error) {
    await Promise.all(players.map((player) => player.context.close()));
    throw error;
  }
}

async function sampleFrameDurations(page: PlayerPage['page']): Promise<number[]> {
  return page.evaluate(() => new Promise<number[]>((resolve) => {
    const durations: number[] = [];
    let previous = performance.now();
    const sample = (now: number): void => {
      durations.push(now - previous);
      previous = now;
      if (durations.length >= 150) resolve(durations.slice(1));
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

test('holds the interactive canvas frame budget during an eight-fighter scripted burst', async ({ browser, game }) => {
  const match = await createEightFighterMatch(browser, game.origin);
  try {
    await expect.poll(() => game.harness.matchSnapshot(match.code)?.phase, { timeout: 12_000 }).toBe('REGULATION');
    const burst = Promise.all(match.players.map(async (player, index) => {
      const canvas = player.page.locator('.game-stage canvas');
      const box = await canvas.boundingBox();
      if (!box) throw new Error('Phaser canvas was not mounted for a load fighter.');
      for (let pulse = 0; pulse < 12; pulse += 1) {
        await player.page.mouse.move(box.x + box.width * ((index + pulse) % 8 + 1) / 9, box.y + box.height * ((pulse % 3) + 1) / 4);
        await player.page.mouse.down({ button: 'left' });
        await player.page.waitForTimeout(22);
        await player.page.mouse.up({ button: 'left' });
      }
    }));
    const durations = await sampleFrameDurations(match.players[0]!.page);
    await burst;
    const sorted = [...durations].sort((left, right) => left - right);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]!;
    expect(1_000 / median).toBeGreaterThanOrEqual(58);
    expect(p95).toBeLessThan(25);
    await assertNoBrowserErrors(...match.players);
  } finally {
    await Promise.all(match.players.map((player) => player.context.close()));
  }
}, 55_000);
