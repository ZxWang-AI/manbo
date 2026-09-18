import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

const ENVELOPE_SCHEME = "AES-256-GCM" as const;
const MAX_DERIVATIVE_CHARACTERS = 1_000_000;
const MAX_SOURCE_SPANS = 10_000;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

const sourceSpanSchema = z.strictObject({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});

const payloadSchema = z.strictObject({
  text: z.string().min(1).max(MAX_DERIVATIVE_CHARACTERS),
  sourceSpans: z.array(sourceSpanSchema).max(MAX_SOURCE_SPANS).optional(),
});

const envelopeSchema = z.strictObject({
  scheme: z.literal(ENVELOPE_SCHEME),
  keyVersion: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/u),
  initializationVector: z.string().min(1).max(32),
  authenticationTag: z.string().min(1).max(32),
  ciphertext: z.string().min(1).max(8_000_000),
});

export type MaterialDerivativePayload = z.infer<typeof payloadSchema>;
export type EncryptedMaterialDerivativeContent = z.infer<typeof envelopeSchema>;

export interface MaterialDerivativeContentCipher {
  encrypt(payload: MaterialDerivativePayload): Promise<EncryptedMaterialDerivativeContent>;
  decrypt(envelope: unknown): Promise<MaterialDerivativePayload>;
}

export interface AesGcmMaterialDerivativeContentCipherOptions {
  key: Uint8Array;
  keyVersion: string;
}

function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string, field: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error(`MATERIAL_DERIVATIVE_${field}_INVALID`);
  }
  try {
    return Buffer.from(value, "base64url");
  } catch {
    throw new Error(`MATERIAL_DERIVATIVE_${field}_INVALID`);
  }
}

function validatePayload(payload: MaterialDerivativePayload): MaterialDerivativePayload {
  const parsed = payloadSchema.parse(payload);
  if (parsed.sourceSpans?.some((span) => span.start > span.end || span.end > parsed.text.length)) {
    throw new Error("MATERIAL_DERIVATIVE_CONTENT_INVALID");
  }
  return parsed;
}

function contentError(): Error {
  return new Error("MATERIAL_DERIVATIVE_CONTENT_INVALID");
}

/**
 * Encrypts parsed material text before it is persisted. The key is supplied by
 * a deployment-level secret/KMS adapter; this class never serializes the key.
 */
export class AesGcmMaterialDerivativeContentCipher implements MaterialDerivativeContentCipher {
  readonly keyVersion: string;
  #key: Buffer;

  constructor(options: AesGcmMaterialDerivativeContentCipherOptions) {
    if (!(options.key instanceof Uint8Array) || options.key.byteLength !== 32) {
      throw new TypeError("MATERIAL_DERIVATIVE_MASTER_KEY must contain 32 bytes");
    }
    if (!/^[A-Za-z0-9._-]{1,80}$/u.test(options.keyVersion)) {
      throw new TypeError("MATERIAL_DERIVATIVE_KEY_VERSION is invalid");
    }
    this.#key = Buffer.from(options.key);
    this.keyVersion = options.keyVersion;
  }

  async encrypt(payload: MaterialDerivativePayload): Promise<EncryptedMaterialDerivativeContent> {
    const parsed = validatePayload(payload);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, initializationVector);
    const plaintext = Buffer.from(JSON.stringify(parsed), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      scheme: ENVELOPE_SCHEME,
      keyVersion: this.keyVersion,
      initializationVector: encodeBase64Url(initializationVector),
      authenticationTag: encodeBase64Url(cipher.getAuthTag()),
      ciphertext: encodeBase64Url(ciphertext),
    };
  }

  async decrypt(envelope: unknown): Promise<MaterialDerivativePayload> {
    let parsedEnvelope: EncryptedMaterialDerivativeContent;
    try {
      parsedEnvelope = envelopeSchema.parse(envelope);
    } catch {
      throw contentError();
    }
    if (parsedEnvelope.keyVersion !== this.keyVersion) throw contentError();

    try {
      const initializationVector = decodeBase64Url(parsedEnvelope.initializationVector, "IV");
      const authenticationTag = decodeBase64Url(parsedEnvelope.authenticationTag, "AUTH_TAG");
      const ciphertext = decodeBase64Url(parsedEnvelope.ciphertext, "CIPHERTEXT");
      if (initializationVector.byteLength !== 12 || authenticationTag.byteLength !== 16) {
        throw contentError();
      }
      const decipher = createDecipheriv("aes-256-gcm", this.#key, initializationVector);
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const payload = JSON.parse(plaintext.toString("utf8")) as unknown;
      return validatePayload(payload as MaterialDerivativePayload);
    } catch {
      throw contentError();
    }
  }
}

export type MaterialDerivativeContentCipherConfiguration =
  | { available: true; cipher: AesGcmMaterialDerivativeContentCipher }
  | { available: false; reason: "not_configured" | "invalid_configuration" };

function parseHexKey(value: string | undefined): Uint8Array | null {
  if (!value || !/^[a-f0-9]{64}$/iu.test(value)) return null;
  const key = Buffer.from(value, "hex");
  return key.byteLength === 32 ? key : null;
}

export function createMaterialDerivativeContentCipherFromEnv(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): MaterialDerivativeContentCipherConfiguration {
  const key = parseHexKey(environment.MATERIAL_DERIVATIVE_MASTER_KEY?.trim());
  const keyVersion = environment.MATERIAL_DERIVATIVE_KEY_VERSION?.trim();
  if (!environment.MATERIAL_DERIVATIVE_MASTER_KEY && !keyVersion) {
    return { available: false, reason: "not_configured" };
  }
  if (!key || !keyVersion) return { available: false, reason: "invalid_configuration" };
  try {
    return {
      available: true,
      cipher: new AesGcmMaterialDerivativeContentCipher({ key, keyVersion }),
    };
  } catch {
    return { available: false, reason: "invalid_configuration" };
  }
}
