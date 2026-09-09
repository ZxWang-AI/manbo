export const adminRoleValues = ["case_reviewer", "case_supervisor"] as const;
export type AdminRole = (typeof adminRoleValues)[number];

export const adminReviewStatusValues = [
  "intake_rejected",
  "evidence_incomplete",
  "credibility_concern",
  "demonstrably_false",
] as const;
export type AdminReviewStatus = (typeof adminReviewStatusValues)[number];

export type AdminAction =
  | "case:list"
  | "case:view"
  | "material:play"
  | "material:download"
  | "review:create"
  | "review:second"
  | "case:modify"
  | "case:delete";

export interface AdminPrincipal {
  adminId: string;
  roles: readonly AdminRole[];
}

export class AdminAuthorizationError extends Error {
  constructor(readonly code: "ADMIN_UNAUTHENTICATED" | "ADMIN_FORBIDDEN") {
    super(code);
    this.name = "AdminAuthorizationError";
  }
}

const reviewerActions = new Set<AdminAction>([
  "case:list",
  "case:view",
  "material:play",
  "material:download",
  "review:create",
]);

const supervisorActions = new Set<AdminAction>([
  ...reviewerActions,
  "review:second",
  "case:modify",
  "case:delete",
]);

export function assertAdminAuthorized(principal: AdminPrincipal, action: AdminAction): void {
  if (principal.adminId.trim() === "") {
    throw new AdminAuthorizationError("ADMIN_UNAUTHENTICATED");
  }
  if (
    (principal.roles.includes("case_supervisor") && supervisorActions.has(action))
    || (principal.roles.includes("case_reviewer") && reviewerActions.has(action))
  ) {
    return;
  }
  throw new AdminAuthorizationError("ADMIN_FORBIDDEN");
}

export interface AdminReviewVersionDraft {
  adminReviewVersionId: string;
  caseId: string;
  reviewerId: string;
  status: AdminReviewStatus;
  rationale: string | null;
  sourceRefs: readonly string[];
  supersedesId: string | null;
  secondReviewerId: string | null;
}

export interface AdminReviewVersion extends AdminReviewVersionDraft {
  createdAt: string;
}

function requireIdentifier(value: string, code: string): void {
  if (value.trim() === "") {
    throw new Error(code);
  }
}

function requireSourceReferences(sourceRefs: readonly string[], code: string): void {
  if (sourceRefs.length === 0 || sourceRefs.some((sourceRef) => sourceRef.trim() === "")) {
    throw new Error(code);
  }
}

export function createAdminReviewVersion(
  draft: AdminReviewVersionDraft,
  now: () => Date = () => new Date(),
): Readonly<AdminReviewVersion> {
  requireIdentifier(draft.adminReviewVersionId, "ADMIN_REVIEW_ID_REQUIRED");
  requireIdentifier(draft.caseId, "ADMIN_REVIEW_CASE_REQUIRED");
  requireIdentifier(draft.reviewerId, "ADMIN_REVIEWER_REQUIRED");
  if (!adminReviewStatusValues.includes(draft.status)) {
    throw new Error("ADMIN_REVIEW_STATUS_INVALID");
  }

  if (draft.status === "credibility_concern") {
    if (draft.rationale?.trim() === "") {
      throw new Error("CREDIBILITY_SOURCE_REQUIRED");
    }
    requireSourceReferences(draft.sourceRefs, "CREDIBILITY_SOURCE_REQUIRED");
  }

  if (draft.status === "demonstrably_false") {
    if (draft.secondReviewerId === null || draft.secondReviewerId === draft.reviewerId) {
      throw new Error("SECOND_REVIEWER_REQUIRED");
    }
    requireIdentifier(draft.secondReviewerId, "SECOND_REVIEWER_REQUIRED");
    if (draft.rationale?.trim() === "") {
      throw new Error("COUNTER_EVIDENCE_REQUIRED");
    }
    requireSourceReferences(draft.sourceRefs, "COUNTER_EVIDENCE_REQUIRED");
  }

  const createdAt = now();
  if (Number.isNaN(createdAt.valueOf())) {
    throw new Error("ADMIN_REVIEW_TIME_INVALID");
  }

  return Object.freeze({
    ...draft,
    sourceRefs: Object.freeze([...draft.sourceRefs]),
    createdAt: createdAt.toISOString(),
  });
}
