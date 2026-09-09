import { describe, expect, it } from "vitest";

import { SafeExtractionWorker } from "@/media/parsers/safe-extraction-worker";

describe("safe extraction worker resource limits", () => {
  it("rejects oversized parser input before invoking the parser", async () => {
    const worker = new SafeExtractionWorker({ timeoutMs: 100, maxInputBytes: 4 });
    let calls = 0;

    await expect(
      worker.runExtraction(
        { bytes: Buffer.from("12345") },
        async () => {
          calls += 1;
          return { contentRef: "derived/never", text: "never" };
        },
      ),
    ).rejects.toThrow("MATERIAL_PARSER_INPUT_LIMIT_EXCEEDED");
    expect(calls).toBe(0);
  });

  it("rejects oversized parser output after the parser returns", async () => {
    const worker = new SafeExtractionWorker({ timeoutMs: 100, maxOutputCharacters: 4 });

    await expect(
      worker.runExtraction(
        { bytes: Buffer.from("safe") },
        async () => ({ contentRef: "derived/oversized", text: "12345" }),
      ),
    ).rejects.toThrow("MATERIAL_PARSER_OUTPUT_LIMIT_EXCEEDED");
  });

  it("returns bounded parser output unchanged", async () => {
    const worker = new SafeExtractionWorker({ timeoutMs: 100, maxInputBytes: 4, maxOutputCharacters: 4 });
    const result = await worker.runExtraction(
      { bytes: Buffer.from("safe") },
      async () => ({ contentRef: "derived/safe", text: "安全" }),
    );

    expect(result).toEqual({ contentRef: "derived/safe", text: "安全" });
  });

  it("rejects parser output with an unsafe derivative reference", async () => {
    const worker = new SafeExtractionWorker({ timeoutMs: 100 });

    await expect(
      worker.runExtraction(
        { bytes: Buffer.from("safe") },
        async () => ({ contentRef: "../outside", text: "safe" }),
      ),
    ).rejects.toThrow("MATERIAL_PARSER_OUTPUT_INVALID");
  });

  it("rejects parser output with out-of-range source spans or extra fields", async () => {
    const worker = new SafeExtractionWorker({ timeoutMs: 100 });

    await expect(
      worker.runExtraction(
        { bytes: Buffer.from("safe") },
        async () => ({
          contentRef: "derived/unsafe-spans",
          text: "safe",
          sourceSpans: [{ start: 5, end: 2 }],
          unexpected: "must be rejected",
        }),
      ),
    ).rejects.toThrow("MATERIAL_PARSER_OUTPUT_INVALID");
  });

  it("validates resource limits as positive safe integers", () => {
    expect(() => new SafeExtractionWorker({ timeoutMs: 100, maxInputBytes: 0 })).toThrow(
      "maxInputBytes must be a positive safe integer",
    );
    expect(() => new SafeExtractionWorker({ timeoutMs: 100, maxOutputCharacters: Number.NaN })).toThrow(
      "maxOutputCharacters must be a positive safe integer",
    );
  });
});
