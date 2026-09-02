import { describe, expect, it } from "vitest";

import {
  decryptEnvelope,
  encryptEnvelope,
  type EnvelopeKeyWrapper,
} from "@/media/storage/envelope-encryption";

const wrapper: EnvelopeKeyWrapper = {
  keyVersion: "kek-v1",
  wrap: async (key) => Buffer.from(key).toString("base64url"),
  unwrap: async (wrapped) => Buffer.from(wrapped, "base64url"),
};

describe("envelope encryption", () => {
  it("round-trips bytes with AES-256-GCM and wrapped per-object key metadata", async () => {
    const plaintext = Buffer.from("private evidence bytes");
    const encrypted = await encryptEnvelope(plaintext, wrapper, () => Buffer.alloc(32, 7));

    expect(encrypted.scheme).toBe("AES-256-GCM");
    expect(encrypted.keyVersion).toBe("kek-v1");
    expect(encrypted.wrappedKey).not.toContain(plaintext.toString("utf8"));
    await expect(decryptEnvelope(encrypted, wrapper)).resolves.toEqual(plaintext);
  });

  it("fails closed when ciphertext or authentication metadata is modified", async () => {
    const encrypted = await encryptEnvelope(
      Buffer.from("private evidence bytes"),
      wrapper,
      () => Buffer.alloc(32, 8),
    );
    const tamperedCiphertext = Buffer.from(encrypted.ciphertext, "base64url");
    tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 0xff;
    const tampered = {
      ...encrypted,
      ciphertext: tamperedCiphertext.toString("base64url"),
    };

    await expect(decryptEnvelope(tampered, wrapper)).rejects.toThrow();
  });
});
