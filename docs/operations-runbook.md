# Manbo 运行与发布证据手册

> 版本：v0.1（2026-09-04）  
> 适用范围：本地验证、受控部署准备；不是生产运维承诺。

## 1. 当前运行边界

- 应用默认私密；它整理用户自述、材料元数据和渠道导航，不代表官方认定，也不代用户提交。
- AI 只做第一次结构化整理。模型超时、拒答、输出校验失败或知识库不可用时，必须回退到静态安全提示，并且不把本轮标记为已保存或已提交。
- 当前工作树尚未连接经审查的生产对象存储、KMS、恶意文件扫描队列、OIDC/SSO 或备份恢复系统。因此 Gate 1 生产托管仍为阻断状态。Gateway 的应用内 Provider 工厂已接通，但尚未对经审查的真实网关进行端到端演练。PostgreSQL 集成测试使用隔离的临时本地集群完成，不能替代生产数据库演练。
- 用户主动删除前无默认到期时间；上线前必须证明主记录、消息、材料、转写、包裹密钥、索引、缓存和备份队列均可清理。
- 材料上传完成后的数据库落库是原始材料保存的权威步骤。仅在首次完成落库后，服务才会尝试把 `{ accountId, caseId, materialId }` 送入材料处理队列；排队失败不能回滚完成状态、删除对象或释放已经使用的配额。用户可稍后发起重试。
- Web 请求路径默认仍使用仅供本地开发和受控 staging 验证的进程内适配器；进程重启会丢失尚未完成的任务，因此默认模式绝不能作为生产异步处理基础设施。设置 `MATERIAL_PROCESSING_QUEUE=durable` 后，API 入队改写 PostgreSQL 持久化队列；持久化 PostgreSQL 队列模型、账户/案件/材料三元组活动任务去重、租约回收、退避重试和 `dead_letter` 状态已加入代码。worker 现有事件可汇总为不含任务/用户标识的进程内计数，并在停止时输出固定格式摘要；生命周期契约区分 `starting`、`running`、`draining`、`stopped` 和 `faulted`，只有 `running` 为 ready，收到停止信号后不再领取新任务。真实 PostgreSQL 生产演练、受监督 worker 进程部署、外部指标采集/阈值告警和恢复演练仍未完成。
- AI 只能使用状态为 `parsed` 且 `eligibleForAi=true` 的、具有来源关联的派生内容。`quarantined`、`scanning`、`scan_failed`、`saved_unread`、`parse_queued` 和 `blocked_malicious` 中的原始材料都必须保留在 AI 输入之外。解析阶段现在还强制执行输入字节上限、输出字符上限、解析超时和严格派生结果 schema；任何超限、超时或非法引用/来源片段都回退为 `saved_unread`，不会创建 AI 可用派生内容。
- 对话“停止生成”必须作为端到端取消处理：浏览器取消请求后，AbortSignal 传播到编排器、各 AI 步骤和 Gateway fetch。每项尚未开始的持久化副作用前均检查取消；在首项写入前观察到取消时路由返回 HTTP `499`，不写入 assistant 回复、案件补丁或 `model_fallback` 审计，用户消息仍可保留。若取消发生在一项数据库操作已开始之后，该操作的事务自行决定提交或回滚；路由不得开始任何后续写入，且不得宣称已回滚该操作。
- 系统默认 Node.js 为 `25.8.2`、pnpm 为 `9.15.9`；项目要求 Node.js `22.14.x`、pnpm `11.24.0`。本轮已使用临时 Node `22.14.0` + Corepack pnpm `11.24.0` 完成严格版本复验；系统默认版本仍不应用于发布。

## 2. 启动与安全降级

### 本地开发

```powershell
node --version
node_modules\.bin\next.CMD dev --hostname 127.0.0.1 --port 3000
```

开发环境可以使用 `AI_PROVIDER=mock`。生产环境禁止 mock provider；必须配置经审查的 gateway、模型别名、区域和留存策略 ID。`AI_PROVIDER=gateway` 时应用只会在 URL、token、模型别名、区域和经审查留存策略均通过严格校验后创建 Gateway Provider；校验失败或网关失败均安全降级，不会回退到本地 Provider，也不得记录或返回凭据。

