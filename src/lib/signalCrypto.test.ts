import { describe, expect, it } from "vitest";
import { decryptJsonPayload, encryptJsonPayload } from "./signalCrypto";

describe("signalCrypto", () => {
  it("encrypts and decrypts payload with matching passphrase", async () => {
    const payload = {
      sessionId: "abc123",
      message: "hello",
      count: 2,
    };
    const encrypted = await encryptJsonPayload(payload, "correct-pass", "room-a");
    const decrypted = await decryptJsonPayload<typeof payload>(
      encrypted,
      "correct-pass",
      "room-a",
    );

    expect(decrypted).toEqual(payload);
  });

  it("throws when passphrase is wrong", async () => {
    const encrypted = await encryptJsonPayload(
      { key: "value" },
      "correct-pass",
      "room-a",
    );

    await expect(
      decryptJsonPayload(encrypted, "wrong-pass", "room-a"),
    ).rejects.toThrow("DECRYPTION_FAILED");
  });
});
