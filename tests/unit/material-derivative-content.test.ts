import { describe, expect, it } from "vitest";

import {
  AesGcmMaterialDerivativeContentCipher,
  createMaterialDerivativeContentCipherFromEnv,
} from "@/media/security/material-derivative-content";

describe("encrypted material derivative content", () => {
  it("round-trips text without exposing plaintext in the envelope", async () => {
    const cipher = new AesGcmMaterialDerivativeContentCipher({
      key: Buffer.alloc(32, 7),
      keyVersion: "derivative-v1",
    });

    const envelope = await cipher.encrypt({
      text: "工资记录与工作时间的安全摘录",
      sourceSpans: [{ start: 0, end: 6 }],
    });

    expect(JSON.stringify(envelope)).not.toContain("工资记录");
    await expect(cipher.decrypt(envelope)).resolves.toEqual({
      text: "工资记录与工作时间的安全摘录",
      sourceSpans: [{ start: 0, end: 6 }],
    });
  });

  it("rejects a tampered authentication tag", async () => {
    const cipher = new AesGcmMaterialDerivativeContentCipher({
      key: Buffer.alloc(32, 8),
      keyVersion: "derivative-v1",
    });
    const envelope = await cipher.encrypt({ text: "safe text" });

    await expect(cipher.decrypt({ ...envelope, authenticationTag: `${envelope.authenticationTag}x` }))
      .rejects.toThrow("MATERIAL_DERIVATIVE_CONTENT_INVALID");
  });

  it("fails closed when the derivative key is not configured", () => {
    expect(createMaterialDerivativeContentCipherFromEnv({
      NODE_ENV: "production",
      APP_MODE: "normal",
    })).toEqual({ available: false, reason: "not_configured" });
  });

  it("accepts a reviewed key configuration without returning the key", () => {
    const configuration = createMaterialDerivativeContentCipherFromEnv({
      NODE_ENV: "production",
      APP_MODE: "normal",
      MATERIAL_DERIVATIVE_MASTER_KEY: "a".repeat(64),
      MATERIAL_DERIVATIVE_KEY_VERSION: "derivative-v1",
    });

    expect(configuration).toMatchObject({ available: true });
    expect(JSON.stringify(configuration)).not.toContain("a".repeat(64));
  });
});
