import { z } from 'zod';
import type { Ack, GameEvent, InputFrame, MatchSnapshot, RoomState, ServerError, SessionWelcome, Team } from './model.js';
import { normalizeRoomCode } from './names.js';

const teamSchema = z.enum(['CYAN', 'AMBER']);
const emptyPayloadSchema = z.object({}).strict();
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
export const lobbyTeamSchema = z.object({ team: teamSchema }).strict();
export const lobbyReadySchema = z.object({ ready: z.boolean() }).strict();
export const matchStartSchema = emptyPayloadSchema;
export const matchInputSchema = z.object({
  seq: z.number().int().nonnegative(),
  up: z.boolean(),
  down: z.boolean(),
  left: z.boolean(),
  right: z.boolean(),
  dash: z.boolean()
}).strict();
export const resultReadySchema = z.object({ ready: z.boolean() }).strict();
export const resultLobbySchema = emptyPayloadSchema;

export type RoomCreatePayload = z.infer<typeof roomCreateSchema>;
export type RoomJoinPayload = z.infer<typeof roomJoinSchema>;
export type SessionResumePayload = z.infer<typeof sessionResumeSchema>;
export type LobbyTeamPayload = Readonly<{ team: Team }>;
export type LobbyReadyPayload = z.infer<typeof lobbyReadySchema>;
export type MatchInputPayload = InputFrame;
export type ResultReadyPayload = z.infer<typeof resultReadySchema>;

export interface ClientToServerEvents {
  'room:create': (payload: RoomCreatePayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'room:join': (payload: RoomJoinPayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'session:resume': (payload: SessionResumePayload, acknowledge: (ack: Ack<SessionWelcome>) => void) => void;
  'lobby:team': (payload: LobbyTeamPayload, acknowledge: (ack: Ack<null>) => void) => void;
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
