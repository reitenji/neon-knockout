import { z } from 'zod';
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

type CancellationState = Readonly<{
  promise: Promise<void>;
  cancel: () => void;
}>;

type Generation = {
  readonly generationId: string;
  readonly peer: RTCPeerConnection;
  readonly fast: RTCDataChannel;
  readonly reliable: RTCDataChannel;
  readonly channelsReady: ChannelReadyState;
  readonly cancellation: CancellationState;
  readonly pendingCancellations: Set<() => void>;
  socketMode: SocketMode;
  mode: 'webrtc' | SocketMode;
  matchEpoch: number | null;
  heartbeatDeadline: number | null;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  activationDeadline: number;
  activationTimer: ReturnType<typeof setTimeout> | null;
  failed: boolean;
  fallbackNotified: boolean;
};

const encoder = new TextEncoder();
const HEARTBEAT_GAP_MS = HEARTBEAT_INTERVAL_MS * MISSED_HEARTBEATS_BEFORE_FALLBACK;
const CANCELLED = Symbol('cancelled');
const finiteNumberSchema = z.number().finite();
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const nullableFiniteNumberSchema = finiteNumberSchema.nullable();
const vec2Schema = z.object({ x: finiteNumberSchema, y: finiteNumberSchema }).strict();
const scoresSchema = z.record(z.string(), nonNegativeIntegerSchema);
const roomSettingsSchema = z.object({
  durationMs: z.union([z.literal(90_000), z.literal(120_000), z.literal(180_000)]),
  knockoutTarget: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(10)])
}).strict();
const playerStatsSchema = z.object({
  knockouts: nonNegativeIntegerSchema,
  falls: nonNegativeIntegerSchema,
  landedHits: nonNegativeIntegerSchema,
  completedAttacks: nonNegativeIntegerSchema
}).strict();
const matchActionSchema = z.object({
  kind: z.enum(['QUICK_1', 'QUICK_2', 'QUICK_3', 'HEAVY', 'DASH', 'HITSTUN', 'RESPAWNING']).nullable(),
  phase: z.enum(['IDLE', 'WINDUP', 'ACTIVE', 'RECOVERY']),
  comboStep: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  chargeMs: finiteNumberSchema,
  charging: z.boolean(),
  attackId: nonNegativeIntegerSchema.nullable(),
  profileId: z.enum(['quick-1', 'quick-2', 'quick-3', 'heavy-melee']).nullable(),
  lockedFacing: vec2Schema.nullable(),
  activeProgress: finiteNumberSchema,
  hitTargetIds: z.array(z.string())
}).strict();
const matchPlayerSchema = z.object({
  playerId: z.string(),
  name: z.string(),
  chassis: z.enum(['RIFT', 'BASTION', 'PULSE', 'WRAITH']),
  accent: z.union([
    z.literal(0), z.literal(1), z.literal(2), z.literal(3),
    z.literal(4), z.literal(5), z.literal(6), z.literal(7)
  ]),
  position: vec2Schema,
  velocity: vec2Schema,
  facing: vec2Schema,
  overload: finiteNumberSchema,
  lastProcessedInputSeq: z.number().int().finite(),
  action: matchActionSchema,
  dashRemainingMs: finiteNumberSchema,
  dashCooldownRemainingMs: finiteNumberSchema,
  hitstunRemainingMs: finiteNumberSchema,
  respawnRemainingMs: finiteNumberSchema,
  protectionRemainingMs: finiteNumberSchema,
  stats: playerStatsSchema
}).strict();
const matchPulseSchema = z.object({
  projectileId: nonNegativeIntegerSchema,
  ownerPlayerId: z.string(),
  originatingAttackId: nonNegativeIntegerSchema,
  position: vec2Schema,
  velocity: vec2Schema,
  radius: finiteNumberSchema,
  remainingMs: finiteNumberSchema,
  hitTargetIds: z.array(z.string())
}).strict();
const networkStatusSchema = z.object({
  currentMs: nullableFiniteNumberSchema,
  medianMs: nullableFiniteNumberSchema,
  jitterMs: nullableFiniteNumberSchema,
  transport: z.enum(['webrtc', 'websocket', 'polling'])
}).strict();
const matchSnapshotSchema = z.object({
  tick: nonNegativeIntegerSchema,
  phase: z.enum(['COUNTDOWN', 'REGULATION', 'PAUSED', 'SUDDEN_DEATH', 'FINISHED']),
  remainingMs: finiteNumberSchema,
  platformProgress: finiteNumberSchema,
  settings: roomSettingsSchema,
  scores: scoresSchema,
  network: z.record(z.string(), networkStatusSchema),
  players: z.array(matchPlayerSchema),
  pulses: z.array(matchPulseSchema),
  winnerPlayerId: z.string().nullable(),
  resultReason: z.enum(['TARGET_SCORE', 'TIME', 'SUDDEN_DEATH', 'NO_CONTEST']).nullable()
}).strict();
const eventMetadataShape = {
  eventId: nonNegativeIntegerSchema,
  tick: nonNegativeIntegerSchema
} as const;
const hitSourceSchema = z.enum(['QUICK_1', 'QUICK_2', 'QUICK_3', 'HEAVY', 'NEON_PULSE']);
const gameEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...eventMetadataShape,
    type: z.literal('HIT'),
    attackerId: z.string(),
    targetId: z.string(),
    attack: hitSourceSchema,
    impactPosition: vec2Schema,
    impulse: finiteNumberSchema,
    resultingOverload: finiteNumberSchema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('CLASH'),
    playerIds: z.tuple([z.string(), z.string()]),
    attackIds: z.tuple([nonNegativeIntegerSchema, nonNegativeIntegerSchema]),
    impactPosition: vec2Schema,
    strength: z.enum(['QUICK', 'HEAVY'])
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('PERFECT_DODGE'),
    playerId: z.string(),
    attackerId: z.string(),
    attackId: nonNegativeIntegerSchema,
    source: hitSourceSchema,
    projectileId: nonNegativeIntegerSchema.nullable(),
    impactPosition: vec2Schema,
    refundedMs: finiteNumberSchema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('PULSE_SPAWN'),
    projectileId: nonNegativeIntegerSchema,
    ownerPlayerId: z.string(),
    originatingAttackId: nonNegativeIntegerSchema,
    position: vec2Schema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('PULSE_BREAK'),
    projectileId: nonNegativeIntegerSchema,
    breakerPlayerId: z.string(),
    breakerAttackId: nonNegativeIntegerSchema,
    impactPosition: vec2Schema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('KNOCKOUT'),
    attackerId: z.string().nullable(),
    targetId: z.string(),
    scoreAwardedTo: z.string().nullable(),
    scores: scoresSchema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('RESPAWN'),
    playerId: z.string(),
    position: vec2Schema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('PHASE'),
    phase: z.enum(['COUNTDOWN', 'REGULATION', 'PAUSED', 'SUDDEN_DEATH', 'FINISHED']),
    remainingMs: finiteNumberSchema
  }).strict(),
  z.object({
    ...eventMetadataShape,
    type: z.literal('RESULT'),
    winnerPlayerId: z.string().nullable(),
    reason: z.enum(['TARGET_SCORE', 'TIME', 'SUDDEN_DEATH', 'NO_CONTEST']),
    scores: scoresSchema
  }).strict()
]);
const matchStartedPublicationSchema = z.object({
  matchEpoch: nonNegativeIntegerSchema,
  eventCursor: nonNegativeIntegerSchema,
  snapshot: matchSnapshotSchema
}).strict();
const matchEventPublicationSchema = z.object({
  matchEpoch: nonNegativeIntegerSchema,
  event: gameEventSchema
}).strict();
const serverFastMessageSchema = z.object({
  version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
  generationId: z.string().uuid(),
  kind: z.literal('snapshot'),
  payload: matchStartedPublicationSchema
}).strict();
const serverReliableMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
    generationId: z.string().uuid(),
    kind: z.literal('started'),
    payload: matchStartedPublicationSchema
  }).strict(),
  z.object({
    version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
    generationId: z.string().uuid(),
    kind: z.literal('event'),
    payload: matchEventPublicationSchema
  }).strict(),
  z.object({
    version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
    generationId: z.string().uuid(),
    kind: z.literal('heartbeat'),
    nonce: nonNegativeIntegerSchema
  }).strict()
]);

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

