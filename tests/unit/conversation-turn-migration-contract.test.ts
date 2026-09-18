import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/202609180011_add_conversation_turn_ledger/migration.sql"),
  "utf8",
);

describe("conversation turn ledger migration contract", () => {
  it("creates a bounded turn ledger with rollout timeouts and scoped uniqueness", () => {
    expect(migration).toMatch(/BEGIN;/u);
    expect(migration).toMatch(/SET LOCAL lock_timeout = '10s';/u);
    expect(migration).toMatch(/SET LOCAL statement_timeout = '10min';/u);
    expect(migration).toMatch(/CREATE TABLE "conversation_turns"/u);
    expect(migration).toMatch(/"turn_id" UUID NOT NULL/u);
    expect(migration).toMatch(/"request_hash" CHAR\(64\) NOT NULL/u);
    expect(migration).toMatch(/"result_snapshot" JSONB/u);
    expect(migration).toMatch(/"response_snapshot" JSONB/u);
    expect(migration).toMatch(/UNIQUE \("account_id", "case_id", "turn_id"\)/u);
    expect(migration).toMatch(/CHECK \("base_case_version" > 0\)/u);
    expect(migration).toMatch(/COMMIT;/u);
  });

  it("keeps historical messages nullable and enforces one user/assistant per turn", () => {
    expect(migration).toMatch(/ADD COLUMN "turn_id" UUID/u);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "conversation_messages_turn_role_key"/u);
    expect(migration).toMatch(/WHERE "turn_id" IS NOT NULL/u);
    expect(migration).toMatch(/ON "conversation_messages"\s*\("turn_id", "role"\)/u);
    expect(migration).toMatch(/ALTER TABLE "conversation_messages"\s+ADD COLUMN "turn_id"/u);
    expect(migration).toMatch(/ALTER TABLE "conversation_messages"\s+ADD CONSTRAINT "conversation_messages_turn_scope_fkey"/u);
    expect(migration).not.toMatch(/UPDATE "conversation_messages"[\s\S]*SET "turn_id"/u);
  });

  it("retains ownership constraints and does not remove the message sequence trigger", () => {
    expect(migration).toMatch(/FOREIGN KEY \("case_id", "account_id"\)/u);
    expect(migration).toMatch(/REFERENCES "case_records"\s*\("case_id", "account_id"\)/u);
    expect(migration).toMatch(/manbo_assign_conversation_message_sequence/u);
    expect(migration).toMatch(/CREATE INDEX "conversation_turns_case_lookup"/u);
  });
});
