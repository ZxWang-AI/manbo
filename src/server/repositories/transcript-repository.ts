import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  TranscriptConfirmation,
  TranscriptVersion,
} from "@/domain/voice-session";
import type { TranscriptRepository } from "@/media/transcription/transcript-service";

function toTranscriptVersion(row: {
  transcriptVersionId: string;
  sourceAudioVersionId: string;
  parentTranscriptVersionId: string | null;
  kind: TranscriptVersion["kind"];
  text: string;
  locale: string;
  segments: Prisma.JsonValue;
  createdAt: Date;
}): TranscriptVersion {
  if (!Array.isArray(row.segments)) throw new Error("TRANSCRIPT_SEGMENTS_INVALID");
  return {
    transcriptVersionId: row.transcriptVersionId,
    sourceAudioVersionId: row.sourceAudioVersionId,
    parentTranscriptVersionId: row.parentTranscriptVersionId,
    kind: row.kind,
    text: row.text,
    locale: row.locale,
    segments: row.segments as unknown as TranscriptVersion["segments"],
    confirmedAt: null,
    createdAt: row.createdAt.toISOString(),
  };
}

export class PrismaTranscriptRepository implements TranscriptRepository {
  constructor(
    private readonly database: PrismaClient,
    private readonly accountId: string,
    private readonly caseId: string,
  ) {}

  async create(version: TranscriptVersion): Promise<TranscriptVersion> {
    const source = await this.database.materialObjectVersion.findFirst({
      where: {
        objectVersionId: version.sourceAudioVersionId,
        accountId: this.accountId,
        caseId: this.caseId,
        material: {
          is: {
            accountId: this.accountId,
            caseId: this.caseId,
            status: "uploaded",
            processingState: "parsed",
            deletedAt: null,
          },
        },
      },
      select: { objectVersionId: true, materialId: true, caseId: true, accountId: true },
    });
    if (!source) throw new Error("AUDIO_NOT_SAFELY_PARSED");

    if (version.parentTranscriptVersionId) {
      const parent = await this.database.transcriptVersion.findFirst({
        where: {
          transcriptVersionId: version.parentTranscriptVersionId,
          sourceAudioVersionId: version.sourceAudioVersionId,
          accountId: this.accountId,
          caseId: this.caseId,
          kind: { in: ["machine_transcript", "user_revision"] },
        },
        select: { transcriptVersionId: true },
      });
      if (!parent) throw new Error("TRANSCRIPT_PARENT_INVALID");
    }

    const row = await this.database.transcriptVersion.create({
      data: {
        transcriptVersionId: version.transcriptVersionId,
        sourceAudioVersionId: source.objectVersionId,
        materialId: source.materialId,
        caseId: source.caseId,
        accountId: source.accountId,
        parentTranscriptVersionId: version.parentTranscriptVersionId,
        kind: version.kind,
        text: version.text,
        locale: version.locale,
        segments: JSON.parse(JSON.stringify(version.segments)) as Prisma.InputJsonValue,
        createdAt: new Date(version.createdAt),
      },
    });
    return toTranscriptVersion(row);
  }

  async get(transcriptVersionId: string): Promise<TranscriptVersion | null> {
    const row = await this.database.transcriptVersion.findFirst({
      where: { transcriptVersionId, accountId: this.accountId, caseId: this.caseId },
    });
    return row ? toTranscriptVersion(row) : null;
  }

  async listForAudioVersion(sourceAudioVersionId: string): Promise<TranscriptVersion[]> {
    const rows = await this.database.transcriptVersion.findMany({
      where: { sourceAudioVersionId, accountId: this.accountId, caseId: this.caseId },
      orderBy: [{ createdAt: "asc" }, { transcriptVersionId: "asc" }],
    });
    return rows.map(toTranscriptVersion);
  }

  async confirm(
    transcriptVersionId: string,
    confirmedAt: string,
  ): Promise<TranscriptConfirmation> {
    const revision = await this.database.transcriptVersion.findFirst({
      where: {
        transcriptVersionId,
        accountId: this.accountId,
        caseId: this.caseId,
        kind: "user_revision",
      },
      select: { transcriptVersionId: true },
    });
    if (!revision) throw new Error("TRANSCRIPT_CONFIRMATION_REQUIRES_USER_REVISION");
    const existing = await this.database.transcriptConfirmation.findFirst({
      where: { transcriptVersionId, accountId: this.accountId, caseId: this.caseId },
    });
    const row = existing ?? await this.database.transcriptConfirmation.create({
      data: {
        confirmationId: randomUUID(),
        transcriptVersionId,
        accountId: this.accountId,
        caseId: this.caseId,
        confirmedAt: new Date(confirmedAt),
      },
    });
    return { transcriptVersionId: row.transcriptVersionId, confirmedAt: row.confirmedAt.toISOString() };
  }

  async getConfirmation(transcriptVersionId: string): Promise<TranscriptConfirmation | null> {
    const row = await this.database.transcriptConfirmation.findFirst({
      where: { transcriptVersionId, accountId: this.accountId, caseId: this.caseId },
    });
    return row
      ? { transcriptVersionId: row.transcriptVersionId, confirmedAt: row.confirmedAt.toISOString() }
      : null;
  }
}
