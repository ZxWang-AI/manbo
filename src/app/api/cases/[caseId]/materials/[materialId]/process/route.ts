import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import type { AccountRepository } from "@/server/repositories/account-repository";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import type { CaseRepository } from "@/server/repositories/case-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import type { MaterialProcessingSourceRepository } from "@/server/services/material-processing-task-service";
import { PrismaMaterialProcessingSourceRepository } from "@/server/repositories/material-processing-source-repository";
import type { MaterialProcessingQueue } from "@/server/services/material-processing-queue";
import { materialProcessingQueue } from "@/server/services/material-processing-defaults";
import type { MaterialProcessingState } from "@/domain/material";
import { materialErrorResponse, resolveMaterialOwner, type MaterialRouteContext } from "../../route-helpers";

const retryableStates: ReadonlySet<MaterialProcessingState> = new Set(["quarantined", "saved_unread", "scan_failed"]);

export interface MaterialProcessingPostHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate">;
  sources: Pick<MaterialProcessingSourceRepository, "getSource">;
  queue: Pick<MaterialProcessingQueue, "enqueue">;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

export function createMaterialProcessingPostHandler({
  accounts,
  cases,
  sources,
  queue,
  isPersistenceAvailable,
  requestId = randomUUID,
}: MaterialProcessingPostHandlerOptions) {
  return async function POST(
    request: Request,
    context: MaterialRouteContext<{ caseId: string; materialId: string }>,
  ): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable) {
      return materialErrorResponse("DEGRADED", "材料处理服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveMaterialOwner(request, accounts).catch(() => null);
    if (!owner) return materialErrorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    const { caseId, materialId } = await context.params;

    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) return materialErrorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, id);
      const source = await sources.getSource({ accountId: owner.accountId, caseId, materialId });
      if (!source) return materialErrorResponse("NOT_FOUND", "材料不存在或当前会话无权访问。", 404, id);
      if (!retryableStates.has(source.processingState)) {
        return materialErrorResponse("VERSION_CONFLICT", "该材料当前无需重试处理。", 409, id);
      }
      const job = await queue.enqueue({ accountId: owner.accountId, caseId, materialId });
      return Response.json(
        { processing: { jobId: job.jobId, status: job.status, materialId } },
        { status: 202, headers: { "cache-control": "no-store" } },
      );
    } catch {
      return materialErrorResponse("DEGRADED", "材料处理服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

export const POST = createMaterialProcessingPostHandler({
  accounts: new PrismaAccountRepository(prisma),
  cases: new PrismaCaseRepository(prisma),
  sources: new PrismaMaterialProcessingSourceRepository(prisma),
  queue: materialProcessingQueue,
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
});
