# 对话轮次幂等与原子最终化设计

> 状态：已获产品确认，等待实施前书面复核
> 日期：2026-09-18
> 范围：持久化案件对话（preview/static 模式不进入本设计）

## 1. 背景与目标

当前持久化对话把用户消息、AI 调用、案件 patch/revision/audit 和 assistant 消息分别提交。网络重试、并发发送或进程在中途退出时，可能造成重复 AI 成本、重复结构化事实，或留下“案件已更新但 assistant 消息缺失”的半完成轮次。

本设计引入一个持久化的 conversation turn ledger（对话轮次账本），以客户端生成的稳定 `turnId` 作为幂等键，并将 AI 结果先保存为受控快照，再用一个短数据库事务完成案件和 assistant 的最终化。目标是：

1. 同一持久化请求在网络重试后可安全重放，不重复调用 AI 或写入消息。
2. 案件 patch、case revision、审计事件、assistant 消息和轮次完成状态要么全部提交，要么全部回滚。
3. retry 不复制原 user 消息，并在最终化前再次验证它仍是案件最新 user 消息。
4. 历史消息和旧版本数据保持可读；滚动发布期间旧应用可暂时写入，不破坏序号约束。
5. 快照和审计不得以明文、日志或未加密持久化方式保存原始请求文本、材料明文、token 或设备信息；快照可以包含有界、schema 校验后的 assistant 文本和用户确认的 `sourceQuote`，但只能位于应用层加密 envelope 内。

本设计不把 AI 结果解释为法律结论，也不引入评分、概率或真实性判断。它只解决持久化和重试一致性；事实、时间线在显式 retry 中的业务去重规则仍是独立后续工作，不宣称由本设计自动完成。

## 2. 非目标与约束

- 不改变 ChatGPT 式交互、消息左右布局、流式 UI 契约或 preview 模式。
- 不引入 outbox worker、异步队列或 Docker；第一阶段使用同步 HTTP + PostgreSQL 事务。
- 不执行远程 Git 操作、commit、push、merge、GitHub Actions 或部署。
- 不把 HTTP `requestId` 当作幂等键；request ID 仍只用于受控错误关联。
- 不在最终化事务内调用已有会自行开启 `$transaction` 的 repository 方法；必须提供 transaction-scoped helper。
- 所有 turn 状态转换和写入均受 account/case 所有权、私密可见性、软删除检查保护。

## 3. 数据模型

### 3.1 `conversation_turns`

新增 `ConversationTurn` 表（Prisma 模型名 `ConversationTurn`），字段如下：

| 字段 | 约束/含义 |
|---|---|
| `turnId` | UUID 主键；由客户端生成并在一次逻辑发送的所有重试中保持不变 |
| `accountId`, `caseId` | 所有权范围；复合唯一键的一部分 |
| `operation` | `send` 或 `retry` |
| `sourceUserMessageId` | retry 必填，send 可为空；指向原始 user 消息 |
| `userMessageId` | send 创建的 user 消息；retry 绑定 source |
| `baseCaseVersion` | reserve 时案件版本，用于最终化冲突检测 |
| `requestHash` | SHA-256 canonical 请求指纹；只存哈希，不存原文 |
| `status` | `reserved`、`processing`、`result_ready`、`completed`、`conflict`、`failed`、`cancelled` |
| `resultSnapshot` | 严格 schema 的安全 AI 结果快照；有界文本与用户确认来源只以应用层加密 envelope 持久化 |
| `responseSnapshot` | 可重放的 HTTP 成功或冲突响应摘要；不含 request ID 明文，持久化时使用同一加密 envelope |
| `assistantMessageId` | 完成后关联唯一 assistant 消息 |
| `caseVersionAfter` | 完成后案件版本 |
| `leaseUntil`, `attempts` | processing/result recovery 的最小恢复信息 |
| `createdAt`, `updatedAt`, `completedAt` | 生命周期时间戳 |

约束：

