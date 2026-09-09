import type { AdminCaseView } from "@/server/admin/admin-case-service";

export function makeUnavailableAdminCaseView(caseId: string): AdminCaseView {
  const now = new Date(0).toISOString();
  return {
    record: {
      schemaVersion: "1.0",
      caseId,
      accountId: "unavailable",
      visibility: "private",
      lifecycle: "draft",
      version: 1,
      jurisdiction: {},
      facts: [],
      timeline: [],
      iloIndicators: [],
      elements: {
        workOrService: { status: "unknown", basis: [], missing: [] },
        involuntary: { status: "unknown", basis: [], missing: [] },
        penaltyOrThreat: { status: "unknown", basis: [], missing: [] },
      },
      evidenceCoverage: [],
      legalNavigation: [],
      referrals: [],
      safetyFlags: [],
      sourceTrace: [],
      consent: { version: "v1", saveCase: true, externalSharing: false, confirmedFieldPaths: [] },
      createdAt: now,
      updatedAt: now,
    },
    materials: [],
  };
}
