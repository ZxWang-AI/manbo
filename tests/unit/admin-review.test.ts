import { describe, expect, it } from "vitest";

import {
  AdminAuthorizationError,
  assertAdminAuthorized,
  createAdminReviewVersion,
} from "@/domain/admin-review";

describe("administrator RBAC", () => {
  it("allows a reviewer to inspect a case and create an ordinary review", () => {
    const reviewer = { adminId: "reviewer-a", roles: ["case_reviewer"] as const };

    expect(() => assertAdminAuthorized(reviewer, "case:view")).not.toThrow();
    expect(() => assertAdminAuthorized(reviewer, "material:download")).not.toThrow();
    expect(() => assertAdminAuthorized(reviewer, "review:create")).not.toThrow();
  });

  it("requires a supervisor for destructive actions and a second review", () => {
    const reviewer = { adminId: "reviewer-a", roles: ["case_reviewer"] as const };
    const supervisor = { adminId: "supervisor-a", roles: ["case_supervisor"] as const };

    expect(() => assertAdminAuthorized(reviewer, "case:delete")).toThrow(
      expect.objectContaining<Partial<AdminAuthorizationError>>({ code: "ADMIN_FORBIDDEN" }),
    );
    expect(() => assertAdminAuthorized(reviewer, "review:second")).toThrow(
      expect.objectContaining<Partial<AdminAuthorizationError>>({ code: "ADMIN_FORBIDDEN" }),
    );
    expect(() => assertAdminAuthorized(supervisor, "case:delete")).not.toThrow();
    expect(() => assertAdminAuthorized(supervisor, "review:second")).not.toThrow();
  });

  it("does not authorize an empty administrator identity or unrelated role", () => {
    expect(() => assertAdminAuthorized({ adminId: "", roles: ["case_reviewer"] }, "case:view")).toThrow(
      expect.objectContaining<Partial<AdminAuthorizationError>>({ code: "ADMIN_UNAUTHENTICATED" }),
    );
    expect(() => assertAdminAuthorized({ adminId: "user-a", roles: [] }, "case:view")).toThrow(
      expect.objectContaining<Partial<AdminAuthorizationError>>({ code: "ADMIN_FORBIDDEN" }),
    );
  });
});

describe("independent administrator review versions", () => {
  const now = new Date("2026-09-02T10:00:00.000Z");

  it("creates a distinct non-conclusive review version without touching the user or AI record", () => {
    const review = createAdminReviewVersion({
      adminReviewVersionId: "review-1",
      caseId: "case-1",
      reviewerId: "reviewer-a",
      status: "evidence_incomplete",
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
    }, () => now);

    expect(review).toEqual({
      adminReviewVersionId: "review-1",
      caseId: "case-1",
      reviewerId: "reviewer-a",
      status: "evidence_incomplete",
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
      createdAt: "2026-09-02T10:00:00.000Z",
    });
  });

  it("requires independent second review and counter-evidence for demonstrably false", () => {
    const draft = {
      adminReviewVersionId: "review-2",
      caseId: "case-1",
      reviewerId: "reviewer-a",
      status: "demonstrably_false" as const,
      rationale: "The timestamped source conflicts with the claim.",
      sourceRefs: ["source/counter-evidence-1"],
      supersedesId: null,
    };

    expect(() => createAdminReviewVersion({ ...draft, secondReviewerId: "reviewer-a" }, () => now)).toThrow(
      "SECOND_REVIEWER_REQUIRED",
    );
    expect(() => createAdminReviewVersion({ ...draft, secondReviewerId: "supervisor-a", sourceRefs: [] }, () => now)).toThrow(
      "COUNTER_EVIDENCE_REQUIRED",
    );
    expect(createAdminReviewVersion({ ...draft, secondReviewerId: "supervisor-a" }, () => now)).toMatchObject({
      status: "demonstrably_false",
      reviewerId: "reviewer-a",
      secondReviewerId: "supervisor-a",
    });
  });

  it("requires a documented inconsistency before creating a credibility concern", () => {
    expect(() => createAdminReviewVersion({
      adminReviewVersionId: "review-3",
      caseId: "case-1",
      reviewerId: "reviewer-a",
      status: "credibility_concern",
      rationale: "",
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
    }, () => now)).toThrow("CREDIBILITY_SOURCE_REQUIRED");
  });
});
