import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { z } from "zod";

const ENVELOPE_SCHEME = "AES-256-GCM" as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const MAX_KEY_VERSION_LENGTH = 80;
const MAX_AAD_BYTES = 4_096;
const MAX_SNAPSHOT_BYTES = 4_000_000;
const MAX_CIPHERTEXT_BASE64URL_LENGTH = Math.ceil(MAX_SNAPSHOT_BYTES * 4 / 3) + 4;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;

/** A JSON value accepted by the snapshot boundary. */
export type ConversationTurnSnapshotJsonValue =
  | string
  | number
  | boolean
  | null
  | ConversationTurnSnapshotJsonValue[]
  | { [key: string]: ConversationTurnSnapshotJsonValue };

/** The persisted turn snapshot must be a JSON object, never an opaque blob. */
export type ConversationTurnSnapshot = {
  [key: string]: ConversationTurnSnapshotJsonValue;
};

const base64urlField = (max: number) => z
  .string()
  .min(1)
  .max(max)
  .regex(BASE64URL_PATTERN);

/**
 * The only JSON shape this module emits. AAD is deliberately not embedded:
 * callers must supply the expected context again during decrypt so an
 * attacker cannot replace context by copying an envelope field.
 */
export const conversationTurnSnapshotEnvelopeSchema = z.strictObject({
  scheme: z.literal(ENVELOPE_SCHEME),
  keyVersion: z.string()
    .min(1)
    .max(MAX_KEY_VERSION_LENGTH)
    .regex(/^[A-Za-z0-9._-]+$/u),
  initializationVector: base64urlField(32),
  authenticationTag: base64urlField(32),
  ciphertext: base64urlField(MAX_CIPHERTEXT_BASE64URL_LENGTH),
});

export type ConversationTurnSnapshotEnvelope = z.infer<
  typeof conversationTurnSnapshotEnvelopeSchema
>;

export interface ConversationTurnSnapshotCipherOptions {
  /** Exactly 32 bytes. The cipher copies it and never serializes it. */
  key: Uint8Array;
  /** Deployment/KMS key identifier, not the key itself. */
  keyVersion: string;
}

export interface ConversationTurnSnapshotCryptoOptions {
  /** Optional caller-supplied context authenticated by AES-GCM. */
  aad?: string | Uint8Array;
}

export interface ConversationTurnSnapshotCipher {
  encrypt(
    snapshot: unknown,
    options?: ConversationTurnSnapshotCryptoOptions,
  ): Promise<ConversationTurnSnapshotEnvelope>;
  decrypt(
    envelope: unknown,
    options?: ConversationTurnSnapshotCryptoOptions,
  ): Promise<ConversationTurnSnapshot>;
}

function keyConfigurationError(): TypeError {
  return new TypeError("CONVERSATION_TURN_SNAPSHOT_KEY_INVALID");
}

function inputError(): Error {
  return new Error("CONVERSATION_TURN_SNAPSHOT_INPUT_INVALID");
}

function envelopeError(): Error {
  // One error for schema, key-version, AAD, authentication, and JSON failures
  // keeps decrypt fail-closed without exposing which security check failed.
  return new Error("CONVERSATION_TURN_SNAPSHOT_INVALID");
}

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
): asserts value is ConversationTurnSnapshotJsonValue {
  if (depth > 64) throw inputError();
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw inputError();
    return;
  }
  if (typeof value !== "object") throw inputError();
  if (seen.has(value)) throw inputError();
  seen.add(value);

  if (Array.isArray(value)) {
    // JSON.stringify turns holes into null. Rejecting them avoids an implicit
    // data change at the encryption boundary.
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw inputError();
      assertJsonValue(value[index], seen, depth + 1);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol" || (key !== "length" && !/^\d+$/u.test(key))) {
        throw inputError();
      }
    }
  } else {
    if (!isPlainJsonObject(value)) throw inputError();
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw inputError();
      // Only enumerable own fields are represented by JSON.stringify. Refuse
      // hidden fields so the authenticated payload is exactly what callers see.
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable) throw inputError();
      assertJsonValue(value[key], seen, depth + 1);
    }
  }

  seen.delete(value);
}

function serializeSnapshot(snapshot: unknown): Buffer {
  try {
    if (!isPlainJsonObject(snapshot)) throw inputError();
    assertJsonValue(snapshot, new WeakSet<object>(), 0);
    const serialized = JSON.stringify(snapshot);
    if (typeof serialized !== "string") throw inputError();
    const plaintext = Buffer.from(serialized, "utf8");
    if (plaintext.byteLength === 0 || plaintext.byteLength > MAX_SNAPSHOT_BYTES) {
      throw inputError();
    }
    return plaintext;
  } catch (error) {
    if (error instanceof Error && error.message === "CONVERSATION_TURN_SNAPSHOT_INPUT_INVALID") {
      throw error;
    }
    throw inputError();
  }
}

function normalizeAad(value: string | Uint8Array | undefined): Buffer | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" && !(value instanceof Uint8Array)) throw inputError();
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
  if (bytes.byteLength > MAX_AAD_BYTES) throw inputError();
  return bytes.byteLength === 0 ? undefined : bytes;
}

function decodeBase64url(value: string, expectedBytes: number): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw envelopeError();
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw envelopeError();
  }
  if (
    decoded.byteLength !== expectedBytes
    || decoded.toString("base64url") !== value
  ) {
    throw envelopeError();
  }
  return decoded;
}

