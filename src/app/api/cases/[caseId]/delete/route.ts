import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import { readCookie, errorResponse } from "@/app/api/cases/route";
import { PrismaAccountRepository, type AccountRepository } from "@/server/repositories/account-repository";
import { deleteCase as deleteCaseData } from "@/server/retention";

export interface CaseDeleteRouteOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  deleteCase: (accountId: string, caseId: string) => Promise<unknown>;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

type Context = { params: Promise<{ caseId: string }> };

export function createCaseDeleteHandler(options: CaseDeleteRouteOptions) {
  return async function DELETE(request: Request, context: Context): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isPersistenceAvailable) return errorResponse("DEGRADED", "案件删除服务暂时不可用；请稍后重试。", 503, requestId);
    const sessionId = readCookie(request, "manbo_session");
    const owner = sessionId ? await options.accounts.resumeSession(sessionId).catch(() => null) : null;
    if (!owner) return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
    const { caseId } = await context.params;
    try {
      const receipt = await options.deleteCase(owner.accountId, caseId);
      return Response.json({ receipt }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "CASE_NOT_FOUND") {
        return errorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, requestId);
      }
      return errorResponse("DEGRADED", "案件删除服务暂时不可用；请稍后重试。", 503, requestId);
    }
  };
}

export const DELETE = createCaseDeleteHandler({
  accounts: new PrismaAccountRepository(prisma),
  deleteCase: (accountId, caseId) => deleteCaseData(accountId, caseId),
  isPersistenceAvailable: process.env.APP_MODE !== "static" && Boolean(process.env.DATABASE_URL) && (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
});
