import { prisma } from "@/server/db";
import { createMaterialObjectStoreFromEnv } from "@/media/storage/object-store-factory";
import { createMaterialProcessingQueue } from "./material-processing-runtime";

export const materialObjectStorageConfiguration = createMaterialObjectStoreFromEnv();
export const materialProcessingQueue = createMaterialProcessingQueue({
  database: prisma,
  objectStorage: materialObjectStorageConfiguration,
  queueMode: process.env.MATERIAL_PROCESSING_QUEUE === "durable" ? "durable" : "memory",
});
