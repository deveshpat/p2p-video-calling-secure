// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildTurnCredentials } from "./turn";

describe("turn credentials", () => {
  it("creates deterministic username and credential with shared secret", () => {
    const credentials = buildTurnCredentials(
      {
        urls: ["turn:turn.example.com:3478?transport=udp"],
        sharedSecret: "super-secret",
        ttlSeconds: 600,
      },
      "peer-123",
      1_700_000_000_000,
    );

    expect(credentials.urls).toEqual(["turn:turn.example.com:3478?transport=udp"]);
    expect(credentials.username).toContain(":peer-123");
    expect(credentials.credential.length).toBeGreaterThan(10);
    expect(credentials.ttlSeconds).toBe(600);
  });

  it("returns empty username and credential when shared secret is not configured", () => {
    const credentials = buildTurnCredentials(
      {
        urls: ["stun:stun.l.google.com:19302"],
        sharedSecret: "",
        ttlSeconds: 600,
      },
      "peer-abc",
    );

    expect(credentials.username).toBe("");
    expect(credentials.credential).toBe("");
    expect(credentials.urls).toEqual(["stun:stun.l.google.com:19302"]);
  });
});
