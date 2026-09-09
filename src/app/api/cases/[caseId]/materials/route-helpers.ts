import { randomUUID } from "node:crypto";

import type { AccountRepository } from "@/server/repositories/account-repository";
import { readCookie } from "@/app/api/cases/route";

export const MAX_MATERIAL_REQUEST_BYTES = 64 * 1024;

export type MaterialRouteContext<T extends Record<string, string>> = { params: Promise<T> };

export type MaterialRouteErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "VERSION_CONFLICT"
  | "DEGRADED";

export function materialErrorResponse(
  code: MaterialRouteErrorCode,
  message: string,
  status: 400 | 401 | 404 | 409 | 413 | 503,
  requestId: string = randomUUID(),
): Response {
  return Response.json(
    { code, message, requestId },
    { status, headers: { "cache-control": "no-store" } },
  );
}

export async function resolveMaterialOwner(
  request: Request,
  accounts: Pick<AccountRepository, "resumeSession">,
): Promise<{ accountId: string } | null> {
  const sessionId = readCookie(request, "manbo_session");
  return sessionId ? accounts.resumeSession(sessionId) : null;
}
