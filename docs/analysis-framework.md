# 慢波 Manbo 项目治理与产品分析框架

## Research Overview

- **Research Subject**：慢波 Manbo 强迫劳动举报辅助与信息导航工具
- **Scope**：当前仓库的研究报告、26 个知识库文件、产品方案与风险治理；时间基准 2026-08-31
- **Analysis Domain**：产品战略、法律/政策环境、信任与安全、知识治理
- **Core Research Questions**：
  1. 现有资料哪些可以作为可追溯事实，哪些必须降级为待核实？
  2. 产品应优先解决举报准备中的哪一个用户任务？
  3. 哪些功能风险足以阻断 MVP、证据托管、公开聚合和 API？

## Framework Selection

| 分析章节 | 框架 | 应用 |
|---------|------|------|
| 事实与政策基线 | PESTEL（重点 Legal/Political/Technology） | 分离 ILO、欧盟、美国及其他法域的可核实事实、动态规则和技术假设 |
| 用户任务与渠道缺口 | JTBD + Benchmarking | 比较用户在理解、记录、转介、反馈四项任务上的痛点与官方渠道边界 |
| 产品取舍 | SWOT + Ansoff（保守采用） | 识别可信度优势、数据与治理短板，并按“举报准备 → 受控托管 → 受控公开 → 数据合作”排序增长路径 |
| 风险与发布 | Risk-based release gates | 以人身安全、隐私、诽谤、AI 误导和数据许可作为功能准入条件，而不是以开发完成度作为上线条件 |

## Chapter Skeleton

### 1. 事实、来源与时效性

- **Analysis Objective**：确认知识库中可支撑产品输出的事实边界。
- **Analysis Logic**：官方一手来源 → 法域/日期 → `evidence_status` → 是否允许硬编码。
- **Core Hypothesis**：法律和动态清单信息的时效性风险高于资料数量不足风险。
- **Data Requirements**：每个主题文件的 frontmatter、官方 URL、核实日期、冲突记录；无可核实数据的市场规模不估算。
- **Visualization Plan**：来源状态矩阵；横轴为来源状态，纵轴为知识库层，展示 verified/design/needs-review 的分布。

### 2. 用户任务与渠道缺口

- **Analysis Objective**：确定 MVP 是否应聚焦举报准备而不是公开数据库。
- **Analysis Logic**：JTBD（安全表达、理解证据、匹配渠道、保留记录）→ Benchmarking（CBP、BAFA、劳动监察、NGO）→ 最小可行服务。
- **Core Hypothesis**：用户最需要的是安全和清晰，而不是公开曝光或报告数量。
- **Data Requirements**：渠道是否匿名、是否回执、是否反馈、是否实名、行为地/产品流向；当前仅有定性资料，缺少用户研究数据。
- **Visualization Plan**：渠道比较表和用户旅程图；不制作无真实样本支撑的转化率图表。

### 3. 产品边界与技术方案

- **Analysis Objective**：定义当前可做、需门禁和不应承诺的能力。
- **Analysis Logic**：SWOT（信任与知识库优势 / 数据、法律、运维短板）→ Ansoff（分阶段扩展）→ 数据最小化。
- **Core Hypothesis**：无状态或短期会话的举报准备工具能在低数据风险下验证核心价值。
- **Data Requirements**：黄金案例集、模型越界率、危机召回率、来源引用正确率、可用性测试；当前均无生产基线。
- **Visualization Plan**：功能风险—门槛二维表；使用门槛矩阵而非虚构的产品采用曲线。

### 4. 风险、治理与发布

- **Analysis Objective**：将风险控制转为可审计的发布阻断条件。
- **Analysis Logic**：影响 × 可能性 → 控制证据 → 责任角色 → 回滚路径。
- **Core Hypothesis**：公开指控和证据托管的不可逆伤害要求更高门槛，即使潜在增长价值很高。
- **Data Requirements**：DPIA、威胁模型、供应商合同、删除/备份测试、通知-行动与申诉记录、透明度报告。
- **Visualization Plan**：风险热力表和 Gate 0–4 时间线；只有完成真实测试后才填入指标数值。

## Data Collection Task List

| 优先级 | 任务 | 来源/方法 | 当前状态 |
|--------|------|----------|----------|
| P0 | 核验 Regulation (EU) 2024/3015 的日期和当前文本 | EUR-Lex | 已核验日期；实施细节需持续复核 |
| P0 | 核验 ILO C29/C105 定义与中国批准状态 | ILO 官方页面/新闻稿 | 已核验 |
| P0 | 核验 CBP/UFLPA 官方举报入口和实体清单链接 | CBP、DHS | 已核验入口；动态数量不复制 |
| P0 | 为 26 个知识库文件维护 evidence_status、来源和日期 | 仓库审计 | 已完成元数据补齐 |
| P0 | 建立危机、法律越界、多语言和恶意请求黄金案例集 | 人工编写 + 法律/安全审阅 | 尚无生产基线 |
| P1 | 对目标用户做可用性和安全理解度测试 | 伦理审查后的定性访谈 | 未开始 |
| P1 | 对 LLM 供应商的留存、训练、分包和跨境条款做审计 | 合同与 DPIA | 未开始 |
| P1 | 评估公开聚合的小样本反向识别风险 | 隐私威胁建模 | 未开始 |
| P2 | 评估 NGO/监管数据合作与 API 许可 | 逐源许可审查 | 未开始 |

## Interpretation Rules

1. 没有数据时写“Data not available”，不以行业常识补齐数字。
2. “用户报告”与“官方记录”是不同数据层，不能在聚合计数中混合。
3. `needs-review` 内容只能产生核验任务，不得触发自动法律路由或公开展示。
4. 指标、图表和战略建议必须能追溯到本框架、研究报告、风险登记册或官方来源。
