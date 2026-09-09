import type { CasePatch } from "@/domain/case-record";
import type { IndicatorAssessment } from "@/domain/assessment";

import { Disclaimer } from "../common/disclaimer";
import { EvidenceCoverage } from "./evidence-coverage";
import { IndicatorMatrix } from "./indicator-matrix";

export function CaseReview({
  patch,
  saved,
  onSave,
  onPatchChange,
  onExport,
  onConfirmExport,
  exportPreview,
  exportConfirmed = false,
}: {
  patch: CasePatch;
  saved: boolean;
  onSave: () => void;
  onPatchChange?: (patch: CasePatch) => void;
  onExport?: () => void;
  onConfirmExport?: () => void;
  exportPreview?: { text: string; mediaType: string } | undefined;
  exportConfirmed?: boolean;
}) {
  const facts = patch.facts ?? [];
  const jurisdictionConfirmed = Boolean(
    patch.jurisdiction?.incidentCountry ||
      patch.jurisdiction?.userCountry ||
      patch.jurisdiction?.productDestination,
  );
  return (
    <section className="case-review" aria-labelledby="review-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">DRAFT REVIEW</p>
          <h2 id="review-title">档案草稿</h2>
        </div>
        <span className="review-state">需要你确认</span>
      </div>
      <p className="section-copy">下面是 AI 初步整理的内容。请逐项检查、修改或标记不确定；保存前不会对外提交。</p>
      <div className="fact-list" aria-label="已整理事实">
        {facts.length === 0 ? <p className="empty-state">这轮还没有提取到结构化事实。</p> : null}
        {facts.map((fact) => (
          <article key={fact.id} className="fact-item">
            <div>
              <strong>{fact.field}</strong>
              <p>{fact.value}</p>
            </div>
            <span className="certainty-label">{fact.certainty === "user_stated" ? "你提到的" : "待确认"}</span>
          </article>
        ))}
      </div>
      <IndicatorMatrix
        indicators={patch.iloIndicators ?? []}
        {...(onPatchChange
          ? {
              onChange: (indicatorId: IndicatorAssessment["indicatorId"], status: IndicatorAssessment["status"]) => {
                const currentIndicators = patch.iloIndicators ?? [];
                const indicators = currentIndicators.some((indicator) => indicator.indicatorId === indicatorId)
                  ? currentIndicators.map((indicator) =>
                      indicator.indicatorId === indicatorId ? { ...indicator, status } : indicator,
                    )
                  : [
                      ...currentIndicators,
                      {
                        indicatorId,
                        status,
                        basis: [],
                        missing: status === "insufficient" ? ["请补充相关事实或材料"] : [],
                      },
                    ];
                onPatchChange({ iloIndicators: indicators });
              },
            }
          : {})}
      />
      <EvidenceCoverage items={patch.evidenceCoverage ?? []} />
      {(patch.legalNavigation ?? []).length > 0 ? (
        <section className="review-section" aria-labelledby="legal-navigation-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">SOURCE NAVIGATION</p>
              <h2 id="legal-navigation-title">法律信息来源</h2>
            </div>
          </div>
          {jurisdictionConfirmed ? (
            <ul className="coverage-list">
              {(patch.legalNavigation ?? []).map((item) => (
                <li key={`${item.sourceId}-${item.jurisdiction}`} className="coverage-item">
                  <div>
                    <strong>{item.jurisdiction}</strong>
                    <p>{item.premise}</p>
                    <p>来源：{item.sourceId} · 核实日期：{item.lastVerified}</p>
                    {item.officialUrl ? <a href={item.officialUrl} target="_blank" rel="noreferrer">打开官方来源</a> : null}
                  </div>
                  <span className={`status-badge status-badge--${item.stale || item.status === "needs_review" ? "gap" : "covered"}`}>
                    {item.stale ? "信息可能已过期" : item.status === "needs_review" ? "来源需要复核" : item.status === "possible" ? "可能相关" : "暂未覆盖"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="section-copy">确认法域后再显示具体法律来源。</p>
          )}
        </section>
      ) : null}
      <div className="review-actions">
        <button type="button" className="primary-button" onClick={onSave} disabled={saved}>
          {saved ? "已保存" : "保存为私密档案"}
        </button>
        <button type="button" className="secondary-button">继续补充</button>
        {onExport ? <button type="button" className="secondary-button" onClick={onExport}>预览导出</button> : null}
      </div>
      {exportPreview ? (
        <section className="export-preview" data-testid="export-preview" aria-labelledby="export-preview-title">
          <h3 id="export-preview-title">导出预览</h3>
          <p>仅展示你确认的字段；平台不会自动提交到外部机构。</p>
          <pre>{exportPreview.text}</pre>
          {onConfirmExport ? (
            <div className="export-confirmation">
              <p>请确认预览内容无误后再生成本地文件。</p>
              <button type="button" className="primary-button" onClick={onConfirmExport} disabled={exportConfirmed}>
                {exportConfirmed ? "文件已生成" : "确认并生成文件"}
              </button>
              {exportConfirmed ? <p className="saved-note" data-testid="export-confirmed">已生成本地导出文件；平台不会自动提交。</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <Disclaimer kind="ai-assessment" />
      <p className="review-note">用户报告，未经独立核实；保存后仍可持续补充和修改。</p>
    </section>
  );
}
