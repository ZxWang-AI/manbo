CREATE TYPE "MaterialProcessingJobStatus" AS ENUM (
  'pending', 'processing', 'completed', 'failed', 'dead_letter'
);

CREATE TABLE "material_processing_jobs" (
  "job_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "case_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "status" "MaterialProcessingJobStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMPTZ(3),
  "leased_by" VARCHAR(120),
  "last_error_code" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_processing_jobs_pkey" PRIMARY KEY ("job_id"),
  CONSTRAINT "material_processing_jobs_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "material_processing_jobs_max_attempts_positive" CHECK ("max_attempts" > 0)
);

CREATE UNIQUE INDEX "material_processing_jobs_active_material_key"
  ON "material_processing_jobs"("account_id", "case_id", "material_id")
  WHERE "status" IN ('pending', 'processing');
CREATE INDEX "material_processing_jobs_status_available_at_idx"
  ON "material_processing_jobs"("status", "available_at");
CREATE INDEX "material_processing_jobs_case_id_account_id_idx"
  ON "material_processing_jobs"("case_id", "account_id");
CREATE INDEX "material_processing_jobs_material_id_case_id_account_id_idx"
  ON "material_processing_jobs"("material_id", "case_id", "account_id");

ALTER TABLE "material_processing_jobs"
  ADD CONSTRAINT "material_processing_jobs_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id")
  REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_processing_jobs"
  ADD CONSTRAINT "material_processing_jobs_account_id_fkey"
  FOREIGN KEY ("account_id")
  REFERENCES "accounts"("account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_processing_jobs"
  ADD CONSTRAINT "material_processing_jobs_material_id_case_id_account_id_fkey"
  FOREIGN KEY ("material_id", "case_id", "account_id")
  REFERENCES "materials"("material_id", "case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
