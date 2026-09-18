import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/202609140009_persist_material_derivative_content/migration.sql"),
  "utf8",
);

describe("encrypted material derivative migration contract", () => {
  it("adds an application-encrypted JSONB payload without a plaintext column", () => {
    expect(migration).toMatch(/ADD COLUMN\s+"encrypted_content"\s+JSONB/u);
    expect(migration).not.toMatch(/ADD COLUMN\s+"text"/iu);
  });
});
