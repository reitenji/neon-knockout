import { z } from 'zod';
import { CHASSIS } from './model.js';
import {
  type MatchEventPublication,
  type MatchSnapshotPublication,
  type MatchStartedPublication,
  type RtcActivationRequest,
  type RtcNegotiationAnswer,
  type RtcNegotiationRequest,
  type TransportModeNotice
} from './gameplayTransport.js';
import { KNOCKOUT_TARGET_OPTIONS, MATCH_DURATION_OPTIONS } from './roomSettings.js';
import type {
  Ack,
  Chassis,
  InputFrame,
  RoomState,
  ServerError,
  SessionWelcome
} from './model.js';
import { normalizeRoomCode } from './names.js';

const chassisSchema = z.enum(CHASSIS);
const emptyPayloadSchema = z.object({}).strict();
const durationSchema = z.union(MATCH_DURATION_OPTIONS.map((value) => z.literal(value)) as [
  z.ZodLiteral<(typeof MATCH_DURATION_OPTIONS)[0]>,
  z.ZodLiteral<(typeof MATCH_DURATION_OPTIONS)[1]>,
  z.ZodLiteral<(typeof MATCH_DURATION_OPTIONS)[2]>
]);
const knockoutTargetSchema = z.union(KNOCKOUT_TARGET_OPTIONS.map((value) => z.literal(value)) as [
  z.ZodLiteral<(typeof KNOCKOUT_TARGET_OPTIONS)[0]>,
  z.ZodLiteral<(typeof KNOCKOUT_TARGET_OPTIONS)[1]>,
  z.ZodLiteral<(typeof KNOCKOUT_TARGET_OPTIONS)[2]>,
  z.ZodLiteral<(typeof KNOCKOUT_TARGET_OPTIONS)[3]>
]);
const roomCodeSchema = z.string().transform((value, context) => {
  try {
    return normalizeRoomCode(value);
  } catch {
    context.addIssue({ code: 'custom', message: 'INVALID_ROOM_CODE' });
    return z.NEVER;
  }
});

export const roomCreateSchema = z.object({ name: z.string() }).strict();
export const roomJoinSchema = z.object({ name: z.string(), roomCode: roomCodeSchema }).strict();
export const roomLeaveSchema = emptyPayloadSchema;
export const sessionResumeSchema = z.object({ roomCode: roomCodeSchema, resumeToken: z.string() }).strict();
export const lobbyChassisSchema = z.object({ chassis: chassisSchema }).strict();
export const lobbyReadySchema = z.object({ ready: z.boolean() }).strict();
export const lobbySettingsSchema = z.object({
  durationMs: durationSchema,
  knockoutTarget: knockoutTargetSchema
}).strict();
export const matchStartSchema = emptyPayloadSchema;
export { matchInputSchema } from './gameplayTransport.js';
export const transportFallbackSchema = emptyPayloadSchema;
export const resultReadySchema = z.object({ ready: z.boolean() }).strict();
export const resultLobbySchema = emptyPayloadSchema;

export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;
export type RoomLeavePayload = z.infer<typeof roomLeaveSchema>;
export type SessionResumePayload = z.infer<typeof sessionResumeSchema>;
export type LobbyChassisPayload = Readonly<{ chassis: Chassis }>;
export type LobbyReadyPayload = z.infer<typeof lobbyReadySchema>;
export type LobbySettingsPayload = z.infer<typeof lobbySettingsSchema>;
export type MatchInputPayload = InputFrame;
export type ResultReadyPayload = z.infer<typeof resultReadySchema>;

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'room:join': (payload: RoomJoinPayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'room:leave': (payload: RoomLeavePayload, acknowledge: (ack: Ack<null>) => void) => void;
  'session:resume': (payload: SessionResumePayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'lobby:chassis': (payload: LobbyChassisPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'lobby:ready': (payload: LobbyReadyPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'lobby:settings': (payload: LobbySettingsPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'match:start': (payload: z.infer<typeof matchStartSchema>, acknowledge: (ack: Ack<null>) => void) => void;
  'match:input': (payload: MatchInputPayload) => void;
  'transport:negotiate': (
    payload: RtcNegotiationRequest,
    acknowledge: (ack: Ack<RtcNegotiationAnswer>) => void
  ) => void;
  'transport:activate': (
    payload: RtcActivationRequest,
    acknowledge: (ack: Ack<TransportModeNotice>) => void
  ) => void;
  'transport:fallback': (payload: Readonly<Record<string, never>>) => void;
  'result:ready': (payload: ResultReadyPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'result:lobby': (payload: z.infer<typeof resultLobbySchema>, acknowledge: (ack: Ack<null>) => void) => void;
}

export interface ServerToClientEvents {
  'session:welcome': (welcome: SessionWelcome) => void;
  'room:state': (state: RoomState) => void;
  'transport:mode': (notice: TransportModeNotice) => void;
  'match:started': (publication: MatchStartedPublication) => void;
  'match:snapshot': (publication: MatchSnapshotPublication) => void;
  'match:event': (publication: MatchEventPublication) => void;
  'network:probe': (acknowledge: () => void) => void;
  'server:error': (error: ServerError) => void;
}
