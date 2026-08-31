# 慢波 Manbo 安全优先文档与治理实施计划

> **For agentic workers:** This plan records the approved documentation/governance work. No application code, deployment, or real user data is in scope.

**Goal:** 将 Manbo 的研究、知识库和产品路线改为可追溯、最小化数据、以举报人安全为先的治理基线。

**Architecture:** 以 `docs/research-and-plan.md` 作为策略叙事，以 `docs/risk-register.md` 和 `docs/release-gates.md` 作为风险与发布控制，以 `knowledge-base/` 作为带来源状态的检索材料。README 只描述当前已存在的文档能力；未来产品功能必须通过门禁后才能写成已上线能力。

**Tech Stack:** Markdown、YAML frontmatter、Git、Windows Git Credential Manager。

## Global Constraints

- 只修改文档、知识库和本地 Git 配置；不编写应用代码、不部署、不收集真实用户数据。
- 不把待核实法律事实、动态清单数量或用户报告写成确定事实。
- 不把 token 写入远程 URL、仓库文件或提交内容。
- 高危功能（证据托管、公开聚合、地图、跨用户关联、B2B API）必须有对应发布门禁。

### Task 1: 建立批准的安全设计规格

**Files:**
- Create: `docs/superpowers/specs/2026-08-31-safe-documentation-governance-design.md`

- [x] 记录问题、证据分级、MVP 边界、后置功能门槛、Git 静默认证和验证标准。
- [x] 运行 `rg -n "TBD|TODO|placeholder|Similar to" docs/superpowers/specs/2026-08-31-safe-documentation-governance-design.md`，预期无输出。

### Task 2: 重写研究报告

**Files:**
- Modify: `docs/research-and-plan.md`

- [x] 保留法律基线、用户任务、产品方案、路线图和风险结论。
- [x] 删除来源占位符和未能由一手来源稳定复核的确定性数字。
- [x] 纠正中国 2022 年批准 ILO C29/C105 的事实，并将 CSDDD/FLR 动态细节标记为待核实。
- [x] 把 MVP 收敛为法域确认、结构化自述、证据安全清单、官方链接和短期导出。

### Task 3: 建立风险登记册和发布门禁

**Files:**
- Create: `docs/risk-register.md`
- Create: `docs/release-gates.md`

- [x] 覆盖人身安全、隐私、诽谤/SLAPP、AI、内容滥用、供应商、跨境、可及性和运维风险。
- [x] 为 MVP、证据托管、公开聚合和 B2B API 定义阻断条件、证据和责任角色。

### Task 4: 更新 README 与知识库治理

**Files:**
- Modify: `README.md`
- Modify: `knowledge-base/README.md`
- Modify: `knowledge-base/AGENT-GUIDE.md`
- Modify: `knowledge-base/**/*.md`

- [x] 为主题文件补充 `evidence_status` 和 `sources` 元数据。
- [x] 将当前能力与未来建议分离，禁止 agent 暗示公开举报、证据托管、地图或公司查询已上线。
- [x] 加入冲突处理、90 天复核、数据最小化和发布门禁规则。
- [x] 将加密托管承诺改为未来门禁条件，并修正中国批准状态。

### Task 5: 配置 Git 静默凭据

**Files:**
- Modify: local `.git/config` only

- [x] 设置 `credential.helper=manager`、`credential.interactive=false`、`credential.guiPrompt=false`。
- [x] 保持远程 URL 不含 token；凭据仅存 Windows Credential Manager。
- [x] 使用 `git push --dry-run` 验证，凭据有效时无登录弹窗；凭据失效时直接失败。

### Task 6: 验证与交付

**Files:**
- Test: all Markdown files and Git configuration

- [x] `rg -n '\$TRAE_REF' README.md docs/research-and-plan.md knowledge-base` 无输出。
- [x] 所有 `knowledge-base/**/*.md` 具有 frontmatter、`evidence_status` 和 `sources`。
- [x] `rg -n '中国未批准|2026 年 6 月 26 日已上线' README.md docs/research-and-plan.md knowledge-base` 无错误性命中。
- [x] `git remote get-url origin` 不含 `ghp_`、`password=` 或 token 明文。
- [x] Markdown 链接、frontmatter 和 Git 静默认证检查通过；待提交内容仅为本次文档变更。
