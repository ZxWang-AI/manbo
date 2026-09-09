import {
  AdminAuthorizationError,
  assertAdminAuthorized,
  createAdminReviewVersion,
  type AdminPrincipal,
  type AdminReviewStatus,
  type AdminReviewVersion,
} from "@/domain/admin-review";
import type { CasePatch, CaseRecord } from "@/domain/case-record";
import type { AdminReviewRepository } from "@/server/repositories/admin-review-repository";
import type { AdminCaseChangeRepository } from "@/server/repositories/admin-case-change-repository";
import type { AdminCaseChangeVersion } from "@/server/repositories/admin-case-change-repository";
import { randomUUID } from "node:crypto";

export interface AdminCaseListItem {
  caseId: string;
  lifecycle: CaseRecord["lifecycle"];
  aiReviewStatus?: CaseRecord["aiReviewStatus"];
  updatedAt: string;
  materialCount: number;
}

export interface AdminCaseView {
  record: CaseRecord;
  materials: readonly AdminMaterialSummary[];
}

export interface AdminMaterialSummary {
  materialId: string;
  originalFilename: string | null;
  declaredBytes: number;
  declaredMime: string | null;
  processingState: string;
  eligibleForAi: boolean;
  createdAt: string;
}

export interface AdminCaseRepository {
  listActive(): Promise<AdminCaseListItem[]>;
  getActive(caseId: string): Promise<AdminCaseView | null>;
  updateActive(caseId: string, patch: CasePatch, expectedVersion: number): Promise<AdminCaseView>;
  deleteActive(caseId: string): Promise<void>;
}

export interface AdminReviewInput {
  adminReviewVersionId: string;
  status: AdminReviewStatus;
  rationale: string | null;
  sourceRefs: readonly string[];
  supersedesId: string | null;
}

export class AdminCaseService {
  constructor(
    private readonly cases: AdminCaseRepository,
    private readonly reviews: AdminReviewRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly changes: AdminCaseChangeRepository = {
      create: async () => undefined,
      findForCase: async () => [],
    },
  ) {}

  async listCases(principal: AdminPrincipal): Promise<AdminCaseListItem[]> {
    assertAdminAuthorized(principal, "case:list");
    return this.cases.listActive();
  }

  async getCase(principal: AdminPrincipal, caseId: string): Promise<AdminCaseView> {
    assertAdminAuthorized(principal, "case:view");
    const value = await this.cases.getActive(caseId);
    if (!value) throw new Error("ADMIN_CASE_NOT_FOUND");
    return value;
  }

  async listReviews(principal: AdminPrincipal, caseId: string): Promise<AdminReviewVersion[]> {
    assertAdminAuthorized(principal, "case:view");
    const current = await this.cases.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");
    return this.reviews.findForCase(caseId);
  }

  async listChanges(principal: AdminPrincipal, caseId: string): Promise<AdminCaseChangeVersion[]> {
    assertAdminAuthorized(principal, "case:view");
    const current = await this.cases.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");
    return this.changes.findForCase(caseId);
  }

  async createReview(
    principal: AdminPrincipal,
    caseId: string,
    input: AdminReviewInput,
  ): Promise<AdminReviewVersion> {
    const isSecondReview = input.status === "demonstrably_false";
    assertAdminAuthorized(principal, isSecondReview ? "review:second" : "review:create");
    const current = await this.cases.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");

    let reviewerId = principal.adminId;
    let secondReviewerId: string | null = null;
    if (isSecondReview) {
      if (!input.supersedesId) throw new Error("SECOND_REVIEW_REQUIRED");
      const previous = await this.reviews.findByIdForCase(caseId, input.supersedesId);
      if (!previous || previous.reviewerId === principal.adminId) {
        throw new Error("SECOND_REVIEW_REQUIRED");
      }
      reviewerId = previous.reviewerId;
      secondReviewerId = principal.adminId;
    }

    return this.reviews.create(createAdminReviewVersion({
      adminReviewVersionId: input.adminReviewVersionId,
      caseId,
      reviewerId,
      status: input.status,
      rationale: input.rationale,
      sourceRefs: input.sourceRefs,
      supersedesId: input.supersedesId,
      secondReviewerId,
    }, this.now));
  }

  async modifyCase(
    principal: AdminPrincipal,
    caseId: string,
    patch: CasePatch,
    expectedVersion: number,
  ): Promise<AdminCaseView> {
    assertAdminAuthorized(principal, "case:modify");
    const current = await this.cases.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");
    const updated = await this.cases.updateActive(caseId, patch, expectedVersion);
    await this.changes.create({
      changeVersionId: randomUUID(),
      caseId,
      adminId: principal.adminId,
      action: "modify",
      expectedVersion,
      resultingVersion: updated.record.version,
      patch,
      createdAt: this.now().toISOString(),
    });
    return updated;
  }

  async deleteCase(principal: AdminPrincipal, caseId: string): Promise<void> {
    assertAdminAuthorized(principal, "case:delete");
    const current = await this.cases.getActive(caseId);
    if (!current) throw new Error("ADMIN_CASE_NOT_FOUND");
    await this.cases.deleteActive(caseId);
    await this.changes.create({
      changeVersionId: randomUUID(),
      caseId,
      adminId: principal.adminId,
      action: "delete",
      expectedVersion: current.record.version,
      resultingVersion: null,
      patch: null,
      createdAt: this.now().toISOString(),
    });
  }
}

export function isAdminAuthorizationError(error: unknown): error is AdminAuthorizationError {
  return error instanceof AdminAuthorizationError;
}