如需在本地或受控 staging 演练加密材料上传，额外设置以下变量（不要在生产环境设置）：

```powershell
$env:MATERIAL_OBJECT_STORE = "local"
$env:MATERIAL_OBJECT_STORE_ROOT = "D:\\Manbo\\private-materials"
$env:MATERIAL_OBJECT_STORE_MASTER_KEY = "<64 位十六进制随机值>"
$env:MATERIAL_OBJECT_STORE_KEY_VERSION = "local-kek-v1"
```

适配器会在分片写入时立即使用 AES-256-GCM 加密，完成时校验大小和 SHA-256；中止或删除会清理本地对象。该适配器仅用于验证接口与安全状态机，不能替代生产 S3/KMS、隔离扫描和备份恢复演练。

### 材料处理与重试

完成上传后，应用会异步尝试处理材料；前端只能展示服务器返回的材料摘要和处理状态，不能获得对象 URL、对象 key、包裹密钥或原始内容。处理任务会先验证加密对象元数据和长度，再把解密字节交给签名检查、隔离扫描和安全解析服务。

若材料处于 `quarantined`、`saved_unread` 或 `scan_failed`，当前案件的登录所有者可以调用 `POST /api/cases/{caseId}/materials/{materialId}/process` 请求再次排队。该接口必须先验证会话、私密案件归属和材料归属；`parsed` 与 `blocked_malicious` 等终态返回冲突而不是重新处理。状态为 `blocked_malicious` 的材料不得通过任何重试路径进入解析器或 AI。

使用 `GET /api/cases/{caseId}/materials` 获取当前私密案件中已上传、未删除材料的安全摘要。响应只包含材料 ID、用户给出的文件名/MIME、大小、处理状态、AI 可用标志和创建时间；响应必须设置 `Cache-Control: no-store`，且不得包含对象存储定位信息、加密材料或解密凭据。

### 持久化 worker（尚未达到生产启用条件）

持久化 worker 入口为 `pnpm worker:materials`（脚本 `scripts/run-material-processing-worker.ts`）。它必须在独立、受监督的进程中运行，并通过 `MATERIAL_PROCESSING_WORKER_ENABLED=true` 显式启用；默认情况下脚本拒绝启动。worker 使用 PostgreSQL 租约领取任务：`pending`/到期的 `processing` 任务可被重新领取，长任务会按租约时长的一半自动心跳续租，失败按指数退避（上限 15 分钟），达到最大尝试次数后进入 `dead_letter`。续租、完成和失败更新均要求当前租约持有者；续租被拒绝或旧 worker 的迟到更新会被拒绝，worker 不会继续确认该任务。入口会汇总六类净化事件计数，并在退出时输出单行 `material_processing_metrics` 摘要；同时输出 `material_processing_worker_state state=<state> live=<bool> ready=<bool>` 状态行，供 supervisor 做 liveness/readiness 接入。监督器只应把完整状态行交给解析器；仅 `state=running live=true ready=true` 视为可投递，`starting`/`draining`/`stopped`/`faulted` 均不可投递；`live=false` 表示外部监督器可按自身策略考虑重启。状态和摘要只覆盖当前进程，仓库只提供输出契约和本地测试，不提供监督器、告警或自动恢复；外部指标后端、阈值告警、supervisor 策略和恢复演练仍是生产门禁。

当前入口只输出净化后的启动/停止、续租/租约丢失和死信事件，不输出账户、案件、材料 ID、文件名、来源摘录、原文或凭据。部署前仍必须补齐真实 PostgreSQL migration/集成测试、进程监督与优雅退出、队列积压/失败/死信指标及告警、扫描器和隔离解析运行时，并完成恢复演练。

### 静态降级

将 `APP_MODE=static`，确认：

1. 不调用模型 gateway；
2. 不创建或修改案件；
3. 仍能显示静态危机资源与平台边界；
4. 页面不出现“已保存”“已提交”或具体法律结论。

