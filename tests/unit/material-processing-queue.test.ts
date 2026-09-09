import { describe, expect, it, vi } from "vitest";

import { InMemoryMaterialProcessingQueue } from "@/server/services/material-processing-queue";

describe("material processing queue", () => {
  it("runs a completed-upload task asynchronously and exposes its terminal state", async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const queue = new InMemoryMaterialProcessingQueue(runner);

    const accepted = await queue.enqueue({
      accountId: "a".repeat(32),
      caseId: "case-a",
      materialId: "material-a",
    });

    expect(accepted.status).toBe("pending");
    await queue.drain();

    expect(runner).toHaveBeenCalledWith({
      accountId: "a".repeat(32),
      caseId: "case-a",
      materialId: "material-a",
    });
    await expect(queue.get(accepted.jobId)).resolves.toMatchObject({ status: "completed" });
  });

  it("deduplicates a material while its earlier task is still active", async () => {
    let release!: () => void;
    const runner = vi.fn().mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const queue = new InMemoryMaterialProcessingQueue(runner);
    const input = { accountId: "a".repeat(32), caseId: "case-a", materialId: "material-a" };

    const first = await queue.enqueue(input);
    const second = await queue.enqueue(input);

    expect(second.jobId).toBe(first.jobId);
    expect(runner).toHaveBeenCalledTimes(1);
    release();
    await queue.drain();
  });

  it("records runner failures without exposing them as a successful completion", async () => {
    const queue = new InMemoryMaterialProcessingQueue(async () => {
      throw new Error("scanner unavailable");
    });

    const accepted = await queue.enqueue({
      accountId: "a".repeat(32),
      caseId: "case-a",
      materialId: "material-a",
    });
    await queue.drain();

    await expect(queue.get(accepted.jobId)).resolves.toMatchObject({
      status: "failed",
      errorCode: "PROCESSING_TASK_FAILED",
    });
  });
});
