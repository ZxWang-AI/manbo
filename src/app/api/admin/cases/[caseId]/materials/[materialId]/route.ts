import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import { AdminMaterialService, type AdminMaterialReadMode } from "@/server/admin/admin-material-service";
import { unavailableAdminIdentityResolver, type AdminIdentityResolver } from "@/server/admin/rbac";
import { PrismaAdminMaterialRepository } from "@/server/repositories/admin-material-repository";
import { adminErrorResponse, mapAdminError, resolveAdmin } from "@/app/api/admin/_route-helpers";

export interface AdminMaterialGetRouteOptions {
  service: Pick<AdminMaterialService, "readMaterial">;
  identityResolver: AdminIdentityResolver;
  isAdminIdentityAvailable: boolean;
  isObjectStorageAvailable?: boolean;
  requestId?: () => string;
}

function safeFilename(value: string | null): string {
  const normalized = (value ?? "material.bin")
    .replace(/[\\/\u0000-\u001f\u007f]/gu, "_")
    .replace(/"/gu, "'")
    .trim()
    .slice(0, 180);
  return normalized || "material.bin";
}

function canPlayInline(contentType: string): boolean {
  return contentType === "application/pdf"
    || contentType.startsWith("audio/")
    || contentType.startsWith("video/")
    || contentType.startsWith("image/");
}

export function createAdminMaterialGetHandler(options: AdminMaterialGetRouteOptions) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ caseId: string; materialId: string }> },
  ): Promise<Response> {
    const requestId = options.requestId?.() ?? randomUUID();
    if (!options.isAdminIdentityAvailable || options.isObjectStorageAvailable === false) {
      return adminErrorResponse("DEGRADED", "管理员材料服务暂时不可用。", 503, requestId);
    }

    const principal = await resolveAdmin(request, options.identityResolver).catch(() => null);
    if (!principal) return adminErrorResponse("UNAUTHENTICATED", "管理员身份无效。", 401, requestId);

    const modeValue = new URL(request.url).searchParams.get("mode");
    if (modeValue !== "play" && modeValue !== "download") {
      return adminErrorResponse("INVALID_INPUT", "材料访问模式必须是 play 或 download。", 400, requestId);
    }

    const { caseId, materialId } = await context.params;
    try {
      const material = await options.service.readMaterial(
        principal,
        caseId,
        materialId,
        modeValue as AdminMaterialReadMode,
      );
      const disposition = modeValue === "play" && canPlayInline(material.contentType)
        ? "inline"
        : "attachment";
      const headers = new Headers({
        "cache-control": "no-store",
        "content-type": material.contentType,
        "content-disposition": `${disposition}; filename="${safeFilename(material.originalFilename)}"`,
        "x-content-type-options": "nosniff",
      });
      if (Number.isSafeInteger(material.contentLength) && material.contentLength >= 0) {
        headers.set("content-length", String(material.contentLength));
      }
      return new Response(material.body as BodyInit, { status: 200, headers });
    } catch (error) {
      return mapAdminError(error, requestId);
    }
  };
}

const unavailableReader = {
  async readDecryptedObject(): Promise<never> {
    throw new Error("MATERIAL_OBJECT_STORAGE_UNAVAILABLE");
  },
};

const defaultService = new AdminMaterialService(
  new PrismaAdminMaterialRepository(prisma),
  unavailableReader,
);

export const GET = createAdminMaterialGetHandler({
  service: defaultService,
  identityResolver: unavailableAdminIdentityResolver,
  isAdminIdentityAvailable: false,
  isObjectStorageAvailable: false,
});
