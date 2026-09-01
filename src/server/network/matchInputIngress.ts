import { randomUUID } from 'node:crypto';
import { GAME } from '../../shared/constants.js';
import type { ServerError } from '../../shared/model.js';
import { matchInputSchema } from '../../shared/protocol.js';
import { DomainError } from '../rooms/domainError.js';
import type { RoomManager } from '../rooms/roomManager.js';

type ErrorLogger = Pick<Console, 'error'>;

type Bucket = {
  tokens: number;
  updatedAt: number;
};

export type MatchInputIngressResult =
  | Readonly<{ status: 'accepted' }>
  | Readonly<{ status: 'dropped' }>
  | Readonly<{ status: 'error'; error: ServerError }>;

export type MatchInputIngress = Readonly<{
  accept(payload: unknown): MatchInputIngressResult;
  reset(): void;
}>;

type MatchInputIngressOptions = Readonly<{
  connectionId: string;
  rooms: RoomManager;
  now: () => number;
  logger: ErrorLogger;
}>;

const INVALID_PAYLOAD: ServerError = {
  code: 'INVALID_PAYLOAD',
  message: 'İstek verisi geçersiz.',
  recoverable: true
};

const INTERNAL_ERROR: ServerError = {
  code: 'INTERNAL_ERROR',
  message: 'Beklenmeyen bir sunucu hatası oluştu.',
  recoverable: true
};

function domainError(error: DomainError): ServerError {
  return {
    code: error.code,
    message: error.safeMessage,
    recoverable: error.recoverable
  };
}

export function createMatchInputIngress(options: MatchInputIngressOptions): MatchInputIngress {
  const { connectionId, rooms, now, logger } = options;
  let inputBucket: Bucket;
  let acceptedInputBucket: Bucket;
  let lastAcceptedInputSeq: number;

  const reset = (): void => {
    const timestamp = now();
    inputBucket = { tokens: GAME.inputRateLimitPerSecond, updatedAt: timestamp };
    acceptedInputBucket = { tokens: GAME.maxInputFramesPerSecond, updatedAt: timestamp };
    lastAcceptedInputSeq = -1;
  };
  const consume = (bucket: Bucket, ratePerSecond: number): boolean => {
    const timestamp = now();
    const elapsedMs = Math.max(0, timestamp - bucket.updatedAt);
    bucket.tokens = Math.min(ratePerSecond, bucket.tokens + (elapsedMs / 1_000) * ratePerSecond);
    bucket.updatedAt = timestamp;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
  const accept = (payload: unknown): MatchInputIngressResult => {
    const parsed = matchInputSchema.safeParse(payload);
    if (!parsed.success) return { status: 'error', error: INVALID_PAYLOAD };
    if (rooms.isInResult(connectionId)) return { status: 'dropped' };
    if (!consume(inputBucket, GAME.inputRateLimitPerSecond)) return { status: 'dropped' };
    if (parsed.data.seq <= lastAcceptedInputSeq) return { status: 'dropped' };
    if (!consume(acceptedInputBucket, GAME.maxInputFramesPerSecond)) return { status: 'dropped' };
    try {
      rooms.applyInput(connectionId, parsed.data);
      lastAcceptedInputSeq = parsed.data.seq;
      return { status: 'accepted' };
    } catch (error) {
      if (error instanceof DomainError) return { status: 'error', error: domainError(error) };
      const correlationId = randomUUID();
      logger.error(`[${correlationId}] Unexpected Socket.IO input failure`, error);
      return { status: 'error', error: INTERNAL_ERROR };
    }
  };

  reset();
  return { accept, reset };
}
