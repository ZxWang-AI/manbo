import { describe, expect, it, vi } from "vitest";

import { AdminMaterialService, type AdminMaterialRepository } from "@/server/admin/admin-material-service";
import type { MaterialObjectReader } from "@/media/storage/object-store";

const reviewer = { adminId: "reviewer-a", roles: ["case_reviewer"] as const };

function makeService() {
  const materials: AdminMaterialRepository = {
    findActive: vi.fn().mockResolvedValue({
      materialId: "material-a",
      caseId: "case-a",
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      storedBytes: 12,
      encryptionScheme: "AES-256-GCM",
      keyVersion: "key-v1",
      wrappedKey: "wrapped-key",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
    }),
  };
  const reader: MaterialObjectReader = {
    readDecryptedObject: vi.fn().mockResolvedValue({
      body: new TextEncoder().encode("private material"),
      contentLength: 16,
    }),
  };
  return {
    materials,
    reader,
    service: new AdminMaterialService(materials, reader),
  };
}

describe("administrator material service", () => {
  it("authorizes a reviewer and reads material through the server-side decrypting reader", async () => {
    const { materials, reader, service } = makeService();

    await expect(service.readMaterial(reviewer, "case-a", "material-a", "play")).resolves.toMatchObject({
      materialId: "material-a",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
      contentLength: 16,
      body: expect.any(Uint8Array),
    });
    expect(materials.findActive).toHaveBeenCalledWith("case-a", "material-a");
    expect(reader.readDecryptedObject).toHaveBeenCalledWith({
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      encryptionScheme: "AES-256-GCM",
      keyVersion: "key-v1",
      wrappedKey: "wrapped-key",
    });
  });

  it("rejects missing or incomplete material metadata without reading the object", async () => {
    const { materials, reader, service } = makeService();
    vi.mocked(materials.findActive).mockResolvedValue({
      materialId: "material-a",
      caseId: "case-a",
      objectKey: null,
      storedBytes: 0,
      encryptionScheme: null,
      keyVersion: null,
      wrappedKey: null,
      originalFilename: null,
      contentType: null,
    });

    await expect(service.readMaterial(reviewer, "case-a", "material-a", "download")).rejects.toThrow(
      "MATERIAL_CONTENT_UNAVAILABLE",
    );
    expect(reader.readDecryptedObject).not.toHaveBeenCalled();
  });

  it("rejects unsupported encryption metadata before invoking the object reader", async () => {
    const { materials, reader, service } = makeService();
    vi.mocked(materials.findActive).mockResolvedValue({
      materialId: "material-a",
      caseId: "case-a",
      objectKey: "materials/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      storedBytes: 12,
      encryptionScheme: "PLAINTEXT",
      keyVersion: "key-v1",
      wrappedKey: "wrapped-key",
      originalFilename: "contract.pdf",
      contentType: "application/pdf",
    });

    await expect(service.readMaterial(reviewer, "case-a", "material-a", "play")).rejects.toThrow(
      "MATERIAL_CONTENT_UNAVAILABLE",
    );
    expect(reader.readDecryptedObject).not.toHaveBeenCalled();
  });

  it("does not authorize a reviewer to perform supervisor-only actions", async () => {
    const { service } = makeService();

    await expect(service.readMaterial({ adminId: "user-a", roles: [] }, "case-a", "material-a", "download"))
      .rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
  });
});
