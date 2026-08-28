import { z } from 'zod';
import type {
  Ack,
  Chassis,
  GameEvent,
  MatchSnapshot,
  RoomState,
  ServerError,
  SessionWelcome
} from './model.js';
import type { CombatInputFrame } from './model.js';
import { normalizeRoomCode } from './names.js';

const chassisSchema = z.enum(['RIFT', 'BASTION', 'PULSE', 'WRAITH']);
const emptyPayloadSchema = z.object({}).strict();
const finiteAxisSchema = z.number().finite().min(-1).max(1);
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
export const sessionResumeSchema = z.object({ roomCode: roomCodeSchema, resumeToken: z.string() }).strict();
export const lobbyChassisSchema = z.object({ chassis: chassisSchema }).strict();
export const lobbyReadySchema = z.object({ ready: z.boolean() }).strict();
export const matchStartSchema = emptyPayloadSchema;
export const matchInputSchema = z
  .object({
    seq: z.number().int().nonnegative(),
    moveX: finiteAxisSchema,
    moveY: finiteAxisSchema,
    aimX: z.number().finite(),
    aimY: z.number().finite(),
    quick: z.boolean(),
    heavy: z.boolean(),
    dash: z.boolean()
  })
  .strict();
export const resultReadySchema = z.object({ ready: z.boolean() }).strict();
export const resultLobbySchema = emptyPayloadSchema;

export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;
export type SessionResumePayload = z.infer<typeof sessionResumeSchema>;
export type LobbyChassisPayload = Readonly<{ chassis: Chassis }>;
export type LobbyReadyPayload = z.infer<typeof lobbyReadySchema>;
export type MatchInputPayload = CombatInputFrame;
export type ResultReadyPayload = z.infer<typeof resultReadySchema>;

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'room:join': (payload: RoomJoinPayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'session:resume': (payload: SessionResumePayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'lobby:chassis': (payload: LobbyChassisPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'lobby:ready': (payload: LobbyReadyPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'match:start': (payload: z.infer<typeof matchStartSchema>, acknowledge: (ack: Ack<null>) => void) => void;
  'match:input': (payload: MatchInputPayload) => void;
  'result:ready': (payload: ResultReadyPayload, acknowledge: (ack: Ack<null>) => void) => void;
  'result:lobby': (payload: z.infer<typeof resultLobbySchema>, acknowledge: (ack: Ack<null>) => void) => void;
}

export interface ServerToClientEvents {
  'session:welcome': (welcome: SessionWelcome) => void;
  'room:state': (state: RoomState) => void;
  'match:started': (snapshot: MatchSnapshot) => void;
  'match:snapshot': (snapshot: MatchSnapshot) => void;
  'match:event': (event: GameEvent) => void;
  'server:error': (error: ServerError) => void;
}
