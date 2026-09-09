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
  "worker:materials": "scripts/run-material-processing-worker.ts",
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

  it("keeps the GitHub Actions integration job Docker-free", () => {
    const workflow = readFileSync(
      path.join(rootDirectory, ".github/workflows/ci.yml"),
      "utf8",
    );
    const workflowBeforeE2e = workflow.split("\n  e2e:", 1)[0] ?? "";
    const integrationJob = workflowBeforeE2e.split("\n  integration:", 2)[1] ?? "";

    expect(workflow).toMatch(/^  workflow_dispatch:\s*$/m);
    expect(integrationJob).toContain("sudo apt-get install -y postgresql postgresql-client");
    expect(integrationJob).toContain("sudo systemctl start postgresql");
    expect(integrationJob).toContain("ALTER SYSTEM SET port = '55432'");
    expect(integrationJob).toContain("--port=55432");
    expect(integrationJob).not.toContain("services:");
    expect(integrationJob).not.toContain("docker");
    expect(integrationJob).not.toContain("image: postgres");
  });

  it("uses Node 24-compatible GitHub Actions", () => {
    const workflow = readFileSync(
      path.join(rootDirectory, ".github/workflows/ci.yml"),
      "utf8",
    );

    expect(workflow).toContain("actions/checkout@v7");
    expect(workflow).toContain("actions/setup-node@v7");
    expect(workflow).toContain("pnpm/action-setup@v6");
  });

  it("wires the material worker to the sanitized metrics contract", () => {
    const worker = readFileSync(
      path.join(rootDirectory, "scripts/run-material-processing-worker.ts"),
      "utf8",
    );

    expect(worker).toContain("material-processing-worker-supervisor");
    expect(worker).toContain("runMaterialProcessingWorkerSupervisor");
    expect(worker).toContain("SIGTERM");

    const supervisor = readFileSync(
      path.join(rootDirectory, "src/server/services/material-processing-worker-supervisor.ts"),
      "utf8",
    );
    expect(supervisor).toContain("material-processing-metrics");
    expect(supervisor).toContain("formatMaterialProcessingWorkerMetrics");
    expect(supervisor).toContain("material_processing_worker_state");

    const health = readFileSync(
      path.join(rootDirectory, "src/server/services/material-processing-worker-health.ts"),
      "utf8",
    );
    expect(health).toContain("material_processing_worker_state");
  });
});
