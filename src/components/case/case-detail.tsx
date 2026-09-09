"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface DeletionReceipt {
  caseId?: string;
  status?: string;
  targets?: string[];
}

export function CaseDetail({ caseId }: { caseId: string }) {
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [receipt, setReceipt] = useState<DeletionReceipt>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void fetch(`/api/cases/${encodeURIComponent(caseId)}`, { cache: "no-store" })
      .then((response) => {
        if (!active) return;
        setAvailable(response.ok);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setAvailable(false);
        setLoading(false);
      });
    return () => { active = false; };
  }, [caseId]);

  async function deleteCase() {
    setError(undefined);
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({})) as { receipt?: DeletionReceipt; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "案件删除暂时不可用。");
      setReceipt(payload.receipt);
      setDeleted(true);
      setConfirming(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "案件删除暂时不可用。");
    }
  }

  if (deleted) {
    return (
      <section className="empty-page" aria-labelledby="deleted-title">
        <p className="eyebrow">PRIVATE CASE</p>
        <h1 id="deleted-title">案件已删除</h1>
        <p data-testid="deletion-receipt">删除请求已受理，平台控制范围内的记录将按清理队列处理。</p>
        {receipt?.targets?.length ? <p>清理目标：{receipt.targets.join("、")}。</p> : null}
        <Link className="primary-button primary-button--inline" href="/start">返回对话</Link>
      </section>
    );
  }

  return (
    <section className="empty-page" aria-labelledby="case-page-title">
      <p className="eyebrow">PRIVATE CASE</p>
      <h1 id="case-page-title">案件 {caseId}</h1>
      {loading ? <p role="status">正在读取私密案件……</p> : null}
      {!loading && !available ? <p role="alert">案件不存在或当前会话无权访问。</p> : null}
      {!loading && available ? (
        <>
          <p>这是你的私密案件。你可以继续补充材料，或在需要时主动删除。</p>
          {!confirming ? (
            <button type="button" className="secondary-button secondary-button--danger" onClick={() => setConfirming(true)}>删除此案件</button>
          ) : (
            <div className="delete-confirmation" role="alertdialog" aria-labelledby="delete-confirmation-title">
              <h2 id="delete-confirmation-title">确认删除案件？</h2>
              <p>删除会立即阻断后续读取，并排队清理平台控制范围内的材料、转写和备份。</p>
              <div className="review-actions">
                <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>取消</button>
                <button type="button" className="secondary-button secondary-button--danger" onClick={() => void deleteCase()}>确认删除案件</button>
              </div>
            </div>
          )}
          {error ? <p className="inline-error" role="alert">{error}</p> : null}
        </>
      ) : null}
      <Link className="primary-button primary-button--inline" href="/start">返回对话</Link>
    </section>
  );
}
