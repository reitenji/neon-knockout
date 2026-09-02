import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_MESSAGE_LIMIT_BYTES,
  FAST_CHANNEL_MAX_BUFFERED_BYTES,
  GAMEPLAY_PROTOCOL_VERSION,
  type MatchEventPublication,
  type MatchSnapshotPublication,
  type MatchStartedPublication,
  type RtcActivationRequest,
  type RtcNegotiationRequest
} from '../../shared/gameplayTransport.js';
import { GAME } from '../../shared/constants.js';
import type { Ack, InputFrame, MatchSnapshot } from '../../shared/model.js';
import { DEFAULT_ROOM_SETTINGS } from '../../shared/roomSettings.js';
import { stepMatch } from '../../server/game/simulation.js';
import { createMatchState } from '../../server/game/state.js';
import type { createMatchPublicationSequencer } from './MatchPublicationSequencer.js';
import { createGameplayTransport } from './GameplayTransport.js';

const FIRST_GENERATION = '11111111-1111-4111-8111-111111111111';
const SECOND_GENERATION = '22222222-2222-4222-8222-222222222222';

const input = (seq = 1): InputFrame => ({
  seq,
  moveX: 1,
  moveY: 0,
  aimX: 0.5,
  aimY: -0.5,
  quick: true,
  heavy: false,
  dash: false
});

const snapshot = (tick = 1): MatchSnapshot => ({
  tick,
  phase: 'REGULATION',
  remainingMs: 10_000,
  platformProgress: 0,
  settings: { durationMs: 120_000, knockoutTarget: 5 },
  scores: {},
  network: {},
  players: [],
  pulses: [],
  winnerPlayerId: null,
  resultReason: null
});

const initialPlayerSnapshot = (): MatchSnapshot => ({
  ...snapshot(),
  scores: { 'player-1': 0 },
  network: {
    'player-1': { currentMs: null, medianMs: null, jitterMs: null, transport: 'websocket' }
  },
  players: [{
    playerId: 'player-1',
    name: 'Ada',
    chassis: 'RIFT',
    accent: 0,
    position: { x: 640, y: 360 },
    velocity: { x: 0, y: 0 },
    facing: { x: 1, y: 0 },
    overload: 0,
    lastProcessedInputSeq: -1,
    action: {
      kind: null,
      phase: 'IDLE',
      comboStep: 0,
      chargeMs: 0,
      charging: false,
      attackId: null,
      profileId: null,
      lockedFacing: null,
      activeProgress: 0,
      hitTargetIds: []
    },
    dashRemainingMs: 0,
    dashCooldownRemainingMs: 0,
    hitstunRemainingMs: 0,
    respawnRemainingMs: 0,
    protectionRemainingMs: 0,
    stats: { knockouts: 0, falls: 0, landedHits: 0, completedAttacks: 0 }
  }]
});

const started = (matchEpoch = 4): MatchStartedPublication => ({
  matchEpoch,
  eventCursor: 0,
  snapshot: snapshot()
});

const snapshotPublication = (matchEpoch = 4, tick = 2): MatchSnapshotPublication => ({
  matchEpoch,
  eventCursor: 0,
  snapshot: snapshot(tick)
});

const eventPublication = (matchEpoch = 4, eventId = 1): MatchEventPublication => ({
  matchEpoch,
  event: {
    eventId,
    tick: eventId,
    type: 'PHASE',
    phase: 'REGULATION',
    remainingMs: 9_000
  }
});

class FakeDataChannel {
  readonly send = vi.fn<(value: string) => void>();
  readonly close = vi.fn(() => {
    this.readyState = 'closed';
    this.onclose?.(new Event('close'));
  });
  readyState: RTCDataChannelState = 'connecting';
  bufferedAmount = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  open(): void {
    this.readyState = 'open';
    this.onopen?.(new Event('open'));
  }

  receive(value: unknown): void {
    this.onmessage?.(new MessageEvent('message', {
      data: typeof value === 'string' ? value : JSON.stringify(value)
    }));
  }

  fail(): void {
    this.onerror?.(new Event('error'));
  }
}

