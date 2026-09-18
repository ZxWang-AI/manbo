import { randomUUID } from "node:crypto";

import { Prisma, type ConversationTurn as PersistedConversationTurn, type PrismaClient } from "@prisma/client";

import {
  turnResponseSnapshotSchema,
  turnResultSnapshotSchema,
  type TurnResponseSnapshot,
} from "./conversation-turn-contract";
import {
  conversationTurnSnapshotAad,
  type ConversationTurnSnapshotCipher,
} from "./conversation-turn-snapshot-cipher";
import type { CasePatch } from "@/domain/case-record";
import {
  applyPrivatePatchInTransaction,
  appendCaseRevision,
  ConcurrencyConflict,
  jsonInput,
  toDomainRecord,
} from "@/server/repositories/case-repository";
import { lockPrivateCase } from "@/server/repositories/private-case-lock";
import { sanitizeAuditMetadata } from "@/server/audit";

export interface FinalizeTurnInput {
  accountId: string;
  caseId: string;
  turnId: string;
  requestHash: string;
}

export type FinalizeTurnResult =
  | { kind: "completed"; responseSnapshot: TurnResponseSnapshot }
  | { kind: "replay"; responseSnapshot: TurnResponseSnapshot }
  | { kind: "conflict"; responseSnapshot: TurnResponseSnapshot }
  | { kind: "in_flight" };

export class FinalizeTurnUnavailable extends Error {
  constructor(message = "Conversation turn cannot be finalized") {
    super(message);
    this.name = "FinalizeTurnUnavailable";
  }
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function jsonOutput(value: unknown): Prisma.JsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.JsonValue;
}

function caseVersionFromRow(row: { version: number }): number {
  return row.version;
}

function scopedTurnWhere(input: Pick<FinalizeTurnInput, "accountId" | "caseId" | "turnId">) {
  return {
    accountId_caseId_turnId: {
      accountId: input.accountId,
      caseId: input.caseId,
      turnId: input.turnId,
    },
  };
}

