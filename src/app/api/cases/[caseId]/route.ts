import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { CasePatch } from "@/domain/case-record";
import { prisma } from "@/server/db";
import {
  type AccountRepository,
  PrismaAccountRepository,
} from "@/server/repositories/account-repository";
import {
  ConcurrencyConflict,
  type CaseRepository,
  PrismaCaseRepository,
} from "@/server/repositories/case-repository";
import { errorResponse, readCookie } from "@/app/api/cases/route";

const patchCaseRequestSchema = z.strictObject({
  patch: z.record(z.string(), z.unknown()),
  expectedVersion: z.number().int().positive(),
});
const MAX_REQUEST_BYTES = 64 * 1024;

export interface CaseRouteHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate" | "updatePrivate" | "markDeleted">;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

type CaseRouteContext = { params: Promise<{ caseId: string }> };

function notFound(requestId: string): Response {
  return errorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, requestId);
}

function conflict(requestId: string): Response {
  return errorResponse("VERSION_CONFLICT", "案件已被更新，请刷新后重试。", 409, requestId);
}

function badRequest(message: string, requestId: string): Response {
  return errorResponse("INVALID_INPUT", message, 400, requestId);
}

async function readPatchRequest(request: Request): Promise<{ patch: CasePatch; expectedVersion: number } | null> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES || body.trim() === "") {
    return null;
  }
  try {
    const parsed = patchCaseRequestSchema.safeParse(JSON.parse(body));
    return parsed.success
      ? { patch: parsed.data.patch as CasePatch, expectedVersion: parsed.data.expectedVersion }
      : null;
  } catch {
    return null;
  }
}

async function resolveOwner(
  request: Request,
  accounts: Pick<AccountRepository, "resumeSession">,
): Promise<{ accountId: string } | null> {
  const sessionId = readCookie(request, "manbo_session");
  return sessionId ? accounts.resumeSession(sessionId) : null;
}

export function createCaseRouteHandlers({
  accounts,
  cases,
  isPersistenceAvailable,
  requestId = randomUUID,
}: CaseRouteHandlerOptions) {
  async function GET(request: Request, context: CaseRouteContext): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable) {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveOwner(request, accounts).catch(() => null);
    if (!owner) {
      return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }
    const { caseId } = await context.params;
    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      return record
        ? Response.json({ case: record }, { headers: { "cache-control": "no-store" } })
        : notFound(id);
    } catch {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
  }

  async function PATCH(request: Request, context: CaseRouteContext): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable) {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveOwner(request, accounts).catch(() => null);
    if (!owner) {
      return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }
    const input = await readPatchRequest(request);
    if (!input) {
      return badRequest("案件更新请求格式不符合要求。", id);
    }
    const { caseId } = await context.params;
    try {
      const record = await cases.updatePrivate(
        owner.accountId,
        caseId,
        input.patch,
        input.expectedVersion,
      );
      return Response.json({ case: record }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof ConcurrencyConflict) {
        return conflict(id);
      }
      if (error instanceof z.ZodError || error instanceof TypeError) {
        return badRequest("案件更新请求格式不符合要求。", id);
      }
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
  }

  async function DELETE(request: Request, context: CaseRouteContext): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable) {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveOwner(request, accounts).catch(() => null);
    if (!owner) {
      return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }
    const { caseId } = await context.params;
    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) return notFound(id);
      await cases.markDeleted(owner.accountId, caseId);
      return new Response(null, {
        status: 204,
        headers: { "cache-control": "no-store" },
      });
    } catch {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
  }

  return { GET, PATCH, DELETE };
}

const defaultAccounts = new PrismaAccountRepository(prisma);
const defaultCases = new PrismaCaseRepository(prisma);
const defaultHandlers = createCaseRouteHandlers({
  accounts: defaultAccounts,
  cases: defaultCases,
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
});

export const GET = defaultHandlers.GET;
export const PATCH = defaultHandlers.PATCH;
export const DELETE = defaultHandlers.DELETE;
