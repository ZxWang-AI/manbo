import { describe, expect, it, vi } from "vitest";

import { createMaterialUploadCancelDeleteHandler } from "@/app/api/cases/[caseId]/materials/uploads/[uploadId]/route";
import { makeCaseRecordFixture } from "../fixtures/case-record";

const accountId = "a".repeat(32);
const caseId = "36ee7b31-8590-4afe-995e-0e360714d647";
const uploadId = "2b130ede-c0ad-4396-b885-a9eca4026d02";

function owner() {
  return { accountId, sessionId: "opaque-session", expiresAt: "2026-09-02T12:30:00.000Z" };
}

describe("DELETE /api/cases/[caseId]/materials/uploads/[uploadId]", () => {
  it("cancels only an active upload owned by the private case", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const handler = createMaterialUploadCancelDeleteHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => ({ ...makeCaseRecordFixture(), caseId, accountId }) },
      uploads: { cancel },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      new Request(`http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}`, {
        method: "DELETE",
        headers: { cookie: "manbo_session=opaque-session" },
      }),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(204);
    expect(cancel).toHaveBeenCalledWith({ accountId, caseId, uploadId });
  });

  it("does not cancel when the private case is unavailable", async () => {
    const cancel = vi.fn();
    const handler = createMaterialUploadCancelDeleteHandler({
      accounts: { resumeSession: async () => owner() },
      cases: { getPrivate: async () => null },
      uploads: { cancel },
      isPersistenceAvailable: true,
      isObjectStorageAvailable: true,
    });

    const response = await handler(
      new Request(`http://localhost/api/cases/${caseId}/materials/uploads/${uploadId}`, {
        method: "DELETE",
        headers: { cookie: "manbo_session=opaque-session" },
      }),
      { params: Promise.resolve({ caseId, uploadId }) },
    );

    expect(response.status).toBe(404);
    expect(cancel).not.toHaveBeenCalled();
  });
});
