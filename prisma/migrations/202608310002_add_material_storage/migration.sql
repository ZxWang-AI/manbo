CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "MaterialStatus" AS ENUM ('reserved', 'uploaded', 'deleted');

CREATE TABLE "case_storage_usage" (
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "used_bytes" BIGINT NOT NULL DEFAULT 0,
    "reserved_bytes" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "case_storage_usage_pkey" PRIMARY KEY ("case_id"),
    CONSTRAINT "case_storage_usage_used_bytes_nonnegative" CHECK ("used_bytes" >= 0),
    CONSTRAINT "case_storage_usage_reserved_bytes_nonnegative" CHECK ("reserved_bytes" >= 0),
    CONSTRAINT "case_storage_usage_total_limit" CHECK ("used_bytes" + "reserved_bytes" <= 2147483648)
);

CREATE TABLE "materials" (
    "material_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "status" "MaterialStatus" NOT NULL DEFAULT 'reserved',
    "declared_bytes" BIGINT NOT NULL,
    "used_bytes" BIGINT,
    "object_key" VARCHAR(180),
    "sha256" CHAR(64),
    "encryption_scheme" VARCHAR(32),
    "key_version" VARCHAR(80),
    "wrapped_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    CONSTRAINT "materials_pkey" PRIMARY KEY ("material_id"),
    CONSTRAINT "materials_declared_bytes_limit" CHECK ("declared_bytes" > 0 AND "declared_bytes" <= 104857600),
    CONSTRAINT "materials_used_bytes_limit" CHECK ("used_bytes" IS NULL OR ("used_bytes" > 0 AND "used_bytes" <= 104857600)),
    CONSTRAINT "materials_sha256_format" CHECK ("sha256" IS NULL OR "sha256" ~ '^[0-9a-f]{64}$')
);

CREATE TABLE "material_upload_reservations" (
    "upload_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "declared_bytes" BIGINT NOT NULL,
    "status" "MaterialStatus" NOT NULL DEFAULT 'reserved',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "encryption_scheme" VARCHAR(32),
    "key_version" VARCHAR(80),
    "wrapped_key" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "material_upload_reservations_pkey" PRIMARY KEY ("upload_id"),
    CONSTRAINT "material_upload_reservations_declared_bytes_limit" CHECK ("declared_bytes" > 0 AND "declared_bytes" <= 104857600)
);

