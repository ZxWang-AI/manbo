import { describe, expect, it } from "vitest";

import {
  AesGcmConversationTurnSnapshotCipher,
  createConversationTurnSnapshotCipherFromEnv,
  conversationTurnSnapshotAad,
  type ConversationTurnSnapshot,
} from "@/server/services/conversation-turn-snapshot-cipher";

const key = Buffer.alloc(32, 0x2a);
const wrongKey = Buffer.alloc(32, 0x7f);

const snapshot: ConversationTurnSnapshot = {
  assistant: {
    state: "FACT_GATHERING",
    message: "仅保存用于重放的结构化摘要。",
    degraded: false,
  },
  caseVersion: 4,
};

describe("conversation turn snapshot cipher", () => {
  it("encrypts and decrypts a JSON snapshot with a strict AES-256-GCM envelope", async () => {
    const cipher = new AesGcmConversationTurnSnapshotCipher({
      key,
      keyVersion: "turn-v1",
    });

    const envelope = await cipher.encrypt(snapshot);

    expect(envelope).toMatchObject({
      scheme: "AES-256-GCM",
      keyVersion: "turn-v1",
    });
    expect(Object.keys(envelope).sort()).toEqual([
      "authenticationTag",
      "ciphertext",
      "initializationVector",
      "keyVersion",
      "scheme",
    ]);
    expect(JSON.stringify(envelope)).not.toContain("仅保存用于重放");
    await expect(cipher.decrypt(envelope)).resolves.toEqual(snapshot);
  });

  it("authenticates optional AAD and requires the same AAD on decrypt", async () => {
    const cipher = new AesGcmConversationTurnSnapshotCipher({
      key,
      keyVersion: "turn-v1",
    });
    const aad = "case:case-1/turn:turn-1";
    const envelope = await cipher.encrypt(snapshot, { aad });

    await expect(cipher.decrypt(envelope, { aad })).resolves.toEqual(snapshot);
    await expect(cipher.decrypt(envelope)).rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt(envelope, { aad: "case:case-1/turn:turn-2" }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
  });

  it("fails closed for ciphertext, authentication tag, IV, and key tampering", async () => {
    const cipher = new AesGcmConversationTurnSnapshotCipher({
      key,
      keyVersion: "turn-v1",
    });
    const envelope = await cipher.encrypt(snapshot);
    const flip = (value: string): string => {
      const bytes = Buffer.from(value, "base64url");
      bytes[0] = bytes[0]! ^ 0xff;
      return bytes.toString("base64url");
    };

    await expect(cipher.decrypt({ ...envelope, ciphertext: flip(envelope.ciphertext) }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt({ ...envelope, authenticationTag: flip(envelope.authenticationTag) }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt({ ...envelope, initializationVector: flip(envelope.initializationVector) }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");

    const otherCipher = new AesGcmConversationTurnSnapshotCipher({
      key: wrongKey,
      keyVersion: "turn-v1",
    });
    await expect(otherCipher.decrypt(envelope)).rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
  });

  it("rejects key-version mismatches and every non-strict or malformed envelope", async () => {
    const cipher = new AesGcmConversationTurnSnapshotCipher({
      key,
      keyVersion: "turn-v1",
    });
    const envelope = await cipher.encrypt(snapshot);

    await expect(cipher.decrypt({ ...envelope, keyVersion: "turn-v2" }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt({ ...envelope, unexpected: true }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt({ ...envelope, authenticationTag: "not-base64url" }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt({ ...envelope, initializationVector: "AA" }))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
    await expect(cipher.decrypt(null)).rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INVALID");
  });

  it("rejects invalid keys and non-JSON snapshot values without exposing key material", async () => {
    expect(() => new AesGcmConversationTurnSnapshotCipher({
      key: Buffer.alloc(31),
      keyVersion: "turn-v1",
    })).toThrow("CONVERSATION_TURN_SNAPSHOT_KEY_INVALID");
    expect(() => new AesGcmConversationTurnSnapshotCipher({
      key,
      keyVersion: "turn v1",
    })).toThrow("CONVERSATION_TURN_SNAPSHOT_KEY_INVALID");

    const cipher = new AesGcmConversationTurnSnapshotCipher({
      key,
      keyVersion: "turn-v1",
    });
    await expect(cipher.encrypt({ invalid: undefined } as unknown as ConversationTurnSnapshot))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INPUT_INVALID");
    await expect(cipher.encrypt({ invalid: Number.NaN } as unknown as ConversationTurnSnapshot))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INPUT_INVALID");
    await expect(cipher.encrypt([] as unknown as ConversationTurnSnapshot))
      .rejects.toThrow("CONVERSATION_TURN_SNAPSHOT_INPUT_INVALID");

    const error = await cipher.decrypt({
      scheme: "AES-256-GCM",
      keyVersion: "turn-v1",
      initializationVector: "AA",
      authenticationTag: "AA",
      ciphertext: "AA",
    }).catch((cause: unknown) => cause as Error);
    expect(error.message).toBe("CONVERSATION_TURN_SNAPSHOT_INVALID");
    expect(error.message).not.toContain(key.toString("hex"));
  });

  it("binds snapshots to an opaque account/case/turn context and fails closed when production config is absent", () => {
    expect(conversationTurnSnapshotAad("acct", "case", "turn")).toBe("acct:case:turn");
    expect(createConversationTurnSnapshotCipherFromEnv({})).toMatchObject({
      available: false,
      reason: "not_configured",
    });
    expect(createConversationTurnSnapshotCipherFromEnv({
      CONVERSATION_TURN_MASTER_KEY: "a".repeat(64),
      CONVERSATION_TURN_KEY_VERSION: "turn-v1",
    })).toMatchObject({ available: true });
  });
});
