import type { CaseRecord } from "@/domain/case-record";
import {
  CONFIRMED_EXPORT_FIELDS,
  createPreview,
  type Connector,
  type ConnectorDescription,
  type ExportPreviewStore,
  type UserConfirmation,
  validateConfirmation,
} from "../connector";

const description: ConnectorDescription = {
  connectorId: "json",
  targetName: "本地 JSON 材料",
  jurisdiction: "用户自行选择",
  supportedFieldPaths: [...CONFIRMED_EXPORT_FIELDS],
  attachmentPolicy: "none",
  lastVerified: "2026-09-02",
};

export function createJsonConnector(options: { store?: ExportPreviewStore; now?: () => Date; id?: () => string } = {}): Connector {
  return {
    describe: () => description,
    validate: (record, confirmation) => validateConfirmation(record, description, confirmation),
    preview: (record: CaseRecord, confirmation: UserConfirmation) => {
      const selected = (path: string) => confirmation.fieldPaths.includes(path) || confirmation.fieldPaths.some((item) => item.startsWith(`${path}/`));
      const output: Record<string, unknown> = { disclaimer: "用户报告（未经独立核实）", schemaVersion: record.schemaVersion };
      if (selected("/jurisdiction")) output.jurisdiction = record.jurisdiction;
      if (selected("/facts")) {
        output.facts = record.facts.map(({ field, value, certainty }) => ({ field, value, certainty }));
      }
      if (selected("/timeline")) {
        output.timeline = record.timeline.map(({ occurredAt, description }) => ({ occurredAt, description }));
      }
      if (selected("/iloIndicators")) output.iloIndicators = record.iloIndicators;
      if (selected("/elements")) output.elements = record.elements;
      if (selected("/evidenceCoverage")) output.evidenceCoverage = record.evidenceCoverage;
      if (selected("/legalNavigation")) output.legalNavigation = record.legalNavigation;
      if (selected("/referrals")) output.referrals = record.referrals;
      if (selected("/safetyFlags")) output.safetyFlags = record.safetyFlags;
      return createPreview(description, record, confirmation, JSON.stringify(output, null, 2), "application/json", options);
    },
  };
}
