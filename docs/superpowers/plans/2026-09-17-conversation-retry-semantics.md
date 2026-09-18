# Conversation Retry Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make conversation history immutable so retry reuses one authenticated stored user message and appends only a new assistant response, while edit is explicitly presented as a new submission.

**Architecture:** The browser keeps local render IDs separate from optional persistent message IDs. The persistent API resolves a retry target through an owner/case/role-scoped repository query and uses stored content as the only trusted retry input; preview mode retains text-only behavior without claiming persistence.

**Tech Stack:** Next.js 16.3.3 App Router route handlers, React 19.2.8, TypeScript 5.9.3, Prisma 6.19.3, Zod 4.5.4, Vitest 4.1.11, Playwright 1.62.1.

## Global Constraints

- Existing user and assistant messages are immutable and remain visible.
- A retry never appends a user message in browser state or persistent storage.
- A successful retry appends a new assistant message.
- A synchronous in-flight guard is acquired before persistence bootstrap so only one first turn can start.
- Persistent retry authorization is bound to account ID, case ID, message ID, private/non-deleted case, and user role.
- Persistent retry accepts only a syntactically valid UUID that identifies the latest stored user message.
- Persistent retry uses stored content, never client-supplied retry text, as AI input.
- Static preview retries remain non-persistent and do not send a persistent retry ID.
- Editing retains history and creates a new user turn when sent; its copy is **编辑并重新发送**.
- The whole-turn transaction/idempotency/outbox problem is documented but excluded from this change.
- Tests and build run serially; Docker is not used.
- No commit, push, merge, GitHub Actions trigger, or deployment until the user explicitly resumes Git operations.

---

### Task 1: Lock immutable retry behavior in the chat state

**Files:**
- Modify: `tests/unit/chat-state.test.ts`
- Modify: `src/components/chat/chat-state.ts`

**Interfaces:**
- Produces: `ChatMessage.persistedMessageId?: string`
- Produces: `prepareRetry(state): ChatActionResult`, whose result preserves `state.messages` and exposes the selected message ID.
- Produces: `bindPersistedUserMessage(state, localMessageId, persistedMessageId): ChatState`.

- [ ] **Step 1: Write failing state tests**

Change the retry assertion to require the original message array length and identity, and add a binding assertion:

```ts
expect(result.messageId).toBe("stored-user-id");
expect(result.state.messages).toEqual(state.messages);
expect(result.state.status).toBe("sending");

const bound = bindPersistedUserMessage(state, "user-1", "stored-user-id");
expect(bound.messages[1]).toMatchObject({
  id: "user-1",
  content: "上一轮描述",
  persistedMessageId: "stored-user-id",
});
```

- [ ] **Step 2: Run the state test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/chat-state.test.ts`

Expected: FAIL because retry still appends a duplicate and the binding interface does not exist.

- [ ] **Step 3: Implement the minimal state model**

Add `persistedMessageId?: string`, add `messageId?: string` to `ChatActionResult`, make `prepareRetry` preserve the messages while setting `sending`, and implement immutable metadata binding only for the matching user message.

- [ ] **Step 4: Run the state test and verify GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/chat-state.test.ts`

Expected: all tests in the file pass.

### Task 2: Add the owner-scoped stored user-message lookup

**Files:**
- Modify: `tests/unit/message-repository.test.ts`
- Modify: `src/server/repositories/message-repository.ts`

**Interfaces:**
- Produces: `PrismaMessageRepository.findPrivateUser(accountId: string, caseId: string, messageId: string)` returning the stored row or `null`.

- [ ] **Step 1: Write the failing repository test**

Use a mocked `conversationMessage.findFirst` and assert the exact security boundary:

```ts
expect(findFirst).toHaveBeenCalledWith({
  where: {
    accountId: "account-a",
    caseId: "case-a",
    messageId: "message-a",
    role: "user",
    case: {
      is: {
        accountId: "account-a",
        caseId: "case-a",
        visibility: "private",
        deletedAt: null,
      },
    },
  },
});
```

- [ ] **Step 2: Run the repository test and verify RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/message-repository.test.ts`

Expected: FAIL because `findPrivateUser` does not exist.

- [ ] **Step 3: Implement the scoped query**

Implement `findPrivateUser` with `conversationMessage.findFirst` and all filters shown in Step 1. Do not fall back to message ID alone.

- [ ] **Step 4: Run the repository test and verify GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/message-repository.test.ts`

Expected: all tests in the file pass.

### Task 3: Enforce retry semantics in the conversation API

