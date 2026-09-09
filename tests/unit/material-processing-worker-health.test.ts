import { describe, expect, it } from "vitest";

import {
  isMaterialProcessingWorkerAvailable,
  parseMaterialProcessingWorkerStateLine,
} from "@/server/services/material-processing-worker-health";

describe("material processing worker health", () => {
  it("parses the fixed state line without retaining unrelated text", () => {
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=running live=true ready=true",
    )).toEqual({ state: "running", live: true, ready: true });
  });

  it("accepts every lifecycle state with its declared booleans", () => {
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=starting live=true ready=false",
    )).toEqual({ state: "starting", live: true, ready: false });
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=draining live=true ready=false",
    )).toEqual({ state: "draining", live: true, ready: false });
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=stopped live=false ready=false",
    )).toEqual({ state: "stopped", live: false, ready: false });
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=faulted live=false ready=false",
    )).toEqual({ state: "faulted", live: false, ready: false });
  });

  it("rejects malformed, duplicated, or sensitive extra fields", () => {
    expect(parseMaterialProcessingWorkerStateLine("")).toBeNull();
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=unknown live=true ready=false",
    )).toBeNull();
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=running live=true ready=true jobId=secret",
    )).toBeNull();
    expect(parseMaterialProcessingWorkerStateLine(
      "material_processing_worker_state state=running live=TRUE ready=true",
    )).toBeNull();
    expect(parseMaterialProcessingWorkerStateLine(
      "prefix material_processing_worker_state state=running live=true ready=true",
    )).toBeNull();
  });

  it("is available only when the worker is both live and ready", () => {
    expect(isMaterialProcessingWorkerAvailable({ state: "running", live: true, ready: true })).toBe(true);
    expect(isMaterialProcessingWorkerAvailable({ state: "starting", live: true, ready: false })).toBe(false);
    expect(isMaterialProcessingWorkerAvailable({ state: "draining", live: true, ready: false })).toBe(false);
    expect(isMaterialProcessingWorkerAvailable({ state: "faulted", live: false, ready: false })).toBe(false);
  });

  it("rejects contradictory lifecycle flags even when both flags are true", () => {
    expect(isMaterialProcessingWorkerAvailable({ state: "stopped", live: true, ready: true })).toBe(false);
    expect(isMaterialProcessingWorkerAvailable({ state: "faulted", live: true, ready: true })).toBe(false);
  });
});
