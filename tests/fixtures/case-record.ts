import type { CaseRecord } from "@/domain/case-record";

/** A complete, qualitative-only record used by domain contract tests. */
export function makeCaseRecordFixture(): CaseRecord {
  const sourceTrace = [
    {
      kind: "conversation" as const,
      id: "msg-1",
      quote: "我被要求在工厂工作。",
    },
  ];

  return {
    schemaVersion: "1.0",
    caseId: "case-test-001",
    accountId: "account-test-001",
    visibility: "private",
    lifecycle: "draft",
    version: 1,
    jurisdiction: {
      incidentCountry: "CN",
      userCountry: "CN",
      productDestination: "EU",
    },
    facts: [
      {
        id: "fact-1",
        field: "work_description",
        value: "在工厂包装产品",
        sourceMessageIds: ["msg-1"],
        sourceQuote: "我被要求在工厂工作。",
        certainty: "user_stated",
      },
    ],
    timeline: [
      {
        id: "timeline-1",
        occurredAt: "2026-08-20T08:00:00.000Z",
        description: "开始工作",
        sourceMessageIds: ["msg-1"],
      },
    ],
    iloIndicators: [
      {
        indicatorId: 1,
        status: "insufficient",
        basis: sourceTrace,
        missing: ["招聘过程详情"],
      },
    ],
    elements: {
      workOrService: { status: "covered", basis: sourceTrace, missing: [] },
      involuntary: { status: "unknown", basis: [], missing: ["是否可以自由离开"] },
      penaltyOrThreat: { status: "partial", basis: sourceTrace, missing: ["威胁的具体内容"] },
    },
    evidenceCoverage: [
      {
        topic: "work_relationship",
        status: "partial",
        explanation: "有工作描述，但缺少合同材料。",
        sourceMessageIds: ["msg-1"],
        safeOptions: ["在安全情况下保存合同副本"],
      },
    ],
    legalNavigation: [
      {
        jurisdiction: "CN",
        sourceId: "source-ilo-forced-labour",
        status: "needs_review",
        premise: "需要结合当地法律和事实进一步核对。",
        lastVerified: "2026-08-01",
        stale: false,
        officialUrl: "https://www.ilo.org/",
      },
    ],
    referrals: [
      {
        sourceId: "referral-1",
        name: "安全法律援助渠道",
        officialUrl: "https://example.org/referral",
        anonymity: "unknown",
        feedback: "unknown",
        userSteps: ["阅读渠道说明", "在安全情况下自行联系"],
      },
    ],
    safetyFlags: [],
    sourceTrace,
    consent: {
      version: "v1",
      saveCase: true,
      externalSharing: false,
      confirmedFieldPaths: ["/facts/0"],
    },
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
  };
}
