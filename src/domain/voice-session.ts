export type TranscriptKind = "machine_transcript" | "user_revision" | "realtime_caption";

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptVersion {
  transcriptVersionId: string;
  sourceAudioVersionId: string;
  parentTranscriptVersionId: string | null;
  kind: TranscriptKind;
  text: string;
  locale: string;
  segments: TranscriptSegment[];
  confirmedAt: string | null;
  createdAt: string;
}

export interface TranscriptConfirmation {
  transcriptVersionId: string;
  confirmedAt: string;
}

export interface VoiceSessionConfig {
  sessionId: string;
  accountId: string;
  caseId: string;
  locale: string;
}

export type RealtimeVoiceEventType =
  | "session_started"
  | "user_caption"
  | "assistant_caption"
  | "assistant_interrupted"
  | "muted"
  | "unmuted"
  | "switched_to_text"
  | "session_ended";

export interface RealtimeVoiceEvent {
  sessionId: string;
  sequence: number;
  type: RealtimeVoiceEventType;
  text: string | null;
}
