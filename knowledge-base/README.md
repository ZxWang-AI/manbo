---
id: kb-root-readme
title: 强迫劳动知识库总索引
category: index
maintainer: is-your-labor-forced
last_verified: 2026-08-31
---

# 强迫劳动知识库（Agent Knowledge Base）

本知识库为 `is-your-labor-forced` 项目的 AI agent 提供判定强迫劳动与用户沟通所需的全部知识文件。知识来源于 `docs/research-and-plan.md` 研究报告，并按"agent 可检索、可引用、可维护"的原则拆分为单一主题的独立文件。

**Agent 使用前必读 `AGENT-GUIDE.md`**（检索路径、引用规则、输出纪律、危机处理、边界与更新流程）。

## 目录结构与文件索引

### 01-definitions/ —— 定义与判定基础

| 文件 | 内容 |
|------|------|
| `ilo-core-definition.md` | ILO 第 29 号公约第 2 条强迫劳动定义的三要件逐项解析（工作/服务、非自愿性、惩罚威胁），及与人口贩运、现代奴役、童工的概念边界 |
| `ilo-11-indicators.md` | ILO 11 项强迫劳动指标逐项拆解（定义、典型表现、判定要点、证据类型），agent 判定的核心对照表 |
| `jurisdiction-comparison.md` | 10 个法域（ILO/EU/美/英/德/法/澳/加/中/日）强迫劳动定义对比，及 5 个关键差异说明 |

### 02-laws/ —— 法律法规

| 文件 | 内容 |
|------|------|
| `eu-forced-labour-regulation.md` | 欧盟强迫劳动产品条例 (EU) 2024/3015：2027-12-14 起适用，产品禁售/撤市/处置机制 |
| `eu-csddd.md` | 欧盟企业可持续尽职调查指令（Omnibus 修订后）：适用门槛、5 项核心义务、投诉机制 |
| `eu-whistleblower-directive.md` | 欧盟吹哨人指令 2019/1937：反报复保护、举证责任倒置、渠道要求及成员国立法 |
| `us-tariff-act-307.md` | 美国关税法第 307 条（19 U.S.C. § 1307）："全部或部分"标准、TFTEA 2016 废除"市场需求例外" |
| `us-uflpa.md` | 美国《维吾尔强迫劳动预防法》(UFLPA)：可反驳推定、明确且令人信服的证据标准、实体清单 |
| `us-criminal-provisions.md` | 美国刑事条款：18 U.S.C. § 1589（最高 20 年监禁）、§ 1590、TVPA 与 T 签证保护 |
| `other-jurisdictions.md` | 德国（LkSG/StGB § 233）、英国（MSA 2015）、法国、澳大利亚、加拿大、中国（刑法 244 条）、日本 |

### 03-import-export/ —— 进出口管制与执法

| 文件 | 内容 |
|------|------|
| `us-enforcement.md` | 美国 CBP 执法链路、WRO 发令机制、有效举报的构成要素与证据包映射 |
| `eu-enforcement.md` | 欧盟 FLR 调查启动（依职权/单一门户投诉）、裁决流程、证据标准 |
| `entity-lists.md` | UFLPA 实体清单（5 项列入标准、行业分布、动态）、其他公开数据库一览 |

### 04-judgment/ —— AI 判定规则（agent 核心逻辑）

| 文件 | 内容 |
|------|------|
| `assessment-framework.md` | 三层评估框架：ILO 指标匹配 → 法律映射 → 证据完备性，含硬性规则与结构化输出卡片格式 |
| `evidence-standards.md` | 7 类证据分类、A-D 证据强度分级、缺口追问话术、取证安全红线 |
| `severity-scale.md` | S1（紧急）至 S4（一般劳动纠纷）严重度分级及对应处置 |
| `output-rules.md` | 输出纪律：禁止表述 vs 替代表述对照表、概率化语言规则、3 段强制免责声明固定文本 |
| `referral-rules.md` | 转介决策流：按用户处境匹配举报渠道、话术原则、危机情形固定动作 |

### 05-reporting-channels/ —— 举报渠道

| 文件 | 内容 |
|------|------|
| `channels-by-jurisdiction.md` | 各法域官方举报渠道（CBP/FBI/NHTH/BAFA/12333 等）、NGO 渠道、选择考量 |
| `consequences.md` | 吹哨人保护与现实风险、被举报企业面临的后果、重复举报说明 |

### 06-communication/ —— 用户沟通

| 文件 | 内容 |
|------|------|
| `principles.md` | 创伤知情、不评判、诚实预期管理、用户决策权、语言可及性五原则及对话结构 |
| `safety-protocols.md` | 危机触发信号表（暴力/拘禁/自伤/未成年人/贩运）、三步危机协议、禁止行为清单 |
| `disclaimers.md` | 8 段固定免责声明文本（评估页脚、首页、企业页、隐私、法律引用等）及使用规则 |
| `faq.md` | 12 个高频问题及回应指引（匿名性、后果、证据准备、设备安全等） |

## 文件格式约定

每个文件头部包含 YAML frontmatter：

```yaml
---
id: 唯一标识（kebab-case）
title: 文件标题
category: definitions | laws | import-export | judgment | reporting-channels | communication
jurisdiction: 适用法域（ILO / EU / US / DE / UK / CN / ...，可多值）
authority: 法律文件或权威来源
last_verified: 内容最后核实日期（YYYY-MM-DD）
sources: 来源列表
---
```

## 维护纪律

1. **时效性**：法律文件 `last_verified` 距今超过 90 天时，agent 必须提示用户"信息可能滞后，请以官方最新发布为准"，并列入知识库更新清单。
2. **修改流程**：更新任何文件后同步更新 `last_verified`，并在对应 `sources` 中补充新来源；结构性调整需同步修订本 README 与 `AGENT-GUIDE.md`。
3. **新增文件**：遵循"一文件一主题"，加入对应编号文件夹，并在本 README 索引表中登记。
4. **禁止事项**：不得在知识库中添加未经核实的个案指控、企业黑名单式结论或任何官方清单之外的事实断言。
