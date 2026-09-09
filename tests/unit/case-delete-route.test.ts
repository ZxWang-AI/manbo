import { describe, expect, it, vi } from "vitest";

import { createCaseDeleteHandler } from "@/app/api/cases/[caseId]/delete/route";

describe("DELETE /api/cases/[caseId]/delete", () => {
  it("requires the owner session and returns a verifiable deletion receipt", async () => {
    const deleteCase = vi.fn().mockResolvedValue({
      receiptId: "receipt-a", caseId: "case-a", deletedAt: "2026-09-02T00:00:00.000Z",
      targets: ["primary_record", "backup_queue"], externalSystems: "not_applicable",
    });
    const response = await createCaseDeleteHandler({
      accounts: { resumeSession: vi.fn().mockResolvedValue({ accountId: "acct-a" }) },
      deleteCase, isPersistenceAvailable: true, requestId: () => "request-a",
    })(new Request("http://localhost/api/cases/case-a/delete", { method: "DELETE", headers: { cookie: "manbo_session=session-a" } }), { params: Promise.resolve({ caseId: "case-a" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ receipt: expect.objectContaining({ externalSystems: "not_applicable" }) });
    expect(deleteCase).toHaveBeenCalledWith("acct-a", "case-a");
  });

  it("fails closed when the session is missing", async () => {
    const response = await createCaseDeleteHandler({
      accounts: { resumeSession: vi.fn() }, deleteCase: vi.fn(), isPersistenceAvailable: true, requestId: () => "request-b",
    })(new Request("http://localhost/api/cases/case-a/delete", { method: "DELETE" }), { params: Promise.resolve({ caseId: "case-a" }) });
    expect(response.status).toBe(401);
  });
});
