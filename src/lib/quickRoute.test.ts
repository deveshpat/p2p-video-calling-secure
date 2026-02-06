import { describe, expect, it } from "vitest";
import {
  buildHashForAdvanced,
  buildHashForQuick,
  buildQuickInviteUrl,
  createQuickRoomId,
  parseAppRouteFromHash,
  sanitizeQuickRoomId,
} from "./quickRoute";

describe("quickRoute", () => {
  it("creates valid quick room ids", () => {
    const roomId = createQuickRoomId();
    expect(roomId.startsWith("meet-")).toBe(true);
    expect(sanitizeQuickRoomId(roomId)).toBe(roomId);
  });

  it("sanitizes and validates room ids", () => {
    expect(sanitizeQuickRoomId("  MEET-abc123  ")).toBe("meet-abc123");
    expect(sanitizeQuickRoomId("x")).toBeNull();
    expect(sanitizeQuickRoomId("bad room id!")).toBeNull();
  });

  it("parses quick and advanced routes from hash", () => {
    expect(parseAppRouteFromHash("")).toEqual({ mode: "quick", roomId: null });
    expect(parseAppRouteFromHash("#/advanced")).toEqual({
      mode: "advanced",
      roomId: null,
    });
    expect(parseAppRouteFromHash("#/quick")).toEqual({ mode: "quick", roomId: null });
    expect(parseAppRouteFromHash("#/quick/meet-abcd1234")).toEqual({
      mode: "quick",
      roomId: "meet-abcd1234",
    });
  });

  it("builds hash paths and invite urls", () => {
    expect(buildHashForAdvanced()).toBe("#/advanced");
    expect(buildHashForQuick()).toBe("#/quick");
    expect(buildHashForQuick("meet-abcd1234")).toBe("#/quick/meet-abcd1234");
    expect(
      buildQuickInviteUrl("meet-abcd1234", {
        origin: "https://example.com",
        pathname: "/",
        search: "",
      }),
    ).toBe("https://example.com/#/quick/meet-abcd1234");
  });
});
