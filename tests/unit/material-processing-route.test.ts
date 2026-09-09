import { describe, expect, it, vi } from "vitest";

import { createMaterialProcessingPostHandler } from "@/app/api/cases/[caseId]/materials/[materialId]/process/route";
import type { MaterialProcessingSource } from "@/server/services/material-processing-task-service";
import { makeCaseRecordFixture } from "../fixtures/case-record";

const accountId = "a".repeat(32);
const caseId = "case-a";
const materialId = "material-a";

const source: MaterialProcessingSource = {
  materialId,
  declaredMime: "application/pdf",
  originalFilename: "statement.pdf",
  processingState: "scan_failed",
  processingVersion: 2,
  detectedMime: "application/pdf",
  signatureStatus: "match",
  eligibleForAi: false,
  objectKey: "materials/11111111111111111111111111111111",
  encryptionScheme: "AES-256-GCM",
  keyVersion: "local-v1",
  wrappedKey: "wrapped",
};

function privateCase() {
  return { ...makeCaseRecordFixture(), caseId, accountId };
}

function request() {
  return new Request(`http://localhost/api/cases/${caseId}/materials/${materialId}/process`, {
    method: "POST",
    headers: { cookie: "manbo_session=opaque-session" },
  });
}

describe("POST /api/cases/[caseId]/materials/[materialId]/process", () => {
  it("queues a retry only after private-case and material ownership checks", async () => {
    const enqueue = vi.fn().mockResolvedValue({ jobId: "job-a", status: "pending" });
    const handler = createMaterialProcessingPostHandler({
      accounts: { resumeSession: async () => ({ accountId, sessionId: "opaque-session", expiresAt: "2026-09-04T00:00:00.000Z" }) },
      cases: { getPrivate: async () => privateCase() },
      sources: { getSource: async () => source },
      queue: { enqueue },
      isPersistenceAvailable: true,
    });

    const response = await handler(request(), { params: Promise.resolve({ caseId, materialId }) });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      processing: { jobId: "job-a", status: "pending", materialId },
    });
    expect(enqueue).toHaveBeenCalledWith({ accountId, caseId, materialId });
  });

  it("does not disclose or enqueue a material outside the private case", async () => {
    const enqueue = vi.fn();
    const handler = createMaterialProcessingPostHandler({
      accounts: { resumeSession: async () => ({ accountId, sessionId: "opaque-session", expiresAt: "2026-09-04T00:00:00.000Z" }) },
      cases: { getPrivate: async () => null },
      sources: { getSource: async () => source },
      queue: { enqueue },
      isPersistenceAvailable: true,
    });

    const response = await handler(request(), { params: Promise.resolve({ caseId, materialId }) });

    expect(response.status).toBe(404);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("rejects a retry for a terminal material state", async () => {
    const enqueue = vi.fn();
    const handler = createMaterialProcessingPostHandler({
      accounts: { resumeSession: async () => ({ accountId, sessionId: "opaque-session", expiresAt: "2026-09-04T00:00:00.000Z" }) },
      cases: { getPrivate: async () => privateCase() },
      sources: { getSource: async () => ({ ...source, processingState: "blocked_malicious" }) },
      queue: { enqueue },
      isPersistenceAvailable: true,
    });

    const response = await handler(request(), { params: Promise.resolve({ caseId, materialId }) });

    expect(response.status).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
