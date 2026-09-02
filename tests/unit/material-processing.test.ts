import { describe, expect, it } from "vitest";

import {
  detectFileSignature,
  type FileSignatureInput,
} from "@/media/security/file-signature";
import {
  MaterialProcessingService,
  type MaterialProcessingRepository,
} from "@/server/services/material-processing-service";
import type { MalwareScanner } from "@/media/security/malware-scanner";
import { ParserRegistry } from "@/media/parsers/parser-registry";
import type { MaterialProcessingRecord } from "@/domain/material";
import { SafeExtractionWorker } from "@/media/parsers/safe-extraction-worker";

function makeRecord(overrides: Partial<MaterialProcessingRecord> = {}): MaterialProcessingRecord {
  return {
    materialId: "material-a",
    declaredMime: "application/pdf",
    originalFilename: "statement.pdf",
    processingState: "quarantined",
    processingVersion: 1,
    detectedMime: null,
    signatureStatus: "unknown",
    eligibleForAi: false,
    ...overrides,
  };
}

function makeRepository(record = makeRecord()) {
  let current = record;
  const derivatives: Array<{ contentRef: string; sourceMaterialId: string }> = [];
  const repository: MaterialProcessingRepository = {
    get: async () => current,
    transition: async (materialId, expectedVersion, next) => {
      if (current.materialId !== materialId || current.processingVersion !== expectedVersion) {
        throw new Error("MATERIAL_PROCESSING_VERSION_CONFLICT");
      }
      current = { ...current, ...next, processingVersion: expectedVersion + 1 };
      return current;
    },
    addDerivative: async (derivative) => {
      derivatives.push(derivative);
    },
    listAiEligibleContentRefs: async () => derivatives.map((item) => item.contentRef),
  };
  return { repository, getCurrent: () => current, derivatives };
}

const cleanScanner: MalwareScanner = {
  scan: async () => ({ verdict: "clean" }),
};

const cleanPdf: FileSignatureInput = {
  declaredMime: "application/pdf",
  originalFilename: "statement.pdf",
  bytes: Buffer.from("%PDF-1.7\nsynthetic fixture"),
};

describe("material signature detection", () => {
  it("marks a PDF declaration with executable bytes as a mismatch", () => {
    const result = detectFileSignature({
      declaredMime: "application/pdf",
      originalFilename: "invoice.pdf",
      bytes: Buffer.from("MZ\x90\x00synthetic executable"),
    });

    expect(result.signatureStatus).toBe("mismatch");
    expect(result.detectedMime).toBe("application/vnd.microsoft.portable-executable");
    expect(result.dangerous).toBe(true);
  });

  it("recognizes clean PDF signature and extension agreement", () => {
    const result = detectFileSignature(cleanPdf);

    expect(result).toMatchObject({
      detectedMime: "application/pdf",
      signatureStatus: "match",
      dangerous: false,
    });
  });
});

