import type { MaterialProcessingJob, MaterialProcessingJobInput } from "./material-processing-queue";
import {
  MaterialProcessingWorkerLifecycle,
  type MaterialProcessingWorkerLifecycleSnapshot,
  type MaterialProcessingWorkerLifecycleState,
} from "./material-processing-worker-lifecycle";

export type MaterialProcessingWorkerEvent =
  | { type: "job_claimed"; jobId: string; attempts: number }
  | { type: "job_completed"; jobId: string }
  | { type: "job_failed"; jobId: string; attempts: number; maxAttempts: number }
  | { type: "job_dead_lettered"; jobId: string; attempts: number; maxAttempts: number }
  | { type: "lease_lost"; jobId: string; operation: "complete" | "fail" | "renew" }
  | { type: "idle" };

export type MaterialProcessingWorkerEventSink = (
  event: MaterialProcessingWorkerEvent,
) => unknown;

export interface MaterialProcessingWorkerRunOptions {
  workerId: string;
  signal?: AbortSignal;
  idleDelayMs?: number;
  onEvent?: MaterialProcessingWorkerEventSink;
  onStateChange?: MaterialProcessingWorkerLifecycleSink;
}

export interface MaterialProcessingWorkerRunResult {
  stoppedBy: "signal";
}

export interface MaterialProcessingWorkerOptions {
  leaseDurationMs?: number;
  renewalIntervalMs?: number;
}

export interface MaterialProcessingWorkerQueue {
  claimNext(workerId: string, options?: { leaseDurationMs?: number }): Promise<MaterialProcessingJob | null>;
  renew(jobId: string, workerId: string, now: Date, leaseDurationMs: number): Promise<boolean>;
  complete(jobId: string, workerId: string, now?: Date): Promise<boolean>;
  fail(
    jobId: string,
    workerId: string,
    errorCode: string,
    options: { now?: Date; attempts: number; maxAttempts: number },
  ): Promise<boolean>;
}

export type MaterialProcessingWorkerRunner = (input: MaterialProcessingJobInput) => Promise<void>;
export type MaterialProcessingWorkerLifecycleSink = (
  snapshot: MaterialProcessingWorkerLifecycleSnapshot,
) => unknown;

export class MaterialProcessingWorker {
  constructor(
    private readonly queue: MaterialProcessingWorkerQueue,
    private readonly runner: MaterialProcessingWorkerRunner,
    private readonly now: () => Date = () => new Date(),
    private readonly eventSink?: MaterialProcessingWorkerEventSink,
    options: MaterialProcessingWorkerOptions = {},
  ) {
    this.leaseDurationMs = options.leaseDurationMs ?? 60_000;
    this.renewalIntervalMs = options.renewalIntervalMs ?? Math.floor(this.leaseDurationMs / 2);
    this.lifecycle = new MaterialProcessingWorkerLifecycle(now);
  }

  private readonly leaseDurationMs: number;
  private readonly renewalIntervalMs: number;
  private readonly lifecycle: MaterialProcessingWorkerLifecycle;

  status(): MaterialProcessingWorkerLifecycleSnapshot {
    return this.lifecycle.snapshot();
  }

  async runOnce(workerId: string, onEvent: MaterialProcessingWorkerEventSink | undefined = this.eventSink): Promise<boolean> {
    const lifecycleState = this.lifecycle.snapshot().state;
    if (lifecycleState === "draining" || lifecycleState === "stopped" || lifecycleState === "faulted") {
      return false;
    }
    validateLeaseOptions(this.leaseDurationMs, this.renewalIntervalMs);
    const job = await this.queue.claimNext(workerId, { leaseDurationMs: this.leaseDurationMs });
    if (!job) return false;
    await notify(onEvent, { type: "job_claimed", jobId: job.jobId, attempts: job.attempts });

    let leaseLost = false;
    let renewalInFlight: Promise<void> | undefined;

    const renewLease = async (): Promise<void> => {
      if (leaseLost) return;
      try {
        const renewed = await this.queue.renew(job.jobId, workerId, this.now(), this.leaseDurationMs);
        if (!renewed) {
          leaseLost = true;
          await notify(onEvent, { type: "lease_lost", jobId: job.jobId, operation: "renew" });
        }
      } catch {
        leaseLost = true;
        await notify(onEvent, { type: "lease_lost", jobId: job.jobId, operation: "renew" });
      }
    };

    const startRenewal = (): void => {
      if (leaseLost || renewalInFlight) return;
      const renewal = renewLease();
      renewalInFlight = renewal;
      void renewal.then(
        () => {
          if (renewalInFlight === renewal) renewalInFlight = undefined;
        },
        () => {
          if (renewalInFlight === renewal) renewalInFlight = undefined;
        },
      );
    };

    const renewalTimer = setInterval(startRenewal, this.renewalIntervalMs);
    let runnerSucceeded = false;
    try {
      await this.runner({
        accountId: job.accountId,
        caseId: job.caseId,
        materialId: job.materialId,
      });
      runnerSucceeded = true;
    } catch {
      runnerSucceeded = false;
    } finally {
      clearInterval(renewalTimer);
      if (renewalInFlight) await renewalInFlight;
    }

    if (leaseLost) return true;

    if (runnerSucceeded) {
      const completed = await this.queue.complete(job.jobId, workerId, this.now());
      if (completed) {
        await notify(onEvent, { type: "job_completed", jobId: job.jobId });
      } else {
        await notify(onEvent, { type: "lease_lost", jobId: job.jobId, operation: "complete" });
      }
    } else {
      const failed = await this.queue.fail(job.jobId, workerId, "PROCESSING_TASK_FAILED", {
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        now: this.now(),
      });
      if (!failed) {
        await notify(onEvent, { type: "lease_lost", jobId: job.jobId, operation: "fail" });
      } else if (job.attempts >= job.maxAttempts) {
        await notify(onEvent, {
          type: "job_dead_lettered",
          jobId: job.jobId,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
        });
      } else {
        await notify(onEvent, {
          type: "job_failed",
          jobId: job.jobId,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
        });
      }
    }
    return true;
  }

