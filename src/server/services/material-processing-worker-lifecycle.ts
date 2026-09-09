export type MaterialProcessingWorkerLifecycleState =
  | "starting"
  | "running"
  | "draining"
  | "stopped"
  | "faulted";

export interface MaterialProcessingWorkerLifecycleSnapshot {
  state: MaterialProcessingWorkerLifecycleState;
  startedAt: string;
  changedAt: string;
  live: boolean;
  ready: boolean;
}

export class MaterialProcessingWorkerLifecycle {
  private state: MaterialProcessingWorkerLifecycleState = "starting";
  private readonly startedAt: string;
  private changedAt: string;

  constructor(private readonly now: () => Date = () => new Date()) {
    this.startedAt = now().toISOString();
    this.changedAt = this.startedAt;
  }

  transition(next: MaterialProcessingWorkerLifecycleState): MaterialProcessingWorkerLifecycleSnapshot {
    if (next === this.state) return this.snapshot();
    if (!isAllowedTransition(this.state, next)) {
      throw new Error("MATERIAL_PROCESSING_WORKER_LIFECYCLE_INVALID");
    }
    this.state = next;
    this.changedAt = this.now().toISOString();
    return this.snapshot();
  }

  snapshot(): MaterialProcessingWorkerLifecycleSnapshot {
    return {
      state: this.state,
      startedAt: this.startedAt,
      changedAt: this.changedAt,
      live: this.state !== "stopped" && this.state !== "faulted",
      ready: this.state === "running",
    };
  }
}

function isAllowedTransition(
  current: MaterialProcessingWorkerLifecycleState,
  next: MaterialProcessingWorkerLifecycleState,
): boolean {
  if (current === "starting") return next === "running" || next === "draining" || next === "faulted";
  if (current === "running") return next === "draining" || next === "stopped" || next === "faulted";
  if (current === "draining") return next === "stopped" || next === "faulted";
  return false;
}
