# 材料处理 Worker 监督与健康检查契约实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为材料处理 worker 增加可解析的 liveness/readiness 状态契约和可自动化验证的启动、排空、正常停止、故障退出监督流程。

**Architecture:** 新增纯函数状态行解析器，并把 worker 入口的输出、指标、生命周期回调编排抽到一个无数据库依赖的 supervisor service。脚本只负责环境校验、真实 worker/数据库组装、信号绑定和调用 supervisor；外部进程监督器、监控后端和告警仍由部署环境负责。

**Tech Stack:** TypeScript strict、Node.js、Vitest、Next.js App Router 项目现有 worker runtime。

## Global Constraints

- 不执行 `git commit`、`git push` 或 `git merge`。
- 不输出或保存 `jobId`、账户/案件/材料 ID、文件名、用户原文、来源摘录、IP、设备标识或凭据。
- 不改变队列租约、重试、死信或材料安全状态机语义。
- 不新增 HTTP 健康端点、Docker/Kubernetes/systemd 配置、外部指标后端、告警阈值或自动恢复实现。
- 当前本地 Node 25.8.2 / pnpm 9.15.9 的结果只能作为本地回归证据；发布门禁仍需 Node 22.14.x / pnpm 11.24.0。

## 文件结构

- Create: `src/server/services/material-processing-worker-health.ts` — 固定状态行解析与可用性判断，不保存原始日志。
- Create: `src/server/services/material-processing-worker-supervisor.ts` — 无数据库依赖的 worker 输出编排，确保停止摘要只输出一次。
- Create: `tests/unit/material-processing-worker-health.test.ts` — 合法/非法状态行和可用性单元测试。
- Create: `tests/unit/material-processing-worker-supervisor.test.ts` — 正常、SIGTERM 排空和故障 smoke 契约测试。
- Modify: `scripts/run-material-processing-worker.ts` — 使用 supervisor service，保留显式启用检查、Prisma 连接和信号绑定。
- Modify: `tests/unit/tooling-contract.test.ts` — 约束脚本接入 health parser/supervisor 与既有状态/指标输出。
- Modify: `docs/operations-runbook.md`、`docs/deployment.md`、`docs/release-gates.md` — 记录消费规则、证据和未完成的生产门禁。

### Task 1: Add the state-line health contract

**Files:**

- Create: `src/server/services/material-processing-worker-health.ts`
- Create: `tests/unit/material-processing-worker-health.test.ts`

**Interfaces:** `MaterialProcessingWorkerHealth { state, live, ready }`; `parseMaterialProcessingWorkerStateLine(line: string): MaterialProcessingWorkerHealth | null`; `isMaterialProcessingWorkerAvailable(health): boolean`。

- [ ] **Step 1: Write the failing parser tests**

测试四个合法状态行，断言 `running` 仅在 `live=true ready=true` 时可用；测试空行、未知状态、重复/额外字段、大小写布尔值和前缀文本均返回 `null`。测试只断言状态字段，不使用任务或用户标识。

建议最小测试输入：

`material_processing_worker_state state=running live=true ready=true` → `{ state: "running", live: true, ready: true }`。

`material_processing_worker_state state=running live=true ready=true jobId=secret` → `null`。

- [ ] **Step 2: Run the parser test to verify it fails**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker-health.test.ts --pool=threads --maxWorkers=1`

Expected: FAIL because `material-processing-worker-health.ts` does not exist.

- [ ] **Step 3: Implement the minimal parser**

使用锚定正则只接受完整格式：`^material_processing_worker_state state=(starting|running|draining|stopped|faulted) live=(true|false) ready=(true|false)$`。返回新的对象，不保留原始行；格式不符返回 `null`。可用性实现为 `health.state === "running" && health.live && health.ready`，矛盾状态标志不可投递。

- [ ] **Step 4: Run parser tests and typecheck**

Run the focused Vitest command above, then `node node_modules/typescript/bin/tsc --noEmit`。Expected: tests and typecheck PASS。

### Task 2: Extract a testable supervisor output contract

**Files:**

- Create: `src/server/services/material-processing-worker-supervisor.ts`
- Create: `tests/unit/material-processing-worker-supervisor.test.ts`
- Modify: `scripts/run-material-processing-worker.ts`
- Modify: `tests/unit/tooling-contract.test.ts`

**Interfaces:** `runMaterialProcessingWorkerSupervisor(options): Promise<void>`；options 接受现有 worker 的 `status()`、`run()`、`workerId`、`idleDelayMs`、可选 `signal`，以及 `output.stdout(line)` / `output.stderr(line)`。

- [ ] **Step 1: Write failing supervisor smoke tests**

使用无数据库 fake worker，分别覆盖：

1. resolved run：stdout 顺序为 `material_processing_worker_started`、starting/running/draining/stopped 状态行、`material_processing_worker_stopped`、恰好一行 `material_processing_metrics`；idle 事件只增加摘要计数，不进入日志原文。
2. 已 abort 的 signal：fake worker 完成当前任务后报告 `draining`、`stopped`；断言 draining 在 stopped 之前，摘要只出现一次。
3. rejected run：fake worker 报告 faulted 后抛出原错误；断言输出 faulted、摘要一次、没有 stopped 文本，原错误被重新抛出。
4. 真实 worker 的异步状态接收器：断言 `draining` 通知完成前不会输出 `stopped`，避免异步监控适配器观察到乱序生命周期。

断言 stderr 只允许已有的 `material_processing_dead_letter` 或 `material_processing_lease_lost`，并断言输出不包含 `jobId`、账户/案件/材料 ID 或叙述。

- [ ] **Step 2: Run smoke tests to verify they fail**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker-supervisor.test.ts --pool=threads --maxWorkers=1`

