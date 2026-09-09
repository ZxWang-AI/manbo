CREATE TYPE "AdminCaseChangeAction" AS ENUM ('modify', 'delete');

CREATE TABLE "admin_case_change_versions" (
  "change_version_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "admin_id" VARCHAR(120) NOT NULL,
  "action" "AdminCaseChangeAction" NOT NULL,
  "expected_version" INTEGER,
  "resulting_version" INTEGER,
  "patch" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_case_change_versions_pkey" PRIMARY KEY ("change_version_id")
);

CREATE INDEX "admin_case_change_versions_case_id_created_at_idx"
  ON "admin_case_change_versions" ("case_id", "created_at");

ALTER TABLE "admin_case_change_versions"
  ADD CONSTRAINT "admin_case_change_versions_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "case_records" ("case_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION manbo_prevent_admin_case_change_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ADMIN_CASE_CHANGE_VERSIONS_ARE_IMMUTABLE';
END;
$$;

CREATE TRIGGER manbo_prevent_admin_case_change_mutation_trigger
BEFORE UPDATE OR DELETE ON "admin_case_change_versions"
FOR EACH ROW EXECUTE FUNCTION manbo_prevent_admin_case_change_mutation();
