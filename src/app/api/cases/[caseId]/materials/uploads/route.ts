import { randomUUID } from "node:crypto";

import { z } from "zod";

import { MAX_MATERIAL_BYTES, MaterialStorageLimitExceeded } from "@/domain/material";
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
  MAX_MATERIAL_REQUEST_BYTES,
  materialErrorResponse,
  resolveMaterialOwner,
  type MaterialRouteContext,
} from "../route-helpers";

const requestSchema = z.strictObject({
  byteLength: z.number().int().positive(),
  originalFilename: z.string().trim().min(1).max(255).optional(),
  declaredMime: z.string().trim().min(1).max(160).optional(),
});

export interface MaterialUploadPostHandlerOptions {
  accounts: Pick<AccountRepository, "resumeSession">;
  cases: Pick<CaseRepository, "getPrivate">;
  uploads: Pick<MaterialUploadService, "reserve">;
  isPersistenceAvailable: boolean;
  isObjectStorageAvailable: boolean;
  requestId?: () => string;
}

async function readReservationRequest(request: Request): Promise<z.infer<typeof requestSchema> | null> {
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

export function createMaterialUploadPostHandler({
  accounts,
  cases,
  uploads,
  isPersistenceAvailable,
  isObjectStorageAvailable,
  requestId = randomUUID,
}: MaterialUploadPostHandlerOptions) {
  return async function POST(
    request: Request,
    context: MaterialRouteContext<{ caseId: string }>,
  ): Promise<Response> {
    const id = requestId();
    if (!isPersistenceAvailable || !isObjectStorageAvailable) {
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
    const owner = await resolveMaterialOwner(request, accounts).catch(() => null);
    if (!owner) {
      return materialErrorResponse("UNAUTHENTICATED", "会话已失效，请重新进入平台。", 401, id);
    }
    const input = await readReservationRequest(request);
    if (!input) {
      return materialErrorResponse("INVALID_INPUT", "材料上传请求格式不符合要求。", 400, id);
    }
    if (input.byteLength > MAX_MATERIAL_BYTES) {
      return materialErrorResponse("PAYLOAD_TOO_LARGE", "单个材料不能超过 100 MB。", 413, id);
    }
    const { caseId } = await context.params;

    try {
      const record = await cases.getPrivate(owner.accountId, caseId);
      if (!record) {
        return materialErrorResponse("NOT_FOUND", "案件不存在或当前会话无权访问。", 404, id);
      }
      const started = await uploads.reserve({
        accountId: owner.accountId,
        caseId,
        byteLength: input.byteLength,
        ...(input.originalFilename !== undefined ? { originalFilename: input.originalFilename } : {}),
        ...(input.declaredMime !== undefined ? { declaredMime: input.declaredMime } : {}),
      });
      return Response.json(
        {
          upload: {
            uploadId: started.reservation.uploadId,
            materialId: started.reservation.materialId,
            reservedBytes: started.reservation.reservedBytes,
            expiresAt: started.reservation.expiresAt,
            uploadTarget: started.uploadTarget,
          },
        },
        { status: 201, headers: { "cache-control": "no-store" } },
      );
    } catch (error) {
      if (error instanceof MaterialStorageLimitExceeded) {
        return materialErrorResponse("PAYLOAD_TOO_LARGE", "材料超过案件可安全保存的容量限制。", 413, id);
      }
      return materialErrorResponse("DEGRADED", "材料服务暂时不可用；请稍后重试。", 503, id);
    }
  };
}

const objectStoreConfiguration = createMaterialObjectStoreFromEnv();

const defaultHandlers = createMaterialUploadPostHandler({
  accounts: new PrismaAccountRepository(prisma),
  cases: new PrismaCaseRepository(prisma),
  uploads: new MaterialUploadService(new PrismaMaterialReservationRepository(prisma), objectStoreConfiguration.store),
  isPersistenceAvailable:
    process.env.APP_MODE !== "static" &&
    Boolean(process.env.DATABASE_URL) &&
    (process.env.NODE_ENV !== "production" || Boolean(process.env.SESSION_SECRET)),
  isObjectStorageAvailable: objectStoreConfiguration.available,
});

export const POST = defaultHandlers;
