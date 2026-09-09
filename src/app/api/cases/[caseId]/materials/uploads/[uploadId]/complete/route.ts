import { randomUUID } from "node:crypto";

import { z } from "zod";

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
import { materialProcessingQueue } from "@/server/services/material-processing-defaults";
import { createMaterialObjectStoreFromEnv } from "@/media/storage/object-store-factory";

import {
  MAX_MATERIAL_REQUEST_BYTES,
  materialErrorResponse,
  resolveMaterialOwner,
  type MaterialRouteContext,
} from "../../../route-helpers";

const requestSchema = z.strictObject({
  objectKey: z.string().regex(/^materials\/[a-f0-9]{32}$/u),
  expectedBytes: z.number().int().positive(),
  expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
});

export interface MaterialUploadCompletePostHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate">;
  uploads: Pick<MaterialUploadService, "complete">;
  isPersistenceAvailable: boolean;
  isObjectStorageAvailable: boolean;
  requestId?: () => string;
}

async function readCompletionRequest(
  request: Request,
): Promise<z.infer<typeof requestSchema> | null> {
  const body = await request.text();
  if (body.trim() === "" || new TextEncoder().encode(body).byteLength > MAX_MATERIAL_REQUEST_BYTES) {
    return null;
  }
  try {
    const parsed = requestSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createMaterialUploadCompletePostHandler({
  accounts,
  cases,
  uploads,
  isPersistenceAvailable,
  isObjectStorageAvailable,
  requestId = randomUUID,
}: MaterialUploadCompletePostHandlerOptions) {
  return async function POST(
    request: Request,
    context: MaterialRouteContext<{ caseId: string; uploadId: string }>,
  ): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable || !isObjectStorageAvailable) {
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveMaterialOwner(request, accounts).catch(() => null);
    if (!owner) {
      return materialErrorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }
    const input = await readCompletionRequest(request);
    if (!input) {
      return materialErrorResponse("INVALID_INPUT", "材料完成请求格式不符合要求。", 400, id);
    }
    const { caseId, uploadId } = await context.params;

    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) {
        return materialErrorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, id);
      }
      await uploads.complete({ accountId: owner.accountId, caseId, uploadId, ...input });
      return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "MATERIAL_UPLOAD_UNAVAILABLE") {
        return materialErrorResponse("NOT_FOUND", "材料上传不存在或当前会话无权访问。", 404, id);
      }
      if (error instanceof Error && (
        error.message === "MATERIAL_COMPLETION_METADATA_MISMATCH" ||
        error.message === "MATERIAL_COMPLETION_CONFLICT" ||
        error.message === "LOCAL_OBJECT_ALREADY_EXISTS"
      )) {
        return materialErrorResponse("VERSION_CONFLICT", "材料上传状态已变更，请重新开始。", 409, id);
      }
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

const objectStoreConfiguration = createMaterialObjectStoreFromEnv();

const defaultHandlers = createMaterialUploadCompletePostHandler({
  accounts: new PrismaAccountRepository(prisma),
  cases: new PrismaCaseRepository(prisma),
  uploads: new MaterialUploadService(
    new PrismaMaterialReservationRepository(prisma),
    objectStoreConfiguration.store,
    materialProcessingQueue,
  ),
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
  isObjectStorageAvailable: objectStoreConfiguration.available,
});

export const POST = defaultHandlers;
