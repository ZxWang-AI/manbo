import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createConversationOrchestrator } from "@/ai/orchestrator";
import { createAiProviderFactoryFromProcessEnv } from "@/ai/provider-factory";
import {
  ConversationCancelledError,
  type AiProvider,
  type ConversationContext,
  type ConversationSession,
  type FactExtraction,
} from "@/ai/provider";
import type { EvidenceCoverageItem, IndicatorAssessment, SafetyFlag } from "@/domain/assessment";
import type { CaseRepository } from "@/server/repositories/case-repository";
import type { AccountRepository } from "@/server/repositories/account-repository";
import type { PrismaMessageRepository } from "@/server/repositories/message-repository";
import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { PrismaMessageRepository as DefaultMessageRepository } from "@/server/repositories/message-repository";
import { readCookie } from "@/app/api/cases/route";
import { buildAuditEvent, recordAudit, type AuditEvent } from "@/server/audit";

const requestSchema = z.strictObject({
  sessionId: z.string().min(1).max(120),
  message: z.string().min(1).max(10_000),
  caseId: z.string().min(1).max(80).optional(),
  contentRefs: z.array(z.string().min(1).max(180)).max(32).optional(),
});

type MessageRepository = Pick<PrismaMessageRepository, "append" | "appendAssistant" | "listPrivate">;

export interface ConversationPostHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate" | "updatePrivate">;
  messages: MessageRepository;
  isPersistenceAvailable: boolean;
  providerFactory?: (sourceMessageId: string, input: string) => AiProvider | undefined;
  requestId?: () => string;
  audit?: (event: AuditEvent) => Promise<void>;
}

function defaultIndicators(sourceMessageId: string, input: string): IndicatorAssessment[] {
  const mentionsDocumentControl = /(护照|身份证|证件)/u.test(input);
  return Array.from({ length: 11 }, (_, index) => ({
    indicatorId: (index + 1) as IndicatorAssessment["indicatorId"],
    status: index === 5 && mentionsDocumentControl ? "hit" : "insufficient",
    basis: [{ kind: "conversation" as const, id: sourceMessageId }],
    missing: index === 5 && mentionsDocumentControl ? [] : ["需要更多由你确认的事实"],
  }));
}

function createLocalProvider(sourceMessageId: string, input: string): AiProvider {
  const extraction: FactExtraction = {
    facts: [{
      id: `fact-${sourceMessageId}`,
      field: "经历中的关键事实",
      value: input.slice(0, 240),
      sourceMessageIds: [sourceMessageId],
      sourceQuote: input.slice(0, 240),
      certainty: "user_stated",
    }],
    timeline: [],
    jurisdictionPatch: {},
  };
  const coverage: EvidenceCoverageItem[] = [{
    topic: "supporting_material",
    status: "gap",
    explanation: "当前还没有经过安全扫描并由你确认的材料。",
    sourceMessageIds: [sourceMessageId],
    safeOptions: ["只在安全情况下补充", "也可以先不上传"],
  }];
  return {
    async detectSafety(): Promise<SafetyFlag[]> { return []; },
    async extractFacts(): Promise<FactExtraction> { return structuredClone(extraction); },
    async mapIndicators(): Promise<IndicatorAssessment[]> { return defaultIndicators(sourceMessageId, input); },
    async summarizeCoverage(): Promise<EvidenceCoverageItem[]> { return structuredClone(coverage); },
  };
}

function initialSession(sessionId: string): ConversationSession {
  return {
    sessionId,
    state: "WELCOME",
    context: { jurisdiction: {}, facts: [], timeline: [], sourceMessageIds: [] },
  };
}

function stateForMessageCount(count: number): ConversationSession["state"] {
  const states: ConversationSession["state"][] = [
    "WELCOME", "SAFETY_CHECK", "JURISDICTION_CONTEXT", "FACT_GATHERING",
    "ILO_MAPPING", "EVIDENCE_COVERAGE", "LEGAL_NAVIGATION", "CHANNEL_OPTIONS",
    "USER_REVIEW", "SAVE_OR_EXPORT",
  ];
  return states[Math.min(count, states.length - 1)] ?? "WELCOME";
}

/**
 * A request may be cancelled while an earlier database operation is in flight.
 * Check this immediately before each later side effect so cancellation prevents
 * writes that have not yet begun. Operations already handed to a repository are
 * deliberately not reported as rolled back: their transaction owns its commit.
 */
function throwIfRequestCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new ConversationCancelledError();
}

