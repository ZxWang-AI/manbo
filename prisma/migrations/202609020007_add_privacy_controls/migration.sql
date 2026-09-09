ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'export_preview';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'model_fallback';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'material_view';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'material_play';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'material_download';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'admin_review_create';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'admin_review_update';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'admin_case_modify';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'admin_case_delete';

CREATE TYPE "AuditOutcome" AS ENUM ('allowed', 'denied', 'failed');
CREATE TYPE "AppealStatus" AS ENUM ('submitted', 'under_review', 'resolved');

ALTER TABLE "audit_events"
  ADD COLUMN "actor_id" VARCHAR(120),
  ADD COLUMN "material_id" UUID,
  ADD COLUMN "outcome" "AuditOutcome";

CREATE TABLE "appeal_records" (
  "appeal_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "admin_review_version_id" UUID NOT NULL,
  "statement" TEXT NOT NULL,
  "supporting_material_ids" JSONB NOT NULL,
  "status" "AppealStatus" NOT NULL DEFAULT 'submitted',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "appeal_records_pkey" PRIMARY KEY ("appeal_id")
);

CREATE INDEX "appeal_records_case_id_account_id_created_at_idx"
  ON "appeal_records" ("case_id", "account_id", "created_at");
CREATE INDEX "appeal_records_admin_review_version_id_idx"
  ON "appeal_records" ("admin_review_version_id");

ALTER TABLE "appeal_records"
  ADD CONSTRAINT "appeal_records_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records" ("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "appeal_records_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts" ("account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "appeal_records_admin_review_version_id_fkey"
  FOREIGN KEY ("admin_review_version_id") REFERENCES "admin_review_versions" ("admin_review_version_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cleanup_jobs"
  ADD CONSTRAINT "cleanup_jobs_case_id_target_key" UNIQUE ("case_id", "target");
