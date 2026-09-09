import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import { AdminCaseService } from "@/server/admin/admin-case-service";
import { unavailableAdminIdentityResolver, type AdminIdentityResolver } from "@/server/admin/rbac";
import { PrismaAdminCaseRepository } from "@/server/repositories/admin-case-repository";
import { PrismaAdminReviewRepository } from "@/server/repositories/admin-review-repository";
import { PrismaAdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";
import { adminErrorResponse, mapAdminError, resolveAdmin } from "@/app/api/admin/_route-helpers";

export interface AdminCaseChangesGetRouteOptions {
  service: Pick<AdminCaseService, "listChanges">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  requestId?: () => string;
}

export function createAdminCaseChangesGetHandler(options: AdminCaseChangesGetRouteOptions) {
  return async function GET(
    request: Request,
    context: { params: Promise<unknown> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    const principal = await resolveAdmin(request, options.identityResolver).catch(() => null);
    if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
    const params = await context.params;
    const caseId = typeof params === "object" && params !== null && "caseId" in params && typeof params.caseId === "string"
      ? params.caseId
      : "";
    if (!caseId) return adminErrorResponse("INVALID_INPUT", "案件标识无效。", 400, requestId);
    try {
      const changes = await options.service.listChanges(principal, caseId);
      return Response.json({ changes }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return mapAdminError(error, requestId);
    }
  };
}

const defaultService = new AdminCaseService(
  new PrismaAdminCaseRepository(prisma),
  new PrismaAdminReviewRepository(prisma),
  undefined,
  new PrismaAdminCaseChangeRepository(prisma),
);

export const GET = createAdminCaseChangesGetHandler({
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
});
