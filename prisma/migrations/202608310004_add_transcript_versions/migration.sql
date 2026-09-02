CREATE TYPE "TranscriptKind" AS ENUM ('machine_transcript', 'user_revision', 'realtime_caption');
CREATE TYPE "VoiceSessionStatus" AS ENUM ('active', 'ended');
CREATE TYPE "RealtimeVoiceEventType" AS ENUM (
  'session_started', 'user_caption', 'assistant_caption', 'assistant_interrupted',
  'muted', 'unmuted', 'switched_to_text', 'session_ended'
);

CREATE UNIQUE INDEX "material_object_versions_object_version_id_material_id_case_id_account_id_key"
  ON "material_object_versions"("object_version_id", "material_id", "case_id", "account_id");

CREATE TABLE "transcript_versions" (
  "transcript_version_id" UUID NOT NULL,
  "source_audio_version_id" UUID NOT NULL,
  "material_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "parent_transcript_version_id" UUID,
  "kind" "TranscriptKind" NOT NULL,
  "text" TEXT NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "segments" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "transcript_versions_pkey" PRIMARY KEY ("transcript_version_id"),
  CONSTRAINT "transcript_versions_text_nonempty" CHECK (length(btrim("text")) > 0)
);

CREATE TABLE "transcript_confirmations" (
  "confirmation_id" UUID NOT NULL,
  "transcript_version_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "case_id" UUID NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "transcript_confirmations_pkey" PRIMARY KEY ("confirmation_id"),
  CONSTRAINT "transcript_confirmations_transcript_version_id_unique" UNIQUE ("transcript_version_id")
);

CREATE TABLE "voice_sessions" (
  "session_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "case_id" UUID NOT NULL,
  "locale" VARCHAR(35) NOT NULL,
  "status" "VoiceSessionStatus" NOT NULL DEFAULT 'active',
  "next_sequence" INTEGER NOT NULL DEFAULT 1,
  "muted" BOOLEAN NOT NULL DEFAULT false,
  "text_mode" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  CONSTRAINT "voice_sessions_pkey" PRIMARY KEY ("session_id"),
  CONSTRAINT "voice_sessions_next_sequence_positive" CHECK ("next_sequence" > 0),
  CONSTRAINT "voice_sessions_ended_invariant" CHECK (
    ("status" = 'ended' AND "ended_at" IS NOT NULL)
    OR ("status" = 'active' AND "ended_at" IS NULL)
  )
);

CREATE TABLE "realtime_voice_events" (
  "event_id" UUID NOT NULL,
  "session_id" UUID NOT NULL,
  "account_id" CHAR(32) NOT NULL,
  "case_id" UUID NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "RealtimeVoiceEventType" NOT NULL,
  "text" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "realtime_voice_events_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "realtime_voice_events_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "realtime_voice_events_caption_text" CHECK (
    ("type" IN ('user_caption', 'assistant_caption') AND length(btrim("text")) > 0)
    OR ("type" NOT IN ('user_caption', 'assistant_caption') AND "text" IS NULL)
  )
);

CREATE INDEX "transcript_versions_case_id_account_id_idx" ON "transcript_versions"("case_id", "account_id");
CREATE INDEX "transcript_versions_source_audio_version_id_idx" ON "transcript_versions"("source_audio_version_id");
CREATE INDEX "transcript_versions_created_at_idx" ON "transcript_versions"("created_at");
CREATE INDEX "transcript_confirmations_case_id_account_id_idx" ON "transcript_confirmations"("case_id", "account_id");
CREATE UNIQUE INDEX "voice_sessions_session_id_case_id_account_id_key" ON "voice_sessions"("session_id", "case_id", "account_id");
CREATE INDEX "voice_sessions_case_id_account_id_status_idx" ON "voice_sessions"("case_id", "account_id", "status");
CREATE UNIQUE INDEX "realtime_voice_events_session_id_sequence_key" ON "realtime_voice_events"("session_id", "sequence");
CREATE INDEX "realtime_voice_events_case_id_account_id_idx" ON "realtime_voice_events"("case_id", "account_id");
CREATE INDEX "realtime_voice_events_created_at_idx" ON "realtime_voice_events"("created_at");

