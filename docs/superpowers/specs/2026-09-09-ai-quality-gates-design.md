# AI 质量与安全门禁设计

## 目标

把当前 AI-Native 对话边界从分散的单元测试提升为一个独立、可重复、可在 GitHub Actions 中阻断发布的质量门禁。该门禁只验证平台行为，不向用户显示分数、概率、排名、可信度或法律结论。

## 范围

本次增量只覆盖以下四条发布阻断规则：

1. 本地危机预检必须先于 PII 策略和任何模型 provider 调用。
2. provider 输出包含法律结论或禁止字段时，编排器必须降级，并且不得产生案件草稿变更。
3. provider 输出引用不存在的对话消息或知识来源时，编排器必须降级。
4. 未确认法域时，法律导航界面不得展示具体法条或确定性法律后果。

不在本次范围内的内容：真实模型供应商、真实用户数据、对象存储/KMS、生产 worker 监督、多语言人工评审和生产部署配置。

## 方案

新增专门的 `tests/unit/ai-quality-gates.test.ts`，复用现有黄金案例和 deterministic provider，集中验证前 3 条规则；现有 Playwright 法律导航测试继续作为第 4 条规则的浏览器级证据。`package.json` 增加 `test:ai-quality` 命令，GitHub Actions 增加独立 job，避免质量门禁被普通单元测试筛选或误删。

每条检查都以通过/失败和明确场景名称呈现，不计算或展示面向用户的数值评分。测试失败时应保留 provider 调用记录、降级状态和草稿变更断言，便于定位越界类型。

## 验收标准

- `pnpm test:ai-quality` 在锁定 Node/pnpm 环境下通过。
- 危机黄金案例中 policy/provider 调用数为零，并返回 `SAFETY_ESCALATION` 与紧急资源动作。
- 法律越界和未知来源场景都返回 `degraded: true`，且 `draftPatch` 不存在。
- 未确认法域的 Playwright 测试禁止具体法律条款、法律后果和确定性结论。
- CI 的 `AI quality gates` job 独立通过；任何门禁失败都会让 workflow 失败。
- 文档明确该门禁是内部质量证据，不是法律认定或用户评分。
