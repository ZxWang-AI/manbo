# 部署指南

本仓库把 GitHub 作为源码、审查和自动化中心，把 PostgreSQL 作为持久化数据库。Vercel 是可选的手动部署流程；当前选择的运行目标是 Proxmox 私有 staging，但在服务器初始化和发布通道完成前，当前没有配置自动部署目标。GitHub Pages 只能承载静态原型，不能运行案件、AI、语音或材料托管服务。

如果没有 Vercel，可以使用 Proxmox 中的独立 Ubuntu VM 运行私有 staging。完整的无 Docker、systemd、Caddy、PostgreSQL、VPN 和后续 GitHub Actions 方案见 [`docs/superpowers/plans/2026-09-09-home-server-proxmox-deployment.md`](superpowers/plans/2026-09-09-home-server-proxmox-deployment.md)。该方案默认不开放公网，也不允许在 Gate 1/2 完成前接收真实举报材料。

## 部署前提

- GitHub 账号对仓库有 `Write` 或更高权限。
- 已创建 Vercel 项目，并确认项目使用 Node.js 22.x。
- 已创建 PostgreSQL 数据库；生产连接串只放在 GitHub `production` Environment Secret 和 Vercel Production Environment Variables 中。
- AI Gateway 已完成供应商、模型别名、区域和留存策略审阅。生产环境必须使用 `AI_PROVIDER=gateway`，不能使用 mock provider。
- 派生材料内容必须配置独立于原始对象密钥的 `MATERIAL_DERIVATIVE_MASTER_KEY`（64 位十六进制）和 `MATERIAL_DERIVATIVE_KEY_VERSION`；生产值应由 KMS/密钥管理流程注入，不能写入仓库或日志。
- 材料安全 Gateway 必须是独立的 HTTPS 服务，并使用已审阅的留存策略。worker 仅在 `MATERIAL_SECURITY_GATEWAY=isolated` 且 URL、token 和 `reviewed:*` 策略全部通过校验时启用；未配置或配置无效时保持 fail-closed scanner/parser，不会把凭据写入日志或错误。
- 材料处理生产进程必须部署为独立、可监督的 worker，并使用 PostgreSQL 持久化队列；Web 进程不得把进程内队列当作生产替代。worker 入口和显式开关见 `pnpm worker:materials`、`MATERIAL_PROCESSING_WORKER_ENABLED`。
- 生产环境应为 GitHub Actions 的 `production` Environment 配置 required reviewers，至少在首次迁移前完成一次人工批准。

## GitHub Actions

### CI

`.github/workflows/ci.yml` 在 `main`、`codex/**` 分支 push 和 Pull Request 上运行，也支持 GitHub Actions 页面中的 `workflow_dispatch` 手动触发：

1. 固定 Node `22.14.0` 与 pnpm `11.24.0`。
2. 冻结锁文件安装依赖并生成 Prisma Client。
3. 执行 lint、TypeScript、单元测试、静态生产构建和高危依赖审计。
4. 在 `ubuntu-latest` runner 上直接安装并启动 PostgreSQL（不使用 Docker service），将隔离测试实例配置到 `127.0.0.1:55432` 后执行 Prisma 迁移和集成测试。
5. 在独立的静态运行时安装 Chromium，执行完整 Playwright 回归（包含 axe 严重/关键可及性检查）。

本机若默认 Node/pnpm 版本不匹配，使用 Node `22.14.0` 和 Corepack pnpm `11.24.0`；不得以旧版 pnpm 绕过 `engines` 约束。

### 可选的 Vercel 生产部署

`.github/workflows/deploy-vercel.yml` 仅支持从 GitHub Actions 页面手动触发，不会因 push 到 `main` 自动运行。手动触发默认不执行迁移；只有确认目标数据库已经包含该版本所需的全部 schema 时才能保持 `run_migrations=false`。首次发布依赖 `message_sequence` 或 conversation turn ledger 的应用版本时必须勾选 `run_migrations`，按目录顺序应用 `202609170010_add_conversation_message_sequence` 和 `202609180011_add_conversation_turn_ledger`，再部署新实例。迁移 job 失败、取消或未完成时不得人工绕过并继续部署；当前 workflow 只在迁移成功或被明确跳过时进入 deploy job。没有配置下列 Vercel 和数据库 Secrets 时不要运行该 workflow。

