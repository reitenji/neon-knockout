import { describe, expect, it } from 'vitest';
import { DomainError } from './domainError.js';

describe('DomainError', () => {
  it('exposes only safe transport fields while remaining discriminable when thrown', () => {
    let caught: unknown;
    try {
      throw new DomainError('ROOM_FULL', 'Oda dolu.', true);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(DomainError);
    expect(Object.keys(caught as object)).toEqual(['code', 'safeMessage', 'recoverable']);
    expect('message' in (caught as object)).toBe(false);
    expect('stack' in (caught as object)).toBe(false);
  });
});
