import type { MaterialProcessingWorkerLifecycleState } from "./material-processing-worker-lifecycle";

export interface MaterialProcessingWorkerHealth {
  state: MaterialProcessingWorkerLifecycleState;
  live: boolean;
  ready: boolean;
}

const statePattern = /^material_processing_worker_state state=(starting|running|draining|stopped|faulted) live=(true|false) ready=(true|false)$/;

export function parseMaterialProcessingWorkerStateLine(
  line: string,
): MaterialProcessingWorkerHealth | null {
  const match = statePattern.exec(line);
  if (!match) return null;
  return {
    state: match[1] as MaterialProcessingWorkerLifecycleState,
    live: match[2] === "true",
    ready: match[3] === "true",
  };
}

export function isMaterialProcessingWorkerAvailable(
  health: MaterialProcessingWorkerHealth,
): boolean {
  return health.state === "running" && health.live && health.ready;
}