ALTER TABLE "transcript_versions" ADD CONSTRAINT "transcript_versions_source_audio_fkey"
  FOREIGN KEY ("source_audio_version_id", "material_id", "case_id", "account_id")
  REFERENCES "material_object_versions"("object_version_id", "material_id", "case_id", "account_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transcript_versions" ADD CONSTRAINT "transcript_versions_parent_fkey"
  FOREIGN KEY ("parent_transcript_version_id") REFERENCES "transcript_versions"("transcript_version_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "transcript_confirmations" ADD CONSTRAINT "transcript_confirmations_transcript_fkey"
  FOREIGN KEY ("transcript_version_id") REFERENCES "transcript_versions"("transcript_version_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_case_id_account_id_fkey"
  FOREIGN KEY ("case_id", "account_id") REFERENCES "case_records"("case_id", "account_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "realtime_voice_events" ADD CONSTRAINT "realtime_voice_events_session_fkey"
  FOREIGN KEY ("session_id", "case_id", "account_id")
  REFERENCES "voice_sessions"("session_id", "case_id", "account_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION manbo_prevent_transcript_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRANSCRIPT_VERSIONS_ARE_IMMUTABLE';
END;
$$;

CREATE TRIGGER manbo_prevent_transcript_update_trigger
BEFORE UPDATE ON "transcript_versions"
FOR EACH ROW EXECUTE FUNCTION manbo_prevent_transcript_update();

CREATE TRIGGER manbo_prevent_transcript_confirmation_update_trigger
BEFORE UPDATE ON "transcript_confirmations"
FOR EACH ROW EXECUTE FUNCTION manbo_prevent_transcript_update();

CREATE TRIGGER manbo_prevent_realtime_voice_event_update_trigger
BEFORE UPDATE ON "realtime_voice_events"
FOR EACH ROW EXECUTE FUNCTION manbo_prevent_transcript_update();

CREATE OR REPLACE FUNCTION manbo_validate_transcript_confirmation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM "transcript_versions"
    WHERE "transcript_version_id" = NEW."transcript_version_id"
      AND "account_id" = NEW."account_id"
      AND "case_id" = NEW."case_id"
      AND "kind" = 'user_revision';
  IF NOT FOUND THEN RAISE EXCEPTION 'TRANSCRIPT_CONFIRMATION_REQUIRES_USER_REVISION'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER manbo_validate_transcript_confirmation_trigger
BEFORE INSERT ON "transcript_confirmations"
FOR EACH ROW EXECUTE FUNCTION manbo_validate_transcript_confirmation();

CREATE OR REPLACE FUNCTION manbo_append_realtime_voice_event(
  p_event_id UUID,
  p_session_id UUID,
  p_account_id CHAR(32),
  p_case_id UUID,
  p_type "RealtimeVoiceEventType",
  p_text TEXT,
  p_now TIMESTAMPTZ
) RETURNS TABLE ("sequence" INTEGER) LANGUAGE plpgsql AS $$
DECLARE v_sequence INTEGER;
BEGIN
  UPDATE "voice_sessions"
    SET "next_sequence" = "next_sequence" + 1
    WHERE "session_id" = p_session_id
      AND "account_id" = p_account_id
      AND "case_id" = p_case_id
      AND "status" = 'active'
    RETURNING "next_sequence" - 1 INTO v_sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'VOICE_SESSION_UNAVAILABLE'; END IF;
  INSERT INTO "realtime_voice_events"
    ("event_id", "session_id", "account_id", "case_id", "sequence", "type", "text", "created_at")
    VALUES (p_event_id, p_session_id, p_account_id, p_case_id, v_sequence, p_type, p_text, p_now);
  RETURN QUERY SELECT v_sequence;
END;
$$;
