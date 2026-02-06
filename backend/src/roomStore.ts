import { randomBytes } from "node:crypto";
import {
  ROOM_JOIN_ERROR,
  type ParticipantRole,
  type RoomJoinErrorCode,
  type RoomRecord,
} from "./types.js";

const ROOM_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ROOM_SUFFIX_LENGTH = 14;

export const ROOM_ID_PATTERN =
  /^meet-[a-z0-9](?:[a-z0-9-]{10,62}[a-z0-9])$/u;

function randomChar(): string {
  const byte = randomBytes(1)[0];
  return ROOM_ALPHABET[byte % ROOM_ALPHABET.length];
}

export function createRoomId(): string {
  let suffix = "";
  for (let index = 0; index < ROOM_SUFFIX_LENGTH; index += 1) {
    suffix += randomChar();
  }
  return `meet-${suffix}`;
}

export function sanitizeRoomId(rawValue: string): string | null {
  const normalized = rawValue.trim().toLowerCase();
  if (!ROOM_ID_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

interface JoinOk {
  ok: true;
  room: RoomRecord;
}

interface JoinFailed {
  ok: false;
  code: RoomJoinErrorCode;
}

export type JoinResult = JoinOk | JoinFailed;

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();

  private readonly roomTtlMs: number;

  constructor(roomTtlMs: number) {
    this.roomTtlMs = roomTtlMs;
  }

  createRoom(now = Date.now()): RoomRecord {
    let roomId = createRoomId();
    while (this.rooms.has(roomId)) {
      roomId = createRoomId();
    }

    const room: RoomRecord = {
      roomId,
      createdAt: now,
      expiresAt: now + this.roomTtlMs,
      hostPeerId: null,
      guestPeerId: null,
    };
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId: string): RoomRecord | null {
    return this.rooms.get(roomId) ?? null;
  }

  getActiveRoom(roomId: string, now = Date.now()): RoomRecord | null {
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    if (room.expiresAt <= now) {
      this.rooms.delete(roomId);
      return null;
    }
    return room;
  }

  validateJoin(
    roomId: string,
    peerId: string,
    role: ParticipantRole,
    now = Date.now(),
  ): JoinResult {
    const room = this.rooms.get(roomId);
    if (!room) {
      return {
        ok: false,
        code: ROOM_JOIN_ERROR.ROOM_NOT_FOUND,
      };
    }

    if (room.expiresAt <= now) {
      this.rooms.delete(roomId);
      return {
        ok: false,
        code: ROOM_JOIN_ERROR.ROOM_EXPIRED,
      };
    }

    if (role !== "host" && role !== "guest") {
      return {
        ok: false,
        code: ROOM_JOIN_ERROR.INVALID_ROLE,
      };
    }

    if (role === "host" && room.hostPeerId && room.hostPeerId !== peerId) {
      return {
        ok: false,
        code: ROOM_JOIN_ERROR.ROLE_TAKEN,
      };
    }

    if (role === "guest" && room.guestPeerId && room.guestPeerId !== peerId) {
      return {
        ok: false,
        code: ROOM_JOIN_ERROR.ROLE_TAKEN,
      };
    }

    const currentCount = this.participantCount(roomId);
    const isExistingPeer = room.hostPeerId === peerId || room.guestPeerId === peerId;
    if (currentCount >= 2 && !isExistingPeer) {
      return {
        ok: false,
        code: ROOM_JOIN_ERROR.ROOM_FULL,
      };
    }

    return {
      ok: true,
      room,
    };
  }

  addParticipant(roomId: string, peerId: string, role: ParticipantRole): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }
    if (role === "host") {
      room.hostPeerId = peerId;
      return;
    }
    room.guestPeerId = peerId;
  }

  removeParticipant(roomId: string, peerId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) {
      return;
    }

    if (room.hostPeerId === peerId) {
      room.hostPeerId = null;
    }
    if (room.guestPeerId === peerId) {
      room.guestPeerId = null;
    }
  }

  participantCount(roomId: string): number {
    const room = this.rooms.get(roomId);
    if (!room) {
      return 0;
    }

    let total = 0;
    if (room.hostPeerId) {
      total += 1;
    }
    if (room.guestPeerId) {
      total += 1;
    }
    return total;
  }

  cleanupExpired(now = Date.now()): string[] {
    const removed: string[] = [];
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.expiresAt <= now) {
        this.rooms.delete(roomId);
        removed.push(roomId);
      }
    }
    return removed;
  }

  clearAll(): void {
    this.rooms.clear();
  }
}
