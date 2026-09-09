import { describe, expect, it, vi } from "vitest";

import {
  AdminCaseService,
  type AdminCaseRepository,
} from "@/server/admin/admin-case-service";
import type { AdminReviewRepository } from "@/server/repositories/admin-review-repository";
import type { AdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";
import { makeCaseRecordFixture } from "../fixtures/case-record";

const reviewer = { adminId: "reviewer-a", roles: ["case_reviewer"] as const };
const supervisor = { adminId: "supervisor-b", roles: ["case_supervisor"] as const };

function makeService() {
  const caseRepository: AdminCaseRepository = {
    listActive: vi.fn().mockResolvedValue([{
      caseId: "case-a",
      lifecycle: "draft",
      aiReviewStatus: "needs_more_information",
      updatedAt: "2026-09-02T10:00:00.000Z",
      materialCount: 1,
    }]),
    getActive: vi.fn().mockResolvedValue({
      record: { ...makeCaseRecordFixture(), caseId: "case-a" },
      materials: [{
        materialId: "material-a",
        originalFilename: "contract.pdf",
        declaredBytes: 12,
        declaredMime: "application/pdf",
        processingState: "parsed",
        eligibleForAi: true,
        createdAt: "2026-09-02T09:00:00.000Z",
      }],
    }),
    updateActive: vi.fn().mockResolvedValue({
      record: { ...makeCaseRecordFixture(), caseId: "case-a", version: 2 },
      materials: [],
    }),
    deleteActive: vi.fn().mockResolvedValue(undefined),
  };
  const reviews: AdminReviewRepository = {
    create: vi.fn(async (review) => review),
    findForCase: vi.fn().mockResolvedValue([]),
    findByIdForCase: vi.fn().mockResolvedValue(null),
  };
  const changes: AdminCaseChangeRepository = {
    create: vi.fn().mockResolvedValue(undefined),
    findForCase: vi.fn().mockResolvedValue([]),
  };
  return {
    caseRepository,
    reviews,
    changes,
    service: new AdminCaseService(caseRepository, reviews, () => new Date("2026-09-02T10:00:00.000Z"), changes),
  };
}

describe("administrator case service", () => {
  it("allows a reviewer to list and view a case without creating an access record", async () => {
    const { caseRepository, reviews, service } = makeService();

    await expect(service.listCases(reviewer)).resolves.toEqual([{
      caseId: "case-a",
      lifecycle: "draft",
      aiReviewStatus: "needs_more_information",
      updatedAt: "2026-09-02T10:00:00.000Z",
      materialCount: 1,
    }]);
    await expect(service.getCase(reviewer, "case-a")).resolves.toMatchObject({
      record: { caseId: "case-a" },
      materials: [{ materialId: "material-a", originalFilename: "contract.pdf" }],
    });

    expect(caseRepository.listActive).toHaveBeenCalledOnce();
    expect(caseRepository.getActive).toHaveBeenCalledWith("case-a");
    expect(reviews.create).not.toHaveBeenCalled();
    expect(reviews.findForCase).not.toHaveBeenCalled();
  });

  it("does not query a case when a principal lacks the review role", async () => {
    const { caseRepository, service } = makeService();

    await expect(service.getCase({ adminId: "user-a", roles: [] }, "case-a")).rejects.toMatchObject({
      code: "ADMIN_FORBIDDEN",
    });

    expect(caseRepository.getActive).not.toHaveBeenCalled();
  });

  it("binds an ordinary review to the authenticated reviewer", async () => {
    const { reviews, service } = makeService();

    await expect(service.createReview(reviewer, "case-a", {
      adminReviewVersionId: "review-a",
      status: "evidence_incomplete",
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
    })).resolves.toMatchObject({
      reviewerId: "reviewer-a",
      secondReviewerId: null,
      status: "evidence_incomplete",
      createdAt: "2026-09-02T10:00:00.000Z",
    });

    expect(reviews.create).toHaveBeenCalledWith(expect.objectContaining({
      reviewerId: "reviewer-a",
      secondReviewerId: null,
    }));
  });

  it("requires a different prior reviewer and a supervisor before finalizing demonstrably false", async () => {
    const { reviews, service } = makeService();
    vi.mocked(reviews.findByIdForCase).mockResolvedValue({
      adminReviewVersionId: "review-primary",
      caseId: "case-a",
      reviewerId: "reviewer-a",
      status: "credibility_concern",
      rationale: "The dates conflict.",
      sourceRefs: ["material-a"],
      supersedesId: null,
      secondReviewerId: null,
      createdAt: "2026-09-02T09:00:00.000Z",
    });

    await expect(service.createReview(reviewer, "case-a", {
      adminReviewVersionId: "review-final",
      status: "demonstrably_false",
      rationale: "The original document is inconsistent with the claim.",
      sourceRefs: ["material-a"],
      supersedesId: "review-primary",
    })).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });

    await expect(service.createReview(supervisor, "case-a", {
      adminReviewVersionId: "review-final",
      status: "demonstrably_false",
      rationale: "The original document is inconsistent with the claim.",
      sourceRefs: ["material-a"],
      supersedesId: "review-primary",
    })).resolves.toMatchObject({
      reviewerId: "reviewer-a",
      secondReviewerId: "supervisor-b",
      status: "demonstrably_false",
    });
  });

  it("allows only a supervisor to modify a case with an expected version", async () => {
    const { caseRepository, changes, service } = makeService();
    const updateActive = vi.fn().mockResolvedValue({
      record: { ...makeCaseRecordFixture(), caseId: "case-a", version: 2 },
      materials: [],
    });
    caseRepository.updateActive = updateActive;

    await expect(service.modifyCase(reviewer, "case-a", { lifecycle: "confirmed" }, 1))
      .rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.modifyCase(supervisor, "case-a", { lifecycle: "confirmed" }, 1))
      .resolves.toMatchObject({ record: { version: 2 } });
    expect(updateActive).toHaveBeenCalledWith("case-a", { lifecycle: "confirmed" }, 1);
    expect(changes.create).toHaveBeenCalledWith(expect.objectContaining({ action: "modify", adminId: "supervisor-b" }));
  });

  it("allows only a supervisor to soft-delete an active case", async () => {
    const { caseRepository, changes, service } = makeService();
    const deleteActive = vi.fn().mockResolvedValue(undefined);
    caseRepository.deleteActive = deleteActive;

    await expect(service.deleteCase(reviewer, "case-a")).rejects.toMatchObject({ code: "ADMIN_FORBIDDEN" });
    await expect(service.deleteCase(supervisor, "case-a")).resolves.toBeUndefined();
    expect(deleteActive).toHaveBeenCalledWith("case-a");
    expect(changes.create).toHaveBeenCalledWith(expect.objectContaining({ action: "delete", adminId: "supervisor-b" }));
  });

  it("returns immutable review versions for an authorized case viewer", async () => {
    const { caseRepository, reviews, service } = makeService();
    vi.mocked(reviews.findForCase).mockResolvedValue([{
      adminReviewVersionId: "review-a",
      caseId: "case-a",
      reviewerId: "reviewer-a",
      status: "evidence_incomplete",
      rationale: null,
      sourceRefs: [],
      supersedesId: null,
      secondReviewerId: null,
      createdAt: "2026-09-02T10:00:00.000Z",
    }]);

    await expect(service.listReviews(reviewer, "case-a")).resolves.toHaveLength(1);
    expect(caseRepository.getActive).toHaveBeenCalledWith("case-a");
    expect(reviews.findForCase).toHaveBeenCalledWith("case-a");
  });

  it("returns immutable administrator change history for an authorized supervisor", async () => {
    const { caseRepository, changes, service } = makeService();
    const findForCase = vi.fn().mockResolvedValue([{
      changeVersionId: "change-a",
      caseId: "case-a",
      adminId: "supervisor-b",
      action: "modify",
      expectedVersion: 1,
      resultingVersion: 2,
      patch: { lifecycle: "confirmed" },
      createdAt: "2026-09-02T10:00:00.000Z",
    }]);
    changes.findForCase = findForCase;

    await expect(service.listChanges(supervisor, "case-a")).resolves.toEqual([
      expect.objectContaining({ changeVersionId: "change-a", action: "modify" }),
    ]);
    expect(caseRepository.getActive).toHaveBeenCalledWith("case-a");
    expect(findForCase).toHaveBeenCalledWith("case-a");
  });
});
