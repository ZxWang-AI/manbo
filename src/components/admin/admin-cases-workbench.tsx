"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { AdminCaseListItem } from "@/server/admin/admin-case-service";

function workflowLabel(status: AdminCaseListItem["aiReviewStatus"]): string {
  switch (status) {
    case "ready_for_preparation": return "可进入材料准备";
    case "needs_more_information": return "需继续补充";
    case "out_of_scope": return "超出平台范围";
    case "safety_referral": return "需安全转介";
    default: return "尚未完成初审";
  }
}

export function AdminCasesWorkbench({ cases }: { cases: readonly AdminCaseListItem[] }) {
  const [items, setItems] = useState<readonly AdminCaseListItem[]>(cases);
  const [isLoading, setIsLoading] = useState(cases.length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/cases", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("ADMIN_CASES_UNAVAILABLE");
        return response.json() as Promise<{ cases: AdminCaseListItem[] }>;
      })
      .then((payload) => {
        if (!cancelled) setItems(payload.cases);
      })
      .catch(() => {
        if (!cancelled) setLoadError("管理员身份服务尚未配置，当前仅显示安全占位。");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="workspace admin-workspace">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Manbo 首页">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />管理员审核区</span>
      </header>
      <section className="admin-shell" aria-labelledby="admin-cases-title">
        <p className="eyebrow">PRIVATE REVIEW QUEUE</p>
        <div className="admin-heading">
          <div>
            <h1 id="admin-cases-title">管理员审核工作台</h1>
            <p>管理员可以随时复核私密案件和材料，无需说明查看理由。查看、播放和下载不会留下查看记录。</p>
          </div>
          <span className="privacy-chip"><span aria-hidden="true">●</span> 不公开</span>
        </div>
        <div className="admin-note" role="note">AI 只做第一次结构化初审；审核标注独立保存，不覆盖用户原始陈述或 AI 版本。</div>
        {isLoading ? (
          <p className="empty-state" role="status">正在加载审核队列…</p>
        ) : items.length === 0 ? (
          <p className="empty-state">{loadError ?? "当前没有可供审核的私密案件。"}</p>
        ) : (
          <ul className="admin-case-list">
            {items.map((item) => (
              <li className="admin-case-item" key={item.caseId}>
                <div>
                  <strong>案件 {item.caseId}</strong>
                  <span>{workflowLabel(item.aiReviewStatus)} · {item.materialCount} 份材料</span>
                  <small>最近更新 {item.updatedAt}</small>
                </div>
                <Link className="secondary-button" href={`/admin/cases/${encodeURIComponent(item.caseId)}`}>查看案件</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