function errorResponse(
  code: "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND" | "VERSION_CONFLICT" | "DEGRADED",
  message: string,
  status: 400 | 401 | 404 | 409 | 503,
  requestId: string,
): Response {
  return Response.json({ code, message, requestId }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function createConversationPostHandler(options: ConversationPostHandlerOptions) {
  const providerFactory = options.providerFactory ?? createLocalProvider;

  return async function POST(request: Request): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isPersistenceAvailable) {
      const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return errorResponse("INVALID_INPUT", "消息格式或长度不符合要求。", 400, requestId);
      const sourceId = `message-${parsed.data.sessionId}`;
      const session = initialSession(parsed.data.sessionId);
      session.context.sourceMessageIds = [sourceId];
      let assistant;
      try {
        assistant = await createConversationOrchestrator({
          provider: providerFactory(sourceId, parsed.data.message) ?? createLocalProvider(sourceId, parsed.data.message),
          inputPolicy: { async prepare(input) { return { kind: "approved", text: input, basis: "no_hint" }; } },
          knowledgeSourceIds: [],
        }).handleMessage(parsed.data.message, session, request.signal);
      } catch (error) {
        if (error instanceof ConversationCancelledError || request.signal.aborted) {
          return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
        }
        throw error;
      }
      return Response.json({ assistant, caseDraft: assistant.draftPatch }, { headers: { "cache-control": "no-store" } });
    }

    const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
    if (!parsed.success) return errorResponse("INVALID_INPUT", "消息格式或长度不符合要求。", 400, requestId);
    const sessionId = readCookie(request, "manbo_session");
    if (!sessionId) return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
    const owner = await options.accounts.resumeSession(sessionId).catch(() => null);
    if (!owner) return errorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, requestId);
    if (!parsed.data.caseId) return errorResponse("INVALID_INPUT", "持久化对话需要绑定私密案件。", 400, requestId);

    const record = await options.cases.getPrivate(owner.accountId, parsed.data.caseId).catch(() => null);
    if (!record) return errorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, requestId);

    try {
      const userMessage = await options.messages.append(
        owner.accountId,
        record.caseId,
        { role: "user", content: parsed.data.message },
        randomUUID(),
      );
      const previous = await options.messages.listPrivate(owner.accountId, record.caseId);
      const context: ConversationContext = {
        jurisdiction: record.jurisdiction,
        facts: record.facts,
        timeline: record.timeline,
        sourceMessageIds: [...previous.map((message) => message.messageId), userMessage.messageId],
      };
      const session: ConversationSession = {
        ...initialSession(parsed.data.sessionId),
        state: stateForMessageCount(Math.max(0, previous.filter((message) => message.role === "user").length - 1)),
        context,
      };
      const assistant = await createConversationOrchestrator({
        provider: providerFactory(userMessage.messageId, parsed.data.message) ?? createLocalProvider(userMessage.messageId, parsed.data.message),
        inputPolicy: { async prepare(input) { return { kind: "approved", text: input, basis: "no_hint" }; } },
        knowledgeSourceIds: [],
      }).handleMessage(parsed.data.message, session, request.signal);
      throwIfRequestCancelled(request.signal);
      if (assistant.degraded) {
        throwIfRequestCancelled(request.signal);
        await options.audit?.(buildAuditEvent({
          accountId: owner.accountId,
          caseId: record.caseId,
          action: "model_fallback",
          outcome: "failed",
          metadata: { reasonCode: "AI_DEGRADED" },
        }));
      }
      let caseVersion = record.version;
      if (assistant.draftPatch && !assistant.degraded) {
        throwIfRequestCancelled(request.signal);
        const updated = await options.cases.updatePrivate(
          owner.accountId,
          record.caseId,
          assistant.draftPatch,
          record.version,
        );
        caseVersion = updated.version;
      }
      if (!assistant.degraded) {
        throwIfRequestCancelled(request.signal);
        await options.messages.appendAssistant(owner.accountId, record.caseId, assistant.message, randomUUID());
      }
      return Response.json({
        assistant,
        caseDraft: assistant.draftPatch,
        caseVersion,
        persistence: { messageSaved: true, caseUpdated: Boolean(assistant.draftPatch && !assistant.degraded) },
      }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof ConversationCancelledError || request.signal.aborted) {
        return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
      }
      if (error instanceof Error && error.name === "ConcurrencyConflict") {
        return errorResponse("VERSION_CONFLICT", "案件已被更新，请刷新后重试。", 409, requestId);
      }
      return errorResponse("DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
    }
  };
}

const defaultAccounts = new PrismaAccountRepository(prisma);
const defaultCases = new PrismaCaseRepository(prisma);
const defaultMessages = new DefaultMessageRepository(prisma);

export async function POST(request: Request): Promise<Response> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_MODE !== "static" &&
    (!process.env.DATABASE_URL || process.env.AI_PROVIDER !== "gateway")
  ) {
    return errorResponse("DEGRADED", "对话服务尚未连接生产账户与持久化存储。", 503, randomUUID());
  }

  const requestId = randomUUID();
  let providerFactory;
  try {
    providerFactory = createAiProviderFactoryFromProcessEnv(process.env);
  } catch {
    return errorResponse("DEGRADED", "对话服务尚未完成安全配置。", 503, requestId);
  }

  return createConversationPostHandler({
    accounts: defaultAccounts,
    cases: defaultCases,
    messages: defaultMessages,
    audit: (event) => recordAudit(event),
    providerFactory,
    isPersistenceAvailable:
      process.env.APP_MODE !== "static" &&
      Boolean(process.env.DATABASE_URL) &&
      (process.env.NODE_ENV !== "production" || process.env.AI_PROVIDER === "gateway"),
  })(request);
}
