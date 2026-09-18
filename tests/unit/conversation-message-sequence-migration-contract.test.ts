import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve("prisma/migrations/202609170010_add_conversation_message_sequence/migration.sql"),
  "utf8",
);

describe("conversation message sequence migration contract", () => {
  it("atomically backfills a positive case-local sequence and enforces uniqueness", () => {
    expect(migration).toMatch(/BEGIN;/u);
    expect(migration).toMatch(/SET LOCAL lock_timeout = '10s';/u);
    expect(migration).toMatch(/SET LOCAL statement_timeout = '10min';/u);
    expect(migration).toMatch(/LOCK TABLE "conversation_messages" IN ACCESS EXCLUSIVE MODE;/u);
    expect(migration).toMatch(/ROW_NUMBER\(\) OVER \(\s*PARTITION BY "case_id", "account_id"\s*ORDER BY "created_at", "message_id"\s*\)/u);
    expect(migration).toMatch(/ALTER COLUMN "message_sequence" SET NOT NULL/u);
    expect(migration).toMatch(/CHECK \("message_sequence" > 0\)/u);
    expect(migration).toMatch(/UNIQUE INDEX[\s\S]*\("case_id", "account_id", "message_sequence"\)/u);
    expect(migration).toMatch(/COMMIT;/u);

    const lockTimeoutOffset = migration.indexOf("SET LOCAL lock_timeout");
    const statementTimeoutOffset = migration.indexOf("SET LOCAL statement_timeout");
    const tableLockOffset = migration.indexOf(
      'LOCK TABLE "conversation_messages" IN ACCESS EXCLUSIVE MODE',
    );
    expect(lockTimeoutOffset).toBeGreaterThan(-1);
    expect(statementTimeoutOffset).toBeGreaterThan(lockTimeoutOffset);
    expect(tableLockOffset).toBeGreaterThan(statementTimeoutOffset);
  });

  it("keeps pre-sequence application instances compatible during rollout", () => {
    expect(migration).toMatch(/CREATE FUNCTION manbo_assign_conversation_message_sequence\(\)/u);
    expect(migration).toMatch(
      /SELECT "case_id"[\s\S]*FROM "case_records"[\s\S]*FOR UPDATE/u,
    );
    expect(migration).toMatch(
      /SELECT COALESCE\(MAX\("message_sequence"\), 0\) \+ 1[\s\S]*INTO NEW\."message_sequence"/u,
    );
    expect(migration).toMatch(
      /CREATE TRIGGER manbo_assign_conversation_message_sequence[\s\S]*BEFORE INSERT ON "conversation_messages"[\s\S]*WHEN \(NEW\."message_sequence" IS NULL\)/u,
    );
    expect(migration).toMatch(
      /old trigger-assigned writes with new application-assigned writes/u,
    );

    const triggerOffset = migration.indexOf(
      "CREATE TRIGGER manbo_assign_conversation_message_sequence",
    );
    const notNullOffset = migration.indexOf(
      'ALTER COLUMN "message_sequence" SET NOT NULL',
    );
    expect(triggerOffset).toBeGreaterThan(-1);
    expect(notNullOffset).toBeGreaterThan(triggerOffset);
  });
});
