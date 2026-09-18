export interface PendingTurnAttempt {
  turnId: string;
  content: string;
  retryUserMessageId?: string;
  contentRefs?: string[];
}

export interface ResolveTurnAttemptInput {
  persistent: boolean;
  content: string;
  retryUserMessageId?: string;
  contentRefs?: string[];
  pending?: PendingTurnAttempt;
}

export interface ResolvedTurnAttempt {
  turnId?: string;
  reuseUserBubble: boolean;
}

export interface ConversationFailure {
  code?: unknown;
  status?: number;
  error?: unknown;
}

const terminalTurnFailureCodes = new Set([
  "INVALID_INPUT",
  "UNAUTHENTICATED",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "TURN_FAILED",
  "TURN_EXPIRED",
  "TURN_ID_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "CANCELLED",
]);

/**
 * Decide whether a failed response can still represent work that the server
 * may have accepted. Ambiguous transport/server failures keep the idempotency
 * key so a later send can safely replay it; explicit terminal responses must
 * release it so the next attempt receives a fresh turn id.
 */
export function shouldRetainPendingTurn(failure: ConversationFailure = {}): boolean {
  const nestedError = failure.error && typeof failure.error === "object"
    ? failure.error as { code?: unknown }
    : {};
  const code = typeof failure.code === "string"
    ? failure.code
    : typeof nestedError.code === "string"
      ? nestedError.code
      : undefined;
  if (code) {
    if (code === "DEGRADED" || code === "TURN_IN_PROGRESS") return true;
    if (terminalTurnFailureCodes.has(code)) return false;
  }

  if (typeof failure.status === "number" && failure.status >= 400 && failure.status < 500) {
    return false;
  }

  return true;
}

function newTurnId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, "0")}`;
}

/**
 * Resolve the stable id for one logical persistent send. A retry after a lost
 * response keeps the same key; edited content and explicit retry operations
 * start a fresh turn so they cannot overwrite the prior response.
 */
export function resolveTurnAttempt(input: ResolveTurnAttemptInput): ResolvedTurnAttempt {
  if (!input.persistent) return { reuseUserBubble: false };
  const normalizeRefs = (refs: readonly string[] | undefined) => [...new Set((refs ?? []).map((ref) => ref.trim()))].sort();
  const sameLogicalAttempt = input.pending
    && input.pending.content === input.content
    && input.pending.retryUserMessageId === input.retryUserMessageId
    && JSON.stringify(normalizeRefs(input.pending.contentRefs)) === JSON.stringify(normalizeRefs(input.contentRefs));
  if (sameLogicalAttempt && input.pending) return { turnId: input.pending.turnId, reuseUserBubble: input.retryUserMessageId === undefined };
  return { turnId: newTurnId(), reuseUserBubble: false };
}
