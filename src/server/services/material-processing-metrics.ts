import type { MaterialProcessingWorkerEvent } from "./material-processing-worker";

export interface MaterialProcessingWorkerMetricCounters {
  jobsClaimed: number;
  jobsCompleted: number;
  jobsFailed: number;
  jobsDeadLettered: number;
  leasesLost: number;
  idlePolls: number;
}

export interface MaterialProcessingWorkerMetricsSnapshot {
  startedAt: string;
  counters: MaterialProcessingWorkerMetricCounters;
}

const emptyCounters = (): MaterialProcessingWorkerMetricCounters => ({
  jobsClaimed: 0,
  jobsCompleted: 0,
  jobsFailed: 0,
  jobsDeadLettered: 0,
  leasesLost: 0,
  idlePolls: 0,
});

export class MaterialProcessingWorkerMetrics {
  private readonly startedAt: string;
  private readonly counters = emptyCounters();

  constructor(now: () => Date = () => new Date()) {
    this.startedAt = now().toISOString();
  }

  record(event: MaterialProcessingWorkerEvent): void {
    switch (event.type) {
      case "job_claimed":
        this.counters.jobsClaimed = incrementSafely(this.counters.jobsClaimed);
        break;
      case "job_completed":
        this.counters.jobsCompleted = incrementSafely(this.counters.jobsCompleted);
        break;
      case "job_failed":
        this.counters.jobsFailed = incrementSafely(this.counters.jobsFailed);
        break;
      case "job_dead_lettered":
        this.counters.jobsDeadLettered = incrementSafely(this.counters.jobsDeadLettered);
        break;
      case "lease_lost":
        this.counters.leasesLost = incrementSafely(this.counters.leasesLost);
        break;
      case "idle":
        this.counters.idlePolls = incrementSafely(this.counters.idlePolls);
        break;
      default:
        break;
    }
  }

  snapshot(): MaterialProcessingWorkerMetricsSnapshot {
    return {
      startedAt: this.startedAt,
      counters: { ...this.counters },
    };
  }
}

export function formatMaterialProcessingWorkerMetrics(
  snapshot: MaterialProcessingWorkerMetricsSnapshot,
): string {
  const startedAt = snapshot.startedAt.replace(/[\r\n]/g, "_");
  const { counters } = snapshot;
  return [
    "material_processing_metrics",
    `started_at=${startedAt}`,
    `jobs_claimed=${counters.jobsClaimed}`,
    `jobs_completed=${counters.jobsCompleted}`,
    `jobs_failed=${counters.jobsFailed}`,
    `jobs_dead_lettered=${counters.jobsDeadLettered}`,
    `leases_lost=${counters.leasesLost}`,
    `idle_polls=${counters.idlePolls}`,
  ].join(" ");
}

function incrementSafely(value: number): number {
  return value >= Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : value + 1;
}