**Files:**
- Modify: `tests/unit/conversation-persistence-route.test.ts`
- Modify: `tests/unit/conversation-route.test.ts`
- Modify: `tests/unit/material-context-contract.test.ts`
- Modify: `src/app/api/conversation/route.ts`

**Interfaces:**
- Consumes: `messages.findPrivateUser(accountId, caseId, messageId)` from Task 2.
- Produces: request field `retryUserMessageId?: string`.
- Produces: response fields `persistence.userMessageId: string` and `persistence.userMessageCreated: boolean`.

- [ ] **Step 1: Add failing success-path API tests**

Add one ordinary-send assertion for the returned ID, then a retry test whose client `message` deliberately differs from stored content:

```ts
expect(append).not.toHaveBeenCalled();
expect(providerFactory).toHaveBeenCalledWith("stored-user-id", "数据库中的原文");
expect(appendAssistant).toHaveBeenCalledOnce();
await expect(response.json()).resolves.toMatchObject({
  persistence: {
    messageSaved: true,
    userMessageCreated: false,
    userMessageId: "stored-user-id",
  },
});
```

- [ ] **Step 2: Add failing invalid-target API tests**

Make `findPrivateUser` return `null` for missing, foreign, and assistant targets (the repository query intentionally makes them indistinguishable), and assert for each response:

```ts
expect(response.status).toBe(404);
expect(append).not.toHaveBeenCalled();
expect(appendAssistant).not.toHaveBeenCalled();
expect(updatePrivate).not.toHaveBeenCalled();
expect(providerFactory).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run the route tests and verify RED**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/conversation-persistence-route.test.ts tests/unit/conversation-route.test.ts tests/unit/material-context-contract.test.ts`

Expected: FAIL because the schema rejects `retryUserMessageId`, the lookup is unused, and the response omits the source ID.

- [ ] **Step 4: Implement request validation and source resolution**

Extend the strict Zod schema with `retryUserMessageId`. Before invoking material resolution or the provider, resolve either:

```ts
const userMessage = retryUserMessageId
  ? await options.messages.findPrivateUser(owner.accountId, record.caseId, retryUserMessageId)
  : await options.messages.append(
      owner.accountId,
      record.caseId,
      { role: "user", content: parsed.data.message },
      randomUUID(),
    );
```

Return generic `404 NOT_FOUND` when the retry lookup returns `null` or the target is not the latest stored user message. Perform this check before resolving material refs. Reject malformed retry UUIDs as `400 INVALID_INPUT`. Use `userMessage.content` for provider construction and `handleMessage`. Deduplicate `sourceMessageIds`, preserve the existing cancellation fences, and return `userMessageId` plus `userMessageCreated`.

- [ ] **Step 5: Update typed mocks for the required lookup interface**

Add `findPrivateUser: vi.fn()` or an async equivalent to existing persistent-message repository mocks in the listed route tests. Keep non-retry behavior unchanged.

- [ ] **Step 6: Run the route tests and verify GREEN**

Run: `node node_modules/vitest/vitest.mjs run tests/unit/conversation-persistence-route.test.ts tests/unit/conversation-route.test.ts tests/unit/material-context-contract.test.ts`

Expected: all selected tests pass.

### Task 4: Wire persistent IDs and immutable retry into the React conversation

**Files:**
- Modify: `tests/unit/conversation-resume.test.ts`
- Modify: `tests/e2e/chat-controls.spec.ts`
- Modify: `src/components/chat/conversation-resume.ts`
- Modify: `src/components/chat/conversation.tsx`

**Interfaces:**
- Consumes: `bindPersistedUserMessage` and `ChatMessage.persistedMessageId` from Task 1.
- Consumes: `persistence.userMessageId` and `persistence.userMessageCreated` from Task 3.
- Produces: persistent retry request `{ retryUserMessageId }` and edit action copy **编辑并重新发送**.

- [ ] **Step 1: Write the failing resume mapping test**

Assert that every restored user message carries its stored identity while assistant messages do not need retry metadata:

```ts
expect(result.messages[0]).toMatchObject({
  id: "stored-user-id",
  persistedMessageId: "stored-user-id",
  role: "user",
});
```

- [ ] **Step 2: Write the failing browser contract**

Make mocked successful persistent responses return the submitted user's stored ID. Assert that the edit button is named **编辑并重新发送**, the third request has `retryUserMessageId`, the user bubble count is unchanged by retry, and the assistant bubble count increases by one. Add a delayed persistence-bootstrap test that double-clicks send and observes only one account, case, and conversation request. Add a failed-latest-turn test that verifies an older assistant exposes no retry action.

- [ ] **Step 3: Run focused tests and verify RED**

