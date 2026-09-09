import { describe, expect, it, vi } from "vitest";

import {
  MaterialProcessingWorker,
  type MaterialProcessingWorkerEvent,
} from "@/server/services/material-processing-worker";

const job = {
  jobId: "job-a",
  accountId: "a".repeat(32),
  caseId: "case-a",
  materialId: "material-a",
  status: "processing" as const,
  attempts: 2,
  maxAttempts: 5,
  availableAt: "2026-09-04T00:00:00.000Z",
  leasedBy: "worker-a",
  leaseUntil: "2026-09-04T00:01:00.000Z",
  createdAt: "2026-09-04T00:00:00.000Z",
};

describe("material processing worker", () => {
  it("claims one job, runs it, and acknowledges completion", async () => {
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
    };
    const runner = vi.fn().mockResolvedValue(undefined);
    const worker = new MaterialProcessingWorker(queue, runner);

    await expect(worker.runOnce("worker-a")).resolves.toBe(true);
    expect(runner).toHaveBeenCalledWith({
      accountId: job.accountId,
      caseId: job.caseId,
      materialId: job.materialId,
    });
    expect(queue.complete).toHaveBeenCalledWith(job.jobId, "worker-a", expect.any(Date));
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("leaves an empty queue idle without invoking the processor", async () => {
    const queue = {
      claimNext: vi.fn().mockResolvedValue(null),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const runner = vi.fn();

    await expect(new MaterialProcessingWorker(queue, runner).runOnce("worker-a")).resolves.toBe(false);
    expect(runner).not.toHaveBeenCalled();
  });

  it("records a retryable failure and never acknowledges failed processing", async () => {
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(true),
    };
    const worker = new MaterialProcessingWorker(queue, async () => {
      throw new Error("scanner unavailable");
    });

    await expect(worker.runOnce("worker-a")).resolves.toBe(true);
    expect(queue.fail).toHaveBeenCalledWith(job.jobId, "worker-a", "PROCESSING_TASK_FAILED", {
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      now: expect.any(Date),
    });
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("emits a dead-letter event after the final failed attempt", async () => {
    const exhaustedJob = { ...job, attempts: 5, maxAttempts: 5 };
    const queue = {
      claimNext: vi.fn().mockResolvedValue(exhaustedJob),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn().mockResolvedValue(true),
    };
    const events: MaterialProcessingWorkerEvent[] = [];
    const worker = new MaterialProcessingWorker(queue, async () => {
      throw new Error("scanner unavailable");
    }, undefined, (event) => events.push(event));

    await expect(worker.runOnce("worker-a")).resolves.toBe(true);
    expect(events).toContainEqual({
      type: "job_dead_lettered",
      jobId: exhaustedJob.jobId,
      attempts: exhaustedJob.attempts,
      maxAttempts: exhaustedJob.maxAttempts,
    });
  });

  it("emits a lease-lost event when another worker wins the completion race", async () => {
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(false),
      fail: vi.fn(),
    };
    const events: MaterialProcessingWorkerEvent[] = [];
    const worker = new MaterialProcessingWorker(queue, vi.fn().mockResolvedValue(undefined), undefined, (event) => events.push(event));

    await expect(worker.runOnce("worker-a")).resolves.toBe(true);
    expect(events).toContainEqual({
      type: "lease_lost",
      jobId: job.jobId,
      operation: "complete",
    });
  });

  it("runs until an abort signal is raised and emits an idle event", async () => {
    const controller = new AbortController();
    const queue = {
      claimNext: vi.fn().mockImplementation(async () => {
        controller.abort();
        return null;
      }),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const events: MaterialProcessingWorkerEvent[] = [];
    const worker = new MaterialProcessingWorker(queue, vi.fn(), undefined, (event) => events.push(event));

    await expect(worker.run({
      workerId: "worker-a",
      signal: controller.signal,
      idleDelayMs: 0,
    })).resolves.toEqual({ stoppedBy: "signal" });
    expect(events).toContainEqual({ type: "idle" });
    expect(queue.claimNext).toHaveBeenCalledTimes(1);
  });

  it("renews its lease while a long-running task is still processing", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const runner = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
    };
    const worker = new MaterialProcessingWorker(
      queue,
      runner,
      () => new Date("2026-09-04T00:00:00.000Z"),
      undefined,
      { leaseDurationMs: 1_000, renewalIntervalMs: 500 },
    );

    const processing = worker.runOnce("worker-a");
    await vi.advanceTimersByTimeAsync(500);
    expect(queue.renew).toHaveBeenCalledWith(job.jobId, "worker-a", expect.any(Date), 1_000);

    release();
    await processing;
    expect(queue.complete).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("does not acknowledge completion after a lease renewal is rejected", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(false),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const events: MaterialProcessingWorkerEvent[] = [];
    const worker = new MaterialProcessingWorker(
      queue,
      () => new Promise<void>((resolve) => { release = resolve; }),
      () => new Date("2026-09-04T00:00:00.000Z"),
      (event) => events.push(event),
      { leaseDurationMs: 1_000, renewalIntervalMs: 500 },
    );

    const processing = worker.runOnce("worker-a");
    await vi.advanceTimersByTimeAsync(500);
    release();
    await processing;

    expect(queue.complete).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: "lease_lost", jobId: job.jobId, operation: "renew" });
    vi.useRealTimers();
  });

  it("rejects a renewal interval that can reach lease expiry", async () => {
    const queue = {
      claimNext: vi.fn().mockResolvedValue(null),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const worker = new MaterialProcessingWorker(
      queue,
      vi.fn(),
      undefined,
      undefined,
      { leaseDurationMs: 1_000, renewalIntervalMs: 1_000 },
    );

    await expect(worker.runOnce("worker-a")).rejects.toThrow("MATERIAL_PROCESSING_RENEWAL_INTERVAL_INVALID");
    expect(queue.claimNext).not.toHaveBeenCalled();
  });

  it("reports running, draining, and stopped while finishing the active task", async () => {
    const controller = new AbortController();
    let release!: () => void;
    let taskStarted!: () => void;
    const started = new Promise<void>((resolve) => { taskStarted = resolve; });
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
    };
    const states: string[] = [];
    const worker = new MaterialProcessingWorker(
      queue,
      () => new Promise<void>((resolve) => {
        release = resolve;
        taskStarted();
      }),
    );

    const processing = worker.run({
      workerId: "worker-a",
      signal: controller.signal,
      idleDelayMs: 0,
      onStateChange: (snapshot) => states.push(snapshot.state),
    });
    await started;
    controller.abort();
    expect(states).toContain("draining");
    release();
    await expect(processing).resolves.toEqual({ stoppedBy: "signal" });
    expect(states).toEqual(["running", "draining", "stopped"]);
    expect(queue.claimNext).toHaveBeenCalledTimes(1);
  });

  it("waits for an asynchronous draining notification before stopped", async () => {
    const controller = new AbortController();
    let releaseTask!: () => void;
    let releaseDrain!: () => void;
    let taskStarted!: () => void;
    const started = new Promise<void>((resolve) => { taskStarted = resolve; });
    const drainNotification = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn().mockResolvedValue(true),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn(),
    };
    const states: string[] = [];
    const worker = new MaterialProcessingWorker(
      queue,
      () => new Promise<void>((resolve) => {
        releaseTask = resolve;
        taskStarted();
      }),
    );

    const processing = worker.run({
      workerId: "worker-a",
      signal: controller.signal,
      idleDelayMs: 0,
      onStateChange: async (snapshot) => {
        if (snapshot.state === "draining") await drainNotification;
        states.push(snapshot.state);
      },
    });
    await started;
    controller.abort();
    releaseTask();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(states).toEqual(["running"]);
    releaseDrain();
    await expect(processing).resolves.toEqual({ stoppedBy: "signal" });
    expect(states).toEqual(["running", "draining", "stopped"]);
  });

  it("reports faulted when the queue cannot be claimed", async () => {
    const error = new Error("database unavailable");
    const queue = {
      claimNext: vi.fn().mockRejectedValue(error),
      renew: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const states: string[] = [];
    const worker = new MaterialProcessingWorker(queue, vi.fn(), undefined, undefined);

    await expect(worker.run({
      workerId: "worker-a",
      idleDelayMs: 0,
      onStateChange: (snapshot) => states.push(snapshot.state),
    })).rejects.toBe(error);
    expect(states).toEqual(["running", "faulted"]);
  });

  it("does not claim another task after the worker has stopped", async () => {
    const controller = new AbortController();
    controller.abort();
    const queue = {
      claimNext: vi.fn().mockResolvedValue(job),
      renew: vi.fn(),
      complete: vi.fn(),
      fail: vi.fn(),
    };
    const worker = new MaterialProcessingWorker(queue, vi.fn());

    await expect(worker.run({
      workerId: "worker-a",
      signal: controller.signal,
      idleDelayMs: 0,
    })).resolves.toEqual({ stoppedBy: "signal" });
    await expect(worker.runOnce("worker-a")).resolves.toBe(false);
    expect(queue.claimNext).not.toHaveBeenCalled();
  });
});
