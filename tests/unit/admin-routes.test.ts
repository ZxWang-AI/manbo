import { describe, expect, it, vi } from "vitest";

import {
  createAdminCasesGetHandler,
} from "@/app/api/admin/cases/route";
import { createAdminCaseGetHandler } from "@/app/api/admin/cases/[caseId]/route";
import { createAdminReviewGetHandler, createAdminReviewPostHandler } from "@/app/api/admin/cases/[caseId]/reviews/route";
import { createAdminCasePatchHandler, createAdminCaseDeleteHandler } from "@/app/api/admin/cases/[caseId]/route";
import { createAdminCaseChangesGetHandler } from "@/app/api/admin/cases/[caseId]/changes/route";
import type { AdminCaseService } from "@/server/admin/admin-case-service";
import type { AdminIdentityResolver } from "@/server/admin/rbac";
import type { AdminPrincipal } from "@/domain/admin-review";

const reviewer = { adminId: "reviewer-a", roles: ["case_reviewer"] as const };

function resolver(value: AdminPrincipal | null = reviewer): AdminIdentityResolver {
  return { resolve: vi.fn().mockResolvedValue(value) };
}

function service() {
  return {
    listCases: vi.fn().mockResolvedValue([]),
    getCase: vi.fn().mockResolvedValue({ caseId: "case-a", materials: [] }),
    createReview: vi.fn().mockResolvedValue({
      adminReviewVersionId: "review-a",
      caseId: "case-a",
      reviewerId: "reviewer-a",
      status: "evidence_incomplete",
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
      createdAt: "2026-09-02T10:00:00.000Z",
    }),
    listReviews: vi.fn().mockResolvedValue([]),
    modifyCase: vi.fn().mockResolvedValue({ record: { caseId: "case-a", version: 2 }, materials: [] }),
    deleteCase: vi.fn().mockResolvedValue(undefined),
  } as unknown as AdminCaseService;
}

