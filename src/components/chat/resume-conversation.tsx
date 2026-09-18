"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Conversation } from "./conversation";
import { createConversationInitialData, type ConversationResumePayload } from "./conversation-resume";

export function buildConversationResumeUrl(caseId: string): string {
  return `/api/cases/${encodeURIComponent(caseId)}/conversation`;
}

export function ResumeConversation({ caseId }: { caseId: string }) {
  const [payload, setPayload] = useState<ConversationResumePayload>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void fetch(buildConversationResumeUrl(caseId), { cache: "no-store" })
      .then(async (response) => {
        const value = await response.json().catch(() => ({})) as { case?: unknown; messages?: unknown; message?: unknown };
        if (!response.ok || !value.case || !Array.isArray(value.messages)) {
          throw new Error(typeof value.message === "string" ? value.message : "私密案件暂时无法读取。" );
        }
        return value as ConversationResumePayload;
      })
      .then((value) => {
        if (active) {
          setPayload(value);
          setError(undefined);
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "私密案件暂时无法读取。" );
      });
    return () => { active = false; };
  }, [caseId]);

  if (error) {
    return (
      <section className="empty-page" aria-labelledby="resume-error-title">
        <p className="eyebrow">PRIVATE CONVERSATION</p>
        <h1 id="resume-error-title">无法恢复这份档案</h1>
        <p role="alert">{error}</p>
        <div className="review-actions">
          <Link className="primary-button primary-button--inline" href="/cases">返回我的档案</Link>
          <Link className="secondary-button secondary-button--inline" href="/recover">恢复访问</Link>
        </div>
      </section>
    );
  }

  if (!payload) {
    return <p className="empty-state" role="status">正在恢复私密对话……</p>;
  }

  return <Conversation initialData={createConversationInitialData(payload)} />;
}
