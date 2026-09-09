import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("material processing job migration contract", () => {
  it("defines durable leases, retry timing, and active-job deduplication", () => {
    const migration = readFileSync(
      "prisma/migrations/202609040008_add_material_processing_jobs/migration.sql",
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "MaterialProcessingJobStatus"');
    expect(migration).toContain('"available_at" TIMESTAMPTZ(3) NOT NULL');
    expect(migration).toContain('"lease_until" TIMESTAMPTZ(3)');
    expect(migration).toContain('"max_attempts" INTEGER NOT NULL DEFAULT 5');
    expect(migration).toMatch(/CREATE UNIQUE INDEX[\s\S]+WHERE "status" IN \('pending', 'processing'\)/u);
  });
});
