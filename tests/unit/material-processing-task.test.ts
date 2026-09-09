import { describe, expect, it, vi } from "vitest";

import type { MaterialProcessingRecord } from "@/domain/material";
import type { MaterialObjectReader } from "@/media/storage/object-store";
import { MaterialProcessingTaskService } from "@/server/services/material-processing-task-service";

function record(): MaterialProcessingRecord {
  return {
    materialId: "material-a",
    declaredMime: "application/pdf",
    originalFilename: "statement.pdf",
    processingState: "quarantined",
    processingVersion: 1,
    detectedMime: null,
    signatureStatus: "unknown",
    eligibleForAi: false,
  };
}

describe("material processing task", () => {
  it("reads the encrypted source and delegates bytes plus metadata to the processor", async () => {
    const readDecryptedObject = vi.fn<MaterialObjectReader["readDecryptedObject"]>().mockResolvedValue({
      body: new Uint8Array(Buffer.from("%PDF-1.7\nfixture")),
      contentLength: 16,
    });
    const process = vi.fn().mockResolvedValue({ ...record(), processingState: "parsed", eligibleForAi: true });
    const task = new MaterialProcessingTaskService(
      {
        getSource: vi.fn().mockResolvedValue({
          ...record(),
          objectKey: "materials/11111111111111111111111111111111",
          encryptionScheme: "AES-256-GCM",
          keyVersion: "local-v1",
          wrappedKey: "wrapped",
        }),
      },
      { readDecryptedObject },
      { process },
      { scan: vi.fn().mockResolvedValue({ verdict: "clean" }) },
    );

    await expect(task.run({ accountId: "a".repeat(32), caseId: "case-a", materialId: "material-a" }))
      .resolves.toMatchObject({ processingState: "parsed", eligibleForAi: true });
    expect(readDecryptedObject).toHaveBeenCalledWith({
      objectKey: "materials/11111111111111111111111111111111",
      encryptionScheme: "AES-256-GCM",
      keyVersion: "local-v1",
      wrappedKey: "wrapped",
    });
    expect(process).toHaveBeenCalledWith(expect.objectContaining({
      materialId: "material-a",
      declaredMime: "application/pdf",
      originalFilename: "statement.pdf",
      bytes: expect.any(Uint8Array),
    }));
  });

  it("rejects a missing or unusable encrypted source before invoking processing", async () => {
    const process = vi.fn();
    const task = new MaterialProcessingTaskService(
      { getSource: vi.fn().mockResolvedValue(null) },
      { readDecryptedObject: vi.fn() },
      { process },
      { scan: vi.fn() },
    );

    await expect(task.run({ accountId: "a".repeat(32), caseId: "case-a", materialId: "missing" }))
      .rejects.toThrow("MATERIAL_SOURCE_UNAVAILABLE");
    expect(process).not.toHaveBeenCalled();
  });
});
