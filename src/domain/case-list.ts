import type { CaseRecord } from "./case-record";

/** Safe metadata shown in the owner's case switcher; no narrative or account identifiers. */
export interface PrivateCaseListItem {
  caseId: string;
  lifecycle: CaseRecord["lifecycle"];
  version: number;
  aiReviewStatus?: CaseRecord["aiReviewStatus"];
  createdAt: string;
  updatedAt: string;
  materialCount: number;
}