function deferredCancellation(): CancellationState {
  let cancelled = false;
  let cancelPromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    cancelPromise = resolve;
  });
  return {
    promise,
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      cancelPromise();
    }
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function createGenerationId(): string | null {
  const cryptoApi: Partial<Crypto> | undefined = globalThis.crypto;
  if (cryptoApi === undefined) return null;
  if (typeof cryptoApi.randomUUID === 'function') {
    try {
      const generationId = cryptoApi.randomUUID();
      if (z.string().uuid().safeParse(generationId).success) return generationId;
    } catch {
      // Private HTTP may expose crypto without randomUUID.
    }
  }
  if (typeof cryptoApi.getRandomValues !== 'function') return null;
  try {
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

export function createGameplayTransport(options: GameplayTransportOptions): Readonly<{
  start(): Promise<void>;
  acceptMode(notice: TransportModeNotice): void;
  acceptSocketStarted(value: MatchStartedPublication): void;
  acceptSocketSnapshot(value: MatchSnapshotPublication): void;
  acceptSocketEvent(value: MatchEventPublication): void;
  sendInput(input: InputFrame): boolean;
  fallback(): void;
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

  function clearActivationDeadline(generation: Generation): void {
    if (generation.activationTimer === null) return;
    clearTimeout(generation.activationTimer);
    generation.activationTimer = null;
  }

  function detachAndClose(generation: Generation, clearCurrent: boolean): void {
    generation.failed = true;
    clearHeartbeat(generation);
    clearActivationDeadline(generation);
    generation.cancellation.cancel();
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

  function scheduleActivationDeadline(generation: Generation): void {
    const remaining = Math.max(0, generation.activationDeadline - now());
    generation.activationTimer = setTimeout(() => localFallback(generation), remaining);
  }

  async function waitForGeneration<T>(generation: Generation, operation: () => Promise<T>): Promise<T | typeof CANCELLED> {
    if (!isCurrent(generation)) return CANCELLED;
    const cancelled = generation.cancellation.promise.then((): typeof CANCELLED => CANCELLED);
    return await Promise.race<T | typeof CANCELLED>([
      operation(),
      cancelled
    ]);
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
      clearActivationDeadline(generation);
      scheduleHeartbeatGap(generation);
      return;
    }

    generation.socketMode = notice.mode;
    generation.mode = notice.mode;
    if (!generation.failed) detachAndClose(generation, false);
  }

  function acceptFastMessage(generation: Generation, event: MessageEvent): void {
    if (!isCurrent(generation) || generation.mode !== 'webrtc') return;
    const parsed = serverFastMessageSchema.safeParse(parseJson(event.data));
    if (!parsed.success || parsed.data.generationId !== generation.generationId) return;
    options.sequencer.acceptSnapshot(parsed.data.payload);
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
    const parsed = serverReliableMessageSchema.safeParse(parseJson(event.data));
    if (!parsed.success || parsed.data.generationId !== generation.generationId) return;
    const message = parsed.data;

    if (message.kind === 'heartbeat') {
      scheduleHeartbeatGap(generation);
      sendHeartbeatAck(generation, message.nonce);
      return;
    }
    if (message.kind === 'started') {
      generation.matchEpoch = message.payload.matchEpoch;
      options.sequencer.acceptStarted(message.payload);
      return;
    }
    options.sequencer.acceptEvent(message.payload);
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
    const ready = await waitForGeneration(generation, () => generation.channelsReady.promise);
    if (ready === CANCELLED || !ready || !isCurrent(generation)) return;
    const acknowledgement = await waitForGeneration(generation, () => options.activate({
      generationId: generation.generationId
    }));
    if (acknowledgement === CANCELLED || !isCurrent(generation)) return;
    if (
      !acknowledgement.ok
      || acknowledgement.data.generationId !== generation.generationId
    ) {
      localFallback(generation);
      return;
    }
    acceptModeFor(generation, acknowledgement.data);
    if (acknowledgement.data.mode !== 'webrtc') localFallback(generation);
  }

  async function start(): Promise<void> {
    let ownedGeneration: Generation | null = null;
    try {
      if (current !== null) detachAndClose(current, true);
      const createPeer = options.createPeer ?? (
        typeof RTCPeerConnection === 'undefined'
          ? null
          : () => new RTCPeerConnection({ iceServers: [] })
      );
      if (createPeer === null) return;
      const generationId = createGenerationId();
      if (generationId === null) return;
      const activationDeadline = now() + ACTIVATION_TIMEOUT_MS;

      let peer: RTCPeerConnection | null = null;
      let fast: RTCDataChannel | null = null;
      let reliable: RTCDataChannel | null = null;
      try {
        peer = createPeer();
        fast = peer.createDataChannel(FAST_CHANNEL_LABEL, { ordered: false, maxRetransmits: 0 });
        reliable = peer.createDataChannel(RELIABLE_CHANNEL_LABEL, { ordered: true });
      } catch {
        try {
          fast?.close();
        } catch {
          // A partially created channel has no remaining owner.
        }
        try {
          reliable?.close();
        } catch {
          // A partially created channel has no remaining owner.
        }
        try {
          peer?.close();
        } catch {
          // A partially created peer has no remaining owner.
        }
        return;
      }

      const generation: Generation = {
        generationId,
        peer,
        fast,
        reliable,
        channelsReady: deferredChannelReady(),
        cancellation: deferredCancellation(),
        pendingCancellations: new Set(),
        socketMode: 'websocket',
        mode: 'websocket',
        matchEpoch: null,
        heartbeatDeadline: null,
        heartbeatTimer: null,
        activationDeadline,
        activationTimer: null,
        failed: false,
        fallbackNotified: false
      };
      ownedGeneration = generation;
      current = generation;
      scheduleActivationDeadline(generation);
      bindGeneration(generation);

      const offer = await waitForGeneration(generation, () => peer.createOffer());
      if (offer === CANCELLED || !isCurrent(generation)) return;
      const localDescriptionSet = await waitForGeneration(generation, () => peer.setLocalDescription(offer));
      if (localDescriptionSet === CANCELLED || !isCurrent(generation)) return;
      const iceGathered = await waitForGeneration(generation, () => waitForIceGathering(generation));
      if (iceGathered === CANCELLED || !isCurrent(generation)) return;
      const localDescription = peer.localDescription;
      if (localDescription?.type !== 'offer' || typeof localDescription.sdp !== 'string') {
        localFallback(generation);
        return;
      }
      const acknowledgement = await waitForGeneration(generation, () => options.negotiate({
        generationId: generation.generationId,
        offer: { type: 'offer', sdp: localDescription.sdp }
      }));
      if (acknowledgement === CANCELLED || !isCurrent(generation)) return;
      if (!acknowledgement.ok || acknowledgement.data.generationId !== generation.generationId) {
        localFallback(generation);
        return;
      }
      const remoteDescriptionSet = await waitForGeneration(generation, () => peer.setRemoteDescription(
        acknowledgement.data.answer
      ));
      if (remoteDescriptionSet === CANCELLED || !isCurrent(generation)) return;
      await activateGeneration(generation);
    } catch {
      if (ownedGeneration !== null && current === ownedGeneration) localFallback(ownedGeneration);
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

  function fallback(): void {
    if (current !== null) localFallback(current);
  }

  return {
    start,
    acceptMode,
    acceptSocketStarted,
    acceptSocketSnapshot,
    acceptSocketEvent,
    sendInput,
    fallback,
    dispose
  };
}
