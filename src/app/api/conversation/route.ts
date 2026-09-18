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
import {
  RetrySourceSuperseded,
  type PrismaMessageRepository,
} from "@/server/repositories/message-repository";
import type { MaterialAiContextRepository } from "@/server/repositories/material-ai-context-repository";
import { prisma } from "@/server/db";
import { PrismaAccountRepository } from "@/server/repositories/account-repository";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { PrismaMessageRepository as DefaultMessageRepository } from "@/server/repositories/message-repository";
import { readCookie } from "@/app/api/cases/route";
import { buildAuditEvent, recordAudit, type AuditEvent } from "@/server/audit";
import { PrismaMaterialAiContextRepository } from "@/server/repositories/material-ai-context-repository";
import { createMaterialDerivativeContentCipherFromEnv } from "@/media/security/material-derivative-content";
import {
  hashTurnIdentity,
  turnResponseSnapshotSchema,
  turnResultSnapshotSchema,
} from "@/server/services/conversation-turn-contract";
import {
  PrismaConversationTurnRepository,
  type ReserveTurnResult,
} from "@/server/repositories/conversation-turn-repository";
import {
  PrismaConversationTurnFinalizer,
  type FinalizeTurnResult,
} from "@/server/services/conversation-turn-finalizer";
import { createConversationTurnSnapshotCipherFromEnv } from "@/server/services/conversation-turn-snapshot-cipher";

function normalizeRequestText(value: string): string {
  return value.normalize("NFC").trim();
}

const requestMessageSchema = z.string().transform(normalizeRequestText).pipe(z.string().min(1).max(10_000));
const requestContentRefSchema = z.string().transform(normalizeRequestText).pipe(z.string().min(1).max(180));

function canonicalContentRefs(contentRefs: readonly string[] | undefined): string[] {
  return [...new Set((contentRefs ?? []).map(normalizeRequestText))].sort();
}

function messagesThroughBoundary<T extends { messageId: string; messageSequence: number }>(
  messages: readonly T[],
  boundaryMessageId: string,
): T[] {
  const boundary = messages.find((message) => message.messageId === boundaryMessageId);
  if (!boundary) {
    // A committed user message should be visible immediately in PostgreSQL.
    // If an adapter cannot prove the boundary, fail closed to the boundary
    // message only instead of allowing a later turn into this AI context.
    return messages.filter((message) => message.messageId === boundaryMessageId);
  }
  return messages.filter((message) => message.messageSequence <= boundary.messageSequence);
}

const requestSchema = z.strictObject({
  sessionId: z.string().min(1).max(120),
  message: requestMessageSchema,
  caseId: z.string().min(1).max(80).optional(),
  contentRefs: z.array(requestContentRefSchema).max(32).optional(),
  retryUserMessageId: z.uuid().optional(),
  turnId: z.uuid().optional(),
});

type MessageRepository = Pick<
  PrismaMessageRepository,
  "append" | "appendAssistant" | "appendAssistantForLatestUser" | "findPrivateUser" | "listPrivate"
>;

type TurnLedgerRepository = Pick<
  PrismaConversationTurnRepository,
  "reserve" | "recordResult" | "get" | "markFailure"
>;

