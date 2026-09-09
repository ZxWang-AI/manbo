import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  RECOVERY_SECRET_WARNING,
  buildExpiredSessionCookie,
  buildSessionCookie,
} from "@/server/auth";
import { prisma } from "@/server/db";
import {
  type AccountRepository,
  PrismaAccountRepository,
} from "@/server/repositories/account-repository";

const recoverySchema = z.strictObject({
  alias: z.string().trim().min(1).max(80),
  recoverySecret: z.string().min(1).max(200),
});

type RuntimeNodeEnvironment = "development" | "test" | "production";

export interface AccountRecoveryPostHandlerOptions {
  accounts: Pick<AccountRepository, "recover">;
  isPersistenceAvailable: boolean;
  nodeEnvironment: RuntimeNodeEnvironment;
  requestId?: () => string;
}

export interface AccountRevokeHandlerOptions {
  accounts: Pick<AccountRepository, "revokeSession">;
  isPersistenceAvailable: boolean;
  nodeEnvironment: RuntimeNodeEnvironment;
  requestId?: () => string;
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie") ?? "";
  const pair = header.split(";").map((part) => part.trim()).find((part) => part.startsWith("manbo_session="));
  return pair ? pair.slice("manbo_session=".length) || null : null;
}

function responseError(
  code: "INVALID_INPUT" | "UNAUTHENTICATED" | "DEGRADED",
  message: string,
  status: 400 | 401 | 503,
  requestId: string,
): Response {
  return Response.json({ code, message, requestId }, { status, headers: { "cache-control": "no-store" } });
}

async function parseRecovery(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 64 * 1024) return null;
  try {
    const parsed = recoverySchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createAccountRecoveryPostHandler({
  accounts,
  isPersistenceAvailable,
  nodeEnvironment,
  requestId = randomUUID,
}: AccountRecoveryPostHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    const id = requestId();
    if (!isPersistenceAvailable) return responseError("DEGRADED", "账户服务暂时不可用；请稍后重试。", 503, id);
    const input = await parseRecovery(request);
    if (!input) return responseError("INVALID_INPUT", "恢复请求格式不符合要求。", 400, id);
    const session = await accounts.recover(input.alias, input.recoverySecret).catch(() => null);
    if (!session) return responseError("UNAUTHENTICATED", "化名或恢复密钥不正确。", 401, id);
    return Response.json(
      { message: "会话已恢复。", warning: RECOVERY_SECRET_WARNING },
      {
        headers: {
          "cache-control": "no-store",
          "set-cookie": buildSessionCookie(session.sessionId, nodeEnvironment),
        },
      },
    );
  };
}

export function createAccountRevokeHandler({
  accounts,
  isPersistenceAvailable,
  nodeEnvironment,
  requestId = randomUUID,
}: AccountRevokeHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    const id = requestId();
    if (!isPersistenceAvailable) return responseError("DEGRADED", "账户服务暂时不可用；请稍后重试。", 503, id);
    const sessionId = cookieValue(request);
    if (!sessionId) return responseError("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    try {
      await accounts.revokeSession(sessionId);
    } catch {
      return responseError("DEGRADED", "账户服务暂时不可用；请稍后重试。", 503, id);
    }
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store", "set-cookie": buildExpiredSessionCookie(nodeEnvironment) },
    });
  };
}

const defaultAccounts = new PrismaAccountRepository(prisma);
const available =
  process.env.APP_MODE !== "static" &&
  Boolean(process.env.DATABASE_URL) &&
  (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET));
const nodeEnvironment: RuntimeNodeEnvironment = process.env.NODE_ENV === "production" ? "production" : process.env.NODE_ENV === "test" ? "test" : "development";

export async function POST(request: Request) {
  return createAccountRecoveryPostHandler({ accounts: defaultAccounts, isPersistenceAvailable: available, nodeEnvironment })(request);
}

export async function DELETE(request: Request) {
  return createAccountRevokeHandler({ accounts: defaultAccounts, isPersistenceAvailable: available, nodeEnvironment })(request);
}
