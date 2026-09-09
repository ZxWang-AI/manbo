import type { ParsedMaterialDerivative } from "./parser-registry";

export interface SafeExtractionWorkerLimits {
  timeoutMs: number;
  maxInputBytes?: number;
  maxOutputCharacters?: number;
}

export class SafeExtractionWorker {
  constructor(private readonly limits: SafeExtractionWorkerLimits) {
    if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive integer");
    }
    if (limits.maxInputBytes !== undefined && !isPositiveSafeInteger(limits.maxInputBytes)) {
      throw new TypeError("maxInputBytes must be a positive safe integer");
    }
    if (limits.maxOutputCharacters !== undefined && !isPositiveSafeInteger(limits.maxOutputCharacters)) {
      throw new TypeError("maxOutputCharacters must be a positive safe integer");
    }
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("MATERIAL_PARSER_TIMEOUT")), this.limits.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Runs a parser only after checking the byte budget and validates the size
   * of its textual derivative before it can be persisted as AI-eligible.
   */
  async runExtraction(
    input: { bytes: Uint8Array },
    operation: () => Promise<ParsedMaterialDerivative>,
  ): Promise<ParsedMaterialDerivative> {
    if (this.limits.maxInputBytes !== undefined && input.bytes.byteLength > this.limits.maxInputBytes) {
      throw new Error("MATERIAL_PARSER_INPUT_LIMIT_EXCEEDED");
    }

    const result = await this.run(operation);
    if (typeof result.text !== "string") {
      throw new Error("MATERIAL_PARSER_OUTPUT_INVALID");
    }
    if (
      this.limits.maxOutputCharacters !== undefined &&
      result.text.length > this.limits.maxOutputCharacters
    ) {
      throw new Error("MATERIAL_PARSER_OUTPUT_LIMIT_EXCEEDED");
    }
    return result;
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
