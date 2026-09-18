-- Parsed material text is sensitive. Keep the application-level AES-256-GCM
-- envelope in JSONB; the database never receives plaintext derivative text.
ALTER TABLE "material_derivatives"
  ADD COLUMN "encrypted_content" JSONB;
