"use client";

import { useMemo, useRef, useState } from "react";

import type { AssistantTurn } from "@/ai/provider";
import type { CasePatch } from "@/domain/case-record";
import {
  resolveTurnAttempt,
  shouldRetainPendingTurn,
  type PendingTurnAttempt,
} from "./conversation-turn-client";

import {
  addAssistantMessage,
  addUserMessage,
  acceptCaseVersion,
  bindPersistedUserMessage,
  createChatState,
  mergeDraftPatch,
  prepareRetry,
  stopGeneration,
  type ChatState,
} from "./chat-state";
import { Composer } from "./composer";
import { MaterialUpload } from "./material-upload";
import type { MaterialSourceLabel } from "../case-review/source-trace";
import {
  bootstrapPersistence,
  PersistenceBootstrapError,
  type PersistenceBootstrapResult,
} from "./persistence-bootstrap";
import { CaseReview } from "../case-review/case-review";
import { Disclaimer } from "../common/disclaimer";
import type { ConversationInitialData } from "./conversation-resume";

interface ApiResponse {
  assistant: AssistantTurn;
  caseDraft?: CasePatch;
  caseVersion?: number;
  persistence?: {
    messageSaved: boolean;
    userMessageCreated: boolean;
    userMessageId: string;
    assistantMessageId?: string;
    caseUpdated: boolean;
  };
}