Run in order:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/conversation-resume.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/chat-controls.spec.ts --project=chromium
```

Expected: the unit mapping and browser contract fail for the new metadata/payload/copy assertions.

- [ ] **Step 4: Implement resume identity mapping**

Map stored user messages to `{ id, role, content, persistedMessageId: id }`; keep assistant mapping unchanged.

- [ ] **Step 5: Implement request-to-message binding**

Have ordinary send capture its optimistic local user ID. After a persistent success, bind `payload.persistence.userMessageId` to that exact message. Extend the response type so this parsing is type-safe.

- [ ] **Step 6: Implement retry and edit behavior**

Acquire a synchronous ref guard before the first bootstrap await and release it in `finally`. Retry changes state to `sending` without appending a user message. Persistent mode requires and sends `retryUserMessageId`; preview mode omits it. Render retry only when the assistant is the final transcript message. Change visible text to **编辑并重新发送** so its accessible name and visible copy cannot drift.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run in order:

```powershell
node node_modules/vitest/vitest.mjs run tests/unit/chat-state.test.ts tests/unit/conversation-resume.test.ts
node node_modules/@playwright/test/cli.js test tests/e2e/chat-controls.spec.ts --project=chromium
```

Expected: all selected tests pass.

### Task 5: Record the operational behavior and run regression gates

**Files:**
- Modify: `docs/operations-runbook.md`
- Modify: `docs/risk-register.md`
- Modify: `docs/release-gates.md`

**Interfaces:**
- Produces: operator-facing retry verification and a separate atomic-turn reliability risk.

- [ ] **Step 1: Update operational documentation**

Document that a persistent retry reuses an authenticated user message, produces a new assistant record, and must not increase the stored user-message count. Add the unresolved partial-turn/idempotency/outbox risk without describing it as fixed.

- [ ] **Step 2: Run static verification serially**

Run in order:

```powershell
pnpm typecheck
pnpm lint
pnpm test
```

Expected: TypeScript succeeds, ESLint reports zero warnings/errors, and all Vitest tests pass.

- [ ] **Step 3: Run browser and production-build verification serially**

Run in order:

```powershell
pnpm test:e2e
pnpm build
```

Expected: all Playwright tests pass and Next.js completes a production build.

- [ ] **Step 4: Run documentation and diff checks**

Run the repository's existing documentation-governance checks discovered in `docs/release-gates.md`, then run:

```powershell
git diff --check
git status --short
```

Expected: governance checks pass, `git diff --check` prints nothing, and status shows only local uncommitted work.

- [ ] **Step 5: Preserve the local-only handoff**

Do not run `git add`, `git commit`, `git push`, `gh`, merge commands, GitHub Actions commands, or deployment commands. Report local evidence separately from production readiness. Commit steps are intentionally withheld until the user explicitly resumes Git operations.

### Task 6: Close the cross-request retry ordering race

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/202609170010_add_conversation_message_sequence/migration.sql`
- Create: `tests/unit/conversation-message-sequence-migration-contract.test.ts`
- Modify: `tests/unit/message-repository.test.ts`
- Modify: `tests/unit/persistence-races.test.ts`
- Modify: `tests/unit/conversation-persistence-route.test.ts`
- Modify: `tests/integration/case-repository.test.ts`
- Modify: `src/server/repositories/message-repository.ts`
- Modify: `src/app/api/conversation/route.ts`

**Interfaces:**
- Produces: `RetrySourceSuperseded`.
- Produces: `appendAssistantForLatestUser(accountId, caseId, expectedUserMessageId, content, messageId?)`.
- Produces: `409 VERSION_CONFLICT` when a retry source becomes stale after AI processing but before assistant persistence.
- Produces: positive case-local `messageSequence` ordering for every persisted conversation message.
- Produces: an expand-contract compatibility trigger for older application instances that omit `message_sequence` during rollout or application rollback.

- [x] **Step 1: Add failing repository and interleaving tests**

Require the repository to acquire the same private-case row lock used by ordinary user appends, query the latest user inside that transaction by `messageSequence DESC`, and avoid assistant creation when the expected ID is no longer latest. The interleaving test must start a new user append first, hold its locked transaction open, then start retry finalization and prove that finalization observes the newly committed user after acquiring the lock. Add the inverse lock ordering and a same-timestamp case whose UUID lexical order conflicts with append order.

- [x] **Step 2: Verify repository RED**

The three new assertions failed because `appendAssistantForLatestUser` did not exist; the pre-existing assertions remained green.

- [x] **Step 3: Implement locked conditional assistant persistence**