在仓库 `Settings → Environments → production → Environment secrets` 中配置：

| Secret | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 生产连接串，仅供迁移 job 使用 |
| `VERCEL_TOKEN` | Vercel CLI 部署 token |
| `VERCEL_ORG_ID` | Vercel 团队或账号 ID |
| `VERCEL_PROJECT_ID` | Vercel 项目 ID |

不要把 GitHub token、Vercel token、数据库密码或 AI Gateway token 写入仓库、workflow、README、`.env.example` 或命令行参数。GitHub Actions 日志会自动掩码 Secrets，但应用日志仍不得输出凭据。

在 Vercel 项目的 **Production Environment Variables** 中配置应用运行时变量：

```text
NODE_ENV=production
APP_MODE=normal
DATABASE_URL=<production PostgreSQL URL>
SESSION_SECRET=<至少 32 字节随机值，使用密码管理器生成>
AI_PROVIDER=gateway
AI_GATEWAY_URL=https://<reviewed-gateway-host>
AI_GATEWAY_TOKEN=<gateway credential>
AI_MODEL_ALIAS=<approved model alias>
AI_REGION=<approved region>
AI_RETENTION_POLICY_ID=reviewed:<policy-id>
MATERIAL_DERIVATIVE_MASTER_KEY=<64 位十六进制密钥，由 KMS/Secret 注入>
MATERIAL_DERIVATIVE_KEY_VERSION=derivative-v1
CONVERSATION_TURN_MASTER_KEY=<另一组 64 位十六进制密钥，由 KMS/Secret 注入>
CONVERSATION_TURN_KEY_VERSION=turn-v1
```

当前 `SESSION_SECRET` 用于生产配置门禁，尚未参与现有会话/化名索引哈希；修改它不会自动撤销已签发会话。真实用户数据托管前必须完成版本化 HMAC 哈希迁移、旧数据双读升级和密钥轮换宽限期演练。不要因此把“密钥已配置”理解为会话已完成轮换保护。

### 配置诊断

部署后可用 `GET /api/health` 检查应用配置形状。该接口只返回 `status`、运行模式以及缺失/无效的变量名，不返回数据库连接串、Session Secret、任何 token 或网关响应，也不会主动连接 PostgreSQL 或 AI Gateway。

```powershell
curl.exe -i https://<your-domain>/api/health
```

- `200` 且 `status=configured`：生产所需变量通过应用的格式校验；这不等于数据库、Gateway、对象存储或 worker 已完成连通性和安全演练。
- `200` 且 `status=static`：应用处于无凭据静态模式，不创建私密案件，也不调用真实模型。
- `503` 且 `status=degraded`：根据 `missing` 和 `invalid` 字段补齐或修正 Vercel Production 变量，然后重新部署；不要把 Secret 值粘贴到聊天或日志。

该诊断接口是只读配置检查，不是生产就绪证明；Gate 1/2 的真实数据库、对象存储/KMS、扫描解析、身份和恢复演练仍必须单独完成。

材料处理 worker（不要放入 Web 请求进程）的额外配置：

```text
MATERIAL_SECURITY_GATEWAY=isolated
MATERIAL_SECURITY_GATEWAY_URL=https://<reviewed-media-gateway-host>
MATERIAL_SECURITY_GATEWAY_TOKEN=<media-gateway credential>
MATERIAL_SECURITY_RETENTION_POLICY_ID=reviewed:<policy-id>
MATERIAL_SECURITY_GATEWAY_TIMEOUT_MS=15000
MATERIAL_SECURITY_GATEWAY_MAX_RESPONSE_BYTES=2097152
```

该适配器通过 `POST /v1/media/scan` 与 `POST /v1/media/parse` 发送二进制材料。请求不包含原始文件名、账户/案件/材料 ID、用户叙述或原始文本；Parser 只接收检测到的 MIME 与容器类型。响应必须回显同一 `x-request-id`，并符合严格的 scanner verdict 或派生结果 schema。Gateway 仍只是隔离边界适配器，不能替代真实恶意文件扫描、解析沙箱、零留存合同、网络策略和端到端演练。

