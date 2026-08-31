import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { consentSnapshotSchema, type ConsentSnapshot } from "@/domain/consent";
import { PrivateCaseUnavailable } from "./message-repository";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaConsentRepository {
  constructor(private readonly database: PrismaClient) {}

  async record(accountId: string, caseId: string, input: ConsentSnapshot) {
    const snapshot = consentSnapshotSchema.parse(input);
    return this.database.$transaction(
      async (transaction) => {
        const ownedCase = await transaction.caseRecord.findFirst({
          where: { accountId, caseId, visibility: "private", deletedAt: null },
          select: { caseId: true },
        });
        if (!ownedCase) {
          throw new PrivateCaseUnavailable();
        }
        return transaction.consentEvent.create({
          data: {
            consentEventId: randomUUID(),
            accountId,
            caseId,
            consentVersion: snapshot.version,
            snapshot: jsonInput(snapshot),
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  async listPrivate(accountId: string, caseId: string) {
    return this.database.consentEvent.findMany({
      where: {
        accountId,
        caseId,
        case: { is: { accountId, caseId, visibility: "private", deletedAt: null } },
      },
      orderBy: [{ createdAt: "asc" }, { consentEventId: "asc" }],
    });
  }
}
