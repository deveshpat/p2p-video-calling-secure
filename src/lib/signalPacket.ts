import { gzip, ungzip } from "pako";
import { z } from "zod";
import type {
  AnswerPayloadV1,
  OfferPayloadV1,
  SenderRole,
  SignalEnvelopeType,
  SignalEnvelopeV1,
  TransportChunk,
} from "../types/contracts";
import { CallFailureCode } from "../types/contracts";
import { base64UrlToBytes, bytesToBase64Url } from "./base64";
import { decryptJsonPayload, encryptJsonPayload } from "./signalCrypto";

export const SIGNAL_VERSION = "1";
export const TRANSPORT_CHUNK_CHAR_LIMIT = 900;
const PACKET_PREFIX = "P2PV1";
const PACKET_TTL_MS = 10 * 60 * 1000;
const MAX_PACKET_TEXT_CHARS = 200_000;
const MAX_CHUNK_COUNT = 256;
const MAX_COMPRESSED_BYTES = 120_000;
const MAX_DECOMPRESSED_CHARS = 350_000;

const roomCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_-]{4,48}$/u, "Room code must be 4-48 letters, numbers, - or _.");

const sessionIdSchema = z
  .string()
  .min(6)
  .max(128)
  .regex(/^[a-zA-Z0-9-]+$/u);

const iceCandidateSchema = z.object({
  candidate: z.string().min(1).max(2048),
  sdpMid: z.string().max(64).nullable().optional(),
  sdpMLineIndex: z.number().int().min(0).max(10).optional(),
  usernameFragment: z.string().max(256).optional(),
});

const signalEnvelopeSchema = z.object({
  version: z.literal(SIGNAL_VERSION),
  type: z.union([z.literal("offer"), z.literal("answer")]),
  roomCode: roomCodeSchema,
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  saltB64: z.string().min(10),
  ivB64: z.string().min(10),
  ciphertextB64: z.string().min(10),
  senderRole: z.union([z.literal("host"), z.literal("joiner")]),
});

const offerPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  sdpOffer: z.string().min(10).max(30_000),
  iceCandidates: z.array(iceCandidateSchema).max(96),
  mediaTarget: z.literal("1080p30"),
  clientInfo: z.string().min(2).max(180),
});

const answerPayloadSchema = z.object({
  sessionId: sessionIdSchema,
  sdpAnswer: z.string().min(10).max(30_000),
  iceCandidates: z.array(iceCandidateSchema).max(96),
  acceptedMediaTarget: z.literal("1080p30"),
  clientInfo: z.string().min(2).max(180),
});

function buildEnvelopeAdditionalData(envelope: {
  version: SignalEnvelopeV1["version"];
  type: SignalEnvelopeV1["type"];
  roomCode: string;
  createdAt: number;
  expiresAt: number;
  senderRole: SignalEnvelopeV1["senderRole"];
}): string {
  return [
    envelope.version,
    envelope.type,
    envelope.roomCode,
    String(envelope.createdAt),
    String(envelope.expiresAt),
    envelope.senderRole,
  ].join("|");
}

function validateEnvelopeTimeWindow(envelope: SignalEnvelopeV1): void {
  if (envelope.expiresAt <= envelope.createdAt) {
    throw new Error("Packet timestamps are invalid.");
  }

  if (envelope.expiresAt - envelope.createdAt > PACKET_TTL_MS) {
    throw new Error("Packet lifetime is invalid.");
  }
}

