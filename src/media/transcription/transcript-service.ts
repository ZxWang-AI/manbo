import { randomUUID } from "node:crypto";

import type {
  TranscriptConfirmation,
  TranscriptSegment,
  TranscriptVersion,
} from "@/domain/voice-session";

export interface TranscriptRepository {
  create(version: TranscriptVersion): Promise<TranscriptVersion>;
  get(transcriptVersionId: string): Promise<TranscriptVersion | null>;
  listForAudioVersion(sourceAudioVersionId: string): Promise<TranscriptVersion[]>;
  confirm(transcriptVersionId: string, confirmedAt: string): Promise<TranscriptConfirmation>;
  getConfirmation(transcriptVersionId: string): Promise<TranscriptConfirmation | null>;
}

function segmentsToText(segments: readonly TranscriptSegment[]): string {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join("\n");
}

export class TranscriptService {
  constructor(
    private readonly repository: TranscriptRepository,
    private readonly generateId: () => string = randomUUID,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  createMachineTranscript(input: {
    sourceAudioVersionId: string;
    locale: string;
    segments: TranscriptSegment[];
  }): Promise<TranscriptVersion> {
    return this.repository.create({
      transcriptVersionId: this.generateId(),
      sourceAudioVersionId: input.sourceAudioVersionId,
      parentTranscriptVersionId: null,
      kind: "machine_transcript",
      text: segmentsToText(input.segments),
      locale: input.locale,
      segments: structuredClone(input.segments),
      confirmedAt: null,
      createdAt: this.now(),
    });
  }

  async revise(parentTranscriptVersionId: string, text: string): Promise<TranscriptVersion> {
    const parent = await this.repository.get(parentTranscriptVersionId);
    if (!parent || !["machine_transcript", "user_revision"].includes(parent.kind)) {
      throw new Error("TRANSCRIPT_PARENT_INVALID");
    }
    const normalized = text.trim();
    if (!normalized) throw new Error("TRANSCRIPT_TEXT_REQUIRED");
    return this.repository.create({
      transcriptVersionId: this.generateId(),
      sourceAudioVersionId: parent.sourceAudioVersionId,
      parentTranscriptVersionId,
      kind: "user_revision",
      text: normalized,
      locale: parent.locale,
      segments: [],
      confirmedAt: null,
      createdAt: this.now(),
    });
  }

  async confirm(transcriptVersionId: string): Promise<TranscriptConfirmation> {
    const version = await this.repository.get(transcriptVersionId);
    if (!version || version.kind !== "user_revision") {
      throw new Error("TRANSCRIPT_CONFIRMATION_REQUIRES_USER_REVISION");
    }
    return this.repository.confirm(transcriptVersionId, this.now());
  }

  async toAiContentRef(transcriptVersionId: string): Promise<string | null> {
    const [version, confirmation] = await Promise.all([
      this.repository.get(transcriptVersionId),
      this.repository.getConfirmation(transcriptVersionId),
    ]);
    return version?.kind === "user_revision" && confirmation
      ? `transcript:${transcriptVersionId}`
      : null;
  }
}
