# 材料处理队列可观测性契约设计

> 状态：已确认的本地实现设计（2026-09-04）

## 目标

为材料处理 worker 提供一个稳定、可测试且不携带敏感数据的指标契约，并让 worker 入口在停止时输出一行可被日志采集器读取的净化计数摘要。该能力只解决代码级计数和日志格式，不声称已接入生产监控、阈值告警或恢复演练。

## 范围与边界

- 统计 `job_claimed`、`job_completed`、`job_failed`、`job_dead_lettered`、`lease_lost` 和 `idle` 六类现有 worker 事件。
- 仅保存进程内计数和 worker 启动时间；不保存或输出 `jobId`、账户 ID、案件 ID、材料 ID、文件名、用户原文、来源摘录、IP、设备标识或凭据。
- 不新增数据库表、不新增网络端点、不改变队列租约、重试或死信语义。
- 停止摘要使用固定字段顺序和单行文本，便于日志采集器解析；外部指标后端和告警阈值由部署环境另行审查和接入。

## 组件与接口

新增 `src/server/services/material-processing-metrics.ts`：

- `MaterialProcessingWorkerMetrics` 在构造时记录注入时钟生成的 `startedAt`。
- `record(event)` 将事件映射到六个公开计数器；未知事件安全忽略，以兼容未来新增事件。
- `snapshot()` 返回包含 `startedAt` 和计数器副本的不可变快照，调用方修改快照不得影响内部状态。
- `formatMaterialProcessingWorkerMetrics(snapshot)` 生成固定格式：
  `material_processing_metrics started_at=<UTC ISO> jobs_claimed=<n> jobs_completed=<n> jobs_failed=<n> jobs_dead_lettered=<n> leases_lost=<n> idle_polls=<n>`。

修改 `scripts/run-material-processing-worker.ts`：

- 创建指标实例，并在现有净化事件 sink 中先记录事件，再保留原有的死信/租约丢失 stderr 事件。
- worker 停止时输出一行指标摘要；摘要不包含任何任务或用户标识。

## 错误与生命周期

- 指标记录和摘要格式化不得抛出异常阻断任务处理；计数使用安全整数并在达到上限时保持最大安全整数。
- 现有 `notify` 对事件 sink 的异常吞掉策略保持不变。
- 该指标只描述当前 worker 进程生命周期；进程重启后重新开始计数。

## 验收标准

1. 六类事件各自只增加对应计数器，事件中的敏感字段不会出现在快照或摘要中。
2. 快照是防御性副本，格式化结果字段顺序稳定且为单行 UTC 文本。
3. worker 入口接入指标并在正常停止路径输出摘要，同时保留死信和租约丢失的净化 stderr 事件。
4. 新增单元测试先失败后通过；全量 Vitest、TypeScript、ESLint、Next build 和 Playwright 继续通过。
5. 发布门禁仍明确外部监控、阈值告警、进程监督和恢复演练未完成。
