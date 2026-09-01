# 部署指南

本仓库把 GitHub 作为源码、审查和自动化中心，把 Vercel 作为 Next.js 运行环境，把 PostgreSQL 作为持久化数据库。GitHub Pages 只能承载静态原型，不能运行案件、AI、语音或材料托管服务。

## 部署前提

- GitHub 账号对仓库有 `Write` 或更高权限。
- 已创建 Vercel 项目，并确认项目使用 Node.js 22.x。
- 已创建 PostgreSQL 数据库；生产连接串只放在 GitHub `production` Environment Secret 和 Vercel Production Environment Variables 中。
- AI Gateway 已完成供应商、模型别名、区域和留存策略审阅。生产环境必须使用 `AI_PROVIDER=gateway`，不能使用 mock provider。
- 生产环境应为 GitHub Actions 的 `production` Environment 配置 required reviewers，至少在首次迁移前完成一次人工批准。

## GitHub Actions

### CI

`.github/workflows/ci.yml` 在 `main`、`codex/**` 分支 push 和 Pull Request 上运行：

1. 固定 Node `22.14.0` 与 pnpm `11.24.0`。
2. 冻结锁文件安装依赖并生成 Prisma Client。
3. 执行 lint、TypeScript、单元测试、静态生产构建和高危依赖审计。

### 生产部署

`.github/workflows/deploy-vercel.yml` 在 push 到 `main` 时运行，也支持手动触发。push 到 `main` 会先执行 `prisma migrate deploy`，迁移失败时不会部署应用。手动触发默认不执行迁移；如确实需要迁移，勾选 `run_migrations`。

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

`vercel pull` 会在 Actions 临时 runner 上拉取这些变量，随后 `vercel build` 和 `vercel deploy --prebuilt` 使用同一份生产配置。`.vercel` 目录不会提交到仓库。

## 首次部署步骤

1. 在 Vercel 创建 Next.js 项目，记录 `ORG_ID` 和 `PROJECT_ID`。
2. 将上表四个 Secret 加入 GitHub 的 `production` Environment。
3. 将应用运行时变量加入 Vercel Production Environment。
4. 在 GitHub Actions 手动运行 `Deploy production to Vercel`，首次选择 `run_migrations=true`，并确认生产 Environment 审批。
5. 检查 Actions 中迁移和部署均成功，再打开 Vercel 生成的域名。
6. 后续合并到 `main` 会自动运行 CI、迁移和部署；迁移失败会阻止部署。

## 当前边界

当前仓库已经具备材料安全存储、配额和版本化语音输入的领域/服务基线，但 AI 对话工作台、真实对象存储适配和数据库集成验证仍在后续 Task 6 及环境就绪后完成。部署成功不等于平台已获准接收真实举报；启用真实用户数据前必须通过 `docs/release-gates.md` 中的隐私、媒体安全、访问审计、备份恢复和删除演练门禁。
