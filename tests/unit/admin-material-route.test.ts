import { describe, expect, it, vi } from "vitest";

import { createAdminMaterialGetHandler } from "@/app/api/admin/cases/[caseId]/materials/[materialId]/route";
import type { AdminMaterialService } from "@/server/admin/admin-material-service";
import type { AdminIdentityResolver } from "@/server/admin/rbac";
import type { AdminPrincipal } from "@/domain/admin-review";

const reviewer = { adminId: "reviewer-a", roles: ["case_reviewer"] as const };

function resolver(value: AdminPrincipal | null = reviewer): AdminIdentityResolver {
  return { resolve: vi.fn().mockResolvedValue(value) };
}

function service() {
  return {
    readMaterial: vi.fn().mockResolvedValue({
      materialId: "material-a",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
      contentLength: 16,
      body: new TextEncoder().encode("private material"),
    }),
  } as unknown as AdminMaterialService;
}

describe("administrator material route", () => {
  it("streams a short-lived inline response for playback without exposing an object-store URL", async () => {
    const adminService = service();
    const response = await createAdminMaterialGetHandler({
      service: adminService,
      identityResolver: resolver(),
      isAdminIdentityAvailable: true,
      requestId: () => "request-play",
    })(new Request("http://localhost/api/admin/cases/case-a/materials/material-a?mode=play"), {
      params: Promise.resolve({ caseId: "case-a", materialId: "material-a" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe('inline; filename="contract.pdf"');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).toBe("private material");
    expect(adminService.readMaterial).toHaveBeenCalledWith(reviewer, "case-a", "material-a", "play");
  });

  it("forces attachment disposition for download and rejects unsupported modes", async () => {
    const adminService = service();
    const handler = createAdminMaterialGetHandler({
      service: adminService,
      identityResolver: resolver(),
      isAdminIdentityAvailable: true,
      requestId: () => "request-download",
    });

    const download = await handler(new Request("http://localhost/api/admin/cases/case-a/materials/material-a?mode=download"), {
      params: Promise.resolve({ caseId: "case-a", materialId: "material-a" }),
    });
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toBe('attachment; filename="contract.pdf"');

    const invalid = await handler(new Request("http://localhost/api/admin/cases/case-a/materials/material-a?mode=share"), {
      params: Promise.resolve({ caseId: "case-a", materialId: "material-a" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "INVALID_INPUT", requestId: "request-download" });
    expect(adminService.readMaterial).toHaveBeenCalledTimes(1);
  });

  it("fails closed when administrator identity or storage is unavailable", async () => {
    const unavailable = await createAdminMaterialGetHandler({
      service: service(),
      identityResolver: resolver(),
      isAdminIdentityAvailable: false,
      requestId: () => "request-degraded",
    })(new Request("http://localhost/api/admin/cases/case-a/materials/material-a?mode=play"), {
      params: Promise.resolve({ caseId: "case-a", materialId: "material-a" }),
    });
    expect(unavailable.status).toBe(503);

    const unauthenticated = await createAdminMaterialGetHandler({
      service: service(),
      identityResolver: resolver(null),
      isAdminIdentityAvailable: true,
      requestId: () => "request-unauthenticated",
    })(new Request("http://localhost/api/admin/cases/case-a/materials/material-a?mode=play"), {
      params: Promise.resolve({ caseId: "case-a", materialId: "material-a" }),
    });
    expect(unauthenticated.status).toBe(401);
  });
});
