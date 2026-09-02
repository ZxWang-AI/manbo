import { describe, expect, it } from "vitest";

import {
  TranscriptService,
  type TranscriptRepository,
} from "@/media/transcription/transcript-service";
import type { RealtimeVoiceEvent, TranscriptVersion } from "@/domain/voice-session";
import {
  InMemoryRealtimeVoiceGateway,
  type RealtimeVoiceEventRepository,
} from "@/media/realtime/realtime-voice-gateway";

function makeTranscriptRepository() {
  const versions = new Map<string, TranscriptVersion>();
  const confirmations = new Map<string, string>();
  const repository: TranscriptRepository = {
    create: async (version) => {
      versions.set(version.transcriptVersionId, structuredClone(version));
      return structuredClone(version);
    },
    get: async (id) => structuredClone(versions.get(id) ?? null),
    listForAudioVersion: async (id) =>
      [...versions.values()]
        .filter((version) => version.sourceAudioVersionId === id)
        .map((version) => structuredClone(version)),
    confirm: async (transcriptVersionId, confirmedAt) => {
      confirmations.set(transcriptVersionId, confirmedAt);
      return { transcriptVersionId, confirmedAt };
    },
    getConfirmation: async (transcriptVersionId) => {
      const confirmedAt = confirmations.get(transcriptVersionId);
      return confirmedAt ? { transcriptVersionId, confirmedAt } : null;
    },
  };
  return { repository, versions };
}

describe("immutable transcript versions", () => {
  it("creates a user revision without overwriting the machine transcript", async () => {
    let sequence = 0;
    const state = makeTranscriptRepository();
    const service = new TranscriptService(
      state.repository,
      () => `transcript-${++sequence}`,
      () => "2026-08-31T15:00:00.000Z",
    );
    const machine = await service.createMachineTranscript({
      sourceAudioVersionId: "audio-v1",
      locale: "zh-CN",
      segments: [{ startMs: 0, endMs: 1200, text: "机器转写" }],
    });

    const revision = await service.revise(machine.transcriptVersionId, "用户修订内容");

    expect(revision.parentTranscriptVersionId).toBe(machine.transcriptVersionId);
    expect(revision.kind).toBe("user_revision");
    await expect(state.repository.get(machine.transcriptVersionId)).resolves.toEqual(machine);
  });

  it("only returns a confirmed revision as an AI content reference", async () => {
    let sequence = 0;
    const state = makeTranscriptRepository();
    const service = new TranscriptService(state.repository, () => `transcript-${++sequence}`);
    const machine = await service.createMachineTranscript({
      sourceAudioVersionId: "audio-v1",
      locale: "zh-CN",
      segments: [{ startMs: 0, endMs: 500, text: "机器转写" }],
    });

    await expect(service.toAiContentRef(machine.transcriptVersionId)).resolves.toBeNull();
    const revision = await service.revise(machine.transcriptVersionId, "用户确认内容");
    const confirmed = await service.confirm(revision.transcriptVersionId);
    expect(confirmed.transcriptVersionId).toBe(revision.transcriptVersionId);
    await expect(service.toAiContentRef(revision.transcriptVersionId)).resolves.toBe(
      `transcript:${revision.transcriptVersionId}`,
    );
  });

  it("cannot confirm a machine transcript or a client-forged transcript object", async () => {
    const state = makeTranscriptRepository();
    const service = new TranscriptService(state.repository);
    const machine = await service.createMachineTranscript({
      sourceAudioVersionId: "audio-v1",
      locale: "zh-CN",
      segments: [{ startMs: 0, endMs: 500, text: "机器转写" }],
    });

    await expect(service.confirm(machine.transcriptVersionId)).rejects.toThrow(
      "TRANSCRIPT_CONFIRMATION_REQUIRES_USER_REVISION",
    );
    await expect(service.toAiContentRef("forged")).resolves.toBeNull();
  });

  it("rejects revisions that do not descend from a machine or user transcript", async () => {
    const state = makeTranscriptRepository();
    const service = new TranscriptService(state.repository);
    await state.repository.create({
      transcriptVersionId: "caption-a",
      sourceAudioVersionId: "audio-v1",
      parentTranscriptVersionId: null,
      kind: "realtime_caption",
      text: "字幕",
      locale: "zh-CN",
      segments: [],
      confirmedAt: null,
      createdAt: "2026-08-31T15:00:00.000Z",
    });

    await expect(service.revise("caption-a", "修改")).rejects.toThrow("TRANSCRIPT_PARENT_INVALID");
  });
});

