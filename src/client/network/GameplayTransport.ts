import {
  ACTIVATION_TIMEOUT_MS,
  CLIENT_MESSAGE_LIMIT_BYTES,
  FAST_CHANNEL_LABEL,
  FAST_CHANNEL_MAX_BUFFERED_BYTES,
  GAMEPLAY_PROTOCOL_VERSION,
  HEARTBEAT_INTERVAL_MS,
  ICE_GATHER_TIMEOUT_MS,
  MISSED_HEARTBEATS_BEFORE_FALLBACK,
  RELIABLE_CHANNEL_LABEL,
  type ClientFastMessage,
  type ClientReliableMessage,
  type MatchEventPublication,
  type MatchSnapshotPublication,
  type MatchStartedPublication,
  type RtcActivationRequest,
  type RtcNegotiationAnswer,
  type RtcNegotiationRequest,
  type TransportModeNotice
} from '../../shared/gameplayTransport.js';
import type { Ack, InputFrame } from '../../shared/model.js';
import type { createMatchPublicationSequencer } from './MatchPublicationSequencer.js';

type MatchPublicationSequencer = ReturnType<typeof createMatchPublicationSequencer>;
type SocketMode = 'websocket' | 'polling';

type GameplayTransportOptions = Readonly<{
  createPeer?: () => RTCPeerConnection;
  negotiate: (request: RtcNegotiationRequest) => Promise<Ack<RtcNegotiationAnswer>>;
  activate: (request: RtcActivationRequest) => Promise<Ack<TransportModeNotice>>;
  notifyFallback: () => void;
  sequencer: MatchPublicationSequencer;
  now?: () => number;
}>;

type ChannelReadyState = Readonly<{
  promise: Promise<boolean>;
  resolve: (ready: boolean) => void;
}>;

type Generation = {
  readonly generationId: string;
  readonly peer: RTCPeerConnection;
  readonly fast: RTCDataChannel;
  readonly reliable: RTCDataChannel;
  readonly channelsReady: ChannelReadyState;
  readonly pendingCancellations: Set<() => void>;
  socketMode: SocketMode;
  mode: 'webrtc' | SocketMode;
  matchEpoch: number | null;
  heartbeatDeadline: number | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  failed: boolean;
  fallbackNotified: boolean;
};

const encoder = new TextEncoder();
const HEARTBEAT_GAP_MS = HEARTBEAT_INTERVAL_MS * MISSED_HEARTBEATS_BEFORE_FALLBACK;

