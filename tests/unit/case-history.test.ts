import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { CaseRecord } from "@/domain/case-record";
import { PrismaCaseRepository } from "@/server/repositories/case-repository";
import { makeCaseRecordFixture } from "../fixtures/case-record";

describe("immutable case history", () => {
  it("reads a validated private snapshot by its immutable version", async () => {
    const snapshot = makeCaseRecordFixture();
    const database = {
      caseRecordRevision: {
        findFirst: vi.fn().mockResolvedValue({ snapshot }),
      },
    } as unknown as PrismaClient;
    const repository = new PrismaCaseRepository(database) as PrismaCaseRepository & {
      getVersionPrivate(
        accountId: string,
        caseId: string,
        version: number,
      ): Promise<CaseRecord | null>;
    };

    await expect(
      repository.getVersionPrivate(snapshot.accountId, snapshot.caseId, 1),
    ).resolves.toEqual(snapshot);
  });
});