interface SendMessageOptions {
  appendUser?: boolean;
  retryUserMessageId?: string;
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

function newLocalUserMessageId() {
  return `local-user-${newSessionId()}`;
}

function initialChatState(initialData?: ConversationInitialData): ChatState {
  if (!initialData) return createChatState();
  return {
    messages: initialData.messages.length > 0
      ? initialData.messages
      : createChatState().messages,
    status: "review",
    draftPatch: initialData.draftPatch,
  };
}

export function recoverPendingTurn(initialData?: ConversationInitialData): PendingTurnAttempt | undefined {
  const recoverable = [...(initialData?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === "reserved" || turn.status === "processing" || turn.status === "result_ready");
  const source = recoverable?.userMessageId
    ? initialData?.messages.find((message) => message.persistedMessageId === recoverable.userMessageId)
    : undefined;
  return recoverable && source
    ? {
        turnId: recoverable.turnId,
        content: source.content,
        ...(recoverable.operation === "retry" && recoverable.sourceUserMessageId
          ? { retryUserMessageId: recoverable.sourceUserMessageId }
          : {}),
      }
    : undefined;
}

export function Conversation({ initialData }: { initialData?: ConversationInitialData } = {}) {
  const [state, setState] = useState(() => initialChatState(initialData));
  const [input, setInput] = useState("");
  const [sessionId] = useState(newSessionId);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(Boolean(initialData));
  const [saveMessage, setSaveMessage] = useState<string>();
  const [pendingMaterials, setPendingMaterials] = useState(false);
  const [selectedContentRefs, setSelectedContentRefs] = useState<string[]>([]);
  const [materialSources, setMaterialSources] = useState<MaterialSourceLabel[]>([]);
  const [caseId, setCaseId] = useState<string | undefined>(initialData?.caseId);
  const [caseVersion, setCaseVersion] = useState<number | undefined>(initialData?.caseVersion);
  const [draftDirty, setDraftDirty] = useState(false);
  const [accountAlias, setAccountAlias] = useState<string>();
  const [recoverySecret, setRecoverySecret] = useState<string>();
  const [exportPreview, setExportPreview] = useState<{ text: string; mediaType: string }>();
  const [exportConfirmed, setExportConfirmed] = useState(false);
  const [safetyPaused, setSafetyPaused] = useState(false);
  const [safetyExited, setSafetyExited] = useState(false);
  const persistenceRef = useRef<PersistenceBootstrapResult | undefined>(
    initialData
      ? {
          mode: "persistent",
          caseId: initialData.caseId,
          alias: "",
          recoverySecret: "",
          version: initialData.caseVersion,
        }
      : undefined,
  );
  const requestControllerRef = useRef<AbortController | undefined>(undefined);
  const turnInFlightRef = useRef(false);
  const pendingTurnRef = useRef<PendingTurnAttempt | undefined>(recoverPendingTurn(initialData));
  const composerRef = useRef<HTMLTextAreaElement>(null);

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

  async function sendMessage(
    message: string,
    { appendUser = true, retryUserMessageId }: SendMessageOptions = {},
  ) {
    if (!message || state.status === "sending" || turnInFlightRef.current) return;
    turnInFlightRef.current = true;
    setError(undefined);

    try {
      let persistence = persistenceRef.current;
      if (!persistence && caseId && caseVersion !== undefined) {
        persistence = {
          mode: "persistent",
          caseId,
          alias: "",
          recoverySecret: "",
          version: caseVersion,
        };
        persistenceRef.current = persistence;
      }
      if (!persistence) {
        persistence = await bootstrapPersistence(fetch, buildDraft(state.draftPatch ?? {}));
        persistenceRef.current = persistence;
        if (persistence.mode === "persistent") {
          adoptPersistentCase(persistence);
        }
      }

      const turnAttempt = resolveTurnAttempt({
        persistent: persistence.mode === "persistent",
        content: message,
        contentRefs: selectedContentRefs,
        ...(retryUserMessageId ? { retryUserMessageId } : {}),
        ...(pendingTurnRef.current ? { pending: pendingTurnRef.current } : {}),
      });
      if (turnAttempt.turnId) {
        pendingTurnRef.current = {
          turnId: turnAttempt.turnId,
          content: message,
          contentRefs: [...selectedContentRefs],
          ...(retryUserMessageId ? { retryUserMessageId } : {}),
        };
      } else {
        pendingTurnRef.current = undefined;
      }

      const shouldAppendUser = appendUser && !turnAttempt.reuseUserBubble;
      const localUserMessageId = shouldAppendUser ? newLocalUserMessageId() : undefined;
      if (shouldAppendUser) {
        setInput("");
        setState((current) => addUserMessage(current, message, localUserMessageId));
      } else {
        setState((current) => ({ ...current, status: "sending" }));
      }

      const controller = new AbortController();
      requestControllerRef.current = controller;
      const requestBody: {
        sessionId: string;
        message: string;
        caseId?: string;
        contentRefs?: string[];
        retryUserMessageId?: string;
        turnId?: string;
      } = {
        sessionId,
        message,
      };
      if (persistence.mode === "persistent") {
        requestBody.caseId = persistence.caseId;
        if (selectedContentRefs.length > 0) requestBody.contentRefs = selectedContentRefs;
        if (retryUserMessageId) requestBody.retryUserMessageId = retryUserMessageId;
        if (turnAttempt.turnId) requestBody.turnId = turnAttempt.turnId;
      }
      const response = await fetch("/api/conversation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => undefined)) as unknown;
      if (
        !response.ok
        || !payload
        || typeof payload !== "object"
        || !("assistant" in payload)
      ) {
        const failurePayload = payload && typeof payload === "object"
          ? payload as { code?: unknown; message?: unknown; error?: unknown }
          : {};
        const nestedError = failurePayload.error && typeof failurePayload.error === "object"
          ? failurePayload.error as { code?: unknown; message?: unknown }
          : {};
        if (!shouldRetainPendingTurn({ code: failurePayload.code, error: nestedError, status: response.status })) {
          pendingTurnRef.current = undefined;
        }
        const failureMessage = typeof failurePayload.message === "string"
          ? failurePayload.message
          : typeof nestedError.message === "string"
            ? nestedError.message
          : response.status === 499
            ? "本轮已取消，未完成案件更新。"
            : "本轮暂时无法处理";
        const failure = new Error(failureMessage);
        throw failure;
      }
      const responsePayload = payload as ApiResponse;
      pendingTurnRef.current = undefined;
      setState((current) => {
        const withPersistentId =
          localUserMessageId && responsePayload.persistence?.userMessageId
            ? bindPersistedUserMessage(current, localUserMessageId, responsePayload.persistence.userMessageId)
            : current;
          return addAssistantMessage(withPersistentId, {
          id: responsePayload.persistence?.assistantMessageId ?? `assistant-${withPersistentId.messages.length}`,
          content: responsePayload.assistant.message,
          patch: responsePayload.caseDraft ?? responsePayload.assistant.draftPatch,
          assistantState: responsePayload.assistant.state,
          actions: responsePayload.assistant.actions,
        });
      });
      if ("caseVersion" in responsePayload && typeof responsePayload.caseVersion === "number" && Number.isInteger(responsePayload.caseVersion) && responsePayload.caseVersion > 0) {
        setCaseVersion((current) => acceptCaseVersion(current, responsePayload.caseVersion));
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setState((current) => stopGeneration(current));
        return;
      }
      setError(
        caught instanceof PersistenceBootstrapError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "本轮暂时无法处理",
      );
      setState((current) => stopGeneration(current));
    } finally {
      requestControllerRef.current = undefined;
      turnInFlightRef.current = false;
    }
  }

  async function send() {
    await sendMessage(input.trim());
  }

  async function retryLatest() {
    if (state.status === "sending") return;
    const retry = prepareRetry(state);
    if (!retry.content) return;
    const persistence = persistenceRef.current;
    if (persistence?.mode === "persistent" && !retry.messageId) {
      setError("该消息尚未取得可验证的保存编号，请刷新案件后重试。");
      return;
    }
    setState(retry.state);
    await sendMessage(retry.content, {
      appendUser: false,
      ...(persistence?.mode === "persistent" && retry.messageId
        ? { retryUserMessageId: retry.messageId }
        : {}),
    });
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
                    <button type="button" className="message-action" onClick={() => editMessage(message.id)} disabled={state.status === "sending"}>
                      编辑并重新发送
                    </button>
                  ) : null}
                  {message.role === "assistant" && state.messages.at(-1)?.id === message.id && message.id !== "welcome" ? (
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
          inputRef={composerRef}
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
        <MaterialUpload
          caseId={caseId}
          onPendingChange={setPendingMaterials}
          onAiContentRefsChange={setSelectedContentRefs}
          onMaterialSourcesChange={setMaterialSources}
        />
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
            onContinue={() => {
              composerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
              composerRef.current?.focus();
            }}
            materialSources={materialSources}
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
