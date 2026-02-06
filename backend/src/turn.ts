import { createHmac } from "node:crypto";

export interface TurnConfig {
  urls: string[];
  sharedSecret: string;
  ttlSeconds: number;
}

export interface TurnCredentials {
  urls: string[];
  username: string;
  credential: string;
  ttlSeconds: number;
}

function cleanUrls(rawUrls: string[]): string[] {
  return rawUrls
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function buildTurnCredentials(
  config: TurnConfig,
  peerId: string,
  now = Date.now(),
): TurnCredentials {
  const urls = cleanUrls(config.urls);
  const ttlSeconds = Math.max(30, config.ttlSeconds);

  if (!config.sharedSecret) {
    return {
      urls,
      username: "",
      credential: "",
      ttlSeconds,
    };
  }

  const expiresAtSeconds = Math.floor(now / 1_000) + ttlSeconds;
  const safePeer = peerId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "guest";
  const username = `${expiresAtSeconds}:${safePeer}`;
  const credential = createHmac("sha1", config.sharedSecret)
    .update(username)
    .digest("base64");

  return {
    urls,
    username,
    credential,
    ttlSeconds,
  };
}
