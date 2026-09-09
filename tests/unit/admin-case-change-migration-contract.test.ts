import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("prisma/migrations/202609020006_add_admin_case_change/migration.sql"), "utf8");

describe("administrator case change persistence contract", () => {
  it("stores modify/delete history separately and prevents in-place mutation", () => {
    expect(migration).toMatch(/CREATE TYPE "AdminCaseChangeAction" AS ENUM/u);
    expect(migration).toMatch(/CREATE TABLE "admin_case_change_versions"/u);
    expect(migration).toMatch(/manbo_prevent_admin_case_change_mutation/u);
    expect(migration).toMatch(/BEFORE UPDATE OR DELETE ON "admin_case_change_versions"/u);
  });
});
