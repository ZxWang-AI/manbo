import { prisma } from "@/server/db";
import { createMaterialObjectStoreFromEnv } from "@/media/storage/object-store-factory";
import { createMaterialDerivativeContentCipherFromEnv } from "@/media/security/material-derivative-content";
import { createMaterialProcessingQueue } from "./material-processing-runtime";

export const materialObjectStorageConfiguration = createMaterialObjectStoreFromEnv();
export const materialDerivativeContentCipherConfiguration = createMaterialDerivativeContentCipherFromEnv();
export const materialProcessingQueue = createMaterialProcessingQueue({
  database: prisma,
  objectStorage: materialObjectStorageConfiguration,
  ...(materialDerivativeContentCipherConfiguration.available
    ? { derivativeContentCipher: materialDerivativeContentCipherConfiguration.cipher }
    : {}),
  queueMode: process.env.MATERIAL_PROCESSING_QUEUE === "durable" ? "durable" : "memory",
});
