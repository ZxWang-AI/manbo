BEGIN;

-- Fail and roll back instead of allowing a queued ACCESS EXCLUSIVE lock to
-- amplify a long-running transaction into an unbounded conversation outage.
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '10min';

-- Expand-contract compatibility migration. The exclusive table lock protects the
-- backfill itself. A trigger installed before NOT NULL keeps an older application
-- version (which omits message_sequence) writable after this transaction commits.
LOCK TABLE "conversation_messages" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "conversation_messages"
  ADD COLUMN "message_sequence" INTEGER;

WITH ranked_messages AS (
  SELECT
    "message_id",
    ROW_NUMBER() OVER (
      PARTITION BY "case_id", "account_id"
      ORDER BY "created_at", "message_id"
    )::INTEGER AS "message_sequence"
  FROM "conversation_messages"
)
UPDATE "conversation_messages" AS messages
SET "message_sequence" = ranked_messages."message_sequence"
FROM ranked_messages
WHERE messages."message_id" = ranked_messages."message_id";

CREATE FUNCTION manbo_assign_conversation_message_sequence()
RETURNS trigger AS $$
DECLARE
  locked_case_id UUID;
BEGIN
  -- Use the same parent-row lock as the application repository. This serializes
  -- old trigger-assigned writes with new application-assigned writes.
  SELECT "case_id"
  INTO locked_case_id
  FROM "case_records"
  WHERE "case_id" = NEW."case_id"
    AND "account_id" = NEW."account_id"
    AND "visibility" = 'private'
    AND "deleted_at" IS NULL
  FOR UPDATE;

  IF locked_case_id IS NULL THEN
    RAISE EXCEPTION 'Private case is unavailable for conversation message append';
  END IF;

  SELECT COALESCE(MAX("message_sequence"), 0) + 1
  INTO NEW."message_sequence"
  FROM "conversation_messages"
  WHERE "case_id" = NEW."case_id"
    AND "account_id" = NEW."account_id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER manbo_assign_conversation_message_sequence
BEFORE INSERT ON "conversation_messages"
FOR EACH ROW
WHEN (NEW."message_sequence" IS NULL)
EXECUTE FUNCTION manbo_assign_conversation_message_sequence();

ALTER TABLE "conversation_messages"
  ALTER COLUMN "message_sequence" SET NOT NULL,
  ADD CONSTRAINT "conversation_messages_positive_sequence"
    CHECK ("message_sequence" > 0);

CREATE UNIQUE INDEX "conversation_messages_case_id_account_id_message_sequence_key"
  ON "conversation_messages"("case_id", "account_id", "message_sequence");

COMMIT;
