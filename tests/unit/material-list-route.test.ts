import { describe, expect, it, vi } from "vitest";

import { createMaterialListGetHandler } from "@/app/api/cases/[caseId]/materials/route";
import { makeCaseRecordFixture } from "../fixtures/case-record";

const accountId = "a".repeat(32);
const caseId = "case-a";

function privateCase() {
  return { ...makeCaseRecordFixture(), caseId, accountId };
}

function request(cookie = "manbo_session=opaque-session") {
  const init: RequestInit = {};
  if (cookie) init.headers = { cookie };
  return new Request(`http://localhost/api/cases/${caseId}/materials`, init);
}

describe("GET /api/cases/[caseId]/materials", () => {
  it("returns only active material processing summaries for the private owner", async () => {
    const list = vi.fn().mockResolvedValue([
      {
        materialId: "material-a",
        originalFilename: "statement.pdf",
        declaredBytes: 1024,
        declaredMime: "application/pdf",
        processingState: "scanning",
        eligibleForAi: false,
        createdAt: "2026-09-04T00:00:00.000Z",
      },
    ]);
    const handler = createMaterialListGetHandler({
      accounts: { resumeSession: async () => ({ accountId, sessionId: "opaque-session", expiresAt: "2026-09-04T00:00:00.000Z" }) },
      cases: { getPrivate: async () => privateCase() },
      materials: { listActive: list },
      isPersistenceAvailable: true,
    });

    const response = await handler(request(), { params: Promise.resolve({ caseId }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      materials: [{
        materialId: "material-a",
        originalFilename: "statement.pdf",
        declaredBytes: 1024,
        declaredMime: "application/pdf",
        processingState: "scanning",
        eligibleForAi: false,
        createdAt: "2026-09-04T00:00:00.000Z",
      }],
    });
    expect(list).toHaveBeenCalledWith(accountId, caseId);
  });

  it("does not disclose materials from a missing or differently owned private case", async () => {
    const list = vi.fn();
    const handler = createMaterialListGetHandler({
      accounts: { resumeSession: async () => ({ accountId, sessionId: "opaque-session", expiresAt: "2026-09-04T00:00:00.000Z" }) },
      cases: { getPrivate: async () => null },
      materials: { listActive: list },
      isPersistenceAvailable: true,
    });

    const response = await handler(request(), { params: Promise.resolve({ caseId }) });

    expect(response.status).toBe(404);
    expect(list).not.toHaveBeenCalled();
  });

  it("fails closed when persistence is unavailable", async () => {
    const list = vi.fn();
    const handler = createMaterialListGetHandler({
      accounts: { resumeSession: async () => ({ accountId, sessionId: "opaque-session", expiresAt: "2026-09-04T00:00:00.000Z" }) },
      cases: { getPrivate: async () => privateCase() },
      materials: { listActive: list },
      isPersistenceAvailable: false,
      requestId: () => "request-material-list-unavailable",
    });

    const response = await handler(request(), { params: Promise.resolve({ caseId }) });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "DEGRADED", requestId: "request-material-list-unavailable" });
    expect(list).not.toHaveBeenCalled();
  });
});
