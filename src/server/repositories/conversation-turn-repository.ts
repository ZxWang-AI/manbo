import { randomUUID } from "node:crypto";

import { Prisma, type ConversationTurn as PersistedConversationTurn, type PrismaClient } from "@prisma/client";

import { lockPrivateCase } from "./private-case-lock";
import {
  turnResponseSnapshotSchema,
  turnResultSnapshotSchema,
  type TurnResponseSnapshot,
} from "@/server/services/conversation-turn-contract";
import {
  conversationTurnSnapshotAad,
  type ConversationTurnSnapshotCipher,
} from "@/server/services/conversation-turn-snapshot-cipher";

export type TurnOperation = "send" | "retry";

export interface ReserveTurnInput {
  accountId: string;
  caseId: string;
  turnId: string;
  operation: TurnOperation;
  requestHash: string;
  baseCaseVersion: number;
  message: string;
  sourceUserMessageId?: string;
  userMessageId?: string;
}

export type ReserveTurnResult =
  | { kind: "owner"; turn: PersistedConversationTurn; userMessageId: string }
  | { kind: "replay"; turn: PersistedConversationTurn }
  | { kind: "result_ready"; turn: PersistedConversationTurn }
  | { kind: "in_flight"; turn: PersistedConversationTurn }
  | { kind: "idempotency_conflict"; turn: PersistedConversationTurn };

