import type { IndicatorAssessment } from "@/domain/assessment";

const indicatorLabels = [
  "欺骗",
  "行动限制",
  "孤立",
  "身体或性暴力",
  "恐吓和威胁",
  "扣留身份证件",
  "扣留工资",
  "债务束缚",
  "恶劣工作与生活条件",
  "过度加班",
  "滥用脆弱处境",
] as const;

const statusLabels = {
  hit: "有相关描述",
  not_hit: "当前未提及",
  insufficient: "信息不足",
} as const;

export function IndicatorMatrix({
  indicators = [],
  onChange,
}: {
  indicators?: IndicatorAssessment[];
  onChange?: (indicatorId: IndicatorAssessment["indicatorId"], status: IndicatorAssessment["status"]) => void;
}) {
  const byId = new Map(indicators.map((indicator) => [indicator.indicatorId, indicator]));
  return (
    <section className="review-section" aria-labelledby="indicator-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">ILO 11 INDICATORS</p>
          <h2 id="indicator-title">ILO 指标矩阵</h2>
        </div>
        <span className="qualitative-note">定性核对</span>
      </div>
      <ol className="indicator-list">
        {indicatorLabels.map((label, index) => {
          const indicator = byId.get((index + 1) as IndicatorAssessment["indicatorId"]);
          const status = indicator?.status ?? "insufficient";
          return (
            <li key={label} className="indicator-item">
              <span className="indicator-number">{index + 1}</span>
              <div className="indicator-copy">
                <strong>{label}</strong>
                <span>{statusLabels[status]}</span>
              </div>
              {onChange ? (
                <label className="indicator-editor">
                  <span className="sr-only">指标 {index + 1}状态</span>
                  <select
                    aria-label={`指标 ${index + 1}状态`}
                    value={status}
                    onChange={(event) => onChange((index + 1) as IndicatorAssessment["indicatorId"], event.target.value as IndicatorAssessment["status"])}
                  >
                    <option value="hit">有相关描述</option>
                    <option value="not_hit">当前未提及</option>
                    <option value="insufficient">信息不足</option>
                  </select>
                </label>
              ) : <span className={`status-badge status-badge--${status}`}>{statusLabels[status]}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
