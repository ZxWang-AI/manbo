import { describe, expect, it } from "vitest";

import { assertIsolatedTestDatabase } from "../setup/test-database-guard";

describe("integration database guard", () => {
  it.each([
    "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public",
    "postgresql://manbo:manbo_test@localhost:55432/manbo_test?schema=public",
    "postgresql://manbo:manbo_test@test-db:5432/manbo_test?schema=public",
  ])("allows the explicitly confirmed isolated database at %s", (databaseUrl) => {
      expect(() =>
        assertIsolatedTestDatabase(databaseUrl, "confirmed"),
      ).not.toThrow();
  });

  it("rejects a remote database even when it has the expected test database name", () => {
    expect(() =>
      assertIsolatedTestDatabase(
        "postgresql://manbo:secret@database.example.com:5432/manbo_test?schema=public",
        "confirmed",
      ),
    ).toThrow(/host/i);
  });

  it("rejects a local database with a non-test name", () => {
    expect(() =>
      assertIsolatedTestDatabase(
        "postgresql://manbo:secret@127.0.0.1:55432/manbo?schema=public",
        "confirmed",
      ),
    ).toThrow(/database/i);
  });

  it.each([
    [
      "unexpected port",
      "postgresql://manbo:manbo_test@127.0.0.1:5432/manbo_test?schema=public",
    ],
    [
      "unexpected user",
      "postgresql://postgres:manbo_test@127.0.0.1:55432/manbo_test?schema=public",
    ],
    [
      "unexpected schema",
      "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=shared",
    ],
  ])("rejects an otherwise test-like URL with an %s", (_label, databaseUrl) => {
    expect(() => assertIsolatedTestDatabase(databaseUrl, "confirmed")).toThrow();
  });

  it("requires an explicit destructive-test confirmation", () => {
    expect(() =>
      assertIsolatedTestDatabase(
        "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public",
        undefined,
      ),
    ).toThrow(/confirmation/i);
  });
});
