import { describe, expect, it } from 'vitest';
import {
  buildRoomInviteUrl,
  INVITE_DISMISSED_HISTORY_STATE,
  inviteRoomCodeFromPath,
  resumeRoomPreferenceFromLocation
} from './inviteRoute.js';

describe('inviteRoute', () => {
  it.each([
    ['/room/ab2z', 'AB2Z'],
    ['/room/AB2Z/', 'AB2Z'],
    ['/room/%41B2Z', 'AB2Z']
  ])('reads a normalized room code from %s', (pathname, expected) => {
    expect(inviteRoomCodeFromPath(pathname)).toBe(expected);
  });

  it.each([
    '/',
    '/rooms/AB2Z',
    '/room/IIII',
    '/room/AB2Z/extra',
    '/room/%E0%A4%A'
  ])('rejects the non-invite path %s', (pathname) => {
    expect(inviteRoomCodeFromPath(pathname)).toBeNull();
  });

  it('builds an exact invite URL while discarding stale path, query, and hash state', () => {
    expect(buildRoomInviteUrl('http://192.168.68.51:4173/old?debug=1#panel', ' ab2z '))
      .toBe('http://192.168.68.51:4173/room/AB2Z');
  });

  it('distinguishes an invite constraint, an explicit dismissal, and an ordinary home load', () => {
    expect(resumeRoomPreferenceFromLocation('/room/ab2z', INVITE_DISMISSED_HISTORY_STATE)).toBe('AB2Z');
    expect(resumeRoomPreferenceFromLocation('/', INVITE_DISMISSED_HISTORY_STATE)).toBeNull();
    expect(resumeRoomPreferenceFromLocation('/', null)).toBeUndefined();
  });
});