export class PrismaConversationTurnFinalizer {
  constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
    private readonly snapshotCipher?: ConversationTurnSnapshotCipher,
  ) {}

  async finalize(input: FinalizeTurnInput): Promise<FinalizeTurnResult> {
    return this.database.$transaction(
      async (transaction) => {
        // The global lock order is case first, then turn. This lets a normal
        // send, retry, admin patch, and finalizer serialize on the same case.
        if (!(await lockPrivateCase(transaction, input.accountId, input.caseId))) {
          throw new FinalizeTurnUnavailable("Private case is unavailable");
        }

        const persistedTurn = await transaction.conversationTurn.findUnique({ where: scopedTurnWhere(input) });
        const turn = persistedTurn ? await this.hydrateTurn(persistedTurn) : null;
        if (!turn || turn.accountId !== input.accountId || turn.caseId !== input.caseId) {
          throw new FinalizeTurnUnavailable("Conversation turn is unavailable");
        }
        if (turn.requestHash !== input.requestHash) {
          throw new FinalizeTurnUnavailable("Conversation turn idempotency conflict");
        }
        if (turn.status === "completed" || turn.status === "conflict" || turn.status === "failed" || turn.status === "cancelled") {
          return { kind: "replay", responseSnapshot: await this.responseFromTurn(turn) } as const;
        }
        if (turn.status === "processing" || turn.status === "reserved") {
          return { kind: "in_flight" } as const;
        }
        if (turn.status !== "result_ready") {
          throw new FinalizeTurnUnavailable();
        }

        const snapshot = turnResultSnapshotSchema.parse(turn.resultSnapshot);
        const current = await transaction.caseRecord.findFirst({
          where: { accountId: input.accountId, caseId: input.caseId, visibility: "private", deletedAt: null },
        });
        if (!current) throw new FinalizeTurnUnavailable("Private case is unavailable");

        if (current.version !== turn.baseCaseVersion) {
          return this.markConflict(transaction, turn, "案件已被更新，请刷新后重试。", current.version);
        }

        if (turn.operation === "retry") {
          const latestUser = await transaction.conversationMessage.findFirst({
            where: { accountId: input.accountId, caseId: input.caseId, role: "user" },
            orderBy: { messageSequence: "desc" },
            select: { messageId: true },
          });
          if (!turn.sourceUserMessageId || latestUser?.messageId !== turn.sourceUserMessageId) {
            return this.markConflict(transaction, turn, "案件已出现更新，请刷新后再重试。", current.version);
          }
        }

        const assistant = snapshot.assistant;
        let caseRow = current;
        let caseVersion = current.version;
        if (assistant.draftPatch && !assistant.degraded) {
          try {
            caseRow = await applyPrivatePatchInTransaction(
              transaction,
              input.accountId,
              input.caseId,
              assistant.draftPatch as CasePatch,
              turn.baseCaseVersion,
              this.now(),
            );
          } catch (error) {
            // A writer that does not participate in the case-row lock can
            // still win the optimistic version update between the initial
            // read and this patch. Persist the conflict in the same turn
            // ledger rather than leaving result_ready to be retried forever.
            if (!(error instanceof ConcurrencyConflict)) throw error;
            const latest = await transaction.caseRecord.findFirst({
              where: { accountId: input.accountId, caseId: input.caseId, visibility: "private", deletedAt: null },
            });
            if (!latest) throw error;
            return this.markConflict(transaction, turn, "案件已被更新，请刷新后重试。", latest.version);
          }
          caseVersion = caseVersionFromRow(caseRow);
          await appendCaseRevision(transaction, caseRow);
        }

        await transaction.auditEvent.create({
          data: {
            auditEventId: randomUUID(),
            accountId: input.accountId,
            caseId: input.caseId,
            action: assistant.degraded ? "model_fallback" : "update",
            outcome: assistant.degraded ? "failed" : "allowed",
            metadata: jsonInput(sanitizeAuditMetadata({
              version: caseVersion,
              turnStatus: "completed",
              turnHash: input.requestHash,
              ...(assistant.degraded ? { reasonCode: "AI_DEGRADED" } : {}),
            })),
            occurredAt: this.now(),
          },
        });

        let assistantMessageId: string | undefined;
        if (!assistant.degraded) {
          assistantMessageId = randomUUID();
          const latestMessage = await transaction.conversationMessage.findFirst({
            where: { accountId: input.accountId, caseId: input.caseId },
            orderBy: { messageSequence: "desc" },
            select: { messageSequence: true },
          });
          await transaction.conversationMessage.create({
            data: {
              messageId: assistantMessageId,
              accountId: input.accountId,
              caseId: input.caseId,
              turnId: input.turnId,
              messageSequence: (latestMessage?.messageSequence ?? 0) + 1,
              role: "assistant",
              content: assistant.message,
            },
          });
        }

        const responseSnapshot = turnResponseSnapshotSchema.parse({
          assistant,
          caseVersion,
          persistence: {
            messageSaved: Boolean(assistantMessageId),
            userMessageSaved: Boolean(turn.userMessageId),
            assistantMessageSaved: Boolean(assistantMessageId),
            userMessageCreated: turn.operation === "send",
            userMessageId: turn.userMessageId ?? undefined,
            ...(assistantMessageId ? { assistantMessageId } : {}),
            caseUpdated: Boolean(assistant.draftPatch && !assistant.degraded),
          },
          ...(turn.userMessageId ? { userMessageId: turn.userMessageId } : {}),
          ...(assistantMessageId ? { assistantMessageId } : {}),
          messageSaved: Boolean(assistantMessageId),
          userMessageSaved: Boolean(turn.userMessageId),
          assistantMessageSaved: Boolean(assistantMessageId),
          userMessageCreated: turn.operation === "send",
          caseUpdated: Boolean(assistant.draftPatch && !assistant.degraded),
          statusCode: 200,
        });

        const persistedResponseSnapshot = await this.encodeSnapshot(
          input.accountId,
          input.caseId,
          input.turnId,
          responseSnapshot,
        );
        await transaction.conversationTurn.update({
          where: scopedTurnWhere(input),
          data: {
            status: "completed",
            ...(assistantMessageId ? { assistantMessageId } : {}),
            caseVersionAfter: caseVersion,
            responseSnapshot: jsonValue(persistedResponseSnapshot),
            completedAt: this.now(),
          },
        });

        // Keep the conversion here as a schema assertion for the revision row;
        // it also protects future callers from returning an invalid domain case.
        toDomainRecord(caseRow);
        return { kind: "completed", responseSnapshot } as const;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async markConflict(
    transaction: Prisma.TransactionClient,
    turn: PersistedConversationTurn,
    message: string,
    currentVersion: number,
  ): Promise<FinalizeTurnResult> {
    const responseSnapshot = turnResponseSnapshotSchema.parse({
      statusCode: 409,
      error: { code: "VERSION_CONFLICT", message },
      caseVersion: currentVersion,
    });
    const persistedResponseSnapshot = await this.encodeSnapshot(
      turn.accountId,
      turn.caseId,
      turn.turnId,
      responseSnapshot,
    );
    await transaction.conversationTurn.update({
      where: scopedTurnWhere(turn),
      data: {
        status: "conflict",
        caseVersionAfter: currentVersion,
        responseSnapshot: jsonValue(persistedResponseSnapshot),
        completedAt: this.now(),
      },
    });
    return { kind: "conflict", responseSnapshot };
  }

  private async responseFromTurn(turn: PersistedConversationTurn): Promise<TurnResponseSnapshot> {
    if (!turn.responseSnapshot) throw new FinalizeTurnUnavailable("Turn response snapshot is missing");
    return turnResponseSnapshotSchema.parse(turn.responseSnapshot);
  }

  private async encodeSnapshot(
    accountId: string,
    caseId: string,
    turnId: string,
    snapshot: TurnResponseSnapshot,
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
}