function deferredChannelReady(): ChannelReadyState {
  let settled = false;
  let settle: (ready: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (ready) => {
      if (settled) return;
      settled = true;
      settle(ready);
    }
  };
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function isPublication(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function createGameplayTransport(options: GameplayTransportOptions): Readonly<{
  start(): Promise<void>;
  acceptMode(notice: TransportModeNotice): void;
  acceptSocketStarted(value: MatchStartedPublication): void;
  acceptSocketSnapshot(value: MatchSnapshotPublication): void;
  acceptSocketEvent(value: MatchEventPublication): void;
  sendInput(input: InputFrame): boolean;
  dispose(): void;
}> {
  const now = options.now ?? Date.now;
  let current: Generation | null = null;

  function isCurrent(generation: Generation): boolean {
    return current === generation && !generation.failed;
  }

  function clearHeartbeat(generation: Generation): void {
    generation.heartbeatDeadline = null;
    if (generation.heartbeatTimer !== null) {
      clearTimeout(generation.heartbeatTimer);
      generation.heartbeatTimer = null;
    }
  }

  function detachAndClose(generation: Generation, clearCurrent: boolean): void {
    generation.failed = true;
    clearHeartbeat(generation);
    for (const cancel of [...generation.pendingCancellations]) cancel();
    generation.pendingCancellations.clear();
    generation.channelsReady.resolve(false);
    generation.fast.onopen = null;
    generation.fast.onmessage = null;
    generation.fast.onclose = null;
    generation.fast.onerror = null;
    generation.reliable.onopen = null;
    generation.reliable.onmessage = null;
    generation.reliable.onclose = null;
    generation.reliable.onerror = null;
    generation.peer.onicegatheringstatechange = null;
    generation.peer.onconnectionstatechange = null;
    try {
      if (generation.fast.readyState !== 'closed') generation.fast.close();
    } catch {
      // The peer close below remains the authoritative cleanup path.
    }
    try {
      if (generation.reliable.readyState !== 'closed') generation.reliable.close();
    } catch {
      // The peer close below remains the authoritative cleanup path.
    }
    try {
      generation.peer.close();
    } catch {
      // A failed browser peer is already unusable.
    }
    if (clearCurrent && current === generation) current = null;
  }

  function localFallback(generation: Generation): void {
    if (current !== generation || generation.failed || generation.fallbackNotified) return;
    generation.mode = generation.socketMode;
    generation.fallbackNotified = true;
    detachAndClose(generation, false);
    try {
      options.notifyFallback();
    } catch {
      // Input arbitration is already on Socket.IO even if the notice cannot be emitted.
    }
  }

  function scheduleHeartbeatGap(generation: Generation): void {
    if (!isCurrent(generation) || generation.mode !== 'webrtc') return;
    clearHeartbeat(generation);
    generation.heartbeatDeadline = now() + HEARTBEAT_GAP_MS;

    const check = (): void => {
      if (!isCurrent(generation) || generation.mode !== 'webrtc' || generation.heartbeatDeadline === null) return;
      const remaining = generation.heartbeatDeadline - now();
      if (remaining <= 0) {
        localFallback(generation);
        return;
      }
      generation.heartbeatTimer = setTimeout(check, remaining);
    };
    generation.heartbeatTimer = setTimeout(check, HEARTBEAT_GAP_MS);
  }

  function acceptModeFor(generation: Generation, notice: TransportModeNotice): void {
    if (current !== generation || notice.generationId !== generation.generationId) return;
    if (notice.mode === 'webrtc') {
      if (
        generation.failed
        || generation.fast.readyState !== 'open'
        || generation.reliable.readyState !== 'open'
      ) return;
      generation.mode = 'webrtc';
      scheduleHeartbeatGap(generation);
      return;
    }

    generation.socketMode = notice.mode;
    generation.mode = notice.mode;
    if (!generation.failed) detachAndClose(generation, false);
  }

  function acceptFastMessage(generation: Generation, event: MessageEvent): void {
    if (!isCurrent(generation) || generation.mode !== 'webrtc') return;
    const message = parseObject(event.data);
    if (
      message === null
      || message.version !== GAMEPLAY_PROTOCOL_VERSION
      || message.generationId !== generation.generationId
      || message.kind !== 'snapshot'
      || !isPublication(message.payload)
    ) return;
    options.sequencer.acceptSnapshot(message.payload as MatchSnapshotPublication);
  }

  function sendHeartbeatAck(generation: Generation, nonce: number): void {
    if (generation.reliable.readyState !== 'open') {
      localFallback(generation);
      return;
    }
    const acknowledgement: ClientReliableMessage = {
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: generation.generationId,
      kind: 'heartbeat-ack',
      nonce
    };
    try {
      generation.reliable.send(JSON.stringify(acknowledgement));
    } catch {
      localFallback(generation);
    }
  }

  function acceptReliableMessage(generation: Generation, event: MessageEvent): void {
    if (!isCurrent(generation) || generation.mode !== 'webrtc') return;
    const message = parseObject(event.data);
    if (
      message === null
      || message.version !== GAMEPLAY_PROTOCOL_VERSION
      || message.generationId !== generation.generationId
      || typeof message.kind !== 'string'
    ) return;

    if (message.kind === 'heartbeat' && Number.isInteger(message.nonce) && Number(message.nonce) >= 0) {
      scheduleHeartbeatGap(generation);
      sendHeartbeatAck(generation, Number(message.nonce));
      return;
    }
    if (message.kind === 'started' && isPublication(message.payload)) {
      const publication = message.payload as MatchStartedPublication;
      if (!Number.isInteger(publication.matchEpoch) || !Number.isInteger(publication.eventCursor)) return;
      generation.matchEpoch = publication.matchEpoch;
      options.sequencer.acceptStarted(publication);
      return;
    }
    if (message.kind === 'event' && isPublication(message.payload)) {
      options.sequencer.acceptEvent(message.payload as MatchEventPublication);
    }
  }

  function bindGeneration(generation: Generation): void {
    const checkChannels = (): void => {
      if (
        isCurrent(generation)
        && generation.fast.readyState === 'open'
        && generation.reliable.readyState === 'open'
      ) generation.channelsReady.resolve(true);
    };
    generation.fast.onopen = checkChannels;
    generation.reliable.onopen = checkChannels;
    generation.fast.onmessage = (event) => acceptFastMessage(generation, event);
    generation.reliable.onmessage = (event) => acceptReliableMessage(generation, event);
    generation.fast.onclose = () => localFallback(generation);
    generation.fast.onerror = () => localFallback(generation);
    generation.reliable.onclose = () => localFallback(generation);
    generation.reliable.onerror = () => localFallback(generation);
    generation.peer.onconnectionstatechange = () => {
      if (
        generation.peer.connectionState === 'closed'
        || generation.peer.connectionState === 'failed'
        || generation.peer.connectionState === 'disconnected'
      ) localFallback(generation);
    };
    checkChannels();
  }

  function waitForIceGathering(generation: Generation): Promise<void> {
    if (generation.peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        generation.pendingCancellations.delete(finish);
        if (generation.peer.onicegatheringstatechange === onStateChange) {
          generation.peer.onicegatheringstatechange = null;
        }
        resolve();
      };
      const onStateChange = (): void => {
        if (generation.peer.iceGatheringState === 'complete') finish();
      };
      const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
      generation.pendingCancellations.add(finish);
      generation.peer.onicegatheringstatechange = onStateChange;
    });
  }

  async function activateGeneration(generation: Generation): Promise<void> {
    let activationTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<null>((resolve) => {
      activationTimer = setTimeout(() => resolve(null), ACTIVATION_TIMEOUT_MS);
    });
    const activation = generation.channelsReady.promise.then(async (ready) => {
      if (!ready || !isCurrent(generation)) return null;
      try {
        return await options.activate({ generationId: generation.generationId });
      } catch {
        return null;
      }
    });
    const acknowledgement = await Promise.race([activation, timeout]);
    if (activationTimer !== null) clearTimeout(activationTimer);
    if (!isCurrent(generation)) return;
    if (
      acknowledgement === null
      || !acknowledgement.ok
      || acknowledgement.data.generationId !== generation.generationId
    ) {
      localFallback(generation);
      return;
    }
    acceptModeFor(generation, acknowledgement.data);
    if (acknowledgement.data.mode !== 'webrtc') localFallback(generation);
  }

  async function start(): Promise<void> {
    if (current !== null) detachAndClose(current, true);
    const createPeer = options.createPeer ?? (
      typeof RTCPeerConnection === 'undefined'
        ? null
        : () => new RTCPeerConnection({ iceServers: [] })
    );
    if (createPeer === null) return;

    let peer: RTCPeerConnection;
    let fast: RTCDataChannel;
    let reliable: RTCDataChannel;
    try {
      peer = createPeer();
      fast = peer.createDataChannel(FAST_CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 });
      reliable = peer.createDataChannel(RELIABLE_CHANNEL_LABEL, { ordered: true });
    } catch {
      return;
    }

    const generation: Generation = {
      generationId: globalThis.crypto.randomUUID(),
      peer,
      fast,
      reliable,
      channelsReady: deferredChannelReady(),
      pendingCancellations: new Set(),
      socketMode: 'websocket',
      mode: 'websocket',
      matchEpoch: null,
      heartbeatDeadline: null,
      heartbeatTimer: null,
      failed: false,
      fallbackNotified: false
    };
    current = generation;
    bindGeneration(generation);

    try {
      const offer = await peer.createOffer();
      if (!isCurrent(generation)) return;
      await peer.setLocalDescription(offer);
      if (!isCurrent(generation)) return;
      await waitForIceGathering(generation);
      if (!isCurrent(generation)) return;
      const localDescription = peer.localDescription;
      if (localDescription?.type !== 'offer' || typeof localDescription.sdp !== 'string') {
        localFallback(generation);
        return;
      }
      const acknowledgement = await options.negotiate({
        generationId: generation.generationId,
        offer: { type: 'offer', sdp: localDescription.sdp }
      });
      if (!isCurrent(generation)) return;
      if (!acknowledgement.ok || acknowledgement.data.generationId !== generation.generationId) {
        localFallback(generation);
        return;
      }
      await peer.setRemoteDescription(acknowledgement.data.answer);
      if (!isCurrent(generation)) return;
      await activateGeneration(generation);
    } catch {
      localFallback(generation);
    }
  }

  function acceptMode(notice: TransportModeNotice): void {
    if (current !== null) acceptModeFor(current, notice);
  }

  function acceptSocketStarted(value: MatchStartedPublication): void {
    if (current !== null && !current.failed) current.matchEpoch = value.matchEpoch;
    options.sequencer.acceptStarted(value);
  }

  function acceptSocketSnapshot(value: MatchSnapshotPublication): void {
    options.sequencer.acceptSnapshot(value);
  }

  function acceptSocketEvent(value: MatchEventPublication): void {
    options.sequencer.acceptEvent(value);
  }

  function sendInput(input: InputFrame): boolean {
    const generation = current;
    if (
      generation === null
      || !isCurrent(generation)
      || generation.mode !== 'webrtc'
      || generation.matchEpoch === null
      || generation.fast.readyState !== 'open'
      || generation.fast.bufferedAmount > FAST_CHANNEL_MAX_BUFFERED_BYTES
    ) return false;

    const message: ClientFastMessage = {
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId: generation.generationId,
      matchEpoch: generation.matchEpoch,
      kind: 'input',
      payload: input
    };
    let serialized: string;
    try {
      serialized = JSON.stringify(message);
    } catch {
      return false;
    }
    if (encoder.encode(serialized).byteLength > CLIENT_MESSAGE_LIMIT_BYTES) return false;
    try {
      generation.fast.send(serialized);
      return true;
    } catch {
      localFallback(generation);
      return false;
    }
  }

  function dispose(): void {
    if (current === null) return;
    detachAndClose(current, true);
  }

  return {
    start,
    acceptMode,
    acceptSocketStarted,
    acceptSocketSnapshot,
    acceptSocketEvent,
    sendInput,
    dispose
  };
}
