import type { Page } from '@playwright/test';
import type { MatchPlayer } from '../../src/shared/model.js';
import {
  assertNoUnexpectedErrors,
  createTwoPlayerMatch,
  expect,
  test,
  type E2eGame,
  type MatchPages
} from './fixtures.js';

test.use({
  launchOptions: {
    args: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=CalculateNativeWinOcclusion',
      '--disable-renderer-backgrounding',
      ...(process.platform === 'darwin' ? ['--use-angle=metal'] : [])
    ],
    headless: true
  }
});

type ObservedInput = Readonly<{
  sequence: number;
  sampledAtMs: number;
  viewTick: number;
  moveX: number;
  moveY: number;
  quick: boolean;
  heavy: boolean;
  dash: boolean;
}>;

type AcceptedSnapshotRecord = Readonly<{
  tick: number;
  lastProcessedInputSeq: number;
  acceptedAtMs: number;
  transport: string | null;
  pingMs: number | null;
}>;

type LocalPresentationRecord = Readonly<{
  inputSequence: number;
  sampledAtMs: number;
  renderedAtMs: number;
  actionKind: string | null;
  positionX: number;
  positionY: number;
}>;

type TimelineSampleRecord = Readonly<{
  sampledAtMs: number;
  targetTick: number | null;
  delayFrames: number;
  rollbackFrames: number;
  extrapolatedFrames: number;
  bufferUnderrun: boolean;
  transport: string | null;
  pingMs: number | null;
}>;

type ReconciliationRecord = Readonly<{
  authoritativeTick: number;
  rollbackFrames: number;
  correctionDistancePx: number;
  hardSnap: boolean;
}>;

type BrowserNetcodeObserver = Readonly<{
  inputs: readonly ObservedInput[];
  acceptedSnapshots: readonly AcceptedSnapshotRecord[];
  localPresentations: readonly LocalPresentationRecord[];
  timelineSamples: readonly TimelineSampleRecord[];
  reconciliations: readonly ReconciliationRecord[];
  fallbackReasons: readonly Readonly<{ reason: string; atMs: number }>[];
}>;

type TierCase = Readonly<{
  label: string;
  rttMs: number;
  oneWayDelayMs: number;
  maxRollbackP95: number;
}>;

const tierCases: readonly TierCase[] = [
  { label: '20ms', rttMs: 20, oneWayDelayMs: 5, maxRollbackP95: 4 },
  { label: '50ms', rttMs: 50, oneWayDelayMs: 20, maxRollbackP95: 5 },
  { label: '100ms', rttMs: 100, oneWayDelayMs: 45, maxRollbackP95: 8 },
  { label: '150ms', rttMs: 150, oneWayDelayMs: 70, maxRollbackP95: 10 }
] as const;

function authoritativePlayer(game: E2eGame, match: MatchPages, playerId: string): MatchPlayer {
  const player = game.harness.matchSnapshot(match.code)?.players.find((candidate) => candidate.playerId === playerId);
  if (!player) throw new Error(`Missing authoritative player ${playerId}.`);
  return player;
}

function playerNetwork(game: E2eGame, match: MatchPages, playerId: string) {
  return game.harness.matchSnapshot(match.code)?.network[playerId] ?? null;
}

async function observer(page: Page): Promise<BrowserNetcodeObserver> {
  return page.evaluate(() => {
    const candidate = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: BrowserNetcodeObserver;
    }).__NEON_E2E_INPUT_OBSERVER__;
    if (!candidate) throw new Error('Netcode observer was not installed.');
    return candidate;
  });
}

async function clearObserver(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidate = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: Record<string, unknown[]>;
    }).__NEON_E2E_INPUT_OBSERVER__;
    if (!candidate) throw new Error('Netcode observer was not installed.');
    for (const key of ['inputs', 'acceptedSnapshots', 'localPresentations', 'timelineSamples', 'reconciliations']) {
      candidate[key]?.splice(0);
    }
  });
}

async function clearSteadyStateMeasurements(page: Page): Promise<void> {
  await page.evaluate(() => {
    const candidate = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: {
        acceptedSnapshots?: unknown[];
        reconciliations?: unknown[];
        timelineSamples?: unknown[];
      };
    }).__NEON_E2E_INPUT_OBSERVER__;
    candidate?.acceptedSnapshots?.splice(0);
    candidate?.reconciliations?.splice(0);
    candidate?.timelineSamples?.splice(0);
  });
}

