import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/server/db";
import { AdminCaseService } from "@/server/admin/admin-case-service";
import { assertAdminAuthorized } from "@/domain/admin-review";
import type { CasePatch } from "@/domain/case-record";
import { unavailableAdminIdentityResolver, type AdminIdentityResolver } from "@/server/admin/rbac";
import { PrismaAdminCaseRepository } from "@/server/repositories/admin-case-repository";
import { PrismaAdminReviewRepository } from "@/server/repositories/admin-review-repository";
import { PrismaAdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";
import { adminErrorResponse, mapAdminError, resolveAdmin } from "@/app/api/admin/_route-helpers";

export interface AdminCaseGetRouteOptions {
  service: Pick<AdminCaseService, "getCase">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  requestId?: () => string;
}

export interface AdminCaseMutationRouteOptions {
  service: Pick<AdminCaseService, "modifyCase" | "deleteCase">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  requestId?: () => string;
}

const mutationSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  patch: z.record(z.string(), z.unknown()),
});

const MAX_ADMIN_MUTATION_BYTES = 128 * 1024;

async function parseMutation(request: Request) {
  const body = await request.text();
  if (body.trim() === "" || new TextEncoder().encode(body).byteLength > MAX_ADMIN_MUTATION_BYTES) return null;
  try {
    const parsed = mutationSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createAdminCasePatchHandler(options: AdminCaseMutationRouteOptions) {
  return async function PATCH(
    request: Request,
    context: { params: Promise<{ caseId: string }> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    const principal = await resolveAdmin(request, options.identityResolver).catch(() => null);
    if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
    try {
      assertAdminAuthorized(principal, "case:modify");
    } catch (error) {
      return mapAdminError(error, requestId);
    }
    const parsed = await parseMutation(request);
    if (!parsed) return adminErrorResponse("INVALID_INPUT", "管理员修改请求格式不符合要求。", 400, requestId);
    const { caseId } = await context.params;
    try {
      const updated = await options.service.modifyCase(
        principal,
        caseId,
        parsed.patch as CasePatch,
        parsed.expectedVersion,
      );
      return Response.json({ case: updated }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      return mapAdminError(error, requestId);
    }
  };
}

export function createAdminCaseDeleteHandler(options: AdminCaseMutationRouteOptions) {
  return async function DELETE(
    request: Request,
    context: { params: Promise<{ caseId: string }> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    const principal = await resolveAdmin(request, options.identityResolver).catch(() => null);
    if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
    try {
      assertAdminAuthorized(principal, "case:delete");
    } catch (error) {
      return mapAdminError(error, requestId);
    }
    const { caseId } = await context.params;
    try {
      await options.service.deleteCase(principal, caseId);
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch (error) {
      return mapAdminError(error, requestId);
    }
  };
}

export function createAdminCaseGetHandler(options: AdminCaseGetRouteOptions) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ caseId: string }> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable) return adminErrorResponse("DEGRADED", "管理员身份服务尚未配置。", 503, requestId);
    try {
      const principal = await resolveAdmin(request, options.identityResolver);
      if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);
      const { caseId } = await context.params;
      const result = await options.service.getCase(principal, caseId);
      return Response.json(result, { headers: { "cache-control": "no-store" } });
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

export const GET = createAdminCaseGetHandler({
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
});

const defaultMutationOptions: AdminCaseMutationRouteOptions = {
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
};

export const PATCH = createAdminCasePatchHandler(defaultMutationOptions);
export const DELETE = createAdminCaseDeleteHandler(defaultMutationOptions);
