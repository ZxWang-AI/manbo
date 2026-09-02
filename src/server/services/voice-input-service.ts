import type { MaterialProcessingState } from "@/domain/material";
import type { TranscriptVersion } from "@/domain/voice-session";
import type { Transcriber } from "@/media/transcription/transcriber";
import { TranscriptService } from "@/media/transcription/transcript-service";

export class VoiceTranscriptionFailure extends Error {
  constructor(
    readonly sourceAudioVersionId: string,
    cause: unknown,
  ) {
    super("VOICE_TRANSCRIPTION_FAILED", { cause });
    this.name = "VoiceTranscriptionFailure";
  }
}

export class VoiceInputService {
  constructor(
    private readonly transcripts: TranscriptService,
    private readonly transcriber: Transcriber,
  ) {}

  async transcribe(input: {
    sourceAudioVersionId: string;
    audioBytes: Uint8Array;
    processingState: MaterialProcessingState;
    eligibleForAi: boolean;
  }): Promise<TranscriptVersion> {
    if (input.processingState !== "parsed" || !input.eligibleForAi) {
      throw new Error("AUDIO_NOT_SAFELY_PARSED");
    }
    try {
      const result = await this.transcriber.transcribe(input.audioBytes);
      return this.transcripts.createMachineTranscript({
        sourceAudioVersionId: input.sourceAudioVersionId,
        locale: result.locale,
        segments: result.segments,
      });
    } catch (error) {
      throw new VoiceTranscriptionFailure(input.sourceAudioVersionId, error);
    }
  }
}
