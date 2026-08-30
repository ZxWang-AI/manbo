# 强迫劳动举报平台（is-your-labor-forced）研究报告与产品方案

> 版本：v0.1（2026-08-31）| 状态：前期研究与方案设计
> 用途：为"全球强迫劳动举报与查询平台"提供法律研究基础、竞品与渠道分析、产品功能方案及技术架构建议

## 摘要

强迫劳动是全球性问题：国际劳工组织（ILO）估计全球约 **2,760 万人** 处于强迫劳动之中，每年产生约 **2,360 亿美元** 非法利润 [$TRAE_REF](https://www.ilo.org/publications/joining-forces-end-forced-labour)。与此同时，欧盟《禁止强迫劳动产品条例》（EU 2024/3015）将于 **2027 年 12 月 14 日** 正式适用 [$TRAE_REF](https://trustrace.com/knowledge-hub/eu-ban-on-forced-labor-regulation-proposal)，美国《维吾尔强迫劳动预防法》（UFLPA）已执行四年并持续扩大实体清单（2026 年 7 月一次性新增 43 家企业）[$TRAE_REF](https://www.dhs.gov/news/2026/07/31/dhs-announces-addition-43-companies-uflpa-entity-list)。监管趋严与举报渠道分散之间形成明显缺口：现有官方渠道（CBP 举报门户、德国 BAFA、各国劳动监察）以"贸易执法"或"国内劳动监察"为目标，**没有一个以受害者/一线工人为中心、跨法域、支持证据辅助整理的全球举报平台**。

本报告在系统梳理 ILO、欧盟、美国、德国、英国、法国、澳大利亚、加拿大及中国法律定义与执法机制的基础上，提出平台产品方案：**(a) AI 辅助沟通入口**（多模态证据上传与初步法律评估）、**(b) 全球查询入口**（交互式地图 + 公司/行业搜索）、**(c) 用户账户与证据包管理**（隐私优先、防重复、防滥用），并给出分阶段路线图、法律风险控制措施（措辞中性化、免责声明、举报人匿名设计）与技术架构建议。

**核心结论**：平台价值不在于替代官方渠道，而在于做"举报前"的证据整理与法律教育层 + "举报后"的信息聚合查询层。法律风险的关键控制点是：所有公开信息以"用户报告（unverified allegations）"而非"事实认定"措辞呈现，证据材料端到端加密且默认私密，平台不主动作出法律结论。

## 1. 引言

### 1.1 项目背景

is-your-labor-forced 旨在建设一个面向全球的强迫劳动举报与检测网站，允许任何人举报其所在公司存在的强迫劳动行为，并通过地图与搜索功能向公众提供各地区/公司的强迫劳动报告信息。

### 1.2 研究目标与方法

本报告回答三个问题：(1) 各法域如何定义与规制强迫劳动；(2) 现有举报渠道及其后果如何；(3) 平台应如何设计才能既满足用户需求又控制法律风险。方法上采用 PESTEL（法律维度）框架梳理监管环境，Benchmarking 对比现有渠道，SWOT/JTBD 分析产品机会；数据来源以官方一手资料（ILO、EUR-Lex、CBP/DHS、BAFA）与权威行业分析为主，检索时间为 2026 年 8 月。

### 1.3 范围说明

本报告聚焦"强迫劳动"（forced labour）而非更广义的"现代奴役"（modern slavery，含人口贩运、债役等）；产品方案聚焦 MVP 与后续版本的功能定义，不构成法律意见——正式上线前应由执业律师就目标法域出具合规审查。

## 2. 强迫劳动的法律定义体系

### 2.1 国际基准：ILO 公约

ILO《强迫劳动公约》（第 29 号公约，1930）第 2 条给出国际法基准定义：强迫劳动是"以任何惩罚相威胁，强迫任何人从事的非自愿的一切工作或服务"，包含三个构成要件：**工作或服务**（work or service）、**非自愿性**（involuntary）、**以惩罚相威胁**（menace of any penalty）[$TRAE_REF](https://www.ilo.int/topics/forced-labour-modern-slavery-and-trafficking-persons/what-forced-labour)。第 105 号公约（1957）进一步要求废除特定目的（政治强制、经济惩戒等）的强迫劳动；2014 年第 29 号公约议定书强化了预防、保护与救济义务。

ILO 归纳的 **11 项强迫劳动指标**（indicators）是实务判定的通行工具：滥用脆弱性、欺骗、行动自由限制、隔离、身体与性暴力、恐吓与威胁、扣留身份文件、扣发工资、债役、恶劣的工作与生活环境、过度加班 [$TRAE_REF](https://www.ilo.org/sites/default/files/wcmsp5/groups/public/%40ed_norm/%40declaration/documents/publication/wcms_203832.pdf)。这一指标体系直接可转化为平台的 AI 判定框架（见 6.3 节）。

### 2.2 欧盟

欧盟基本权利宪章第 5 条与欧洲人权公约第 4 条第 2 款禁止强迫劳动。欧盟法律体系对"强迫劳动"的定义援引 ILO 第 29 号公约，并在《禁止强迫劳动产品条例》中将其扩展适用于产品层面（见 3.1 节）。

### 2.3 美国

美国没有单一成文定义，而是由判例与成文法共同构成：关税法第 307 条（19 U.S.C. § 1307，1930）禁止进口"全部或部分由 convict labor、forced labor、indentured labor under penal sanctions 生产"的产品；刑法层面 18 U.S.C. § 1589（强迫劳动罪）将"以武力、威胁、胁迫、滥用法律程序或讹诈手段获取劳动或服务"入罪；UFLPA 则针对新疆建立了可反驳推定（rebuttable presumption）机制 [$TRAE_REF](https://www.cbp.gov/trade/forced-labor/UFLPA)。

### 2.4 其他主要法域

| 法域 | 法律 | 定义要点 |
|------|------|---------|
| 德国 | 《供应链尽职调查法》LkSG（2023 生效） | 援引 ILO 定义，要求企业建立投诉机制，BAFA 可受理外部投诉 [$TRAE_REF](https://www.bafa.de/EN/Supply_Chain_Act/Submit_Complaint/submit_complaint_node.html) |
| 法国 | 《警惕法》Loi de Vigilance（2017） | 大企业须识别人权风险并制定警惕计划，受影响方可诉诸法院 |
| 英国 | 《现代奴隶法案》（2015） | s.1 罪名最高可判处终身监禁；s.54 要求大企业发布供应链声明 |
| 澳大利亚 | 《现代奴隶法案》（2018） | 强制供应链报告义务（无罚款，依赖声誉机制） |
| 加拿大 | S-211 法案（2024 生效） | 强制供应链报告义务，虚报可处罚款 |
| 中国 | 《劳动法》第 96 条、《刑法》第 244 条 | 强迫劳动罪：以暴力、威胁或限制人身自由方法强迫劳动，处三年以下有期徒刑或拘役；情节严重的处三年以上十年以下 |
| 日本 | 无专门法 | 2022 年《企业与人权尽职调查指引》（软法）+ 入国管理法打击技能实习制度下的强迫劳动 |

**启示**：ILO 三要件 + 11 项指标是全球最大公约数，应作为平台 AI 判定的基准框架，再叠加各国具体法条引用。

## 3. 主要法域法律法规全景

### 3.1 欧盟：FLR + CSDDD 双轨

**欧盟《禁止强迫劳动产品条例》（Regulation (EU) 2024/3015）**：2024 年 12 月 12 日刊宪，12 月 13 日生效，**2027 年 12 月 14 日起适用** [$TRAE_REF](https://trustrace.com/knowledge-hub/eu-ban-on-forced-labor-regulation-proposal)。核心机制：

- 第 3 条禁令：禁止在欧盟市场投放、提供或出口"全部或部分以强迫劳动生产"的产品，覆盖供应链任何阶段（原材料开采、收获、生产、制造、加工），即使强迫劳动发生在遥远的二、三级供应商也可能导致整机被禁 [$TRAE_REF](https://www.eccpit.com/news/Y21zcG86MjQ5MDA)。
- 覆盖所有产品类型（含农产品、矿产品），含线上远程销售。
- 执法由成员国主管机构负责，设单一门户；2026 年 6 月 26 日委员会已发布实施指南、上线强迫劳动单一门户与风险数据库 [$TRAE_REF](https://trustrace.com/knowledge-hub/eu-ban-on-forced-labor-regulation-proposal)。
- 违规产品须撤出市场，可捐赠、改造或销毁；经营者承担处置费用。

**欧盟《企业可持续发展尽职调查指令》（CSDDD, Directive (EU) 2024/1760）**：经历 Omnibus 简化改革后，适用范围大幅缩减——新门槛为 **5,000 名员工 + 15 亿欧元营业额**（覆盖企业数削减约 70%），第一阶段尽职调查义务推迟至 **2029 年 7 月 26 日**，欧盟将于 2027 年 7 月前发布指引 [$TRAE_REF](https://www.sedex.com/blog/eu-omnibus-simplification-package-what-you-need-to-know/)；相关修正由 Directive (EU) 2025/794（推迟）与 Directive (EU) 2026/470（实质修订，2026 年 2 月 26 日刊宪、3 月 18 日生效）完成 [$TRAE_REF](https://commission.europa.eu/topics/business-and-industry/doing-business-eu/sustainability-due-diligence-responsible-business/corporate-sustainability-due-diligence_en)。

**对平台的意义**：2027 年 12 月起，欧盟市场将形成"产品禁入"硬约束，企业合规需求激增，供应链强迫劳动证据的商业与公共价值同步上升。

### 3.2 美国：Tariff Act 307 + UFLPA + 刑法

- **Tariff Act § 307（1930）**：一切由强迫劳动生产的产品禁止入境，是一切进口管制的母法。
- **UFLPA（2021 年 12 月 23 日签署，Public Law 117-78）**：建立"可反驳推定"——凡新疆（XUAR）生产或 UFLPA 实体清单实体生产的货物推定为强迫劳动产品，禁止入境，除非进口商以"清晰且有说服力的证据"（clear and convincing evidence）证明否则 [$TRAE_REF](https://www.cbp.gov/trade/forced-labor/UFLPA)。CBP 执行扣留、排除、没收；UFLPA 实体清单持续扩充，**2026 年 7 月 31 日 DHS 一次性新增 43 家企业**，清单覆盖纺织、多晶硅、铝业、食品、矿业等 [$TRAE_REF](https://www.dhs.gov/uflpa-entity-list)。
- **UFLPA 统计仪表板**（2026 年改版）公开扣查数据：公开报道显示截至 2024 财年末累计扣查货物超 1 万批、货值超 30 亿美元，最新累计数据以官方仪表板为准 [$TRAE_REF](https://www.cbp.gov/newsroom/stats/trade/uyghur-forced-labor-prevention-act-statistics)。
- **WRO 机制**：CBP 可对特定企业/产品发布暂扣令（Withhold Release Order），2025 年共发布 4 个 WRO，2026 财年第一个针对 Firemount Group [$TRAE_REF](https://www.cbp.gov/newsroom/national-media-release/cbp-issues-withhold-release-order-firemount-group-ltd)。
- **刑法**：18 U.S.C. § 1589 强迫劳动罪最高 20 年监禁；TVPA 体系对人口贩运科以重刑。

### 3.3 刑罚对比

| 法域 | 刑事责任上限 | 主要执法主体 |
|------|-------------|-------------|
| 美国 | 20 年监禁（18 U.S.C. § 1589） | DOJ、CBP（行政） |
| 英国 | 终身监禁（MSA 2015 s.1） | 警察、Gangmasters and Labour Abuse Authority |
| 中国 | 3–10 年有期徒刑（刑法 244 条） | 公安、劳动监察 |
| 德国 | 依罪名（人口贩运罪最高 10 年） | 检察机关、BAFA（行政） |
| 欧盟 | FLR 无刑事罚（行政罚+市场禁入） | 成员国主管机构 |

## 4. 进出口管制机制

### 4.1 美国：进口侧执法

执法链条：**情报/举报 -> CBP 自动化系统筛查 -> 货物扣留（stopped）-> 审查（文件/实物）-> 放行或排除/没收**。进口商救济路径为提交"适用性审查"（applicability review）证明货物不在推定范围，或申请"例外"（exception）证明非强迫劳动生产，标准均为 clear and convincing evidence [$TRAE_REF](https://www.cbp.gov/trade/forced-labor/UFLPA)。2026 年仪表板改版后以"stopped shipments"为统一口径（含电子数据审查，不一定物理扣货）[$TRAE_REF](https://www.cbp.gov/newsroom/stats/trade/uyghur-forced-labor-prevention-act-statistics)。

### 4.2 欧盟：FLR 调查与产品处置

成员国主管机构负责调查（依据委员会风险数据库与其他主管机构的信息），初步认定后发布初步决定，经营者可申辩；最终决定可命令：禁止投放市场、撤回已上市产品、要求处置（捐赠/改造/销毁，费用由经营者承担）、必要时向公众披露。货物在成员国间自由流通，决定具有域内普遍效力 [$TRAE_REF](https://eur-lex.europa.eu/EN/legal-content/summary/ban-on-forced-labour-products-on-the-eu-market.html)。

### 4.3 合规生态

供应链审计/尽调工具已形成产业：SAP Ariba、Sedex/SMETA、EcoVadis（2025 年 11 月推出 Worker Voice Connect 工人申诉数字机制）[$TRAE_REF](https://ethicalmarketingnews.com/ecovadis-launches-worker-voice-connect-to-strengthen-human-rights-accountability-in-global-supply-chains)、Labor Solutions、Issara Institute（多语种热线 + 智能手机工人声纹验证 + 实地核查团队）[$TRAE_REF](https://media.wix.com/ugd/5bf36e_df5b1c84cb0641759d3275ed034439aa.pdf)、KnowTheChain 行业基准评分。这些工具面向**企业买方**（B2B 供应链尽调），而非面向**公众举报人**——这正是本平台的市场空白。

## 5. 现有举报渠道与举报后果

### 5.1 官方渠道全景

| 渠道 | 接受内容 | 匿名 | 后续 |
|------|---------|------|------|
| 美国 CBP Forced Labor Allegation Portal / e-Allegations | 进口强迫劳动产品指控（附供应链地图、照片、厂商名址更佳） | 可匿名（鼓励留联系方式） | CBP 调查 -> WRO/扣留/实体清单；1-800-BE-ALERT 电话渠道 [$TRAE_REF](https://www.cbp.gov/trade/forced-labor/leveling-playing-field) |
| 德国 BAFA（LkSG § 14） | 针对受 LkSG 约束企业的供应链人权投诉 | 可匿名，保密处理 | BAFA 可依职权调查，企业须整改 |
| 德国联邦司法局外部举报处（HinSchG） | 供应链违法举报 | 可匿名 | 转主管机关 [$TRAE_REF](https://www.mann-hummel.com/content/dam/website/mann-hummel/company/downloads/publications/code-of-procedure-2025-en.pdf) |
| ILO 宪章第 24 条代表程序 | 违反已批准公约的指控 | 需雇主/工人组织提交 | 国际调查、公开报告 |
| 中国 12333 / 劳动监察 / 劳动仲裁 | 国内强迫劳动（限制人身自由、扣押证件等） | 需实名（劳动仲裁） | 责令改正、行政处罚、刑事移送 |
| 企业内部热线 / 第三方举报系统（Navex、EQS） | 企业自身供应链 | 多数支持匿名 | 内部调查、整改、上报 |

### 5.2 NGO 渠道

Anti-Slavery International、Business & Human Rights Resource Centre（发布企业回应与指控，形成公共数据库）、Clean Clothes Campaign（服装业）、KnowTheChain（评分）等接受线索并公开发布，但不提供"证据整理 + 法律评估 + 提交追踪"的一体化服务。

### 5.3 举报后果

**举报人侧**：美国对贸易违法举报人缺乏统一保护（False Claims Act 式的金钱奖励不适用于海关强迫劳动举报）；欧盟《举报人保护指令》(EU) 2019/1937 保护善意举报人免受报复，但要求内部渠道优先；德国 HinSchG 对举报人身份保密有刑事保护。跨境工人（尤其签证与雇佣绑定时）实际面临报复风险，匿名性是刚需。

**企业侧**：查实后果包括货物扣留/没收（美国）、产品撤出市场与销毁（欧盟 2027 起）、高额行政罚款（德国 LkSG 最高全球营业额 2%）、CTPAT 资格取消、实体清单列入（供应链断链）、声誉损失与投资者撤资。

### 5.4 渠道缺口分析（SWOT 视角）

现有渠道的系统性缺口：**碎片化**（不同国家不同入口，工人不知道去哪报）、**语言门槛**（官方表格多为英文/当地语）、**证据要求不透明**（CBP 明确希望"供应链地图+厂商名址+照片"，但工人不具备整理能力）、**无反馈闭环**（举报后石沉大海）、**无跨渠道查重**（同一企业被多渠道重复举报，互不联通）。平台的机会在于补齐"举报前"环节：**帮助工人理解自己经历的法律性质、整理成可提交的证据包、指引到正确渠道**。

## 6. 产品方案

### 6.1 定位与价值主张

**定位**：全球强迫劳动举报辅助与信息聚合平台——不替代官方执法，做"举报前置层"（AI 评估 + 证据整理 + 渠道指引）与"信息聚合层"（地图 + 公司报告查询）。

**价值主张**：
- 对举报人：免费、匿名、多语言、AI 辅助判断"我的经历是否构成强迫劳动、可能违反哪些法律、可以到哪里举报"，并生成结构化证据包。
- 对查询者：一站式查看某公司/地区/行业的公开强迫劳动报告（标注"未经证实的用户报告"）。
- 对监管与企业合规方：聚合的匿名化趋势数据可作为风险信号（未来商业化方向）。

### 6.2 核心用户旅程

```
工人/知情者 --(1) 匿名咨询 AI--> 了解自己的处境与法律定性
              --(2) 决定提交--> 上传证据（图片/文件）形成"证据包"
              --(3) 平台查重--> 通过查重后登记为该公司的报告
              --(4) 自主选择--> a) 仅平台存档  b) 导出官方渠道格式（CBP/BAFA/12333 等）
公众用户  --(5) 地图/搜索--> 查看地区、公司、行业的报告聚合数据
```

### 6.3 AI 证据评估模块设计

**输入**：多轮对话（多语言）+ 图片（工牌、排班表、工资条、宿舍照片）+ 文件（合同、聊天记录）。

**评估框架**（三层）：
1. **ILO 11 项指标匹配**：对用户叙述逐项比对指标（如"扣押护照" -> 行动自由限制/扣留身份文件），输出指标命中矩阵。
2. **法域法条映射**：结合用户所在国（对话中询问），映射可能违反的法律（如中国刑法 244 条、美国 18 U.S.C. § 1589、可能触发美国进口禁令的供应链环节）。
3. **证据完整性评估**：指出当前证据的强弱项（如"缺少排班记录佐证加班时长"），提示可补充的证据类型。

**输出规范（法律风控关键）**：
- AI 输出必须始终声明"仅供参考，不构成法律意见，不能替代律师或官方认定"。
- 使用概率化语言："您的经历与 ILO 强迫劳动指标中的 N 项相符"，而非"该公司存在强迫劳动"。
- 对公司名称的任何输出（如查询页展示）一律标注为"用户报告，未经证实"（unverified allegation）。

**技术选型**：多模态 LLM（Claude/GPT-4o 级别 API）做文档理解与结构化抽取；评估框架以 ILO 指标为固定 rubric，用提示词 + JSON schema 约束输出，降低幻觉风险；敏感场景（用户讲述创伤经历）需内容安全过滤与危机转介话术（如涉及人口贩运立即提供热线）。

### 6.4 防重复举报与滥用防护

**目标**：防止同一人用多个账号重复提交同一证据刷高某公司报告数，同时不损害匿名性。

**方案（分层去重，不依赖身份）**：
1. **内容指纹**：对上传文件计算 perceptual hash（图片）+ 文本 SimHash/MinHash（叙述文本），入库比对。相同指纹的报告自动合并为"同一事件的多次佐证"而非独立报告。
2. **事件聚类**：公司 + 时间 + 指标组合形成事件签名（如"公司 A + 2026 上半年 + 扣押证件"），同签名报告聚合，计数逻辑为"事件数"而非"报告数"。
3. **注册成本分级**：浏览与 AI 咨询无需注册；提交报告需邮箱验证；证据包托管需账号。账号创建可用匿名邮箱，但同一证据指纹自动合并使多账号刷量无效。
4. **滥用防护**：Rate limit（IP/账号维度）、反机器人、举报热度异常检测（短时间同公司报告激增触发人工审核队列）、恶意举报标记（公司可提交"回应"声明，形成类似 BHRRC 的双向机制）。

**隐私平衡**：明确不做设备指纹追踪（GDPR 与信任双重风险），以内容指纹为准。

### 6.5 数据模型与展示层

**核心实体**：
- `Company`（名称、别名、国家、行业、LEI/工商注册号等标识符、地理坐标）
- `Report`（匿名化叙述、指标命中、时间、事件签名、状态：草稿/已提交/已合并）
- `EvidenceItem`（加密存储的文件、哈希、类型）
- `EventCluster`（公司 + 指标组合的聚合，对外计数单位）

**展示层**：
- **交互式地图**：按国家/地区聚合事件数热力图（开源方案 Leaflet/MapLibre + OpenStreetMap 瓦片，无商业地图 API 依赖）。
- **搜索**：公司名/别名模糊搜索 + 行业筛选 + 国家筛选；结果页显示"事件数、首次/最近报告时间、涉及指标、公司回应（如有）"。
- **数据政策**：只展示聚合统计与匿名化描述，**永不公开证据文件本身**；用户可自主选择叙述部分的公开程度。

### 6.6 账户体系与匿名设计

- 注册仅需邮箱 + 密码（支持匿名邮箱），无强制实名；不收集电话/证件。
- 证据包默认端到端加密：用户密码派生密钥，平台服务器只存密文（平台自身无法解密用户证据）。
- 无日志或最小日志策略：不记录 IP 与设备信息（或 24 小时内删除）；提供 Tor 隐藏服务/无 JS 降级入口（参考 SecureDrop 模式）作为高危用户选项。
- 账户删除即数据删除（含备份超期清理），满足 GDPR 被遗忘权。

### 6.7 免责声明与法律风险控制

**措辞规范**（贯穿全站）：
- 全站使用"报告/allegation/用户提交"词汇，绝不使用"黑名单/违法企业/事实认定"。
- 公司页固定展示："本页内容由用户匿名提交，未经独立核实，不构成对任何事实的认定或法律结论。"
- 平台不左右用户消费/就业决策的声明："本平台信息仅供参考，用户应自行判断并咨询专业人士。"
- 公司回应权：提供官方回应通道，未回应不代表默认（注明"该公司暂未回应"）。

**平台责任控制**：
- **美国**：UGC 平台目前可援引《通信规范法》第 230 条抗辩，但该条款正被削弱——2025 年 12 月已有两党参议员提案要求 2027 年 1 月 1 日前废止，马萨诸塞州最高法院 2026 年在 Commonwealth v. Meta 中已限制其对产品设计的豁免适用 [$TRAE_REF](https://susanpollock.com/blog/section-230-virtual-number-platforms)。**因此不应将 230 条作为长期风控基石，内容措辞纪律才是根本**。
- **欧盟**：《数字服务法》（DSA）对托管平台有通知-行动机制与透明度要求，中介平台需设举报通道与申诉机制；GDPR 对处理特殊类别数据（如涉及健康、宗教的强迫劳动叙述）要求合法性基础与 DPIA。建议：欧盟用户数据存储于欧盟区（数据驻留），任命数据保护官，发布透明度报告。
- **举报人安全**：平台收到执法机构传票时的策略需预先设计——若端到端加密且无日志，可披露的只有注册邮箱与公开报告，证据内容平台自身无法解密。隐私政策必须如实披露传票配合义务。
- **SLAPP 风险**：公司可能以诽谤起诉。防御：措辞纪律（指控而非认定）、匿名提交（无法指认用户）、优先选择有反 SLAPP 法的司法辖区注册运营主体（如美国加州、欧盟多国）。

### 6.8 技术架构建议（MVP）

```
前端：Next.js（SSR/SEO 友好）+ Leaflet/MapLibre 地图
后端：Node.js/Python API + PostgreSQL（结构化数据）+ 对象存储（加密证据桶）
AI 层：多模态 LLM API（证据评估）+ 本地 embedding（查重指纹）
安全：端到端加密（libsignal 或 WebCrypto 方案）、KMS 密钥管理、无日志中间件
部署：多云可用区 + CDN；高危入口 Tor 隐藏服务
合规：DPIA 流程、透明度报告页、数据驻留分区（EU/非 EU）
```

### 6.9 分阶段路线图

| 阶段 | 周期 | 交付 |
|------|------|------|
| MVP | 1–3 月 | AI 咨询入口（文本对话 + 11 指标评估）、匿名报告登记、基础公司搜索 |
| V1 | 4–6 月 | 多模态证据上传、证据包导出（CBP/BAFA 格式）、查重引擎、地图热力图 |
| V2 | 7–12 月 | 账号体系 + E2E 加密、公司回应通道、多语言扩展（中/英/西/阿等）、公开 API |
| V3 | 12 月+ | 与 NGO/监管数据互通、趋势分析产品（B2B 合规情报） |

**MVP 优先级理由**：先以纯文本 AI 咨询验证需求（低风险、低成本），再引入证据存储（高合规成本）与公开展示（高法律风险）功能，每一步扩张前完成对应法务审查。

## 7. 风险与合规清单

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 诽谤/商誉侵权诉讼 | 高 | "用户报告未经证实"措辞纪律、公司回应权、反 SLAPP 辖区注册 |
| 举报人身份泄露招致报复 | 高 | E2E 加密、无日志、匿名提交、Tor 入口 |
| 证据含违法内容（如偷拍文件） | 中 | 用户协议免责 + 平台不公开原始证据 |
| 恶意刷量/竞对抹黑 | 中 | 内容指纹查重、事件聚类、异常检测、人工审核 |
| GDPR/DSA 合规 | 高 | DPIA、数据驻留、DPO、透明度报告、被遗忘权 |
| 章节 230 废除后的美国责任 | 中 | 不依赖 230，措辞纪律 + 平台中立性设计 |
| AI 幻觉导致错误法律指引 | 中 | 固定 rubric 输出、免责声明、危机转介、定期法学专家校准 |

## 8. 结论

强迫劳动的定义在全球主要法域高度收敛于 ILO 的三要件与 11 项指标，这为平台建立统一的 AI 判定基准提供了法律基础；而欧盟 FLR 2027 年适用与美国 UFLPA 持续加码的执法，使强迫劳动证据的现实价值在 2026–2029 年间快速上升。现有举报渠道的碎片化、语言门槛与无反馈闭环，为"举报前置辅助层 + 信息聚合层"的平台定位留出了明确空白。产品的成功关键不在技术复杂度，而在**信任**（匿名与加密）与**法律纪律**（指控性措辞、免责体系、举报人保护设计）——两者共同构成平台在多法域环境下的生存基础。建议以 3 个月 MVP 验证 AI 咨询核心假设，在引入证据存储与公开展示功能前完成目标法域的正式法律审查。

## 参考文献

[1] ILO. What is forced labour?[EB/OL]. https://www.ilo.int/topics/forced-labour-modern-slavery-and-trafficking-persons/what-forced-labour, 2026.

[2] ILO. ILO Indicators of Forced Labour[EB/OL]. https://www.ilo.org/sites/default/files/wcmsp5/groups/public/%40ed_norm/%40declaration/documents/publication/wcms_203832.pdf, 2012.

[3] ILO. Joining forces to end forced labour[EB/OL]. https://www.ilo.org/publications/joining-forces-end-forced-labour, 2024.

[4] ILO. Profits and poverty: The economics of forced labour[EB/OL]. https://brasil.un.org/sites/default/files/2024-03/OIT_TrabalhoForcado_2024.pdf, 2024.

[5] European Union. Regulation (EU) 2024/3015 – Ban on forced labour products on the EU market[EB/OL]. https://eur-lex.europa.eu/EN/legal-content/summary/ban-on-forced-labour-products-on-the-eu-market.html, 2024.

[6] European Commission. Corporate sustainability due diligence[EB/OL]. https://commission.europa.eu/topics/business-and-industry/doing-business-eu/sustainability-due-diligence-responsible-business/corporate-sustainability-due-diligence_en, 2026.

[7] Sedex. The EU has reached an agreement on Omnibus 1[EB/OL]. https://www.sedex.com/blog/eu-omnibus-simplification-package-what-you-need-to-know/, 2026.

[8] CBP. Uyghur Forced Labor Prevention Act (UFLPA)[EB/OL]. https://www.cbp.gov/trade/forced-labor/UFLPA, 2026.

[9] CBP. UFLPA Enforcement Statistics[EB/OL]. https://www.cbp.gov/newsroom/stats/trade/uyghur-forced-labor-prevention-act-statistics, 2026.

[10] DHS. UFLPA Entity List[EB/OL]. https://www.dhs.gov/uflpa-entity-list, 2026.

[11] DHS. DHS Announces Addition of 43 Companies to UFLPA Entity List[EB/OL]. https://www.dhs.gov/news/2026/07/31/dhs-announces-addition-43-companies-uflpa-entity-list, 2026.

[12] CBP. Forced Labor Leveling the Playing Field – Allegation Portal[EB/OL]. https://www.cbp.gov/trade/forced-labor/leveling-playing-field, 2026.

[13] CBP. CBP issues Withhold Release Order on Firemount Group Ltd.[EB/OL]. https://www.cbp.gov/newsroom/national-media-release/cbp-issues-withhold-release-order-firemount-group-ltd, 2026.

[14] BAFA. Submit a Complaint under the Supply Chain Act[EB/OL]. https://www.bafa.de/EN/Supply_Chain_Act/Submit_Complaint/submit_complaint_node.html, 2026.

[15] CBP. Office of Trade Forced Labor Allegation Submission Checklist[EB/OL]. https://www.cbp.gov/sites/default/files/2025-07/FLD_Forced_Labor_Allegation_Submission_Checklist.pdf, 2025.

[16] EcoVadis. EcoVadis Launches Worker Voice Connect[EB/OL]. https://ethicalmarketingnews.com/ecovadis-launches-worker-voice-connect-to-strengthen-human-rights-accountability-in-global-supply-chains, 2025.

[17] Susan Pollock. Section 230 and Virtual Number Platforms[EB/OL]. https://susanpollock.com/blog/section-230-virtual-number-platforms, 2026.

[18] trustrace. The EU Forced Labour Regulation: What It Requires and How to Prepare[EB/OL]. https://trustrace.com/knowledge-hub/eu-ban-on-forced-labor-regulation-proposal, 2026.
