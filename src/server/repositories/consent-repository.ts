import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { consentSnapshotSchema, type ConsentSnapshot } from "@/domain/consent";
import {
  appendCaseRevision,
  ConcurrencyConflict,
} from "./case-repository";
import { PrivateCaseUnavailable } from "./message-repository";
import { lockPrivateCase } from "./private-case-lock";

function jsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaConsentRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(
    accountId: string,
    caseId: string,
    input: ConsentSnapshot,
    expectedVersion: number,
  ) {
    const snapshot = consentSnapshotSchema.parse(input);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      throw new ConcurrencyConflict();
    }
    return this.database.$transaction(
      async (transaction) => {
        if (!(await lockPrivateCase(transaction, accountId, caseId))) {
          throw new PrivateCaseUnavailable();
        }
        const nextVersion = expectedVersion + 1;
        const updated = await transaction.caseRecord.updateMany({
          where: {
            accountId,
            caseId,
            visibility: "private",
            deletedAt: null,
            version: expectedVersion,
          },
          data: {
            consent: jsonInput(snapshot),
            version: { increment: 1 },
            updatedAt: this.now(),
          },
        });
        if (updated.count !== 1) {
          throw new ConcurrencyConflict();
        }

        const row = await transaction.caseRecord.findFirst({
          where: { accountId, caseId, visibility: "private", deletedAt: null },
        });
        if (!row) {
          throw new ConcurrencyConflict();
        }
        await appendCaseRevision(transaction, row);

        const event = await transaction.consentEvent.create({
          data: {
            consentEventId: randomUUID(),
            accountId,
            caseId,
            consentVersion: snapshot.version,
            snapshot: jsonInput(snapshot),
          },
        });
        await transaction.auditEvent.create({
          data: {
            auditEventId: randomUUID(),
            accountId,
            caseId,
            action: "consent_change",
            metadata: { version: nextVersion },
          },
        });
        return event;
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
