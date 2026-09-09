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

export class PrivateCaseUnavailable extends Error {
  constructor() {
    super("Private case is unavailable");
    this.name = "PrivateCaseUnavailable";
  }
}

export class PrismaMessageRepository {
  constructor(private readonly database: PrismaClient) {}

  async append(accountId: string, caseId: string, input: ConversationMessageInput, messageId = randomUUID()) {
    const message = userMessageSchema.parse(input);
    return this.appendInternal(accountId, caseId, message, messageId);
  }

  /** Internal assistant persistence; callers cannot use it to append user-supplied assistant roles. */
  async appendAssistant(accountId: string, caseId: string, content: string, messageId = randomUUID()) {
    const message = assistantMessageSchema.parse({ role: "assistant", content });
    return this.appendInternal(accountId, caseId, message, messageId);
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
        return transaction.conversationMessage.create({
          data: {
            messageId,
            accountId,
            caseId,
            role: message.role,
            content: message.content,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listPrivate(accountId: string, caseId: string) {
    return this.database.conversationMessage.findMany({
      where: {
        accountId,
        caseId,
        case: { is: { accountId, caseId, visibility: "private", deletedAt: null } },
      },
      orderBy: [{ createdAt: "asc" }, { messageId: "asc" }],
    });
  }
}
