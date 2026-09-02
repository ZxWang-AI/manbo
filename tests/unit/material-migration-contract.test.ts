import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/202608310002_add_material_storage/migration.sql"),
  "utf8",
);

describe("material storage migration contract", () => {
  it("binds completion to the reserved object key and an unexpired reservation", () => {
    expect(migration).toMatch(/v_existing_object_key\s*<>\s*p_object_key/u);
    expect(migration).toMatch(/v_expires_at\s*<=\s*p_now/u);
  });

  it("constrains quota counters and verifies SHA-256 metadata", () => {
    expect(migration).toMatch(/CHECK \("used_bytes" >= 0\)/u);
    expect(migration).toMatch(/CHECK \("reserved_bytes" >= 0\)/u);
    expect(migration).toMatch(/p_sha256\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/u);
  });

  it("treats exact repeated completion as an idempotent retry", () => {
    expect(migration).toMatch(/already_completed/u);
    expect(migration).toMatch(/MATERIAL_COMPLETION_CONFLICT/u);
  });
});