恢复前由值班人员运行回归测试并记录结果。任何异常先保持静态模式。

## 3. 发布证据记录

每项证据均记录基线 commit SHA、命令、UTC 时间、产物路径、结果和审阅人。当前基线为 `191720f`；由于工作树存在未提交变更，不能把该 SHA 解释为包含本轮全部变更。

| 证据 | 命令/演练 | UTC 时间 | 产物 | 结果 | 审阅人 |
|------|-----------|----------|------|------|--------|
| 黄金案例（中/英/越南语试点/混合/信息不足/提示注入/危机） | `node node_modules\\vitest\\vitest.mjs run tests\\unit\\golden-cases.test.ts` | 2026-09-02T13:24:36Z | Vitest 控制台输出 | PASS（8 项） | 待任命 |
| 类型检查 | `node node_modules\\typescript\\bin\\tsc --noEmit`（系统 Node 25.8.2；非发布运行时） | 2026-09-03T07:01Z | 控制台输出 | PASS | 待任命 |
| ESLint | `node node_modules\\eslint\\bin\\eslint.js . --max-warnings=0`（系统 Node 25.8.2；非发布运行时） | 2026-09-03T07:01Z | 控制台输出 | PASS | 待任命 |
| 全部单元测试 | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2/pnpm 9.15.9；非发布运行时） | 2026-09-03T18:15Z | Vitest 控制台输出 | PASS（55 文件/280 项） | 待任命 |
| 全部单元测试（材料界面刷新修复后） | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T04:00Z | Vitest 控制台输出 | PASS（61 文件/296 项） | 待任命 |
| 全部单元测试（租约续租后） | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T07:12Z | Vitest 控制台输出 | PASS（65 文件/317 项） | 待任命 |
| 全部单元测试（续租间隔边界修复后） | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T07:24Z | Vitest 控制台输出 | PASS（65 文件/318 项；新增租约续租间隔必须严格小于租约时长的边界契约） | 待任命 |
| 全部单元测试（worker 指标契约后） | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T08:35Z–08:36Z | Vitest 控制台输出 | PASS（66 文件/320 项） | 待任命 |
| 全部单元测试（worker 生命周期契约后） | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T09:41Z–09:42Z | Vitest 控制台输出 | PASS（67 文件/324 项） | 待任命 |
| 全部单元测试（终止状态领取保护后） | `node node_modules\\vitest\\vitest.mjs run --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T09:46Z–09:47Z | Vitest 控制台输出 | PASS（67 文件/325 项） | 待任命 |
| 生产构建 | `node node_modules\\next\\dist\\bin\\next build`（系统 Node 25.8.2；非发布运行时） | 2026-09-03T08:58Z | `.next/` 构建输出 | PASS | 待任命 |
| 生产构建（持久化队列与 worker 后） | `node node_modules\\next\\dist\\bin\\next build`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T06:40Z–06:41Z | `.next/` 构建输出 | PASS | 待任命 |
| 生产构建（worker 指标契约后） | `node node_modules\\next\\dist\\bin\\next build`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T08:36Z–08:37Z | `.next/` 构建输出 | PASS | 待任命 |
| 生产构建（worker 生命周期契约后） | `node node_modules\\next\\dist\\bin\\next build`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T09:42Z–09:43Z | `.next/` 构建输出 | PASS | 待任命 |
| 生产构建（终止状态领取保护后） | `node node_modules\\next\\dist\\bin\\next build`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T09:47Z–09:48Z | `.next/` 构建输出 | PASS | 待任命 |
| Playwright 回归 | `node_modules\\.bin\\playwright.CMD test --workers=1`（系统 Node 25.8.2/pnpm 9.15.9；非发布运行时） | 2026-09-03T06:36Z–06:37Z | `test-results/`、`playwright-report/` | PASS（16 项） | 待任命 |
| Playwright 回归（材料状态刷新修复后） | `node_modules\\.bin\\playwright.CMD test --workers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T04:01Z–04:02Z | `test-results/`、`playwright-report/` | PASS（17 项） | 待任命 |
| Playwright 回归（持久化队列与 worker 后） | `node_modules\\.bin\\playwright.CMD test --workers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T06:44Z–06:45Z | `test-results/`、`playwright-report/` | PASS（17 项） | 待任命 |
| Playwright 回归（worker 指标契约后） | `node_modules\\.bin\\playwright.CMD test --workers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T08:37Z–08:38Z | `test-results/`、`playwright-report/` | PASS（17 项） | 待任命 |
| Playwright 回归（worker 生命周期契约后） | `node_modules\\.bin\\playwright.CMD test --workers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T09:43Z–09:44Z | `test-results/`、`playwright-report/` | PASS（17 项） | 待任命 |
| Playwright 回归（终止状态领取保护后） | `node_modules\\.bin\\playwright.CMD test --workers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-04T09:48Z–09:49Z | `test-results/`、`playwright-report/` | PASS（17 项） | 待任命 |
| axe 可及性 | `node_modules\\.bin\\playwright.CMD test tests/e2e/accessibility.spec.ts --workers=1`（系统 Node 25.8.2/pnpm 9.15.9；非发布运行时） | 2026-09-03T06:37Z–06:38Z | `test-results/` | PASS（2 项） | 待任命 |
| 源码策略扫描 | `rg -n -i "score|probability|rank|rating|successRate|blacklist|verified company|已提交|构成强迫劳动|已经违法|举报成功率|足以证明违法" src tests` | 2026-09-03T04:40Z | 控制台输出 | PASS（命中仅禁止输出拦截器、领域拒绝契约和测试 allowlist；无用户-facing 结果文案） | 待任命 |
| 知识库索引 | `node_modules\\.bin\\tsx.CMD scripts\\build-knowledge-index.ts` | 2026-09-04T07:16Z | `src/knowledge/source-registry.json` | PASS（26 个文档） | 待任命 |
| 文档治理一致性 | `node node_modules\\vitest\\vitest.mjs run tests\\unit\\documentation-governance.test.ts` | 2026-09-03T03:55:53Z | Vitest 控制台输出 | PASS（1 项；活动框架已切换到长期私密档案） | 待任命 |
| 依赖审计 | `corepack pnpm audit --audit-level=high`（Node 22.14.0/pnpm 11.24.0） | 2026-09-03T04:20Z | 控制台输出 | PASS（无已知漏洞） | 待任命 |
| PostgreSQL 集成 | 隔离临时 PostgreSQL 17 集群（127.0.0.1:55432）+ `corepack pnpm exec prisma migrate deploy` + `corepack pnpm test:integration`（Node 22.14.0/pnpm 11.24.0） | 2026-09-03T04:30Z–04:35Z | Vitest 控制台输出、临时集群日志 | PASS（3 文件/13 项） | 待任命 |
| PostgreSQL 集成复验 | 隔离临时 PostgreSQL 17 集群（127.0.0.1:55432）+ `node_modules\\.bin\\prisma.CMD migrate deploy` + `node_modules\\.bin\\vitest.CMD run --config vitest.integration.config.ts --pool=threads --maxWorkers=1`（系统 Node 25.8.2；非发布运行时） | 2026-09-03T06:44Z–06:45Z | Vitest 控制台输出、临时集群日志 | PASS（3 文件/13 项；7 项迁移已应用） | 待任命 |
| 删除演练 | 真实数据库、对象和备份恢复后逐项核对 | 未执行 | 待生成删除回执 | 阻断 | 待任命 |
| 密钥轮换 | KMS staging key rotate/revoke/restore | 未执行 | 待生成轮换报告 | 阻断 | 待任命 |
| 恶意文件隔离 | staging scanner + parser quarantine | 未执行 | 待生成隔离报告 | 阻断 | 待任命 |
| Gateway 工厂与失败关闭 | `pnpm test tests/unit/ai-provider-factory.test.ts tests/unit/conversation-route.test.ts` | 2026-09-03T05:27Z | Vitest 控制台输出 | PASS（9 项；Gateway 选择、失败不回退、配置错误不泄露 token） | 待任命 |
| 对话取消传播 | `node node_modules\\vitest\\vitest.mjs run tests/unit/conversation-persistence-route.test.ts tests/unit/conversation-route.test.ts` | 2026-09-03T07:00Z | Vitest 控制台输出 | PASS（2 文件/10 项；HTTP 499；在案件更新期间观察到取消时不启动后续 assistant 写入） | 待任命 |
| 材料扫描异常隔离 | `node node_modules\\vitest\\vitest.mjs run tests/unit/material-processing.test.ts` | 2026-09-03T08:56Z | Vitest 控制台输出 | PASS（12 项；扫描器返回错误、抛出异常或 5 ms 测试超时均进入 `scan_failed`，不调用解析器） | 待任命 |
| 解析资源限制 | `node node_modules\\vitest\\vitest.mjs run tests/unit/safe-extraction-worker.test.ts tests/unit/material-processing.test.ts --pool=threads --maxWorkers=1` | 2026-09-09 | Vitest 控制台输出 | PASS（18 项；输入超限不调用解析器、输出超限/超时进入 `saved_unread`，不产生 AI 可用引用） | 待任命；仅代码级资源门禁，不证明隔离运行时 |
| 解析派生结果 schema | `node node_modules\\vitest\\vitest.mjs run tests/unit/safe-extraction-worker.test.ts tests/unit/material-processing.test.ts --pool=threads --maxWorkers=1` | 2026-09-09 | Vitest 控制台输出 | PASS（21 项；非法 `contentRef`、额外字段和越界来源片段均拒绝并保持 `saved_unread`） | 待任命；仅代码级 schema 门禁，不证明隔离运行时 |
| 本地加密对象存储 | `node node_modules\\vitest\\vitest.mjs run tests/unit/local-object-store.test.ts tests/unit/material-object-store-factory.test.ts tests/unit/material-storage.test.ts tests/unit/material-upload-part-route.test.ts tests/unit/material-upload-routes.test.ts` | 2026-09-03T18:17Z | Vitest 控制台输出 | PASS（5 文件/46 项；分片立即加密、完成哈希/大小校验、解密读取、路径防护、不可覆盖、失败取消和配置 fail-closed） | 待任命 |
| 本地材料处理队列与安全摘要 | `node node_modules\\vitest\\vitest.mjs run tests/unit/material-processing-queue.test.ts tests/unit/material-processing-task.test.ts tests/unit/material-upload-processing-trigger.test.ts tests/unit/material-processing-route.test.ts tests/unit/material-list-route.test.ts tests/unit/material-list-repository.test.ts` | 2026-09-04T00:00Z | Vitest 控制台输出 | 待本轮复验；覆盖首次完成后排队、幂等重放不重复排队、队列失败不删除对象、加密读取桥接、重试授权及不泄露对象定位信息 | 待任命 |
| 材料上传界面异步刷新 | `node node_modules\\vitest\\vitest.mjs run tests/unit/material-upload-state.test.ts --pool=threads --maxWorkers=1` + ESLint 组件检查 | 2026-09-04T04:00Z | Vitest/ESLint 控制台输出 | PASS（3 项；刷新调度可取消；不在 effect 中同步触发状态更新） | 待任命 |
| 持久化材料队列与 worker 契约 | `node node_modules\\vitest\\vitest.mjs run tests/unit/material-processing-runtime.test.ts tests/unit/material-processing-job-repository.test.ts tests/unit/material-processing-worker.test.ts tests/unit/material-processing-job-migration-contract.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1` | 2026-09-04T07:12Z | Vitest 控制台输出 | PASS（5 文件/25 项；显式 durable 入队、租约到期回收、心跳续租、租约归属并发保护、退避/死信、worker 停止和净化事件） | 待任命 |
| PostgreSQL 集成（本轮） | `docker compose up -d --wait test-db` | 2026-09-04T04:03Z | Docker/Compose 控制台输出 | 未执行：当前环境未安装 Docker，127.0.0.1:55432 无监听；不能据此宣称集成通过 | 待任命 |
| PostgreSQL 集成（本轮隔离临时集群） | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --pool=threads --maxWorkers=1`（`DATABASE_URL` 指向 `127.0.0.1:55432/manbo_test`，`MANBO_TEST_DATABASE_RESET=confirmed`） | 2026-09-04T08:18Z–08:19Z | Vitest 控制台输出、临时集群日志 | PASS（4 文件/16 项；含材料处理持久化队列幂等、租约回收/续租/归属保护、退避与死信） | 待任命 |
| 材料处理 worker 指标契约 | `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-metrics.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1` | 2026-09-04T08:33Z | Vitest 控制台输出 | PASS（2 文件/8 项；六类事件计数、快照防御性复制、固定单行净化摘要和入口接线） | 待任命 |
| 材料处理 worker 生命周期契约 | `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker-lifecycle.test.ts tests/unit/material-processing-worker.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1` | 2026-09-04T09:41Z | Vitest 控制台输出 | PASS（3 文件/20 项；状态机、停止信号 drain、异常 faulted、readiness/liveness 状态行接线） | 待任命 |
| 材料处理 worker 终止状态领取保护 | `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker.test.ts tests/unit/material-processing-worker-lifecycle.test.ts --pool=threads --maxWorkers=1` | 2026-09-04T09:46Z | Vitest 控制台输出 | PASS（2 文件/14 项；stopped/faulted/draining 状态不会再次领取任务） | 待任命 |
| 材料处理 worker 监督与健康检查契约 | `node node_modules/vitest/vitest.mjs run tests/unit/material-processing-worker-health.test.ts tests/unit/material-processing-worker-supervisor.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1` | 2026-09-07 | Vitest 控制台输出 | PASS（3 文件/15 项；固定状态行解析、仅 running 且 live/ready 均为 true 才可投递、矛盾状态标志拒绝、启动/排空/停止/故障输出和单次指标摘要） | 待任命；仅代码级契约，不证明真实 supervisor、生产告警或恢复演练 |
| 可用性、排空顺序与 CI 契约修复后全量单元测试 | `pnpm exec vitest run --pool=threads --maxWorkers=1` | 2026-09-07T06:18Z | Vitest 控制台输出 | PASS（69 文件/335 项；包含矛盾生命周期标志拒绝、异步 draining 通知顺序和 Docker-free Actions 契约） | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| 可用性与排空顺序修复后 TypeScript | `pnpm exec tsc --noEmit` | 2026-09-07T05:54Z | TypeScript 控制台输出 | PASS | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| 可用性与排空顺序修复后 ESLint | `pnpm exec eslint . --max-warnings=0` | 2026-09-07T05:54Z | ESLint 控制台输出 | PASS | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| 可用性与排空顺序修复后生产构建 | `pnpm exec next build` | 2026-09-07T05:58Z | `.next/` 构建输出 | PASS | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| 可用性契约修复后浏览器回归 | `pnpm exec playwright test` | 2026-09-07T05:47Z | `test-results/`、Playwright 控制台输出 | PASS（17 项；含 2 项 axe 可及性检查） | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |

## 4. 事故处理

1. 发现人先将受影响能力切换到 `APP_MODE=static`，不要删除原始取证材料或扩大日志。
2. 值班人员确认是否有用户安全风险、越权读取、模型外发、错误法律表述或删除失败。
3. 仅记录净化后的事件 ID、时间、能力和状态；不得把用户原文、来源摘录、凭据、IP 或设备标识写入应用审计。
4. 通知隐私/安全负责人，保留最小必要证据，并按适用法域和供应商合同评估通知义务。
5. 修复后先运行危机、AI 降级、授权、删除和导出回归，再恢复受影响能力。

## 5. Gate 判定

Gate 0/1 只有在 `docs/release-gates.md` 的每一项都有命名审阅人和可访问证据链接时才能勾选。当前文档中的“待执行/阻断”项不能作为通过证据。
