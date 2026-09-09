"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { useEffect } from "react";
import type { AdminCaseView } from "@/server/admin/admin-case-service";
import type { AdminReviewVersion } from "@/domain/admin-review";
import type { AdminCaseChangeVersion } from "@/server/repositories/admin-case-change-repository";

const reviewStatuses = [
  ["intake_rejected", "无效接收"],
  ["evidence_incomplete", "需继续补充"],
  ["credibility_concern", "存在可信度疑点"],
  ["demonstrably_false", "有可复核反证"],
] as const;

type ReviewStatus = (typeof reviewStatuses)[number][0];

function initialReviewStatus(caseView: AdminCaseView): ReviewStatus {
  return caseView.record.aiReviewStatus === "needs_more_information"
    ? "evidence_incomplete"
    : "intake_rejected";
}

function createReviewId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? "review-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export function AdminCaseReviewWorkbench({ caseView }: { caseView: AdminCaseView }) {
  const [activeCaseView, setActiveCaseView] = useState(caseView);
  const [reviews, setReviews] = useState<readonly AdminReviewVersion[]>([]);
  const [changes, setChanges] = useState<readonly AdminCaseChangeVersion[]>([]);
  const [status, setStatus] = useState<ReviewStatus>(() => initialReviewStatus(caseView));
  const [lifecycle, setLifecycle] = useState(caseView.record.lifecycle);
  const [aiReviewStatus, setAiReviewStatus] = useState(caseView.record.aiReviewStatus ?? "");
  const [rationale, setRationale] = useState("");
  const [sourceRefs, setSourceRefs] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  const [submissionMessage, setSubmissionMessage] = useState<string | null>(null);
  const [mutationMessage, setMutationMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const encodedCaseId = encodeURIComponent(caseView.record.caseId);
    Promise.all([
      fetch("/api/admin/cases/" + encodedCaseId, { cache: "no-store" }),
      fetch("/api/admin/cases/" + encodedCaseId + "/reviews", { cache: "no-store" }),
    ])
      .then(async ([caseResponse, reviewResponse]) => {
        if (!caseResponse.ok || !reviewResponse.ok) throw new Error("ADMIN_CASE_UNAVAILABLE");
        return Promise.all([
          caseResponse.json() as Promise<AdminCaseView>,
          reviewResponse.json() as Promise<{ reviews: AdminReviewVersion[] }>,
        ]);
      })
      .then(([nextCaseView, reviewPayload]) => {
        if (!cancelled) {
          setActiveCaseView(nextCaseView);
          setReviews(reviewPayload.reviews);
          setStatus(initialReviewStatus(nextCaseView));
          setLifecycle(nextCaseView.record.lifecycle);
          setAiReviewStatus(nextCaseView.record.aiReviewStatus ?? "");
        }
      })
      .catch(() => undefined);
    fetch("/api/admin/cases/" + encodedCaseId + "/changes", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ changes: AdminCaseChangeVersion[] }> : null)
      .then((payload) => { if (!cancelled && payload) setChanges(payload.changes); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [caseView.record.caseId]);

  async function submitCaseMutation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsMutating(true);
    setMutationMessage(null);
    try {
      const patch: Record<string, unknown> = { lifecycle };
      if (aiReviewStatus) patch.aiReviewStatus = aiReviewStatus;
      const response = await fetch("/api/admin/cases/" + encodeURIComponent(activeCaseView.record.caseId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: activeCaseView.record.version, patch }),
      });
      const payload = await response.json().catch(() => null) as { case?: AdminCaseView; message?: string } | null;
      if (!response.ok || !payload?.case) throw new Error(payload?.message ?? "CASE_UPDATE_FAILED");
      setActiveCaseView(payload.case);
      setLifecycle(payload.case.record.lifecycle);
      setAiReviewStatus(payload.case.record.aiReviewStatus ?? "");
      setMutationMessage("案件字段已更新，并已保存管理员变更版本。");
      const changesResponse = await fetch("/api/admin/cases/" + encodeURIComponent(activeCaseView.record.caseId) + "/changes", { cache: "no-store" });
      if (changesResponse.ok) setChanges((await changesResponse.json() as { changes: AdminCaseChangeVersion[] }).changes);
    } catch (error) {
      setMutationMessage(error instanceof Error && error.message ? error.message : "案件暂未更新，请刷新后重试。");
    } finally {
      setIsMutating(false);
    }
  }

  async function deleteCase() {
    if (!globalThis.confirm("确认软删除此案件？原始材料和版本不会被物理擦除。")) return;
    setIsMutating(true);
    setMutationMessage(null);
    try {
      const response = await fetch("/api/admin/cases/" + encodeURIComponent(activeCaseView.record.caseId), { method: "DELETE" });
      if (!response.ok) throw new Error("案件暂未删除，请刷新后重试。");
      globalThis.history.pushState({}, "", "/admin/cases");
      globalThis.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      setMutationMessage(error instanceof Error ? error.message : "案件暂未删除，请刷新后重试。");
      setIsMutating(false);
    }
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmissionMessage(null);
    try {
      const response = await fetch("/api/admin/cases/" + encodeURIComponent(activeCaseView.record.caseId) + "/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          adminReviewVersionId: createReviewId(),
          status,
          rationale: rationale.trim() || null,
          sourceRefs: sourceRefs.split("\n").map((value) => value.trim()).filter(Boolean),
          supersedesId: null,
        }),
      });
      if (!response.ok) throw new Error("REVIEW_SUBMISSION_FAILED");
      setSubmissionMessage("审核标注已保存为不可变版本。用户仍可继续补充材料。");
      setRationale("");
      setSourceRefs("");
    } catch {
      setSubmissionMessage("审核标注暂未保存。请检查管理员身份服务后重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="workspace admin-workspace">
      <header className="topbar">
        <Link className="brand" href="/admin/cases" aria-label="返回管理员审核队列">
          <span className="brand__mark" aria-hidden="true">M</span>
          <span>Manbo</span>
        </Link>
        <span className="privacy-state"><span className="privacy-state__dot" aria-hidden="true" />私密审核</span>
      </header>
      <section className="admin-case-shell" aria-labelledby="admin-case-title">
        <p className="eyebrow">CASE REVIEW</p>
        <div className="admin-heading">
          <div>
            <h1 id="admin-case-title">案件 {activeCaseView.record.caseId}</h1>
            <p>此处仅用于人工复核、补充和申诉准备；不会自动向任何外部机构提交。</p>
          </div>
          <span className="privacy-chip"><span aria-hidden="true">●</span> 仅授权管理员</span>
        </div>
        <section className="admin-panel" aria-labelledby="materials-title">
          <h2 id="materials-title">材料</h2>
          <p>管理员可随时查看、播放或下载；这些动作不写入应用级访问记录。材料由服务端解密读取，不会暴露对象存储链接。</p>
          <ul className="admin-material-list">
            {activeCaseView.materials.map((material) => {
              const baseUrl = "/api/admin/cases/" + encodeURIComponent(activeCaseView.record.caseId) + "/materials/" + encodeURIComponent(material.materialId);
              return (
                <li key={material.materialId}>
                  <div><strong>{material.originalFilename ?? "未命名材料"}</strong><span>{material.processingState} · {material.declaredMime ?? "格式待识别"}</span></div>
                  <div className="admin-material-actions">
                    <span className="status-badge">{material.eligibleForAi ? "已可供 AI 使用" : "不会进入 AI"}</span>
                    <a className="secondary-button" href={baseUrl + "?mode=play"} target="_blank" rel="noreferrer">播放</a>
                    <a className="secondary-button" href={baseUrl + "?mode=download"}>下载</a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
        <section className="admin-panel" aria-labelledby="review-label-title">
          <h2 id="review-label-title">独立审核标注</h2>
          <p>标注会形成不可变审核版本，用于通知、继续补充和申诉；审核不会覆盖用户原始陈述或 AI 初审版本。</p>
          <form className="admin-review-form" onSubmit={submitReview}>
            <fieldset className="review-status-grid">
              <legend className="sr-only">选择审核标注</legend>
              {reviewStatuses.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="secondary-button"
                  data-review-status={value}
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label}
                </button>
              ))}
            </fieldset>
            <label className="admin-field">
              <span>书面说明{status === "credibility_concern" || status === "demonstrably_false" ? "（必填）" : "（可选）"}</span>
              <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} maxLength={10_000} rows={4} />
            </label>
            <label className="admin-field">
              <span>依据材料或来源（每行一项）{status === "credibility_concern" || status === "demonstrably_false" ? "（必填）" : "（可选）"}</span>
              <textarea value={sourceRefs} onChange={(event) => setSourceRefs(event.target.value)} maxLength={11_520} rows={3} />
            </label>
            <button className="primary-button" type="submit" disabled={isSubmitting}>{isSubmitting ? "正在保存…" : "提交审核标注"}</button>
          </form>
          {submissionMessage ? <p className="saved-note" role="status">{submissionMessage}</p> : null}
          <h3 className="admin-review-history-title">已保存审核版本</h3>
          {reviews.length === 0 ? (
            <p className="empty-state">尚无管理员审核版本。</p>
          ) : (
            <ol className="admin-review-history">
              {reviews.map((review) => (
                <li key={review.adminReviewVersionId}>
                  <strong>{review.status}</strong>
                  <span>{review.reviewerId} · {review.createdAt}</span>
                  {review.rationale ? <p>{review.rationale}</p> : null}
                </li>
              ))}
            </ol>
          )}
          <p className="saved-note">材料仍可继续补充。管理员低频查看不会改变用户的保存权利。</p>
        </section>
        <section className="admin-panel" aria-labelledby="case-maintenance-title">
          <h2 id="case-maintenance-title">案件维护</h2>
          <p>仅具备主管权限的管理员可以修改案件字段或执行软删除。每次操作都带版本校验并写入独立变更版本。</p>
          <form className="admin-review-form" onSubmit={submitCaseMutation}>
            <label className="admin-field">
              <span>案件生命周期</span>
              <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as typeof lifecycle)}>
                <option value="draft">草稿</option>
                <option value="confirmed">已确认</option>
                <option value="exported">已导出</option>
              </select>
            </label>
            <label className="admin-field">
              <span>AI 初审工作流（可选）</span>
              <select value={aiReviewStatus} onChange={(event) => setAiReviewStatus(event.target.value)}>
                <option value="">保持当前值</option>
                <option value="ready_for_preparation">可进入材料准备</option>
                <option value="needs_more_information">需继续补充</option>
                <option value="out_of_scope">超出平台范围</option>
                <option value="safety_referral">需安全转介</option>
              </select>
            </label>
            <div className="admin-material-actions">
              <button className="primary-button" type="submit" disabled={isMutating}>{isMutating ? "正在保存…" : `保存案件（版本 ${activeCaseView.record.version}）`}</button>
              <button className="secondary-button secondary-button--danger" type="button" onClick={deleteCase} disabled={isMutating}>软删除案件</button>
            </div>
          </form>
          {mutationMessage ? <p className="saved-note" role="status">{mutationMessage}</p> : null}
          <h3 className="admin-review-history-title">管理员变更历史</h3>
          {changes.length === 0 ? (
            <p className="empty-state">尚无管理员案件变更版本。</p>
          ) : (
            <ol className="admin-review-history">
              {changes.map((change) => (
                <li key={change.changeVersionId}>
                  <strong>{change.action === "modify" ? "修改案件" : "软删除案件"}</strong>
                  <span>{change.adminId} · {change.createdAt} · 预期版本 {change.expectedVersion ?? "—"}</span>
                  {change.action === "modify" ? <p>{JSON.stringify(change.patch)}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </section>
    </main>
  );
}