describe("material quarantine and parsing", () => {
  it("saves an unsupported format but keeps it unread and out of AI", async () => {
    const state = makeRepository(makeRecord({ declaredMime: "application/x-unknown", originalFilename: "sample.unknown" }));
    const service = new MaterialProcessingService(state.repository, new ParserRegistry([]));

    const result = await service.process({
      materialId: "material-a",
      bytes: Buffer.from("synthetic unknown format"),
      declaredMime: "application/x-unknown",
      originalFilename: "sample.unknown",
      scanner: cleanScanner,
    });

    expect(result.processingState).toBe("saved_unread");
    expect(result.eligibleForAi).toBe(false);
    await expect(state.repository.listAiEligibleContentRefs("material-a")).resolves.toEqual([]);
  });

  it("never parses a signature-mismatched executable", async () => {
    let parserCalls = 0;
    const parser = {
      id: "pdf-parser",
      supports: () => true,
      parse: async () => {
        parserCalls += 1;
        return { contentRef: "derived/should-not-exist", text: "unsafe" };
      },
    };
    const state = makeRepository();
    const service = new MaterialProcessingService(state.repository, new ParserRegistry([parser]));

    const result = await service.process({
      materialId: "material-a",
      bytes: Buffer.from("MZ\x90\x00synthetic executable"),
      declaredMime: "application/pdf",
      originalFilename: "invoice.pdf",
      scanner: cleanScanner,
    });

    expect(result.processingState).toBe("blocked_malicious");
    expect(result.eligibleForAi).toBe(false);
    expect(parserCalls).toBe(0);
  });

  it("keeps scanner failures quarantined and never exposes an AI content reference", async () => {
    const state = makeRepository();
    const service = new MaterialProcessingService(state.repository, new ParserRegistry([]));
    const scanner: MalwareScanner = { scan: async () => ({ verdict: "error", reason: "timeout" }) };

    const result = await service.process({
      materialId: "material-a",
      ...cleanPdf,
      scanner,
    });

    expect(result.processingState).toBe("scan_failed");
    expect(result.eligibleForAi).toBe(false);
  });

  it("does not move a blocked material back to a readable state on retry", async () => {
    const state = makeRepository(makeRecord({ processingState: "blocked_malicious" }));
    const service = new MaterialProcessingService(state.repository, new ParserRegistry([]));
    await expect(
      service.process({
        materialId: "material-a",
        ...cleanPdf,
        scanner: cleanScanner,
      }),
    ).resolves.toMatchObject({ processingState: "blocked_malicious", eligibleForAi: false });
  });

  it("only exposes parser derivatives linked to the source material", async () => {
    const state = makeRepository();
    const service = new MaterialProcessingService(
      state.repository,
      new ParserRegistry([
        {
          id: "pdf-parser",
          supports: (signature) => signature.detectedMime === "application/pdf",
          parse: async () => ({ contentRef: "derived/material-a-v1", text: "safe parsed text" }),
        },
      ]),
    );

    const result = await service.process({
      materialId: "material-a",
      ...cleanPdf,
      scanner: cleanScanner,
    });

    expect(result.processingState).toBe("parsed");
    expect(result.eligibleForAi).toBe(true);
    await expect(state.repository.listAiEligibleContentRefs("material-a")).resolves.toEqual([
      "derived/material-a-v1",
    ]);
  });

  it("converts parser crashes into saved_unread without deleting the original", async () => {
    const state = makeRepository();
    const service = new MaterialProcessingService(
      state.repository,
      new ParserRegistry([
        {
          id: "pdf-parser",
          supports: (signature) => signature.detectedMime === "application/pdf",
          parse: async () => {
            throw new Error("parser crashed");
          },
        },
      ]),
    );

    const result = await service.process({ materialId: "material-a", ...cleanPdf, scanner: cleanScanner });

    expect(result.processingState).toBe("saved_unread");
    expect(result.eligibleForAi).toBe(false);
    expect(state.derivatives).toEqual([]);
  });

  it("times out a parser worker and returns a retryable failure", async () => {
    const worker = new SafeExtractionWorker({ timeoutMs: 5 });
    await expect(
      worker.run(async () => new Promise(() => undefined)),
    ).rejects.toThrow("MATERIAL_PARSER_TIMEOUT");
  });

  it("does not duplicate a derivative when the same parser job is retried", async () => {
    const state = makeRepository();
    const service = new MaterialProcessingService(
      state.repository,
      new ParserRegistry([
        {
          id: "pdf-parser",
          supports: (signature) => signature.detectedMime === "application/pdf",
          parse: async () => ({ contentRef: "derived/material-a-v1", text: "safe parsed text" }),
        },
      ]),
    );

    await service.process({ materialId: "material-a", ...cleanPdf, scanner: cleanScanner });
    await service.process({ materialId: "material-a", ...cleanPdf, scanner: cleanScanner });

    expect(state.derivatives).toHaveLength(1);
  });
});