async function latestInputSequence(page: Page): Promise<number> {
  return page.evaluate(() => {
    const candidate = (window as typeof window & {
      __NEON_E2E_INPUT_OBSERVER__?: BrowserNetcodeObserver;
    }).__NEON_E2E_INPUT_OBSERVER__;
    return candidate?.inputs.at(-1)?.sequence ?? -1;
  });
}

async function waitForInput(
  page: Page,
  afterSequence: number,
  predicate: (input: ObservedInput) => boolean
): Promise<ObservedInput> {
  await expect.poll(async () => {
    const current = await observer(page);
    return current.inputs.some((input) => input.sequence > afterSequence && predicate(input));
  }).toBe(true);
  const input = (await observer(page)).inputs.find((candidate) =>
    candidate.sequence > afterSequence && predicate(candidate));
  if (!input) throw new Error('Expected sampled input was not retained by the observer.');
  return input;
}

async function waitForRenderedInput(
  page: Page,
  input: ObservedInput,
  actionKind?: string
): Promise<LocalPresentationRecord> {
  await expect.poll(async () => {
    const current = await observer(page);
    return current.localPresentations.some((presentation) =>
      presentation.inputSequence === input.sequence
      && (actionKind === undefined || presentation.actionKind === actionKind));
  }).toBe(true);
  const presentation = (await observer(page)).localPresentations.find((candidate) =>
    candidate.inputSequence === input.sequence
    && (actionKind === undefined || candidate.actionKind === actionKind));
  if (!presentation) throw new Error('Expected sampled input was not observed on an actual rendered fighter frame.');
  expect(presentation.renderedAtMs).toBeGreaterThanOrEqual(input.sampledAtMs);
  expect(presentation.renderedAtMs - input.sampledAtMs).toBeLessThanOrEqual(17);
  return presentation;
}

async function waitForNeutral(game: E2eGame, match: MatchPages): Promise<void> {
  await expect.poll(() => {
    const player = authoritativePlayer(game, match, match.hostPlayerId);
    return player.action.kind === null
      && player.hitstunRemainingMs === 0
      && player.dashRemainingMs === 0
      && player.respawnRemainingMs === 0;
  }).toBe(true);
}

async function expectEdgeConvergesWithinTwoAcceptedSnapshots(
  game: E2eGame,
  match: MatchPages,
  inputSequence: number
): Promise<void> {
  try {
    await expect.poll(() => game.harness.acceptedInputs(match.hostPlayerId).some((record) =>
      record.sequence >= inputSequence && record.source === 'webrtc'), {
      intervals: [20, 50, 100],
      timeout: 1_500
    }).toBe(true);
  } catch (error) {
    const observed = await observer(match.host.page);
    const requestedInput = observed.inputs.find((input) => input.sequence === inputSequence) ?? null;
    throw new Error(`WebRTC did not accept input ${inputSequence}: ${JSON.stringify({
      transport: game.harness.transportMode(match.hostPlayerId),
      fallbackReasons: observed.fallbackReasons,
      requestedInput,
      acceptedNearInput: game.harness.acceptedInputs(match.hostPlayerId)
        .filter((record) => record.sequence >= inputSequence - 3 && record.sequence <= inputSequence + 20),
      acceptedInputs: game.harness.acceptedInputs(match.hostPlayerId).slice(-12),
      sampledInputs: observed.inputs.slice(-12),
      acceptedSnapshots: observed.acceptedSnapshots.slice(-12)
    })}`, { cause: error });
  }
  const acceptedAtTick = game.harness.matchSnapshot(match.code)?.tick;
  if (acceptedAtTick === undefined) throw new Error('Authoritative acceptance tick was unavailable.');
  try {
    await expect.poll(async () => {
      const accepted = (await observer(match.host.page)).acceptedSnapshots
        .filter((snapshot) => snapshot.tick > acceptedAtTick)
        .slice(0, 2);
      return accepted.some((snapshot) => snapshot.lastProcessedInputSeq >= inputSequence);
    }, { timeout: 5_000 }).toBe(true);
  } catch (error) {
    const observed = await observer(match.host.page);
    throw new Error(`Input ${inputSequence} was not acknowledged within two accepted snapshots after tick ${acceptedAtTick}: ${JSON.stringify({
      transport: game.harness.transportMode(match.hostPlayerId),
      acceptedInputs: game.harness.acceptedInputs(match.hostPlayerId).slice(-12),
      acceptedSnapshots: observed.acceptedSnapshots.filter((snapshot) => snapshot.tick > acceptedAtTick).slice(0, 4)
    })}`, { cause: error });
  }
  const accepted = (await observer(match.host.page)).acceptedSnapshots
    .filter((snapshot) => snapshot.tick > acceptedAtTick)
    .slice(0, 2);
  expect(accepted).toHaveLength(2);
  expect(accepted.some((snapshot) => snapshot.lastProcessedInputSeq >= inputSequence)).toBe(true);
}

