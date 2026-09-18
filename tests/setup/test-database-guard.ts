const allowedTestDatabaseHosts = new Set(["127.0.0.1", "localhost", "test-db"]);
const allowedLocalTestPorts = new Set(["55432", "55433"]);

function expectedPort(hostname: string): string | undefined {
  if (hostname === "test-db") return "5432";
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return undefined;

  const localTestPort = process.env.MANBO_TEST_DATABASE_PORT ?? "55432";
  if (!allowedLocalTestPorts.has(localTestPort)) {
    throw new Error("MANBO_TEST_DATABASE_PORT must be an allowed isolated-test port");
  }
  return localTestPort;
}

export function assertIsolatedTestDatabase(
  databaseUrl: string | undefined,
  destructiveTestConfirmation: string | undefined,
): void {
  if (destructiveTestConfirmation !== "confirmed") {
    throw new Error("Explicit destructive-test confirmation is required");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests");
  }

  const url = new URL(databaseUrl);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("Refusing to use a non-PostgreSQL integration database");
  }
  if (!allowedTestDatabaseHosts.has(url.hostname)) {
    throw new Error(`Refusing to truncate a database on host: ${url.hostname}`);
  }
  if (url.port !== expectedPort(url.hostname)) {
    throw new Error(`Refusing to truncate a database on unexpected port: ${url.port}`);
  }
  if (decodeURIComponent(url.username) !== "manbo") {
    throw new Error("Refusing to truncate a database for an unexpected user");
  }
  if (url.pathname !== "/manbo_test") {
    throw new Error(`Refusing to truncate a non-test database: ${url.pathname}`);
  }
  const schemas = url.searchParams.getAll("schema");
  if (schemas.length !== 1 || schemas[0] !== "public") {
    throw new Error("Refusing to truncate a database outside the public test schema");
  }
}