CREATE TABLE "material_object_versions" (
    "object_version_id" UUID NOT NULL,
    "material_id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "account_id" CHAR(32) NOT NULL,
    "object_key" VARCHAR(180) NOT NULL,
    "stored_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "encryption_scheme" VARCHAR(32) NOT NULL,
    "key_version" VARCHAR(80) NOT NULL,
    "wrapped_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "material_object_versions_pkey" PRIMARY KEY ("object_version_id"),
    CONSTRAINT "material_object_versions_stored_bytes_limit" CHECK ("stored_bytes" > 0 AND "stored_bytes" <= 104857600),
    CONSTRAINT "material_object_versions_sha256_format" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "case_storage_usage_account_id_idx" ON "case_storage_usage"("account_id");
CREATE UNIQUE INDEX "case_storage_usage_case_id_account_id_key" ON "case_storage_usage"("case_id", "account_id");
CREATE UNIQUE INDEX "materials_material_id_case_id_account_id_key" ON "materials"("material_id", "case_id", "account_id");
CREATE INDEX "materials_case_id_account_id_status_idx" ON "materials"("case_id", "account_id", "status");
CREATE INDEX "material_upload_reservations_case_id_account_id_status_idx" ON "material_upload_reservations"("case_id", "account_id", "status");
CREATE INDEX "material_upload_reservations_expires_at_idx" ON "material_upload_reservations"("expires_at");
CREATE UNIQUE INDEX "material_object_versions_material_id_object_version_id_key" ON "material_object_versions"("material_id", "object_version_id");
CREATE INDEX "material_object_versions_case_id_account_id_idx" ON "material_object_versions"("case_id", "account_id");
CREATE INDEX "material_object_versions_created_at_idx" ON "material_object_versions"("created_at");

ALTER TABLE "case_storage_usage" ADD CONSTRAINT "case_storage_usage_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "materials" ADD CONSTRAINT "materials_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_upload_reservations" ADD CONSTRAINT "material_upload_reservations_material_id_fkey"
  FOREIGN KEY ("material_id") REFERENCES "materials"("material_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_upload_reservations" ADD CONSTRAINT "material_upload_reservations_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "material_object_versions" ADD CONSTRAINT "material_object_versions_material_id_case_id_account_id_fkey"
  FOREIGN KEY ("material_id", "case_id", "account_id") REFERENCES "materials"("material_id", "case_id", "account_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION manbo_reserve_material_upload(
  p_account_id CHAR(32),
  p_case_id UUID,
  p_byte_length BIGINT,
  p_object_key VARCHAR(180),
  p_upload_id UUID,
  p_now TIMESTAMPTZ
) RETURNS TABLE (
  "uploadId" UUID,
  "materialId" UUID,
  "caseId" UUID,
  "objectKey" VARCHAR(180),
  "reservedBytes" BIGINT,
  "expiresAt" TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
DECLARE
  v_material_id UUID := gen_random_uuid();
  v_expires_at TIMESTAMPTZ := p_now + INTERVAL '15 minutes';
  v_used BIGINT;
  v_reserved BIGINT;
BEGIN
  IF p_byte_length <= 0 OR p_byte_length > 104857600 THEN
    RAISE EXCEPTION 'FILE_STORAGE_LIMIT_EXCEEDED';
  END IF;
  PERFORM 1 FROM "case_records"
    WHERE "case_id" = p_case_id AND "account_id" = p_account_id
      AND "visibility" = 'private' AND "deleted_at" IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRIVATE_CASE_UNAVAILABLE';
  END IF;
  INSERT INTO "case_storage_usage" ("case_id", "account_id", "updated_at")
    VALUES (p_case_id, p_account_id, p_now)
    ON CONFLICT ("case_id") DO NOTHING;
  SELECT "used_bytes", "reserved_bytes" INTO v_used, v_reserved
    FROM "case_storage_usage" WHERE "case_id" = p_case_id FOR UPDATE;
  IF v_used + v_reserved + p_byte_length > 2147483648 THEN
    RAISE EXCEPTION 'CASE_STORAGE_LIMIT_EXCEEDED';
  END IF;
  UPDATE "case_storage_usage"
    SET "reserved_bytes" = "reserved_bytes" + p_byte_length, "updated_at" = p_now
    WHERE "case_id" = p_case_id;
  INSERT INTO "materials" ("material_id", "case_id", "account_id", "declared_bytes", "object_key")
    VALUES (v_material_id, p_case_id, p_account_id, p_byte_length, p_object_key);
  INSERT INTO "material_upload_reservations"
    ("upload_id", "material_id", "case_id", "account_id", "declared_bytes", "expires_at", "updated_at")
    VALUES (p_upload_id, v_material_id, p_case_id, p_account_id, p_byte_length, v_expires_at, p_now);
  RETURN QUERY SELECT p_upload_id, v_material_id, p_case_id, p_object_key, p_byte_length, v_expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION manbo_complete_material_upload(
  p_account_id CHAR(32), p_upload_id UUID, p_object_key VARCHAR(180),
  p_sha256 CHAR(64), p_stored_bytes BIGINT, p_now TIMESTAMPTZ
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  v_case_id UUID;
  v_declared BIGINT;
  v_material_id UUID;
  v_scheme VARCHAR(32);
  v_key_version VARCHAR(80);
  v_wrapped_key TEXT;
  v_status "MaterialStatus";
  v_expires_at TIMESTAMPTZ;
  v_existing_object_key VARCHAR(180);
  v_existing_sha256 CHAR(64);
  v_existing_bytes BIGINT;
BEGIN
  IF p_stored_bytes <= 0 OR p_stored_bytes > 104857600 OR p_sha256 !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'MATERIAL_SIZE_OR_HASH_MISMATCH';
  END IF;
  SELECT r."case_id", r."declared_bytes", r."material_id", r."encryption_scheme",
         r."key_version", r."wrapped_key", r."status", r."expires_at",
         m."object_key", m."sha256", m."used_bytes"
    INTO v_case_id, v_declared, v_material_id, v_scheme, v_key_version, v_wrapped_key,
         v_status, v_expires_at, v_existing_object_key, v_existing_sha256, v_existing_bytes
    FROM "material_upload_reservations" r
    INNER JOIN "materials" m
      ON m."material_id" = r."material_id"
     AND m."case_id" = r."case_id"
     AND m."account_id" = r."account_id"
    WHERE r."upload_id" = p_upload_id AND r."account_id" = p_account_id
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF v_status = 'uploaded' THEN
    IF v_existing_object_key = p_object_key AND v_existing_sha256 = p_sha256 AND v_existing_bytes = p_stored_bytes
      THEN RETURN 'already_completed';
    END IF;
    RAISE EXCEPTION 'MATERIAL_COMPLETION_CONFLICT';
  END IF;
  IF v_status <> 'reserved' THEN RETURN 'unavailable'; END IF;
  IF v_expires_at <= p_now THEN RETURN 'expired'; END IF;
  PERFORM 1 FROM "case_records"
    WHERE "case_id" = v_case_id AND "account_id" = p_account_id
      AND "visibility" = 'private' AND "deleted_at" IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;
  IF v_existing_object_key <> p_object_key OR v_declared <> p_stored_bytes OR v_scheme IS NULL OR v_key_version IS NULL OR v_wrapped_key IS NULL
    THEN RAISE EXCEPTION 'MATERIAL_SIZE_OR_HASH_MISMATCH'; END IF;
  INSERT INTO "material_object_versions"
    ("object_version_id", "material_id", "case_id", "account_id", "object_key", "stored_bytes", "sha256", "encryption_scheme", "key_version", "wrapped_key")
    VALUES (gen_random_uuid(), v_material_id, v_case_id, p_account_id, p_object_key, p_stored_bytes, p_sha256, v_scheme, v_key_version, v_wrapped_key);
  UPDATE "materials" SET "status" = 'uploaded', "used_bytes" = p_stored_bytes,
    "object_key" = p_object_key, "sha256" = p_sha256, "encryption_scheme" = v_scheme,
    "key_version" = v_key_version, "wrapped_key" = v_wrapped_key, "completed_at" = p_now
    WHERE "material_id" = v_material_id;
  UPDATE "case_storage_usage" SET "reserved_bytes" = "reserved_bytes" - v_declared,
    "used_bytes" = "used_bytes" + v_declared, "updated_at" = p_now WHERE "case_id" = v_case_id;
  UPDATE "material_upload_reservations" SET "status" = 'uploaded', "updated_at" = p_now WHERE "upload_id" = p_upload_id;
  RETURN 'completed';
END;
$$;

CREATE OR REPLACE FUNCTION manbo_release_material_upload(
  p_account_id CHAR(32), p_upload_id UUID, p_now TIMESTAMPTZ
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE v_case_id UUID; v_declared BIGINT; v_material_id UUID;
BEGIN
  SELECT "case_id", "declared_bytes", "material_id" INTO v_case_id, v_declared, v_material_id
    FROM "material_upload_reservations"
    WHERE "upload_id" = p_upload_id AND "account_id" = p_account_id AND "status" = 'reserved'
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'already_released'; END IF;
  UPDATE "case_storage_usage" SET "reserved_bytes" = GREATEST(0, "reserved_bytes" - v_declared), "updated_at" = p_now WHERE "case_id" = v_case_id;
  UPDATE "material_upload_reservations" SET "status" = 'deleted', "updated_at" = p_now WHERE "upload_id" = p_upload_id;
  UPDATE "materials" SET "status" = 'deleted', "deleted_at" = p_now WHERE "material_id" = v_material_id;
  RETURN 'released';
END;
$$;
