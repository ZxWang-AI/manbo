import { MAX_LOCAL_MATERIAL_BYTES } from "./material-upload-state";

export type MaterialUploadStage = "uploading" | "scanning" | "saved_unread";

export interface MaterialUploadClientOptions {
  fetcher?: typeof fetch;
  onStage?: (stage: MaterialUploadStage) => void;
}

export interface MaterialUploadResult {
  materialId: string;
  uploadId: string;
  objectKey: string;
}

export class MaterialUploadClientError extends Error {
  readonly code: string;
  readonly status: number | undefined;

  constructor(
    code: string,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "MaterialUploadClientError";
    this.code = code;
    this.status = status;
  }
}

interface UploadReservationPayload {
  upload?: {
    uploadId?: unknown;
    materialId?: unknown;
    reservedBytes?: unknown;
    uploadTarget?: {
      objectKey?: unknown;
      partSizeBytes?: unknown;
      parts?: Array<{ partNumber?: unknown; url?: unknown }>;
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readError(response: Response, fallback: string, codeOverride?: string): Promise<MaterialUploadClientError> {
  const payload = await response.json().catch(() => null) as (Record<string, unknown> | null);
  const code = codeOverride ?? (isRecord(payload) && typeof payload.code === "string" ? payload.code : "UPLOAD_FAILED");
  const message = isRecord(payload) && typeof payload.message === "string" ? payload.message : fallback;
  return new MaterialUploadClientError(code, message, response.status);
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || value.length === 0) throw new MaterialUploadClientError(code, "上传服务返回的数据不完整。");
  return value;
}

function requirePositiveInteger(value: unknown, code: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new MaterialUploadClientError(code, "上传服务返回的分片规格无效。");
  }
  return value as number;
}

function asBody(bytes: Uint8Array): Blob {
  // Blob avoids the ArrayBufferLike/SharedArrayBuffer typing mismatch in newer DOM libs.
  return new Blob([bytes as unknown as BlobPart]);
}

export async function uploadMaterialFile(
  file: Pick<Blob, "size" | "arrayBuffer" | "type"> & { name?: string },
  caseId: string,
  options: MaterialUploadClientOptions = {},
): Promise<MaterialUploadResult> {
  if (!caseId.trim()) throw new MaterialUploadClientError("CASE_REQUIRED", "请先保存为私密档案，再上传材料。");
  if (file.size <= 0 || file.size > MAX_LOCAL_MATERIAL_BYTES) {
    throw new MaterialUploadClientError("PAYLOAD_TOO_LARGE", "单个材料不能超过 100 MB。", 413);
  }

  const fetcher = options.fetcher ?? fetch;
  const onStage = options.onStage ?? (() => undefined);
  onStage("uploading");

  const reservationResponse = await fetcher(`/api/cases/${encodeURIComponent(caseId)}/materials/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      byteLength: file.size,
      ...(file.name ? { originalFilename: file.name } : {}),
      ...(file.type ? { declaredMime: file.type } : {}),
    }),
  });
  if (!reservationResponse.ok) throw await readError(reservationResponse, "材料上传预约失败，请稍后重试。");
  const reservation = await reservationResponse.json().catch(() => null) as UploadReservationPayload | null;
  const upload = reservation?.upload;
  const uploadId = requireString(upload?.uploadId, "UPLOAD_RESERVATION_INVALID");
  const materialId = requireString(upload?.materialId, "UPLOAD_RESERVATION_INVALID");
  const reservedBytes = requirePositiveInteger(upload?.reservedBytes, "UPLOAD_RESERVATION_INVALID");
  const target = upload?.uploadTarget;
  const objectKey = requireString(target?.objectKey, "UPLOAD_TARGET_INVALID");
  if (reservedBytes !== file.size || !target?.parts || target.parts.length === 0) {
    throw new MaterialUploadClientError("UPLOAD_TARGET_INVALID", "上传服务返回的材料大小或分片目标无效。");
  }
  const partSizeBytes = target.partSizeBytes === undefined
    ? (target.parts.length === 1 ? file.size : 0)
    : requirePositiveInteger(target.partSizeBytes, "UPLOAD_TARGET_INVALID");
  if (partSizeBytes === 0) {
    throw new MaterialUploadClientError("UPLOAD_TARGET_INVALID", "上传服务未返回分片大小，请稍后重试。");
  }

  const cancelUrl = `/api/cases/${encodeURIComponent(caseId)}/materials/uploads/${encodeURIComponent(uploadId)}`;
  const cancelReservation = async () => {
    await fetcher(cancelUrl, { method: "DELETE" }).catch(() => undefined);
  };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) {
      throw new MaterialUploadClientError("FILE_READ_FAILED", "材料读取失败，请重新选择文件。");
    }
    const expectedPartCount = Math.ceil(file.size / partSizeBytes);
    if (target.parts.length !== expectedPartCount) {
      throw new MaterialUploadClientError("UPLOAD_TARGET_INVALID", "上传服务返回的分片数量与材料大小不一致。");
    }

    const parts = [...target.parts].sort((left, right) => Number(left.partNumber) - Number(right.partNumber));
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const partNumber = requirePositiveInteger(part?.partNumber, "UPLOAD_TARGET_INVALID");
      if (partNumber !== index + 1) {
        throw new MaterialUploadClientError("UPLOAD_TARGET_INVALID", "上传服务返回的分片编号不连续。");
      }
      const url = requireString(part?.url, "UPLOAD_TARGET_INVALID");
      const start = index * partSizeBytes;
      const partBytes = bytes.slice(start, Math.min(start + partSizeBytes, bytes.byteLength));
      const partResponse = await fetcher(url, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: asBody(partBytes),
      });
      if (!partResponse.ok) throw await readError(partResponse, "材料分片上传失败，请重试。", "PART_UPLOAD_FAILED");
    }

    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    const expectedSha256 = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
    onStage("scanning");
    const completeResponse = await fetcher(`/api/cases/${encodeURIComponent(caseId)}/materials/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objectKey, expectedBytes: file.size, expectedSha256 }),
    });
    if (!completeResponse.ok) throw await readError(completeResponse, "材料保存失败，请重试。");
    onStage("saved_unread");
    return { materialId, uploadId, objectKey };
  } catch (error) {
    await cancelReservation();
    throw error;
  }
}
