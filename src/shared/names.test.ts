import { describe, expect, it } from 'vitest';
import { normalizePlayerName, normalizeRoomCode } from './names';

describe('shared input boundary names', () => {
  it('normalizes visible names and rejects invalid lengths', () => {
    expect(normalizePlayerName('  Ada   Lovelace  ')).toBe('Ada Lovelace');
    expect(() => normalizePlayerName('A')).toThrow('INVALID_NAME');
    expect(() => normalizePlayerName(`Ada\u0000<script>`)).toThrow('INVALID_NAME');
  });

  it('normalizes unambiguous room codes', () => {
    expect(normalizeRoomCode(' ab2z ')).toBe('AB2Z');
    expect(() => normalizeRoomCode('O0I1')).toThrow('INVALID_ROOM_CODE');
  });
});
