import { CallFailureCode } from "../types/contracts";

export const targetMediaConstraints: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
  video: {
    facingMode: "user",
    width: { ideal: 960, max: 1280 },
    height: { ideal: 540, max: 720 },
    frameRate: { ideal: 24, max: 30 },
  },
};

const fallbackMediaConstraints: MediaStreamConstraints[] = [
  targetMediaConstraints,
  {
    audio: true,
    video: {
      facingMode: "user",
      width: { ideal: 640, max: 1280 },
      height: { ideal: 360, max: 720 },
      frameRate: { ideal: 24, max: 30 },
    },
  },
  {
    audio: true,
    video: true,
  },
];

function isPermissionDeniedError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
  );
}

export async function getLocalMediaStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(CallFailureCode.MEDIA_UNSUPPORTED);
  }

  let lastError: unknown = null;
  for (const constraints of fallbackMediaConstraints) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        throw new Error(CallFailureCode.DEVICE_DENIED, { cause: error });
      }
      lastError = error;
    }
  }

  if (isPermissionDeniedError(lastError)) {
    throw new Error(CallFailureCode.DEVICE_DENIED, { cause: lastError });
  }

  throw new Error(CallFailureCode.MEDIA_UNSUPPORTED, { cause: lastError });
}
