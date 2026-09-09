import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/server/db";
import { AdminCaseService } from "@/server/admin/admin-case-service";
import { unavailableAdminIdentityResolver, type AdminIdentityResolver } from "@/server/admin/rbac";
import { PrismaAdminCaseRepository } from "@/server/repositories/admin-case-repository";
import { PrismaAdminReviewRepository } from "@/server/repositories/admin-review-repository";
import { PrismaAdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";
import { adminErrorResponse, mapAdminError, resolveAdmin } from "@/app/api/admin/_route-helpers";

const requestSchema = z.strictObject({
  adminReviewVersionId: z.string().min(1).max(80),
  status: z.enum(["intake_rejected", "evidence_incomplete", "credibility_concern", "demonstrably_false"]),
  rationale: z.string().max(10_000).nullable(),
  sourceRefs: z.array(z.string().min(1).max(180)).max(64),
  supersedesId: z.string().min(1).max(80).nullable(),
});

export interface AdminReviewPostRouteOptions {
  service: Pick<AdminCaseService, "createReview">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  requestId?: () => string;
}

export interface AdminReviewGetRouteOptions {
  service: Pick<AdminCaseService, "listReviews">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  requestId?: () => string;
}

export function createAdminReviewGetHandler(options: AdminReviewGetRouteOptions) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ caseId: string }> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    const principal = await resolveAdmin(request, options.identityResolver).catch(() => null);
    if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
    const { caseId } = await context.params;
    try {
      const reviews = await options.service.listReviews(principal, caseId);
      return Response.json({ reviews }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return mapAdminError(error, requestId);
    }
  };
}

export function createAdminReviewPostHandler(options: AdminReviewPostRouteOptions) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ caseId: string }> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    const principal = await resolveAdmin(request, options.identityResolver).catch(() => null);
    if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
    const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return adminErrorResponse("INVALID_INPUT", "审核标注格式不符合要求。", 400, requestId);
    const { caseId } = await context.params;
    try {
      const review = await options.service.createReview(principal, caseId, parsed.data);
      return Response.json({ review }, { status: 201, headers: { "cache-control": "no-store" } });
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

export const POST = createAdminReviewPostHandler({
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
});

export const GET = createAdminReviewGetHandler({
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
});
