import { Prisma } from "@prisma/client";

type TransactionClient = Prisma.TransactionClient;

interface LockedPrivateCase {
  caseId: string;
}

export async function lockPrivateCase(
  transaction: TransactionClient,
  accountId: string,
  caseId: string,
): Promise<boolean> {
  const rows = await transaction.$queryRaw<LockedPrivateCase[]>(Prisma.sql`
    SELECT "case_id" AS "caseId"
    FROM "case_records"
    WHERE "account_id" = ${accountId}
      AND "case_id" = ${caseId}::uuid
      AND "visibility" = 'private'
      AND "deleted_at" IS NULL
    FOR UPDATE
  `);

  return rows.length === 1;
}
