import { afterAll, beforeAll } from "vitest";

import { prisma } from "@/server/db";
import { assertIsolatedTestDatabase } from "./test-database-guard";

assertIsolatedTestDatabase(
  process.env.DATABASE_URL,
  process.env.MANBO_TEST_DATABASE_RESET,
);

beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "conversation_messages", "consent_events", "audit_events", "cleanup_jobs", "case_records", "auth_sessions", "recovery_throttles", "accounts" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