async function exercisePressEdge(
  game: E2eGame,
  match: MatchPages,
  key: string,
  field: 'quick' | 'dash',
  actionKind: 'QUICK_1' | 'DASH'
): Promise<void> {
  await waitForNeutral(game, match);
  const marker = await latestInputSequence(match.host.page);
  await match.host.page.keyboard.down(key);
  const edge = await waitForInput(match.host.page, marker, (input) => input[field]);
  await waitForRenderedInput(match.host.page, edge, actionKind);
  await match.host.page.keyboard.up(key);
  await expectEdgeConvergesWithinTwoAcceptedSnapshots(game, match, edge.sequence);
}

async function exerciseHeavyRelease(game: E2eGame, match: MatchPages): Promise<void> {
  await waitForNeutral(game, match);
  const marker = await latestInputSequence(match.host.page);
  await match.host.page.keyboard.down('k');
  const charging = await waitForInput(match.host.page, marker, (input) => input.heavy);
  await waitForRenderedInput(match.host.page, charging, 'HEAVY');
  await match.host.page.keyboard.up('k');
  const release = await waitForInput(match.host.page, charging.sequence, (input) => !input.heavy);
  await expectEdgeConvergesWithinTwoAcceptedSnapshots(game, match, release.sequence);
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0;
}

function pingBand(tier: TierCase): Readonly<{ minimum: number; maximum: number }> {
  return {
    minimum: tier.rttMs - 12,
    // Headless Chromium and werift add a bounded dispatch floor around the injected transit time.
    // Keep both sides bounded so, for example, a 90 ms sample can never satisfy the 20 ms tier.
    maximum: tier.rttMs + Math.ceil(Math.max(55, tier.rttMs * 0.75))
  };
}

async function expectStablePing(game: E2eGame, match: MatchPages, tier: TierCase): Promise<void> {
  const { minimum, maximum } = pingBand(tier);
  for (let sample = 0; sample < 3; sample += 1) {
    try {
      await expect.poll(() => {
        const network = playerNetwork(game, match, match.hostPlayerId);
        return network?.medianMs !== null && network?.medianMs !== undefined
          && network.currentMs !== null
          && network.medianMs >= minimum && network.medianMs <= maximum
          && network.currentMs >= minimum && network.currentMs <= maximum;
      }, { timeout: 10_000 }).toBe(true);
    } catch (error) {
      throw new Error(`RTT band ${minimum}-${maximum} missed: ${JSON.stringify(playerNetwork(game, match, match.hostPlayerId))}`, {
        cause: error
      });
    }
    const network = playerNetwork(game, match, match.hostPlayerId);
    expect(network?.medianMs).toBeLessThanOrEqual(maximum);
    expect(network?.currentMs).toBeGreaterThanOrEqual(minimum);
    expect(network?.currentMs).toBeLessThanOrEqual(maximum);
    if (sample < 2) await match.host.page.waitForTimeout(1_050);
  }
}

