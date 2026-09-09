import type { PrismaClient } from "@prisma/client";

import type {
  AdminMaterialRecord,
  AdminMaterialRepository,
} from "@/server/admin/admin-material-service";

export class PrismaAdminMaterialRepository implements AdminMaterialRepository {
  constructor(private readonly database: PrismaClient) {}

  async findActive(caseId: string, materialId: string): Promise<AdminMaterialRecord | null> {
    const row = await this.database.material.findFirst({
      where: {
        materialId,
        caseId,
        status: "uploaded",
        deletedAt: null,
        case: { is: { caseId, visibility: "private", deletedAt: null } },
      },
      select: {
        materialId: true,
        caseId: true,
        objectKey: true,
        usedBytes: true,
        declaredBytes: true,
        encryptionScheme: true,
        keyVersion: true,
        wrappedKey: true,
        originalFilename: true,
        declaredMime: true,
        detectedMime: true,
      },
    });
    if (!row) return null;
    return {
      materialId: row.materialId,
      caseId: row.caseId,
      objectKey: row.objectKey,
      storedBytes: Number(row.usedBytes ?? row.declaredBytes),
      encryptionScheme: row.encryptionScheme,
      keyVersion: row.keyVersion,
      wrappedKey: row.wrappedKey,
      originalFilename: row.originalFilename,
      contentType: row.detectedMime ?? row.declaredMime,
    };
  }
}
