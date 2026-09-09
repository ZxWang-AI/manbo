import { randomUUID } from "node:crypto";

import { createMaterialObjectStoreFromEnv } from "@/media/storage/object-store-factory";
import { createIsolatedMediaGatewayFromEnv } from "@/media/security/isolated-media-gateway";
import { prisma } from "@/server/db";
import {
  createMaterialProcessingWorker,
} from "@/server/services/material-processing-runtime";
import { runMaterialProcessingWorkerSupervisor } from "@/server/services/material-processing-worker-supervisor";

if (process.env.MATERIAL_PROCESSING_WORKER_ENABLED !== "true") {
  throw new Error("MATERIAL_PROCESSING_WORKER_DISABLED");
}
if (process.env.APP_MODE === "static") {
  throw new Error("MATERIAL_PROCESSING_WORKER_STATIC_MODE");
}

const workerId = process.env.MATERIAL_PROCESSING_WORKER_ID?.trim() || `material-worker-${randomUUID()}`;
const idleDelayMs = parseIdleDelay(process.env.MATERIAL_PROCESSING_IDLE_DELAY_MS);
const objectStorage = createMaterialObjectStoreFromEnv();
const mediaGateway = createIsolatedMediaGatewayFromEnv();
const worker = createMaterialProcessingWorker({
  database: prisma,
  objectStorage,
  ...(mediaGateway.available
    ? { scanner: mediaGateway.scanner, parsers: mediaGateway.parsers }
    : {}),
});
const controller = new AbortController();

const stop = () => controller.abort();
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await runMaterialProcessingWorkerSupervisor({
    worker,
    workerId,
    idleDelayMs,
    signal: controller.signal,
    output: {
      stdout: (line) => process.stdout.write(`${line}\n`),
      stderr: (line) => process.stderr.write(`${line}\n`),
    },
  });
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await prisma.$disconnect();
}

function parseIdleDelay(raw: string | undefined): number {
  if (raw === undefined) return 1_000;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 60_000) {
    throw new Error("MATERIAL_PROCESSING_IDLE_DELAY_INVALID");
  }
  return parsed;
}
