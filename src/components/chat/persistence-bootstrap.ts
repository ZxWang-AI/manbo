import type { CaseDraft } from "@/domain/case-record";

export type PersistenceBootstrapResult =
  | { mode: "preview" }
  | {
      mode: "persistent";
      caseId: string;
      alias: string;
      recoverySecret: string;
      /** Current optimistic-concurrency version when returned by the API. */
      version?: number;
    };

export type PersistenceBootstrapErrorCode =
  | "ACCOUNT_CREATE_FAILED"
  | "CASE_CREATE_FAILED"
  | "INVALID_RESPONSE";

export class PersistenceBootstrapError extends Error {
  constructor(
    public readonly code: PersistenceBootstrapErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PersistenceBootstrapError";
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Establishes a private account and draft case before the first message is sent.
 * The recovery secret is returned to the caller exactly once and is never persisted here.
 */
export async function bootstrapPersistence(
  fetcher: Fetcher,
  draft: CaseDraft,
): Promise<PersistenceBootstrapResult> {
  let accountResponse: Response;
  try {
    accountResponse = await fetcher("/api/accounts", { method: "POST" });
  } catch {
    return { mode: "preview" };
  }

  if (accountResponse.status === 503) {
    return { mode: "preview" };
  }
  if (!accountResponse.ok) {
    throw new PersistenceBootstrapError("ACCOUNT_CREATE_FAILED", "账户初始化失败，请稍后重试。");
  }

  const accountPayload = await readJson(accountResponse);
  if (
    !accountPayload ||
    typeof accountPayload !== "object" ||
    !nonEmptyString((accountPayload as Record<string, unknown>).alias) ||
    !nonEmptyString((accountPayload as Record<string, unknown>).recoverySecret)
  ) {
    throw new PersistenceBootstrapError("INVALID_RESPONSE", "账户服务返回的数据不完整。");
  }
  const alias = (accountPayload as { alias: string }).alias;
  const recoverySecret = (accountPayload as { recoverySecret: string }).recoverySecret;

  let caseResponse: Response;
  try {
    caseResponse = await fetcher("/api/cases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draft }),
    });
  } catch {
    throw new PersistenceBootstrapError("CASE_CREATE_FAILED", "私密案件初始化失败，请稍后重试。");
  }
  if (!caseResponse.ok) {
    throw new PersistenceBootstrapError("CASE_CREATE_FAILED", "私密案件初始化失败，请稍后重试。");
  }

  const casePayload = await readJson(caseResponse);
  const caseId =
    casePayload && typeof casePayload === "object"
      ? (casePayload as { case?: { caseId?: unknown } }).case?.caseId
      : undefined;
  if (!nonEmptyString(caseId)) {
    throw new PersistenceBootstrapError("INVALID_RESPONSE", "案件服务返回的数据不完整。");
  }

  const rawVersion =
    casePayload && typeof casePayload === "object"
      ? (casePayload as { case?: { version?: unknown } }).case?.version
      : undefined;
  if (rawVersion !== undefined && (!Number.isInteger(rawVersion) || (rawVersion as number) < 1)) {
    throw new PersistenceBootstrapError("INVALID_RESPONSE", "案件服务返回的数据不完整。");
  }

  return {
    mode: "persistent",
    caseId,
    alias,
    recoverySecret,
    ...(rawVersion === undefined ? {} : { version: rawVersion as number }),
  };
}
