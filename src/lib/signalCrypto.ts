import { base64ToBytes, bytesToBase64 } from "./base64";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const PBKDF2_ITERATIONS = 600_000;
const KEY_LENGTH_BITS = 256;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

export interface EncryptedBlob {
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
}

function buildAesGcmParams(iv: Uint8Array, additionalData?: string): AesGcmParams {
  if (!additionalData) {
    return { name: "AES-GCM", iv: toArrayBuffer(iv) };
  }

  return {
    name: "AES-GCM",
    iv: toArrayBuffer(iv),
    additionalData: toArrayBuffer(textEncoder.encode(additionalData)),
  };
}

function ensureWebCrypto(): Crypto {
  if (typeof globalThis.crypto === "undefined") {
    throw new Error("Web Crypto is not available in this environment.");
  }
  return globalThis.crypto;
}

async function deriveAesKey(
  passphrase: string,
  roomCode: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const cryptoProvider = ensureWebCrypto();
  const keyMaterial = await cryptoProvider.subtle.importKey(
    "raw",
    toArrayBuffer(textEncoder.encode(`${passphrase}:${roomCode}`)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return cryptoProvider.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptJsonPayload(
  payload: unknown,
  passphrase: string,
  roomCode: string,
  additionalData?: string,
): Promise<EncryptedBlob> {
  const cryptoProvider = ensureWebCrypto();
  const salt = cryptoProvider.getRandomValues(new Uint8Array(16));
  const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, roomCode, salt);
  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const ciphertextBuffer = await cryptoProvider.subtle.encrypt(
    buildAesGcmParams(iv, additionalData),
    key,
    toArrayBuffer(plaintext),
  );

  return {
    saltB64: bytesToBase64(salt),
    ivB64: bytesToBase64(iv),
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertextBuffer)),
  };
}

export async function decryptJsonPayload<T>(
  encryptedBlob: EncryptedBlob,
  passphrase: string,
  roomCode: string,
  additionalData?: string,
): Promise<T> {
  const cryptoProvider = ensureWebCrypto();
  const salt = base64ToBytes(encryptedBlob.saltB64);
  const iv = base64ToBytes(encryptedBlob.ivB64);
  const ciphertext = base64ToBytes(encryptedBlob.ciphertextB64);
  const key = await deriveAesKey(passphrase, roomCode, salt);

  let plaintextBuffer: ArrayBuffer;
  try {
    plaintextBuffer = await cryptoProvider.subtle.decrypt(
      buildAesGcmParams(iv, additionalData),
      key,
      toArrayBuffer(ciphertext),
    );
  } catch (error) {
    throw new Error("DECRYPTION_FAILED", { cause: error });
  }

  const plaintext = textDecoder.decode(plaintextBuffer);
  return JSON.parse(plaintext) as T;
}
