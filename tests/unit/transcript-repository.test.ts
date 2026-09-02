import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { PrismaTranscriptRepository } from "@/server/repositories/transcript-repository";

describe("transcript repository", () => {
  it("creates a transcript inside the owning private case scope", async () => {
    const create = vi.fn().mockResolvedValue({
      transcriptVersionId: "a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1",
      sourceAudioVersionId: "ff75e185-aa30-4ce6-84ff-b30ae375572f",
      parentTranscriptVersionId: null,
      kind: "machine_transcript",
      text: "机器转写",
      locale: "zh-CN",
      segments: [],
      createdAt: new Date("2026-08-31T15:00:00.000Z"),
    });
    const database = {
      materialObjectVersion: { findFirst: vi.fn().mockResolvedValue({
        objectVersionId: "ff75e185-aa30-4ce6-84ff-b30ae375572f",
        materialId: "2a816d00-870e-49c6-b228-f54564297e3c",
        caseId: "d393a0b3-34b8-46b2-b845-dd5ca45e004a",
        accountId: "a".repeat(32),
      }) },
      transcriptVersion: { create },
    } as unknown as PrismaClient;
    const repository = new PrismaTranscriptRepository(database, "a".repeat(32), "d393a0b3-34b8-46b2-b845-dd5ca45e004a");

    await repository.create({
      transcriptVersionId: "a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1",
      sourceAudioVersionId: "ff75e185-aa30-4ce6-84ff-b30ae375572f",
      parentTranscriptVersionId: null,
      kind: "machine_transcript",
      text: "机器转写",
      locale: "zh-CN",
      segments: [],
      confirmedAt: null,
      createdAt: "2026-08-31T15:00:00.000Z",
    });

    expect(create).toHaveBeenCalledOnce();
  });

  it("refuses confirmation when the revision is not owned or not a user revision", async () => {
    const database = {
      transcriptVersion: { findFirst: vi.fn().mockResolvedValue(null) },
      transcriptConfirmation: { create: vi.fn() },
    } as unknown as PrismaClient;
    const repository = new PrismaTranscriptRepository(database, "a".repeat(32), "d393a0b3-34b8-46b2-b845-dd5ca45e004a");

    await expect(
      repository.confirm("a4a5fe5a-caf7-4aa8-94cb-1ab20b6f60d1", "2026-08-31T15:00:00.000Z"),
    ).rejects.toThrow("TRANSCRIPT_CONFIRMATION_REQUIRES_USER_REVISION");
  });
});
