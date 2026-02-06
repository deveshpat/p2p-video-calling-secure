import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { RateLimiter } from "./rateLimiter.js";
import { RoomStore, sanitizeRoomId } from "./roomStore.js";
import { buildTurnCredentials } from "./turn.js";
import type {
  ParticipantRole,
  RoomCreateResponse,
  RoomJoinErrorCode,
  RoomStatusResponse,
  SignalingMessage,
  TurnCredentialsResponse,
} from "./types.js";

const DEFAULT_PORT = 8787;
const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_ROOM_TTL_SECONDS = 24 * 60 * 60;
const DEFAULT_CLEANUP_INTERVAL_MS = 60_000;
const DEFAULT_MAX_JSON_BODY_BYTES = 16_000;
const DEFAULT_REST_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_REST_RATE_LIMIT_MAX = 120;
const DEFAULT_WS_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_WS_RATE_LIMIT_MAX = 200;
const DEFAULT_TURN_TTL_SECONDS = 600;
const DEFAULT_TURN_URLS = ["stun:stun.l.google.com:19302"];
const WEBSOCKET_MAX_PAYLOAD_BYTES = 64_000;

export interface ServerConfig {
  port: number;
  host: string;
  frontendBaseUrl: string;
  roomTtlSeconds: number;
  cleanupIntervalMs: number;
  maxJsonBodyBytes: number;
  restRateLimitWindowMs: number;
  restRateLimitMax: number;
  wsRateLimitWindowMs: number;
  wsRateLimitMax: number;
  turnUrls: string[];
  turnSharedSecret: string;
  turnTtlSeconds: number;
  corsOrigins: string[];
}

interface ClientConnection {
  ws: WebSocket;
  peerId: string;
  role: ParticipantRole;
  roomId: string;
}

export interface RunningServer {
  server: Server;
  port: number;
  config: ServerConfig;
  close: () => Promise<void>;
  roomStore: RoomStore;
}

function parseIntWithDefault(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function loadConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const env = process.env;
  const frontendBaseUrl = env.FRONTEND_BASE_URL ?? "http://127.0.0.1:4173";
  return {
    port: parseIntWithDefault(env.PORT, DEFAULT_PORT),
    host: env.HOST ?? DEFAULT_HOST,
    frontendBaseUrl,
    roomTtlSeconds: parseIntWithDefault(env.ROOM_TTL_SECONDS, DEFAULT_ROOM_TTL_SECONDS),
    cleanupIntervalMs: parseIntWithDefault(
      env.CLEANUP_INTERVAL_MS,
      DEFAULT_CLEANUP_INTERVAL_MS,
    ),
    maxJsonBodyBytes: parseIntWithDefault(
      env.MAX_JSON_BODY_BYTES,
      DEFAULT_MAX_JSON_BODY_BYTES,
    ),
    restRateLimitWindowMs: parseIntWithDefault(
      env.REST_RATE_LIMIT_WINDOW_MS,
      DEFAULT_REST_RATE_LIMIT_WINDOW_MS,
    ),
    restRateLimitMax: parseIntWithDefault(env.REST_RATE_LIMIT_MAX, DEFAULT_REST_RATE_LIMIT_MAX),
    wsRateLimitWindowMs: parseIntWithDefault(
      env.WS_RATE_LIMIT_WINDOW_MS,
      DEFAULT_WS_RATE_LIMIT_WINDOW_MS,
    ),
    wsRateLimitMax: parseIntWithDefault(env.WS_RATE_LIMIT_MAX, DEFAULT_WS_RATE_LIMIT_MAX),
    turnUrls: parseCsv(env.TURN_URLS).length > 0 ? parseCsv(env.TURN_URLS) : DEFAULT_TURN_URLS,
    turnSharedSecret: env.TURN_SHARED_SECRET ?? "",
    turnTtlSeconds: parseIntWithDefault(env.TURN_TTL_SECONDS, DEFAULT_TURN_TTL_SECONDS),
    corsOrigins: parseCsv(env.CORS_ORIGINS).length > 0
      ? parseCsv(env.CORS_ORIGINS)
      : [frontendBaseUrl],
    ...overrides,
  };
}

function readBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk: Buffer | string) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        reject(new Error("BODY_TOO_LARGE"));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", (error) => reject(error));
  });
}

function safeJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function getRequestIp(request: IncomingMessage): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const [first] = forwarded.split(",");
    if (first) {
      return first.trim();
    }
  }
  return request.socket.remoteAddress ?? "unknown";
}

function isOriginAllowed(origin: string | undefined, allowList: string[]): boolean {
  if (!origin) {
    return true;
  }
  if (allowList.includes("*")) {
    return true;
  }
  return allowList.includes(origin);
}

function applyCors(
  request: IncomingMessage,
  response: ServerResponse,
  allowList: string[],
): boolean {
  const origin = request.headers.origin;
  if (!isOriginAllowed(typeof origin === "string" ? origin : undefined, allowList)) {
    response.statusCode = 403;
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ code: "CORS_BLOCKED", message: "Origin is not allowed." }));
    return false;
  }

  if (typeof origin === "string" && origin.length > 0) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }

  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
  response.setHeader("access-control-max-age", "86400");
  return true;
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
): void {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function mapJoinErrorToHttp(code: RoomJoinErrorCode): { status: number; reason: string } {
  switch (code) {
    case "ROOM_NOT_FOUND":
      return { status: 404, reason: "Room not found." };
    case "ROOM_EXPIRED":
      return { status: 410, reason: "Room has expired." };
    case "ROOM_FULL":
      return { status: 409, reason: "Room already has two participants." };
    case "ROLE_TAKEN":
      return { status: 409, reason: "Requested role is already taken." };
    default:
      return { status: 400, reason: "Invalid role." };
  }
}

function isRelayType(type: string): type is "offer" | "answer" | "ice-candidate" | "chat" {
  return (
    type === "offer" ||
    type === "answer" ||
    type === "ice-candidate" ||
    type === "chat"
  );
}

function encodeMessage(message: SignalingMessage): string {
  return JSON.stringify({
    ...message,
    timestamp: Date.now(),
  });
}

function sendSocketError(ws: WebSocket, message: string): void {
  if (ws.readyState !== ws.OPEN) {
    return;
  }
  ws.send(
    encodeMessage({
      type: "error",
      payload: { message },
    }),
  );
}

function sendSocketMessage(ws: WebSocket, message: SignalingMessage): void {
  if (ws.readyState !== ws.OPEN) {
    return;
  }
  ws.send(encodeMessage(message));
}

export async function startSignalingServer(
  overrides: Partial<ServerConfig> = {},
): Promise<RunningServer> {
  const config = loadConfig(overrides);
  const roomStore = new RoomStore(config.roomTtlSeconds * 1_000);
  const restRateLimiter = new RateLimiter(
    config.restRateLimitWindowMs,
    config.restRateLimitMax,
  );
  const wsRateLimiter = new RateLimiter(config.wsRateLimitWindowMs, config.wsRateLimitMax);

  const connectionsByRoom = new Map<string, Map<string, ClientConnection>>();

  const wsServer = new WebSocketServer({
    noServer: true,
    maxPayload: WEBSOCKET_MAX_PAYLOAD_BYTES,
  });

  function removeConnection(connection: ClientConnection): void {
    const roomConnections = connectionsByRoom.get(connection.roomId);
    if (!roomConnections) {
      return;
    }

    roomConnections.delete(connection.peerId);
    roomStore.removeParticipant(connection.roomId, connection.peerId);

    const peerLeftMessage: SignalingMessage = {
      type: "peer-left",
      roomId: connection.roomId,
      fromPeerId: connection.peerId,
      payload: {
        role: connection.role,
      },
    };

    for (const peer of roomConnections.values()) {
      sendSocketMessage(peer.ws, peerLeftMessage);
    }

    if (roomConnections.size === 0) {
      connectionsByRoom.delete(connection.roomId);
    }
  }

  function relayMessage(
    roomId: string,
    sourcePeerId: string,
    message: SignalingMessage,
    toPeerId?: string,
  ): void {
    const roomConnections = connectionsByRoom.get(roomId);
    if (!roomConnections) {
      return;
    }

    for (const peer of roomConnections.values()) {
      if (peer.peerId === sourcePeerId) {
        continue;
      }
      if (toPeerId && peer.peerId !== toPeerId) {
        continue;
      }
      sendSocketMessage(peer.ws, message);
    }
  }

  function onWebSocketConnection(
    ws: WebSocket,
    context: { roomId: string; peerId: string; role: ParticipantRole },
  ): void {
    roomStore.addParticipant(context.roomId, context.peerId, context.role);

    let roomConnections = connectionsByRoom.get(context.roomId);
    if (!roomConnections) {
      roomConnections = new Map<string, ClientConnection>();
      connectionsByRoom.set(context.roomId, roomConnections);
    }

    const connection: ClientConnection = {
      ws,
      roomId: context.roomId,
      peerId: context.peerId,
      role: context.role,
    };
    roomConnections.set(context.peerId, connection);

    sendSocketMessage(ws, {
      type: "session-joined",
      roomId: context.roomId,
      fromPeerId: context.peerId,
      payload: {
        role: context.role,
        participantCount: roomStore.participantCount(context.roomId),
      },
    });

    relayMessage(
      context.roomId,
      context.peerId,
      {
        type: "peer-joined",
        roomId: context.roomId,
        fromPeerId: context.peerId,
        payload: {
          role: context.role,
        },
      },
    );

    ws.on("message", (raw: RawData) => {
      const rawText = typeof raw === "string" ? raw : raw.toString("utf8");
      if (rawText.length > WEBSOCKET_MAX_PAYLOAD_BYTES) {
        sendSocketError(ws, "Message is too large.");
        ws.close(1009, "Message is too large.");
        return;
      }

      const parsed = safeJsonParse(rawText);
      if (!parsed || typeof parsed !== "object") {
        sendSocketError(ws, "Malformed JSON payload.");
        return;
      }

      const incoming = parsed as SignalingMessage;
      if (typeof incoming.type !== "string") {
        sendSocketError(ws, "Message type is required.");
        return;
      }

      if (incoming.type === "heartbeat") {
        sendSocketMessage(ws, {
          type: "heartbeat",
          roomId: context.roomId,
          fromPeerId: "server",
          payload: { ok: true },
        });
        return;
      }

      if (!isRelayType(incoming.type)) {
        sendSocketError(ws, "Unsupported signaling message type.");
        return;
      }

      if (incoming.type === "chat") {
        const text =
          typeof incoming.payload === "object" &&
          incoming.payload !== null &&
          "text" in incoming.payload &&
          typeof (incoming.payload as { text: string }).text === "string"
            ? (incoming.payload as { text: string }).text
            : "";
        if (text.trim().length === 0 || text.length > 500) {
          sendSocketError(ws, "Chat message must be between 1 and 500 characters.");
          return;
        }
      }

      const target = typeof incoming.toPeerId === "string" ? incoming.toPeerId : undefined;
      relayMessage(context.roomId, context.peerId, {
        type: incoming.type,
        roomId: context.roomId,
        fromPeerId: context.peerId,
        toPeerId: target,
        payload: incoming.payload,
      }, target);
    });

    ws.on("close", () => {
      removeConnection(connection);
    });

    ws.on("error", () => {
      removeConnection(connection);
      ws.close();
    });
  }

  const server = createServer(async (request, response) => {
    if (!applyCors(request, response, config.corsOrigins)) {
      return;
    }

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    const requestIp = getRequestIp(request);
    if (!restRateLimiter.allow(requestIp)) {
      sendJson(response, 429, {
        code: "RATE_LIMITED",
        message: "Too many requests. Please retry shortly.",
      });
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (requestUrl.pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        timestamp: Date.now(),
      });
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/rooms") {
      try {
        if ((request.headers["content-type"] ?? "").includes("application/json")) {
          await readBody(request, config.maxJsonBodyBytes);
        }
      } catch {
        sendJson(response, 413, {
          code: "BODY_TOO_LARGE",
          message: "Request body is too large.",
        });
        return;
      }

      const room = roomStore.createRoom();
      const payload: RoomCreateResponse = {
        roomId: room.roomId,
        expiresAt: room.expiresAt,
        joinUrl: `${config.frontendBaseUrl}/#/quick/${room.roomId}`,
      };
      sendJson(response, 201, payload);
      return;
    }

    const roomMatch = requestUrl.pathname.match(/^\/v1\/rooms\/([a-z0-9-]+)$/u);
    if (request.method === "GET" && roomMatch) {
      const roomId = sanitizeRoomId(roomMatch[1] ?? "");
      if (!roomId) {
        sendJson(response, 400, {
          code: "ROOM_INVALID",
          message: "Room id format is invalid.",
        });
        return;
      }

      const room = roomStore.getActiveRoom(roomId);
      if (!room) {
        sendJson(response, 404, {
          code: "ROOM_NOT_FOUND",
          message: "Room was not found or has expired.",
        });
        return;
      }

      const payload: RoomStatusResponse = {
        roomId: room.roomId,
        status: "open",
        expiresAt: room.expiresAt,
        participantCount: roomStore.participantCount(room.roomId),
      };
      sendJson(response, 200, payload);
      return;
    }

    if (request.method === "POST" && requestUrl.pathname === "/v1/turn-credentials") {
      let peerId: string = randomUUID();
      try {
        const rawBody = await readBody(request, config.maxJsonBodyBytes);
        if (rawBody.trim().length > 0) {
          const parsed = safeJsonParse(rawBody);
          if (parsed && typeof parsed === "object" && "peerId" in parsed) {
            const rawPeerId = (parsed as { peerId?: unknown }).peerId;
            if (typeof rawPeerId === "string" && rawPeerId.trim().length > 0) {
              peerId = rawPeerId.trim().slice(0, 80);
            }
          }
        }
      } catch {
        sendJson(response, 413, {
          code: "BODY_TOO_LARGE",
          message: "Request body is too large.",
        });
        return;
      }

      const turn = buildTurnCredentials(
        {
          urls: config.turnUrls,
          sharedSecret: config.turnSharedSecret,
          ttlSeconds: config.turnTtlSeconds,
        },
        peerId,
      );

      const payload: TurnCredentialsResponse = {
        urls: turn.urls,
        username: turn.username,
        credential: turn.credential,
        ttlSeconds: turn.ttlSeconds,
      };
      sendJson(response, 200, payload);
      return;
    }

    sendJson(response, 404, {
      code: "NOT_FOUND",
      message: "Endpoint not found.",
    });
  });

  server.on("upgrade", (request, socket, head) => {
    const requestIp = getRequestIp(request);
    if (!wsRateLimiter.allow(requestIp)) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }

    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (requestUrl.pathname !== "/v1/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const roomId = sanitizeRoomId(requestUrl.searchParams.get("roomId") ?? "");
    const peerIdQuery = requestUrl.searchParams.get("peerId");
    const peerId = String(peerIdQuery ?? randomUUID()).slice(0, 80);
    const roleValue = requestUrl.searchParams.get("role");
    const role: ParticipantRole = roleValue === "host" ? "host" : "guest";

    if (!roomId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    if (roleValue !== "host" && roleValue !== "guest") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const validation = roomStore.validateJoin(roomId, peerId, role);
    if (!validation.ok) {
      const mapped = mapJoinErrorToHttp(validation.code);
      socket.write(`HTTP/1.1 ${mapped.status} ${mapped.reason}\r\n\r\n`);
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (ws) => {
      onWebSocketConnection(ws, {
        roomId,
        peerId,
        role,
      });
    });
  });

  const cleanupTimer = setInterval(() => {
    const removedRoomIds = roomStore.cleanupExpired();
    for (const roomId of removedRoomIds) {
      const roomConnections = connectionsByRoom.get(roomId);
      if (!roomConnections) {
        continue;
      }
      for (const connection of roomConnections.values()) {
        sendSocketError(connection.ws, "Room expired.");
        connection.ws.close(4000, "Room expired.");
      }
      connectionsByRoom.delete(roomId);
    }
    restRateLimiter.prune();
    wsRateLimiter.prune();
  }, config.cleanupIntervalMs);
  cleanupTimer.unref();

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => resolve());
    server.once("error", (error) => reject(error));
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : config.port;

  return {
    server,
    config,
    port,
    roomStore,
    close: async () => {
      clearInterval(cleanupTimer);
      for (const roomConnections of connectionsByRoom.values()) {
        for (const connection of roomConnections.values()) {
          connection.ws.close(1001, "Server shutting down");
        }
      }
      connectionsByRoom.clear();
      await new Promise<void>((resolve) => {
        wsServer.close(() => resolve());
      });
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      roomStore.clearAll();
    },
  };
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  startSignalingServer()
    .then(({ port }) => {
      console.log(`Signaling backend running on port ${port}`);
    })
    .catch((error: unknown) => {
      console.error("Failed to start signaling backend", error);
      process.exit(1);
    });
}
