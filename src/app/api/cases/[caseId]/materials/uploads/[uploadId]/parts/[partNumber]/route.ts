import { randomUUID } from "node:crypto";

import { prisma } from "@/server/db";
import {
  type AccountRepository,
  PrismaAccountRepository,
} from "@/server/repositories/account-repository";
import {
  type CaseRepository,
  PrismaCaseRepository,
} from "@/server/repositories/case-repository";
import { PrismaMaterialReservationRepository } from "@/server/repositories/material-repository";
import { MaterialUploadService } from "@/server/services/material-upload-service";
import { createMaterialObjectStoreFromEnv } from "@/media/storage/object-store-factory";

import {
  materialErrorResponse,
  resolveMaterialOwner,
  type MaterialRouteContext,
} from "../../../../route-helpers";

export const DEFAULT_MATERIAL_PART_BYTES = 8 * 1024 * 1024;

export interface MaterialUploadPartPutHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate">;
  uploads: Pick<MaterialUploadService, "uploadPart">;
  isPersistenceAvailable: boolean;
  isObjectStorageAvailable: boolean;
  maxPartBytes?: number;
  requestId?: () => string;
}

function parsePartNumber(value: string): number | null {
  if (!/^[1-9]\d*$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<{ kind: "ok"; bytes: Uint8Array } | { kind: "empty" | "too_large" | "invalid" }> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0) return { kind: "invalid" };
    if (declared > maxBytes) return { kind: "too_large" };
  }
  if (!request.body) return { kind: "empty" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { kind: "too_large" };
      }
      chunks.push(next.value);
    }
  } catch {
    return { kind: "invalid" };
  }
  if (total === 0) return { kind: "empty" };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: "ok", bytes };
}

export function createMaterialUploadPartPutHandler({
  accounts,
  cases,
  uploads,
  isPersistenceAvailable,
  isObjectStorageAvailable,
  maxPartBytes = DEFAULT_MATERIAL_PART_BYTES,
  requestId = randomUUID,
}: MaterialUploadPartPutHandlerOptions) {
  if (!Number.isSafeInteger(maxPartBytes) || maxPartBytes <= 0) {
    throw new TypeError("maxPartBytes must be a positive integer");
  }

  return async function PUT(
    request: Request,
    context: MaterialRouteContext<{ caseId: string; uploadId: string; partNumber: string }>,
  ): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable || !isObjectStorageAvailable) {
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveMaterialOwner(request, accounts).catch(() => null);
    if (!owner) {
      return materialErrorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }
    const { caseId, uploadId, partNumber: rawPartNumber } = await context.params;
    const partNumber = parsePartNumber(rawPartNumber);
    if (partNumber === null) {
      return materialErrorResponse("INVALID_INPUT", "上传分片编号无效。", 400, id);
    }

    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) {
        return materialErrorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, id);
      }
      const body = await readBoundedBody(request, maxPartBytes);
      if (body.kind === "too_large") {
        return materialErrorResponse("PAYLOAD_TOO_LARGE", "上传分片超过允许大小。", 413, id);
      }
      if (body.kind !== "ok") {
        return materialErrorResponse("INVALID_INPUT", "上传分片不能为空且必须是有效的二进制内容。", 400, id);
      }
      await uploads.uploadPart({
        accountId: owner.accountId,
        caseId,
        uploadId,
        partNumber,
        bytes: body.bytes,
      });
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && (
        error.message === "MATERIAL_UPLOAD_UNAVAILABLE" ||
        error.message === "LOCAL_UPLOAD_NOT_FOUND"
      )) {
        return materialErrorResponse("NOT_FOUND", "材料上传不存在或当前会话无权访问。", 404, id);
      }
      if (error instanceof Error && (
        error.message === "LOCAL_OBJECT_PART_INVALID" ||
        error.message === "LOCAL_OBJECT_PART_EMPTY" ||
        error.message === "LOCAL_OBJECT_PART_SIZE_MISMATCH"
      )) {
        return materialErrorResponse("INVALID_INPUT", "上传分片与服务端分片规格不一致。", 400, id);
      }
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

const objectStoreConfiguration = createMaterialObjectStoreFromEnv();

const defaultHandlers = createMaterialUploadPartPutHandler({
  accounts: new PrismaAccountRepository(prisma),
  cases: new PrismaCaseRepository(prisma),
  uploads: new MaterialUploadService(new PrismaMaterialReservationRepository(prisma), objectStoreConfiguration.store),
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
  isObjectStorageAvailable: objectStoreConfiguration.available,
});

export const PUT = defaultHandlers;
