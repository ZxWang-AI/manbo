import { randomUUID } from "node:crypto";

import { z } from "zod";

import { RECOVERY_SECRET_WARNING, buildSessionCookie } from "@/server/auth";
import { prisma } from "@/server/db";
import {
  PrismaAccountRepository,
  type AccountRepository,
} from "@/server/repositories/account-repository";

const accountCreateSchema = z.strictObject({});
const MAX_REQUEST_BYTES = 64 * 1024;

type RuntimeNodeEnvironment = "development" | "test" | "production";

export interface AccountPostHandlerOptions {
  accounts: AccountRepository;
  isPersistenceAvailable: boolean;
  nodeEnvironment: RuntimeNodeEnvironment;
  requestId?: () => string;
}

function requestIdFactory(): string {
  return randomUUID();
}

function errorResponse(
  code: "INVALID_INPUT" | "DEGRADED",
  message: string,
  status: 400 | 503,
  requestId: string,
): Response {
  return Response.json(
    { code, message, requestId },
    {
      status,
      headers: { "cache-control": "no-store" },
    },
  );
}

async function parseEmptyBody(request: Request): Promise<boolean> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    return false;
  }
  if (body.trim() === "") {
    return true;
  }

  try {
    return accountCreateSchema.safeParse(JSON.parse(body)).success;
  } catch {
    return false;
  }
}

export function createAccountPostHandler({
  accounts,
  isPersistenceAvailable,
  nodeEnvironment,
  requestId = requestIdFactory,
}: AccountPostHandlerOptions): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    const id = requestId();

    if (!isPersistenceAvailable) {
      return errorResponse(
        "DEGRADED",
        "账户服务暂时不可用；请稍后重试。",
        503,
        id,
      );
    }

    if (!(await parseEmptyBody(request))) {
      return errorResponse("INVALID_INPUT", "账户创建请求必须是空对象。", 400, id);
    }

    try {
      const created = await accounts.createPseudonymous();
      return Response.json(
        {
          alias: created.alias,
          recoverySecret: created.recoverySecret,
          warning: RECOVERY_SECRET_WARNING,
        },
        {
          status: 201,
          headers: {
            "cache-control": "no-store",
            "set-cookie": buildSessionCookie(created.session.sessionId, nodeEnvironment),
          },
        },
      );
    } catch {
      return errorResponse("DEGRADED", "账户服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

const defaultAccounts = new PrismaAccountRepository(prisma);

function hasPersistenceConfiguration(): boolean {
  return (
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET))
  );
}

function runtimeNodeEnvironment(): RuntimeNodeEnvironment {
  return process.env.NODE_ENV === "production"
    ? "production"
    : process.env.NODE_ENV === "test"
      ? "test"
      : "development";
}

export async function POST(request: Request): Promise<Response> {
  return createAccountPostHandler({
    accounts: defaultAccounts,
    isPersistenceAvailable: hasPersistenceConfiguration(),
    nodeEnvironment: runtimeNodeEnvironment(),
  })(request);
}
