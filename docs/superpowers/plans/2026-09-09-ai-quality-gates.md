# AI 质量与安全门禁实施计划

> **For agentic workers:** 本计划按 TDD 顺序执行；每个任务先写失败测试，再写最小实现，并在锁定运行时验证。

**Goal:** 将 AI 危机优先、法律越界和来源追溯边界变成独立的 CI 发布阻断门禁。

**Architecture:** 不修改用户-facing AI 状态模型，也不引入评分字段。新增专门的 Vitest 门禁套件复用现有 deterministic provider 与黄金案例；浏览器级法域边界继续由现有 Playwright 测试覆盖；GitHub Actions 通过独立 job 运行 `pnpm test:ai-quality`。

**Tech Stack:** TypeScript、Vitest、Playwright、pnpm、GitHub Actions、Node.js 22.14.0。

## 执行状态（2026-09-09）

- 已完成门禁测试、聚合器、`pnpm test:ai-quality` 命令和独立 Actions job。
- 本机直接调用已安装二进制验证：质量门禁 12/12、全量单元测试 70 文件/340 项、法域导航 Playwright 2 项、lint、typecheck、生产构建均通过。
- 本机 Node 25.8.2 / pnpm 9.15.9 不满足项目锁定值；锁定运行时的最终证据以 GitHub Actions 为准。
- 提交 `529a390` 的锁定运行时远程 CI 已通过：[Actions run 34309785468](https://github.com/ZxWang-AI/manbo/actions/runs/34309785468)。

## Global Constraints

- 不输出法律认定、违法结论、成功率、概率、排名、星级或证据分数。
- 危机信号必须优先于模型调用和常规证据追问。
- 未知消息 ID、知识来源 ID 或不满足 schema 的 provider 输出必须安全降级。
- 质量门禁只用于内部发布证据，不向用户展示评分。
- 不使用 Docker；PostgreSQL 仍由现有 integration job 直接运行在 runner 上。

### Task 1: 建立失败的专门门禁测试

**Files:**
- Create: `tests/unit/ai-quality-gates.test.ts`

- [ ] **Step 1: Write the failing test**

覆盖黄金案例、危机抢占、法律越界降级和未知来源降级；测试先引用尚不存在的 `runAiQualityGates`，确保不是“测试立即通过”。

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/ai-quality-gates.test.ts`

Expected: FAIL because the gate runner module does not exist。

### Task 2: 实现最小门禁运行器

**Files:**
- Create: `src/ai/quality-gates.ts`
- Modify: `tests/unit/ai-quality-gates.test.ts`

- [ ] **Step 1: Implement the smallest runner**

实现 `runAiQualityGates()`，返回带有稳定 ID、通过/失败状态和简短证据文本的结果；运行器只聚合测试提供的 check，不计算用户-facing 分数，也不改变编排器行为。

- [ ] **Step 2: Run the focused tests**

Run: `pnpm vitest run tests/unit/ai-quality-gates.test.ts`

Expected: PASS，且每个门禁均有明确的通过结果。

### Task 3: 接入本地命令与 GitHub Actions

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the command**

增加 `test:ai-quality: vitest run tests/unit/ai-quality-gates.test.ts tests/unit/golden-cases.test.ts`；未确认法域的浏览器场景继续由完整 E2E job 执行，CI 专门 job 只运行可在无浏览器依赖时稳定执行的 unit gate，避免重复安装浏览器。

- [ ] **Step 2: Add the CI job**

增加 `AI quality gates` job，使用与 verify 相同的 Node/pnpm 锁定版本，执行安装、Prisma client 生成和 `pnpm test:ai-quality`。job 不使用 Docker。

- [ ] **Step 3: Run local checks**

Run: `pnpm test:ai-quality`, `pnpm lint`, `pnpm typecheck`。

Expected: 全部 PASS。

### Task 4: 固化发布证据与下一阶段计划

**Files:**
- Modify: `docs/release-gates.md`
- Modify: `docs/testing/red-team-report.md`
- Modify: `README.md`

- [ ] **Step 1: Document the gate**

记录门禁命令、覆盖边界和“内部通过/失败，不是用户评分”的解释；保留真实模型、对象存储/KMS、worker 监督和多语言人工审阅为后续生产阻断项。

- [ ] **Step 2: Run the complete local suite**

Run: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`。

Expected: PASS；失败时先修复回归，再提交。

### Task 5: 提交、推送并触发远程 Action

**Files:**
- Git-tracked changes only; do not add local `AGENTS.md` or `CLAUDE.md`。

- [ ] **Step 1: Commit**

提交消息：`test: add AI quality gates`。

- [ ] **Step 2: Push**

推送到当前 `codex/ci-flake-fix-main` 分支，不合并 `main`。

- [ ] **Step 3: Dispatch and verify**

使用已认证的 GitHub CLI 手动触发 `CI` workflow，等待 `Verify`、`AI quality gates`、PostgreSQL integration 和 Browser/accessibility jobs 全部成功。
