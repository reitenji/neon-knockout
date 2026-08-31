import type { Page } from '@playwright/test';
import { assertNoBrowserErrors, createTwoPlayerMatch, expect, test } from './fixtures.js';

function directionKey(delta: number, negative: string, positive: string): string | null {
  if (Math.abs(delta) < 10) return null;
  return delta < 0 ? negative : positive;
}

async function aimAt(page: Page, target: Readonly<{ x: number; y: number }>): Promise<void> {
  const canvas = page.locator('.game-stage canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Phaser canvas was not mounted.');
  await page.mouse.move(box.x + target.x / 1280 * box.width, box.y + target.y / 720 * box.height);
}

test('two production browser contexts complete a real-hit knockout rematch and reconnect journey', async ({ browser, game }) => {
  const match = await createTwoPlayerMatch(browser, game);
  try {
    let inRange = false;
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const snapshot = game.harness.matchSnapshot(match.code);
      if (!snapshot) throw new Error('Lost match snapshot while moving toward an opponent.');
      const attacker = snapshot.players.find((player) => player.playerId === match.hostPlayerId);
      const target = snapshot.players.find((player) => player.playerId === match.guestPlayerId);
      if (!attacker || !target) throw new Error('Expected both fighters in the match snapshot.');
      const distance = Math.hypot(target.position.x - attacker.position.x, target.position.y - attacker.position.y);
      await aimAt(match.host.page, target.position);
      if (distance < 62) { inRange = true; break; }
      const keys = [
        directionKey(target.position.x - attacker.position.x, 'A', 'D'),
        directionKey(target.position.y - attacker.position.y, 'W', 'S')
      ].filter((key): key is string => key !== null);
      await Promise.all(keys.map((key) => match.host.page.keyboard.down(key)));
      await match.host.page.waitForTimeout(120);
      await Promise.all(keys.map((key) => match.host.page.keyboard.up(key)));
    }
    expect(inRange).toBe(true);

    const beforeHit = game.harness.matchSnapshot(match.code)!;
    const beforeTarget = beforeHit.players.find((player) => player.playerId === match.guestPlayerId)!;
    await aimAt(match.host.page, beforeTarget.position);
    await match.host.page.mouse.down({ button: 'left' });
    await match.host.page.waitForTimeout(100);
    await match.host.page.mouse.up({ button: 'left' });
    await expect.poll(() => {
      const snapshot = game.harness.matchSnapshot(match.code);
      return snapshot?.players.find((player) => player.playerId === match.hostPlayerId)?.stats.landedHits ?? 0;
    }).toBeGreaterThan(0);

    const beforeDisconnect = game.harness.matchSnapshot(match.code)!;
    const fallsBeforeDisconnect = beforeDisconnect.players.find((player) => player.playerId === match.guestPlayerId)!.stats.falls;
    game.harness.disconnectPlayer(match.code, match.guestPlayerId);
    await expect.poll(() => game.server.rooms.debugRoom(match.code)?.connectedCount).toBe(1);
    await expect(match.guest.page.getByRole('dialog')).toBeVisible();
    await expect.poll(() => game.server.rooms.debugRoom(match.code)?.connectedCount, { timeout: 12_000 }).toBe(2);
    await expect.poll(() => {
      const player = game.harness.matchSnapshot(match.code)?.players.find((candidate) => candidate.playerId === match.guestPlayerId);
      return player?.stats.falls;
    }).toBe(fallsBeforeDisconnect);

    for (let knockouts = 0; knockouts < 5; knockouts += 1) {
      game.harness.forceKnockout(match.code, match.hostPlayerId, match.guestPlayerId);
      if (knockouts < 4) {
        await expect.poll(() => game.harness.matchSnapshot(match.code)?.players.find(
          (player) => player.playerId === match.guestPlayerId
        )?.respawnRemainingMs).toBe(0);
      }
    }
    await expect(match.host.page.getByRole('heading', { name: 'Ada Kazandı' })).toBeVisible();
    await expect(match.guest.page.getByRole('heading', { name: 'Ada Kazandı' })).toBeVisible();
    await expect(match.host.page.getByRole('button', { name: 'Tekrar Hazır' })).toBeVisible();
    await match.host.page.getByRole('button', { name: 'Tekrar Hazır' }).click();
    await match.guest.page.getByRole('button', { name: 'Tekrar Hazır' }).click();
    await expect(match.host.page.getByRole('button', { name: 'Rövanşı Başlat' })).toBeEnabled();
    await match.host.page.getByRole('button', { name: 'Rövanşı Başlat' }).click();
    await expect(match.host.page.getByRole('img', { name: 'Neon Knockout oyun alanı' })).toBeVisible();
    await expect.poll(() => game.harness.matchSnapshot(match.code)?.scores[match.hostPlayerId]).toBe(0);
    await assertNoBrowserErrors(match.host, match.guest);
  } finally {
    await match.close();
  }
}, 50_000);
