import { randomUUID } from "node:crypto";

import type { CaseRecord } from "@/domain/case-record";

export type ConnectorId = "markdown" | "json" | "manual";

export interface ConnectorDescription {
  connectorId: ConnectorId;
  targetName: string;
  jurisdiction: string;
  supportedFieldPaths: string[];
  attachmentPolicy: "none";
  lastVerified: string;
}

export interface UserConfirmation {
  confirmed: true;
  caseId: string;
  caseVersion: number;
  connectorId: ConnectorId;
  fieldPaths: string[];
  consentEventId: string;
}

export interface ValidationIssue {
  fieldPath: string;
  code: "missing" | "unconfirmed" | "unsupported";
  message: string;
}

export interface ExportPreview {
  exportId: string;
  caseId: string;
  connectorId: ConnectorId;
  caseVersion: number;
  fieldPaths: string[];
  consentEventId: string;
  mediaType: "text/markdown" | "application/json";
  text: string;
  disclaimerIds: string[];
  expiresAt: string;
}

export interface ExportPreviewStore {
  save(preview: ExportPreview): Promise<void>;
  get(exportId: string): Promise<ExportPreview | undefined>;
}

export class InMemoryExportPreviewStore implements ExportPreviewStore {
  private readonly previews = new Map<string, ExportPreview>();

  async save(preview: ExportPreview): Promise<void> {
    this.previews.set(preview.exportId, preview);
  }

  async get(exportId: string): Promise<ExportPreview | undefined> {
    return this.previews.get(exportId);
  }
}

export interface Connector {
  describe(): ConnectorDescription;
  validate(record: CaseRecord, confirmation: UserConfirmation): ValidationIssue[];
  preview(record: CaseRecord, confirmation: UserConfirmation): Promise<ExportPreview>;
}

export type SubmissionStatus = "unknown" | "received" | "processing" | "closed";

export interface ExternalSubmissionConnector extends Connector {
  submit(record: CaseRecord, confirmation: UserConfirmation, exportId: string): Promise<SubmitResult>;
  status(referenceId: string): Promise<SubmissionStatus>;
}

export type SubmitResult =
  | { kind: "manual_handoff"; officialUrl: string; exportId: string }
  | { kind: "received"; referenceId: string; receivedAt: string };

export const CONFIRMED_EXPORT_FIELDS = [
  "/jurisdiction",
  "/facts",
  "/timeline",
  "/iloIndicators",
  "/elements",
  "/evidenceCoverage",
  "/legalNavigation",
  "/referrals",
  "/safetyFlags",
  "/sourceTrace",
  "/consent",
] as const;

export function validateConfirmation(
  record: CaseRecord,
  description: ConnectorDescription,
  confirmation: UserConfirmation,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!confirmation.confirmed) {
    issues.push({ fieldPath: "", code: "missing", message: "导出前需要明确确认。" });
    return issues;
  }
  if (confirmation.caseId !== record.caseId || confirmation.caseVersion !== record.version) {
    issues.push({ fieldPath: "", code: "missing", message: "案件版本已变化，请重新预览。" });
  }
  if (confirmation.connectorId !== description.connectorId) {
    issues.push({ fieldPath: "", code: "unsupported", message: "导出连接器不匹配。" });
  }
  const consented = new Set(record.consent.confirmedFieldPaths);
  const supported = new Set(description.supportedFieldPaths);
  for (const fieldPath of confirmation.fieldPaths) {
    const supportedByParent = [...supported].some((path) => fieldPath === path || fieldPath.startsWith(`${path}/`));
    if (!supportedByParent) {
      issues.push({ fieldPath, code: "unsupported", message: "该字段不在此导出格式的允许范围内。" });
    } else if (!consented.has(fieldPath) && !consented.has(fieldPath.split("/").slice(0, 2).join("/"))) {
      issues.push({ fieldPath, code: "unconfirmed", message: "该字段尚未在案件同意快照中确认。" });
    }
  }
  if (confirmation.fieldPaths.length === 0) {
    issues.push({ fieldPath: "", code: "missing", message: "至少选择一个要导出的字段。" });
  }
  return issues;
}

export function assertValidConfirmation(
  record: CaseRecord,
  description: ConnectorDescription,
  confirmation: UserConfirmation,
): void {
  const issues = validateConfirmation(record, description, confirmation);
  if (issues.length > 0) throw new Error(`EXPORT_CONFIRMATION_INVALID:${issues[0]?.message ?? "invalid"}`);
}

export function createPreview(
  description: ConnectorDescription,
  record: CaseRecord,
  confirmation: UserConfirmation,
  text: string,
  mediaType: ExportPreview["mediaType"],
  options: { store?: ExportPreviewStore; now?: () => Date; id?: () => string } = {},
): Promise<ExportPreview> {
  assertValidConfirmation(record, description, confirmation);
  const now = options.now?.() ?? new Date();
  const preview: ExportPreview = {
    exportId: options.id?.() ?? randomUUID(),
    caseId: record.caseId,
    connectorId: description.connectorId,
    caseVersion: record.version,
    fieldPaths: [...confirmation.fieldPaths],
    consentEventId: confirmation.consentEventId,
    mediaType,
    text,
    disclaimerIds: ["ai-assessment", "user-decision"],
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
  };
  return (async () => {
    await options.store?.save(preview);
    return preview;
  })();
}
