export type SignalEnvelopeType = "offer" | "answer";

export type SenderRole = "host" | "joiner";

export type MediaTarget = "1080p30";

export interface SignalEnvelopeV1 {
  version: "1";
  type: SignalEnvelopeType;
  roomCode: string;
  createdAt: number;
  expiresAt: number;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
  senderRole: SenderRole;
}

export interface OfferPayloadV1 {
  sessionId: string;
  sdpOffer: string;
  iceCandidates: RTCIceCandidateInit[];
  mediaTarget: MediaTarget;
  clientInfo: string;
}

export interface AnswerPayloadV1 {
  sessionId: string;
  sdpAnswer: string;
  iceCandidates: RTCIceCandidateInit[];
  acceptedMediaTarget: MediaTarget;
  clientInfo: string;
}

export interface DiagEventV1 {
  timestamp: number;
  peerId: string;
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  bitrateKbps: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  audioLevel: number;
  eventType: string;
  message: string;
}

export const QualityState = {
  HD_1080: "HD_1080",
  HD_720: "HD_720",
  SD_480: "SD_480",
  RECOVERING: "RECOVERING",
} as const;

export type QualityState = (typeof QualityState)[keyof typeof QualityState];

export const CallFailureCode = {
  PASS_PHRASE_MISMATCH: "PASS_PHRASE_MISMATCH",
  EXPIRED_PACKET: "EXPIRED_PACKET",
  NAT_BLOCKED: "NAT_BLOCKED",
  DEVICE_DENIED: "DEVICE_DENIED",
  MEDIA_UNSUPPORTED: "MEDIA_UNSUPPORTED",
  CONNECTION_TIMEOUT: "CONNECTION_TIMEOUT",
} as const;

export type CallFailureCode = (typeof CallFailureCode)[keyof typeof CallFailureCode];

export interface QualitySnapshot {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
}

export interface QualityDecision {
  nextState: QualityState;
  changed: boolean;
}

export interface LiveStats {
  rttMs: number;
  jitterMs: number;
  packetLossPct: number;
  bitrateKbps: number;
  frameWidth: number;
  frameHeight: number;
  fps: number;
  audioLevel: number;
  connectionState: RTCPeerConnectionState;
  qualityState: QualityState;
}

export interface TransportChunk {
  packetId: string;
  partIndex: number;
  partTotal: number;
  payload: string;
}