describe("administrator case routes", () => {
  it("does not trust a client-provided role header and fails closed without an identity provider", async () => {
    const response = await createAdminCasesGetHandler({
      service: service(),
      identityResolver: resolver(),
      isAdminIdentityAvailable: false,
      requestId: () => "request-a",
    })(new Request("http://localhost/api/admin/cases", {
      headers: { "x-admin-role": "case_supervisor" },
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      code: "DEGRADED",
      message: "管理员身份服务尚未配置。",
      requestId: "request-a",
    });
  });

  it("uses only the verified identity resolver for list and detail access", async () => {
    const adminService = service();
    const identityResolver = resolver();
    const list = createAdminCasesGetHandler({
      service: adminService,
      identityResolver,
      isAdminIdentityAvailable: true,
      requestId: () => "request-list",
    });
    const detail = createAdminCaseGetHandler({
      service: adminService,
      identityResolver,
      isAdminIdentityAvailable: true,
      requestId: () => "request-detail",
    });

    await expect(list(new Request("http://localhost/api/admin/cases"))).resolves.toMatchObject({ status: 200 });
    await expect(detail(new Request("http://localhost/api/admin/cases/case-a"), {
      params: Promise.resolve({ caseId: "case-a" }),
    })).resolves.toMatchObject({ status: 200 });

    expect(identityResolver.resolve).toHaveBeenCalledTimes(2);
    expect(adminService.listCases).toHaveBeenCalledWith(reviewer);
    expect(adminService.getCase).toHaveBeenCalledWith(reviewer, "case-a");
  });

  it("rejects a forged reviewer id in the review body and binds the route to the verified principal", async () => {
    const adminService = service();
    const handler = createAdminReviewPostHandler({
      service: adminService,
      identityResolver: resolver(),
      isAdminIdentityAvailable: true,
      requestId: () => "request-review",
    });

    const rejected = await handler(new Request("http://localhost/api/admin/cases/case-a/reviews", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        adminReviewVersionId: "review-a",
        reviewerId: "forged-admin",
        status: "evidence_incomplete",
        rationale: null,
        sourceRefs: [],
        supersedesId: null,
      }),
    }), { params: Promise.resolve({ caseId: "case-a" }) });

    expect(rejected.status).toBe(400);
    expect(adminService.createReview).not.toHaveBeenCalled();
  });

  it("limits case mutation and deletion to the verified supervisor", async () => {
    const adminService = service();
    const patch = createAdminCasePatchHandler({
      service: adminService,
      identityResolver: resolver(reviewer),
      isAdminIdentityAvailable: true,
      requestId: () => "request-patch",
    });
    const forbidden = await patch(new Request("http://localhost/api/admin/cases/case-a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, patch: { lifecycle: "confirmed" } }),
    }), { params: Promise.resolve({ caseId: "case-a" }) });
    expect(forbidden.status).toBe(403);
    expect(adminService.modifyCase).not.toHaveBeenCalled();

    const supervisorService = service();
    const supervisorPatch = createAdminCasePatchHandler({
      service: supervisorService,
      identityResolver: resolver({ adminId: "supervisor-b", roles: ["case_supervisor"] }),
      isAdminIdentityAvailable: true,
      requestId: () => "request-patch-supervisor",
    });
    const updated = await supervisorPatch(new Request("http://localhost/api/admin/cases/case-a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, patch: { lifecycle: "confirmed" } }),
    }), { params: Promise.resolve({ caseId: "case-a" }) });
    expect(updated.status).toBe(200);
    expect(supervisorService.modifyCase).toHaveBeenCalledWith(
      { adminId: "supervisor-b", roles: ["case_supervisor"] },
      "case-a",
      { lifecycle: "confirmed" },
      1,
    );

    const deleted = await createAdminCaseDeleteHandler({
      service: supervisorService,
      identityResolver: resolver({ adminId: "supervisor-b", roles: ["case_supervisor"] }),
      isAdminIdentityAvailable: true,
      requestId: () => "request-delete",
    })(new Request("http://localhost/api/admin/cases/case-a", { method: "DELETE" }), {
      params: Promise.resolve({ caseId: "case-a" }),
    });
    expect(deleted.status).toBe(204);
    expect(supervisorService.deleteCase).toHaveBeenCalledWith(
      { adminId: "supervisor-b", roles: ["case_supervisor"] },
      "case-a",
    );
  });

  it("maps a stale supervisor edit to a version conflict", async () => {
    const adminService = service();
    vi.mocked(adminService.modifyCase).mockRejectedValue(new Error("Case version is stale or the private case is unavailable"));
    const response = await createAdminCasePatchHandler({
      service: adminService,
      identityResolver: resolver({ adminId: "supervisor-b", roles: ["case_supervisor"] }),
      isAdminIdentityAvailable: true,
      requestId: () => "request-stale",
    })(new Request("http://localhost/api/admin/cases/case-a", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, patch: { lifecycle: "confirmed" } }),
    }), { params: Promise.resolve({ caseId: "case-a" }) });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: "VERSION_CONFLICT", requestId: "request-stale" });
  });

  it("lists immutable review versions without creating a new review", async () => {
    const adminService = service();
    vi.mocked(adminService.listReviews).mockResolvedValue([{
      adminReviewVersionId: "review-a",
      caseId: "case-a",
      reviewerId: "reviewer-a",
      status: "evidence_incomplete",
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
      createdAt: "2026-09-02T10:00:00.000Z",
    }]);
    const response = await createAdminReviewGetHandler({
      service: adminService,
      identityResolver: resolver(),
      isAdminIdentityAvailable: true,
      requestId: () => "request-reviews",
    })(new Request("http://localhost/api/admin/cases/case-a/reviews"), {
      params: Promise.resolve({ caseId: "case-a" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ reviews: expect.any(Array) });
    expect(adminService.listReviews).toHaveBeenCalledWith(reviewer, "case-a");
  });

  it("lists immutable administrator case changes for an authorized viewer", async () => {
    const adminService = service() as AdminCaseService & { listChanges: ReturnType<typeof vi.fn> };
    adminService.listChanges = vi.fn().mockResolvedValue([{
      changeVersionId: "change-a",
      caseId: "case-a",
      adminId: "supervisor-b",
      action: "modify",
      expectedVersion: 1,
      resultingVersion: 2,
      patch: { lifecycle: "confirmed" },
      createdAt: "2026-09-02T10:00:00.000Z",
    }]);
    const response = await createAdminCaseChangesGetHandler({
      service: adminService,
      identityResolver: resolver(),
      isAdminIdentityAvailable: true,
      requestId: () => "request-changes",
    })(new Request("http://localhost/api/admin/cases/case-a/changes"), {
      params: Promise.resolve({ caseId: "case-a" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ changes: expect.any(Array) });
    expect(adminService.listChanges).toHaveBeenCalledWith(reviewer, "case-a");
  });
});
