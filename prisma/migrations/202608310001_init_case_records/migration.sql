CREATE TYPE "CaseVisibility" AS ENUM ('private');
CREATE TYPE "CaseLifecycle" AS ENUM ('draft', 'confirmed', 'exported', 'deleted');
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'system');
CREATE TYPE "AuditAction" AS ENUM ('create', 'update', 'export', 'delete', 'consent_change');
CREATE TYPE "CleanupStatus" AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TABLE "accounts" (
    "account_id" CHAR(32) NOT NULL,
    "alias" VARCHAR(80) NOT NULL,
    "alias_hash" CHAR(64) NOT NULL,
    "recovery_secret_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("account_id")
);

CREATE TABLE "auth_sessions" (
    "session_id_hash" CHAR(64) NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("session_id_hash")
);

CREATE TABLE "recovery_throttles" (
    "alias_hash" CHAR(64) NOT NULL,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "recovery_throttles_pkey" PRIMARY KEY ("alias_hash")
);

CREATE TABLE "case_records" (
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "schema_version" VARCHAR(16) NOT NULL,
    "visibility" "CaseVisibility" NOT NULL DEFAULT 'private',
    "lifecycle" "CaseLifecycle" NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "jurisdiction" JSONB NOT NULL,
    "facts" JSONB NOT NULL,
    "timeline" JSONB NOT NULL,
    "ilo_indicators" JSONB NOT NULL,
    "elements" JSONB NOT NULL,
    "evidence_coverage" JSONB NOT NULL,
    "legal_navigation" JSONB NOT NULL,
    "referrals" JSONB NOT NULL,
    "safety_flags" JSONB NOT NULL,
    "source_trace" JSONB NOT NULL,
    "consent" JSONB NOT NULL,
    "ai_review_status" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "case_records_pkey" PRIMARY KEY ("case_id"),
    CONSTRAINT "case_records_positive_version" CHECK ("version" > 0),
    CONSTRAINT "case_records_deleted_invariant" CHECK (
      ("lifecycle" = 'deleted' AND "deleted_at" IS NOT NULL)
      OR ("lifecycle" <> 'deleted' AND "deleted_at" IS NULL)
    )
);

CREATE TABLE "case_record_revisions" (
    "revision_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "case_record_revisions_pkey" PRIMARY KEY ("revision_id"),
    CONSTRAINT "case_record_revisions_positive_version" CHECK ("version" > 0)
);

CREATE TABLE "conversation_messages" (
    "message_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("message_id")
);

CREATE TABLE "consent_events" (
    "consent_event_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "consent_version" VARCHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("consent_event_id")
);

CREATE TABLE "audit_events" (
    "audit_event_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "case_id" UUID,
    "action" "AuditAction" NOT NULL,
    "metadata" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("audit_event_id")
);

CREATE TABLE "cleanup_jobs" (
    "cleanup_job_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "case_id" UUID,
    "target" VARCHAR(64) NOT NULL,
    "status" "CleanupStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    CONSTRAINT "cleanup_jobs_pkey" PRIMARY KEY ("cleanup_job_id")
);

CREATE UNIQUE INDEX "accounts_alias_key" ON "accounts"("alias");
CREATE UNIQUE INDEX "accounts_alias_hash_key" ON "accounts"("alias_hash");
CREATE INDEX "accounts_created_at_idx" ON "accounts"("created_at");
CREATE INDEX "auth_sessions_idle_expires_at_idx" ON "auth_sessions"("idle_expires_at");
CREATE INDEX "auth_sessions_absolute_expires_at_idx" ON "auth_sessions"("absolute_expires_at");
CREATE INDEX "recovery_throttles_blocked_until_idx" ON "recovery_throttles"("blocked_until");
CREATE UNIQUE INDEX "case_records_case_id_account_id_key" ON "case_records"("case_id", "account_id");
CREATE INDEX "case_records_account_id_lifecycle_idx" ON "case_records"("account_id", "lifecycle");
CREATE INDEX "case_records_created_at_idx" ON "case_records"("created_at");
CREATE INDEX "case_records_updated_at_idx" ON "case_records"("updated_at");
CREATE UNIQUE INDEX "case_record_revisions_case_id_version_key" ON "case_record_revisions"("case_id", "version");
CREATE INDEX "case_record_revisions_case_id_account_id_idx" ON "case_record_revisions"("case_id", "account_id");
CREATE INDEX "case_record_revisions_created_at_idx" ON "case_record_revisions"("created_at");
CREATE INDEX "conversation_messages_case_id_account_id_idx" ON "conversation_messages"("case_id", "account_id");
CREATE INDEX "conversation_messages_created_at_idx" ON "conversation_messages"("created_at");
CREATE INDEX "consent_events_case_id_account_id_idx" ON "consent_events"("case_id", "account_id");
CREATE INDEX "consent_events_created_at_idx" ON "consent_events"("created_at");
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");
CREATE INDEX "cleanup_jobs_status_idx" ON "cleanup_jobs"("status");
CREATE INDEX "cleanup_jobs_created_at_idx" ON "cleanup_jobs"("created_at");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_records" ADD CONSTRAINT "case_records_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "case_record_revisions" ADD CONSTRAINT "case_record_revisions_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cleanup_jobs" ADD CONSTRAINT "cleanup_jobs_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("account_id") ON DELETE RESTRICT ON UPDATE CASCADE;
