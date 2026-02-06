export const ROOM_JOIN_ERROR = {
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  ROOM_EXPIRED: "ROOM_EXPIRED",
  ROOM_FULL: "ROOM_FULL",
  ROLE_TAKEN: "ROLE_TAKEN",
  INVALID_ROLE: "INVALID_ROLE",
} as const;

export type RoomJoinErrorCode =
  (typeof ROOM_JOIN_ERROR)[keyof typeof ROOM_JOIN_ERROR];

export type ParticipantRole = "host" | "guest";

export interface RoomRecord {
  roomId: string;
  createdAt: number;
  expiresAt: number;
  hostPeerId: string | null;
  guestPeerId: string | null;
}

export interface RoomStatusResponse {
  roomId: string;
  status: "open";
  expiresAt: number;
  participantCount: number;
}

export interface RoomCreateResponse {
  roomId: string;
  joinUrl: string;
  expiresAt: number;
}

export interface TurnCredentialsResponse {
  urls: string[];
  username: string;
  credential: string;
  ttlSeconds: number;
}

export interface SignalingMessage {
  type:
    | "offer"
    | "answer"
    | "ice-candidate"
    | "chat"
    | "peer-joined"
    | "peer-left"
    | "error"
    | "heartbeat"
    | "session-joined";
  payload?: unknown;
  fromPeerId?: string;
  toPeerId?: string;
  roomId?: string;
  timestamp?: number;
}
