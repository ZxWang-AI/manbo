CREATE TYPE "MaterialProcessingState" AS ENUM (
  'uploading', 'quarantined', 'scanning', 'saved_unread',
  'parse_queued', 'parsed', 'blocked_malicious', 'scan_failed'
);
CREATE TYPE "MaterialSignatureStatus" AS ENUM ('match', 'mismatch', 'unknown');

ALTER TABLE "materials"
  ADD COLUMN "original_filename" VARCHAR(255),
  ADD COLUMN "declared_mime" VARCHAR(160),
  ADD COLUMN "detected_mime" VARCHAR(160),
  ADD COLUMN "signature_status" "MaterialSignatureStatus" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "processing_state" "MaterialProcessingState" NOT NULL DEFAULT 'quarantined',
  ADD COLUMN "processing_version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "eligible_for_ai" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "materials"
  ADD CONSTRAINT "materials_processing_version_positive" CHECK ("processing_version" > 0);

CREATE TABLE "material_derivatives" (
  "derivative_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "content_ref" VARCHAR(180) NOT NULL,
  "parser_id" VARCHAR(80) NOT NULL,
  "parser_version" VARCHAR(40) NOT NULL,
  "source_object_key" VARCHAR(180) NOT NULL,
  "source_sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "material_derivatives_pkey" PRIMARY KEY ("derivative_id"),
  CONSTRAINT "material_derivatives_source_sha256_format" CHECK ("source_sha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "material_derivatives_material_id_content_ref_key"
  ON "material_derivatives"("material_id", "content_ref");
CREATE INDEX "material_derivatives_case_id_account_id_idx"
  ON "material_derivatives"("case_id", "account_id");
CREATE INDEX "material_derivatives_created_at_idx"
  ON "material_derivatives"("created_at");

ALTER TABLE "material_derivatives"
  ADD CONSTRAINT "material_derivatives_material_id_case_id_account_id_fkey"
  FOREIGN KEY ("material_id", "case_id", "account_id")
  REFERENCES "materials"("material_id", "case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
