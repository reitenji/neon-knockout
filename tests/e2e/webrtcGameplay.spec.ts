import type { MatchPlayer } from '../../src/shared/model.js';
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

test('WebRTC carries gameplay, falls back without reload, and activates freshly after lobby return', async ({ browser, game }) => {
  const match = await createTwoPlayerMatch(browser, game);
  try {
    await expect.poll(() => [
      game.harness.transportMode(match.hostPlayerId),
      game.harness.transportMode(match.guestPlayerId)
    ], { timeout: 10_000 }).toEqual(['webrtc', 'webrtc']);
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
    await match.host.page.keyboard.down('j');
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
    const fallbackSequence = player(game, match, match.guestPlayerId).lastProcessedInputSeq;
    await match.guest.page.keyboard.down('j');
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
    await expect.poll(() => game.harness.transportMode(match.hostPlayerId), { timeout: 10_000 }).toBe('webrtc');

    await match.host.page.getByRole('button', { name: 'Hazırım' }).click();
    await match.guest.page.getByRole('button', { name: 'Hazırım' }).click();
    await expect(match.host.page.getByRole('button', { name: 'Maçı Başlat' })).toBeEnabled();
    await match.host.page.getByRole('button', { name: 'Maçı Başlat' }).click();
    await expect.poll(() => game.harness.matchSnapshot(match.code)?.phase, { timeout: 12_000 }).toBe('REGULATION');
    expect(game.harness.transportMode(match.hostPlayerId)).toBe('webrtc');
    const rematchSequence = player(game, match, match.hostPlayerId).lastProcessedInputSeq;
    await match.host.page.keyboard.down('d');
    await expect.poll(() => player(game, match, match.hostPlayerId).lastProcessedInputSeq).toBeGreaterThan(rematchSequence);
    await match.host.page.keyboard.up('d');

    await assertNoUnexpectedErrors(game, match.host, match.guest);
  } finally {
    await match.close();
  }
}, 60_000);
