import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/202608310004_add_transcript_versions/migration.sql"),
  "utf8",
);

describe("voice persistence migration contract", () => {
  it("prevents transcript versions from being updated in place", () => {
    expect(migration).toMatch(/manbo_prevent_transcript_update/u);
    expect(migration).toMatch(/BEFORE UPDATE ON "transcript_versions"/u);
    expect(migration).toMatch(/BEFORE UPDATE ON "transcript_confirmations"/u);
    expect(migration).toMatch(/BEFORE UPDATE ON "realtime_voice_events"/u);
  });

  it("stores user confirmation separately from immutable transcript content", () => {
    expect(migration).toMatch(/CREATE TABLE "transcript_confirmations"/u);
    expect(migration).toMatch(/UNIQUE \("transcript_version_id"\)/u);
  });

  it("atomically assigns monotonically increasing realtime event sequences", () => {
    expect(migration).toMatch(/manbo_append_realtime_voice_event/u);
    expect(migration).toMatch(/"next_sequence" = "next_sequence" \+ 1/u);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "realtime_voice_events_session_id_sequence_key"/u);
  });
});
