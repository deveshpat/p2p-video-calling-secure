export interface RoomCreateResponse {
  roomId: string;
  joinUrl: string;
  expiresAt: number;
}

export interface RoomStatusResponse {
  roomId: string;
  status: "open";
  expiresAt: number;
  participantCount: number;
}

export interface TurnCredentialsResponse {
  urls: string[];
  username: string;
  credential: string;
  ttlSeconds: number;
}

export interface ApiErrorPayload {
  code: string;
  message: string;
}

function cleanBaseUrl(rawBase: string): string {
  return rawBase.replace(/\/+$/u, "");
}

export function resolveApiBaseUrl(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL?.trim();
  if (envBase) {
    return cleanBaseUrl(envBase);
  }
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    return "http://127.0.0.1:8787";
  }
  return "https://p2p-video-signaling.fly.dev";
}

function buildRequestUrl(baseUrl: string, path: string): string {
  return `${cleanBaseUrl(baseUrl)}${path}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as ApiErrorPayload;
    if (typeof payload.message === "string" && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch {
    // Ignore parse errors and use fallback.
  }
  return `Request failed (${response.status}).`;
}

export async function createRoom(baseUrl: string): Promise<RoomCreateResponse> {
  const response = await fetch(buildRequestUrl(baseUrl, "/v1/rooms"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as RoomCreateResponse;
}

export async function getRoomStatus(
  baseUrl: string,
  roomId: string,
): Promise<RoomStatusResponse> {
  const response = await fetch(
    buildRequestUrl(baseUrl, `/v1/rooms/${encodeURIComponent(roomId)}`),
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as RoomStatusResponse;
}

export async function getTurnCredentials(
  baseUrl: string,
  peerId: string,
): Promise<TurnCredentialsResponse> {
  const response = await fetch(buildRequestUrl(baseUrl, "/v1/turn-credentials"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ peerId }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }

  return (await response.json()) as TurnCredentialsResponse;
}

export function createSignalingWebSocketUrl(baseUrl: string, params: {
  roomId: string;
  peerId: string;
  role: "host" | "guest";
}): string {
  const httpUrl = new URL(baseUrl);
  const protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = new URL(`${protocol}//${httpUrl.host}/v1/ws`);
  wsUrl.searchParams.set("roomId", params.roomId);
  wsUrl.searchParams.set("peerId", params.peerId);
  wsUrl.searchParams.set("role", params.role);
  return wsUrl.toString();
}
