const DISPLAY_NAME_KEY = "p2p_display_name";
const CREATED_ROOMS_KEY = "p2p_created_rooms";
const HOST_ROOM_SESSION_KEY = "p2p_host_room_session";

function safeParseStringArray(rawValue: string | null): string[] {
  if (!rawValue) {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry) => typeof entry === "string");
  } catch {
    return [];
  }
}

export function createGuestDisplayName(): string {
  const suffix = Math.floor(Math.random() * 9000) + 1000;
  return `Guest-${suffix}`;
}

export function getOrCreateDisplayName(): string {
  try {
    const existing = window.localStorage.getItem(DISPLAY_NAME_KEY);
    if (existing && existing.trim().length > 0) {
      return existing;
    }
    const generated = createGuestDisplayName();
    window.localStorage.setItem(DISPLAY_NAME_KEY, generated);
    return generated;
  } catch {
    return createGuestDisplayName();
  }
}

export function saveDisplayName(displayName: string): void {
  try {
    window.localStorage.setItem(DISPLAY_NAME_KEY, displayName);
  } catch {
    // Ignore storage errors.
  }
}

export function markRoomAsCreated(roomId: string): void {
  try {
    const rooms = new Set(safeParseStringArray(window.localStorage.getItem(CREATED_ROOMS_KEY)));
    rooms.add(roomId);
    window.localStorage.setItem(CREATED_ROOMS_KEY, JSON.stringify([...rooms]));
  } catch {
    // Ignore storage errors.
  }
}

export function isRoomCreatedByThisBrowser(roomId: string): boolean {
  try {
    const rooms = safeParseStringArray(window.localStorage.getItem(CREATED_ROOMS_KEY));
    return rooms.includes(roomId);
  } catch {
    return false;
  }
}

export function getHostRoomForSession(): string | null {
  try {
    return window.sessionStorage.getItem(HOST_ROOM_SESSION_KEY);
  } catch {
    return null;
  }
}

export function setHostRoomForSession(roomId: string): void {
  try {
    window.sessionStorage.setItem(HOST_ROOM_SESSION_KEY, roomId);
  } catch {
    // Ignore storage errors.
  }
}

export function clearHostRoomForSession(roomId?: string): void {
  try {
    const active = window.sessionStorage.getItem(HOST_ROOM_SESSION_KEY);
    if (!roomId || active === roomId) {
      window.sessionStorage.removeItem(HOST_ROOM_SESSION_KEY);
    }
  } catch {
    // Ignore storage errors.
  }
}
