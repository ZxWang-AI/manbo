import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(rootDirectory, "src"),
    },
  },
  test: {
    environment: "node",
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://manbo:manbo_test@127.0.0.1:55432/manbo_test?schema=public",
    },
    fileParallelism: false,
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/setup/integration.ts"],
  },
});
