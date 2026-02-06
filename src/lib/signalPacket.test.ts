import { describe, expect, it } from "vitest";
import {
  createSignalEnvelope,
  decodeEnvelopeFromTransport,
  decryptOfferEnvelope,
  encodeEnvelopeForTransport,
} from "./signalPacket";

describe("signalPacket", () => {
  it("keeps packet data intact after encode and decode", async () => {
    const offerPayload = {
      sessionId: "session-123",
      sdpOffer: "v=0\r\no=- 12345 2 IN IP4 127.0.0.1\r\n",
      iceCandidates: Array.from({ length: 40 }).map((_, index) => ({
        candidate: `candidate-${index}`.repeat(8),
        sdpMid: "0",
        sdpMLineIndex: 0,
      })),
      mediaTarget: "1080p30" as const,
      clientInfo: "test-client",
    };

    const envelope = await createSignalEnvelope({
      payload: offerPayload,
      passphrase: "pass-one",
      roomCode: "room-1",
      type: "offer",
      senderRole: "host",
    });

    const transportText = encodeEnvelopeForTransport(envelope);
    const decodedEnvelope = decodeEnvelopeFromTransport(transportText);
    const decryptedPayload = await decryptOfferEnvelope({
      envelope: decodedEnvelope,
      roomCode: "room-1",
      passphrase: "pass-one",
    });

    expect(decryptedPayload.sessionId).toBe("session-123");
    expect(decryptedPayload.iceCandidates).toHaveLength(40);
  });

  it("rejects expired packet", async () => {
    const envelope = await createSignalEnvelope({
      payload: {
        sessionId: "session-123",
        sdpOffer: "v=0\r\n",
        iceCandidates: [],
        mediaTarget: "1080p30" as const,
        clientInfo: "test-client",
      },
      passphrase: "pass-one",
      roomCode: "room-1",
      type: "offer",
      senderRole: "host",
    });

    const expiredEnvelope = {
      ...envelope,
      expiresAt: Date.now() - 1,
    };
    const transportText = encodeEnvelopeForTransport(expiredEnvelope);
    const decodedEnvelope = decodeEnvelopeFromTransport(transportText);

    await expect(
      decryptOfferEnvelope({
        envelope: decodedEnvelope,
        roomCode: "room-1",
        passphrase: "pass-one",
      }),
    ).rejects.toThrow("PACKET_EXPIRED");
  });

  it("rejects metadata tampering through integrity binding", async () => {
    const envelope = await createSignalEnvelope({
      payload: {
        sessionId: "session-123",
        sdpOffer: "v=0\r\n",
        iceCandidates: [],
        mediaTarget: "1080p30" as const,
        clientInfo: "test-client",
      },
      passphrase: "pass-one",
      roomCode: "room-1",
      type: "offer",
      senderRole: "host",
    });

    const tamperedEnvelope = {
      ...envelope,
      createdAt: envelope.createdAt + 1,
      expiresAt: envelope.expiresAt + 1,
    };
    const decodedEnvelope = decodeEnvelopeFromTransport(
      encodeEnvelopeForTransport(tamperedEnvelope),
    );

    await expect(
      decryptOfferEnvelope({
        envelope: decodedEnvelope,
        roomCode: "room-1",
        passphrase: "pass-one",
      }),
    ).rejects.toThrow("DECRYPTION_FAILED");
  });

  it("rejects extremely large packet text", () => {
    expect(() => decodeEnvelopeFromTransport("x".repeat(200_001))).toThrow(
      "Packet text is too large.",
    );
  });
});
