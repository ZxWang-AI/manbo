import type { CasePatch } from "@/domain/case-record";

export type ChatStatus = "idle" | "sending" | "review";
export type ChatMessageRole = "assistant" | "user";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
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

export function addUserMessage(state: ChatState, content: string): ChatState {
  return {
    ...state,
    messages: [...state.messages, { id: `user-${state.messages.length}`, role: "user", content }],
    status: "sending",
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

export function beginEdit(state: ChatState, messageId: string): ChatActionResult {
  const message = state.messages.find((candidate) => candidate.id === messageId && candidate.role === "user");
  if (!message) return { state, content: "" };
  return { state: { ...state, status: "idle" }, content: message.content };
}

export function prepareRetry(state: ChatState): ChatActionResult {
  const message = [...state.messages].reverse().find((candidate) => candidate.role === "user");
  if (!message) return { state, content: "" };
  return {
    state: {
      ...state,
      messages: [...state.messages, { id: `user-${state.messages.length}`, role: "user", content: message.content }],
      status: "sending",
    },
    content: message.content,
  };
}
