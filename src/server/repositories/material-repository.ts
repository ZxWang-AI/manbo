import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";
import type { EncryptedUploadStart } from "@/media/storage/object-store";
import {
  assertMaterialReservationAllowed,
  createOpaqueMaterialObjectKey,
} from "@/domain/material";

export interface MaterialUploadReservation {
  uploadId: string;
  materialId: string;
  caseId: string;
  objectKey: string;
  reservedBytes: number;
  expiresAt: string;
}

export interface MaterialReservationRepository {
  reserve(input: {
    accountId: string;
    caseId: string;
    byteLength: number;
  }): Promise<MaterialUploadReservation>;
  findActive(accountId: string, uploadId: string): Promise<MaterialUploadReservation | null>;
  attachEncryption(
    accountId: string,
    uploadId: string,
    encryption: EncryptedUploadStart["encryption"],
  ): Promise<void>;
  complete(
    accountId: string,
    uploadId: string,
    result: { objectKey: string; sha256: string; storedBytes: number },
  ): Promise<"completed" | "already_completed">;
  release(accountId: string, uploadId: string): Promise<void>;
}

function toReservation(row: {
  uploadId: string;
  materialId: string;
  caseId: string;
  objectKey: string;
  reservedBytes: bigint | number;
  expiresAt: Date;
}): MaterialUploadReservation {
  return {
    uploadId: row.uploadId,
    materialId: row.materialId,
    caseId: row.caseId,
    objectKey: row.objectKey,
    reservedBytes: Number(row.reservedBytes),
    expiresAt: row.expiresAt.toISOString(),
  };
}

export class PrismaMaterialReservationRepository implements MaterialReservationRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly objectKey = () => createOpaqueMaterialObjectKey(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async reserve(input: {
    accountId: string;
    caseId: string;
    byteLength: number;
  }): Promise<MaterialUploadReservation> {
    assertMaterialReservationAllowed({
      byteLength: input.byteLength,
      usedBytes: 0,
      reservedBytes: 0,
    });
    const rows = await this.database.$queryRaw<Parameters<typeof toReservation>[0][]>(Prisma.sql`
      SELECT * FROM manbo_reserve_material_upload(
        ${input.accountId}, ${input.caseId}::uuid, ${input.byteLength}::bigint,
        ${this.objectKey()}, ${randomUUID()}::uuid, ${this.now()}
      )
    `);
    const row = rows[0];
    if (!row) {
      throw new Error("MATERIAL_RESERVATION_FAILED");
    }
    return toReservation(row);
  }

  async findActive(accountId: string, uploadId: string): Promise<MaterialUploadReservation | null> {
    const rows = await this.database.$queryRaw<Parameters<typeof toReservation>[0][]>(Prisma.sql`
      SELECT
        r."upload_id" AS "uploadId",
        r."material_id" AS "materialId",
        r."case_id" AS "caseId",
        m."object_key" AS "objectKey",
        r."declared_bytes" AS "reservedBytes",
        r."expires_at" AS "expiresAt"
      FROM "material_upload_reservations" r
      INNER JOIN "materials" m
        ON m."material_id" = r."material_id"
       AND m."case_id" = r."case_id"
       AND m."account_id" = r."account_id"
      WHERE r."upload_id" = ${uploadId}::uuid
        AND r."account_id" = ${accountId}
        AND r."status" = 'reserved'
        AND r."expires_at" > ${this.now()}
    `);
    const row = rows[0];
    return row ? toReservation(row) : null;
  }

  async attachEncryption(
    accountId: string,
    uploadId: string,
    encryption: EncryptedUploadStart["encryption"],
  ): Promise<void> {
    const updated = await this.database.$executeRaw(Prisma.sql`
      UPDATE "material_upload_reservations"
      SET "encryption_scheme" = ${encryption.scheme},
          "key_version" = ${encryption.keyVersion},
          "wrapped_key" = ${encryption.wrappedKey}
      WHERE "upload_id" = ${uploadId}::uuid
        AND "account_id" = ${accountId}
        AND "status" = 'reserved'
        AND "expires_at" > ${this.now()}
    `);
    if (updated !== 1) {
      throw new Error("MATERIAL_UPLOAD_UNAVAILABLE");
    }
  }

  async complete(
    accountId: string,
    uploadId: string,
    result: { objectKey: string; sha256: string; storedBytes: number },
  ): Promise<"completed" | "already_completed"> {
    let rows: Array<{ status: string }>;
    try {
      rows = await this.database.$queryRaw<Array<{ status: string }>>(Prisma.sql`
        SELECT manbo_complete_material_upload(
          ${accountId}, ${uploadId}::uuid, ${result.objectKey}, ${result.sha256}, ${result.storedBytes}::bigint, ${this.now()}
        ) AS "status"
      `);
    } catch (error) {
      if (error instanceof Error && error.message.includes("MATERIAL_COMPLETION_CONFLICT")) {
        throw new Error("MATERIAL_COMPLETION_CONFLICT");
      }
      throw error;
    }
    const status = rows[0]?.status;
    if (status === "completed" || status === "already_completed") return status;
    if (status === "expired") throw new Error("MATERIAL_UPLOAD_UNAVAILABLE");
    if (status === "conflict") throw new Error("MATERIAL_COMPLETION_CONFLICT");
    throw new Error("MATERIAL_COMPLETION_FAILED");
  }

  async release(accountId: string, uploadId: string): Promise<void> {
    await this.database.$queryRaw(Prisma.sql`
      SELECT manbo_release_material_upload(${accountId}, ${uploadId}::uuid, ${this.now()}) AS "status"
    `);
  }
}
