import {
  formatMaterialProcessingWorkerMetrics,
  MaterialProcessingWorkerMetrics,
} from "./material-processing-metrics";
import type {
  MaterialProcessingWorkerEvent,
  MaterialProcessingWorkerRunOptions,
  MaterialProcessingWorkerRunResult,
} from "./material-processing-worker";
import type { MaterialProcessingWorkerLifecycleSnapshot } from "./material-processing-worker-lifecycle";

export interface MaterialProcessingWorkerSupervisorOutput {
  stdout(line: string): void;
  stderr(line: string): void;
}

export interface MaterialProcessingWorkerSupervisorWorker {
  status(): MaterialProcessingWorkerLifecycleSnapshot;
  run(options: MaterialProcessingWorkerRunOptions): Promise<MaterialProcessingWorkerRunResult>;
}

export interface MaterialProcessingWorkerSupervisorOptions {
  worker: MaterialProcessingWorkerSupervisorWorker;
  workerId: string;
  idleDelayMs: number;
  signal?: AbortSignal;
  output: MaterialProcessingWorkerSupervisorOutput;
  metrics?: MaterialProcessingWorkerMetrics;
}

export async function runMaterialProcessingWorkerSupervisor(
  options: MaterialProcessingWorkerSupervisorOptions,
): Promise<void> {
  const metrics = options.metrics ?? new MaterialProcessingWorkerMetrics();
  options.output.stdout("material_processing_worker_started");
  writeState(options.output, options.worker.status());

  try {
    const runOptions: MaterialProcessingWorkerRunOptions = {
      workerId: options.workerId,
      idleDelayMs: options.idleDelayMs,
      onEvent: (event) => reportEvent(options.output, metrics, event),
      onStateChange: (snapshot) => writeState(options.output, snapshot),
      ...(options.signal ? { signal: options.signal } : {}),
    };
    await options.worker.run(runOptions);
    options.output.stdout("material_processing_worker_stopped");
  } finally {
    options.output.stdout(formatMaterialProcessingWorkerMetrics(metrics.snapshot()));
  }
}

function reportEvent(
  output: MaterialProcessingWorkerSupervisorOutput,
  metrics: MaterialProcessingWorkerMetrics,
  event: MaterialProcessingWorkerEvent,
): void {
  metrics.record(event);
  if (event.type === "job_dead_lettered") {
    output.stderr("material_processing_dead_letter");
  } else if (event.type === "lease_lost") {
    output.stderr("material_processing_lease_lost");
  }
}

function writeState(
  output: MaterialProcessingWorkerSupervisorOutput,
  snapshot: MaterialProcessingWorkerLifecycleSnapshot,
): void {
  output.stdout(
    `material_processing_worker_state state=${snapshot.state} live=${snapshot.live} ready=${snapshot.ready}`,
  );
}
