import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rootDirectory = process.cwd();

type PackageManifest = {
  scripts?: Record<string, string>;
};

const packageManifest = JSON.parse(
  readFileSync(path.join(rootDirectory, "package.json"), "utf8"),
) as PackageManifest;

const toolingEntrypoints = {
  "test:integration": "vitest.integration.config.ts",
  "axe:e2e": "tests/e2e/accessibility.spec.ts",
  "knowledge:index": "scripts/build-knowledge-index.ts",
  "db:test:up": "compose.yaml",
} as const;

describe("Task 1 tooling contract", () => {
  for (const [scriptName, entrypoint] of Object.entries(toolingEntrypoints)) {
    it(`${scriptName} references an executable entrypoint`, () => {
      expect(packageManifest.scripts?.[scriptName]).toContain(
        entrypoint === "compose.yaml" ? "docker compose" : entrypoint,
      );
      expect(() => readFileSync(path.join(rootDirectory, entrypoint), "utf8")).not.toThrow();
    });
  }

  it("defines a PostgreSQL 16 test database contract", () => {
    const compose = readFileSync(path.join(rootDirectory, "compose.yaml"), "utf8");

    expect(compose).toContain("test-db:");
    expect(compose).toContain("postgres:16");
    expect(compose).toContain("55432:5432");
    expect(compose).toContain("healthcheck:");
  });
});
