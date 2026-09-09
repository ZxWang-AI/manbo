import { MAX_MATERIAL_BYTES, type MaterialProcessingRecord } from "@/domain/material";
import type { MaterialObjectReader } from "@/media/storage/object-store";
import type { MalwareScanner } from "@/media/security/malware-scanner";
import type { MaterialProcessingService } from "./material-processing-service";

export interface MaterialProcessingSource extends MaterialProcessingRecord {
  objectKey: string | null;
  encryptionScheme: string | null;
  keyVersion: string | null;
  wrappedKey: string | null;
}

export interface MaterialProcessingSourceRepository {
  getSource(input: {
    accountId: string;
    caseId: string;
    materialId: string;
  }): Promise<MaterialProcessingSource | null>;
}

export class MaterialProcessingTaskService {
  constructor(
    private readonly sources: MaterialProcessingSourceRepository,
    private readonly reader: MaterialObjectReader,
    private readonly processor: Pick<MaterialProcessingService, "process">,
    private readonly scanner: MalwareScanner,
  ) {}

  async run(input: { accountId: string; caseId: string; materialId: string }): Promise<MaterialProcessingRecord> {
    const source = await this.sources.getSource(input);
    if (
      !source
      || !source.objectKey
      || !/^materials\/[a-f0-9]{32}$/u.test(source.objectKey)
      || source.encryptionScheme !== "AES-256-GCM"
      || !source.keyVersion
      || !source.wrappedKey
    ) {
      throw new Error("MATERIAL_SOURCE_UNAVAILABLE");
    }

    const decrypted = await this.reader.readDecryptedObject({
      objectKey: source.objectKey,
      encryptionScheme: source.encryptionScheme,
      keyVersion: source.keyVersion,
      wrappedKey: source.wrappedKey,
    });
    if (!Number.isSafeInteger(decrypted.contentLength) || decrypted.contentLength <= 0 || decrypted.contentLength > MAX_MATERIAL_BYTES) {
      throw new Error("MATERIAL_CONTENT_UNAVAILABLE");
    }
    const bytes = await toBytes(decrypted.body, decrypted.contentLength);

    return this.processor.process({
      materialId: source.materialId,
      bytes,
      declaredMime: source.declaredMime,
      originalFilename: source.originalFilename,
      scanner: this.scanner,
    });
  }
}

async function toBytes(body: Uint8Array | ReadableStream<Uint8Array>, expectedLength: number): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength !== expectedLength) throw new Error("MATERIAL_CONTENT_LENGTH_MISMATCH");
    return body;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > expectedLength || total > MAX_MATERIAL_BYTES) {
        await reader.cancel();
        throw new Error("MATERIAL_CONTENT_LENGTH_MISMATCH");
      }
      chunks.push(next.value);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "MATERIAL_CONTENT_LENGTH_MISMATCH") throw error;
    throw new Error("MATERIAL_CONTENT_UNAVAILABLE");
  }
  if (total !== expectedLength) throw new Error("MATERIAL_CONTENT_LENGTH_MISMATCH");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