- `@@unique([accountId, caseId, turnId])`，禁止跨案件或跨账户复用泄露结果。
- `ConversationMessage.turnId` 可空；历史消息为 `NULL`。新消息的非空 `(turnId, role)` 由部分唯一索引约束，确保一个 turn 至多一条 user 和一条 assistant。
- `sourceUserMessageId`、`userMessageId`、`assistantMessageId` 的引用遵循删除策略；案件删除时级联 turn/message，软删除案件在 reserve/finalize 时 fail closed。
- 所有状态和 operation 使用数据库 enum 或等价 CHECK 约束；`resultSnapshot`/`responseSnapshot` 使用 JSON schema 校验后写入。

### 3.2 消息关联

`conversation_messages` 增加 nullable `turn_id`。普通 send 在 reserve 事务内创建带 `turn_id` 的 user 消息；retry 不创建新 user，只绑定既有 source user。assistant 消息在 finalization 事务内写入同一个 `turn_id`。现有 `message_sequence` 继续由案件行锁和既有触发器/应用分配机制维护。

## 4. 请求与状态机

### 4.1 请求契约

持久化请求必须带：

```json
{
  "sessionId": "...",
  "caseId": "uuid",
  "message": "用户输入",
  "turnId": "uuid",
  "contentRefs": ["opaque-ref"],
  "retryUserMessageId": "uuid"
}
```

`turnId` 对普通 send 和 retry 都必填、必须为 UUID；preview 请求仍不要求或持久化 turn。服务器按以下固定字段和顺序构造 canonical 输入：`operation`、`caseId`、`sourceUserMessageId`（无则为空）、`message` 的 Unicode NFC+首尾空白规范化结果、去重后按字典序排列的 `contentRefs`、reserve 时读取的 `baseCaseVersion`。对 UTF-8 JSON 做 SHA-256 得到 `requestHash`；canonical 规则由纯函数测试锁定。同一 `(account, case, turnId)` 使用不同 hash 返回 `409 IDEMPOTENCY_CONFLICT`，且不解析材料、不调用 AI、不写副作用。

### 4.2 生命周期

```text
reserve -> processing -> result_ready -> completed
                    \-> failed/cancelled
result_ready ------> conflict (source/latest/version 失效)
```

- `reserve`：固定锁顺序 `case → turn`。send 在同一事务创建 turn 和 user；retry 锁案件、验证 source 存在且为 latest user，再创建 turn。
- `processing`：事务外调用 AI；同 hash 的第二请求返回 `202 TURN_IN_PROGRESS` 和 `Retry-After`，不得再次调用 AI。新占用会写入有限 `leaseUntil`；进程崩溃后，下一次同 key 请求会用 CAS 将已过期或缺失租约的 processing/reserved 轮次转为可重放的 `failed/TURN_EXPIRED`，不会自动再次调用 AI。当前仍没有独立后台 reaper。
- `result_ready`：AI 返回后先写严格校验的 `resultSnapshot` 和可重放摘要。写入采用 turnId 幂等更新；网络重试发现该状态时直接进入 finalization，不再调用 AI。若 `assistant.degraded`，本轮状态也固定为 `completed`（只保存安全降级响应，不写 case patch/assistant），并在同一 turn 上重放；不得每次重试重新写 `model_fallback` audit。
- `completed`：返回持久化的 `responseSnapshot`，不重新解析材料、不调用 AI、不追加消息、不更新案件。
- `conflict`：在最终化事务内持久化版本/最新 user 冲突摘要，返回固定 `409 VERSION_CONFLICT`；同 key 后续请求重放相同冲突结果。
- `failed/cancelled`：保存安全错误状态和恢复信息；同 key 只重放安全失败响应，新的显式 turnId 才能重新执行。对于已写入 `result_ready` 的 turn，恢复任务/后续请求优先 finalization。

reserve 成功后读取历史消息时，服务端以本轮 user message 的 `messageSequence` 作为上下文上界；并发追加的后续消息不会进入本轮 provider 请求。无法证明边界时仅保留当前 user 引用，避免把未来轮次内容送入 AI。

### 4.3 HTTP 错误契约

