// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RoomStore, createRoomId, sanitizeRoomId } from "./roomStore";

describe("roomStore", () => {
  it("creates room ids with required format", () => {
    const roomId = createRoomId();
    expect(roomId.startsWith("meet-")).toBe(true);
    expect(sanitizeRoomId(roomId)).toBe(roomId);
  });

  it("expires rooms based on configured ttl", () => {
    const now = 1_700_000_000_000;
    const store = new RoomStore(1_000);
    const room = store.createRoom(now);

    expect(store.getActiveRoom(room.roomId, now + 900)).not.toBeNull();
    expect(store.getActiveRoom(room.roomId, now + 1_001)).toBeNull();
  });

  it("enforces two participant limit with role ownership", () => {
    const store = new RoomStore(60_000);
    const room = store.createRoom();

    const hostJoin = store.validateJoin(room.roomId, "peer-host", "host");
    expect(hostJoin.ok).toBe(true);
    store.addParticipant(room.roomId, "peer-host", "host");

    const guestJoin = store.validateJoin(room.roomId, "peer-guest", "guest");
    expect(guestJoin.ok).toBe(true);
    store.addParticipant(room.roomId, "peer-guest", "guest");

    const thirdJoin = store.validateJoin(room.roomId, "peer-third", "guest");
    expect(thirdJoin.ok).toBe(false);
    if (!thirdJoin.ok) {
      expect(thirdJoin.code).toBe("ROLE_TAKEN");
    }

    store.removeParticipant(room.roomId, "peer-guest");
    const newGuest = store.validateJoin(room.roomId, "peer-third", "guest");
    expect(newGuest.ok).toBe(true);
  });
});