class FakePeer {
  readonly fast = new FakeDataChannel();
  readonly reliable = new FakeDataChannel();
  readonly createDataChannel = vi.fn((label: string) =>
    label === 'match-fast' ? this.fast : this.reliable
  );
  readonly createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({
    type: 'offer',
    sdp: 'offer-sdp'
  }));
  readonly setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description as RTCSessionDescription;
  });
  readonly setRemoteDescription = vi.fn(async () => undefined);
  readonly close = vi.fn(() => {
    this.connectionState = 'closed';
  });
  localDescription: RTCSessionDescription | null = null;
  iceGatheringState: RTCIceGatheringState = 'complete';
  connectionState: RTCPeerConnectionState = 'new';
  onicegatheringstatechange: ((event: Event) => void) | null = null;
  onconnectionstatechange: ((event: Event) => void) | null = null;

  completeIce(): void {
    this.iceGatheringState = 'complete';
    this.onicegatheringstatechange?.(new Event('icegatheringstatechange'));
  }

  fail(): void {
    this.connectionState = 'failed';
    this.onconnectionstatechange?.(new Event('connectionstatechange'));
  }
}

type Sequencer = ReturnType<typeof createMatchPublicationSequencer>;

function createSequencer(): Sequencer {
  return {
    acceptStarted: vi.fn(),
    acceptSnapshot: vi.fn(),
    acceptEvent: vi.fn(),
    dispose: vi.fn()
  };
}

function createHarness(overrides: Readonly<{
  peer?: FakePeer;
  createPeer?: () => RTCPeerConnection;
  negotiate?: (request: RtcNegotiationRequest) => Promise<Ack<{
    generationId: string;
    answer: Readonly<{ type: 'answer'; sdp: string }>;
  }>>;
  activate?: (request: RtcActivationRequest) => Promise<Ack<{
    generationId: string | null;
    mode: 'webrtc' | 'websocket' | 'polling';
  }>>;
}> = {}) {
  const peer = overrides.peer ?? new FakePeer();
  const sequencer = createSequencer();
  const notifyFallback = vi.fn();
  const sendFallbackInput = vi.fn();
  const negotiate = vi.fn(overrides.negotiate ?? (async (request: RtcNegotiationRequest) => ({
    ok: true as const,
    data: {
      generationId: request.generationId,
      answer: { type: 'answer' as const, sdp: 'answer-sdp' }
    }
  })));
  const activate = vi.fn(overrides.activate ?? (async (request: RtcActivationRequest) => ({
    ok: true as const,
    data: { generationId: request.generationId, mode: 'webrtc' as const }
  })));
  const controller = createGameplayTransport({
    createPeer: overrides.createPeer ?? (() => peer as unknown as RTCPeerConnection),
    negotiate,
    activate,
    notifyFallback,
    sendFallbackInput,
    sequencer
  });
  return { controller, peer, sequencer, notifyFallback, sendFallbackInput, negotiate, activate };
}