| 状态 | code | 行为 |
|---|---|---|
| 400 | `TURN_ID_REQUIRED`/`INVALID_INPUT` | 缺失或非法 UUID；无副作用 |
| 202 | `TURN_IN_PROGRESS` | 同 hash 已被其他请求占用；附 `Retry-After`，不调用 AI |
| 409 | `IDEMPOTENCY_CONFLICT` | 同 key 不同 canonical hash；不调用 AI/材料解析 |
| 409 | `VERSION_CONFLICT` | retry source 非 latest 或 base version 失效；结果可重放 |
| 200 | `assistant.degraded=true` | provider 返回可安全降级结果；turn 完成为无 patch/assistant 的降级快照，可重放但不宣称案件已更新 |
| 503 | `TURN_FAILED` | provider/编排硬异常；若失败标记成功，turn 进入可重放的 `failed` 终态 |
| 503 | `DEGRADED` | 最终化、快照解密或基础设施暂时不可用；不得宣称已保存，`result_ready` 等可恢复状态应保留 |

成功重放必须返回与首次成功响应相同的 assistant message ID、user message ID、case version 和 persistence 字段；不能重新生成随机 ID。

## 5. 事务与锁边界

### 5.1 Reserve

`reserveTurn` 使用 `READ COMMITTED` 短事务，锁顺序始终为 `case` 行后 `turn` 唯一键。先查同 key：

- completed/conflict/result_ready：按状态返回现有记录；
- processing：未过期时返回 in-flight；租约过期时以 CAS 记录 `TURN_EXPIRED` 失败并返回可重放结果；
- hash 不同：返回幂等冲突；
- 不存在：创建 turn；send 同事务 append user，retry 同事务绑定 source。

### 5.2 AI 与结果记录

AI 调用在事务外执行，允许取消信号中止尚未完成的调用。AI 返回后，通过 `recordTurnResult(turnId, resultSnapshot, responseDraft)` 以幂等方式将状态置为 `result_ready`。snapshot 只包含已通过 output schema 的 assistant 文本、draft patch 的结构化字段、degraded 标志和引用 ID；有界的用户确认 `sourceQuote` 只能在应用层加密 envelope 内保存，原始用户输入和解密材料不得以明文写入 snapshot。

### 5.3 Finalize

`finalizeTurn` 使用单个 `READ COMMITTED` 事务，固定锁顺序 `case → turn`，并在同一事务内：

1. 重新读取 turn、案件和最新 user；若状态已 completed/conflict，直接返回 snapshot。
2. 校验 account/case、source latest user、baseCaseVersion、软删除状态。
3. 应用 schema 校验后的 case patch，增加案件版本。
4. 写 `case_record_revisions`。
5. 写最小化 `audit_events`（仅 turn hash/状态/版本/计数等允许字段）。
6. 按案件序号写一条 assistant message，并关联 `turn_id`。
7. 将 turn 置为 completed，写 assistant ID、caseVersionAfter、responseSnapshot。

任一步骤失败，整个事务回滚；不能出现 case version/revision/audit 已提交而 assistant 缺失。若冲突，事务只把 turn 标记为 conflict 并保存安全 response snapshot，不写 patch 或 assistant。

## 6. 安全、隐私与合规控制

- `requestHash` 使用 SHA-256 canonical 输入；不得以明文日志记录原始 message、材料名、source quote、token、Cookie、IP 或设备指纹。快照中的 assistant 文本和用户确认 `sourceQuote` 必须受严格 schema、大小上限和应用层 AES-256-GCM envelope 保护。
- response/result snapshot 通过 Zod/JSON Schema 严格解析；数据库只保存加密 envelope，日志仅记录状态码、turn 状态、版本和计数。
- turn audit action 扩展现有 metadata 白名单，允许 `turnStatus`、`caseVersion`、`messageCount`、`requestHash`（如产品需要），拒绝 `message`、`rawNarrative`、`sourceQuote`、`materialText` 等字段。
- 访问 turn 必须复用案件所有权和私密可见性检查；不存在时统一返回无权/不存在，不泄露其他账户状态。
- migration 向前兼容旧应用；回滚应用不得删除新表或 turn 数据。旧应用收敛后再评估移除兼容触发器，保留独立迁移。

