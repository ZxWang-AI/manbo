import type { CaseRecord } from "@/domain/case-record";
import {
  CONFIRMED_EXPORT_FIELDS,
  createPreview,
  type ExternalSubmissionConnector,
  type ExportPreviewStore,
  type UserConfirmation,
  validateConfirmation,
} from "../connector";

const description = {
  connectorId: "manual" as const,
  targetName: "用户自行打开官方渠道",
  jurisdiction: "用户自行选择",
  supportedFieldPaths: [...CONFIRMED_EXPORT_FIELDS],
  attachmentPolicy: "none" as const,
  lastVerified: "2026-09-02",
};

export function createManualHandoffConnector(options: {
  store?: ExportPreviewStore;
  now?: () => Date;
  id?: () => string;
  officialUrl?: string;
} = {}): ExternalSubmissionConnector {
  const store = options.store;
  const now = options.now ?? (() => new Date());
  const officialUrl = options.officialUrl ?? "https://manbo.example.org/manual-handoff";
  return {
    describe: () => description,
    validate: (record, confirmation) => validateConfirmation(record, description, confirmation),
    preview: (record: CaseRecord, confirmation: UserConfirmation) => createPreview(
      description,
      record,
      confirmation,
      "请在安全情况下打开官方渠道并自行提交已确认的材料。平台不会代你提交。",
      "text/markdown",
      options,
    ),
    async submit(record, confirmation, exportId) {
      if (!store) throw new Error("EXPORT_PREVIEW_STORE_REQUIRED");
      const preview = await store.get(exportId);
      if (!preview) throw new Error("EXPORT_PREVIEW_NOT_FOUND");
      if (new Date(preview.expiresAt).getTime() <= now().getTime()) throw new Error("EXPORT_PREVIEW_EXPIRED: preview expired");
      if (preview.caseId !== record.caseId || preview.caseVersion !== record.version) {
        throw new Error("EXPORT_PREVIEW_VERSION_MISMATCH: case version changed");
      }
      if (preview.connectorId !== confirmation.connectorId || preview.caseVersion !== confirmation.caseVersion) {
        throw new Error("EXPORT_PREVIEW_CONFIRMATION_MISMATCH");
      }
      if (preview.caseId !== confirmation.caseId || preview.consentEventId !== confirmation.consentEventId || JSON.stringify(preview.fieldPaths) !== JSON.stringify(confirmation.fieldPaths)) {
        throw new Error("EXPORT_PREVIEW_CONFIRMATION_MISMATCH: fields or consent changed");
      }
      return { kind: "manual_handoff", officialUrl, exportId };
    },
    async status() {
      return "unknown";
    },
  };
}
