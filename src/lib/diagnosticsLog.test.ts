import { describe, expect, it } from "vitest";
import { DiagnosticsLog } from "./diagnosticsLog";

describe("diagnosticsLog", () => {
  it("merges local and remote diagnostics chronologically", () => {
    const log = new DiagnosticsLog();
    const now = Date.now();
    log.addLocalEvent({
      timestamp: now + 20,
      peerId: "host",
      rttMs: 30,
      jitterMs: 5,
      packetLossPct: 0,
      bitrateKbps: 3000,
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 30,
      audioLevel: 0.5,
      eventType: "stats",
      message: "host",
    });
    log.addRemoteEvent({
      timestamp: now + 10,
      peerId: "joiner",
      rttMs: 32,
      jitterMs: 6,
      packetLossPct: 0,
      bitrateKbps: 2800,
      frameWidth: 1920,
      frameHeight: 1080,
      fps: 30,
      audioLevel: 0.4,
      eventType: "stats",
      message: "joiner",
    });

    const merged = log.getMergedEvents();
    expect(merged).toHaveLength(2);
    expect(merged[0].peerId).toBe("joiner");
    expect(merged[1].peerId).toBe("host");
  });
});
