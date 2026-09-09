import {
  assertMaterialProcessingTransition,
  type MaterialProcessingRecord,
  type MaterialProcessingState,
} from "@/domain/material";
import { ParserRegistry } from "@/media/parsers/parser-registry";
import { detectFileSignature } from "@/media/security/file-signature";
import type { MalwareScanner } from "@/media/security/malware-scanner";

const DEFAULT_SCANNER_TIMEOUT_MS = 15_000;

export interface MaterialProcessingServiceOptions {
  scannerTimeoutMs?: number;
}

export interface MaterialProcessingRepository {
  get(materialId: string): Promise<MaterialProcessingRecord | null>;
  transition(
    materialId: string,
    expectedVersion: number,
    next: Partial<Pick<MaterialProcessingRecord, "processingState" | "detectedMime" | "signatureStatus" | "eligibleForAi">>,
  ): Promise<MaterialProcessingRecord>;
  addDerivative(derivative: { contentRef: string; sourceMaterialId: string; parserId: string }): Promise<void>;
  listAiEligibleContentRefs(materialId: string): Promise<string[]>;
}

export class MaterialProcessingService {
  private readonly scannerTimeoutMs: number;

  constructor(
    private readonly repository: MaterialProcessingRepository,
    private readonly parsers: ParserRegistry,
    options: MaterialProcessingServiceOptions = {},
  ) {
    const scannerTimeoutMs = options.scannerTimeoutMs ?? DEFAULT_SCANNER_TIMEOUT_MS;
    if (!Number.isInteger(scannerTimeoutMs) || scannerTimeoutMs <= 0 || scannerTimeoutMs > 60_000) {
      throw new TypeError("scannerTimeoutMs must be an integer between 1 and 60000 milliseconds");
    }
    this.scannerTimeoutMs = scannerTimeoutMs;
  }

  async process(input: {
    materialId: string;
    bytes: Uint8Array;
    declaredMime: string | null;
    originalFilename: string;
    scanner: MalwareScanner;
  }): Promise<MaterialProcessingRecord> {
    const current = await this.repository.get(input.materialId);
    if (!current) throw new Error("MATERIAL_NOT_FOUND");
    if (current.processingState === "blocked_malicious" || current.processingState === "parsed") return current;

    const signature = detectFileSignature({
      declaredMime: input.declaredMime,
      originalFilename: input.originalFilename,
      bytes: input.bytes,
    });
    const scanning = await this.transition(current, "scanning", {
      detectedMime: signature.detectedMime,
      signatureStatus: signature.signatureStatus,
      eligibleForAi: false,
    });
    if (signature.dangerous || signature.signatureStatus === "mismatch") {
      return this.transition(scanning, "blocked_malicious", { eligibleForAi: false });
    }

    let verdict: Awaited<ReturnType<MalwareScanner["scan"]>>;
    try {
      verdict = await this.scanWithTimeout(input.scanner, {
        bytes: input.bytes,
        filename: input.originalFilename,
      });
    } catch {
      // Scanner failures are fail-closed: retain the encrypted original, keep it
      // out of parsers/AI, and leave the state explicitly retryable.
      return this.transition(scanning, "scan_failed", { eligibleForAi: false });
    }
    if (verdict.verdict !== "clean") {
      return this.transition(scanning, verdict.verdict === "malicious" ? "blocked_malicious" : "scan_failed", {
        eligibleForAi: false,
      });
    }

    const parser = this.parsers.find(signature);
    if (!parser) {
      return this.transition(scanning, "saved_unread", { eligibleForAi: false });
    }
    const queued = await this.transition(scanning, "parse_queued", { eligibleForAi: false });
    try {
      const derivative = await parser.parse({ bytes: input.bytes, signature });
      await this.repository.addDerivative({
        contentRef: derivative.contentRef,
        sourceMaterialId: input.materialId,
        parserId: parser.id,
      });
      return this.transition(queued, "parsed", { eligibleForAi: true });
    } catch {
      return this.transition(queued, "saved_unread", { eligibleForAi: false });
    }
  }

  private async scanWithTimeout(
    scanner: MalwareScanner,
    input: { bytes: Uint8Array; filename: string },
  ): Promise<Awaited<ReturnType<MalwareScanner["scan"]>>> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        scanner.scan(input),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("MATERIAL_SCANNER_TIMEOUT")), this.scannerTimeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private transition(
    current: MaterialProcessingRecord,
    nextState: MaterialProcessingState,
    patch: Partial<Pick<MaterialProcessingRecord, "detectedMime" | "signatureStatus" | "eligibleForAi">>,
  ) {
    assertMaterialProcessingTransition(current.processingState, nextState);
    return this.repository.transition(current.materialId, current.processingVersion, {
      ...patch,
      processingState: nextState,
    });
  }
}