describe("realtime voice events", () => {
  it("interrupts realtime output while preserving synchronized captions", async () => {
    const events: RealtimeVoiceEvent[] = [];
    const repository: RealtimeVoiceEventRepository = {
      append: async (event) => {
        events.push(event);
        return event;
      },
      list: async (sessionId, afterSequence = 0) =>
        events.filter((event) => event.sessionId === sessionId && event.sequence > afterSequence),
    };
    const gateway = new InMemoryRealtimeVoiceGateway(repository);
    await gateway.start({ sessionId: "voice-a", accountId: "acct-a", caseId: "case-a", locale: "zh-CN" });
    await gateway.appendCaption("voice-a", "assistant_caption", "正在回复");

    await gateway.interrupt("voice-a");

    await expect(repository.list("voice-a")).resolves.toEqual([
      expect.objectContaining({ sequence: 1, type: "session_started" }),
      expect.objectContaining({ sequence: 2, type: "assistant_caption", text: "正在回复" }),
      expect.objectContaining({ sequence: 3, type: "assistant_interrupted" }),
    ]);
  });

  it("reconnects from a sequence cursor without duplicating captions", async () => {
    const events: RealtimeVoiceEvent[] = [];
    const repository: RealtimeVoiceEventRepository = {
      append: async (event) => {
        if (!events.some((stored) => stored.sessionId === event.sessionId && stored.sequence === event.sequence)) {
          events.push(event);
        }
        return event;
      },
      list: async (sessionId, afterSequence = 0) =>
        events.filter((event) => event.sessionId === sessionId && event.sequence > afterSequence),
    };
    const gateway = new InMemoryRealtimeVoiceGateway(repository);
    await gateway.start({ sessionId: "voice-a", accountId: "acct-a", caseId: "case-a", locale: "zh-CN" });
    await gateway.appendCaption("voice-a", "user_caption", "第一句");
    await gateway.appendCaption("voice-a", "assistant_caption", "第二句");

    await expect(gateway.reconnect("voice-a", 2)).resolves.toEqual([
      expect.objectContaining({ sequence: 3, text: "第二句" }),
    ]);
  });

  it("records mute and switch-to-text transitions without discarding captions", async () => {
    const events: RealtimeVoiceEvent[] = [];
    const repository: RealtimeVoiceEventRepository = {
      append: async (event) => {
        events.push(event);
        return event;
      },
      list: async (sessionId, afterSequence = 0) =>
        events.filter((event) => event.sessionId === sessionId && event.sequence > afterSequence),
    };
    const gateway = new InMemoryRealtimeVoiceGateway(repository);
    await gateway.start({ sessionId: "voice-a", accountId: "acct-a", caseId: "case-a", locale: "zh-CN" });
    await gateway.appendCaption("voice-a", "user_caption", "保留这句");

    await gateway.setMuted("voice-a", true);
    await gateway.switchToText("voice-a");

    await expect(repository.list("voice-a")).resolves.toEqual([
      expect.objectContaining({ sequence: 1, type: "session_started" }),
      expect.objectContaining({ sequence: 2, type: "user_caption", text: "保留这句" }),
      expect.objectContaining({ sequence: 3, type: "muted" }),
      expect.objectContaining({ sequence: 4, type: "switched_to_text" }),
    ]);
  });
});
