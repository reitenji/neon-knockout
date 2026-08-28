export type DomainErrorCode =
  | 'ALREADY_IN_ROOM'
  | 'INVALID_NAME'
  | 'INVALID_PHASE'
  | 'INVALID_RESUME_TOKEN'
  | 'INVALID_ROOM_CODE'
  | 'MATCH_IN_PROGRESS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'PLAYER_NOT_FOUND'
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'UNBALANCED_TEAM';

export class DomainError {
  constructor(
    readonly code: DomainErrorCode,
    readonly safeMessage: string,
    readonly recoverable: boolean
  ) {}
}
