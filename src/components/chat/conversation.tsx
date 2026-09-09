"use client";

import { useMemo, useRef, useState } from "react";

import type { AssistantTurn } from "@/ai/provider";
import type { CasePatch } from "@/domain/case-record";

import { addAssistantMessage, addUserMessage, createChatState, mergeDraftPatch, stopGeneration } from "./chat-state";
import { Composer } from "./composer";
import { MaterialUpload } from "./material-upload";
import {
  bootstrapPersistence,
  PersistenceBootstrapError,
  type PersistenceBootstrapResult,
} from "./persistence-bootstrap";
import { CaseReview } from "../case-review/case-review";
import { Disclaimer } from "../common/disclaimer";

interface ApiResponse {
  assistant: AssistantTurn;
  caseDraft?: CasePatch;
  caseVersion?: number;
}

function buildDraft(patch: CasePatch) {
  return {
    schemaVersion: "1.0" as const,
    visibility: "private" as const,
    lifecycle: "draft" as const,
    jurisdiction: patch.jurisdiction ?? {},
    facts: patch.facts ?? [],
    timeline: patch.timeline ?? [],
    iloIndicators: patch.iloIndicators ?? [],
    elements: patch.elements ?? {
      workOrService: { status: "unknown" as const, basis: [], missing: ["待补充"] },
      involuntary: { status: "unknown" as const, basis: [], missing: ["待补充"] },
      penaltyOrThreat: { status: "unknown" as const, basis: [], missing: ["待补充"] },
    },
    evidenceCoverage: patch.evidenceCoverage ?? [],
    legalNavigation: patch.legalNavigation ?? [],
    referrals: patch.referrals ?? [],
    safetyFlags: patch.safetyFlags ?? [],
    sourceTrace: patch.sourceTrace ?? [],
    consent: patch.consent ?? { version: "v1", saveCase: true, externalSharing: false, confirmedFieldPaths: [] },
    ...(patch.aiReviewStatus ? { aiReviewStatus: patch.aiReviewStatus } : {}),
  };
}

function newSessionId() {
  return globalThis.crypto?.randomUUID?.() ?? `local-${Date.now()}`;
}