function getTransportLines(input: string): string[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function parseChunkLine(line: string): TransportChunk {
  const parts = line.split("|");
  if (parts.length !== 4 || parts[0] !== PACKET_PREFIX) {
    throw new Error("Invalid packet chunk format.");
  }

  const packetId = parts[1];
  if (!/^[a-f0-9]{16}$/u.test(packetId)) {
    throw new Error("Packet ID is invalid.");
  }

  const partTokens = parts[2].split("/");
  if (partTokens.length !== 2) {
    throw new Error("Invalid packet chunk index.");
  }

  const partIndex = Number(partTokens[0]);
  const partTotal = Number(partTokens[1]);
  if (
    Number.isNaN(partIndex) ||
    Number.isNaN(partTotal) ||
    partIndex < 1 ||
    partTotal < 1 ||
    partIndex > partTotal
  ) {
    throw new Error("Packet chunk index is out of range.");
  }

  return {
    packetId,
    partIndex,
    partTotal,
    payload: parts[3],
  };
}

function serializeChunk(chunk: TransportChunk): string {
  return `${PACKET_PREFIX}|${chunk.packetId}|${chunk.partIndex}/${chunk.partTotal}|${chunk.payload}`;
}

function randomPacketId(): string {
  const randomBytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(randomBytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function splitPayloadIntoChunks(payload: string): string[] {
  if (payload.length > MAX_PACKET_TEXT_CHARS) {
    throw new Error("Packet is too large to share safely.");
  }

  const chunks: string[] = [];
  for (let index = 0; index < payload.length; index += TRANSPORT_CHUNK_CHAR_LIMIT) {
    chunks.push(payload.slice(index, index + TRANSPORT_CHUNK_CHAR_LIMIT));
  }

  if (chunks.length > MAX_CHUNK_COUNT) {
    throw new Error("Packet has too many chunks.");
  }

  return chunks;
}

export function describeFailure(error: unknown): {
  code: CallFailureCode;
  message: string;
} {
  if (error instanceof Error && error.message === "DECRYPTION_FAILED") {
    return {
      code: CallFailureCode.PASS_PHRASE_MISMATCH,
      message:
        "The passphrase did not match, so this packet could not be opened.",
    };
  }

  if (error instanceof Error && error.message === "PACKET_EXPIRED") {
    return {
      code: CallFailureCode.EXPIRED_PACKET,
      message: "This packet expired. Please make a new one and try again.",
    };
  }

  return {
    code: CallFailureCode.MEDIA_UNSUPPORTED,
    message: error instanceof Error ? error.message : "Unknown packet error.",
  };
}

export async function createSignalEnvelope<TPayload>({
  payload,
  passphrase,
  roomCode,
  type,
  senderRole,
}: {
  payload: TPayload;
  passphrase: string;
  roomCode: string;
  type: SignalEnvelopeType;
  senderRole: SenderRole;
}): Promise<SignalEnvelopeV1> {
  const cleanRoomCode = roomCodeSchema.parse(roomCode);
  const now = Date.now();
  const envelopeMeta = {
    version: SIGNAL_VERSION,
    type,
    roomCode: cleanRoomCode,
    createdAt: now,
    expiresAt: now + PACKET_TTL_MS,
    senderRole,
  } as const;
  const encrypted = await encryptJsonPayload(
    payload,
    passphrase,
    cleanRoomCode,
    buildEnvelopeAdditionalData(envelopeMeta),
  );

  return {
    ...envelopeMeta,
    saltB64: encrypted.saltB64,
    ivB64: encrypted.ivB64,
    ciphertextB64: encrypted.ciphertextB64,
  };
}

export function encodeEnvelopeForTransport(envelope: SignalEnvelopeV1): string {
  const json = JSON.stringify(envelope);
  const compressedBytes = gzip(new TextEncoder().encode(json));
  const encoded = bytesToBase64Url(compressedBytes);
  const payloadParts = splitPayloadIntoChunks(encoded);
  const packetId = randomPacketId();
  const chunks = payloadParts.map((payload, index) => {
    const partIndex = index + 1;
    const partTotal = payloadParts.length;
    return serializeChunk({
      packetId,
      partIndex,
      partTotal,
      payload,
    });
  });
  return chunks.join("\n");
}

export function getTransportChunksFromText(input: string): string[] {
  return getTransportLines(input);
}

export function decodeEnvelopeFromTransport(input: string): SignalEnvelopeV1 {
  if (input.length > MAX_PACKET_TEXT_CHARS) {
    throw new Error("Packet text is too large.");
  }

  const lines = getTransportLines(input);
  if (lines.length === 0) {
    throw new Error("No packet data was found.");
  }
  if (lines.length > MAX_CHUNK_COUNT) {
    throw new Error("Packet has too many chunks.");
  }

  const chunks = lines.map(parseChunkLine);
  const packetId = chunks[0].packetId;
  const total = chunks[0].partTotal;
  if (chunks.some((chunk) => chunk.packetId !== packetId || chunk.partTotal !== total)) {
    throw new Error("Packet chunks do not belong together.");
  }

  const uniqueByIndex = new Map<number, TransportChunk>();
  for (const chunk of chunks) {
    uniqueByIndex.set(chunk.partIndex, chunk);
  }

  if (uniqueByIndex.size !== total) {
    throw new Error("Packet is missing one or more chunks.");
  }

  const ordered = Array.from(uniqueByIndex.values()).sort(
    (first, second) => first.partIndex - second.partIndex,
  );
  const payload = ordered.map((chunk) => chunk.payload).join("");
  const compressedBytes = base64UrlToBytes(payload);
  if (compressedBytes.length > MAX_COMPRESSED_BYTES) {
    throw new Error("Packet payload is too large.");
  }

  const decompressed = ungzip(compressedBytes);
  if (decompressed.length > MAX_DECOMPRESSED_CHARS) {
    throw new Error("Packet decompressed payload is too large.");
  }

  const json = new TextDecoder().decode(decompressed);
  const parsed = JSON.parse(json) as unknown;
  const envelope = signalEnvelopeSchema.parse(parsed);
  validateEnvelopeTimeWindow(envelope);
  return envelope;
}

function ensureEnvelopeUsable(envelope: SignalEnvelopeV1, roomCode: string): string {
  const cleanRoomCode = roomCodeSchema.parse(roomCode);
  if (envelope.roomCode !== cleanRoomCode) {
    throw new Error("This packet does not belong to this room code.");
  }

  validateEnvelopeTimeWindow(envelope);

  if (Date.now() > envelope.expiresAt) {
    throw new Error("PACKET_EXPIRED");
  }

  return cleanRoomCode;
}

export async function decryptOfferEnvelope({
  envelope,
  roomCode,
  passphrase,
}: {
  envelope: SignalEnvelopeV1;
  roomCode: string;
  passphrase: string;
}): Promise<OfferPayloadV1> {
  const cleanRoomCode = ensureEnvelopeUsable(envelope, roomCode);
  if (envelope.type !== "offer") {
    throw new Error("Expected an offer packet.");
  }
  if (envelope.senderRole !== "host") {
    throw new Error("Offer packet role is invalid.");
  }

  const payload = await decryptJsonPayload<unknown>(
    envelope,
    passphrase,
    cleanRoomCode,
    buildEnvelopeAdditionalData(envelope),
  );
  return offerPayloadSchema.parse(payload);
}

export async function decryptAnswerEnvelope({
  envelope,
  roomCode,
  passphrase,
}: {
  envelope: SignalEnvelopeV1;
  roomCode: string;
  passphrase: string;
}): Promise<AnswerPayloadV1> {
  const cleanRoomCode = ensureEnvelopeUsable(envelope, roomCode);
  if (envelope.type !== "answer") {
    throw new Error("Expected an answer packet.");
  }
  if (envelope.senderRole !== "joiner") {
    throw new Error("Answer packet role is invalid.");
  }

  const payload = await decryptJsonPayload<unknown>(
    envelope,
    passphrase,
    cleanRoomCode,
    buildEnvelopeAdditionalData(envelope),
  );
  return answerPayloadSchema.parse(payload);
}