export interface ConversationTurnSummary {
  turnId: string;
  operation: TurnOperation;
  status: PersistedConversationTurn["status"];
  sourceUserMessageId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  caseVersionAfter: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationTurnUnavailable extends Error {
  constructor() {
    super("Conversation turn is unavailable");
    this.name = "ConversationTurnUnavailable";
  }
}

export class ConversationTurnSourceSuperseded extends Error {
  constructor() {
    super("Conversation retry source is no longer the latest user message");
    this.name = "ConversationTurnSourceSuperseded";
  }
}

export interface TurnFailureInput {
  code: string;
  message: string;
  statusCode: 400 | 499 | 503;
}

export interface ConversationTurnRepositoryOptions {
  now?: () => Date;
  leaseDurationMs?: number;
}

const DEFAULT_LEASE_DURATION_MS = 2 * 60 * 1000;

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonOutput(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

function uniqueWhere(input: Pick<ReserveTurnInput, "accountId" | "caseId" | "turnId">) {
  return {
    accountId_caseId_turnId: {
      accountId: input.accountId,
      caseId: input.caseId,
      turnId: input.turnId,
    },
  };
}

export class PrismaConversationTurnRepository {
  private readonly now: () => Date;
  private readonly leaseDurationMs: number;

  constructor(
    private readonly database: PrismaClient,
    private readonly snapshotCipher?: ConversationTurnSnapshotCipher,
    options: ConversationTurnRepositoryOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.leaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (!Number.isFinite(this.leaseDurationMs) || this.leaseDurationMs <= 0) {
      throw new TypeError("leaseDurationMs must be a positive finite number");
    }
  }

  async reserve(input: ReserveTurnInput): Promise<ReserveTurnResult> {
    if (!Number.isInteger(input.baseCaseVersion) || input.baseCaseVersion < 1) {
      throw new ConversationTurnUnavailable();
    }
    const result = await this.database.$transaction(
      async (transaction) => {
        if (!(await lockPrivateCase(transaction, input.accountId, input.caseId))) {
          throw new ConversationTurnUnavailable();
        }

        let existing = await transaction.conversationTurn.findUnique({ where: uniqueWhere(input) });
        if (existing) {
          if (existing.requestHash !== input.requestHash) {
            return { kind: "idempotency_conflict", turn: existing } as const;
          }
          if (existing.status === "result_ready") return { kind: "result_ready", turn: existing } as const;
          if (existing.status === "completed" || existing.status === "conflict" || existing.status === "failed" || existing.status === "cancelled") {
            return { kind: "replay", turn: existing } as const;
          }
          const now = this.now();
          if (
            (existing.status === "processing" || existing.status === "reserved")
            && (existing.leaseUntil === null || existing.leaseUntil.getTime() <= now.getTime())
          ) {
            const leaseExpiredWhere = existing.leaseUntil === null
              ? { leaseUntil: null }
              : { leaseUntil: { lte: now } };
            const responseSnapshot = turnResponseSnapshotSchema.parse({
              statusCode: 503,
              error: { code: "TURN_EXPIRED", message: "本轮处理已超时，请重新提交。" },
            });
            const encryptedResponse = await this.encodeSnapshot(
              input.accountId,
              input.caseId,
              input.turnId,
              responseSnapshot,
            );
            await transaction.conversationTurn.updateMany({
              where: {
                ...uniqueWhere(input).accountId_caseId_turnId,
                requestHash: input.requestHash,
                status: { in: ["processing", "reserved"] },
                ...leaseExpiredWhere,
              },
              data: {
                status: "failed",
                responseSnapshot: jsonInput(encryptedResponse),
                leaseUntil: null,
                completedAt: now,
              },
            });
            existing = await transaction.conversationTurn.findUnique({ where: uniqueWhere(input) });
            if (existing?.status === "result_ready") {
              return { kind: "result_ready", turn: existing } as const;
            }
            if (existing && (existing.status === "failed" || existing.status === "cancelled" || existing.status === "completed" || existing.status === "conflict")) {
              return { kind: "replay", turn: existing } as const;
            }
            if (!existing) throw new ConversationTurnUnavailable();
          }
          return { kind: "in_flight", turn: existing } as const;
        }

        let userMessageId = input.userMessageId ?? randomUUID();
        if (input.operation === "retry") {
          if (!input.sourceUserMessageId) throw new ConversationTurnUnavailable();
          const source = await transaction.conversationMessage.findFirst({
            where: {
              accountId: input.accountId,
              caseId: input.caseId,
              role: "user",
              messageId: input.sourceUserMessageId,
            },
            orderBy: { messageSequence: "desc" },
            select: { messageId: true },
          });
          const latest = await transaction.conversationMessage.findFirst({
            where: { accountId: input.accountId, caseId: input.caseId, role: "user" },
            orderBy: { messageSequence: "desc" },
            select: { messageId: true },
          });
          if (!source || latest?.messageId !== source.messageId) {
            throw new ConversationTurnSourceSuperseded();
          }
          userMessageId = source.messageId;
        }

        const turn = await transaction.conversationTurn.create({
          data: {
            turnId: input.turnId,
            accountId: input.accountId,
            caseId: input.caseId,
            operation: input.operation,
            status: "processing",
            ...(input.sourceUserMessageId ? { sourceUserMessageId: input.sourceUserMessageId } : {}),
            userMessageId,
            baseCaseVersion: input.baseCaseVersion,
            requestHash: input.requestHash,
            attempts: 1,
            leaseUntil: new Date(this.now().getTime() + this.leaseDurationMs),
          },
        });

        if (input.operation === "send") {
          await transaction.conversationMessage.create({
            data: {
              messageId: userMessageId,
              accountId: input.accountId,
              caseId: input.caseId,
              messageSequence: await this.nextMessageSequence(transaction, input.accountId, input.caseId),
              turnId: input.turnId,
              role: "user",
              content: input.message,
            },
          });
        }

        return { kind: "owner", turn, userMessageId } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
    return this.hydrateReservation(result);
  }

  async recordResult(
    accountId: string,
    caseId: string,
    turnId: string,
    requestHash: string,
    resultSnapshot: unknown,
    responseSnapshot?: unknown,
  ): Promise<PersistedConversationTurn> {
    const parsedResult = turnResultSnapshotSchema.parse(resultSnapshot);
    const parsedResponse = responseSnapshot === undefined
      ? undefined
      : turnResponseSnapshotSchema.parse(responseSnapshot);
    const encryptedResult = await this.encodeSnapshot(accountId, caseId, turnId, parsedResult);
    const encryptedResponse = parsedResponse === undefined
      ? undefined
      : await this.encodeSnapshot(accountId, caseId, turnId, parsedResponse);
    const now = this.now();
    const updated = await this.database.conversationTurn.updateMany({
      where: {
        accountId,
        caseId,
        turnId,
        requestHash,
        status: { in: ["processing", "reserved"] },
        // A provider that returns after its reservation lease has expired is
        // no longer allowed to publish a result. The expiration recovery CAS
        // and this freshness predicate form the two sides of the fence.
        leaseUntil: { gt: now },
      },
      data: {
        status: "result_ready",
        resultSnapshot: jsonInput(encryptedResult),
        ...(encryptedResponse === undefined ? {} : { responseSnapshot: jsonInput(encryptedResponse) }),
        leaseUntil: null,
      },
    });
    if (updated.count !== 1) {
      const existing = await this.get(accountId, caseId, turnId);
      if (!existing || existing.requestHash !== requestHash) throw new ConversationTurnUnavailable();
      return existing;
    }
    const row = await this.get(accountId, caseId, turnId);
    if (!row) throw new ConversationTurnUnavailable();
    return row;
  }

  /**
   * Convert an owner-visible failure into a terminal, replayable turn state.
   * The compare-and-set status predicate prevents a late provider failure from
   * overwriting a result that was already durably recorded.
   */
  async markFailure(
    accountId: string,
    caseId: string,
    turnId: string,
    requestHash: string,
    status: "failed" | "cancelled",
    failure: TurnFailureInput,
  ): Promise<PersistedConversationTurn> {
    const responseSnapshot: TurnResponseSnapshot = turnResponseSnapshotSchema.parse({
      statusCode: failure.statusCode,
      error: { code: failure.code, message: failure.message },
    });
    const encryptedResponse = await this.encodeSnapshot(accountId, caseId, turnId, responseSnapshot);
    const now = this.now();
    const updated = await this.database.conversationTurn.updateMany({
      where: {
        accountId,
        caseId,
        turnId,
        requestHash,
        status: { in: ["processing", "reserved"] },
        leaseUntil: { gt: now },
      },
      data: {
        status,
        responseSnapshot: jsonInput(encryptedResponse),
        leaseUntil: null,
        completedAt: now,
      },
    });
    const existing = await this.get(accountId, caseId, turnId);
    if (!existing || existing.requestHash !== requestHash) {
      throw new ConversationTurnUnavailable();
    }
    if (updated.count === 0) return existing;
    return existing;
  }

  async get(accountId: string, caseId: string, turnId: string): Promise<PersistedConversationTurn | null> {
    const row = await this.database.conversationTurn.findUnique({ where: uniqueWhere({ accountId, caseId, turnId }) });
    return row ? this.hydrateTurn(row) : null;
  }

  async listForCase(accountId: string, caseId: string): Promise<ConversationTurnSummary[]> {
    return this.database.conversationTurn.findMany({
      where: { accountId, caseId },
      orderBy: { createdAt: "asc" },
      select: {
        turnId: true,
        operation: true,
        status: true,
        sourceUserMessageId: true,
        userMessageId: true,
        assistantMessageId: true,
        caseVersionAfter: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  private async nextMessageSequence(
    transaction: Prisma.TransactionClient,
    accountId: string,
    caseId: string,
  ): Promise<number> {
    const latestMessage = await transaction.conversationMessage.findFirst({
      where: { accountId, caseId },
      orderBy: { messageSequence: "desc" },
      select: { messageSequence: true },
    });
    return (latestMessage?.messageSequence ?? 0) + 1;
  }

  private async encodeSnapshot(
    accountId: string,
    caseId: string,
    turnId: string,
    snapshot: unknown,
  ): Promise<unknown> {
    if (!this.snapshotCipher) return snapshot;
    return this.snapshotCipher.encrypt(snapshot, {
      aad: conversationTurnSnapshotAad(accountId, caseId, turnId),
    });
  }

  private async hydrateTurn(turn: PersistedConversationTurn): Promise<PersistedConversationTurn> {
    if (!this.snapshotCipher) return turn;
    const aad = conversationTurnSnapshotAad(turn.accountId, turn.caseId, turn.turnId);
    const resultSnapshot = turn.resultSnapshot === null
      ? null
      : await this.snapshotCipher.decrypt(turn.resultSnapshot, { aad });
    const responseSnapshot = turn.responseSnapshot === null
      ? null
      : await this.snapshotCipher.decrypt(turn.responseSnapshot, { aad });
    return {
      ...turn,
      resultSnapshot: resultSnapshot === null ? null : jsonOutput(resultSnapshot),
      responseSnapshot: responseSnapshot === null ? null : jsonOutput(responseSnapshot),
    };
  }

  private async hydrateReservation(result: ReserveTurnResult): Promise<ReserveTurnResult> {
    return { ...result, turn: await this.hydrateTurn(result.turn) };
  }
}
