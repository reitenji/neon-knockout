const CONTROL_CHARACTER = /\p{Cc}/u;
const WHITESPACE = /\s+/gu;
const ROOM_CODE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export function normalizePlayerName(value: string): string {
  const normalized = value.normalize('NFKC');

  if (CONTROL_CHARACTER.test(normalized)) {
    throw new Error('INVALID_NAME');
  }

  const name = normalized.replace(WHITESPACE, ' ').trim();
  const visibleCodePoints = Array.from(name).filter((character) => !/\s/u.test(character));

  if (visibleCodePoints.length < 2 || visibleCodePoints.length > 16) {
    throw new Error('INVALID_NAME');
  }

  return name;
}

export function normalizeRoomCode(value: string): string {
  const roomCode = value.normalize('NFKC').trim().toUpperCase();

  if (!ROOM_CODE.test(roomCode)) {
    throw new Error('INVALID_ROOM_CODE');
  }

  return roomCode;
}
