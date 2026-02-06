import { CallFailureCode } from "../types/contracts";

export const targetMediaConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: {
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};

export async function getLocalMediaStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(CallFailureCode.MEDIA_UNSUPPORTED);
  }

  try {
    return await navigator.mediaDevices.getUserMedia(targetMediaConstraints);
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
    ) {
      throw new Error(CallFailureCode.DEVICE_DENIED, { cause: error });
    }

    throw new Error(CallFailureCode.MEDIA_UNSUPPORTED, { cause: error });
  }
}