## 7. 前端行为

- 每次新的持久化发送生成一个 UUID `turnId`；网络超时、503、页面重试沿用同一个 key。
- 重复点击/in-flight 请求复用同一 turn，不新增 user bubble；completed replay 只恢复既有 assistant。
- retry 操作使用独立 turnId，仍绑定原 user；不同 retry source 或编辑内容必须生成新 key。
- 前端只对可能已被服务端接受的 `DEGRADED`、`TURN_IN_PROGRESS`、未知网络/5xx 保留 pending turn；明确终态 `TURN_FAILED`、`TURN_EXPIRED`、`INVALID_INPUT`、`CANCELLED`、授权/版本/幂等冲突释放 pending turn，下一次发送生成新 key。
- `202` 显示处理中并提供安全重试；`409 IDEMPOTENCY_CONFLICT` 不显示“已保存”；`409 VERSION_CONFLICT` 提示刷新/选择最新案件状态。
- preview/static 继续使用临时 session，不把 preview turnId 当作持久化消息身份。

## 8. 测试与验收标准

### 单元/契约

1. reserve 同 key 同 hash 只有一个 owner；completed/result_ready 重放不调用 provider；processing 返回 202；不同 hash 返回 409。
2. key 以 account+case 隔离；retry 不复制 user；source/latest/version 过期时记录 conflict 且不写 assistant。
3. migration contract 检查表、enum/CHECK、唯一键、nullable turn_id、部分唯一索引、FK/index 和回滚兼容性。
4. response snapshot 不含原文、材料明文、token；audit metadata 白名单拒绝敏感字段。
5. 前端重复点击、网络失败和恢复流程保持同一 turnId，不重复消息气泡。

### PostgreSQL 集成

1. 两个连接并发 reserve 同 key 只生成一行 turn、一条 user 和至多一条 assistant。
2. 两个不同 turn 在同一案件按 case lock 串行，message sequence 唯一且无死锁。
3. 注入 case/revision/audit/assistant 任一写入失败后，查询确认案件版本、revision、audit、assistant 全部回滚；turn 仅保留约定的可恢复状态。
4. retry 与并发新 user 交错时，旧 assistant 不得落在新 user 之后；stale source 返回可重放冲突。
5. soft-delete/admin version update 与 pending/finalize 交错时 fail closed，不写 assistant/patch，不产生孤儿 turn。

### 发布门禁

- TypeScript、ESLint、Vitest、PostgreSQL integration、Playwright、production build、AI quality、privacy/policy scan 全部通过。
- R-22 只有在 atomic rollback、replay、concurrency、snapshot privacy 证据齐全后才可从发布阻断项降级；facts/timeline 业务去重仍单独登记。

## 9. 可观测性与恢复

只记录结构化状态和耗时指标：`turn_reserve_total`、`turn_ai_total`、`turn_result_ready_total`、`turn_finalize_total`、`turn_replay_total`、`turn_conflict_total`、`turn_inflight_age_seconds`。不记录原文或材料内容。

当前没有独立后台 reaper；API 在同 key 重试时会用租约过期 CAS 将 abandoned `processing/reserved` 轮次标记为 `TURN_EXPIRED`，避免永久卡死。后续可增加低频 reaper，优先处理超过租约的 `result_ready` turn 并重放已保存 snapshot；不得自动重复调用 AI，除非用户使用新的 turnId 明确重试。

## 10. 残余风险

- provider 在结果尚未写入 `result_ready` 前崩溃时，可能无法证明是否产生了外部 AI 成本；需在供应商支持 idempotency key 后进一步接入 `${turnId}:${operation}`。
- facts/timeline 的显式 retry merge/dedupe 规则不在本阶段，仍需后续产品/法律审阅。
- PostgreSQL、KMS、对象存储、备份和真实供应商零留存仍需生产演练；本设计不解除 R-01、R-07、R-15、R-21 等发布门禁。
