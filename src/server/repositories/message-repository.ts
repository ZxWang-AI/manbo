import { randomUUID } from "node:crypto";

import { Prisma, type MessageRole, type PrismaClient } from "@prisma/client";
import { z } from "zod";

const messageSchema = z.strictObject({
  role: z.enum(["user", "assistant", "system"]),
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

  async append(accountId: string, caseId: string, input: ConversationMessageInput) {
    const message = messageSchema.parse(input);
    return this.database.$transaction(
      async (transaction) => {
        const ownedCase = await transaction.caseRecord.findFirst({
          where: { accountId, caseId, visibility: "private", deletedAt: null },
          select: { caseId: true },
        });
        if (!ownedCase) {
          throw new PrivateCaseUnavailable();
        }
        return transaction.conversationMessage.create({
          data: {
            messageId: randomUUID(),
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