Add the dedicated error and a `READ COMMITTED` transaction containing `lockPrivateCase`, the `messageSequence` latest-user lookup, expected-ID comparison, next-sequence allocation, and assistant create. `READ COMMITTED` is required so a transaction that waited for a concurrent user append obtains a fresh snapshot for the subsequent latest-user query. Ordinary user and assistant appends must use the same case lock and sequence allocation rule.

- [x] **Step 4: Verify repository GREEN**

The repository and interleaving test files pass together.

- [x] **Step 5: Add failing route tests**

Require persistent retry to call the conditional method with the stored user ID while ordinary send continues to call `appendAssistant`. Require `RetrySourceSuperseded` to return `409 VERSION_CONFLICT`.

- [x] **Step 6: Implement route wiring and verify focused GREEN**

Route retry finalization uses `appendAssistantForLatestUser`; ordinary sends are unchanged. Typed mocks include the new method, and the focused route/repository/material-context suite passes.

- [x] **Step 7: Repeat all regression gates**

The current post-sequence tree completed the static, unit, browser, production-build, documentation-governance, policy-scan, knowledge-index, dependency-audit, and diff checks. All 10 migrations and the real lock interleaving, same-timestamp, and mixed old/new writer cases passed in isolated PostgreSQL 17. Exact counts are recorded below and in the operations runbook. The controlled rolling-deployment/application-rollback rehearsal remains an operational release gate, and this work still does not make the case patch and assistant write one atomic turn.

### Task 7: Validate and operate the sequence expand-contract migration

**Files:**
- Modify: `docs/deployment.md`
- Modify: `docs/operations-runbook.md`
- Modify: `docs/release-gates.md`
- Modify: `docs/risk-register.md`
- Modify: `docs/superpowers/specs/2026-09-17-conversation-retry-semantics-design.md`

- [x] **Step 1: Define the compatibility migration contract**

The migration adds `message_sequence`, deterministically backfills by `created_at, message_id`, installs a `BEFORE INSERT` trigger for old writers before enforcing `NOT NULL`, and adds positive and case-local uniqueness constraints. Document explicitly that historical messages sharing the same millisecond cannot have their true order reconstructed.

- [x] **Step 2: Keep old and new writers on one serialization lock**

The compatibility trigger locks the owning private `case_records` row before assigning `MAX(message_sequence) + 1`. New application writers use the same parent-row lock and explicitly assign their sequence. This is the compatibility bridge for a bounded rolling deployment or application rollback; it is not permission for indefinite mixed-version operation.

- [x] **Step 3: Rehearse all 10 migrations on real PostgreSQL**

PostgreSQL 17 applied all 10 migrations in an isolated local cluster. The focused `case-repository` suite passed 1 file/13 tests and the complete integration suite passed 4 files/20 tests, covering same-timestamp deterministic reads, an old raw insert that omits `message_sequence` racing a new explicit repository write, and both retry/new-user lock orderings. The cluster ran on `127.0.0.1:55433` with explicit `MANBO_TEST_DATABASE_PORT=55433` because a local security proxy occupied 55432; every other destructive-test guard remained unchanged. The temporary cluster was stopped and removed. This closes local schema/execution evidence, but production-scale lock duration and the rolling-deployment/application-rollback rehearsal remain open. Migration failure, cancellation, timeout, or unverifiable constraints must still stop deployment.

- [ ] **Step 4: Rehearse rolling deployment and application rollback**

Verify the required order `migration -> new instances`, a bounded old/new coexistence window after migration, and rollback from the new application to the old application without reversing the schema. Do not automatically drop the sequence column, trigger, or backfilled data during application rollback.

- [ ] **Step 5: Establish the trigger-removal gate**

Keep the trigger through the old-version rollback window. Remove it only through a later reviewed contract migration after fleet/version convergence, mixed-version/concurrency/restore rehearsals, and auditable evidence that no old writer remains. The current trigger has no invocation counter, so add equivalent release evidence or dedicated telemetry before removal.

- [x] **Step 6: Repeat every regression and governance gate**

Node 22.14.0 + pnpm 11.24.0 completed TypeScript, ESLint (zero warnings), Vitest (85 files/411 tests), PostgreSQL 17 with all 10 migrations (4 files/20 integration tests; focused case suite 1 file/13 tests), Playwright (26/26), Next.js 16.3.3 production build, AI quality (2 files/12 tests), documentation governance (1 file/2 tests), knowledge index (26 documents), high-severity dependency audit (no known vulnerabilities), the allowlisted policy scan (11 defensive/negative-test files and no unexpected match), and `git diff --check`. Earlier 9-migration/count records remain historical evidence only.
