import type { CasePatch } from "@/domain/case-record";
import type { SourceTrace } from "@/domain/assessment";

export interface MaterialSourceLabel {
  contentRef: string;
  name: string;
  state: string;
}

type MaterialSourceLabelMap = ReadonlyMap<
  string,
  Pick<MaterialSourceLabel, "name" | "state">
>;

const materialStateLabels: Record<string, string> = {
  parsed: "已安全解析",
  saved_unread: "已保存、尚未读取",
  quarantined: "隔离中",
  scanning: "扫描中",
  parse_queued: "等待解析",
  scan_failed: "扫描未完成",
  blocked_malicious: "已阻止",
};

function deduplicateTraces(traces: readonly SourceTrace[]): SourceTrace[] {
  const seen = new Set<string>();
  return traces.filter((trace) => {
    const key = `${trace.kind}:${trace.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Collects provenance from every structured section without exposing the
 * opaque reference itself to the presentation layer.
 */
export function collectCaseSourceTraces(patch: CasePatch): SourceTrace[] {
  const traces: SourceTrace[] = [ ...(patch.sourceTrace ?? []) ];
  for (const fact of patch.facts ?? []) traces.push(...(fact.sourceTrace ?? []));
  for (const item of patch.timeline ?? []) traces.push(...(item.sourceTrace ?? []));
  for (const indicator of patch.iloIndicators ?? []) traces.push(...indicator.basis);
  for (const element of patch.elements ? Object.values(patch.elements) : []) traces.push(...element.basis);
  for (const item of patch.evidenceCoverage ?? []) traces.push(...(item.sourceTrace ?? []));
  return deduplicateTraces(traces);
}

/** Maps an internal trace to a safe, human-readable label for the UI. */
export function describeSourceTrace(
  trace: SourceTrace,
  materialSources?: MaterialSourceLabelMap,
): string {
  if (trace.kind === "material") {
    const material = materialSources?.get(trace.id);
    const name = material?.name?.trim() || "已关联材料";
    const state = materialStateLabels[material?.state ?? ""] ?? "处理状态待确认";
    return `材料：${name}（${state}）`;
  }
  if (trace.kind === "knowledge") return "知识库来源（已记录来源与核实日期）";
  return "对话内容（可回看原始对话）";
}

export function SourceTraceList({
  traces,
  materialSources,
}: {
  traces: readonly SourceTrace[];
  materialSources?: readonly MaterialSourceLabel[];
}) {
  const uniqueTraces = deduplicateTraces(traces);
  if (uniqueTraces.length === 0) return null;
  const materialSourceMap = new Map(
    (materialSources ?? []).map((source) => [source.contentRef, source] as const),
  );

  return (
    <details className="source-trace">
      <summary>查看来源（{uniqueTraces.length}）</summary>
      <ul className="source-trace-list">
        {uniqueTraces.map((trace) => (
          <li key={`${trace.kind}:${trace.id}`} data-source-kind={trace.kind}>
            {describeSourceTrace(trace, materialSourceMap)}
          </li>
        ))}
      </ul>
    </details>
  );
}