Expected: FAIL because the supervisor module does not exist。

- [ ] **Step 3: Implement the supervisor minimally**

创建进程内 `MaterialProcessingWorkerMetrics`；写入启动行和 `worker.status()`；调用 worker.run，并把事件映射到计数器及两个现有净化 stderr 事件，把生命周期快照格式化为固定状态行；resolved 时写 stopped；`finally` 无论 resolved/rejected 都写且只写一次指标摘要；rejected 时不替换原错误。绝不序列化 event 的任何属性。

- [ ] **Step 4: Run smoke tests to verify they pass**

Run the command from Step 2. Expected: PASS with the three smoke tests。

- [ ] **Step 5: Refactor the executable script**

保留 `MATERIAL_PROCESSING_WORKER_ENABLED`、`APP_MODE=static` 拒绝、worker/Prisma/object storage 创建、`AbortController`、`SIGINT`/`SIGTERM` 监听和 `$disconnect()`；删除脚本内重复的 metrics、state、event formatting，改为调用 supervisor。信号监听必须在 supervisor 完成后移除。

- [ ] **Step 6: Extend tooling contract tests**

要求脚本引用 `material-processing-worker-supervisor`、`runMaterialProcessingWorkerSupervisor`、`SIGTERM`；要求 health module 使用 `material_processing_worker_state` 前缀；保留对 `material_processing_metrics` 的接线断言。

Run: `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker-health.test.ts tests/unit/material-processing-worker-supervisor.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1`

Expected: PASS。

### Task 3: Update operational evidence and release wording

**Files:** `docs/operations-runbook.md`, `docs/deployment.md`, `docs/release-gates.md`

- [ ] **Step 1: Document state consumption**

在持久化 worker 段落加入：监督器只解析完整状态行；仅 `state=running live=true ready=true` 可投递；`starting`/`draining`/`stopped`/`faulted` 均不可投递；`live=false` 由外部监督器按自身策略决定是否重启；仓库只提供输出契约和本地测试，不提供监督器、告警或自动恢复。

- [ ] **Step 2: Add focused evidence**

新增运行手册证据行，记录 health/supervisor/tooling focused Vitest 命令及 PASS 结果，并注明这不能证明真实监督器、生产告警或恢复演练已完成。

- [ ] **Step 3: Preserve release blockers**

保持 worker 相关 Gate 未勾选；明确真实 PostgreSQL rehearsal、受监督部署、外部积压/失败/死信指标、阈值告警、重启策略和恢复演练仍是阻塞项，不得写成生产就绪。

- [ ] **Step 4: Run documentation governance tests**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/documentation-governance.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1`

Expected: PASS。

### Task 4: Full local verification

- [ ] **Step 1: Focused worker regression**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker-health.test.ts tests/unit/material-processing-worker-supervisor.test.ts tests/unit/material-processing-worker.test.ts tests/unit/material-processing-worker-lifecycle.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1`

Expected: PASS；原有租约、重试、死信、drain 和 faulted 行为不变。

- [ ] **Step 2: All Vitest**

Run: `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1`。Expected: 全部单元测试 PASS。

- [ ] **Step 3: Static/build checks**

Run: `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/eslint/bin/eslint.js . --max-warnings=0`; `node node_modules/next/dist/bin/next build`。Expected: 全部退出码 0，无 ESLint warning。

- [ ] **Step 4: Browser and diff checks**

Run: `node_modules/.bin/playwright.CMD test --workers=1`; `git diff --check`。Expected: Playwright 继续通过，diff check 无错误；不执行 commit/push/merge。

## Self-review

- 状态解析、supervisor 编排、脚本接线、文档证据和全量验证均有独立任务。
- 任务覆盖启动、排空、正常停止、故障退出、敏感字段排除和摘要单次输出。
- 计划没有引入真实 supervisor、监控后端、告警、自动恢复或生产凭据，因此不扩大现有生产声明。
