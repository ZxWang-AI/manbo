import { makeCaseRecordFixture } from "./case-record";

export function makePrivateCaseRecord() {
  const record = makeCaseRecordFixture();
  return { ...record, consent: { ...record.consent, confirmedFieldPaths: ["/facts/0", "/timeline/0", "/jurisdiction"] } };
}

export function makeNarrativeConfirmation() {
  return {
    confirmed: true as const,
    caseId: "case-test-001",
    caseVersion: 1,
    connectorId: "markdown" as const,
    fieldPaths: ["/facts/0", "/timeline/0", "/jurisdiction"],
    consentEventId: "consent-1",
  };
}

export function makeManualConfirmation() {
  return {
    confirmed: true as const,
    caseId: "case-test-001",
    caseVersion: 1,
    connectorId: "manual" as const,
    fieldPaths: ["/facts/0"],
    consentEventId: "consent-1",
  };
}

export function makeJsonConfirmation() {
  return { ...makeNarrativeConfirmation(), connectorId: "json" as const };
}
