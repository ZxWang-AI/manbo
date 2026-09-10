# 部署指南

本仓库把 GitHub 作为源码、审查和自动化中心，把 PostgreSQL 作为持久化数据库。Vercel 是可选的手动部署流程；当前选择的运行目标是 Proxmox 私有 staging，但在服务器初始化和发布通道完成前，当前没有配置自动部署目标。GitHub Pages 只能承载静态原型，不能运行案件、AI、语音或材料托管服务。

如果没有 Vercel，可以使用 Proxmox 中的独立 Ubuntu VM 运行私有 staging。完整的无 Docker、systemd、Caddy、PostgreSQL、VPN 和后续 GitHub Actions 方案见 [`docs/superpowers/plans/2026-09-09-home-server-proxmox-deployment.md`](superpowers/plans/2026-09-09-home-server-proxmox-deployment.md)。该方案默认不开放公网，也不允许在 Gate 1/2 完成前接收真实举报材料。

## 部署前提

- GitHub 账号对仓库有 `Write` 或更高权限。
- 已创建 Vercel 项目，并确认项目使用 Node.js 22.x。
- 已创建 PostgreSQL 数据库；生产连接串只放在 GitHub `production` Environment Secret 和 Vercel Production Environment Variables 中。
- AI Gateway 已完成供应商、模型别名、区域和留存策略审阅。生产环境必须使用 `AI_PROVIDER=gateway`，不能使用 mock provider。
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

`.github/workflows/deploy-vercel.yml` 仅支持从 GitHub Actions 页面手动触发，不会因 push 到 `main` 自动运行。手动触发默认不执行迁移；如确实需要迁移，勾选 `run_migrations`。迁移失败时不会部署应用。没有配置下列 Vercel 和数据库 Secrets 时不要运行该 workflow。

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
```

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

## 首次部署步骤

1. 在 Vercel 创建 Next.js 项目，记录 `ORG_ID` 和 `PROJECT_ID`。
2. 将上表四个 Secret 加入 GitHub 的 `production` Environment。
3. 将应用运行时变量加入 Vercel Production Environment。
4. 在 GitHub Actions 手动运行 `Deploy production to Vercel`，首次选择 `run_migrations=true`，并确认生产 Environment 审批。
5. 检查 Actions 中迁移和部署均成功，再打开 Vercel 生成的域名。
6. 后续合并到 `main` 只会自动运行 CI；需要发布到 Vercel 时，由有权限的维护者再次手动运行该 workflow。

### 材料 worker 部署前检查

在 staging/production 中，先应用 `202609040008_add_material_processing_jobs` migration，再启动至少一个受监督的 worker 进程。为 worker 配置唯一的 `MATERIAL_PROCESSING_WORKER_ID`，将 `MATERIAL_PROCESSING_WORKER_ENABLED=true` 作为仅限 worker 进程的环境变量，并为进程设置自动重启、SIGTERM 优雅退出和健康检查。worker 默认使用 60 秒租约，并在租约过半时自动续租；监控 `pending`/`failed` 积压、续租/租约丢失和 `dead_letter` 事件。仓库现在提供不含任务/用户标识的进程内计数、停止摘要和 `starting/running/draining/stopped/faulted` 状态行，可作为日志/指标与 liveness/readiness 接入契约：监督器只解析完整状态行，仅 `state=running live=true ready=true` 可投递，`starting`/`draining`/`stopped`/`faulted` 均不可投递，`live=false` 可按外部策略触发重启。仓库只提供输出契约和本地 smoke 测试，不提供真实 supervisor、外部指标采集、阈值告警或自动恢复；这些以及恢复演练仍未在仓库实现，因此当前仍是部署前阻断项，不能宣称生产就绪。

## 当前边界

当前仓库已经具备材料配额、服务端解密读取接口、版本化语音输入、管理员 RBAC、案件审核/标注/版本查询、变更历史查询和软删除的领域/服务基线；账户创建/恢复、会话 Cookie、首条消息前的账户与私密案件引导、案件 CRUD、乐观并发和对话消息持久化路由已在本地实现并通过单元测试。管理员材料读取不会暴露永久对象存储 URL，也不产生应用级查看记录。管理员案件维护界面只允许主管角色修改生命周期/工作流字段或软删除，并通过 `expectedVersion` 防止陈旧覆盖；修改和删除历史由 `/api/admin/cases/[caseId]/changes` 读取。`/start` 在无数据库或尚未创建私密案件时仍运行本地预览；私密案件创建后，前端会调用预约、分片 PUT 和 SHA-256 完成接口上传材料，并在上传失败时提供重试，不会误报“已保存”。材料进入后台扫描前不会进入 AI。启用本地适配器需显式设置 `MATERIAL_OBJECT_STORE=local`、绝对路径 `MATERIAL_OBJECT_STORE_ROOT`、64 位十六进制 `MATERIAL_OBJECT_STORE_MASTER_KEY` 和 `MATERIAL_OBJECT_STORE_KEY_VERSION`；生产环境会强制禁用该模式。在 `APP_MODE=normal` 的生产环境下，必须同时配置数据库、会话密钥、AI Gateway、真实 OIDC/SSO 管理员身份提供方和经审查的加密对象存储适配器，否则相关 API 会安全返回 503。真实对象存储/KMS、扫描队列、真实 Gateway、OIDC/SSO 和 PostgreSQL 集成演练仍未达到生产启用条件。部署成功不等于平台已获准接收真实举报；启用真实用户数据前必须通过 `docs/release-gates.md` 中的隐私、媒体安全、访问审计、备份恢复和删除演练门禁。
