export type AppRoute =
  | {
      mode: "advanced";
      roomId: null;
    }
  | {
      mode: "quick";
      roomId: string | null;
    };

const QUICK_HASH_PREFIX = "#/quick";
const ADVANCED_HASH = "#/advanced";
const QUICK_ROOM_PATTERN = /^[a-z0-9](?:[a-z0-9-]{4,62}[a-z0-9])$/u;
const QUICK_ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const QUICK_ROOM_SUFFIX_LENGTH = 14;

function randomChar(): string {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.getRandomValues) {
    const data = new Uint8Array(1);
    cryptoProvider.getRandomValues(data);
    return QUICK_ROOM_ALPHABET[data[0] % QUICK_ROOM_ALPHABET.length];
  }
  const index = Math.floor(Math.random() * QUICK_ROOM_ALPHABET.length);
  return QUICK_ROOM_ALPHABET[index];
}

export function sanitizeQuickRoomId(rawValue: string): string | null {
  const normalized = rawValue.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/u.test(normalized)) {
    return null;
  }
  if (!QUICK_ROOM_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function createQuickRoomId(): string {
  let suffix = "";
  for (let index = 0; index < QUICK_ROOM_SUFFIX_LENGTH; index += 1) {
    suffix += randomChar();
  }
  return `meet-${suffix}`;
}

export function buildHashForAdvanced(): string {
  return ADVANCED_HASH;
}

export function buildHashForQuick(roomId?: string | null): string {
  if (!roomId) {
    return QUICK_HASH_PREFIX;
  }
  return `${QUICK_HASH_PREFIX}/${roomId}`;
}

export function parseAppRouteFromHash(hashValue: string): AppRoute {
  const cleanedHash = hashValue.trim();
  if (!cleanedHash || cleanedHash === "#" || cleanedHash === "#/") {
    return {
      mode: "quick",
      roomId: null,
    };
  }

  if (!cleanedHash.startsWith(QUICK_HASH_PREFIX)) {
    return {
      mode: "advanced",
      roomId: null,
    };
  }

  const roomPart = cleanedHash.slice(QUICK_HASH_PREFIX.length + 1);
  if (!roomPart) {
    return {
      mode: "quick",
      roomId: null,
    };
  }

  let decodedRoom = "";
  try {
    decodedRoom = decodeURIComponent(roomPart);
  } catch {
    decodedRoom = "";
  }
  const roomId = sanitizeQuickRoomId(decodedRoom);
  return {
    mode: "quick",
    roomId,
  };
}

export function buildQuickInviteUrl(
  roomId: string,
  pageLocation: {
    origin: string;
    pathname: string;
    search: string;
  },
): string {
  return `${pageLocation.origin}${pageLocation.pathname}${pageLocation.search}${buildHashForQuick(
    roomId,
  )}`;
}
