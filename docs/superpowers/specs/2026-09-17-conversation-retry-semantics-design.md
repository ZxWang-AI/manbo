# Conversation Retry Semantics Design

**Status:** Approved for implementation on 2026-09-17

## Problem

The conversation UI currently treats **Retry** as a new user submission. It appends a second user bubble in the browser and the persistent API writes a second user message before generating another assistant response. That mutates the apparent history and makes one user statement look like two distinct submissions.

The **Edit** action already preserves the original message by copying its text into the composer, but its label does not make clear that sending the edited text creates a new turn.

## Goals

- Keep every existing user and assistant message immutable and visible.
- Retry the latest user turn without creating another user message in the UI or database.
- Append each successful retry response as a new assistant message version.
- Make the edit action explicit: **编辑并重新发送**.
- Bind persistent retries to an authenticated, private, user-authored message rather than trusting client-supplied text.
- Preserve static preview behavior without pretending that preview messages are durably stored.
- Give each persisted message a case-local monotonic append sequence so latest-message checks and transcript reads do not depend on millisecond timestamps or random UUID ordering.

## Non-goals

- No separate message-version table, branch tree, or assistant-version replacement model. A database migration is required only to introduce the authoritative case-local `messageSequence` ordering described below.
- No deletion or replacement of earlier assistant responses.
- No branching visualization or comparison UI for assistant versions.
- No change to AI legal-analysis behavior, evidence assessment, or case lifecycle rules.
- No attempt in this change to make the whole user-message / AI / case-patch / assistant-message turn atomic or idempotent. Partial writes, transaction boundaries, a turn idempotency key, and an outbox remain a separate reliability design item.

## Domain and UI Model

`ChatMessage.id` remains the browser rendering identity. A user message gains an optional `persistedMessageId`:

```ts
interface ChatMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  persistedMessageId?: string;
}
```

- A newly submitted user message is shown optimistically with a local `id` and no persistent ID.
- A successful persistent response returns the authoritative user message ID. The client attaches it to that user message without changing its content or local rendering ID.
- Restored user messages receive `persistedMessageId` from their stored `messageId`.
- Preview messages never claim a persistent ID.

Persisted `ConversationMessage` rows also carry a positive `messageSequence` that is unique within the `(accountId, caseId)` pair. It is the authoritative append order for transcript reads, latest-user checks, and next-sequence allocation. `createdAt` remains display/audit metadata and `messageId` remains identity; neither is an ordering tie-breaker for current writes.

Every new application write first locks the owning private `case_records` row, reads the greatest current `messageSequence`, and appends with the next value in a `READ COMMITTED` transaction. This serializes ordinary user messages, ordinary assistant responses, and conditional retry responses for the same case.

## Request and Response Contract

`POST /api/conversation` adds one optional request field:

```ts
retryUserMessageId?: string
```

The existing `message` field remains required for preview compatibility and immediate UI behavior.

### Ordinary submission

The request omits `retryUserMessageId`. In persistent mode the server appends one user message and returns:

```json
{
  "persistence": {
    "messageSaved": true,
    "userMessageCreated": true,
    "userMessageId": "stored-message-id",
    "caseUpdated": true
  }
}
```

The client binds `userMessageId` to the optimistic user message. Existing consumers of `messageSaved` remain compatible.

### Retry

In persistent mode the request includes `retryUserMessageId`. The server:

1. resolves the current account from the authenticated session;
2. confirms the private case belongs to that account;
3. loads the message using the combined account ID, case ID, message ID, private/non-deleted case, and `role = user` constraints;
4. confirms by `messageSequence` that it is the latest stored user message in the case;
5. uses the stored message content as the authoritative AI input;
6. does not call the user-message append operation;
7. after a successful non-degraded response, locks the private case and rechecks the latest stored user message inside the same `READ COMMITTED` transaction;
8. allocates the next `messageSequence` and appends the new assistant message while that lock is still held only when the expected user message is still latest.

`READ COMMITTED` is deliberate for this finalization transaction. If it waits for an ordinary user append that already holds the case lock, the latest-user query runs as the next statement with a fresh snapshot and therefore sees the append that just committed. PostgreSQL `REPEATABLE READ`/`SERIALIZABLE` could retain the pre-wait snapshot and miss that row unless the design also adds shared-row writes plus serialization retry handling.

The client-supplied `message` is not authoritative in persistent retry mode. It may differ, but the provider and orchestrator receive the stored content. The response identifies the reused source:

```json
{
  "persistence": {
    "messageSaved": true,
    "userMessageCreated": false,
    "userMessageId": "stored-message-id",
    "caseUpdated": true
  }
}
```

If the retry target is missing, belongs to another account or case, has been deleted with its case, is an assistant message, or is not the latest user message, the server returns the same generic `404 NOT_FOUND` response. It does not resolve selected materials, call the AI provider, or write a user message, assistant message, case patch, or audit event. This uniform response avoids message enumeration. A syntactically invalid retry UUID is rejected as `400 INVALID_INPUT` before authentication or repository access.

If the target passed the initial authorization/latest-user check but another request appends a newer user message before final assistant persistence, the locked final check rejects the retry with `409 VERSION_CONFLICT`. It does not append the stale assistant response after the newer user turn. This final check does not make the whole turn atomic: a case patch may already have been persisted before the conflict is observed, so turn IDs, idempotency, fact deduplication, and a shared finalization transaction/outbox remain separate work.

