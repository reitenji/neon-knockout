import { normalizeRoomCode } from '../shared/names.js';

export const INVITE_DISMISSED_HISTORY_STATE = Object.freeze({ neonRelayInviteDismissed: true });

export function inviteRoomCodeFromPath(pathname: string): string | null {
  const match = /^\/room\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;

  try {
    return normalizeRoomCode(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

export function buildRoomInviteUrl(baseUrl: string, roomCode: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/room/${normalizeRoomCode(roomCode)}`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function resumeRoomPreferenceFromLocation(
  pathname: string,
  historyState: unknown
): string | null | undefined {
  const invitedRoomCode = inviteRoomCodeFromPath(pathname);
  if (invitedRoomCode) return invitedRoomCode;
  if (
    typeof historyState === 'object' &&
    historyState !== null &&
    'neonRelayInviteDismissed' in historyState &&
    historyState.neonRelayInviteDismissed === true
  ) return null;
  return undefined;
}
