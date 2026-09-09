import { describe, expect, it } from "vitest";

import {
  MaterialProcessingWorkerLifecycle,
} from "@/server/services/material-processing-worker-lifecycle";

describe("material processing worker lifecycle", () => {
  it("derives liveness and readiness from the lifecycle state", () => {
    let current = new Date("2026-09-04T09:00:00.000Z");
    const lifecycle = new MaterialProcessingWorkerLifecycle(() => current);

    expect(lifecycle.snapshot()).toMatchObject({
      state: "starting",
      startedAt: "2026-09-04T09:00:00.000Z",
      changedAt: "2026-09-04T09:00:00.000Z",
      live: true,
      ready: false,
    });

    current = new Date("2026-09-04T09:00:01.000Z");
    lifecycle.transition("running");
    expect(lifecycle.snapshot()).toMatchObject({ state: "running", live: true, ready: true });

    current = new Date("2026-09-04T09:00:02.000Z");
    lifecycle.transition("draining");
    expect(lifecycle.snapshot()).toMatchObject({ state: "draining", live: true, ready: false });

    current = new Date("2026-09-04T09:00:03.000Z");
    lifecycle.transition("stopped");
    expect(lifecycle.snapshot()).toMatchObject({ state: "stopped", live: false, ready: false });
  });

  it("does not allow a terminal worker to become ready again", () => {
    const lifecycle = new MaterialProcessingWorkerLifecycle(() => new Date("2026-09-04T09:00:00.000Z"));
    lifecycle.transition("faulted");

    expect(() => lifecycle.transition("running")).toThrow("MATERIAL_PROCESSING_WORKER_LIFECYCLE_INVALID");
  });
});
