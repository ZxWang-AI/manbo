---
id: kb-root-readme
title: 强迫劳动知识库总索引
category: index
maintainer: is-your-labor-forced
jurisdiction: 通用
authority: 平台知识库维护规范
last_verified: 2026-08-31
evidence_status: design
sources:
  - ../docs/research-and-plan.md
  - ../docs/risk-register.md
  - ../docs/release-gates.md
---

# 强迫劳动知识库（Agent Knowledge Base）

本知识库为未来的 Manbo agent 提供“举报准备与信息导航”所需的定义、法律导航、执法入口、判断规则、渠道和沟通资料。它不是法律意见库，也不是官方事实数据库。**Agent 使用前必读 [`AGENT-GUIDE.md`](AGENT-GUIDE.md)。**

## 目录结构与文件索引

### 01-definitions/ —— 定义与判定基础

| 文件 | 内容 |
|------|------|
| `ilo-core-definition.md` | ILO 第 29 号公约第 2 条三要件与概念边界 |
| `ilo-11-indicators.md` | 11 项指标、典型表现、证据类型和安全提示 |
| `jurisdiction-comparison.md` | 国际、欧盟、美国及主要法域的导航级差异 |

### 02-laws/ —— 法律导航摘要

| 文件 | 内容 |
|------|------|
| `eu-forced-labour-regulation.md` | Regulation (EU) 2024/3015 的官方日期、范围和待核实实施细节 |
| `eu-csddd.md` | Directive (EU) 2024/1760；修法和成员国转化状态不硬编码 |
| `eu-whistleblower-directive.md` | Directive (EU) 2019/1937 与成员国转化差异 |
| `us-tariff-act-307.md` | 美国进口禁令的法律导航 |
| `us-uflpa.md` | UFLPA 推定、官方入口和动态实体清单提示 |
| `us-criminal-provisions.md` | 18 U.S.C. § 1589/1590 与转介边界 |
| `other-jurisdictions.md` | 德/英/法/澳/加/中/日概览，均需运行时核验 |

### 03-import-export/ —— 进出口与公开数据入口

| 文件 | 内容 |
|------|------|
| `us-enforcement.md` | CBP 线索要素、流程和不承诺反馈规则 |
| `eu-enforcement.md` | FLR 适用日期、调查路径和官方链接策略 |
| `entity-lists.md` | UFLPA 及其他公开数据库的链接，不复制动态快照 |

### 04-judgment/ —— Agent 判断与输出规则

| 文件 | 内容 |
|------|------|
| `assessment-framework.md` | 指标匹配 → 法域确认 → 证据缺口的三层流程 |
| `evidence-standards.md` | 证据类型、强度、原始性和安全红线 |
| `severity-scale.md` | 仅内部使用的紧迫度分级 |
| `output-rules.md` | 禁止法律结论、来源和免责声明纪律 |
| `referral-rules.md` | 按行为地/用户地/产品流向匹配渠道 |

### 05-reporting-channels/ —— 举报渠道

| 文件 | 内容 |
|------|------|
| `channels-by-jurisdiction.md` | 官方/NGO 渠道与运行时核验提示 |
| `consequences.md` | 举报人保护、现实风险和企业侧后果 |

### 06-communication/ —— 用户沟通

| 文件 | 内容 |
|------|------|
| `principles.md` | 创伤知情、不评判、可及性和用户决定权 |
| `safety-protocols.md` | 暴力、拘禁、自伤、未成年人和贩运危机协议 |
| `disclaimers.md` | 固定免责声明与防滥用文案 |
| `faq.md` | 高频问题的事实与立场口径 |

当前共有 26 个 Markdown 文件（含本索引和 Agent 指南）。

## 文件格式与证据状态

每个主题文件头部包含 YAML frontmatter：

```yaml
---
id: 唯一标识（kebab-case）
title: 文件标题
category: definitions | laws | import-export | judgment | reporting-channels | communication
jurisdiction: 适用法域
authority: 法律文件、官方机构或平台规范
last_verified: YYYY-MM-DD
evidence_status: verified | design | needs-review
sources:
  - 官方来源 URL 或项目内设计文档
---
```

- `verified`：可由官方法律文本、官方机构页面或 ILO 一手出版物追溯。
- `design`：平台流程或安全规范，不是法律事实。
- `needs-review`：来源动态、二手、修法进行中或无法稳定复核；不得用于硬编码法律结论。

用户报告、公司回应和第三方材料必须在数据模型中单独标记来源层，不能写回法律事实文件。

## 维护与变更纪律

1. 法律、渠道和动态清单超过 90 天未复核时，agent 必须提示可能滞后并链接官方页面。
2. 更新文件必须同步修改 `last_verified`、`evidence_status`、`sources` 和变更摘要；发现冲突时保留冲突说明，不自行选择“看起来合理”的版本。
3. 不得复制动态实体清单数量、案件统计或公司指控快照；只保存官方链接、抓取日期和必要的结构化字段。
4. 不得加入未经核实的个案指控、个人隐私、企业黑名单结论或鼓励冒险取证的内容。
5. 结构性调整须同步修订 `AGENT-GUIDE.md`、README 和发布门禁。
6. 任何新法域先作为 `needs-review` 导航条目，经过官方来源和目标法域法律审阅后才可升级为 `verified`。

## 与发布门禁的关系

知识库事实状态是 Gate 0 的输入。Gate 1 仅允许举报准备能力；证据托管、公开聚合、地图、跨用户关联和 API 必须分别通过 [`../docs/release-gates.md`](../docs/release-gates.md) 的后续门禁。没有门禁批准，agent 不得向用户暗示这些功能已经存在。
