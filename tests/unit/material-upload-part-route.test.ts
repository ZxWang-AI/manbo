import { describe, expect, it, vi } from "vitest";

import { createMaterialUploadPartPutHandler } from "@/app/api/cases/[caseId]/materials/uploads/[uploadId]/parts/[partNumber]/route";

const accountId = "a".repeat(32);
const caseId = "36ee7b31-8590-4afe-995e-0e360714d647";
const uploadId = "2b130ede-c0ad-4396-b885-a9eca4026d02";

function request(body: BodyInit, cookie = "manbo_session=opaque-session") {
  return new Request(`http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}/parts/1`, {
    method: "PUT",
    headers: { ...(cookie ? { cookie } : {}) },
    body,
  });
}

function owner() {
  return { accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" };
}

describe("PUT material upload part", () => {
  it("accepts an owned part only after authentication and private-case checks", async () => {
    const uploadPart = vi.fn().mockResolvedValue(undefined);
    const handler = createMaterialUploadPartPutHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => ({ caseId, accountId }) as never },
      uploads: { uploadPart },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(request(new Uint8Array([1, 2, 3, 4])), {
      params: Promise.resolve({ caseId, uploadId, partNumber: "1" }),
    });

    expect(response.status).toBe(204);
    expect(uploadPart).toHaveBeenCalledWith({
      accountId,
      caseId,
      uploadId,
      partNumber: 1,
      bytes: new Uint8Array([1, 2, 3, 4]),
    });
  });

  it("returns 404 without reading or forwarding a part for an inaccessible case", async () => {
    const uploadPart = vi.fn();
    const handler = createMaterialUploadPartPutHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => null },
      uploads: { uploadPart },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(request(new Uint8Array([1, 2, 3])), {
      params: Promise.resolve({ caseId, uploadId, partNumber: "1" }),
    });

    expect(response.status).toBe(404);
    expect(uploadPart).not.toHaveBeenCalled();
  });

  it("rejects invalid part numbers and oversized bodies before the upload service", async () => {
    const uploadPart = vi.fn();
    const handler = createMaterialUploadPartPutHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => ({ caseId, accountId }) as never },
      uploads: { uploadPart },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
      maxPartBytes: 4,
    });

    const invalidPart = await handler(request(new Uint8Array([1])), {
      params: Promise.resolve({ caseId, uploadId, partNumber: "0" }),
    });
    expect(invalidPart.status).toBe(400);

    const oversized = await handler(request(new Uint8Array([1, 2, 3, 4, 5])), {
      params: Promise.resolve({ caseId, uploadId, partNumber: "1" }),
    });
    expect(oversized.status).toBe(413);
    expect(uploadPart).not.toHaveBeenCalled();
  });

  it("fails closed when persistence or object storage is unavailable", async () => {
    const uploadPart = vi.fn();
    const handler = createMaterialUploadPartPutHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => ({ caseId, accountId }) as never },
      uploads: { uploadPart },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: false,
      requestId: () => "request-part-unavailable",
    });

    const response = await handler(request(new Uint8Array([1])), {
      params: Promise.resolve({ caseId, uploadId, partNumber: "1" }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "DEGRADED", requestId: "request-part-unavailable" });
    expect(uploadPart).not.toHaveBeenCalled();
  });
});