function runTierCase(tier: TierCase): void {
  const tierTest = test.extend({
    gameplayTransportOptions: [{
      impairment: {
        // The real browser/werift path already contributes dispatch time; this fixed transit
        // addition calibrates each authoritative gameplay-path sample into the named RTT tier.
        oneWayDelayMs: tier.oneWayDelayMs,
        jitterSequenceMs: [0, 2, -1, 3],
        dropEveryNthPacket: null,
        reorderWindow: 0
      }
    }, { option: true, scope: 'worker' }]
  });
  tierTest.describe(`${tier.label} deterministic RTT`, () => {
    tierTest(`keeps rendered prediction immediate and rollback bounded at ${tier.label}`, async ({ browser, game }, testInfo) => {
      const match = await createTwoPlayerMatch(browser, game, undefined, {
        observeInput: true,
        waitForWebRtcBeforeStart: true
      });
      try {
        await match.host.page.bringToFront();
        await expect.poll(() => game.harness.transportMode(match.hostPlayerId), { timeout: 10_000 }).toBe('webrtc');
        await clearObserver(match.host.page);
        await expectStablePing(game, match, tier);
        await expect.poll(async () => (await observer(match.host.page)).localPresentations.length).toBeGreaterThan(0);

        const beforeMove = (await observer(match.host.page)).localPresentations.at(-1);
        if (!beforeMove) throw new Error('Initial rendered local pose was not observed.');
        const moveMarker = await latestInputSequence(match.host.page);
        await match.host.page.keyboard.down('d');
        const movement = await waitForInput(match.host.page, moveMarker, (input) => input.moveX === 1);
        const moved = await waitForRenderedInput(match.host.page, movement);
        expect(moved.positionX).toBeGreaterThan(beforeMove.positionX);
        await match.host.page.keyboard.up('d');

        await exercisePressEdge(game, match, 'j', 'quick', 'QUICK_1');
        await exercisePressEdge(game, match, 'Space', 'dash', 'DASH');
        await exerciseHeavyRelease(game, match);

        await match.host.page.waitForFunction(() => {
          const candidate = (window as typeof window & {
            __NEON_E2E_INPUT_OBSERVER__?: BrowserNetcodeObserver;
          }).__NEON_E2E_INPUT_OBSERVER__;
          return (candidate?.acceptedSnapshots.length ?? 0) >= 30;
        }, undefined, { polling: 'raf', timeout: 5_000 });
        await clearSteadyStateMeasurements(match.host.page);
        await match.host.page.keyboard.down('d');
        try {
          await match.host.page.waitForFunction(() => {
            const candidate = (window as typeof window & {
              __NEON_E2E_INPUT_OBSERVER__?: BrowserNetcodeObserver;
            }).__NEON_E2E_INPUT_OBSERVER__;
            return (candidate?.acceptedSnapshots.length ?? 0) >= 60;
          }, undefined, { polling: 'raf', timeout: 5_000 });
        } finally {
          await match.host.page.keyboard.up('d');
        }
        const observed = await observer(match.host.page);
        const rollbackValues = observed.reconciliations.map((entry) => entry.rollbackFrames);
        expect(percentile95(rollbackValues), JSON.stringify({
          tier: tier.label,
          rollbackValues,
          network: playerNetwork(game, match, match.hostPlayerId)
        })).toBeLessThanOrEqual(tier.maxRollbackP95);
        expect(observed.reconciliations.filter((entry) => !entry.hardSnap)
          .every((entry) => entry.correctionDistancePx < 160)).toBe(true);
        expect(observed.timelineSamples.length).toBeGreaterThan(20);
        expect(observed.timelineSamples.every((entry) => entry.extrapolatedFrames <= 2)).toBe(true);
        expect(observed.timelineSamples.every((entry) => entry.delayFrames >= 1 && entry.delayFrames <= 5)).toBe(true);
        expect(observed.timelineSamples.every((entry) => entry.rollbackFrames >= 2 && entry.rollbackFrames <= 10)).toBe(true);

        const targetTicks = observed.timelineSamples
          .map((entry) => entry.targetTick)
          .filter((entry): entry is number => typeof entry === 'number');
        expect(targetTicks.length).toBeGreaterThan(20);
        expect(targetTicks.every((value, index) => index === 0 || value >= targetTicks[index - 1]!)).toBe(true);
        const { minimum, maximum } = pingBand(tier);
        const chosenPing = observed.timelineSamples.filter((entry) => entry.pingMs !== null);
        expect(chosenPing.length).toBeGreaterThan(0);
        expect(chosenPing.every((entry) => entry.transport === 'webrtc')).toBe(true);
        const stableChosenPing = chosenPing.filter((entry) => entry.pingMs! >= minimum && entry.pingMs! <= maximum);
        expect(stableChosenPing.length).toBeGreaterThan(0);
        expect(stableChosenPing.length / chosenPing.length).toBeGreaterThanOrEqual(0.6);
        expect(observed.acceptedSnapshots.some((snapshot) => snapshot.transport === 'webrtc')).toBe(true);

        const network = playerNetwork(game, match, match.hostPlayerId);
        if (network?.medianMs === null || network?.medianMs === undefined) throw new Error('Authoritative median Ping was absent.');
        const metrics = {
          tier: tier.label,
          medianPingMs: network.medianMs,
          currentPingMs: network.currentMs,
          jitterMs: network.jitterMs,
          reconciliationP95: percentile95(rollbackValues),
          acceptedSnapshots: observed.acceptedSnapshots.length
        };
        testInfo.annotations.push({ type: 'netcode-tier', description: JSON.stringify(metrics) });
        console.info(`NETCODE_TIER_METRICS ${JSON.stringify(metrics)}`);
        const roster = match.host.page.getByRole('region', { name: 'Oyuncu listesi' });
        await expect(roster.getByLabel(`Ada ağ telemetrisi: Ping ${Math.round(network.medianMs)} ms`)).toHaveCount(1);
        await expect(roster).not.toContainText(/RTT|Delay|Rollback|\bRB\b/);
        await assertNoUnexpectedErrors(game, match.host, match.guest);
      } finally {
        await match.close();
      }
    }, 60_000);
  });
}

