import { describe, expect, it } from "vitest";

import type {
  MaterialProcessingWorkerRunOptions,
} from "@/server/services/material-processing-worker";
import type { MaterialProcessingWorkerLifecycleSnapshot } from "@/server/services/material-processing-worker-lifecycle";
import { runMaterialProcessingWorkerSupervisor } from "@/server/services/material-processing-worker-supervisor";

const starting: MaterialProcessingWorkerLifecycleSnapshot = {
  state: "starting",
  startedAt: "2026-09-07T00:00:00.000Z",
  changedAt: "2026-09-07T00:00:00.000Z",
  live: true,
  ready: false,
};
const running = { ...starting, state: "running" as const, ready: true };
const draining = { ...starting, state: "draining" as const };
const stopped = { ...starting, state: "stopped" as const, live: false };
const faulted = { ...starting, state: "faulted" as const, live: false };

function outputBuffer() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    output: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
    },
  };
}

describe("material processing worker supervisor", () => {
  it("emits startup, running, stopped, and one metrics summary", async () => {
    const buffer = outputBuffer();
    const worker = {
      status: () => starting,
      run: async (options: MaterialProcessingWorkerRunOptions) => {
        await options.onStateChange?.(running);
        await options.onEvent?.({ type: "job_claimed", jobId: "secret-job", attempts: 1 });
        await options.onEvent?.({ type: "idle" });
        await options.onStateChange?.(draining);
        await options.onStateChange?.(stopped);
        return { stoppedBy: "signal" as const };
      },
    };

    await runMaterialProcessingWorkerSupervisor({
      worker,
      workerId: "worker-a",
      idleDelayMs: 0,
      output: buffer.output,
    });

    expect(buffer.stdout[0]).toBe("material_processing_worker_started");
    expect(buffer.stdout.filter((line) => line.startsWith("material_processing_worker_state"))).toEqual([
      "material_processing_worker_state state=starting live=true ready=false",
      "material_processing_worker_state state=running live=true ready=true",
      "material_processing_worker_state state=draining live=true ready=false",
      "material_processing_worker_state state=stopped live=false ready=false",
    ]);
    expect(buffer.stdout.filter((line) => line.startsWith("material_processing_metrics "))).toHaveLength(1);
    expect(buffer.stdout.at(-2)).toBe("material_processing_worker_stopped");
    expect(buffer.stderr).toEqual([]);
    expect(buffer.stdout.join("\n")).not.toContain("secret-job");
  });

  it("keeps draining output ordered when the abort signal is raised", async () => {
    const buffer = outputBuffer();
    const controller = new AbortController();
    let release!: () => void;
    const worker = {
      status: () => starting,
      run: async (options: MaterialProcessingWorkerRunOptions) => {
        await options.onStateChange?.(running);
        await new Promise<void>((resolve) => { release = resolve; });
        if (options.signal?.aborted) {
          await options.onStateChange?.(draining);
          await options.onStateChange?.(stopped);
        }
        return { stoppedBy: "signal" as const };
      },
    };
    const processing = runMaterialProcessingWorkerSupervisor({
      worker,
      workerId: "worker-a",
      idleDelayMs: 0,
      signal: controller.signal,
      output: buffer.output,
    });
    await Promise.resolve();
    controller.abort();
    release();
    await processing;

    const states = buffer.stdout.filter((line) => line.startsWith("material_processing_worker_state"));
    expect(states.at(-2)).toContain("state=draining");
    expect(states.at(-1)).toContain("state=stopped");
    expect(buffer.stdout.filter((line) => line.startsWith("material_processing_metrics "))).toHaveLength(1);
  });

  it("reports faulted output and rethrows on worker failure", async () => {
    const buffer = outputBuffer();
    const error = new Error("queue unavailable");
    const worker = {
      status: () => starting,
      run: async (options: MaterialProcessingWorkerRunOptions) => {
        await options.onStateChange?.(faulted);
        throw error;
      },
    };

    await expect(runMaterialProcessingWorkerSupervisor({
      worker,
      workerId: "worker-a",
      idleDelayMs: 0,
      output: buffer.output,
    })).rejects.toBe(error);
    expect(buffer.stdout).toContain("material_processing_worker_state state=faulted live=false ready=false");
    expect(buffer.stdout.filter((line) => line.startsWith("material_processing_metrics "))).toHaveLength(1);
    expect(buffer.stdout).not.toContain("material_processing_worker_stopped");
  });
});