export interface ConversationPostHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate" | "updatePrivate">;
  messages: MessageRepository;
  materials?: Pick<MaterialAiContextRepository, "resolveAiContext">;
  isPersistenceAvailable: boolean;
  providerFactory?: (sourceMessageId: string, input: string) => AiProvider | undefined;
  requestId?: () => string;
  audit?: (event: AuditEvent) => Promise<void>;
  turns?: TurnLedgerRepository;
  finalizer?: Pick<PrismaConversationTurnFinalizer, "finalize">;
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
    context: { jurisdiction: {}, facts: [], timeline: [], sourceMessageIds: [], materials: [] },
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
  code: "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND" | "VERSION_CONFLICT" | "DEGRADED" | "TURN_FAILED" | "TURN_ID_REQUIRED" | "TURN_IN_PROGRESS" | "IDEMPOTENCY_CONFLICT",
  message: string,
  status: 400 | 401 | 404 | 409 | 503 | 202,
  requestId: string,
  headers: HeadersInit = {},
): Response {
  return Response.json({ code, message, requestId }, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function snapshotResponse(snapshot: unknown, fallbackStatus = 200): Response {
  const parsed = turnResponseSnapshotSchema.parse(snapshot);
  return Response.json(parsed, {
    status: parsed.statusCode ?? fallbackStatus,
    headers: { "cache-control": "no-store" },
  });
}

async function markTurnFailure(
  turns: Pick<PrismaConversationTurnRepository, "markFailure">,
  accountId: string,
  caseId: string,
  turnId: string,
  requestHash: string,
  status: "failed" | "cancelled",
  failure: { code: string; message: string; statusCode: 400 | 499 | 503 },
): Promise<boolean> {
  try {
    const result = await turns.markFailure(accountId, caseId, turnId, requestHash, status, failure);
    return result.status === status;
  } catch {
    // Keep the outward response fail-closed if the failure marker itself is
    // unavailable. A later request can still recover a result_ready turn.
    return false;
  }
}

interface TurnLedgerFlowInput {
  request: Request;
  requestId: string;
  owner: NonNullable<Awaited<ReturnType<AccountRepository["resumeSession"]>>>;
  record: Awaited<ReturnType<CaseRepository["getPrivate"]>>;
  parsed: z.infer<typeof requestSchema>;
  retryUserMessage: Awaited<ReturnType<MessageRepository["findPrivateUser"]>> | null;
  retryConversation: Awaited<ReturnType<MessageRepository["listPrivate"]>> | undefined;
  messages: MessageRepository;
  materials?: Pick<MaterialAiContextRepository, "resolveAiContext">;
  providerFactory: (sourceMessageId: string, input: string) => AiProvider | undefined;
  turns: TurnLedgerRepository;
  finalizer: Pick<PrismaConversationTurnFinalizer, "finalize">;
}

async function runTurnLedgerFlow(input: TurnLedgerFlowInput): Promise<Response> {
  const { request, requestId, owner, record, parsed, retryUserMessage, retryConversation, messages, materials, providerFactory, turns, finalizer } = input;
  if (!record || !parsed.caseId || !parsed.turnId) {
    return errorResponse("TURN_ID_REQUIRED", "持久化对话需要稳定的轮次编号。", 400, requestId);
  }

  const operation = parsed.retryUserMessageId ? "retry" as const : "send" as const;
  const authoritativeInput = normalizeRequestText(retryUserMessage?.content ?? parsed.message);
  const authoritativeContentRefs = canonicalContentRefs(parsed.contentRefs);
  let existingTurn: Awaited<ReturnType<PrismaConversationTurnRepository["get"]>> | null = null;
  try {
    existingTurn = await input.turns.get(owner.accountId, record.caseId, parsed.turnId);
  } catch {
    return errorResponse("DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
  }
  const baseCaseVersion = existingTurn?.baseCaseVersion ?? record.version;
  const requestHash = hashTurnIdentity({
    operation,
    caseId: record.caseId,
    ...(retryUserMessage ? { sourceUserMessageId: retryUserMessage.messageId } : {}),
    message: authoritativeInput,
    contentRefs: authoritativeContentRefs,
    baseCaseVersion,
  });

  let reservation: ReserveTurnResult;
  try {
    reservation = await turns.reserve({
      accountId: owner!.accountId,
      caseId: record.caseId,
      turnId: parsed.turnId,
      operation,
      requestHash,
      baseCaseVersion,
      message: authoritativeInput,
      ...(retryUserMessage ? { sourceUserMessageId: retryUserMessage.messageId, userMessageId: retryUserMessage.messageId } : {}),
    });
  } catch (error) {
    if (error instanceof RetrySourceSuperseded || error instanceof Error && error.name === "ConversationTurnSourceSuperseded") {
      return errorResponse("VERSION_CONFLICT", "案件已出现更新，请刷新后再重试。", 409, requestId);
    }
    return errorResponse("DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
  }

  if (reservation.kind === "idempotency_conflict") {
    return errorResponse("IDEMPOTENCY_CONFLICT", "该轮次编号已绑定另一份请求，已拒绝重复写入。", 409, requestId);
  }
  if (reservation.kind === "in_flight") {
    return errorResponse("TURN_IN_PROGRESS", "该轮次仍在处理中，请稍后重试。", 202, requestId, { "retry-after": "2" });
  }
  if (reservation.kind === "replay") {
    if (!reservation.turn.responseSnapshot) return errorResponse("DEGRADED", "已保存轮次缺少可重放结果。", 503, requestId);
    try {
      return snapshotResponse(reservation.turn.responseSnapshot);
    } catch {
      return errorResponse("DEGRADED", "已保存轮次无法安全恢复。", 503, requestId);
    }
  }

  let finalization: FinalizeTurnResult;
  if (reservation.kind === "result_ready") {
    try {
      finalization = await finalizer.finalize({ accountId: owner.accountId, caseId: record.caseId, turnId: parsed.turnId, requestHash });
    } catch {
      return errorResponse("DEGRADED", "对话结果已准备，但案件最终保存暂时不可用。", 503, requestId);
    }
    if (finalization.kind === "in_flight") return errorResponse("TURN_IN_PROGRESS", "该轮次仍在处理中，请稍后重试。", 202, requestId, { "retry-after": "2" });
    try {
      return snapshotResponse(finalization.responseSnapshot, finalization.kind === "conflict" ? 409 : 200);
    } catch {
      return errorResponse("DEGRADED", "对话结果无法安全恢复。", 503, requestId);
    }
  }

  let materialContext: ConversationContext["materials"] = [];
  if (authoritativeContentRefs.length > 0) {
    if (!materials) {
      await markTurnFailure(
        turns,
        owner.accountId,
        record.caseId,
        parsed.turnId,
        requestHash,
        "failed",
        { code: "INVALID_INPUT", message: "所选材料当前无法用于 AI，请稍后重试。", statusCode: 400 },
      );
      return errorResponse("INVALID_INPUT", "所选材料当前无法用于 AI，请稍后重试。", 400, requestId);
    }
    try {
      materialContext = await materials.resolveAiContext(owner.accountId, record.caseId, authoritativeContentRefs);
    } catch {
      await markTurnFailure(
        turns,
        owner.accountId,
        record.caseId,
        parsed.turnId,
        requestHash,
        "failed",
        { code: "INVALID_INPUT", message: "所选材料当前无法用于 AI，请刷新材料状态后重试。", statusCode: 400 },
      );
      return errorResponse("INVALID_INPUT", "所选材料当前无法用于 AI，请刷新材料状态后重试。", 400, requestId);
    }
  }

  try {
    throwIfRequestCancelled(request.signal);
    if (reservation.kind !== "owner") {
      return errorResponse("DEGRADED", "对话轮次状态无法安全恢复。", 503, requestId);
    }
    const userMessageId = reservation.userMessageId;
    const previous = messagesThroughBoundary(
      retryConversation ?? await messages.listPrivate(owner.accountId, record.caseId),
      userMessageId,
    );
    const context: ConversationContext = {
      jurisdiction: record.jurisdiction,
      facts: record.facts,
      timeline: record.timeline,
      sourceMessageIds: [...new Set([...previous.map((message) => message.messageId), userMessageId])],
      materials: materialContext,
    };
    const session: ConversationSession = {
      ...initialSession(parsed.sessionId),
      state: stateForMessageCount(Math.max(0, previous.filter((message) => message.role === "user").length - 1)),
      context,
    };
    const assistant = await createConversationOrchestrator({
      provider: providerFactory(userMessageId, authoritativeInput) ?? createLocalProvider(userMessageId, authoritativeInput),
      inputPolicy: { async prepare(value) { return { kind: "approved", text: value, basis: "no_hint" }; } },
      knowledgeSourceIds: [],
    }).handleMessage(authoritativeInput, session, request.signal);
    const resultSnapshot = turnResultSnapshotSchema.parse({ assistant });
    await turns.recordResult(owner.accountId, record.caseId, parsed.turnId, requestHash, resultSnapshot);
    if (request.signal.aborted) {
      await markTurnFailure(
        turns,
        owner.accountId,
        record.caseId,
        parsed.turnId,
        requestHash,
        "cancelled",
        { code: "CANCELLED", message: "本轮已取消，未完成案件更新。", statusCode: 499 },
      );
      return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
    }
    finalization = await finalizer.finalize({ accountId: owner.accountId, caseId: record.caseId, turnId: parsed.turnId, requestHash });
    if (finalization.kind === "in_flight") return errorResponse("TURN_IN_PROGRESS", "该轮次仍在处理中，请稍后重试。", 202, requestId, { "retry-after": "2" });
    try {
      return snapshotResponse(finalization.responseSnapshot, finalization.kind === "conflict" ? 409 : 200);
    } catch {
      return errorResponse("DEGRADED", "对话结果无法安全恢复。", 503, requestId);
    }
  } catch (error) {
    if (error instanceof ConversationCancelledError || request.signal.aborted) {
      await markTurnFailure(
        turns,
        owner.accountId,
        record.caseId,
        parsed.turnId,
        requestHash,
        "cancelled",
        { code: "CANCELLED", message: "本轮已取消，未完成案件更新。", statusCode: 499 },
      );
      return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
    }
    if (error instanceof Error && error.name === "ConcurrencyConflict") {
      return errorResponse("VERSION_CONFLICT", "案件已被更新，请刷新后重试。", 409, requestId);
    }
    const markedFailed = await markTurnFailure(
      turns,
      owner.accountId,
      record.caseId,
      parsed.turnId,
      requestHash,
      "failed",
      { code: "TURN_FAILED", message: "对话服务暂时不可用；本轮未完成档案更新。", statusCode: 503 },
    );
    return errorResponse(markedFailed ? "TURN_FAILED" : "DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
  }
}

export function createConversationPostHandler(options: ConversationPostHandlerOptions) {
  const providerFactory = options.providerFactory ?? createLocalProvider;

  return async function POST(request: Request): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isPersistenceAvailable) {
      const parsed = requestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return errorResponse("INVALID_INPUT", "消息格式或长度不符合要求。", 400, requestId);
      if (parsed.data.contentRefs && parsed.data.contentRefs.length > 0) {
        return errorResponse("INVALID_INPUT", "当前预览模式不能使用已保存材料。", 400, requestId);
      }
      if (parsed.data.retryUserMessageId) {
        return errorResponse("INVALID_INPUT", "当前预览模式没有可验证的持久化消息。", 400, requestId);
      }
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

    let retryUserMessage: Awaited<ReturnType<MessageRepository["findPrivateUser"]>> | null = null;
    let retryConversation: Awaited<ReturnType<MessageRepository["listPrivate"]>> | undefined;
    let existingTurnForRequest: Awaited<ReturnType<PrismaConversationTurnRepository["get"]>> | null = null;
    if (options.turns && parsed.data.turnId) {
      try {
        existingTurnForRequest = await options.turns.get(owner.accountId, record.caseId, parsed.data.turnId);
      } catch {
        return errorResponse("DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
      }
    }
    if (parsed.data.retryUserMessageId) {
      try {
        retryUserMessage = await options.messages.findPrivateUser(
          owner.accountId,
          record.caseId,
          parsed.data.retryUserMessageId,
        );
        if (retryUserMessage) {
          retryConversation = await options.messages.listPrivate(owner.accountId, record.caseId);
        }
      } catch {
        return errorResponse("DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
      }
      if (!retryUserMessage) {
        return errorResponse("NOT_FOUND", "消息不存在或当前会话无权访问。", 404, requestId);
      }
      const latestUserMessage = [...(retryConversation ?? [])]
        .reverse()
        .find((message) => message.role === "user");
      if (latestUserMessage?.messageId !== retryUserMessage.messageId && !existingTurnForRequest) {
        return errorResponse("NOT_FOUND", "消息不存在或当前会话无权访问。", 404, requestId);
      }
    }

    // New persistent deployments use the turn ledger. Keeping the legacy
    // branch below available lets an older application instance roll forward
    // during the bounded migration window; production wiring always supplies
    // both dependencies and therefore requires a client turnId.
    if (options.turns && options.finalizer) {
      if (!parsed.data.turnId) {
        return errorResponse("TURN_ID_REQUIRED", "持久化对话需要稳定的轮次编号。", 400, requestId);
      }
      return runTurnLedgerFlow({
        request,
        requestId,
        owner,
        record,
        parsed: parsed.data,
        retryUserMessage,
        retryConversation,
        messages: options.messages,
        ...(options.materials ? { materials: options.materials } : {}),
        providerFactory,
        turns: options.turns,
        finalizer: options.finalizer,
      });
    }

    const authoritativeContentRefs = canonicalContentRefs(parsed.data.contentRefs);
    let materialContext: ConversationContext["materials"] = [];
    if (authoritativeContentRefs.length > 0) {
      if (!options.materials) {
        return errorResponse("INVALID_INPUT", "所选材料当前无法用于 AI，请稍后重试。", 400, requestId);
      }
      try {
        materialContext = await options.materials.resolveAiContext(
          owner.accountId,
          record.caseId,
          authoritativeContentRefs,
        );
      } catch {
        return errorResponse("INVALID_INPUT", "所选材料当前无法用于 AI，请刷新材料状态后重试。", 400, requestId);
      }
    }

    try {
      const userMessage = retryUserMessage ?? await options.messages.append(
          owner.accountId,
          record.caseId,
          { role: "user", content: parsed.data.message },
          randomUUID(),
        );
      const authoritativeInput = normalizeRequestText(retryUserMessage?.content ?? parsed.data.message);
      const previous = messagesThroughBoundary(
        retryConversation ?? await options.messages.listPrivate(owner.accountId, record.caseId),
        userMessage.messageId,
      );
      const context: ConversationContext = {
        jurisdiction: record.jurisdiction,
        facts: record.facts,
        timeline: record.timeline,
        sourceMessageIds: [...new Set([
          ...previous.map((message) => message.messageId),
          userMessage.messageId,
        ])],
        materials: materialContext,
      };
      const session: ConversationSession = {
        ...initialSession(parsed.data.sessionId),
        state: stateForMessageCount(Math.max(0, previous.filter((message) => message.role === "user").length - 1)),
        context,
      };
      const assistant = await createConversationOrchestrator({
        provider: providerFactory(userMessage.messageId, authoritativeInput) ?? createLocalProvider(userMessage.messageId, authoritativeInput),
        inputPolicy: { async prepare(input) { return { kind: "approved", text: input, basis: "no_hint" }; } },
        knowledgeSourceIds: [],
      }).handleMessage(authoritativeInput, session, request.signal);
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
        if (retryUserMessage) {
          await options.messages.appendAssistantForLatestUser(
            owner.accountId,
            record.caseId,
            retryUserMessage.messageId,
            assistant.message,
            randomUUID(),
          );
        } else {
          await options.messages.appendAssistant(
            owner.accountId,
            record.caseId,
            assistant.message,
            randomUUID(),
          );
        }
      }
      return Response.json({
        assistant,
        caseDraft: assistant.draftPatch,
        caseVersion,
        persistence: {
          messageSaved: !assistant.degraded,
          userMessageSaved: true,
          assistantMessageSaved: !assistant.degraded,
          userMessageCreated: !retryUserMessage,
          userMessageId: userMessage.messageId,
          caseUpdated: Boolean(assistant.draftPatch && !assistant.degraded),
        },
      }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof ConversationCancelledError || request.signal.aborted) {
        return new Response(null, { status: 499, headers: { "cache-control": "no-store" } });
      }
      if (error instanceof Error && error.name === "ConcurrencyConflict") {
        return errorResponse("VERSION_CONFLICT", "案件已被更新，请刷新后重试。", 409, requestId);
      }
      if (error instanceof RetrySourceSuperseded) {
        return errorResponse("VERSION_CONFLICT", "案件已出现更新，请刷新后再重试。", 409, requestId);
      }
      return errorResponse("DEGRADED", "对话服务暂时不可用；本轮未完成档案更新。", 503, requestId);
    }
  };
}

const defaultAccounts = new PrismaAccountRepository(prisma);
const defaultCases = new PrismaCaseRepository(prisma);
const defaultMessages = new DefaultMessageRepository(prisma);
const turnSnapshotCipherConfiguration = createConversationTurnSnapshotCipherFromEnv(process.env);
const defaultTurnSnapshotCipher = turnSnapshotCipherConfiguration.available
  ? turnSnapshotCipherConfiguration.cipher
  : undefined;
const defaultTurns = new PrismaConversationTurnRepository(prisma, defaultTurnSnapshotCipher);
const defaultTurnFinalizer = new PrismaConversationTurnFinalizer(prisma, undefined, defaultTurnSnapshotCipher);
const derivativeCipherConfiguration = createMaterialDerivativeContentCipherFromEnv(process.env);
const defaultMaterialContextRepository = derivativeCipherConfiguration.available
  ? new PrismaMaterialAiContextRepository(prisma, derivativeCipherConfiguration.cipher)
  : undefined;

export async function POST(request: Request): Promise<Response> {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_MODE !== "static" &&
    (!process.env.DATABASE_URL || process.env.AI_PROVIDER !== "gateway")
  ) {
    return errorResponse("DEGRADED", "对话服务尚未连接生产账户与持久化存储。", 503, randomUUID());
  }
  if (
    process.env.NODE_ENV === "production" &&
    process.env.APP_MODE !== "static" &&
    !turnSnapshotCipherConfiguration.available
  ) {
    return errorResponse("DEGRADED", "对话服务尚未完成安全配置（对话快照密钥缺失）。", 503, randomUUID());
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
    ...(defaultMaterialContextRepository ? { materials: defaultMaterialContextRepository } : {}),
    audit: (event) => recordAudit(event),
    turns: defaultTurns,
    finalizer: defaultTurnFinalizer,
    providerFactory,
    isPersistenceAvailable:
      process.env.APP_MODE !== "static" &&
      Boolean(process.env.DATABASE_URL) &&
      (process.env.NODE_ENV !== "production" || process.env.AI_PROVIDER === "gateway"),
  })(request);
}
