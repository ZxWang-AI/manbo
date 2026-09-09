import type { PrismaClient } from "@prisma/client";

import { ParserRegistry } from "@/media/parsers/parser-registry";
import type { MalwareScanner } from "@/media/security/malware-scanner";
import type { MaterialObjectStoreConfiguration } from "@/media/storage/object-store-factory";
import { PrismaMaterialProcessingRepository } from "@/server/repositories/material-processing-repository";
import { PrismaMaterialProcessingJobRepository } from "@/server/repositories/material-processing-job-repository";
import { PrismaMaterialProcessingSourceRepository } from "@/server/repositories/material-processing-source-repository";
import { InMemoryMaterialProcessingQueue, type MaterialProcessingQueue } from "./material-processing-queue";
import { MaterialProcessingService } from "./material-processing-service";
import { MaterialProcessingTaskService } from "./material-processing-task-service";
import { MaterialProcessingWorker } from "./material-processing-worker";

export interface MaterialProcessingRuntimeOptions {
  database: PrismaClient;
  objectStorage: MaterialObjectStoreConfiguration;
  scanner?: MalwareScanner;
  parsers?: ParserRegistry;
  queueMode?: "memory" | "durable";
}

/**
 * Builds the processing pipeline behind a queue boundary. The default scanner
 * is intentionally fail-closed until a reviewed isolated scanner is configured.
 */
export function createMaterialProcessingQueue({
  database,
  objectStorage,
  scanner = unavailableScanner,
  parsers = new ParserRegistry([]),
  queueMode = "memory",
}: MaterialProcessingRuntimeOptions): MaterialProcessingQueue {
  if (queueMode === "durable") {
    return new PrismaMaterialProcessingJobRepository(database);
  }
  const reader = objectStorage.reader;
  return new InMemoryMaterialProcessingQueue(async (job) => {
    if (!reader) throw new Error("MATERIAL_OBJECT_STORAGE_UNAVAILABLE");
    const task = new MaterialProcessingTaskService(
      new PrismaMaterialProcessingSourceRepository(database),
      reader,
      new MaterialProcessingService(
        new PrismaMaterialProcessingRepository(database, job.accountId, job.caseId),
        parsers,
      ),
      scanner,
    );
    await task.run(job);
  });
}

/**
 * Creates the durable worker boundary. Deployment code must run this worker
 * from a separately supervised process; the web request path only enqueues.
 */
export function createMaterialProcessingWorker({
  database,
  objectStorage,
  scanner = unavailableScanner,
  parsers = new ParserRegistry([]),
}: MaterialProcessingRuntimeOptions): MaterialProcessingWorker {
  const queue = new PrismaMaterialProcessingJobRepository(database);
  return new MaterialProcessingWorker(queue, async (job) => {
    if (!objectStorage.reader) throw new Error("MATERIAL_OBJECT_STORAGE_UNAVAILABLE");
    const task = new MaterialProcessingTaskService(
      new PrismaMaterialProcessingSourceRepository(database),
      objectStorage.reader,
      new MaterialProcessingService(
        new PrismaMaterialProcessingRepository(database, job.accountId, job.caseId),
        parsers,
      ),
      scanner,
    );
    await task.run(job);
  });
}

const unavailableScanner: MalwareScanner = {
  async scan() {
    return { verdict: "error", reason: "MATERIAL_SCANNER_NOT_CONFIGURED" };
  },
};
