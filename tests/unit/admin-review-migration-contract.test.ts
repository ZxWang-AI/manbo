import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/202609020005_add_admin_review/migration.sql"),
  "utf8",
);

describe("administrator review persistence contract", () => {
  it("keeps review labels separate from the case record and limits the status vocabulary", () => {
    expect(migration).toMatch(/CREATE TYPE "AdminReviewStatus" AS ENUM/u);
    expect(migration).toMatch(/CREATE TABLE "admin_review_versions"/u);
    expect(migration).toMatch(/FOREIGN KEY \("case_id"\) REFERENCES "case_records"/u);
  });

  it("prevents review versions from being changed or deleted in place", () => {
    expect(migration).toMatch(/manbo_prevent_admin_review_mutation/u);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "admin_review_versions"/u);
  });
});
