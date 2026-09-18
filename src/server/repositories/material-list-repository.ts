import type { PrismaClient } from "@prisma/client";

export interface MaterialListItem {
  materialId: string;
  originalFilename: string | null;
  declaredBytes: number;
  declaredMime: string | null;
  processingState: string;
  eligibleForAi: boolean;
  /** Opaque server-issued refs; never includes derived text or object keys. */
  aiContentRefs: string[];
  createdAt: string;
}

export interface MaterialListRepository {
  listActive(accountId: string, caseId: string): Promise<MaterialListItem[]>;
}

export class PrismaMaterialListRepository implements MaterialListRepository {
  constructor(private readonly database: PrismaClient) {}

  async listActive(accountId: string, caseId: string): Promise<MaterialListItem[]> {
    const rows = await this.database.material.findMany({
      where: {
        accountId,
        caseId,
        status: "uploaded",
        deletedAt: null,
        case: { is: { accountId, caseId, visibility: "private", deletedAt: null } },
      },
      orderBy: { createdAt: "asc" },
      select: {
        materialId: true,
        originalFilename: true,
        declaredBytes: true,
        declaredMime: true,
        processingState: true,
        eligibleForAi: true,
        derivatives: {
          orderBy: { createdAt: "asc" },
          select: { contentRef: true, encryptedContent: true },
        },
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      materialId: row.materialId,
      originalFilename: row.originalFilename,
      declaredBytes: Number(row.declaredBytes),
      declaredMime: row.declaredMime,
      processingState: row.processingState,
      eligibleForAi: row.eligibleForAi,
      aiContentRefs: row.processingState === "parsed" && row.eligibleForAi
        ? (row.derivatives ?? []).filter((derivative) => derivative.encryptedContent !== null).map((derivative) => derivative.contentRef)
        : [],
      createdAt: row.createdAt.toISOString(),
    }));
  }
}