  async run(options: MaterialProcessingWorkerRunOptions): Promise<MaterialProcessingWorkerRunResult> {
    const workerId = options.workerId.trim();
    const idleDelayMs = options.idleDelayMs ?? 1_000;
    let abortHandler: (() => void) | undefined;
    let drainingNotification: Promise<void> | undefined;
    try {
      if (!workerId) throw new Error("MATERIAL_PROCESSING_WORKER_ID_INVALID");
      if (!Number.isSafeInteger(idleDelayMs) || idleDelayMs < 0 || idleDelayMs > 60_000) {
        throw new Error("MATERIAL_PROCESSING_IDLE_DELAY_INVALID");
      }

      if (options.signal?.aborted) {
        await setLifecycleState(this.lifecycle, "draining", options.onStateChange);
      } else {
        await setLifecycleState(this.lifecycle, "running", options.onStateChange);
        abortHandler = () => {
          if (this.lifecycle.snapshot().state !== "running") return;
          const snapshot = this.lifecycle.transition("draining");
          drainingNotification = notifyLifecycle(options.onStateChange, snapshot);
        };
        options.signal?.addEventListener("abort", abortHandler, { once: true });
      }

      while (!options.signal?.aborted) {
        const didWork = await this.runOnce(workerId, options.onEvent);
        if (didWork) continue;
        await notify(options.onEvent ?? this.eventSink, { type: "idle" });
        await waitForIdle(idleDelayMs, options.signal);
      }

      if (this.lifecycle.snapshot().state === "running") {
        await setLifecycleState(this.lifecycle, "draining", options.onStateChange);
      }
      if (drainingNotification) await drainingNotification;
      await setLifecycleState(this.lifecycle, "stopped", options.onStateChange);
      return { stoppedBy: "signal" };
    } catch (error) {
      if (drainingNotification) await drainingNotification;
      const current = this.lifecycle.snapshot().state;
      if (current !== "stopped" && current !== "faulted") {
        await setLifecycleState(this.lifecycle, "faulted", options.onStateChange);
      }
      throw error;
    } finally {
      if (abortHandler) options.signal?.removeEventListener("abort", abortHandler);
    }
  }
}

function validateLeaseOptions(leaseDurationMs: number, renewalIntervalMs: number): void {
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > 15 * 60_000) {
    throw new Error("MATERIAL_PROCESSING_LEASE_INVALID");
  }
  if (!Number.isSafeInteger(renewalIntervalMs) || renewalIntervalMs < 1 || renewalIntervalMs >= leaseDurationMs) {
    throw new Error("MATERIAL_PROCESSING_RENEWAL_INTERVAL_INVALID");
  }
}

async function notify(
  sink: MaterialProcessingWorkerEventSink | undefined,
  event: MaterialProcessingWorkerEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(event);
  } catch {
    // Telemetry and alerting must never stop material processing.
  }
}

async function setLifecycleState(
  lifecycle: MaterialProcessingWorkerLifecycle,
  state: MaterialProcessingWorkerLifecycleState,
  sink: MaterialProcessingWorkerLifecycleSink | undefined,
): Promise<void> {
  const snapshot = lifecycle.transition(state);
  await notifyLifecycle(sink, snapshot);
}

async function notifyLifecycle(
  sink: MaterialProcessingWorkerLifecycleSink | undefined,
  snapshot: MaterialProcessingWorkerLifecycleSnapshot,
): Promise<void> {
  if (!sink) return;
  try {
    await sink(snapshot);
  } catch {
    // Status reporting must never stop processing or shutdown.
  }
}

function waitForIdle(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs === 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const handle: { timer?: ReturnType<typeof setTimeout> } = {};
    const finish = () => {
      if (handle.timer) clearTimeout(handle.timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    handle.timer = setTimeout(finish, delayMs);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
