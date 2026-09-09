import type { EvidenceCoverageItem } from "@/domain/assessment";

const topicLabels: Record<EvidenceCoverageItem["topic"], string> = {
  entity_facility: "主体与地点",
  timeline: "时间线",
  work_relationship: "工作关系",
  coercive_conduct: "强制性行为",
  pay_hours: "工资与工时",
  product_flow: "产品流向",
  supporting_material: "支持材料",
};

const statusLabels = { covered: "已有描述", partial: "部分描述", gap: "待补充" } as const;

export function EvidenceCoverage({ items = [] }: { items?: EvidenceCoverageItem[] }) {
  return (
    <section className="review-section" aria-labelledby="evidence-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">EVIDENCE COVERAGE</p>
          <h2 id="evidence-title">证据覆盖情况</h2>
        </div>
      </div>
      <ul className="coverage-list">
        {(items.length > 0 ? items : (Object.keys(topicLabels) as EvidenceCoverageItem["topic"][]).map((topic) => ({
          topic,
          status: "gap" as const,
          explanation: "还没有足够的可核对描述。",
          sourceMessageIds: [],
          safeOptions: ["只在安全的情况下补充"] ,
        }))).map((item) => (
          <li key={item.topic} className="coverage-item">
            <div>
              <strong>{topicLabels[item.topic]}</strong>
              <p>{item.explanation}</p>
            </div>
            <span className={`status-badge status-badge--${item.status}`}>{statusLabels[item.status]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
