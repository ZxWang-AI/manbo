import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import { AdminCaseService } from "@/server/admin/admin-case-service";
import { unavailableAdminIdentityResolver, type AdminIdentityResolver } from "@/server/admin/rbac";
import { PrismaAdminCaseRepository } from "@/server/repositories/admin-case-repository";
import { PrismaAdminReviewRepository } from "@/server/repositories/admin-review-repository";
import { PrismaAdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";
import { adminErrorResponse, mapAdminError, resolveAdmin } from "@/app/api/admin/_route-helpers";

export interface AdminCasesRouteOptions {
  service: Pick<AdminCaseService, "listCases">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  requestId?: () => string;
}

export function createAdminCasesGetHandler(options: AdminCasesRouteOptions) {
  return async function GET(request: Request): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    try {
      const principal = await resolveAdmin(request, options.identityResolver);
      if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
      const cases = await options.service.listCases(principal);
      return Response.json({ cases }, { headers: { "cache-control": "no-store" } });
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

export const GET = createAdminCasesGetHandler({
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
});