for (const tier of tierCases) runTierCase(tier);

const reorderTest = test.extend({
  gameplayTransportOptions: [{
    impairment: {
      oneWayDelayMs: 25,
      jitterSequenceMs: [0, 2, -1, 3],
      dropEveryNthPacket: null,
      reorderWindow: 0
    },
    outboundFastReorderWindow: 1
  }, { option: true, scope: 'worker' }]
});

reorderTest('keeps the actual remote target monotonic through bounded outbound snapshot reorder', async ({ browser, game }) => {
  const match = await createTwoPlayerMatch(browser, game, undefined, {
    observeInput: true,
    waitForWebRtcBeforeStart: true
  });
  try {
    await expect.poll(() => game.harness.transportMode(match.hostPlayerId), { timeout: 10_000 }).toBe('webrtc');
    await clearObserver(match.host.page);
    await expect.poll(async () => (await observer(match.host.page)).acceptedSnapshots.length, {
      timeout: 10_000
    }).toBeGreaterThan(30);
    const observed = await observer(match.host.page);
    expect(observed.acceptedSnapshots.some((snapshot, index) =>
      index > 0 && snapshot.tick - observed.acceptedSnapshots[index - 1]!.tick > 1)).toBe(true);
    const targetTicks = observed.timelineSamples
      .map((entry) => entry.targetTick)
      .filter((entry): entry is number => typeof entry === 'number');
    expect(targetTicks.length).toBeGreaterThan(30);
    expect(targetTicks.every((value, index) => index === 0 || value >= targetTicks[index - 1]!)).toBe(true);
    expect(observed.timelineSamples.every((entry) => entry.extrapolatedFrames <= 2)).toBe(true);
    expect(observed.reconciliations.every((entry) => entry.rollbackFrames <= 10)).toBe(true);
    expect(observed.reconciliations.filter((entry) => !entry.hardSnap)
      .every((entry) => entry.correctionDistancePx < 160)).toBe(true);
    await assertNoUnexpectedErrors(game, match.host, match.guest);
  } finally {
    await match.close();
  }
}, 45_000);

const fallbackTest = test.extend({
  gameplayTransportOptions: [{
    impairment: {
      oneWayDelayMs: 25,
      jitterSequenceMs: [0, 2, -1, 3],
      dropEveryNthPacket: null,
      reorderWindow: 0
    }
  }, { option: true, scope: 'worker' }]
});

fallbackTest.describe('forced Socket.IO fallback', () => {
  fallbackTest('switches observer truth and keeps Ping as the only player-facing network field', async ({ browser, game }) => {
    const match = await createTwoPlayerMatch(browser, game, undefined, {
      observeInput: true,
      waitForWebRtcBeforeStart: true
    });
    try {
      await expect.poll(() => game.harness.transportMode(match.guestPlayerId), { timeout: 10_000 }).toBe('webrtc');
      await game.harness.dropWebRtc(match.guestPlayerId);
      await expect.poll(() => game.harness.transportMode(match.guestPlayerId), { timeout: 10_000 }).toBe('websocket');
      await expect.poll(() => playerNetwork(game, match, match.guestPlayerId)?.medianMs, { timeout: 10_000 })
        .not.toBeNull();
      await clearObserver(match.guest.page);

      const marker = await latestInputSequence(match.guest.page);
      await match.guest.page.keyboard.down('j');
      const quick = await waitForInput(match.guest.page, marker, (input) => input.quick);
      await match.guest.page.keyboard.up('j');
      await expect.poll(() => game.harness.acceptedInputs(match.guestPlayerId).find((record) =>
        record.sequence >= quick.sequence)?.source).toBe('websocket');
      await expect.poll(async () => (await observer(match.guest.page)).acceptedSnapshots.some((snapshot) =>
        snapshot.transport === 'websocket' && snapshot.lastProcessedInputSeq >= quick.sequence)).toBe(true);

      const network = playerNetwork(game, match, match.guestPlayerId);
      if (network?.medianMs === null || network?.medianMs === undefined) throw new Error('Fallback median Ping was absent.');
      const roster = match.guest.page.getByRole('region', { name: 'Oyuncu listesi' });
      await expect(roster.getByLabel(`Linus ağ telemetrisi: Ping ${Math.round(network.medianMs)} ms`)).toHaveCount(1);
      await expect(roster).not.toContainText(/RTT|Delay|Rollback|\bRB\b/);
      await assertNoUnexpectedErrors(game, match.host, match.guest);
    } finally {
      await match.close();
    }
  }, 45_000);
});