### Static preview

Preview mode has no durable message identity. Retry leaves the browser history unchanged and calls the preview API with the existing `message` field, without `retryUserMessageId`. The preview API uses that text and creates no persistent record. If the browser believes it is in persistent mode but the selected user message lacks a persistent ID, it stops locally with a refresh/recovery instruction instead of sending an ordinary request that could duplicate the message.

## Frontend Interaction

### Send

Sending composer text creates a new optimistic user message. A successful assistant response is appended. In persistent mode, the returned source ID is attached to the exact optimistic user message created for that request. A synchronous in-flight guard is acquired before persistence bootstrap, so a double click or repeated Enter cannot create concurrent accounts, cases, or first turns while React has not yet rendered the sending state.

Only one conversation request may be in flight, so binding the response to the submitted local user message is deterministic.

### Retry

Retry is displayed only when the final transcript item is a completed assistant response. This prevents an older assistant button from targeting a newer user turn that failed or was cancelled. Retry selects the latest user message, marks the conversation as sending, and keeps the message array unchanged. In persistent mode it sends that message's `persistedMessageId`; in preview mode it sends no retry ID. A successful response appends only the new assistant message. Earlier assistant responses remain visible.

### Edit and resend

The action is labeled and announced as **编辑并重新发送**. It copies the chosen historical user text into the composer and leaves all messages unchanged. When the user sends, the edited text is a new user turn with a new persistent message ID.

## Conversation Context

After resolving or creating the source user message, the server lists the private conversation once in ascending `messageSequence`. `sourceMessageIds` contains each stored message ID at most once, including the selected retry source. The conversation-state progression continues to be based on the count of user messages; a retry does not increase that count.

## Failure Behavior

- Invalid request shape: `400 INVALID_INPUT`.
- Missing or invalid session: `401 UNAUTHENTICATED`.
- Missing case or invalid retry target: generic `404 NOT_FOUND`.
- Case version conflict: `409 VERSION_CONFLICT`.
- Retry source superseded before final assistant persistence: `409 VERSION_CONFLICT`.
- Provider or persistence failure: existing `503 DEGRADED` behavior.
- Client cancellation: existing `499` behavior and cancellation fences.

An ordinary request can currently persist a user message before a later stage fails. If that happens before the response returns its ID, the current UI keeps the local message but cannot safely retry it until the case is reloaded. Solving this partial-turn condition requires the separate atomic/idempotent-turn work named in Non-goals.

## Test Strategy

### Unit tests

- `prepareRetry` returns the latest user content and ID, sets `sending`, and does not change the message array.
- Binding a persistent ID changes only the targeted user message metadata.
- The repository lookup applies account, case, message, private-case, non-deleted, and user-role filters.
- Ordinary persistent submission still appends one user and one assistant message and returns the created user ID.
- Persistent retry performs no user append and calls the provider with stored content.
- A missing, cross-case/cross-owner, or assistant retry target returns 404 with zero AI calls and zero writes.
- Transcript listing and latest-user checks use `messageSequence`, including fixtures where different messages share the same `createdAt` and UUID lexical order conflicts with append order.
- Ordinary and retry assistant persistence lock the private case, allocate the next `messageSequence`, and use `READ COMMITTED`; retry rejects a superseded source with 409 instead of writing the assistant after a newer user turn.
- The migration contract covers deterministic historical backfill, positive/not-null/case-local uniqueness constraints, and the old-writer compatibility trigger.

### Browser tests

- The action label is **编辑并重新发送**.
- Editing and sending creates a new user bubble.
- Retrying sends `retryUserMessageId`, keeps the user-bubble count unchanged, and appends another assistant bubble.
- Persistence bootstrap permits only one first-turn request even under double click or repeated submit events.
- When a newer user turn has no assistant response, an older assistant response exposes no retry action.

### Regression gates

Run targeted Vitest and Playwright tests first, followed serially by TypeScript, ESLint, all unit tests, all Playwright tests, production build, documentation checks, and `git diff --check`.

## Operational Constraint

Migration `202609170010_add_conversation_message_sequence` follows expand-contract. Within one transaction it briefly takes an `ACCESS EXCLUSIVE` lock on `conversation_messages`, adds and deterministically backfills the sequence using `created_at, message_id`, installs an old-writer trigger, and then enforces the column constraints. The deterministic tie-breaker cannot reconstruct the true append order of historical messages that share the same millisecond timestamp; it only produces a stable backfill.

The trigger is a rollout and application-rollback compatibility bridge. When an old application instance omits the new column, the trigger locks the same owning case row and assigns the next sequence; new instances assign it explicitly. Migration must therefore complete before any new instance starts, after which old and new instances may coexist only for the bounded rolling-deployment/rollback window. Migration failure blocks deployment. A later, separately reviewed contract migration may remove the trigger only after all instances have converged on explicit writes, the old-version rollback window has closed, mixed-version/concurrency/restore rehearsals have passed, and auditable evidence shows the old write path is unused. Because the current trigger does not count invocations, it must remain until equivalent evidence or dedicated telemetry exists.

All work remains local. No commit, push, merge, GitHub Actions trigger, or deployment is permitted until the user explicitly resumes Git operations.
