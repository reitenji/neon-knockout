import { describe, expect, it } from 'vitest';
import type { InputFrame } from './model.js';
import {
  CLIENT_MESSAGE_LIMIT_BYTES,
  FAST_CHANNEL_LABEL,
  GAMEPLAY_PROTOCOL_VERSION,
  RELIABLE_CHANNEL_LABEL,
  SDP_LIMIT_BYTES,
  clientFastMessageSchema,
  clientReliableMessageSchema,
  rtcActivationRequestSchema,
  rtcNegotiationRequestSchema
} from './gameplayTransport.js';

const generationId = '2f8ca1f2-7e6e-4ea7-90e2-e6a955892574';
const input: InputFrame = {
  seq: 7,
  moveX: 1,
  moveY: 0,
  aimX: 0.6,
  aimY: -0.8,
  quick: true,
  heavy: false,
  dash: false
};

describe('shared WebRTC gameplay transport contract', () => {
  it('accepts an SDP offer at the 128 KiB byte boundary', () => {
    expect(rtcNegotiationRequestSchema.safeParse({
      generationId,
      offer: { type: 'offer', sdp: 'x'.repeat(SDP_LIMIT_BYTES) }
    }).success).toBe(true);
  });

  it('rejects an SDP offer larger than 128 KiB in UTF-8 bytes', () => {
    expect(rtcNegotiationRequestSchema.safeParse({
      generationId,
      offer: { type: 'offer', sdp: 'x'.repeat(SDP_LIMIT_BYTES + 1) }
    }).success).toBe(false);
    expect(rtcNegotiationRequestSchema.safeParse({
      generationId,
      offer: { type: 'offer', sdp: 'é'.repeat((SDP_LIMIT_BYTES / 2) + 1) }
    }).success).toBe(false);
  });

  it('requires a strict UUID negotiation request bound to the current socket', () => {
    expect(rtcNegotiationRequestSchema.safeParse({
      generationId: 'not-a-uuid',
      offer: { type: 'offer', sdp: 'v=0' }
    }).success).toBe(false);
    expect(rtcNegotiationRequestSchema.safeParse({
      generationId,
      targetPlayerId: 'other-player',
      offer: { type: 'offer', sdp: 'v=0' }
    }).success).toBe(false);
    expect(rtcActivationRequestSchema.safeParse({ generationId, ignored: true }).success).toBe(false);
  });

  it('rejects a fast channel message above 8 KiB before parsing it', () => {
    const oversized = 'x'.repeat(CLIENT_MESSAGE_LIMIT_BYTES + 1);

    expect(clientFastMessageSchema.safeParse(oversized).success).toBe(false);
  });

  it('accepts only version 1 match-fast input messages', () => {
    const serialized = JSON.stringify({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      matchEpoch: 4,
      kind: 'input',
      payload: input
    });

    expect(FAST_CHANNEL_LABEL).toBe('match-fast');
    expect(clientFastMessageSchema.safeParse(serialized).success).toBe(true);
    expect(clientFastMessageSchema.safeParse(JSON.stringify({
      version: 2,
      generationId,
      matchEpoch: 4,
      kind: 'input',
      payload: input
    })).success).toBe(false);
  });

  it('accepts only version 1 match-reliable heartbeat acknowledgements', () => {
    expect(RELIABLE_CHANNEL_LABEL).toBe('match-reliable');
    expect(clientReliableMessageSchema.safeParse(JSON.stringify({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'heartbeat-ack',
      nonce: 8
    })).success).toBe(true);
    expect(clientReliableMessageSchema.safeParse(JSON.stringify({
      version: GAMEPLAY_PROTOCOL_VERSION,
      generationId,
      kind: 'heartbeat',
      nonce: 8
    })).success).toBe(false);
  });
});
