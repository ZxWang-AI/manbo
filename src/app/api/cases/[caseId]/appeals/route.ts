import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/server/db";
import { readCookie, errorResponse } from "@/app/api/cases/route";
import { PrismaAccountRepository, type AccountRepository } from "@/server/repositories/account-repository";
import { PrismaAppealRepository, type AppealRepository } from "@/server/repositories/appeal-repository";

const requestSchema = z.strictObject({
  adminReviewVersionId: z.string().min(1).max(80),
  statement: z.string().trim().min(1).max(20_000),
  supportingMaterialIds: z.array(z.string().min(1).max(80)).max(128),
});

export interface AppealRouteOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  appeals: AppealRepository;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

type Context = { params: Promise<{ caseId: string }> };

async function resolveOwner(request: Request, accounts: Pick<AccountRepository, "resumeSession">) {
  const sessionId = readCookie(request, "manbo_session");
  return sessionId ? accounts.resumeSession(sessionId) : null;
}

function unavailable(code: "UNAUTHENTICATED" | "DEGRADED" | "NOT_FOUND" | "INVALID_INPUT", message: string, status: 400 | 401 | 404 | 503, requestId: string) {
  return errorResponse(code, message, status, requestId);
}

export function createAppealGetHandler(options: AppealRouteOptions) {
  return async function GET(request: Request, context: Context): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isPersistenceAvailable) return unavailable("DEGRADED", "申诉服务暂时不可用；请稍后重试。", 503, requestId);
    const owner = await resolveOwner(request, options.accounts).catch(() => null);
    if (!owner) return unavailable("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
    const { caseId } = await context.params;
    try {
      const appeals = await options.appeals.listForOwner(owner.accountId, caseId);
      return Response.json({ appeals }, { headers: { "cache-control": "no-store" } });
    } catch {
      return unavailable("DEGRADED", "申诉服务暂时不可用；请稍后重试。", 503, requestId);
    }
  };
}

export function createAppealPostHandler(options: AppealRouteOptions) {
  return async function POST(request: Request, context: Context): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isPersistenceAvailable) return unavailable("DEGRADED", "申诉服务暂时不可用；请稍后重试。", 503, requestId);
    const owner = await resolveOwner(request, options.accounts).catch(() => null);
    if (!owner) return unavailable("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
    const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return unavailable("INVALID_INPUT", "申诉内容格式不符合要求。", 400, requestId);
    const { caseId } = await context.params;
    try {
      const appeal = await options.appeals.create({
        appealId: randomUUID(),
        caseId,
        accountId: owner.accountId,
        adminReviewVersionId: parsed.data.adminReviewVersionId,
        statement: parsed.data.statement,
        supportingMaterialIds: parsed.data.supportingMaterialIds,
      });
      return Response.json({ appeal }, { status: 201, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && ["APPEAL_REVIEW_NOT_FOUND", "APPEAL_MATERIAL_NOT_OWNED"].includes(error.message)) {
        return unavailable("NOT_FOUND", "申诉关联的审核版本或材料不存在。", 404, requestId);
      }
      if (error instanceof Error && ["APPEAL_STATEMENT_REQUIRED", "APPEAL_MATERIAL_ID_INVALID"].includes(error.message)) {
        return unavailable("INVALID_INPUT", "申诉内容格式不符合要求。", 400, requestId);
      }
      return unavailable("DEGRADED", "申诉服务暂时不可用；请稍后重试。", 503, requestId);
    }
  };
}

const defaultOptions: AppealRouteOptions = {
  accounts: new PrismaAccountRepository(prisma),
  appeals: new PrismaAppealRepository(prisma),
  isPersistenceAvailable: process.env.APP_MODE !== "static" && Boolean(process.env.DATABASE_URL) && (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
};

export const GET = createAppealGetHandler(defaultOptions);
export const POST = createAppealPostHandler(defaultOptions);
