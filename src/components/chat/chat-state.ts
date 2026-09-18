import type { CasePatch } from "@/domain/case-record";

export type ChatStatus = "idle" | "sending" | "review";
export type ChatMessageRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  persistedMessageId?: string;
  turnId?: string;
  assistantState?: string;
  actions?: string[];
}

export interface ChatState {
  messages: ChatMessage[];
  status: ChatStatus;
  draftPatch?: CasePatch;
}

export interface ChatActionResult {
  state: ChatState;
  content: string;
  messageId?: string;
}

const allowedPatchKeys: ReadonlyArray<keyof CasePatch> = [
  "jurisdiction",
  "facts",
  "timeline",
  "iloIndicators",
  "elements",
  "evidenceCoverage",
  "legalNavigation",
  "referrals",
  "safetyFlags",
  "sourceTrace",
  "consent",
  "lifecycle",
  "aiReviewStatus",
];

function sanitizePatch(input: unknown): CasePatch {
  if (!input || typeof input !== "object") {
    return {};
  }

  const record = input as Record<string, unknown>;
  return Object.fromEntries(
    allowedPatchKeys
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  ) as CasePatch;
}

export function createChatState(): ChatState {
  return {
    messages: [
      {
        id: "welcome",
        role: "assistant",
        content:
          "你可以从愿意分享的部分开始。我会先整理事实和材料缺口，不作法律认定；你可以随时暂停、修改或删除。",
      },
    ],
    status: "idle",
  };
}

export function addUserMessage(
  state: ChatState,
  content: string,
  messageId = `user-${state.messages.length}`,
): ChatState {
  return {
    ...state,
    messages: [...state.messages, { id: messageId, role: "user", content }],
    status: "sending",
  };
}

export function bindPersistedUserMessage(
  state: ChatState,
  localMessageId: string,
  persistedMessageId: string,
): ChatState {
  return {
    ...state,
    messages: state.messages.map((message) =>
      message.id === localMessageId && message.role === "user"
        ? { ...message, persistedMessageId }
        : message,
    ),
  };
}

export function mergeDraftPatch(state: ChatState, patch: unknown): ChatState {
  const sanitized = sanitizePatch(patch);
  return {
    ...state,
    draftPatch: { ...state.draftPatch, ...sanitized },
  };
}

export function addAssistantMessage(
  state: ChatState,
  response: { id: string; content: string; patch?: unknown; assistantState?: string; actions?: string[] },
): ChatState {
  const next = {
    ...state,
    messages: [...state.messages, { id: response.id, role: "assistant" as const, content: response.content, ...(response.assistantState ? { assistantState: response.assistantState } : {}), ...(response.actions ? { actions: response.actions } : {}) }],
    status: response.patch ? ("review" as const) : ("idle" as const),
  };

  return response.patch === undefined ? next : mergeDraftPatch(next, response.patch);
}

export function stopGeneration(state: ChatState): ChatState {
  return { ...state, status: "idle" };
}

/** A replay must never move the local editor back to an older case version. */
export function acceptCaseVersion(
  current: number | undefined,
  incoming: number | undefined,
): number | undefined {
  if (incoming === undefined || !Number.isInteger(incoming) || incoming < 1) return current;
  if (current === undefined || !Number.isInteger(current) || current < 1) return incoming;
  return Math.max(current, incoming);
}

export function beginEdit(state: ChatState, messageId: string): ChatActionResult {
  const message = state.messages.find((candidate) => candidate.id === messageId && candidate.role === "user");
  if (!message) return { state, content: "" };
  return { state: { ...state, status: "idle" }, content: message.content };
}

export function prepareRetry(state: ChatState): ChatActionResult {
  const message = [...state.messages].reverse().find((candidate) => candidate.role === "user");
  if (!message) return { state, content: "" };
  return {
    state: { ...state, status: "sending" },
    content: message.content,
    ...(message.persistedMessageId ? { messageId: message.persistedMessageId } : {}),
  };
}