async function flushPromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function activateHarness(harness: ReturnType<typeof createHarness>): Promise<string> {
  const starting = harness.controller.start();
  await flushPromises();
  harness.peer.fast.open();
  harness.peer.reliable.open();
  await starting;
  return harness.negotiate.mock.calls[0]![0].generationId;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createGameplayTransport', () => {
  it('keeps an unsupported browser on Socket.IO without attempting negotiation', async () => {
    vi.stubGlobal('RTCPeerConnection', undefined);
    const harness = createHarness({ createPeer: undefined });
    const controller = createGameplayTransport({
      negotiate: harness.negotiate,
      activate: harness.activate,
      notifyFallback: harness.notifyFallback,
      sendFallbackInput: harness.sendFallbackInput,
      sequencer: harness.sequencer
    });

    await controller.start();

    expect(harness.negotiate).not.toHaveBeenCalled();
    expect(harness.notifyFallback).not.toHaveBeenCalled();
    expect(controller.sendInput(input())).toBe(false);
  });

  it('negotiates with a UUIDv4 from getRandomValues when randomUUID is unavailable on private HTTP', async () => {
    const getRandomValues = vi.fn((target: Uint8Array) => {
      target.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return target;
    });
    vi.stubGlobal('crypto', { getRandomValues });
    const harness = createHarness();

    const starting = harness.controller.start();
    await flushPromises();
    harness.peer.fast.open();
    harness.peer.reliable.open();
    await starting;

    expect(getRandomValues).toHaveBeenCalledOnce();
    expect(harness.negotiate.mock.calls[0]![0].generationId).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(harness.peer.close).not.toHaveBeenCalled();
  });

  it('falls back cleanly without allocating a peer when secure randomness is unavailable', async () => {
    vi.stubGlobal('crypto', {});
    const peer = new FakePeer();
    const createPeer = vi.fn(() => peer as unknown as RTCPeerConnection);
    const harness = createHarness({ peer, createPeer });

    await expect(harness.controller.start()).resolves.toBeUndefined();

    expect(createPeer).not.toHaveBeenCalled();
    expect(harness.negotiate).not.toHaveBeenCalled();
    expect(harness.controller.sendInput(input())).toBe(false);
  });

  it('uses the bound peer configuration and creates both exact channels before offering', async () => {
    const peer = new FakePeer();
    const PeerConstructor = vi.fn(function PeerConstructorMock() {
      return peer;
    });
    vi.stubGlobal('RTCPeerConnection', PeerConstructor);
    const harness = createHarness({ peer });
    const controller = createGameplayTransport({
      negotiate: harness.negotiate,
      activate: harness.activate,
      notifyFallback: harness.notifyFallback,
      sendFallbackInput: harness.sendFallbackInput,
      sequencer: harness.sequencer
    });

    const starting = controller.start();
    await flushPromises();

    expect(PeerConstructor).toHaveBeenCalledWith({ iceServers: [] });
    expect(peer.createDataChannel).toHaveBeenNthCalledWith(1, 'match-fast', {
      ordered: false,
      maxRetransmits: 0
    });
    expect(peer.createDataChannel).toHaveBeenNthCalledWith(2, 'match-reliable', {
      ordered: true
    });
    expect(peer.createDataChannel.mock.invocationCallOrder[1]).toBeLessThan(
      peer.createOffer.mock.invocationCallOrder[0]!
    );

    peer.fast.open();
    peer.reliable.open();
    await starting;
  });

  it('waits for ICE gathering completion before negotiating', async () => {
    const peer = new FakePeer();
    peer.iceGatheringState = 'gathering';
    const harness = createHarness({ peer });

    const starting = harness.controller.start();
    await flushPromises();
    expect(harness.negotiate).not.toHaveBeenCalled();

    peer.completeIce();
    await flushPromises();
    expect(harness.negotiate).toHaveBeenCalledOnce();
    peer.fast.open();
    peer.reliable.open();
    await starting;
  });

  it('stops waiting for ICE gathering at exactly three seconds', async () => {
    vi.useFakeTimers();
    const peer = new FakePeer();
    peer.iceGatheringState = 'gathering';
    const harness = createHarness({ peer });

    const starting = harness.controller.start();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2_999);
    expect(harness.negotiate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.negotiate).toHaveBeenCalledOnce();

    peer.fast.open();
    peer.reliable.open();
    await starting;
  });

  it('does not apply an answer for a different generation', async () => {
    const harness = createHarness({
      negotiate: async () => ({
        ok: true,
        data: { generationId: SECOND_GENERATION, answer: { type: 'answer', sdp: 'stale-answer' } }
      })
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(FIRST_GENERATION);

    await harness.controller.start();

    expect(harness.peer.setRemoteDescription).not.toHaveBeenCalled();
    expect(harness.notifyFallback).toHaveBeenCalledOnce();
  });

  it('activates only after both channels are open', async () => {
    const harness = createHarness();
    const starting = harness.controller.start();
    await flushPromises();

    harness.peer.fast.open();
    await flushPromises();
    expect(harness.activate).not.toHaveBeenCalled();

    harness.peer.reliable.open();
    await starting;
    expect(harness.activate).toHaveBeenCalledOnce();
  });

  it('sends current-epoch input only after the matching server mode confirmation', async () => {
    let finishActivation: ((acknowledgement: Ack<{
      generationId: string | null;
      mode: 'webrtc' | 'websocket' | 'polling';
    }>) => void) | undefined;
    const harness = createHarness({
      activate: (request) => new Promise((resolve) => {
        finishActivation = resolve;
        expect(request.generationId).toBeTruthy();
      })
    });
    const starting = harness.controller.start();
    await flushPromises();
    const generationId = harness.negotiate.mock.calls[0]![0].generationId;
    harness.peer.fast.open();
    harness.peer.reliable.open();
    harness.controller.acceptSocketStarted(started());
    await flushPromises();

    expect(harness.controller.sendInput(input())).toBe(false);
    finishActivation?.({ ok: true, data: { generationId, mode: 'webrtc' } });
    await starting;

    expect(harness.controller.sendInput(input(7))).toBe(true);
    expect(JSON.parse(harness.peer.fast.send.mock.calls[0]![0])).toEqual({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      matchEpoch: 4,
      kind: 'input',
      payload: input(7)
    });

    harness.controller.acceptMode({ generationId: SECOND_GENERATION, mode: 'websocket' });
    expect(harness.controller.sendInput(input(8))).toBe(true);
  });

  it('latches a quick edge across arbitrary newer neutral frames until an authoritative acknowledgement', async () => {
    const harness = createHarness();
    await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const neutral = (seq: number): InputFrame => ({ ...input(seq), quick: false });

    harness.controller.sendInput(input(40));
    for (let sequence = 41; sequence <= 48; sequence += 1) {
      harness.controller.sendInput(neutral(sequence));
    }

    const sentInputs = harness.peer.fast.send.mock.calls.map(([serialized]) =>
      (JSON.parse(serialized) as { payload: InputFrame }).payload
    );
    expect(sentInputs).toHaveLength(9);
    expect(sentInputs.every((frame) => frame.quick)).toBe(true);

    const state = createMatchState([
      { playerId: 'p1', name: 'Ada', accent: 0 },
      { playerId: 'p2', name: 'Linus', accent: 1 }
    ], 0, DEFAULT_ROOM_SETTINGS);
    state.phase = 'REGULATION';

    // Drop the original and every intermediate packet. The arbitrarily newer latched
    // successor still owns the edge, and a later acknowledgement permits release.
    stepMatch(state, new Map([['p1', sentInputs.at(-1)!]]), 1_000 / 60);
    harness.controller.acceptAuthoritativeSnapshot({
      ...snapshot(9),
      players: [{ ...initialPlayerSnapshot().players[0]!, playerId: 'p1', lastProcessedInputSeq: 48 }]
    }, 'p1');
    harness.controller.sendInput(neutral(49));
    const released = (JSON.parse(harness.peer.fast.send.mock.calls.at(-1)![0]) as { payload: InputFrame }).payload;
    expect(released).toMatchObject({ seq: 49, quick: false });
    stepMatch(state, new Map([['p1', released]]),
      GAME.quickCombo[0].windupMs + GAME.quickCombo[0].activeMs + GAME.quickCombo[0].recoveryMs);

    expect(state.players.p1.stats.completedAttacks).toBe(1);
    expect(state.players.p1.previousQuick).toBe(false);
  });

  it('releases quick and dash latches only after their own acknowledged sequence and permits combo cadence', async () => {
    const harness = createHarness();
    await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const neutral = (seq: number): InputFrame => ({ ...input(seq), quick: false, dash: false });

    harness.controller.sendInput({ ...neutral(50), quick: true });
    harness.controller.sendInput({ ...neutral(51), dash: true });
    harness.controller.acceptAuthoritativeSnapshot({
      ...snapshot(10),
      players: [{ ...initialPlayerSnapshot().players[0]!, lastProcessedInputSeq: 50 }]
    }, 'player-1');
    harness.controller.sendInput(neutral(52));
    let payload = (JSON.parse(harness.peer.fast.send.mock.calls.at(-1)![0]) as { payload: InputFrame }).payload;
    expect(payload).toMatchObject({ seq: 52, quick: false, dash: true });

    harness.controller.acceptAuthoritativeSnapshot({
      ...snapshot(11),
      players: [{ ...initialPlayerSnapshot().players[0]!, lastProcessedInputSeq: 52 }]
    }, 'player-1');
    harness.controller.sendInput(neutral(53));
    harness.controller.sendInput({ ...neutral(54), quick: true });
    payload = (JSON.parse(harness.peer.fast.send.mock.calls.at(-1)![0]) as { payload: InputFrame }).payload;
    expect(payload).toMatchObject({ seq: 54, quick: true, dash: false });
  });

  it('does not arm a delayed fast-channel edge when the original input falls through to Socket.IO', async () => {
    const harness = createHarness();
    await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const neutral = (seq: number): InputFrame => ({ ...input(seq), quick: false });

    harness.peer.fast.bufferedAmount = FAST_CHANNEL_MAX_BUFFERED_BYTES + 1;
    expect(harness.controller.sendInput(input(60))).toBe(false);
    harness.peer.fast.bufferedAmount = 0;
    expect(harness.controller.sendInput(neutral(61))).toBe(true);

    expect(JSON.parse(harness.peer.fast.send.mock.calls[0]![0]).payload).toEqual(neutral(61));
  });

  it('moves a pending edge wholly to Socket.IO on backpressure without allowing neutral fallthrough', async () => {
    const harness = createHarness();
    await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const neutral = (seq: number): InputFrame => ({ ...input(seq), quick: false });

    expect(harness.controller.sendInput(input(70))).toBe(true);
    harness.peer.fast.bufferedAmount = FAST_CHANNEL_MAX_BUFFERED_BYTES + 1;
    expect(harness.controller.sendInput(neutral(71))).toBe(true);
    expect(harness.sendFallbackInput).toHaveBeenCalledWith(expect.objectContaining({ seq: 71, quick: true }));
    expect(harness.notifyFallback).toHaveBeenCalledOnce();
    harness.peer.fast.bufferedAmount = 0;
    expect(harness.controller.sendInput(neutral(72))).toBe(true);
    expect(harness.sendFallbackInput).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 72, quick: true }));

    harness.controller.acceptAuthoritativeSnapshot({
      ...snapshot(12),
      players: [{ ...initialPlayerSnapshot().players[0]!, lastProcessedInputSeq: 72 }]
    }, 'player-1');
    expect(harness.controller.sendInput(neutral(73))).toBe(false);
  });

  it('expires a pending WebRTC edge into acknowledged Socket.IO latching and clears it on dispose', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const neutral = (seq: number): InputFrame => ({ ...input(seq), quick: false });

    expect(harness.controller.sendInput(input(80))).toBe(true);
    await vi.advanceTimersByTimeAsync(250);
    expect(harness.notifyFallback).toHaveBeenCalledOnce();
    expect(harness.controller.sendInput(neutral(81))).toBe(true);
    expect(harness.sendFallbackInput).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 81, quick: true }));

    harness.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.controller.sendInput(neutral(82))).toBe(false);
  });

  it('does not latch or replay a heavy release as a quick or dash action', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const heavy = { ...input(90), quick: false, heavy: true };
    const released = { ...heavy, seq: 91, heavy: false };

    expect(harness.controller.sendInput(heavy)).toBe(true);
    expect(harness.controller.sendInput(released)).toBe(true);
    harness.controller.acceptMode({ generationId, mode: 'websocket' });

    expect(harness.sendFallbackInput).not.toHaveBeenCalled();
  });

  it('rejects unopened, backpressured, oversized, and throwing fast sends', async () => {
    const unopened = createHarness();
    const unopenedStart = unopened.controller.start();
    await flushPromises();
    unopened.controller.acceptSocketStarted(started());
    expect(unopened.controller.sendInput(input())).toBe(false);
    unopened.peer.fast.open();
    unopened.peer.reliable.open();
    await unopenedStart;

    unopened.peer.fast.bufferedAmount = FAST_CHANNEL_MAX_BUFFERED_BYTES + 1;
    expect(unopened.controller.sendInput(input())).toBe(false);
    unopened.peer.fast.bufferedAmount = 0;

    const oversized = {
      ...input(),
      padding: 'x'.repeat(CLIENT_MESSAGE_LIMIT_BYTES)
    } as unknown as InputFrame;
    expect(unopened.controller.sendInput(oversized)).toBe(false);

    unopened.peer.fast.send.mockImplementationOnce(() => {
      throw new Error('channel send failed');
    });
    expect(unopened.controller.sendInput(input())).toBe(false);
    expect(unopened.notifyFallback).toHaveBeenCalledOnce();
  });

  it('routes matching publications through one sequencer and acknowledges the exact heartbeat nonce', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);
    const startPublication = started();
    const event = eventPublication();
    const nextSnapshot = snapshotPublication();

    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'started',
      payload: startPublication
    });
    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'event',
      payload: event
    });
    harness.peer.fast.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'snapshot',
      payload: nextSnapshot
    });
    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'heartbeat',
      nonce: 41
    });

    expect(harness.sequencer.acceptStarted).toHaveBeenCalledWith(startPublication);
    expect(harness.sequencer.acceptEvent).toHaveBeenCalledWith(event);
    expect(harness.sequencer.acceptSnapshot).toHaveBeenCalledWith(nextSnapshot);
    expect(JSON.parse(harness.peer.reliable.send.mock.calls[0]![0])).toEqual({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'heartbeat-ack',
      nonce: 41
    });
  });

  it('accepts a complete initial-player snapshot whose processed input sequence is minus one', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);
    const publication: MatchStartedPublication = {
      matchEpoch: 4,
      eventCursor: 0,
      snapshot: initialPlayerSnapshot()
    };

    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'started',
      payload: publication
    });

    expect(harness.sequencer.acceptStarted).toHaveBeenCalledWith(publication);
  });

  it('ignores stale-generation peer messages', async () => {
    const harness = createHarness();
    await activateHarness(harness);

    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: SECOND_GENERATION,
      kind: 'started',
      payload: started()
    });
    harness.peer.fast.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: SECOND_GENERATION,
      kind: 'snapshot',
      payload: snapshotPublication()
    });

    expect(harness.sequencer.acceptStarted).not.toHaveBeenCalled();
    expect(harness.sequencer.acceptSnapshot).not.toHaveBeenCalled();
  });

  it('falls back locally once across channel and peer failures without pausing Socket.IO input', async () => {
    const harness = createHarness();
    await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());

    harness.peer.fast.close();
    harness.peer.reliable.fail();
    harness.peer.fail();

    expect(harness.notifyFallback).toHaveBeenCalledOnce();
    expect(harness.controller.sendInput(input())).toBe(false);
  });

  it('replays the latest attack edge once when a server fallback notice wins the channel-close race', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);
    harness.controller.acceptSocketStarted(started());
    const attackEdge = input(17);

    expect(harness.controller.sendInput(attackEdge)).toBe(true);
    harness.controller.acceptMode({ generationId, mode: 'websocket' });
    harness.controller.acceptMode({ generationId, mode: 'websocket' });

    expect(harness.sendFallbackInput).toHaveBeenCalledOnce();
    expect(harness.sendFallbackInput).toHaveBeenCalledWith(attackEdge);
    expect(harness.controller.sendInput({ ...input(18), quick: false })).toBe(true);
    expect(harness.sendFallbackInput).toHaveBeenLastCalledWith(expect.objectContaining({ seq: 18, quick: true }));
  });

  it('falls back once after a three-heartbeat gap', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    await activateHarness(harness);

    await vi.advanceTimersByTimeAsync(2_999);
    expect(harness.notifyFallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.notifyFallback).toHaveBeenCalledOnce();
  });

  it('falls back once when both channels do not activate within five seconds', async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const starting = harness.controller.start();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(4_999);
    expect(harness.notifyFallback).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await starting;
    expect(harness.notifyFallback).toHaveBeenCalledOnce();
  });

  it('enforces one five-second deadline across slow negotiation and channel readiness', async () => {
    vi.useFakeTimers();
    let finishNegotiation: ((acknowledgement: Ack<{
      generationId: string;
      answer: Readonly<{ type: 'answer'; sdp: string }>;
    }>) => void) | undefined;
    let generationId = '';
    const harness = createHarness({
      negotiate: (request) => new Promise((resolve) => {
        generationId = request.generationId;
        finishNegotiation = resolve;
      })
    });
    const starting = harness.controller.start();
    await flushPromises();

    await vi.advanceTimersByTimeAsync(4_000);
    finishNegotiation?.({
      ok: true,
      data: { generationId, answer: { type: 'answer', sdp: 'slow-answer' } }
    });
    await flushPromises();
    await vi.advanceTimersByTimeAsync(999);
    expect(harness.notifyFallback).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await starting;
    expect(harness.notifyFallback).toHaveBeenCalledOnce();
  });

  it('clears the generation deadline on dispose and ignores a late activation acknowledgement', async () => {
    vi.useFakeTimers();
    let finishActivation: ((acknowledgement: Ack<{
      generationId: string | null;
      mode: 'webrtc' | 'websocket' | 'polling';
    }>) => void) | undefined;
    const harness = createHarness({
      activate: () => new Promise((resolve) => {
        finishActivation = resolve;
      })
    });
    const starting = harness.controller.start();
    await flushPromises();
    const generationId = harness.negotiate.mock.calls[0]![0].generationId;
    harness.peer.fast.open();
    harness.peer.reliable.open();
    await flushPromises();
    expect(harness.activate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(1);

    harness.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    finishActivation?.({ ok: true, data: { generationId, mode: 'webrtc' } });
    await starting;

    expect(harness.notifyFallback).not.toHaveBeenCalled();
    expect(harness.controller.sendInput(input())).toBe(false);
  });

  it('owns one deadline after replacement and ignores the replaced generation activation acknowledgement', async () => {
    vi.useFakeTimers();
    const firstPeer = new FakePeer();
    const secondPeer = new FakePeer();
    const peers = [firstPeer, secondPeer];
    const activationResolvers: Array<(acknowledgement: Ack<{
      generationId: string | null;
      mode: 'webrtc' | 'websocket' | 'polling';
    }>) => void> = [];
    const harness = createHarness({
      peer: firstPeer,
      createPeer: () => peers.shift() as unknown as RTCPeerConnection,
      activate: () => new Promise((resolve) => activationResolvers.push(resolve))
    });
    const firstStart = harness.controller.start();
    await flushPromises();
    const firstGeneration = harness.negotiate.mock.calls[0]![0].generationId;
    firstPeer.fast.open();
    firstPeer.reliable.open();
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);

    const secondStart = harness.controller.start();
    await flushPromises();
    const secondGeneration = harness.negotiate.mock.calls[1]![0].generationId;
    secondPeer.fast.open();
    secondPeer.reliable.open();
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);

    activationResolvers[0]?.({ ok: true, data: { generationId: firstGeneration, mode: 'webrtc' } });
    harness.controller.acceptSocketStarted(started());
    await firstStart;
    expect(harness.controller.sendInput(input())).toBe(false);
    expect(harness.notifyFallback).not.toHaveBeenCalled();

    harness.controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
    activationResolvers[1]?.({ ok: true, data: { generationId: secondGeneration, mode: 'webrtc' } });
    await secondStart;
  });

  it('ignores a malformed current-generation snapshot publication', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);

    harness.peer.fast.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'snapshot',
      payload: { matchEpoch: 4, eventCursor: 0, snapshot: { tick: 2 } }
    });

    expect(harness.sequencer.acceptSnapshot).not.toHaveBeenCalled();
  });

  it('ignores a malformed current-generation started publication without changing the input epoch', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);

    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'started',
      payload: { matchEpoch: 9, eventCursor: 0, snapshot: { tick: 1 } }
    });

    expect(harness.sequencer.acceptStarted).not.toHaveBeenCalled();
    expect(harness.controller.sendInput(input())).toBe(false);
  });

  it('ignores a malformed current-generation event publication', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);

    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'event',
      payload: {
        matchEpoch: 4,
        event: { eventId: 1, tick: 1, type: 'PHASE', phase: 'REGULATION' }
      }
    });

    expect(harness.sequencer.acceptEvent).not.toHaveBeenCalled();
  });

  it('ignores a malformed current-generation heartbeat envelope', async () => {
    const harness = createHarness();
    const generationId = await activateHarness(harness);

    harness.peer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'heartbeat',
      nonce: 41,
      unexpected: true
    });

    expect(harness.peer.reliable.send).not.toHaveBeenCalled();
  });

  it('keeps fallback notification idempotent when a publication gap follows a local failure', async () => {
    const harness = createHarness();
    await activateHarness(harness);

    harness.peer.fast.close();
    harness.controller.fallback();

    expect(harness.notifyFallback).toHaveBeenCalledOnce();
  });

  it('disposes the active peer and can negotiate one fresh generation while ignoring the replaced peer', async () => {
    const firstPeer = new FakePeer();
    const secondPeer = new FakePeer();
    const peers = [firstPeer, secondPeer];
    const harness = createHarness({
      peer: firstPeer,
      createPeer: () => peers.shift() as unknown as RTCPeerConnection
    });
    const firstGeneration = await activateHarness(harness);

    harness.controller.dispose();
    expect(firstPeer.close).toHaveBeenCalledOnce();
    expect(harness.controller.sendInput(input())).toBe(false);

    const restarting = harness.controller.start();
    await flushPromises();
    secondPeer.fast.open();
    secondPeer.reliable.open();
    await restarting;
    const secondGeneration = harness.negotiate.mock.calls[1]![0].generationId;

    firstPeer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: firstGeneration,
      kind: 'event',
      payload: eventPublication()
    });
    secondPeer.reliable.receive({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: secondGeneration,
      kind: 'started',
      payload: started()
    });

    expect(secondGeneration).not.toBe(firstGeneration);
    expect(harness.sequencer.acceptEvent).not.toHaveBeenCalled();
    expect(harness.sequencer.acceptStarted).toHaveBeenCalledOnce();
  });
});
