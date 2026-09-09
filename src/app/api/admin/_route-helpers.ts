import { randomUUID } from "node:crypto";

import { AdminAuthorizationError } from "@/domain/admin-review";
import type { AdminIdentityResolver } from "@/server/admin/rbac";

export function adminErrorResponse(
  code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VERSION_CONFLICT" | "DEGRADED",
  message: string,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  requestId: string = randomUUID(),
): Response {
  return Response.json({ code, message, requestId }, { status, headers: { "cache-control": "no-store" } });
}

export async function resolveAdmin(
  request: Request,
  resolver: AdminIdentityResolver,
): Promise<ReturnType<AdminIdentityResolver["resolve"]>> {
  return resolver.resolve(request);
}

export function mapAdminError(error: unknown, requestId: string): Response {
  if (error instanceof AdminAuthorizationError) {
    return adminErrorResponse(
      error.code === "ADMIN_UNAUTHENTICATED" ? "UNAUTHENTICATED" : "FORBIDDEN",
      error.code === "ADMIN_UNAUTHENTICATED" ? "管理员身份无效。" : "当前管理员身份无权执行此操作。",
      error.code === "ADMIN_UNAUTHENTICATED" ? 401 : 403,
      requestId,
    );
  }
  if (error instanceof Error && error.message === "ADMIN_CASE_NOT_FOUND") {
    return adminErrorResponse("NOT_FOUND", "案件不存在或当前管理员无权访问。", 404, requestId);
  }
  if (error instanceof Error && error.message === "ADMIN_MATERIAL_NOT_FOUND") {
    return adminErrorResponse("NOT_FOUND", "材料不存在或当前管理员无权访问。", 404, requestId);
  }
  if (error instanceof Error && (error.name === "ConcurrencyConflict" || error.message.includes("Case version is stale"))) {
    return adminErrorResponse("VERSION_CONFLICT", "案件版本已变化，请重新加载后再修改。", 409, requestId);
  }
  if (error instanceof Error && ["SECOND_REVIEW_REQUIRED", "CREDIBILITY_SOURCE_REQUIRED", "COUNTER_EVIDENCE_REQUIRED"].includes(error.message)) {
    return adminErrorResponse("INVALID_INPUT", "审核标注缺少必需的独立依据。", 400, requestId);
  }
  return adminErrorResponse("DEGRADED", "管理员服务暂时不可用。", 503, requestId);
}
