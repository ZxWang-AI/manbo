export interface SafeExtractionWorkerLimits {
  timeoutMs: number;
  maxInputBytes?: number;
  maxOutputCharacters?: number;
}

export class SafeExtractionWorker {
  constructor(private readonly limits: SafeExtractionWorkerLimits) {
    if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs <= 0) {
      throw new TypeError("timeoutMs must be a positive integer");
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
}
