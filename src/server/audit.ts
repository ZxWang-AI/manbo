import { createHash, randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { prisma } from "@/server/db";

export type AuditAction =
  | "create"
  | "update"
  | "export_preview"
  | "export"
  | "delete"
  | "consent_change"
  | "model_fallback"
  | "material_view"
  | "material_play"
  | "material_download"
  | "admin_review_create"
  | "admin_review_update"
  | "admin_case_modify"
  | "admin_case_delete";

export interface AuditEvent {
  eventId: string;
  accountId: string;
  caseId?: string;
  actorId?: string;
  materialId?: string;
  action: AuditAction;
  occurredAt: string;
  outcome?: "allowed" | "denied" | "failed";
  metadata: Record<string, string | number>;
}

const metadataKeys = new Set(["connectorId", "fieldCount", "reasonCode", "reviewStatus"]);

export function hashRequestId(requestId: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${requestId}`, "utf8").digest("hex");
}

export function sanitizeAuditMetadata(
  input: unknown,
  options: { requestSalt?: string } = {},
): Record<string, string | number> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (metadataKeys.has(key) && (typeof value === "string" || typeof value === "number")) {
      output[key] = value;
    }
  }
  const requestId = (input as Record<string, unknown>).requestId;
  if (typeof requestId === "string" && options.requestSalt) {
    output.requestIdHash = hashRequestId(requestId, options.requestSalt);
  }
  return output;
}

export function buildAuditEvent(input: {
  accountId: string;
  caseId?: string;
  actorId?: string;
  materialId?: string;
  action: AuditAction;
  occurredAt?: string;
  outcome?: AuditEvent["outcome"];
  metadata?: unknown;
  requestSalt?: string;
}): AuditEvent {
  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (Number.isNaN(new Date(occurredAt).valueOf())) throw new Error("AUDIT_TIME_INVALID");
  return {
    eventId: randomUUID(),
    accountId: input.accountId,
    ...(input.caseId ? { caseId: input.caseId } : {}),
    ...(input.actorId ? { actorId: input.actorId } : {}),
    ...(input.materialId ? { materialId: input.materialId } : {}),
    action: input.action,
    occurredAt,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    metadata: sanitizeAuditMetadata(
      input.metadata,
      input.requestSalt ? { requestSalt: input.requestSalt } : {},
    ),
  };
}

export async function recordAudit(event: AuditEvent, database: PrismaClient = prisma): Promise<void> {
  await database.auditEvent.create({
    data: {
      auditEventId: event.eventId,
      accountId: event.accountId,
      ...(event.caseId ? { caseId: event.caseId } : {}),
      ...(event.actorId ? { actorId: event.actorId } : {}),
      ...(event.materialId ? { materialId: event.materialId } : {}),
      action: event.action,
      ...(event.outcome ? { outcome: event.outcome } : {}),
      metadata: JSON.parse(JSON.stringify(event.metadata)) as Prisma.InputJsonValue,
      occurredAt: new Date(event.occurredAt),
    },
  });
}
