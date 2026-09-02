import { randomBytes } from "node:crypto";

export const MAX_MATERIAL_BYTES = 100 * 1024 * 1024;
export const MAX_CASE_MATERIAL_BYTES = 2 * 1024 * 1024 * 1024;

export const materialProcessingStateValues = [
  "uploading",
  "quarantined",
  "scanning",
  "saved_unread",
  "parse_queued",
  "parsed",
  "blocked_malicious",
  "scan_failed",
] as const;
export type MaterialProcessingState = (typeof materialProcessingStateValues)[number];
export type MaterialSignatureStatus = "match" | "mismatch" | "unknown";

export interface MaterialProcessingRecord {
  materialId: string;
  declaredMime: string | null;
  originalFilename: string;
  processingState: MaterialProcessingState;
  processingVersion: number;
  detectedMime: string | null;
  signatureStatus: MaterialSignatureStatus;
  eligibleForAi: boolean;
}

export function assertMaterialProcessingTransition(
  from: MaterialProcessingState,
  to: MaterialProcessingState,
): void {
  const transitions: Record<MaterialProcessingState, readonly MaterialProcessingState[]> = {
    uploading: ["quarantined"],
    quarantined: ["scanning"],
    scanning: ["saved_unread", "parse_queued", "blocked_malicious", "scan_failed"],
    parse_queued: ["parsed", "saved_unread"],
    saved_unread: ["scanning"],
    scan_failed: ["scanning"],
    parsed: [],
    blocked_malicious: [],
  };
  if (!transitions[from].includes(to)) {
    throw new Error("MATERIAL_PROCESSING_INVALID_TRANSITION");
  }
}

export type MaterialStorageLimitCode =
  | "FILE_STORAGE_LIMIT_EXCEEDED"
  | "CASE_STORAGE_LIMIT_EXCEEDED";

export class MaterialStorageLimitExceeded extends Error {
  constructor(readonly code: MaterialStorageLimitCode) {
    super(code);
    this.name = "MaterialStorageLimitExceeded";
  }
}

export interface MaterialReservationUsage {
  byteLength: number;
  usedBytes: number;
  reservedBytes: number;
}

export function createOpaqueMaterialObjectKey(
  generateId: () => Uint8Array = () => randomBytes(16),
): string {
  const id = generateId();
  if (id.byteLength !== 16) {
    throw new Error("Material object identifier must contain 16 bytes");
  }
  return `materials/${Buffer.from(id).toString("hex")}`;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative integer`);
  }
}

export function assertMaterialReservationAllowed({
  byteLength,
  usedBytes,
  reservedBytes,
}: MaterialReservationUsage): void {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0) {
    throw new TypeError("byteLength must be a positive integer");
  }
  assertNonNegativeInteger(usedBytes, "usedBytes");
  assertNonNegativeInteger(reservedBytes, "reservedBytes");

  if (byteLength > MAX_MATERIAL_BYTES) {
    throw new MaterialStorageLimitExceeded("FILE_STORAGE_LIMIT_EXCEEDED");
  }
  if (usedBytes + reservedBytes + byteLength > MAX_CASE_MATERIAL_BYTES) {
    throw new MaterialStorageLimitExceeded("CASE_STORAGE_LIMIT_EXCEEDED");
  }
}
