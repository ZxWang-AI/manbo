# 材料处理 Worker 监督与健康检查契约设计

> 状态：已确认的本地实现设计（2026-09-07）

## 目标

为材料处理 worker 增加脚本级、可自动化验证的监督契约，明确启动、就绪、排空、正常停止和故障退出的机器可读语义，为后续接入实际进程监督器或容器编排平台提供稳定边界。

## 范围与边界

- 复用现有 `material_processing_worker_state state=<state> live=<bool> ready=<bool>` 状态行和生命周期状态，不新增网络端点。
- 复用现有 `material_processing_metrics ...` 停止摘要，不新增敏感字段或持久化数据。
- 增加脚本级 smoke/health-check 测试，覆盖启动、SIGTERM 排空、正常退出和故障退出路径。
- 运行手册定义外部监督器如何解释状态：`live=false` 表示进程不再提供存活能力，应由外部监督器决定是否重启；`ready=false` 表示不应向该 worker 投递新任务。
- 不在本次范围内引入 Docker、Kubernetes、systemd、云监控后端、告警阈值、自动恢复策略或生产部署配置。

## 生命周期语义

| 状态 | live | ready | 语义 |
| --- | --- | --- | --- |
| `starting` | `true` | `false` | 进程已启动但尚未接受新任务 |
| `running` | `true` | `true` | 可领取并处理任务 |
| `draining` | `true` | `false` | 收到停止信号；完成当前任务，不再领取任务 |
| `stopped` | `false` | `false` | 已正常停止，不应再被投递任务 |
| `faulted` | `false` | `false` | 初始化、队列或处理路径发生不可恢复故障 |

允许的关键转换为：`starting → running|draining|faulted`、`running → draining|stopped|faulted`、`draining → stopped|faulted`。终态不得重新变为 `running`。

## 组件与接口

### 状态行解析器

新增 `src/server/services/material-processing-worker-health.ts`，提供：

- `parseMaterialProcessingWorkerStateLine(line: string): MaterialProcessingWorkerHealth | null`：只接受完整、固定格式的状态行；格式不匹配返回 `null`。
- `MaterialProcessingWorkerHealth` 包含 `state`、`live`、`ready` 三个字段，不保留原始日志行或任何任务标识。
- `isMaterialProcessingWorkerAvailable(health)`：仅当 `state=running` 且 `live && ready` 时返回 `true`，供监督/投递侧判断是否可接收新任务；矛盾状态标志必须拒绝。

解析器只处理状态行，不负责重启、告警或网络通信。

### Worker 入口契约

修改 `scripts/run-material-processing-worker.ts` 的可观察行为：

- 启动后先输出 `starting` 状态，再在成功初始化运行循环后输出 `running`。
- 收到 `SIGTERM`/`SIGINT` 时输出 `draining`，当前任务结束后输出 `stopped` 和一次指标摘要。
- 不可恢复异常输出 `faulted`，保留原错误的非零退出语义，并仍输出一次指标摘要。
- 任一停止路径最多输出一次终态状态和一次指标摘要。

如现有 worker 实现已经满足部分语义，只补齐缺失的状态通知与可测边界，不改变租约、重试、死信和材料安全状态机。

## 错误处理与隐私

- 状态解析遇到空行、未知状态、重复字段、额外字段或非法布尔值时返回 `null`，不得抛出异常阻断监督逻辑。
- 解析与可用性判断不读取或输出 `jobId`、账户/案件/材料 ID、文件名、用户原文、来源摘录、IP、设备标识或凭据。
- 监督契约只表达当前进程状态；重启后状态重新从 `starting` 开始。

## 测试与验收标准

1. 单元测试覆盖所有合法状态行、非法/敏感附加内容、可用性判断和状态转换边界。
2. 脚本级 smoke 测试验证正常启动与停止、SIGTERM 排空顺序、故障状态和非零退出，以及指标摘要只出现一次。
3. 异步状态接收器必须在 `draining` 通知完成后才观察到 `stopped`，不得出现生命周期输出乱序。
4. 测试断言不得依赖任务 ID、账户 ID 或日志中的用户内容。
5. 全量 Vitest、TypeScript、ESLint、Next build、Playwright 和 `git diff --check` 继续通过。
6. 运行手册与发布门禁明确：本次只完成代码级健康检查契约；真实监督器、监控后端、告警阈值、自动恢复和演练仍是生产上线前阻塞项。
