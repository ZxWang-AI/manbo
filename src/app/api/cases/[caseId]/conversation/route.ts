import { randomUUID } from "node:crypto";

import type { MessageRole } from "@prisma/client";

import { prisma } from "@/server/db";
import { readCookie, errorResponse } from "@/app/api/cases/route";
import { PrismaAccountRepository, type AccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository, type CaseRepository } from "@/server/repositories/case-repository";
import { PrismaMessageRepository } from "@/server/repositories/message-repository";
import { PrismaConversationTurnRepository, type ConversationTurnSummary } from "@/server/repositories/conversation-turn-repository";

export interface ConversationBootstrapMessage {
  messageId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  turnId?: string;
}

export interface ConversationBootstrapTurn {
  turnId: string;
  operation: "send" | "retry";
  status: ConversationTurnSummary["status"];
  sourceUserMessageId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  caseVersionAfter: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationBootstrapGetHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate">;
  messages: Pick<PrismaMessageRepository, "listPrivate">;
  turns?: Pick<PrismaConversationTurnRepository, "listForCase">;
  isPersistenceAvailable: boolean;
  requestId?: () => string;
}

type RouteContext = { params: Promise<{ caseId: string }> };

function unauthenticated(requestId: string): Response {
  return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
}

function notFound(requestId: string): Response {
  return errorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, requestId);
}

function visibleRole(role: MessageRole): "user" | "assistant" | null {
  if (role === "user") return "user";
  if (role === "assistant") return "assistant";
  return null;
}

export function createConversationBootstrapGetHandler({
  accounts,
  cases,
  messages,
  turns: turnsRepository,
  isPersistenceAvailable,
  requestId = randomUUID,
}: ConversationBootstrapGetHandlerOptions) {
  return async function GET(request: Request, context: RouteContext): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable) {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }

    const sessionId = readCookie(request, "manbo_session");
    if (!sessionId) return unauthenticated(id);
    const owner = await accounts.resumeSession(sessionId).catch(() => null);
    if (!owner) return unauthenticated(id);

    const { caseId } = await context.params;
    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) return notFound(id);
      const rows = await messages.listPrivate(owner.accountId, caseId);
      const visibleMessages: ConversationBootstrapMessage[] = rows.flatMap((message) => {
        const role = visibleRole(message.role);
        if (!role) return [];
        return [{
          messageId: message.messageId,
          role,
          content: message.content,
          createdAt: message.createdAt.toISOString(),
          ...(message.turnId ? { turnId: message.turnId } : {}),
        }];
      });
      const turns = turnsRepository
        ? await turnsRepository.listForCase(owner.accountId, caseId)
        : [];
      return Response.json(
        {
          case: record,
          messages: visibleMessages,
          ...(turns.length > 0
            ? {
                turns: turns.map((turn) => ({
                  turnId: turn.turnId,
                  operation: turn.operation,
                  status: turn.status,
                  sourceUserMessageId: turn.sourceUserMessageId,
                  userMessageId: turn.userMessageId,
                  assistantMessageId: turn.assistantMessageId,
                  caseVersionAfter: turn.caseVersionAfter,
                  createdAt: turn.createdAt.toISOString(),
                  updatedAt: turn.updatedAt.toISOString(),
                } satisfies ConversationBootstrapTurn)),
              }
            : {}),
        },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return errorResponse("DEGRADED", "案件服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

const defaultAccounts = new PrismaAccountRepository(prisma);
const defaultCases = new PrismaCaseRepository(prisma);
const defaultMessages = new PrismaMessageRepository(prisma);
const defaultTurns = new PrismaConversationTurnRepository(prisma);

export const GET = createConversationBootstrapGetHandler({
  accounts: defaultAccounts,
  cases: defaultCases,
  messages: defaultMessages,
  turns: defaultTurns,
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
});
