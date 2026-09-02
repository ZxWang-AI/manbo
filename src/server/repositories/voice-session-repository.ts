import { Prisma, type PrismaClient } from "@prisma/client";

import { lockPrivateCase } from "@/server/repositories/private-case-lock";

export class PrismaVoiceSessionRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly accountId: string,
    private readonly caseId: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  start(sessionId: string, locale: string): Promise<{ sessionId: string }> {
    return this.database.$transaction(
      async (transaction) => {
        if (!(await lockPrivateCase(transaction, this.accountId, this.caseId))) {
          throw new Error("VOICE_SESSION_UNAVAILABLE");
        }
        const session = await transaction.voiceSession.create({
          data: {
            sessionId,
            accountId: this.accountId,
            caseId: this.caseId,
            locale,
          },
          select: { sessionId: true },
        });
        return session;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async end(sessionId: string): Promise<void> {
    const endedAt = this.now();
    await this.database.$transaction(async (transaction) => {
      if (!(await lockPrivateCase(transaction, this.accountId, this.caseId))) {
        throw new Error("VOICE_SESSION_UNAVAILABLE");
      }
      const updated = await transaction.voiceSession.updateMany({
        where: {
          sessionId,
          accountId: this.accountId,
          caseId: this.caseId,
          status: "active",
        },
        data: { status: "ended", endedAt },
      });
      if (updated.count !== 1) throw new Error("VOICE_SESSION_UNAVAILABLE");
    });
  }
}
