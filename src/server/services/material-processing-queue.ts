import { randomUUID } from "node:crypto";

export interface MaterialProcessingJobInput {
  accountId: string;
  caseId: string;
  materialId: string;
}

export type MaterialProcessingJobStatus = "pending" | "processing" | "completed" | "failed" | "dead_letter";

export interface MaterialProcessingJob extends MaterialProcessingJobInput {
  jobId: string;
  status: MaterialProcessingJobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  availableAt: string;
  startedAt?: string;
  leaseUntil?: string;
  leasedBy?: string;
  completedAt?: string;
  errorCode?: "PROCESSING_TASK_FAILED";
}

export interface MaterialProcessingQueue {
  enqueue(input: MaterialProcessingJobInput): Promise<MaterialProcessingJob>;
}

export type MaterialProcessingJobRunner = (input: MaterialProcessingJobInput) => Promise<void>;

/**
 * Local adapter used by development and tests. Production should replace this
 * with a durable queue (for example, SQS/Redis/PG-backed) without changing the
 * upload or processing services.
 */
export class InMemoryMaterialProcessingQueue implements MaterialProcessingQueue {
  private readonly jobs = new Map<string, MaterialProcessingJob>();
  private readonly activeByMaterial = new Map<string, string>();
  private readonly running = new Set<Promise<void>>();

  constructor(
    private readonly runner: MaterialProcessingJobRunner,
    private readonly now: () => Date = () => new Date(),
    private readonly idGenerator: () => string = randomUUID,
  ) {}

  async enqueue(input: MaterialProcessingJobInput): Promise<MaterialProcessingJob> {
    const activeKey = this.activeKey(input);
    const activeJobId = this.activeByMaterial.get(activeKey);
    if (activeJobId) {
      const active = this.jobs.get(activeJobId);
      if (active && (active.status === "pending" || active.status === "processing")) return { ...active };
      this.activeByMaterial.delete(activeKey);
    }

    const job: MaterialProcessingJob = {
      ...input,
      jobId: this.idGenerator(),
      status: "pending",
      attempts: 0,
      maxAttempts: 5,
      createdAt: this.now().toISOString(),
      availableAt: this.now().toISOString(),
    };
    this.jobs.set(job.jobId, job);
    this.activeByMaterial.set(activeKey, job.jobId);
    const execution = Promise.resolve().then(() => this.execute(job, activeKey));
    this.running.add(execution);
    void execution.finally(() => this.running.delete(execution));
    return { ...job };
  }

  async get(jobId: string): Promise<MaterialProcessingJob | null> {
    const job = this.jobs.get(jobId);
    return job ? { ...job } : null;
  }

  async drain(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.all([...this.running]);
    }
  }

  private async execute(job: MaterialProcessingJob, activeKey: string): Promise<void> {
    job.status = "processing";
    job.startedAt = this.now().toISOString();
    try {
      await this.runner({
        accountId: job.accountId,
        caseId: job.caseId,
        materialId: job.materialId,
      });
      job.status = "completed";
      job.completedAt = this.now().toISOString();
    } catch {
      job.status = "failed";
      job.errorCode = "PROCESSING_TASK_FAILED";
      job.completedAt = this.now().toISOString();
    } finally {
      if (this.activeByMaterial.get(activeKey) === job.jobId) this.activeByMaterial.delete(activeKey);
    }
  }

  private activeKey(input: MaterialProcessingJobInput): string {
    return `${input.accountId}:${input.caseId}:${input.materialId}`;
  }
}
