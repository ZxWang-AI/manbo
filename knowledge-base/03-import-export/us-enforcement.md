---
id: kb-us-import-enforcement
title: 美国进口侧执法流程（CBP）与举报衔接
category: import-export
jurisdiction: 美国
authority: CBP / DHS
evidence_status: needs-review
last_verified: 2026-08-31
sources:
  - CBP, UFLPA, https://www.cbp.gov/trade/forced-labor/UFLPA
  - CBP, Forced Labor Leveling the Playing Field, https://www.cbp.gov/trade/forced-labor/leveling-playing-field
  - CBP, Office of Trade Forced Labor Allegation Submission Checklist (2025), https://www.cbp.gov/sites/default/files/2025-07/FLD_Forced_Labor_Allegation_Submission_Checklist.pdf
---

# 美国进口侧执法流程与举报衔接

## 执法链条

```
情报/举报（任何人可提交，可匿名）
    -> CBP Forced Labor Division 评估
    -> 货物筛查（ACE 自动化系统 + 人工审查）
    -> 扣留（detention / stopped shipment）
    -> 进口商提交抗辩（applicability review 或 exception request）
    -> 放行 / 排除（exclusion）/ 没收（seizure）
    -> 对特定企业发布 WRO（持续适用，直至撤销）
    -> FLETF 评估将实体加入 UFLPA Entity List
```

## WRO（暂扣令）机制

- CBP 有"合理理由相信"（reasonable cause）某企业产品涉强迫劳动即可发布 WRO，该企业后续所有货物在口岸被自动扣留。
- 发布依据常来自举报、NGO/媒体调查、自我披露。
- 进口商可申请解除：提交完整供应链证明（clear and convincing 级别）。
- 2025 年共发布 4 个 WRO；2026 财年首个针对 Firemount Group Ltd.。

## 指控（Allegation）的有效要素

CBP 官方发布的指控提交清单（Office of Trade Forced Labor Allegation Submission Checklist）表明高质量指控的构成：

| 要素 | 说明 |
|------|------|
| 涉事实体信息 | 生产商/出口商名称、地址（越具体越好） |
| 产品描述 | 产品类型、HS 编码（如有）、品牌、出口记录 |
| 供应链位置图 | 从原料到成品的环节描述 |
| 强迫劳动证据 | 工人证言、照片、文件、媒体报道 |
| 运输路径 | 第三国转运（规避高风险直运）的线索 |
| 联系方式 | 匿名可选，但留联系方式便于 CBP 补充取证 |

- 提交渠道：CBP 强迫劳动指控门户（e-Allegations）、电话 1-800-BE-ALERT、贸易违规举报表格。
- 处理不承诺时限、不向举报人反馈个案进展（涉执法保密）。

## 平台证据包与 CBP 格式对接

平台生成的证据包（evidence package）应支持映射到上表要素，特别是：

- 公司/厂区标识信息（工商注册、地址、坐标）；
- 工人叙述结构化（时间线、岗位、强迫手段描述）；
- 文件证据（合同、工资条、排班表）的元数据（出处、时间、获取方式）；
- 供应链线索（原材料来源、下游品牌商，如用户知道）。

## 引用规则

- 明确告知用户：提交指控不等于举报人会获得案件进展反馈，CBP 不会向举报人确认执法行动。
- 提醒匿名提交的取舍：留联系方式有助于 CBP 补充取证，但暴露身份有报复风险，由用户自主决定。
- 不得暗示平台提交会"必然导致"扣货或列入清单；执法决定权完全在 CBP/DHS。
