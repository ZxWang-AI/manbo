import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import type { AccountRepository } from "@/server/repositories/account-repository";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import type { CaseRepository } from "@/server/repositories/case-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import type { MaterialListRepository } from "@/server/repositories/material-list-repository";
import { PrismaMaterialListRepository } from "@/server/repositories/material-list-repository";
import { materialErrorResponse, resolveMaterialOwner, type MaterialRouteContext } from "./route-helpers";

export interface MaterialListGetHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate">;
  materials: Pick<MaterialListRepository, "listActive">;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

export function createMaterialListGetHandler({
  accounts,
  cases,
  materials,
  isPersistenceAvailable,
  requestId = randomUUID,
}: MaterialListGetHandlerOptions) {
  return async function GET(
    request: Request,
    context: MaterialRouteContext<{ caseId: string }>,
  ): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable) return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    const owner = await resolveMaterialOwner(request, accounts).catch(() => null);
    if (!owner) return materialErrorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    const { caseId } = await context.params;
    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) return materialErrorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, id);
      const list = await materials.listActive(owner.accountId, caseId);
      return Response.json({ materials: list }, { headers: { "cache-control": "no-store" } });
    } catch {
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

export const GET = createMaterialListGetHandler({
  accounts: new PrismaAccountRepository(prisma),
  cases: new PrismaCaseRepository(prisma),
  materials: new PrismaMaterialListRepository(prisma),
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
});
