# is-your-labor-forced

A site for forced labor report & detection — 一个面向全球的强迫劳动举报与识别平台（开发中）。

[English](#what-this-project-is) | [中文](#项目简介)

## What this project is

is-your-labor-forced is a reporting platform for people who suspect they are experiencing forced labor. It is being built around four capabilities:

- **AI-assisted assessment.** A conversational agent grounded in an ILO-based indicator framework helps users describe their situation, matches it against the 11 forced labor indicators, and maps the relevant laws by jurisdiction. The agent never issues legal conclusions — it reports risk signals and evidence gaps.
- **Evidence packaging.** Users can attach photos, documents, and narrative descriptions. Content fingerprints (not device fingerprints) support duplicate detection and cross-user case grouping without identifying individuals.
- **Company and region lookup.** Reported cases are searchable by company, industry, and region, always shown as unverified allegations, separate from official findings and entity lists.
- **Reporting channel guidance.** The platform matches each user's jurisdiction and situation to official complaint channels (CBP, BAFA, labor inspectorates, hotlines) and NGO alternatives, while leaving the decision of whether, where, and when to report entirely to the user.

## Repository contents

The repository currently holds the research foundation and the knowledge base that will power the agent. No application code has been written yet.

| Path | Description |
|------|-------------|
| `docs/research-and-plan.md` | Research report and product plan: legal landscape across 10 jurisdictions, enforcement mechanisms, complaint channel analysis, product concept, and technical architecture |
| `knowledge-base/` | 26 Markdown files for the AI agent, organized in six layers |
| `knowledge-base/README.md` | Index of all knowledge base files with maintenance rules |
| `knowledge-base/AGENT-GUIDE.md` | Hard constraints for the agent: retrieval paths, citation rules, output discipline, crisis handling, refusal boundaries |

### Knowledge base layers

| Folder | Covers |
|--------|--------|
| `01-definitions/` | ILO Convention 29 three-element definition, the 11 indicators, definition comparison across 10 jurisdictions |
| `02-laws/` | EU Forced Labour Regulation, CSDDD, Whistleblower Directive; US Tariff Act Section 307, UFLPA, criminal provisions; Germany, UK, France, Australia, Canada, China, Japan |
| `03-import-export/` | CBP and EU enforcement mechanisms, UFLPA Entity List, what makes an effective allegation |
| `04-judgment/` | The agent's decision logic: three-layer assessment framework, evidence grading (A–D), severity scale (S1–S4), output phrasing rules, referral decision flow |
| `05-reporting-channels/` | Official and NGO channels by jurisdiction, whistleblower protections and realistic risks |
| `06-communication/` | Trauma-informed principles, crisis protocols, fixed disclaimer texts, FAQ |

Every file carries YAML frontmatter with `id`, `jurisdiction`, `authority`, `last_verified`, and `sources`, so the agent can verify legal facts against the knowledge base instead of generating them and can flag information older than 90 days.

## Design principles

- The agent does not decide for the user. Whether, where, and when to report are the user's decisions alone.
- Reported allegations never become facts. User submissions are always framed as unverified and displayed separately from official enforcement records.
- Privacy is structural, not optional. Content fingerprints instead of device identifiers, end-to-end encryption for evidence storage, tiered anonymity.
- Crisis safety overrides everything. Indicators of violence, confinement, self-harm risk, or trafficking suspicion interrupt the assessment flow immediately and route to emergency resources.

## Status

Research and knowledge base are complete and verified as of 2026-08-31. Application development has not started. Legal content requires periodic re-verification — see the maintenance rules in `knowledge-base/README.md`.

## Important notice

This project provides information and referrals. It is not legal advice, and AI-generated assessments are not legal determinations of forced labor. If you are in immediate danger, contact local emergency services first.

## Attribution and neutrality

Most of the development and information collection for this project was performed by TraeCN + GLM5.3 and Codex + 5.6 Sol. These tools and their vendors are not affiliated with this project, did not take part in its initiation or decisions, and neither endorse nor bear responsibility for its content.

Project ideas drew on videos and comments posted by users on Xiaohongshu, Douyin, and similar platforms. That material served as inspiration only; its original creators are not involved in this project, and their views are not represented by it.

The project owner maintains a permanent neutral stance and does not side with any party's viewpoint or position. The final right of interpretation of this project belongs to the project owner.

## License

[MIT](LICENSE) © 2026 ZxWang-AI

---

## 项目简介

is-your-labor-forced 是一个面向全球劳动者的强迫劳动举报与识别平台，处于研究与规划阶段。平台围绕四项能力设计：

- **AI 辅助判定。** 以 ILO 指标框架为知识基础的对话式 agent，帮助用户描述处境、对照 11 项强迫劳动指标、映射所在法域的法律。agent 不输出法律结论，只呈现风险信号与证据缺口。
- **证据包提交。** 用户可上传照片、文件并填写文字描述。平台使用内容指纹（而非设备指纹）做去重与跨用户关联，不识别个人身份。
- **企业与地区查询。** 举报案例按公司、行业、地区检索，一律标注为未经证实的指控，与官方执法记录、实体清单分开呈现。
- **举报渠道指引。** 按用户所在法域和处境匹配官方举报渠道（CBP、BAFA、劳动监察、热线）与 NGO 替代渠道。是否举报、向谁举报、何时举报，决定权完全在用户。

### 仓库内容

当前仓库包含研究与知识库两部分，应用代码尚未开始开发。

| 路径 | 说明 |
|------|------|
| `docs/research-and-plan.md` | 研究报告与产品方案：10 个法域的法律全景、执法机制、举报渠道分析、产品构想与技术架构 |
| `knowledge-base/` | 供 AI agent 使用的 26 个 Markdown 文件，按六个层次组织 |
| `knowledge-base/README.md` | 全部知识库文件的索引与维护规则 |
| `knowledge-base/AGENT-GUIDE.md` | agent 硬性约束：检索路径、引用规则、输出纪律、危机处理、拒绝边界 |

知识库六个层次：`01-definitions/`（定义与指标）、`02-laws/`（法律法规）、`03-import-export/`（进出口管制与执法）、`04-judgment/`（AI 判定规则）、`05-reporting-channels/`（举报渠道）、`06-communication/`（用户沟通）。

每个文件头部含 YAML frontmatter（`id`、`jurisdiction`、`authority`、`last_verified`、`sources`），agent 引用法律事实时以知识库为准，不凭记忆生成，并会对超过 90 天未核实的信息附加时效提示。

### 设计原则

- 用户决策权优先。是否举报、向谁举报、何时举报，完全由用户自己决定。
- 举报不等于事实。用户提交的内容一律标注为未经证实，与官方记录分开呈现。
- 隐私是结构设计而非选项。内容指纹替代设备标识，证据端到端加密，匿名分级。
- 危机安全高于一切。出现暴力、拘禁、自伤风险或疑似贩运信号时，立即中断评估流程并转介紧急资源。

### 当前状态

研究与知识库已于 2026-08-31 完成并核实。应用开发尚未启动。法律内容需定期复核，维护规则见 `knowledge-base/README.md`。

### 重要声明

本平台提供信息与转介，不构成法律意见，AI 评估结果不构成对强迫劳动的法律认定。如处境危急，请优先联系当地紧急服务。

### 署名与中立声明

本项目的大部分开发与资料收集工作由 TraeCN + GLM5.3 与 Codex + 5.6 Sol 完成。上述工具及其所属公司未参与本项目的发起与决策，与本项目的立场和内容无任何关联，亦不为本项目背书或承担责任。

本项目的创意参考了小红书、抖音等平台网友发布的视频与评论。相关内容仅作为灵感来源，原作者未参与本项目，本项目亦不代表其观点。

项目维护者永久保持中立立场，不站在任何一方的观点与立场。本项目的最终解释权归项目维护者所有。

### 许可证

[MIT](LICENSE) © 2026 ZxWang-AI
