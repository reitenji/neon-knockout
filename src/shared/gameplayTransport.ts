import { z } from 'zod';
import type { GameEvent, InputFrame, MatchSnapshot } from './model.js';

export const GAMEPLAY_PROTOCOL_VERSION = 1 as const;
export const FAST_CHANNEL_LABEL = 'match-fast';
export const RELIABLE_CHANNEL_LABEL = 'match-reliable';
export const CLIENT_MESSAGE_LIMIT_BYTES = 8 * 1024;
export const SDP_LIMIT_BYTES = 128 * 1024;
export const FAST_CHANNEL_MAX_BUFFERED_BYTES = 256 * 1024;
export const ICE_GATHER_TIMEOUT_MS = 3_000;
export const ACTIVATION_TIMEOUT_MS = 5_000;
export const HEARTBEAT_INTERVAL_MS = 1_000;
export const MISSED_HEARTBEATS_BEFORE_FALLBACK = 3;
export const RTT_FRESHNESS_MS = 6_000;
export const RTT_SAMPLE_LIMIT = 5;

const textEncoder = new TextEncoder();
const finiteNonNegativeIntegerSchema = z.number().finite().int().nonnegative();
const finiteAxisSchema = z.number().finite().min(-1).max(1);
const generationIdSchema = z.string().uuid();

function hasAtMostUtf8Bytes(value: string, limit: number): boolean {
  return textEncoder.encode(value).byteLength <= limit;
}

function utf8StringSchema(limit: number) {
  return z.string().superRefine((value, context) => {
    if (!hasAtMostUtf8Bytes(value, limit)) {
      context.addIssue({ code: 'custom', message: 'MESSAGE_TOO_LARGE' });
    }
  });
}

function serializedClientMessageSchema<T extends z.ZodType>(messageSchema: T) {
  return z.string().transform((value, context) => {
    if (!hasAtMostUtf8Bytes(value, CLIENT_MESSAGE_LIMIT_BYTES)) {
      context.addIssue({ code: 'custom', message: 'MESSAGE_TOO_LARGE' });
      return z.NEVER;
    }

    try {
      return JSON.parse(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'INVALID_JSON' });
      return z.NEVER;
    }
  }).pipe(messageSchema);
}

export const matchInputSchema = z
  .object({
    seq: finiteNonNegativeIntegerSchema,
    moveX: finiteAxisSchema,
    moveY: finiteAxisSchema,
    aimX: finiteAxisSchema,
    aimY: finiteAxisSchema,
    quick: z.boolean(),
    heavy: z.boolean(),
    dash: z.boolean()
  })
  .strict();

const rtcOfferSchema = z.object({
  type: z.literal('offer'),
  sdp: utf8StringSchema(SDP_LIMIT_BYTES)
}).strict();

const clientFastMessageObjectSchema = z.discriminatedUnion('kind', [
  z.object({
    version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
    generationId: generationIdSchema,
    matchEpoch: finiteNonNegativeIntegerSchema,
    kind: z.literal('input'),
    payload: matchInputSchema
  }).strict(),
  z.object({
    version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
    generationId: generationIdSchema,
    kind: z.literal('probe-ack'),
    nonce: finiteNonNegativeIntegerSchema
  }).strict()
]);

const clientReliableMessageObjectSchema = z.object({
  version: z.literal(GAMEPLAY_PROTOCOL_VERSION),
  generationId: generationIdSchema,
  kind: z.literal('heartbeat-ack'),
  nonce: finiteNonNegativeIntegerSchema
}).strict();

export const rtcNegotiationRequestSchema = z.object({
  generationId: generationIdSchema,
  offer: rtcOfferSchema
}).strict();

export const rtcActivationRequestSchema = z.object({ generationId: generationIdSchema }).strict();

export const clientFastMessageSchema = serializedClientMessageSchema(clientFastMessageObjectSchema);
export const clientReliableMessageSchema = serializedClientMessageSchema(clientReliableMessageObjectSchema);

export type GameplayTransportMode = 'webrtc' | 'websocket' | 'polling';

export type MatchStartedPublication = Readonly<{
  matchEpoch: number;
  eventCursor: number;
  snapshot: MatchSnapshot;
}>;

export type MatchSnapshotPublication = MatchStartedPublication;

export type MatchEventPublication = Readonly<{
  matchEpoch: number;
  event: GameEvent;
}>;

export type RtcOffer = Readonly<{ type: 'offer'; sdp: string }>;
export type RtcAnswer = Readonly<{ type: 'answer'; sdp: string }>;
export type RtcNegotiationRequest = Readonly<{ generationId: string; offer: RtcOffer }>;
export type RtcNegotiationAnswer = Readonly<{ generationId: string; answer: RtcAnswer }>;
export type RtcActivationRequest = Readonly<{ generationId: string }>;
export type TransportModeNotice = Readonly<{ generationId: string | null; mode: GameplayTransportMode }>;

export type ClientFastMessage =
  | Readonly<{
    version: 1;
    generationId: string;
    matchEpoch: number;
    kind: 'input';
    payload: InputFrame;
  }>
  | Readonly<{
    version: 1;
    generationId: string;
    kind: 'probe-ack';
    nonce: number;
  }>;

export type ServerFastMessage =
  | Readonly<{
    version: 1;
    generationId: string;
    kind: 'snapshot';
    payload: MatchSnapshotPublication;
  }>
  | Readonly<{
    version: 1;
    generationId: string;
    kind: 'probe';
    nonce: number;
  }>;

export type ClientReliableMessage = Readonly<{
  version: 1;
  generationId: string;
  kind: 'heartbeat-ack';
  nonce: number;
}>;

export type ServerReliableMessage =
  | Readonly<{ version: 1; generationId: string; kind: 'started'; payload: MatchStartedPublication }>
  | Readonly<{ version: 1; generationId: string; kind: 'event'; payload: MatchEventPublication }>
  | Readonly<{ version: 1; generationId: string; kind: 'heartbeat'; nonce: number }>;
