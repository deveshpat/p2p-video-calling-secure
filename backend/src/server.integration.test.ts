// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket, { type RawData } from "ws";
import { startSignalingServer, type RunningServer } from "./server";
import type { SignalingMessage } from "./types";

function waitForMessage(
  ws: WebSocket,
  matcher: (message: SignalingMessage) => boolean,
  timeoutMs = 10_000,
): Promise<SignalingMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for websocket message."));
    }, timeoutMs);

    const onMessage = (raw: RawData) => {
      const parsed = JSON.parse(raw.toString("utf8")) as SignalingMessage;
      if (!matcher(parsed)) {
        return;
      }
      cleanup();
      resolve(parsed);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };

    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once("open", () => resolve(ws));
    ws.once("error", (error) => reject(error));
  });
}

describe("signaling backend", () => {
  let running: RunningServer;
  let baseUrl = "";

  beforeAll(async () => {
    running = await startSignalingServer({
      port: 0,
      frontendBaseUrl: "https://deveshpat.github.io/p2p-video-calling-secure",
      turnUrls: ["turn:turn.example.com:3478?transport=udp"],
      turnSharedSecret: "integration-secret",
      turnTtlSeconds: 600,
    });
    baseUrl = `http://127.0.0.1:${running.port}`;
  });

  afterAll(async () => {
    await running.close();
  });

  it("creates room and returns status", async () => {
    const created = await fetch(`${baseUrl}/v1/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(created.status).toBe(201);
    const createPayload = (await created.json()) as {
      roomId: string;
      joinUrl: string;
      expiresAt: number;
    };

    expect(createPayload.roomId.startsWith("meet-")).toBe(true);
    expect(createPayload.joinUrl.endsWith(`#/quick/${createPayload.roomId}`)).toBe(true);
    expect(createPayload.expiresAt).toBeGreaterThan(Date.now());

    const status = await fetch(`${baseUrl}/v1/rooms/${createPayload.roomId}`);
    expect(status.status).toBe(200);
    const statusPayload = (await status.json()) as {
      participantCount: number;
      status: string;
    };

    expect(statusPayload.status).toBe("open");
    expect(statusPayload.participantCount).toBe(0);
  });

  it("mints turn credentials with short lived username", async () => {
    const response = await fetch(`${baseUrl}/v1/turn-credentials`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ peerId: "peer-turn" }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      urls: string[];
      username: string;
      credential: string;
      ttlSeconds: number;
    };

    expect(payload.urls[0]).toContain("turn:");
    expect(payload.username).toContain(":peer-turn");
    expect(payload.credential.length).toBeGreaterThan(10);
    expect(payload.ttlSeconds).toBe(600);
  });

  it("relays offer and chat messages between host and guest", async () => {
    const createResponse = await fetch(`${baseUrl}/v1/rooms`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{}",
    });
    const room = (await createResponse.json()) as { roomId: string };

    const host = await openSocket(
      `${baseUrl.replace("http", "ws")}/v1/ws?roomId=${room.roomId}&peerId=host-1&role=host`,
    );
    const hostPeerJoined = waitForMessage(host, (message) => message.type === "peer-joined");

    const guest = await openSocket(
      `${baseUrl.replace("http", "ws")}/v1/ws?roomId=${room.roomId}&peerId=guest-1&role=guest`,
    );
    await hostPeerJoined;

    const guestOfferPromise = waitForMessage(guest, (message) => message.type === "offer");
    host.send(
      JSON.stringify({
        type: "offer",
        payload: {
          sdp: "fake-offer-sdp",
        },
      }),
    );

    const offerMessage = await guestOfferPromise;
    expect(offerMessage.fromPeerId).toBe("host-1");

    const hostChatPromise = waitForMessage(host, (message) => message.type === "chat");
    guest.send(
      JSON.stringify({
        type: "chat",
        payload: {
          text: "hello there",
        },
      }),
    );

    const chatMessage = await hostChatPromise;
    expect(chatMessage.fromPeerId).toBe("guest-1");

    host.close();
    guest.close();
  });
});
