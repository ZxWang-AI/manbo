import { afterAll, beforeAll } from "vitest";

import { prisma } from "@/server/db";

function assertIsolatedTestDatabase(databaseUrl: string | undefined): void {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests");
  }

  const url = new URL(databaseUrl);
  if (url.pathname !== "/manbo_test") {
    throw new Error(`Refusing to truncate non-test database: ${url.pathname}`);
  }
}

beforeAll(async () => {
  assertIsolatedTestDatabase(process.env.DATABASE_URL);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "conversation_messages", "consent_events", "audit_events", "cleanup_jobs", "case_records", "auth_sessions", "recovery_throttles", "accounts" RESTART IDENTITY CASCADE',
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
