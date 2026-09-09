# 材料处理队列可观测性实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为材料处理 worker 增加不含敏感数据的进程内事件计数和停止摘要，为后续生产监控接入提供稳定契约。

**Architecture:** 新增独立指标模块，将现有 worker 事件映射到固定计数器并返回防御性快照；worker 入口组合该模块与现有净化事件报告器，在停止时输出固定顺序的单行摘要。队列数据库模型、租约和任务处理逻辑不变，外部监控后端与告警仍由部署环境负责。

**Tech Stack:** TypeScript strict、Vitest、Node.js worker entrypoint。

## Global Constraints

- 不输出或保存 `jobId`、账户/案件/材料 ID、文件名、用户原文、来源摘录、IP、设备标识或凭据。
- 不改变队列租约、重试、死信或材料安全状态机语义。
- 指标仅覆盖当前进程生命周期，不新增数据库表或网络端点。
- 不执行 commit、push 或 merge。

## Task 1: Add the metrics contract and sanitized worker summary

**Files:**

- Create: `src/server/services/material-processing-metrics.ts`
- Create: `tests/unit/material-processing-metrics.test.ts`
- Modify: `scripts/run-material-processing-worker.ts`
- Modify: `tests/unit/tooling-contract.test.ts`

**Interfaces:**

- Consumes: `MaterialProcessingWorkerEvent` from `src/server/services/material-processing-worker.ts`.
- Produces: `MaterialProcessingWorkerMetrics`, `MaterialProcessingWorkerMetricsSnapshot`, and `formatMaterialProcessingWorkerMetrics(snapshot)`.

- [ ] **Step 1: Write the failing test**

Add tests that construct metrics with a fixed clock, record all six event kinds, assert the six counters and `startedAt`, mutate a returned snapshot to prove defensive copying, and assert the fixed one-line formatter never contains a job ID:

```ts
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
  expect(line).toBe("material_processing_metrics started_at=2026-09-04T08:00:00.000Z jobs_claimed=1 jobs_completed=1 jobs_failed=1 jobs_dead_lettered=1 leases_lost=1 idle_polls=1");
  expect(line).not.toContain("secret-job");
});
```

Extend the tooling contract test to require the worker entrypoint references the metrics module and its formatter.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/material-processing-metrics.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1
```

Expected: FAIL because the metrics module and worker integration do not exist.

- [ ] **Step 3: Implement the minimal metrics module**

Implement the six counters, a constructor clock defaulting to `new Date()`, a switch-based `record` that ignores unknown runtime events, a defensive `snapshot`, and the exact fixed-order formatter. Keep all fields numeric or UTC text; never copy event identifiers into state.

- [ ] **Step 4: Wire the worker entrypoint**

Instantiate metrics before the worker run, wrap the existing `reportEvent` sink so it records then emits the existing sanitized stderr events, and print `formatMaterialProcessingWorkerMetrics(metrics.snapshot())` once in the existing `finally` block after the worker exits. Do not alter startup guards or signal handling.

- [ ] **Step 5: Run focused tests and verify they pass**

Run the same Vitest command from Step 2. Expected: PASS with the new metrics test and the existing tooling contract.

- [ ] **Step 6: Run project verification**

Run:

```powershell
node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1
node node_modules/typescript/bin/tsc --noEmit
node node_modules/eslint/bin/eslint.js . --max-warnings=0
node node_modules/next/dist/bin/next build
node_modules/.bin/playwright.CMD test --workers=1
git diff --check
```

Expected: all commands exit successfully; Playwright reports 17 passed tests; no diff-check errors.

- [ ] **Step 7: Update operational evidence without claiming production readiness**

Add a runbook row for the focused metrics contract test and revise the worker paragraph to state that code-level counters and a sanitized stop summary exist, while external metrics collection, alert thresholds, supervision and recovery drills remain blocking. Do not mark Gate 1 as passed.

