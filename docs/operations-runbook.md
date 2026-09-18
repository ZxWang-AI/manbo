# Manbo 运行与发布证据手册

> 版本：v0.3（2026-09-17）
> 适用范围：本地验证、受控部署准备；不是生产运维承诺。

## 1. 当前运行边界

- 应用默认私密；它整理用户自述、材料元数据和渠道导航，不代表官方认定，也不代用户提交。
- AI 只做第一次结构化整理。模型超时、拒答、输出校验失败或知识库不可用时，必须回退到静态安全提示，并且不把本轮标记为已保存或已提交。
- 当前工作树尚未连接经审查的生产对象存储、KMS、恶意文件扫描队列、OIDC/SSO 或备份恢复系统。因此 Gate 1 生产托管仍为阻断状态。派生文本的应用层 AES-256-GCM 加密持久化和服务端 AI 上下文解析已接通，但生产 KMS、密钥轮换、真实网关端到端演练和恢复证据尚未完成。Gateway 的应用内 Provider 工厂已接通，但尚未对经审查的真实网关进行端到端演练。PostgreSQL 集成测试使用隔离的临时本地集群完成，不能替代生产数据库演练。
- 用户主动删除前无默认到期时间；上线前必须证明主记录、消息、材料、转写、包裹密钥、索引、缓存和备份队列均可清理。
- 材料上传完成后的数据库落库是原始材料保存的权威步骤。仅在首次完成落库后，服务才会尝试把 `{ accountId, caseId, materialId }` 送入材料处理队列；排队失败不能回滚完成状态、删除对象或释放已经使用的配额。用户可稍后发起重试。
- Web 请求路径默认仍使用仅供本地开发和受控 staging 验证的进程内适配器；进程重启会丢失尚未完成的任务，因此默认模式绝不能作为生产异步处理基础设施。设置 `MATERIAL_PROCESSING_QUEUE=durable` 后，API 入队改写 PostgreSQL 持久化队列；持久化 PostgreSQL 队列模型、账户/案件/材料三元组活动任务去重、租约回收、退避重试和 `dead_letter` 状态已加入代码。worker 现有事件可汇总为不含任务/用户标识的进程内计数，并在停止时输出固定格式摘要；生命周期契约区分 `starting`、`running`、`draining`、`stopped` 和 `faulted`，只有 `running` 为 ready，收到停止信号后不再领取新任务。真实 PostgreSQL 生产演练、受监督 worker 进程部署、外部指标采集/阈值告警和恢复演练仍未完成。
- AI 只能使用状态为 `parsed` 且 `eligibleForAi=true`、具有来源关联且存在加密派生 envelope 的内容。`quarantined`、`scanning`、`scan_failed`、`saved_unread`、`parse_queued` 和 `blocked_malicious` 中的原始材料都必须保留在 AI 输入之外。对话只接受用户主动选择的 opaque `contentRef`；服务端重新验证账户/案件归属、状态、引用格式、解密完整性和 200,000 字符总上限后，才把文本传给 AI Gateway。解析阶段现在还强制执行输入字节上限、输出字符上限、解析超时和严格派生结果 schema；任何超限、超时或非法引用/来源片段都回退为 `saved_unread`，不会创建 AI 可用派生内容。
- 对话“停止生成”必须作为端到端取消处理：浏览器取消请求后，AbortSignal 传播到编排器、各 AI 步骤和 Gateway fetch。每项尚未开始的持久化副作用前均检查取消；在首项写入前观察到取消时路由返回 HTTP `499`，不写入 assistant 回复、案件补丁或 `model_fallback` 审计，用户消息仍可保留。若取消发生在一项数据库操作已开始之后，该操作的事务自行决定提交或回滚；路由不得开始任何后续写入，且不得宣称已回滚该操作。
- 对话历史按追加模型展示，当前 schema 以每个账户/案件内单调的 `messageSequence` 作为权威追加顺序，不再使用毫秒级 `createdAt` 和随机 `messageId` 推断先后。普通发送创建一条新的用户消息；“编辑并重新发送”只把历史原文复制到输入框，发送后仍是一条新用户消息。“重试”只允许针对当前私密案件最新的用户消息：服务端用账户、案件、用户角色和数据库 UUID 重新校验目标，以数据库原文作为 AI 输入，不新增用户消息，只追加新的 AI 回复。无效、越权、跨案件、assistant 或较早的目标统一返回 `404`，并在材料解析、AI 调用和写入前停止；畸形 UUID 返回 `400`。
- 持久化对话现使用客户端稳定 `turnId`、canonical 请求指纹和 PostgreSQL `conversation_turns` ledger。普通发送在 `case → turn` 锁序下同时保留 user 消息；AI 结果先写 `result_ready`，最终化事务再一次性提交案件 patch、revision、最小审计、assistant 消息和完成响应。相同 turn 重放不重复调用 AI/写入；处理中返回 `202 TURN_IN_PROGRESS`，哈希不一致返回 `409 IDEMPOTENCY_CONFLICT`。材料校验失败、编排硬异常或取消会留下可安全重放的 `failed`/`cancelled` 终态；provider 若只产生 `assistant.degraded` 安全降级，则最终化为 `completed` 快照，不写 case patch/assistant；最终化暂时不可用时保留 `result_ready` 供后续恢复。processing/reserved 轮次带有限租约，进程崩溃后下一次同 key 请求会用 CAS 将过期或缺失租约的活动轮次转为 `failed/TURN_EXPIRED`，避免永久卡死；当前没有独立后台 reaper。reserve 后读取历史时以本轮 user 的 `messageSequence` 作为上下文上限，不把随后追加的消息送入 AI。配置 `CONVERSATION_TURN_MASTER_KEY` 与 `CONVERSATION_TURN_KEY_VERSION` 后，result/response snapshot 以 AES-256-GCM envelope 存储；生产缺少该密钥时对话接口 fail-closed。该控制已通过隔离 PostgreSQL 17 的并发、回滚、软删除和快照加密集成测试，但真实 staging/生产迁移、provider 外部幂等和 facts/timeline 业务去重仍未完成，R-22 继续是发布阻断项。
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
$env:MATERIAL_DERIVATIVE_MASTER_KEY = "<另一组 64 位十六进制随机值>"
$env:MATERIAL_DERIVATIVE_KEY_VERSION = "derivative-v1"
```

适配器会在分片写入时立即使用 AES-256-GCM 加密，完成时校验大小和 SHA-256；中止或删除会清理本地对象。该适配器仅用于验证接口与安全状态机，不能替代生产 S3/KMS、隔离扫描和备份恢复演练。

### 材料处理与重试

完成上传后，应用会异步尝试处理材料；前端只能展示服务器返回的材料摘要和处理状态，不能获得对象 URL、对象 key、包裹密钥或原始内容。处理任务会先验证加密对象元数据和长度，再把解密字节交给签名检查、隔离扫描和安全解析服务。

若材料处于 `quarantined`、`saved_unread` 或 `scan_failed`，当前案件的登录所有者可以调用 `POST /api/cases/{caseId}/materials/{materialId}/process` 请求再次排队。该接口必须先验证会话、私密案件归属和材料归属；`parsed` 与 `blocked_malicious` 等终态返回冲突而不是重新处理。状态为 `blocked_malicious` 的材料不得通过任何重试路径进入解析器或 AI。

使用 `GET /api/cases/{caseId}/materials` 获取当前私密案件中已上传、未删除材料的安全摘要。响应只包含材料 ID、用户给出的文件名/MIME、大小、处理状态、AI 可用标志和创建时间；响应必须设置 `Cache-Control: no-store`，且不得包含对象存储定位信息、加密材料或解密凭据。

### 派生内容与对话上下文

解析成功后，worker 将 `{ text, sourceSpans? }` 使用独立派生内容密钥加密后写入 `MaterialDerivative.encryptedContent`；数据库不保存明文派生文本。材料列表只返回服务器签发的 `aiContentRefs`，不会返回对象 key、密钥或文本。用户在对话中勾选材料后，路由将 refs 交给服务端仓储；仓储按账户、案件、私密状态、`parsed`、`eligibleForAi` 和非空加密 envelope 查询并解密，任一引用缺失、越权、解密失败或总文本超过 200,000 字符时整体拒绝，不调用 AI。Gateway 侧仍会执行输入策略/PII 脱敏；脱敏改变文本时不携带原始 source span 偏移。

### 对话历史与重试核验

本地或 staging 验证持久化重试时，先发送两条不同用户消息，再点击最新 AI 回复的“重试”。核对：

1. UI 中用户气泡数量不增加，旧 AI 回复仍可见，并新增一条 AI 回复；
2. 请求携带第二条用户消息的 `retryUserMessageId`，普通发送不携带该字段；
3. 数据库用户消息数不增加，assistant 消息数增加一条；
4. 服务端实际输入使用数据库中的用户原文，即使请求中的 `message` 被篡改也不能改变 AI 输入；
5. 使用较早消息、assistant 消息、其他账户/案件消息或不存在的 UUID 均返回相同 `404`，且没有材料解析、AI 调用或任何写入；
6. 数据库列表与“最新 user”判定均以 `messageSequence` 为准，同一毫秒内追加多条新消息时仍保持实际分配的顺序。迁移前的历史同毫秒消息是例外：它们只有确定性回填次序，不能还原实际追加先后。

这些检查只证明不可变历史和重试引用边界；turn ledger 的原子最终化和幂等重放另见下节，不能把本地测试等同于生产就绪证明。

### 对话 turn ledger、恢复与快照安全

迁移 `202609180011_add_conversation_turn_ledger` 必须在新应用实例前完成。它保留历史消息的 `turn_id = NULL`，新增 `conversation_turns`、部分唯一 `(turn_id, role)` 索引和案件/账户归属外键；不得跳过迁移或手工把旧消息回填为虚构 turn。发布顺序仍是“迁移先行→应用滚动发布”，迁移失败、取消或状态不可验证时停止发布。

本地验证命令（仅隔离测试库，禁止使用生产库或 5432）：

```powershell
$env:DATABASE_URL = "postgresql://manbo:manbo_test@127.0.0.1:55433/manbo_test?schema=public"
$env:MANBO_TEST_DATABASE_PORT = "55433"
$env:MANBO_TEST_DATABASE_RESET = "confirmed"
node node_modules\prisma\build\index.js migrate deploy
node node_modules\vitest\vitest.mjs run --config vitest.integration.config.ts --pool=threads --maxWorkers=1
```

集成套件必须覆盖：同 turn 并发 reserve 只有一个 owner/user；并发 finalizer 只有一条 assistant；不同 turn 的案件序号不冲突；case/revision/audit/assistant/turn 任一写失败整体回滚；retry 与新 user 交错时持久化冲突；软删除 fail-closed；配置 snapshot cipher 时数据库只保存 envelope。测试结束后停止并删除明确的临时 PostgreSQL 数据目录，不触碰其他本机数据库服务。

若收到 `202 TURN_IN_PROGRESS`，优先使用原 turn 重试；`result_ready` 会直接进入最终化，不再次调用 AI。未过期的 `processing/reserved` 只返回 in-flight；租约过期后下一次同 key 请求会记录 `TURN_EXPIRED` 并重放安全失败，新的显式 turnId 才能重新执行。`completed`、`conflict`、`failed` 和 `cancelled` 只重放安全摘要；若数据库快照损坏或密钥/AAD 不匹配，接口返回受控 `503`，不得把异常堆栈或快照内容返回给用户。provider 在 result 写入前崩溃仍可能产生无法确认的外部调用成本；不要把 turn ledger 描述为供应商级 exactly-once。

### 第 10 个数据库迁移的运行与回滚边界

`202609170010_add_conversation_message_sequence` 是 expand-contract 迁移。其事务设置 `lock_timeout=10s` 和 `statement_timeout=10min`，随后对 `conversation_messages` 取 `ACCESS EXCLUSIVE` 锁，增加 `message_sequence`，按 `created_at, message_id` 确定性回填旧行，安装兼容触发器，然后建立 `NOT NULL`、正整数检查和案件内唯一约束。若锁或语句超时，整笔迁移必须失败并回滚；值班人员应先检查/处置长事务和锁等待，再从迁移步骤重试，不得跳过迁移继续部署。回填只能为历史数据生成稳定次序：同一毫秒内的旧消息在原 schema 中没有可恢复的真实追加顺序，不得把 UUID 排序解释为事件先后证据。

发布顺序必须是“迁移先行→新应用滚动发布”。迁移完成后，旧实例的 `NULL` 序号写入由触发器在锁定对应 `case_records` 行后分配，新实例使用同一案件行锁显式分配；两条路径可在有限的滚动发布和应用回滚窗口内短暂混跑。不需要以人工停写作为正确性条件，但必须在 staging 和低流量受控窗口测量独占锁的等待时间。迁移失败、取消或结果不可验证时，发布必须停止；不得先启动依赖该列的新实例。

应用回滚可依赖兼容触发器，但不要自动反向删列、序号或已回填数据。触发器只能在所有实例已收敛至显式分配版本、旧版本回滚窗口关闭、混跑/并发/恢复演练通过，且有可审计证据说明旧写路径不再使用后，通过后续独立 contract migration 移除。当前触发器没有调用计数，所以缺少收敛证据时必须保留。

本地集成套件的安全栏默认只允许 `127.0.0.1`/`localhost:55432` 的 `manbo_test`/`public` 数据库。如本机安全代理已占用 55432，可同时将隔离 PostgreSQL 和 `MANBO_TEST_DATABASE_PORT` 显式设为白名单备用端口 `55433`。除 `55432`/`55433` 外的本机端口仍会被拒绝；其他条件也不变：仍必须是本机主机、`manbo` 用户、`manbo_test` 库、唯一 `public` schema 且 `MANBO_TEST_DATABASE_RESET=confirmed`。不要为了换端口而放宽任何其他条件。

### 持久化 worker（尚未达到生产启用条件）

持久化 worker 入口为 `pnpm worker:materials`（脚本 `scripts/run-material-processing-worker.ts`）。它必须在独立、受监督的进程中运行，并通过 `MATERIAL_PROCESSING_WORKER_ENABLED=true` 显式启用；默认情况下脚本拒绝启动。worker 使用 PostgreSQL 租约领取任务：`pending`/到期的 `processing` 任务可被重新领取，长任务会按租约时长的一半自动心跳续租，失败按指数退避（上限 15 分钟），达到最大尝试次数后进入 `dead_letter`。续租、完成和失败更新均要求当前租约持有者；续租被拒绝或旧 worker 的迟到更新会被拒绝，worker 不会继续确认该任务。入口会汇总六类净化事件计数，并在退出时输出单行 `material_processing_metrics` 摘要；同时输出 `material_processing_worker_state state=<state> live=<bool> ready=<bool>` 状态行，供 supervisor 做 liveness/readiness 接入。监督器只应把完整状态行交给解析器；仅 `state=running live=true ready=true` 视为可投递，`starting`/`draining`/`stopped`/`faulted` 均不可投递；`live=false` 表示外部监督器可按自身策略考虑重启。状态和摘要只覆盖当前进程，仓库只提供输出契约和本地测试，不提供监督器、告警或自动恢复；外部指标后端、阈值告警、supervisor 策略和恢复演练仍是生产门禁。

当前入口只输出净化后的启动/停止、续租/租约丢失和死信事件，不输出账户、案件、材料 ID、文件名、来源摘录、原文或凭据。材料 Gateway 通过 `MATERIAL_SECURITY_GATEWAY=isolated` 显式启用；worker 仅在 HTTPS、token 和 `reviewed:*` 留存策略均有效时注入隔离 scanner/parser。未配置或配置无效时使用 fail-closed 默认实现，材料进入 `scan_failed`，不会绕过解析器进入 AI。Gateway 请求只发送材料字节和（Parser）检测到的 MIME/容器元数据，响应 request ID、verdict/derivative 和大小均严格校验，超时或异常不重试。部署前仍必须补齐真实 PostgreSQL 生产演练、进程监督与优雅退出、队列积压/失败/死信指标及告警、真实恶意文件扫描与解析沙箱、供应商留存审阅，并完成恢复演练。

### 静态降级

将 `APP_MODE=static`，确认：

1. 不调用模型 gateway；
2. 不创建或修改案件；
3. 仍能显示静态危机资源与平台边界；
4. 页面不出现“已保存”“已提交”或具体法律结论。

恢复前由值班人员运行回归测试并记录结果。任何异常先保持静态模式。

### Web 配置诊断

`GET /api/health` 是只读的配置形状检查。它返回 `status=static|configured|degraded`、`mode` 以及缺失/无效的应用变量名；不会返回 Secret、数据库连接串、token、用户数据，也不会主动探测数据库或 AI Gateway。`configured` 只表示环境变量通过格式和安全策略校验，不能替代真实服务连通性、供应商留存审阅、材料安全或恢复演练。生产配置异常时接口返回 HTTP `503`，应修正 Vercel Production 变量并重新部署；不要把 Secret 值写入工单、聊天或日志。

当前 `SESSION_SECRET` 只用于生产配置门禁，尚未参与现有会话/化名索引哈希；修改它不会自动撤销已签发会话。真实数据托管前必须完成版本化 HMAC 迁移、旧数据双读升级和密钥轮换宽限期演练，详见风险登记册 R-21。

## 3. 发布证据记录

每项证据均记录基线 commit SHA、命令、UTC 时间、产物路径、结果和审阅人。下表中的早期记录沿用当时的历史基线 `191720f`，后续记录应视为对应时间点的历史证据，不能反向解释为当前代码的验证结果。当前最近的已提交基线为 `865860f`（该提交树与记录时远程 `origin/main` 的合并提交 `eb06cbc` 一致）；本轮工作树仍含未提交变更，因此表中标注“本轮未提交”的条目仅供审计参考，不能把任一提交 SHA 解释为包含本轮全部变更。

| 证据 | 命令/演练 | UTC 时间 | 产物 | 结果 | 审阅人 |
|------|-----------|----------|------|------|--------|
| 对话不可变历史与安全重试（本轮未提交） | `node node_modules\vitest\vitest.mjs run tests/unit/chat-state.test.ts tests/unit/message-repository.test.ts tests/unit/persistence-races.test.ts tests/unit/conversation-persistence-route.test.ts tests/unit/conversation-route.test.ts tests/unit/conversation-resume.test.ts tests/unit/material-context-contract.test.ts`；`node node_modules/@playwright/test/cli.js test tests/e2e/chat-controls.spec.ts --project=chromium` | 2026-09-17 | Vitest/Playwright 控制台输出、工作树 diff | 定向 PASS（重试不复制/写入 user；数据库原文权威；owner/case/role/latest-user 校验；首次建档并发互斥；旧 AI 历史保留；preview 与缺失 ID 安全失败；编辑文案明确；retry assistant 在案件锁内最终复核最新 user，并发新 user 先写入时拒绝旧回复）。真实 PostgreSQL 双连接复验已在下方当前 10 迁移记录中通过；案件 patch 与 assistant 仍非同一最终化事务。 | 待任命；不是生产连通性或部署证明 |
| 历史严格运行时完整复验（`messageSequence` 迁移前） | Node `22.14.0` + Corepack pnpm `11.24.0`：`pnpm typecheck`、`pnpm lint`、`pnpm test -- --pool=threads --maxWorkers=1`、`node node_modules/@playwright/test/cli.js test --workers=1 --reporter=line`、`pnpm build` | 2026-09-17 | 控制台输出、`.next/`、`test-results/`、工作树 diff | 历史 PASS（TypeScript；ESLint 0 warning；84 个 Vitest 文件/406 项；26 项 Playwright，含 2 项 axe；Next.js 16.3.3 production build）。该记录已被下方 `messageSequence` 改造后的当前全量 PASS 取代，仅保留为历史审计记录。 | 待任命；本轮未提交，不能作为部署或生产连通性证明 |
| 历史 retry 锁/快照真实 PostgreSQL 复验（`messageSequence` 迁移前） | PostgreSQL 17 临时隔离集群（`127.0.0.1:55433`；验证后停止并删除）、当时已有的 9 个 migration、`tests/integration/case-repository.test.ts` | 2026-09-17 | Vitest/Prisma 控制台输出、工作树 diff | 历史 PASS（1 文件/11 项；并发新 user 先持锁时 retry 等待，提交后 retry 的 `READ COMMITTED` 锁内查询看到新 user 并拒绝旧 assistant；retry 先持锁时 assistant 先写入，新 user 随后追加）。该记录不包含第 10 个迁移或 sequence/trigger 兼容性验证。 | 待任命；不是当前 schema、远程 CI、生产数据库或整轮原子性证明 |
| `messageSequence` 迁移/仓储定向验证（本轮未提交） | `tests/unit/conversation-message-sequence-migration-contract.test.ts` + `tests/unit/message-repository.test.ts` | 2026-09-17 | Vitest 控制台输出、工作树 diff | PASS（2 文件/8 项；覆盖确定性回填与约束契约、旧实例兼容触发器、锁内分配、序号排序和 `READ COMMITTED`）。下方当前 PostgreSQL 记录进一步验证了全部 10 个迁移、触发器旧写路径实际执行、旧/新并发序号分配和 retry 锁交错；受控滚动部署/应用回滚演练仍待完成。 | 待任命；不是部署或生产数据库证明 |
| 序号文档治理与定向套件（本轮未提交） | `tests/unit/documentation-governance.test.ts` + 上述两个序号测试文件 | 2026-09-17 | Vitest 控制台输出、工作树 diff | PASS（3 文件/10 项）；文档治理 2 项和序号定向 8 项共同通过。 | 待任命；仅本地定向证据，不替代真实 PostgreSQL 或全量门禁 |
| 当前 `messageSequence` PostgreSQL 定向集成（本轮未提交） | PostgreSQL 17 临时隔离集群（`127.0.0.1:55433`，`MANBO_TEST_DATABASE_PORT=55433`）；全部 10 个 migration；`tests/integration/case-repository.test.ts` | 2026-09-17 | Vitest/Prisma 控制台输出、临时集群日志、工作树 diff | PASS（1 文件/13 项）；覆盖同时间戳且 UUID 顺序相反时的序号读取，旧 raw insert 省略 `message_sequence` 与新 repository 显式序号的并发写入，以及 retry/新 user 双向案件锁交错。 | 待任命；仅本地隔离集群，不是滚动部署、应用回滚或生产数据库证明；临时集群已停止并删除 |
| 当前 PostgreSQL 完整集成（本轮未提交） | PostgreSQL 17 临时隔离集群（`127.0.0.1:55433`，`MANBO_TEST_DATABASE_PORT=55433`）；全部 10 个 migration；`node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --pool=threads --maxWorkers=1` | 2026-09-17 | Vitest/Prisma 控制台输出、临时集群日志、工作树 diff | PASS（4 文件/20 项）；包含上述序号/兼容触发器/锁交错覆盖。 | 待任命；仅本地隔离集群，不替代远程 CI、受控滚动发布/应用回滚或生产数据库证明；临时集群已停止并删除 |
| 当前锁定运行时全量门禁（本轮未提交） | Node `22.14.0` + Corepack pnpm `11.24.0`：TypeScript、ESLint、全量 Vitest、全量 Playwright、Next.js build、AI quality、documentation governance、knowledge index、dependency audit、policy scan | 2026-09-17 | 控制台输出、`.next/`、`test-results/`、知识索引、工作树 diff | PASS：TypeScript；ESLint 0 warning；Vitest 85 文件/411 项；Playwright 26/26；Next.js 16.3.3 production build；AI quality 2 文件/12 项；文档治理 1 文件/2 项；知识库索引 26 篇；`pnpm audit --audit-level=high` 无已知漏洞；策略扫描仅命中 11 个 allowlisted 防御/负测文件，无非预期命中。 | 待任命；仅当前本地未提交工作树证据，不替代远程 CI、受控滚动发布/应用回滚或生产就绪证明 |
| 当前工作树最终回归（本轮未提交） | bundled Node `24.19.0`（项目 engine 仍要求 `22.14.x`）：`node node_modules\typescript\bin\tsc --noEmit`；`node node_modules\eslint\bin\eslint.js . --max-warnings=0`；`node node_modules\vitest\vitest.mjs run --pool=threads --maxWorkers=1`；`node node_modules\@playwright\test\cli.js test --workers=1 --reporter=line`；`node node_modules\next\dist\bin\next build` | 2026-09-18 | TypeScript/ESLint/Vitest/Playwright/Next.js 控制台输出、`.next/`、`test-results/`、工作树 diff | PASS：TypeScript；ESLint 0 warning；Vitest 91 文件/469 项；Playwright 31/31；Next.js 16.3.3 production build。覆盖 canonical 输入、未来消息上下文隔离、空租约活动轮次过期回收和原有对话/材料/可访问性回归；仅本地未提交证据，不替代锁定 Node 22、远程 CI、真实 PostgreSQL 生产演练或生产就绪证明。 | 待任命 |
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
| 解析派生结果 schema | `node node_modules\\vitest\\vitest.mjs run tests/unit/safe-extraction-worker.test.ts tests/unit/material-processing.test.ts --pool=threads --maxWorkers=1` | 2026-09-09 | Vitest 控制台输出；[Actions run 34326247088](https://github.com/ZxWang-AI/manbo/actions/runs/34326247088) | PASS（21 项；非法 `contentRef`、额外字段和越界来源片段均拒绝并保持 `saved_unread`） | 待任命；仅代码级 schema 门禁，不证明隔离运行时 |
| 本地加密对象存储 | `node node_modules\\vitest\\vitest.mjs run tests/unit/local-object-store.test.ts tests/unit/material-object-store-factory.test.ts tests/unit/material-storage.test.ts tests/unit/material-upload-part-route.test.ts tests/unit/material-upload-routes.test.ts` | 2026-09-03T18:17Z | Vitest 控制台输出 | PASS（5 文件/46 项；分片立即加密、完成哈希/大小校验、解密读取、路径防护、不可覆盖、失败取消和配置 fail-closed） | 待任命 |
| 本地材料处理队列与安全摘要 | `node node_modules\\vitest\\vitest.mjs run tests/unit/material-processing-queue.test.ts tests/unit/material-processing-task.test.ts tests/unit/material-upload-processing-trigger.test.ts tests/unit/material-processing-route.test.ts tests/unit/material-list-route.test.ts tests/unit/material-list-repository.test.ts` | 2026-09-14 | Vitest 控制台输出 | PASS（6 文件/14 项；覆盖首次完成后排队、幂等重放不重复排队、队列失败不删除对象、加密读取桥接、重试授权及不泄露对象定位信息） | 待任命；本轮未提交 |
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
| provider-neutral media Gateway 契约 | `npm test -- --run tests/unit/isolated-media-gateway.test.ts` | 2026-09-09T08:22Z | Vitest 控制台输出 | PASS（6 项；HTTPS、无文件名/案件标识请求、request ID/严格 schema、响应大小、配置 fail-closed） | 待任命；仅适配器契约，不证明真实扫描器或解析沙箱 |
| media Gateway 接线后全量单元测试 | `npm test` | 2026-09-09T08:27Z | Vitest 控制台输出 | PASS（72 文件/355 项） | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| media Gateway 接线后 TypeScript、ESLint、生产构建 | `npm run typecheck` + `npm run lint` + `npm run build` | 2026-09-09T08:28Z–08:30Z | TypeScript/ESLint/Next.js 控制台输出 | PASS | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| media Gateway 接线后浏览器回归 | `npm run test:e2e` | 2026-09-09T08:31Z | `test-results/`、Playwright 控制台输出 | PASS（17 项） | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时 |
| Web 配置诊断与 Vercel 凭据参数契约（本轮未提交） | `node node_modules/vitest/vitest.mjs run tests/unit/health-route.test.ts tests/unit/tooling-contract.test.ts --pool=threads --maxWorkers=1` | 2026-09-14T02:25Z | Vitest 控制台输出、工作树 diff | PASS（2 文件/19 项；health 只返回模式和变量名，Vercel token 不作为命令行参数） | 待任命；未提交代码，不是生产连通性或部署证明 |
| 本轮完整单元测试（health 诊断后） | `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1` | 2026-09-14T02:45Z | Vitest 控制台输出 | PASS（73 文件/366 项；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时） | 待任命；未提交代码，不是生产连通性或部署证明 |
| 本轮完整单元测试（删除回执与材料轮询后） | `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1` | 2026-09-14T03:28Z | Vitest 控制台输出 | PASS（74 文件/368 项；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时） | 待任命；未提交代码，不是生产连通性或部署证明 |
| 派生内容加密、上下文边界、来源追溯与 Gateway 最小化（本轮未提交） | `node node_modules/vitest/vitest.mjs run tests/unit/material-derivative-content.test.ts tests/unit/material-derivative-migration-contract.test.ts tests/unit/material-ai-context-repository.test.ts tests/unit/material-source-trace.test.ts tests/unit/material-processing-repository.test.ts tests/unit/ai-orchestrator.test.ts --pool=threads --maxWorkers=1` | 2026-09-14T06:58Z | Vitest 控制台输出、工作树 diff | PASS（6 文件/39 项；旧无 envelope 派生记录被过滤、服务端解密/归属/大小 fail-closed、事实/时间线/证据覆盖材料 sourceTrace 校验、Gateway 不外发 materialId） | 待任命；未提交代码，不是生产连通性或部署证明 |
| 历史完整单元测试（派生安全与来源追溯后） | `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1` | 2026-09-14T06:59Z | Vitest 控制台输出 | 历史 PASS（79 文件/386 项；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时；已由本轮 84 文件/395 项记录取代） | 待任命；未提交代码，不是生产连通性或部署证明 |
| 浏览器渲染稳定性与材料重试竞态修复（本轮未提交） | `node node_modules/@playwright/test/cli.js test tests/e2e/render-stability.spec.ts tests/e2e/material-and-voice-intake.spec.ts` | 2026-09-14T07:31Z | Playwright 控制台输出 | PASS（3 项；无 React `Maximum update depth exceeded`，重试确认在轮询竞态下仍可见） | 待任命；系统 Node 25.8.2，非发布运行时 |
| “继续补充”焦点工作流（本轮未提交） | `node node_modules/@playwright/test/cli.js test tests/e2e/chat-controls.spec.ts -g "focuses the composer"` | 2026-09-14T07:40Z | Playwright 控制台输出 | PASS（1 项；点击后消息输入框获得焦点） | 待任命；系统 Node 25.8.2，非发布运行时 |
| 历史完整浏览器回归（渲染稳定性与焦点修复后） | `node node_modules/@playwright/test/cli.js test --reporter=line` | 2026-09-14T07:45Z | `test-results/`、Playwright 控制台输出 | 历史 PASS（18 项；无 React 更新循环警告；已由本轮 22 项记录取代） | 待任命；系统 Node 25.8.2，非发布运行时；未提交代码 |
| 案件恢复/继续对话定向单测（本轮未提交） | `node node_modules/vitest/vitest.mjs run tests/unit/case-list-repository.test.ts tests/unit/cases-route.test.ts tests/unit/conversation-bootstrap-route.test.ts tests/unit/conversation-resume.test.ts tests/unit/saved-cases-workbench.test.ts --pool=threads --maxWorkers=1` | 2026-09-14 | Vitest 控制台输出、工作树 diff | PASS（5 文件/13 项；账户隔离、删除过滤、安全摘要、历史消息恢复和继续补充入口） | 待任命；不是生产连通性或部署证明 |
| 本轮完整单元测试（案件恢复工作台后） | `node node_modules/vitest/vitest.mjs run --pool=threads --maxWorkers=1` | 2026-09-14 | Vitest 控制台输出 | PASS（84 文件/395 项） | 待任命；系统 Node 25.8.2/pnpm 9.15.9，非发布运行时；本轮未提交 |
| 本轮 TypeScript 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | 2026-09-14 | TypeScript 控制台输出 | PASS | 待任命；系统 Node 25.8.2，非发布运行时；本轮未提交 |
| 本轮 ESLint | `node node_modules/eslint/bin/eslint.js . --max-warnings=0` | 2026-09-14 | ESLint 控制台输出 | PASS | 待任命；系统 Node 25.8.2，非发布运行时；本轮未提交 |
| 本轮完整 Playwright 回归（案件恢复工作台与 scroll 提示修复后） | `node node_modules/@playwright/test/cli.js test --reporter=line` | 2026-09-14 | `test-results/`、Playwright 控制台输出 | PASS（22 项；单 worker；不再出现 `missing-data-scroll-behavior` 提示） | 待任命；非发布运行时；本轮未提交 |
| 本轮 axe 可及性回归 | `node node_modules/@playwright/test/cli.js test tests/e2e/accessibility.spec.ts --reporter=line` | 2026-09-14 | `test-results/`、Playwright 控制台输出 | PASS（2 项） | 待任命；非发布运行时；本轮未提交 |
| 历史 PostgreSQL 集成（隔离临时集群） | `node node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --pool=threads --maxWorkers=1`（`127.0.0.1:55432`；当时已有的 9 个 migration） | 2026-09-14 | Vitest 控制台输出、临时集群日志 | 历史 PASS（4 文件/16 项）；不包含后续第 10 个 `message_sequence` 迁移，仅本地隔离集群，不是当前 schema 或生产数据库证据 | 待任命；本轮未提交 |
| 本轮 Next.js 生产构建 | `node node_modules/next/dist/bin/next build` | 2026-09-14 | `.next/` 构建输出 | PASS | 待任命；系统 Node 25.8.2，非发布运行时；本轮未提交 |
| 本轮 AI 质量门禁 | `node node_modules/vitest/vitest.mjs run tests/unit/ai-quality-gates.test.ts tests/unit/golden-cases.test.ts --pool=threads --maxWorkers=1` | 2026-09-14 | Vitest 控制台输出 | PASS（2 文件/12 项；无用户可见评分/概率） | 待任命；本轮未提交 |
| 本轮知识库索引 | `node node_modules/tsx/dist/cli.mjs scripts/build-knowledge-index.ts` | 2026-09-14 | `src/knowledge/source-registry.json` | PASS（26 个文档） | 待任命；本轮未提交 |
| 本轮依赖审计 | `corepack pnpm audit --audit-level=high`（pnpm 11.24.0） | 2026-09-14 | pnpm 控制台输出 | PASS（无已知漏洞） | 待任命；本轮未提交 |

## 4. 事故处理

1. 发现人先将受影响能力切换到 `APP_MODE=static`，不要删除原始取证材料或扩大日志。
2. 值班人员确认是否有用户安全风险、越权读取、模型外发、错误法律表述或删除失败。
3. 仅记录净化后的事件 ID、时间、能力和状态；不得把用户原文、来源摘录、凭据、IP 或设备标识写入应用审计。
4. 通知隐私/安全负责人，保留最小必要证据，并按适用法域和供应商合同评估通知义务。
5. 修复后先运行危机、AI 降级、授权、删除和导出回归，再恢复受影响能力。

## 5. Gate 判定

Gate 0/1 只有在 `docs/release-gates.md` 的每一项都有命名审阅人和可访问证据链接时才能勾选。当前文档中的“待执行/阻断”项不能作为通过证据。
