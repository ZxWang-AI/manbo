import { describe, expect, it } from "vitest";

import { makeCaseRecordFixture } from "../fixtures/case-record";
import { createConversationInitialData } from "@/components/chat/conversation-resume";
import { recoverPendingTurn } from "@/components/chat/conversation";

describe("conversation resume mapping", () => {
  it("hydrates a saved record and immutable messages into the chat seed", () => {
    const record = makeCaseRecordFixture();
    const result = createConversationInitialData({
      case: record,
      messages: [
        { messageId: "m-1", role: "user", content: "补充内容", createdAt: "2026-09-14T01:00:00.000Z" },
        { messageId: "m-2", role: "assistant", content: "已整理", createdAt: "2026-09-14T01:01:00.000Z" },
      ],
    });

    expect(result).toEqual({
      caseId: record.caseId,
      caseVersion: record.version,
      draftPatch: {
        jurisdiction: record.jurisdiction,
        facts: record.facts,
        timeline: record.timeline,
        iloIndicators: record.iloIndicators,
        elements: record.elements,
        evidenceCoverage: record.evidenceCoverage,
        legalNavigation: record.legalNavigation,
        referrals: record.referrals,
        safetyFlags: record.safetyFlags,
        sourceTrace: record.sourceTrace,
        consent: record.consent,
        lifecycle: record.lifecycle,
        ...(record.aiReviewStatus ? { aiReviewStatus: record.aiReviewStatus } : {}),
      },
      messages: [
        {
          id: "m-1",
          role: "user",
          content: "补充内容",
          persistedMessageId: "m-1",
        },
        { id: "m-2", role: "assistant", content: "已整理" },
      ],
    });
    expect(result.messages[1]).not.toHaveProperty("persistedMessageId");
  });

  it("preserves safe recoverable turn metadata without exposing fingerprints", () => {
    const record = makeCaseRecordFixture();
    const result = createConversationInitialData({
      case: record,
      messages: [{ messageId: "m-1", role: "user", content: "处理中", turnId: "turn-1", createdAt: "2026-09-14T01:00:00.000Z" }],
      turns: [{
        turnId: "turn-1",
        operation: "send",
        status: "processing",
        sourceUserMessageId: null,
        userMessageId: "m-1",
        assistantMessageId: null,
        caseVersionAfter: null,
        createdAt: "2026-09-14T01:00:00.000Z",
        updatedAt: "2026-09-14T01:00:01.000Z",
      }],
    });

    expect(result.messages[0]).toMatchObject({ id: "m-1", persistedMessageId: "m-1", turnId: "turn-1" });
    expect(result.turns?.[0]).toMatchObject({ turnId: "turn-1", status: "processing" });
    expect(JSON.stringify(result)).not.toContain("requestHash");
  });

  it("recovers a reserved turn when its user message is already persisted", () => {
    const initialData = createConversationInitialData({
      case: makeCaseRecordFixture(),
      messages: [{ messageId: "m-1", role: "user", content: "已预约", createdAt: "2026-09-14T01:00:00.000Z" }],
      turns: [{
        turnId: "turn-reserved",
        operation: "send",
        status: "reserved",
        sourceUserMessageId: null,
        userMessageId: "m-1",
        assistantMessageId: null,
        caseVersionAfter: null,
        createdAt: "2026-09-14T01:00:00.000Z",
        updatedAt: "2026-09-14T01:00:01.000Z",
      }],
    });

    expect(recoverPendingTurn(initialData)).toEqual({
      turnId: "turn-reserved",
      content: "已预约",
    });
  });
});