`vercel pull` 会在 Actions 临时 runner 上拉取这些变量，随后 `vercel build` 和 `vercel deploy --prebuilt` 使用同一份生产配置。`.vercel` 目录不会提交到仓库。

### 对话消息序号迁移（expand-contract）

`202609170010_add_conversation_message_sequence` 为每个账户/案件内的对话消息引入正整数、唯一且单调增长的 `message_sequence`。新应用实例在锁定案件行后显式分配下一个序号。为了允许迁移优先、应用滚动发布和必要的应用回滚，该迁移同时安装一个数据库触发器：旧实例未提供 `message_sequence` 时，触发器使用同一案件行锁分配序号。因此，迁移成功后新旧实例可在有限的滚动发布/回滚窗口内短暂混跑；新实例不得在第 10 个迁移之前启动。

迁移会在事务内对 `conversation_messages` 取 `ACCESS EXCLUSIVE` 锁，以保护列新增、历史回填、触发器安装和约束建立的原子性。事务设置 `lock_timeout=10s` 和 `statement_timeout=10min`；若长事务使独占锁无法及时取得，或迁移执行超时，迁移会失败并完整回滚，部署必须停止。执行前应检查并处置目标数据库中的长事务和锁等待，在受控低流量窗口运行，并监控锁等待和整个迁移时间；超时后先排除阻塞原因再重试，不得绕过迁移启动新实例。这不依赖人工停止对话写入作为正确性条件，但可在受控窗口暂停对话写入以降低锁竞争。历史行按 `created_at, message_id` 只做确定性回填；对同一毫秒内的旧消息，UUID 次序不能还原真实追加先后，不得将回填结果表述为原始事件顺序证明。

触发器是迁移和应用回滚的兼容桥，不在本次发布中删除。只有同时满足以下条件，才能通过另一个受审的 contract migration 移除它：所有 Web/worker 实例已收敛到显式写入序号的版本；旧版本回滚窗口已结束；新旧并发写、应用回滚和数据库恢复演练已通过；并且已取得可审计的版本收敛与旧写路径零使用证据。当前触发器不记录使用次数；没有这些证据时必须保留。

## 首次部署步骤

1. 在 Vercel 创建 Next.js 项目，记录 `ORG_ID` 和 `PROJECT_ID`。
2. 将上表四个 Secret 加入 GitHub 的 `production` Environment。
3. 将应用运行时变量加入 Vercel Production Environment。
4. 在 staging 上应用全部 11 个迁移，验证历史回填无 `NULL`/非正整数/重复序号，并完成旧实例触发器写入、新实例显式写入、并发写与应用回滚演练；确认 `conversation_turns`、部分唯一 turn/role 索引和归属外键已存在。
5. 在 GitHub Actions 手动运行 `Deploy production to Vercel`，首次发布当前 schema 时选择 `run_migrations=true`，并确认生产 Environment 审批。
6. 确认迁移 job 成功且第 11 个迁移可见后才允许 deploy job；迁移失败时停止发布，不得用 `run_migrations=false` 重跑来绕过。
7. 部署后先调用 `/api/health`，再验证对话可追加、重复 turn 可重放、`202 TURN_IN_PROGRESS`/`409` 错误契约和按 `messageSequence` 稳定读取，再打开 Vercel 生成的域名。
8. 后续合并到 `main` 只会自动运行 CI；需要发布到 Vercel 时，由有权限的维护者再次手动运行该 workflow。

### 对话 turn ledger 迁移与密钥

`202609180011_add_conversation_turn_ledger` 必须在启用要求 `turnId` 的应用前完成。该迁移不回填历史消息的 turn ID，并为新 turn 建立案件/账户归属约束；旧实例只能在有限滚动窗口内继续写入没有 turn ID 的历史消息。迁移 job 使用与前序 migration 相同的锁/语句超时策略，失败或取消必须阻断部署。

