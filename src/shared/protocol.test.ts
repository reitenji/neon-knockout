import { describe, expect, it } from 'vitest';
import { matchInputSchema, roomCreateSchema } from './protocol';

describe('shared input boundary protocol', () => {
  it('rejects client-owned position and non-boolean buttons', () => {
    expect(roomCreateSchema.parse({ name: 'Ada' })).toEqual({ name: 'Ada' });
    expect(matchInputSchema.safeParse({ seq: 2, up: true, down: false, left: false, right: false, dash: false, x: 999 }).success).toBe(false);
    expect(matchInputSchema.safeParse({ seq: 2, up: 1, down: false, left: false, right: false, dash: false }).success).toBe(false);
  });
});