export function Conversation() {
  const [state, setState] = useState(createChatState);
  const [input, setInput] = useState("");
  const [sessionId] = useState(newSessionId);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string>();
  const [pendingMaterials, setPendingMaterials] = useState(false);
  const [caseId, setCaseId] = useState<string>();
  const [caseVersion, setCaseVersion] = useState<number>();
  const [draftDirty, setDraftDirty] = useState(false);
  const [accountAlias, setAccountAlias] = useState<string>();
  const [recoverySecret, setRecoverySecret] = useState<string>();
  const [exportPreview, setExportPreview] = useState<{ text: string; mediaType: string }>();
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [safetyPaused, setSafetyPaused] = useState(false);
  const [safetyExited, setSafetyExited] = useState(false);
  const persistenceRef = useRef<PersistenceBootstrapResult | undefined>(undefined);
  const requestControllerRef = useRef<AbortController | undefined>(undefined);

  const latestAssistant = useMemo(
    () => [...state.messages].reverse().find((message) => message.role === "assistant"),
    [state.messages],
  );

  async function saveDraft() {
    setSaveMessage(undefined);
    setError(undefined);
    const patch = state.draftPatch ?? {};

    if (caseId) {
      if (!draftDirty) {
        setSaved(true);
        setSaveMessage("已保存为私密档案，仅本人可见。");
        return;
      }
      if (caseVersion === undefined) {
        setError("案件版本未知，请刷新案件后再保存修改。");
        return;
      }
      try {
        const response = await fetch(`/api/cases/${caseId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ patch, expectedVersion: caseVersion }),
        });
        const payload = await response.json().catch(() => ({})) as { case?: { version?: unknown }; message?: string };
        if (!response.ok) {
          setError(payload.message ?? (response.status === 409 ? "案件已被更新，请刷新后重试。" : "案件修改暂时无法保存。"));
          return;
        }
        const nextVersion = payload.case?.version;
        if (!Number.isInteger(nextVersion) || (nextVersion as number) < 1) {
          setError("案件服务返回的数据不完整，修改尚未确认保存。");
          return;
        }
        setCaseVersion(nextVersion as number);
        setDraftDirty(false);
        setSaved(true);
        setSaveMessage("已保存为私密档案，仅本人可见。");
      } catch {
        setError("案件修改暂时无法保存，请稍后重试。");
      }
      return;
    }

    try {
      const persistence = await bootstrapPersistence(fetch, buildDraft(patch));
      if (persistence.mode === "preview") {
        setDraftDirty(false);
        setSaved(true);
        setSaveMessage("本地预览已保留；私密档案服务暂时不可用。内容不会对外提交。");
        return;
      }
      adoptPersistentCase(persistence);
      setDraftDirty(false);
      setSaved(true);
      setSaveMessage("已保存为私密档案，仅本人可见。此前的预览对话原文未写入档案。");
    } catch {
      setDraftDirty(false);
      setSaved(true);
      setSaveMessage("本地预览已保留；生产持久化尚未连接。内容不会对外提交。");
    }
  }

  function adoptPersistentCase(persistence: Extract<PersistenceBootstrapResult, { mode: "persistent" }>) {
    persistenceRef.current = persistence;
    setCaseId(persistence.caseId);
    if (persistence.version !== undefined) setCaseVersion(persistence.version);
    setAccountAlias(persistence.alias);
    setRecoverySecret(persistence.recoverySecret);
  }

  async function sendMessage(message: string, appendUser = true) {
    if (!message || state.status === "sending") return;
    setError(undefined);

    let persistence = persistenceRef.current;
    if (!persistence) {
      try {
        persistence = await bootstrapPersistence(fetch, buildDraft(state.draftPatch ?? {}));
        persistenceRef.current = persistence;
        if (persistence.mode === "persistent") {
          adoptPersistentCase(persistence);
        }
      } catch (caught) {
        setError(
          caught instanceof PersistenceBootstrapError
            ? caught.message
            : "私密档案初始化失败，请稍后重试。",
        );
        return;
      }
    }

    if (appendUser) {
      setInput("");
      setState((current) => addUserMessage(current, message));
    } else {
      setState((current) => ({ ...current, status: "sending" }));
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const requestBody: { sessionId: string; message: string; caseId?: string } = {
        sessionId,
        message,
      };
      if (persistence.mode === "persistent") requestBody.caseId = persistence.caseId;
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const payload = (await response.json()) as ApiResponse | { message?: string };
      if (!response.ok || !("assistant" in payload)) {
        throw new Error("message" in payload ? payload.message : "本轮暂时无法处理");
      }
      setState((current) => addAssistantMessage(current, {
        id: `assistant-${current.messages.length}`,
        content: payload.assistant.message,
        patch: payload.caseDraft ?? payload.assistant.draftPatch,
        assistantState: payload.assistant.state,
        actions: payload.assistant.actions,
      }));
      if ("caseVersion" in payload && typeof payload.caseVersion === "number" && Number.isInteger(payload.caseVersion) && payload.caseVersion > 0) {
        setCaseVersion(payload.caseVersion);
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setState((current) => stopGeneration(current));
        return;
      }
      setError(caught instanceof Error ? caught.message : "本轮暂时无法处理");
      setState((current) => stopGeneration(current));
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = undefined;
    }
  }

  async function send() {
    await sendMessage(input.trim());
  }

  async function retryLatest() {
    if (state.status === "sending") return;
    const message = [...state.messages].reverse().find((candidate) => candidate.role === "user")?.content;
    if (!message) return;
    await sendMessage(message);
  }

  function editMessage(messageId: string) {
    const message = state.messages.find((candidate) => candidate.id === messageId && candidate.role === "user");
    if (!message || state.status === "sending") return;
    setInput(message.content);
    setError(undefined);
  }

  function stop() {
    requestControllerRef.current?.abort();
    setState(stopGeneration);
  }

  return (
    <div className="case-workspace">
      <section className="conversation-panel" aria-labelledby="conversation-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PRIVATE CONVERSATION</p>
            <h1 id="conversation-title">从你愿意分享的部分开始</h1>
          </div>
          <span className="privacy-chip"><span aria-hidden="true">●</span> 仅本人可见</span>
        </div>
        <div className="messages" aria-live="polite" aria-label="对话记录">
          {state.messages.map((message) => (
            <article key={message.id} className={`message message--${message.role}`} data-message-role={message.role}>
              {message.role === "assistant" ? (
                <div className="avatar avatar--ai" data-avatar-position="left" aria-hidden="true">M</div>
              ) : null}
              <div className="message__content">
                <p className="message__author">{message.role === "assistant" ? "Manbo AI" : "你"}</p>
                <p>{message.content}</p>
                <div className="message__actions">
                  {message.role === "user" ? (
                    <button type="button" className="message-action" aria-label="编辑消息" onClick={() => editMessage(message.id)} disabled={state.status === "sending"}>
                      编辑
                    </button>
                  ) : null}
                  {message.role === "assistant" && message.id !== "welcome" ? (
                    <button type="button" className="message-action" aria-label="重试" onClick={() => { void retryLatest(); }} disabled={state.status === "sending"}>
                      重试
                    </button>
                  ) : null}
                </div>
              </div>
              {message.role === "user" ? (
                <div className="avatar avatar--user" data-avatar-position="right" aria-hidden="true">你</div>
              ) : null}
            </article>
          ))}
          {latestAssistant?.assistantState === "SAFETY_ESCALATION" && !safetyExited ? (
            <section className="safety-resources" data-testid="emergency-resources" aria-labelledby="emergency-resources-title">
              <h2 id="emergency-resources-title">静态安全资源</h2>
              <p>如果你正面临即时危险，请在安全可行时联系当地紧急服务或可信赖的支持人员。不要为了取证让自己暴露风险。</p>
              <ul>
                <li>优先前往你认为安全的地点，并使用可信赖设备联系支持。</li>
                <li>你可以暂停、退出，或稍后在安全环境中继续。</li>
              </ul>
              <div className="safety-actions">
                <button type="button" className="secondary-button" onClick={() => setSafetyPaused(true)} disabled={safetyPaused}>
                  {safetyPaused ? "已暂停对话" : "暂停对话"}
                </button>
                <button type="button" className="secondary-button secondary-button--danger" onClick={() => setSafetyExited(true)}>
                  退出对话
                </button>
              </div>
            </section>
          ) : null}
          {safetyExited ? <p className="saved-note" role="status">对话已退出。你可以关闭此页面，或在安全时重新开始。</p> : null}
          {state.status === "sending" ? <p className="typing-indicator" role="status">AI 正在整理……</p> : null}
        </div>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        <Composer
          value={input}
          busy={state.status === "sending"}
          blocked={pendingMaterials || safetyPaused || safetyExited}
          onChange={setInput}
          onSubmit={send}
          onStop={stop}
        />
        <div className="disclaimer-row">
          <Disclaimer kind="ai-assessment" />
          <Disclaimer kind="user-decision" />
        </div>
      </section>

      <aside className="workspace-sidebar" aria-label="案件材料与审阅">
        {recoverySecret ? (
          <section className="recovery-panel" aria-labelledby="recovery-secret-title">
            <div className="section-heading">
              <h2 id="recovery-secret-title">恢复密钥</h2>
              <span className="review-state">仅显示一次</span>
            </div>
            <p className="section-copy">
              {accountAlias ? `化名账户：${accountAlias}。` : "请保存这组密钥。"} 密钥无法找回，也不会写入浏览器或后续请求。
            </p>
            <code className="recovery-secret" data-testid="recovery-secret">{recoverySecret}</code>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setRecoverySecret(undefined)}
            >
              我已安全保存
            </button>
          </section>
        ) : null}
        <MaterialUpload caseId={caseId} onPendingChange={setPendingMaterials} />
        {state.draftPatch ? (
          <CaseReview
            patch={state.draftPatch}
            saved={saved}
            onPatchChange={(patch) => {
              setState((current) => mergeDraftPatch(current, patch));
              setDraftDirty(true);
              setSaved(false);
              setSaveMessage(undefined);
            }}
            onSave={() => { void saveDraft(); }}
            onExport={() => {
              void (async () => {
                if (!caseId) {
                  setError("请先保存为私密档案，再预览导出内容。");
                  return;
                }
                const response = await fetch(`/api/cases/${caseId}/export`, {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    connectorId: "markdown",
                    caseVersion: caseVersion ?? 1,
                    fieldPaths: ["/facts", "/timeline", "/jurisdiction"],
                    consentEventId: "user-confirmed-in-ui",
                  }),
                });
                const payload = await response.json().catch(() => ({})) as { preview?: { text: string; mediaType: string }; message?: string };
                if (!response.ok || !payload.preview) {
                  setError(payload.message ?? "导出预览暂时不可用。");
                  return;
                }
                setExportPreview(payload.preview);
                setExportConfirmed(false);
              })();
            }}
            onConfirmExport={() => {
              if (!exportPreview) return;
              const blob = new Blob([exportPreview.text], { type: exportPreview.mediaType });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement("a");
              anchor.href = url;
              anchor.download = exportPreview.mediaType === "application/json" ? "manbo-case.json" : "manbo-case.md";
              anchor.click();
              URL.revokeObjectURL(url);
              setExportConfirmed(true);
            }}
            exportPreview={exportPreview}
            exportConfirmed={exportConfirmed}
          />
        ) : null}
        {saved ? <p className="saved-note" role="status">{saveMessage ?? "已保存为私密档案，仅本人可见。"}</p> : null}
        {latestAssistant?.content.includes("法律") ? <Disclaimer kind="legal-reference" /> : null}
      </aside>
    </div>
  );
}
