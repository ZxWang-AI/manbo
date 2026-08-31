# 慢波 Manbo（Forced-Labor-Detector）

慢波 Manbo 是一个面向强迫劳动相关信息整理与举报准备的研究项目。当前仓库是文档与知识库基线，**尚未提供可供公众使用的应用、执法服务或法律认定**。

> 波如正义，不需要快，但是会来。
> Waves, like justice, need not be fast, but they will come.

## 项目定位

Manbo 的目标是帮助用户：

- 以 ILO 11 项指标结构化描述经历，并识别信息缺口；
- 了解行为发生地、用户所在地和产品流向对应的官方/NGO 渠道；
- 在不为取证冒险的前提下整理一份由用户自行掌控的文本记录。

Manbo 不替官方机构调查或认定，不提供法律意见、心理治疗或营救，不承诺举报结果，也不要求用户一定实名、举报或公开信息。

## 当前状态

| 项目 | 状态 |
|------|------|
| 研究报告与产品方案 | 已完成一次治理审阅（2026-08-31），不是法律意见 |
| 知识库 | 26 个 Markdown 文件；按来源和核实日期维护 |
| 应用代码 | 尚未开始 |
| 公开举报、公司页、地图、证据托管、B2B API | 未发布，必须通过发布门禁 |
| 真实用户数据 | 未收集 |

“已核实”只表示某条事实在指定日期有可追溯来源，不表示法律永不变化或产品已经具备相应能力。

## 仓库内容

| 路径 | 用途 |
|------|------|
| [`docs/research-and-plan.md`](docs/research-and-plan.md) | 咨询式研究报告：证据状态、法律基线、用户任务、产品边界、路线图与指标 |
| [`docs/analysis-framework.md`](docs/analysis-framework.md) | Phase 1 分析框架、数据需求、来源状态与后续研究任务 |
| [`docs/risk-register.md`](docs/risk-register.md) | 人身安全、隐私、诽谤、AI、供应商与运维风险登记册 |
| [`docs/release-gates.md`](docs/release-gates.md) | MVP、证据托管、公开聚合和 API 的发布门禁 |
| [`docs/superpowers/specs/2026-08-31-safe-documentation-governance-design.md`](docs/superpowers/specs/2026-08-31-safe-documentation-governance-design.md) | 本次文档与治理设计规格 |
| [`knowledge-base/`](knowledge-base/) | 供未来 agent 使用的定义、法律、执法、判断、渠道和沟通资料 |
| [`knowledge-base/AGENT-GUIDE.md`](knowledge-base/AGENT-GUIDE.md) | 检索、引用、危机处理、拒答和数据边界 |

## 知识库分层

| 目录 | 内容 |
|------|------|
| `01-definitions/` | ILO 定义、11 项指标、法域差异 |
| `02-laws/` | 欧盟、美国及其他法域的法律导航摘要 |
| `03-import-export/` | 美国 CBP、欧盟 FLR 和实体清单的官方入口 |
| `04-judgment/` | 指标匹配、证据等级、严重度、输出和转介规则 |
| `05-reporting-channels/` | 官方/NGO 渠道与举报后果 |
| `06-communication/` | 创伤知情沟通、危机协议、免责声明和 FAQ |

知识库文件使用 YAML frontmatter 记录 `id`、`jurisdiction`、`authority`、`last_verified` 和 `sources`。法律和渠道信息超过 90 天未复核时，agent 必须提示可能滞后并回到官方页面核验。

## 安全优先的路线

MVP 只规划法域确认、结构化自述、ILO 指标矩阵、证据安全提示、官方链接和短期文本导出。原始证据托管、跨用户查重、公开公司页、地图和 B2B API 都是后置能力，分别受 DPIA、威胁建模、内容审核、通知-行动、申诉和数据许可门禁约束。详见 [`docs/release-gates.md`](docs/release-gates.md)。

## 重要声明

本项目提供信息整理与渠道导航，不构成法律意见或官方认定。用户报告（如未来启用）均为未经独立核实的指控，不等于事实。任何在线行为仍可能留下设备、网络或证据反推痕迹；平台不作“绝对匿名”或“绝对安全”承诺。若存在即时暴力、拘禁、自伤、未成年人或人口贩运风险，应优先联系当地紧急服务或专业机构。

## 贡献与资料更新

提交法律、渠道或统计更新时，请同时提供：官方来源 URL、适用法域、原文日期、核实日期、变更摘要和是否需要法律审阅。不得提交未经核实的个案指控、个人隐私、企业“黑名单”结论或为取证而冒险的建议。变更知识库结构时同步更新 `knowledge-base/README.md` 与 `knowledge-base/AGENT-GUIDE.md`。

## Attribution and neutrality

本项目维护者保持中立立场。研究材料可能受到公开网络讨论的启发，但不代表任何平台用户、原作者、政府、企业或 NGO 的观点。使用任何 AI 工具产生的草稿都必须经过来源核验和人工治理审阅。

## License

[MIT](LICENSE) © 2026 ZxWang-AI

## 项目简介（中文摘要）

慢波 Manbo 目前是一个研究与知识库项目，目标是帮助劳动者和知情者安全地理解强迫劳动指标、整理自述、查找官方渠道，并保留自主决定权。应用尚未开发；公开举报、证据托管、地图与公司查询均未上线。平台未来也不会替代执法、律师、心理咨询或紧急救援。
