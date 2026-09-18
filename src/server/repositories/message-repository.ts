import { randomUUID } from "node:crypto";

import { Prisma, type MessageRole, type PrismaClient } from "@prisma/client";
import { z } from "zod";

import { lockPrivateCase } from "./private-case-lock";

const userMessageSchema = z.strictObject({
  role: z.literal("user"),
  content: z.string().min(1),
});
const assistantMessageSchema = z.strictObject({
  role: z.literal("assistant"),
  content: z.string().min(1),
});

export interface ConversationMessageInput {
  role: MessageRole;
  content: string;
}

/** Stable application projection; legacy test/preview callers may omit turnId. */
export interface ConversationMessageRecord {
  messageId: string;
  caseId: string;
  accountId: string;
  turnId?: string | null;
  messageSequence: number;
  role: MessageRole;
  content: string;
  createdAt: Date;
}

export class PrivateCaseUnavailable extends Error {
  constructor() {
    super("Private case is unavailable");
    this.name = "PrivateCaseUnavailable";
  }
}

export class RetrySourceSuperseded extends Error {
  constructor() {
    super("Retry source is no longer the latest user message");
    this.name = "RetrySourceSuperseded";
  }
}

export class PrismaMessageRepository {
  constructor(private readonly database: PrismaClient) {}

  async findPrivateUser(accountId: string, caseId: string, messageId: string): Promise<ConversationMessageRecord | null> {
    return this.database.conversationMessage.findFirst({
      where: {
        accountId,
        caseId,
        messageId,
        role: "user",
        case: {
          is: {
            accountId,
            caseId,
            visibility: "private",
            deletedAt: null,
          },
        },
      },
    });
  }

  async append(accountId: string, caseId: string, input: ConversationMessageInput, messageId = randomUUID()): Promise<ConversationMessageRecord> {
    const message = userMessageSchema.parse(input);
    return this.appendInternal(accountId, caseId, message, messageId);
  }

  /** Internal assistant persistence; callers cannot use it to append user-supplied assistant roles. */
  async appendAssistant(accountId: string, caseId: string, content: string, messageId = randomUUID()): Promise<ConversationMessageRecord> {
    const message = assistantMessageSchema.parse({ role: "assistant", content });
    return this.appendInternal(accountId, caseId, message, messageId);
  }

  async appendAssistantForLatestUser(
    accountId: string,
    caseId: string,
    expectedUserMessageId: string,
    content: string,
    messageId = randomUUID(),
  ): Promise<ConversationMessageRecord> {
    const message = assistantMessageSchema.parse({ role: "assistant", content });
    // READ COMMITTED is intentional: if this transaction waits for a user append
    // holding the case lock, the following latest-user query needs a fresh snapshot
    // that includes the append which just committed.
    return this.database.$transaction(
      async (transaction) => {
        if (!(await lockPrivateCase(transaction, accountId, caseId))) {
          throw new PrivateCaseUnavailable();
        }
        const latestUserMessage = await transaction.conversationMessage.findFirst({
          where: { accountId, caseId, role: "user" },
          orderBy: { messageSequence: "desc" },
          select: { messageId: true },
        });
        if (latestUserMessage?.messageId !== expectedUserMessageId) {
          throw new RetrySourceSuperseded();
        }
        const messageSequence = await this.nextMessageSequence(transaction, accountId, caseId);
        return transaction.conversationMessage.create({
          data: {
            messageId,
            accountId,
            caseId,
            messageSequence,
            role: message.role,
            content: message.content,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  }

  private async appendInternal(
    accountId: string,
    caseId: string,
    message: { role: "user" | "assistant"; content: string },
    messageId: string,
  ) {
    return this.database.$transaction(
      async (transaction) => {
        if (!(await lockPrivateCase(transaction, accountId, caseId))) {
          throw new PrivateCaseUnavailable();
        }
        const messageSequence = await this.nextMessageSequence(transaction, accountId, caseId);
        return transaction.conversationMessage.create({
          data: {
            messageId,
            accountId,
            caseId,
            messageSequence,
            role: message.role,
            content: message.content,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
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

  async listPrivate(accountId: string, caseId: string): Promise<ConversationMessageRecord[]> {
    return this.database.conversationMessage.findMany({
      where: {
        accountId,
        caseId,
        case: { is: { accountId, caseId, visibility: "private", deletedAt: null } },
      },
      orderBy: { messageSequence: "asc" },
    });
  }
}
