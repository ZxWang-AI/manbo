import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { CaseDraft } from "@/domain/case-record";
import { prisma } from "@/server/db";
import { type AccountRepository, PrismaAccountRepository } from "@/server/repositories/account-repository";
import { type CaseRepository, PrismaCaseRepository } from "@/server/repositories/case-repository";

const createCaseRequestSchema = z.strictObject({
  draft: z.record(z.string(), z.unknown()),
});
const MAX_REQUEST_BYTES = 64 * 1024;

export interface CasesPostHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "createDraft">;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    const key = pair.slice(0, separator).trim();
    if (key !== name) continue;
    const value = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function errorResponse(
  code: "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND" | "VERSION_CONFLICT" | "DEGRADED",
  message: string,
  status: 400 | 401 | 404 | 409 | 503,
  requestId: string,
): Response {
  return Response.json(
    { code, message, requestId },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function readCreateRequest(request: Request): Promise<CaseDraft | null> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES || body.trim() === "") {
    return null;
  }
  try {
    const parsed = createCaseRequestSchema.safeParse(JSON.parse(body));
    return parsed.success ? (parsed.data.draft as CaseDraft) : null;
  } catch {
    return null;
  }
}

export { readCookie, errorResponse };

export function createCasesPostHandler({
  accounts,
  cases,
  isPersistenceAvailable,
  requestId = randomUUID,
}: CasesPostHandlerOptions): (request: Request) => Promise<Response> {
  return async (request) => {
    const id = requestId();
    if (!isPersistenceAvailable) {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }

    const sessionId = readCookie(request, "manbo_session");
    if (!sessionId) {
      return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }

    const draft = await readCreateRequest(request);
    if (!draft) {
      return errorResponse("INVALID_INPUT", "案件草稿格式不符合要求。", 400, id);
    }

    try {
      const session = await accounts.resumeSession(sessionId);
      if (!session) {
        return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
      }
      const record = await cases.createDraft(session.accountId, draft);
      return Response.json(
        { case: record },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof TypeError) {
        return errorResponse("INVALID_INPUT", "案件草稿格式不符合要求。", 400, id);
      }
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

const defaultAccounts = new PrismaAccountRepository(prisma);
const defaultCases = new PrismaCaseRepository(prisma);

export async function POST(request: Request): Promise<Response> {
  return createCasesPostHandler({
    accounts: defaultAccounts,
    cases: defaultCases,
    isPersistenceAvailable:
      process.env.APP_MODE !== "static" &&
      Boolean(process.env.DATABASE_URL) &&
      (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
  })(request);
}
