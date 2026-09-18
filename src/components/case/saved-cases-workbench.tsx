"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { PrivateCaseListItem } from "@/domain/case-list";

function lifecycleLabel(lifecycle: PrivateCaseListItem["lifecycle"]): string {
  switch (lifecycle) {
    case "confirmed": return "已确认档案";
    case "exported": return "已生成本地导出";
    case "draft": return "持续整理中";
    case "deleted": return "已删除";
    default: return "私密档案";
  }
}

function workflowLabel(status: PrivateCaseListItem["aiReviewStatus"]): string {
  switch (status) {
    case "ready_for_preparation": return "可进入材料准备";
    case "needs_more_information": return "需继续补充";
    case "out_of_scope": return "超出平台范围";
    case "safety_referral": return "需安全转介";
    default: return "尚未完成初审";
  }
}

export function caseDisplayId(caseId: string): string {
  const compact = caseId.replaceAll("-", "").slice(0, 8);
  return compact ? `案件 ${compact}` : "私密案件";
}

export function SavedCasesWorkbench({
  initialCases = [],
}: {
  initialCases?: readonly PrivateCaseListItem[];
}) {
  const [items, setItems] = useState<readonly PrivateCaseListItem[]>(initialCases);
  const [loading, setLoading] = useState(initialCases.length === 0);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void fetch("/api/cases", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) {
          if (active) setAuthRequired(true);
          return null;
        }
        if (!response.ok) throw new Error("CASES_UNAVAILABLE");
        return response.json() as Promise<{ cases?: unknown }>;
      })
      .then((payload) => {
        if (!active || !payload || !Array.isArray(payload.cases)) return;
        setItems(payload.cases as PrivateCaseListItem[]);
        setAuthRequired(false);
        setError(undefined);
      })
      .catch(() => {
        if (active) setError("私密档案暂时无法读取，请稍后重试。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  return (
    <main className="workspace cases-workspace">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <div className="topbar__actions">
          <Link className="text-link" href="/recover">恢复访问</Link>
          <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密工作区</span>
        </div>
      </header>

      <section className="cases-shell" aria-labelledby="saved-cases-title">
        <p className="eyebrow">PRIVATE CASES</p>
        <div className="cases-heading">
          <div>
            <h1 id="saved-cases-title">我的私密档案</h1>
            <p>档案只在你的会话中可见。你可以随时继续补充、修改或主动删除。</p>
          </div>
          <Link className="primary-button primary-button--inline" href="/start">开始新的对话</Link>
        </div>

        {loading ? <p className="empty-state" role="status">正在读取私密档案……</p> : null}
        {authRequired ? (
          <div className="empty-state" role="alert">
            <p>当前会话没有可读取的档案。</p>
            <Link className="secondary-button secondary-button--inline" href="/recover">使用化名和恢复密钥</Link>
          </div>
        ) : null}
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        {!loading && !authRequired && !error && items.length === 0 ? (
          <div className="empty-state">
            <p>还没有保存的私密档案。</p>
            <Link className="secondary-button secondary-button--inline" href="/start">进入 AI 对话</Link>
          </div>
        ) : null}
        {!loading && !authRequired && !error && items.length > 0 ? (
          <ul className="saved-case-list">
            {items.map((item) => (
              <li className="saved-case-item" key={item.caseId}>
                <div className="saved-case-item__summary">
                  <strong>{caseDisplayId(item.caseId)}</strong>
                  <span>{lifecycleLabel(item.lifecycle)} · {workflowLabel(item.aiReviewStatus)}</span>
                  <small>{item.materialCount} 份材料 · 版本 {item.version} · 最近更新 <time dateTime={item.updatedAt}>{item.updatedAt}</time></small>
                </div>
                <div className="saved-case-item__actions">
                  <Link className="primary-button primary-button--inline" href={`/cases/${encodeURIComponent(item.caseId)}/conversation`}>继续对话</Link>
                  <Link className="secondary-button secondary-button--inline" href={`/cases/${encodeURIComponent(item.caseId)}`}>档案设置</Link>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="boundary-note">恢复密钥只用于建立会话，不会显示在列表中，也不会写入浏览器存储。</p>
      </section>
    </main>
  );
}
