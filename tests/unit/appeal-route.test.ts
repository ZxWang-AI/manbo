import { describe, expect, it, vi } from "vitest";

import { createAppealGetHandler, createAppealPostHandler } from "@/app/api/cases/[caseId]/appeals/route";

const owner = { accountId: "acct-a" };

function request(body?: unknown) {
  return new Request("http://localhost/api/cases/case-a/appeals", {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json", cookie: "manbo_session=session-a" } : { cookie: "manbo_session=session-a" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("owner appeal routes", () => {
  it("requires an authenticated owner and preserves review version identity", async () => {
    const repository = {
      create: vi.fn().mockResolvedValue({
        appealId: "appeal-a", caseId: "case-a", accountId: "acct-a", adminReviewVersionId: "review-a",
        statement: "补充说明", supportingMaterialIds: [], status: "submitted", createdAt: "2026-09-02T00:00:00.000Z",
      }),
      listForOwner: vi.fn().mockResolvedValue([]),
    };
    const handler = createAppealPostHandler({
      accounts: { resumeSession: vi.fn().mockResolvedValue(owner) },
      appeals: repository,
      isPersistenceAvailable: true,
      requestId: () => "req-a",
    });
    const response = await handler(request({ adminReviewVersionId: "review-a", statement: "补充说明", supportingMaterialIds: [] }), { params: Promise.resolve({ caseId: "case-a" }) });

    expect(response.status).toBe(201);
    expect(repository.create).toHaveBeenCalledWith({
      appealId: expect.any(String), caseId: "case-a", accountId: "acct-a", adminReviewVersionId: "review-a",
      statement: "补充说明", supportingMaterialIds: [],
    });
  });

  it("rejects forged fields and does not mutate the admin review", async () => {
    const repository = { create: vi.fn(), listForOwner: vi.fn() };
    const response = await createAppealPostHandler({
      accounts: { resumeSession: vi.fn().mockResolvedValue(owner) }, appeals: repository,
      isPersistenceAvailable: true, requestId: () => "req-b",
    })(request({ adminReviewVersionId: "review-a", statement: "x", supportingMaterialIds: [], status: "resolved" }), { params: Promise.resolve({ caseId: "case-a" }) });

    expect(response.status).toBe(400);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("lists only the authenticated owner's appeals", async () => {
    const repository = { create: vi.fn(), listForOwner: vi.fn().mockResolvedValue([]) };
    const response = await createAppealGetHandler({
      accounts: { resumeSession: vi.fn().mockResolvedValue(owner) }, appeals: repository,
      isPersistenceAvailable: true, requestId: () => "req-c",
    })(request(), { params: Promise.resolve({ caseId: "case-a" }) });

    expect(response.status).toBe(200);
    expect(repository.listForOwner).toHaveBeenCalledWith("acct-a", "case-a");
  });
});