function decodeCiphertext(value: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) throw envelopeError();
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw envelopeError();
  }
  if (
    decoded.byteLength === 0
    || decoded.byteLength > MAX_SNAPSHOT_BYTES
    || decoded.toString("base64url") !== value
  ) {
    throw envelopeError();
  }
  return decoded;
}

function parseDecryptedSnapshot(plaintext: Buffer): ConversationTurnSnapshot {
  try {
    const parsed: unknown = JSON.parse(plaintext.toString("utf8"));
    if (!isPlainJsonObject(parsed)) throw envelopeError();
    // Decrypted data is untrusted too: validate before returning it to a
    // repository or route.
    assertJsonValue(parsed, new WeakSet<object>(), 0);
    return parsed as ConversationTurnSnapshot;
  } catch {
    throw envelopeError();
  }
}

/**
 * Application-level AES-256-GCM protection for persisted conversation turn
 * snapshots. The key remains private to this instance and is never logged or
 * copied into the JSON envelope.
 */
export class AesGcmConversationTurnSnapshotCipher implements ConversationTurnSnapshotCipher {
  readonly keyVersion: string;
  #key: Buffer;

  constructor(options: ConversationTurnSnapshotCipherOptions) {
    if (
      !options
      || !(options.key instanceof Uint8Array)
      || options.key.byteLength !== KEY_BYTES
      || typeof options.keyVersion !== "string"
      || !/^[A-Za-z0-9._-]{1,80}$/u.test(options.keyVersion)
    ) {
      throw keyConfigurationError();
    }
    this.#key = Buffer.from(options.key);
    this.keyVersion = options.keyVersion;
  }

  async encrypt(
    snapshot: unknown,
    options?: ConversationTurnSnapshotCryptoOptions,
  ): Promise<ConversationTurnSnapshotEnvelope> {
    const plaintext = serializeSnapshot(snapshot);
    const aad = normalizeAad(options?.aad);
    try {
      const initializationVector = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", this.#key, initializationVector);
      if (aad) cipher.setAAD(aad);
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        scheme: ENVELOPE_SCHEME,
        keyVersion: this.keyVersion,
        initializationVector: initializationVector.toString("base64url"),
        authenticationTag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      };
    } catch {
      // Do not expose crypto-library details or any accidental plaintext/key
      // material in an application error.
      throw inputError();
    }
  }

  async decrypt(
    envelope: unknown,
    options?: ConversationTurnSnapshotCryptoOptions,
  ): Promise<ConversationTurnSnapshot> {
    try {
      const parsedEnvelope = conversationTurnSnapshotEnvelopeSchema.parse(envelope);
      if (parsedEnvelope.keyVersion !== this.keyVersion) throw envelopeError();
      const initializationVector = decodeBase64url(parsedEnvelope.initializationVector, IV_BYTES);
      const authenticationTag = decodeBase64url(
        parsedEnvelope.authenticationTag,
        AUTHENTICATION_TAG_BYTES,
      );
      const ciphertext = decodeCiphertext(parsedEnvelope.ciphertext);
      const aad = normalizeAad(options?.aad);
      const decipher = createDecipheriv("aes-256-gcm", this.#key, initializationVector);
      if (aad) decipher.setAAD(aad);
      decipher.setAuthTag(authenticationTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return parseDecryptedSnapshot(plaintext);
    } catch {
      // Authentication failures, wrong keys, malformed envelopes, key-version
      // mismatches, AAD mismatches, and invalid decrypted JSON are equivalent
      // from the caller's perspective: the snapshot is unavailable.
      throw envelopeError();
    }
  }
}

/** Stable authenticated context for one account/case/turn scope. */
export function conversationTurnSnapshotAad(
  accountId: string,
  caseId: string,
  turnId: string,
): string {
  if (![accountId, caseId, turnId].every((value) =>
    typeof value === "string" && value.length > 0 && !/[\u0000\r\n:]/u.test(value),
  )) {
    throw new TypeError("CONVERSATION_TURN_SNAPSHOT_CONTEXT_INVALID");
  }
  return `${accountId}:${caseId}:${turnId}`;
}

export type ConversationTurnSnapshotCipherConfiguration =
  | { available: true; cipher: AesGcmConversationTurnSnapshotCipher }
  | { available: false; reason: "not_configured" | "invalid_configuration" };

function parseHexKey(value: string | undefined): Uint8Array | null {
  if (!value || !/^[a-f0-9]{64}$/iu.test(value)) return null;
  const key = Buffer.from(value, "hex");
  return key.byteLength === KEY_BYTES ? key : null;
}

/** Read the turn-snapshot key from deployment secrets without exposing it. */
export function createConversationTurnSnapshotCipherFromEnv(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): ConversationTurnSnapshotCipherConfiguration {
  const rawKey = environment.CONVERSATION_TURN_MASTER_KEY?.trim();
  const keyVersion = environment.CONVERSATION_TURN_KEY_VERSION?.trim();
  if (!rawKey && !keyVersion) return { available: false, reason: "not_configured" };
  const key = parseHexKey(rawKey);
  if (!key || !keyVersion) return { available: false, reason: "invalid_configuration" };
  try {
    return {
      available: true,
      cipher: new AesGcmConversationTurnSnapshotCipher({ key, keyVersion }),
    };
  } catch {
    return { available: false, reason: "invalid_configuration" };
  }
}
