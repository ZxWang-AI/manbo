import { describe, expect, it } from "vitest";

import {
  formatMaterialProcessingWorkerMetrics,
  MaterialProcessingWorkerMetrics,
} from "@/server/services/material-processing-metrics";

describe("material processing worker metrics", () => {
  it("counts worker events without retaining identifiers", () => {
    const metrics = new MaterialProcessingWorkerMetrics(() => new Date("2026-09-04T08:00:00.000Z"));
    metrics.record({ type: "job_claimed", jobId: "secret-job", attempts: 1 });
    metrics.record({ type: "job_completed", jobId: "secret-job" });
    metrics.record({ type: "job_failed", jobId: "secret-job", attempts: 1, maxAttempts: 5 });
    metrics.record({ type: "job_dead_lettered", jobId: "secret-job", attempts: 5, maxAttempts: 5 });
    metrics.record({ type: "lease_lost", jobId: "secret-job", operation: "renew" });
    metrics.record({ type: "idle" });

    const snapshot = metrics.snapshot();
    expect(snapshot).toEqual({
      startedAt: "2026-09-04T08:00:00.000Z",
      counters: {
        jobsClaimed: 1,
        jobsCompleted: 1,
        jobsFailed: 1,
        jobsDeadLettered: 1,
        leasesLost: 1,
        idlePolls: 1,
      },
    });
    snapshot.counters.jobsClaimed = 99;
    expect(metrics.snapshot().counters.jobsClaimed).toBe(1);
    const line = formatMaterialProcessingWorkerMetrics(metrics.snapshot());
    expect(line).toBe(
      "material_processing_metrics started_at=2026-09-04T08:00:00.000Z jobs_claimed=1 jobs_completed=1 jobs_failed=1 jobs_dead_lettered=1 leases_lost=1 idle_polls=1",
    );
    expect(line).not.toContain("secret-job");
  });
});
