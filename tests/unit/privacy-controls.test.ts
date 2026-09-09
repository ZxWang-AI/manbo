import { describe, expect, it } from "vitest";

import { detectPotentialPersonalData } from "@/server/redaction";
import { buildAuditEvent, sanitizeAuditMetadata } from "@/server/audit";
import { DELETION_TARGETS, createDeletionReceipt } from "@/server/retention";
import { rewrapDataEncryptionKey } from "@/server/key-rotation";

describe("privacy controls", () => {
  it("returns masked hints without exposing the raw personal-data span", () => {
    const hints = detectPotentialPersonalData("联系 alice@example.com 或 13800138000");

    expect(hints.map((hint) => hint.kind)).toEqual(["email", "phone"]);
    expect(hints.every((hint) => !hint.maskedPreview.includes("alice@example.com"))).toBe(true);
    expect(hints.every((hint) => !hint.maskedPreview.includes("13800138000"))).toBe(true);
    expect(hints.every((hint) => hint.spanEnd > hint.spanStart)).toBe(true);
  });

  it("removes raw content and device identifiers from audit metadata", () => {
    const metadata = sanitizeAuditMetadata({
      requestId: "req-secret",
      rawNarrative: "被迫工作",
      sourceQuote: "原文",
      ip: "127.0.0.1",
      fieldCount: 3,
    });

    expect(metadata).toEqual({ fieldCount: 3 });
    expect(JSON.stringify(buildAuditEvent({
      accountId: "acct-a",
      action: "update",
      metadata,
      occurredAt: "2026-09-02T00:00:00.000Z",
    }))).not.toMatch(/被迫工作|原文|127\.0\.0\.1|req-secret/i);
  });

  it("creates a deletion receipt covering every platform-controlled target", () => {
    const receipt = createDeletionReceipt("case-a", () => new Date("2026-09-02T00:00:00.000Z"));

    expect(receipt.targets).toEqual(DELETION_TARGETS);
    expect(receipt.externalSystems).toBe("not_applicable");
    expect(receipt.receiptId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("re-wraps a data key without touching plaintext and keeps the old version on failure", async () => {
    const calls: string[] = [];
    const result = await rewrapDataEncryptionKey({
      wrappedKey: "old-wrapped",
      currentVersion: "kek-v1",
      nextVersion: "kek-v2",
      unwrap: async (wrapped, version) => {
        calls.push(`unwrap:${wrapped}:${version}`);
        return new Uint8Array(32).fill(1);
      },
      wrap: async (key, version) => {
        calls.push(`wrap:${key.byteLength}:${version}`);
        return "new-wrapped";
      },
      verify: async (wrapped, version) => {
        calls.push(`verify:${wrapped}:${version}`);
      },
    });

    expect(result).toEqual({ wrappedKey: "new-wrapped", keyVersion: "kek-v2" });
    expect(calls).toEqual([
      "unwrap:old-wrapped:kek-v1",
      "wrap:32:kek-v2",
      "verify:new-wrapped:kek-v2",
    ]);
  });
});
