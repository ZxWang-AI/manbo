BEGIN;

-- Turn reservation/finalization is a bounded extension of migration 10. Fail
-- quickly on a queued lock rather than converting rollout into an outage.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';

CREATE TYPE "ConversationTurnOperation" AS ENUM ('send', 'retry');
CREATE TYPE "ConversationTurnStatus" AS ENUM (
  'reserved',
  'processing',
  'result_ready',
  'completed',
  'conflict',
  'failed',
  'cancelled'
);

CREATE TABLE "conversation_turns" (
  "turn_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "case_id" UUID NOT NULL,
  "operation" "ConversationTurnOperation" NOT NULL,
  "status" "ConversationTurnStatus" NOT NULL,
  "source_user_message_id" UUID,
  "user_message_id" UUID,
  "base_case_version" INTEGER NOT NULL,
  "request_hash" CHAR(64) NOT NULL,
  "result_snapshot" JSONB,
  "response_snapshot" JSONB,
  "assistant_message_id" UUID,
  "case_version_after" INTEGER,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lease_until" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("turn_id"),
  CONSTRAINT "conversation_turns_scope_turn_key" UNIQUE ("account_id", "case_id", "turn_id"),
  CONSTRAINT "conversation_turns_base_version_positive" CHECK ("base_case_version" > 0),
  CONSTRAINT "conversation_turns_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "conversation_turns_case_version_after_positive" CHECK ("case_version_after" IS NULL OR "case_version_after" > 0),
  CONSTRAINT "conversation_turns_request_hash_hex" CHECK ("request_hash" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "conversation_turns_case_lookup"
  ON "conversation_turns" ("case_id", "account_id", "status");
CREATE INDEX "conversation_turns_lease_lookup"
  ON "conversation_turns" ("lease_until");

ALTER TABLE "conversation_turns"
  ADD CONSTRAINT "conversation_turns_case_id_account_id_fkey"
    FOREIGN KEY ("case_id", "account_id")
    REFERENCES "case_records" ("case_id", "account_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "conversation_turns_account_id_fkey"
    FOREIGN KEY ("account_id")
    REFERENCES "accounts" ("account_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Historical messages remain NULL. New writers opt into the turn ledger; the
-- migration intentionally does not invent turn IDs for old rows.
ALTER TABLE "conversation_messages"
  ADD COLUMN "turn_id" UUID;

CREATE INDEX "conversation_messages_turn_lookup"
  ON "conversation_messages" ("turn_id");

CREATE UNIQUE INDEX "conversation_messages_turn_role_key"
  ON "conversation_messages" ("turn_id", "role")
  WHERE "turn_id" IS NOT NULL;

ALTER TABLE "conversation_messages"
  ADD CONSTRAINT "conversation_messages_turn_scope_fkey"
    FOREIGN KEY ("turn_id", "case_id", "account_id")
    REFERENCES "conversation_turns" ("turn_id", "case_id", "account_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "conversation_turns_assistant_message_key"
  ON "conversation_turns" ("assistant_message_id")
  WHERE "assistant_message_id" IS NOT NULL;

-- Keep migration 10's manbo_assign_conversation_message_sequence trigger in
-- place for old application writers during the bounded rolling deployment.

COMMIT;
