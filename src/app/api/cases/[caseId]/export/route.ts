import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createConnectorRegistry } from "@/connectors";
import type { CaseRepository } from "@/server/repositories/case-repository";
import type { AccountRepository } from "@/server/repositories/account-repository";
import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { readCookie, errorResponse } from "@/app/api/cases/route";
import { recordAudit, buildAuditEvent } from "@/server/audit";
import { InMemoryExportPreviewStore } from "@/connectors";

const requestSchema = z.strictObject({
  connectorId: z.enum(["markdown", "json", "manual"]),
  caseVersion: z.number().int().positive(),
  fieldPaths: z.array(z.string().regex(/^\/[A-Za-z][A-Za-z0-9_]*(?:\/\d+)?$/u)).max(32),
  consentEventId: z.string().min(1).max(120),
});

export interface CaseExportRouteOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getVersionPrivate">;
  isPersistenceAvailable: boolean;
  store: InMemoryExportPreviewStore;
  requestId?: () => string;
}

type Context = { params: Promise<{ caseId: string }> };

export function createCaseExportPostHandler(options: CaseExportRouteOptions) {
  const registry = createConnectorRegistry({ store: options.store });
  return async function POST(request: Request, context: Context): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isPersistenceAvailable) return errorResponse("DEGRADED", "导出服务暂时不可用；请稍后重试。", 503, requestId);
    const sessionId = readCookie(request, "manbo_session");
    const owner = sessionId ? await options.accounts.resumeSession(sessionId).catch(() => null) : null;
    if (!owner) return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
    const body = await request.json().catch(() => undefined);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) return errorResponse("INVALID_INPUT", "导出预览请求格式不符合要求。", 400, requestId);
    const { caseId } = await context.params;
    const record = await options.cases.getVersionPrivate(owner.accountId, caseId, parsed.data.caseVersion).catch(() => null);
    if (!record) return errorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, requestId);
    const connector = registry.get(parsed.data.connectorId);
    if (!connector) return errorResponse("INVALID_INPUT", "导出格式暂不支持。", 400, requestId);
    try {
      const preview = await connector.preview(record, {
        confirmed: true,
        caseId,
        caseVersion: parsed.data.caseVersion,
        connectorId: parsed.data.connectorId,
        fieldPaths: parsed.data.fieldPaths,
        consentEventId: parsed.data.consentEventId,
      });
      await recordAudit(buildAuditEvent({ accountId: owner.accountId, caseId, action: "export_preview", metadata: { connectorId: parsed.data.connectorId, fieldCount: parsed.data.fieldPaths.length } }));
      return Response.json({ preview }, { headers: { "cache-control": "no-store" } });
    } catch {
      return errorResponse("INVALID_INPUT", "导出字段需要由你明确确认，并且必须匹配当前案件版本。", 400, requestId);
    }
  };
}

const previewStore = new InMemoryExportPreviewStore();
export const POST = createCaseExportPostHandler({
  accounts: new PrismaAccountRepository(prisma),
  cases: new PrismaCaseRepository(prisma),
  isPersistenceAvailable: process.env.APP_MODE !== "static" && Boolean(process.env.DATABASE_URL),
  store: previewStore,
});
