import { Prisma, type PrismaClient } from "@prisma/client";

export type AdminCaseChangeAction = "modify" | "delete";

export interface AdminCaseChangeDraft {
  changeVersionId: string;
  caseId: string;
  adminId: string;
  action: AdminCaseChangeAction;
  expectedVersion: number | null;
  resultingVersion: number | null;
  patch: unknown;
  createdAt: string;
}

export type AdminCaseChangeVersion = AdminCaseChangeDraft;

export interface AdminCaseChangeRepository {
  create(draft: AdminCaseChangeDraft): Promise<void>;
  findForCase(caseId: string): Promise<AdminCaseChangeVersion[]>;
}

function jsonInput(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export class PrismaAdminCaseChangeRepository implements AdminCaseChangeRepository {
  constructor(private readonly database: PrismaClient) {}

  async create(draft: AdminCaseChangeDraft): Promise<void> {
    await this.database.adminCaseChangeVersion.create({
      data: {
        changeVersionId: draft.changeVersionId,
        caseId: draft.caseId,
        adminId: draft.adminId,
        action: draft.action,
        expectedVersion: draft.expectedVersion,
        resultingVersion: draft.resultingVersion,
        patch: jsonInput(draft.patch),
        createdAt: new Date(draft.createdAt),
      },
    });
  }

  async findForCase(caseId: string): Promise<AdminCaseChangeVersion[]> {
    const rows = await this.database.adminCaseChangeVersion.findMany({
      where: { caseId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((row) => ({
      changeVersionId: row.changeVersionId,
      caseId: row.caseId,
      adminId: row.adminId,
      action: row.action,
      expectedVersion: row.expectedVersion,
      resultingVersion: row.resultingVersion,
      patch: row.patch,
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
