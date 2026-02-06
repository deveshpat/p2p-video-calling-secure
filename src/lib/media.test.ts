import { afterEach, describe, expect, it, vi } from "vitest";
import { CallFailureCode } from "../types/contracts";
import { getLocalMediaStream, targetMediaConstraints } from "./media";

describe("media", () => {
  const originalMediaDevices = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: originalMediaDevices,
    });
  });

  it("returns the stream from the first successful constraints profile", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const result = await getLocalMediaStream();

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(targetMediaConstraints);
  });

  it("falls back to the next constraints profile when the first one fails", async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("Constraint issue", "OverconstrainedError"))
      .mockResolvedValueOnce(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    const result = await getLocalMediaStream();

    expect(result).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("maps permission-denied errors to DEVICE_DENIED", async () => {
    const getUserMedia = vi
      .fn()
      .mockRejectedValue(
        new DOMException("Permission blocked", "NotAllowedError"),
      );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(getLocalMediaStream()).rejects.toThrow(CallFailureCode.DEVICE_DENIED);
  });

  it("maps unsupported media access to MEDIA_UNSUPPORTED", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: undefined,
    });

    await expect(getLocalMediaStream()).rejects.toThrow(
      CallFailureCode.MEDIA_UNSUPPORTED,
    );
  });
});
