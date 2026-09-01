import { describe, expect, it } from "vitest";

import type { TranscriptRepository } from "@/media/transcription/transcript-service";
import { TranscriptService } from "@/media/transcription/transcript-service";
import { VoiceInputService } from "@/server/services/voice-input-service";

describe("voice input safety boundary", () => {
  it("does not transcribe unscanned audio", async () => {
    let calls = 0;
    const repository: TranscriptRepository = {
      create: async (version) => version,
      get: async () => null,
      listForAudioVersion: async () => [],
      confirm: async (transcriptVersionId, confirmedAt) => ({ transcriptVersionId, confirmedAt }),
      getConfirmation: async () => null,
    };
    const service = new VoiceInputService(
      new TranscriptService(repository),
      { transcribe: async () => { calls += 1; return { locale: "zh-CN", segments: [] }; } },
    );

    await expect(
      service.transcribe({
        sourceAudioVersionId: "audio-v1",
        audioBytes: Buffer.from("synthetic audio"),
        processingState: "quarantined",
        eligibleForAi: false,
      }),
    ).rejects.toThrow("AUDIO_NOT_SAFELY_PARSED");
    expect(calls).toBe(0);
  });

  it("preserves the audio reference when transcription fails", async () => {
    const repository: TranscriptRepository = {
      create: async (version) => version,
      get: async () => null,
      listForAudioVersion: async () => [],
      confirm: async (transcriptVersionId, confirmedAt) => ({ transcriptVersionId, confirmedAt }),
      getConfirmation: async () => null,
    };
    const service = new VoiceInputService(
      new TranscriptService(repository),
      { transcribe: async () => { throw new Error("provider unavailable"); } },
    );

    await expect(
      service.transcribe({
        sourceAudioVersionId: "audio-v1",
        audioBytes: Buffer.from("synthetic audio"),
        processingState: "parsed",
        eligibleForAi: true,
      }),
    ).rejects.toMatchObject({ sourceAudioVersionId: "audio-v1" });
  });
});
