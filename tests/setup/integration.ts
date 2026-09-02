import { afterAll, beforeAll } from "vitest";

import { prisma } from "@/server/db";
import { assertIsolatedTestDatabase } from "./test-database-guard";

assertIsolatedTestDatabase(
  process.env.DATABASE_URL,
  process.env.MANBO_TEST_DATABASE_RESET,
);

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "realtime_voice_events", "voice_sessions", "transcript_confirmations", "transcript_versions", "material_derivatives", "material_object_versions", "material_upload_reservations", "materials", "case_storage_usage", "conversation_messages", "consent_events", "audit_events", "cleanup_jobs", "case_record_revisions", "case_records", "auth_sessions", "recovery_throttles", "accounts" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