`CONVERSATION_TURN_MASTER_KEY` 必须与 `MATERIAL_DERIVATIVE_MASTER_KEY` 分离，由 KMS 或同等 Secret 管理系统注入；`CONVERSATION_TURN_KEY_VERSION` 用于轮换。应用会用 account/case/turn scope 作为 AES-GCM AAD，数据库中的 `result_snapshot`/`response_snapshot` 只应出现严格 envelope，不应出现可直接读取的 assistant 原文、事实值、source quote 或材料文本；这些有界字段如确有必要，只能存在于 envelope 解密后的应用内快照。生产环境任一 turn 快照密钥缺失、格式错误或解密失败时，对话接口 fail-closed；不得临时切换为明文 JSONB。

轮换前须先完成双读/重加密策略和恢复演练；当前实现只接受当前 key version，不能在没有迁移计划的情况下直接替换生产 key。外部 AI provider 的请求级 exactly-once 仍需供应商 idempotency 支持，turn ledger 不能替代该保证。

### 材料 worker 部署前检查

在 staging/production 中，先应用 `202609040008_add_material_processing_jobs` migration，再启动至少一个受监督的 worker 进程。为 worker 配置唯一的 `MATERIAL_PROCESSING_WORKER_ID`，将 `MATERIAL_PROCESSING_WORKER_ENABLED=true` 作为仅限 worker 进程的环境变量，并为进程设置自动重启、SIGTERM 优雅退出和健康检查。worker 默认使用 60 秒租约，并在租约过半时自动续租；监控 `pending`/`failed` 积压、续租/租约丢失和 `dead_letter` 事件。仓库现在提供不含任务/用户标识的进程内计数、停止摘要和 `starting/running/draining/stopped/faulted` 状态行，可作为日志/指标与 liveness/readiness 接入契约：监督器只解析完整状态行，仅 `state=running live=true ready=true` 可投递，`starting`/`draining`/`stopped`/`faulted` 均不可投递，`live=false` 可按外部策略触发重启。仓库只提供输出契约和本地 smoke 测试，不提供真实 supervisor、外部指标采集、阈值告警或自动恢复；这些以及恢复演练仍未在仓库实现，因此当前仍是部署前阻断项，不能宣称生产就绪。

## 当前边界

当前仓库已经具备材料配额、服务端解密读取接口、加密派生内容持久化、按 opaque `contentRef` 服务端解析 AI 上下文、版本化语音输入、管理员 RBAC、案件审核/标注/版本查询、变更历史查询和软删除的领域/服务基线；账户创建/恢复、会话 Cookie、首条消息前的账户与私密案件引导、案件 CRUD、乐观并发、对话消息持久化路由、案件列表、恢复访问和继续对话工作台已在本地实现并通过单元测试与浏览器回归。管理员材料读取不会暴露永久对象存储 URL，也不产生应用级查看记录。管理员案件维护界面只允许主管角色修改生命周期/工作流字段或软删除，并通过 `expectedVersion` 防止陈旧覆盖；修改和删除历史由 `/api/admin/cases/[caseId]/changes` 读取。`/start` 在无数据库或尚未创建私密案件时仍运行本地预览；私密案件创建后，前端会调用预约、分片 PUT 和 SHA-256 完成接口上传，并在上传失败时提供重试，不会误报“已保存”。材料进入后台扫描前不会进入 AI；浏览器只提交用户选择的 opaque refs，服务端在归属、状态、解密和总长度校验通过后才构造 AI 上下文。启用本地适配器需显式设置 `MATERIAL_OBJECT_STORE=local`、绝对路径 `MATERIAL_OBJECT_STORE_ROOT`、64 位十六进制 `MATERIAL_OBJECT_STORE_MASTER_KEY` 和 `MATERIAL_OBJECT_STORE_KEY_VERSION`；生产环境会强制禁用该模式。在 `APP_MODE=normal` 的生产环境下，必须同时配置数据库、会话密钥、AI Gateway、真实 OIDC/SSO 管理员身份提供方、经审查的加密对象存储适配器和派生内容密钥，否则相关 API 会安全返回 503。生产 KMS/密钥轮换、真实对象存储、扫描队列、真实 Gateway、OIDC/SSO、worker 监督与告警、备份恢复/删除演练和生产 PostgreSQL 集成演练仍未达到生产启用条件；这些开发或运营缺口不应被部署状态掩盖。部署成功不等于平台已获准接收真实举报；启用真实用户数据前必须通过 `docs/release-gates.md` 中的隐私、媒体安全、访问审计、备份恢复和删除演练门禁。
