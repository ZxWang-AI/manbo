import type { CaseRecord } from "@/domain/case-record";
import {
  CONFIRMED_EXPORT_FIELDS,
  createPreview,
  type Connector,
  type ConnectorDescription,
  type ExportPreviewStore,
  validateConfirmation,
} from "../connector";

const description: ConnectorDescription = {
  connectorId: "markdown",
  targetName: "本地 Markdown 材料",
  jurisdiction: "用户自行选择",
  supportedFieldPaths: [...CONFIRMED_EXPORT_FIELDS],
  attachmentPolicy: "none",
  lastVerified: "2026-09-02",
};

function selected(record: CaseRecord, paths: readonly string[]) {
  const has = (path: string) => paths.includes(path) || paths.some((item) => item.startsWith(`${path}/`));
  return {
    jurisdiction: has("/jurisdiction") ? record.jurisdiction : undefined,
    facts: has("/facts") ? record.facts : undefined,
    timeline: has("/timeline") ? record.timeline : undefined,
    iloIndicators: has("/iloIndicators") ? record.iloIndicators : undefined,
    evidenceCoverage: has("/evidenceCoverage") ? record.evidenceCoverage : undefined,
    legalNavigation: has("/legalNavigation") ? record.legalNavigation : undefined,
    referrals: has("/referrals") ? record.referrals : undefined,
    safetyFlags: has("/safetyFlags") ? record.safetyFlags : undefined,
  };
}

function render(record: CaseRecord, paths: readonly string[]): string {
  const value = selected(record, paths);
  const lines = ["# 用户报告（未经独立核实）", "", "> 这是由用户选择字段生成的私密材料准备稿，不是法律意见或事实认定。", ""];
  if (value.jurisdiction) lines.push("## 法域上下文", "", `- 行为发生地：${value.jurisdiction.incidentCountry ?? "未确认"}`, `- 用户所在地：${value.jurisdiction.userCountry ?? "未确认"}`, `- 产品流向地：${value.jurisdiction.productDestination ?? "未确认"}`, "");
  if (value.facts) {
    lines.push("## 用户陈述的事实", "");
    for (const fact of value.facts) lines.push(`- **${fact.field}**：${fact.value}（${fact.certainty === "user_stated" ? "用户陈述" : "待确认"}）`);
    lines.push("");
  }
  if (value.timeline) {
    lines.push("## 时间线", "");
    for (const item of value.timeline) lines.push(`- ${item.occurredAt ?? "时间未确认"}：${item.description}`);
    lines.push("");
  }
  if (value.iloIndicators) lines.push("## ILO 指标定性核对", "", ...value.iloIndicators.map((item) => `- 指标 ${item.indicatorId}：${item.status}`), "");
  if (value.evidenceCoverage) lines.push("## 证据覆盖", "", ...value.evidenceCoverage.map((item) => `- ${item.topic}：${item.status}；${item.explanation}`), "");
  if (value.legalNavigation) lines.push("## 法律信息导航（需自行核对）", "", ...value.legalNavigation.map((item) => `- ${item.jurisdiction}：${item.premise}（来源 ${item.sourceId}，核实日期 ${item.lastVerified}）`), "");
  if (value.referrals) lines.push("## 可自行决定是否联系的渠道", "", ...value.referrals.map((item) => `- ${item.name}：${item.officialUrl}`), "");
  if (value.safetyFlags && value.safetyFlags.length > 0) lines.push("## 安全提醒", "", "- 档案包含需要优先关注的人身安全信号；请先考虑当地紧急服务或可信赖支持人员。", "");
  return lines.join("\n");
}

export function createMarkdownConnector(options: { store?: ExportPreviewStore; now?: () => Date; id?: () => string } = {}): Connector {
  return {
    describe: () => description,
    validate: (record, confirmation) => validateConfirmation(record, description, confirmation),
    preview: (record, confirmation) => createPreview(description, record, confirmation, render(record, confirmation.fieldPaths), "text/markdown", options),
  };
}
