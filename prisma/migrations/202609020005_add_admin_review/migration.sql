CREATE TYPE "AdminReviewStatus" AS ENUM ('intake_rejected', 'evidence_incomplete', 'credibility_concern', 'demonstrably_false');

CREATE TABLE "admin_review_versions" (
  "admin_review_version_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "reviewer_id" VARCHAR(120) NOT NULL,
  "status" "AdminReviewStatus" NOT NULL,
  "rationale" TEXT,
  "source_refs" JSONB NOT NULL,
  "supersedes_id" UUID,
  "second_reviewer_id" VARCHAR(120),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_review_versions_pkey" PRIMARY KEY ("admin_review_version_id")
);

CREATE INDEX "admin_review_versions_case_id_created_at_idx"
  ON "admin_review_versions" ("case_id", "created_at");
CREATE INDEX "admin_review_versions_supersedes_id_idx"
  ON "admin_review_versions" ("supersedes_id");
ALTER TABLE "admin_review_versions"
  ADD CONSTRAINT "admin_review_versions_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "case_records" ("case_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION manbo_prevent_admin_review_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_REVIEW_VERSIONS_ARE_IMMUTABLE';
END;
$$;

CREATE TRIGGER manbo_prevent_admin_review_mutation_trigger
BEFORE UPDATE OR DELETE ON "admin_review_versions"
FOR EACH ROW EXECUTE FUNCTION manbo_prevent_admin_review_mutation();
