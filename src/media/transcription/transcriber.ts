import type { TranscriptSegment } from "@/domain/voice-session";

export interface TranscriptionResult {
  locale: string;
  segments: TranscriptSegment[];
}

export interface Transcriber {
  transcribe(audioBytes: Uint8Array): Promise<TranscriptionResult>;
}
