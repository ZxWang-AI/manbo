import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type BinaryLike,
} from "node:crypto";

export interface EnvelopeKeyWrapper {
  keyVersion: string;
  wrap(dataEncryptionKey: Uint8Array): Promise<string>;
  unwrap(wrappedDataEncryptionKey: string): Promise<Uint8Array>;
}

export interface EncryptedEnvelope {
  scheme: "AES-256-GCM";
  keyVersion: string;
  wrappedKey: string;
  initializationVector: string;
  authenticationTag: string;
  ciphertext: string;
}

export async function encryptEnvelope(
  plaintext: Uint8Array,
  keyWrapper: EnvelopeKeyWrapper,
  generateDataEncryptionKey: () => Uint8Array = () => randomBytes(32),
): Promise<EncryptedEnvelope> {
  const dataEncryptionKey = generateDataEncryptionKey();
  if (dataEncryptionKey.byteLength !== 32) {
    throw new Error("Envelope data-encryption key must contain 32 bytes");
  }
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    dataEncryptionKey as BinaryLike,
    initializationVector,
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    scheme: "AES-256-GCM",
    keyVersion: keyWrapper.keyVersion,
    wrappedKey: await keyWrapper.wrap(dataEncryptionKey),
    initializationVector: initializationVector.toString("base64url"),
    authenticationTag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}

export async function decryptEnvelope(
  envelope: EncryptedEnvelope,
  keyWrapper: EnvelopeKeyWrapper,
): Promise<Buffer> {
  if (envelope.scheme !== "AES-256-GCM") {
    throw new Error("Unsupported envelope encryption scheme");
  }
  if (envelope.keyVersion !== keyWrapper.keyVersion) {
    throw new Error("Envelope key version does not match the key wrapper");
  }
  const dataEncryptionKey = await keyWrapper.unwrap(envelope.wrappedKey);
  if (dataEncryptionKey.byteLength !== 32) {
    throw new Error("Unwrapped data-encryption key must contain 32 bytes");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    dataEncryptionKey as BinaryLike,
    Buffer.from(envelope.initializationVector, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]);
}
