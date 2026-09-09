import {
  assertAdminAuthorized,
  type AdminPrincipal,
} from "@/domain/admin-review";
import type { MaterialObjectReader } from "@/media/storage/object-store";

export type AdminMaterialReadMode = "play" | "download";

export interface AdminMaterialRecord {
  materialId: string;
  caseId: string;
  objectKey: string | null;
  storedBytes: number;
  encryptionScheme: string | null;
  keyVersion: string | null;
  wrappedKey: string | null;
  originalFilename: string | null;
  contentType: string | null;
}

export interface AdminMaterialRepository {
  findActive(caseId: string, materialId: string): Promise<AdminMaterialRecord | null>;
}

export interface AdminMaterialRead {
  materialId: string;
  originalFilename: string | null;
  contentType: string;
  contentLength: number;
  body: Uint8Array | ReadableStream<Uint8Array>;
}

export class AdminMaterialService {
  constructor(
    private readonly materials: AdminMaterialRepository,
    private readonly reader: MaterialObjectReader,
  ) {}

  async readMaterial(
    principal: AdminPrincipal,
    caseId: string,
    materialId: string,
    mode: AdminMaterialReadMode,
  ): Promise<AdminMaterialRead> {
    assertAdminAuthorized(principal, mode === "play" ? "material:play" : "material:download");
    const material = await this.materials.findActive(caseId, materialId);
    if (!material || material.caseId !== caseId) {
      throw new Error("ADMIN_MATERIAL_NOT_FOUND");
    }
    if (
      !material.objectKey
      || !/^materials\/[a-f0-9]{32}$/u.test(material.objectKey)
      || !material.encryptionScheme
      || material.encryptionScheme !== "AES-256-GCM"
      || !material.keyVersion
      || !material.wrappedKey
      || material.storedBytes < 0
    ) {
      throw new Error("MATERIAL_CONTENT_UNAVAILABLE");
    }

    const decrypted = await this.reader.readDecryptedObject({
      objectKey: material.objectKey,
      encryptionScheme: material.encryptionScheme,
      keyVersion: material.keyVersion,
      wrappedKey: material.wrappedKey,
    });

    if (!Number.isSafeInteger(decrypted.contentLength) || decrypted.contentLength < 0) {
      throw new Error("MATERIAL_CONTENT_UNAVAILABLE");
    }

    return {
      materialId: material.materialId,
      originalFilename: material.originalFilename,
      contentType: material.contentType ?? "application/octet-stream",
      contentLength: decrypted.contentLength,
      body: decrypted.body,
    };
  }
}
