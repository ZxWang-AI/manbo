# Conversation Turn Idempotency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PostgreSQL-backed conversation-turn ledger that makes persistent conversation retries idempotent and finalizes case updates, revisions, audit events, and assistant messages atomically.

**Architecture:** A client-generated UUID `turnId` is reserved under a fixed case→turn lock order. The AI call runs outside a database transaction; its schema-validated, privacy-bounded result is stored as `result_ready`. A short `READ COMMITTED` finalization transaction then applies the case patch, revision, audit event, assistant message, and completed response snapshot together. Existing preview mode remains stateless and historical messages remain readable.

**Tech Stack:** Next.js 16.3.3, TypeScript 5.9, Prisma 6.19, PostgreSQL 17, Zod 4, Vitest 4, Playwright 1.62.

## Global Constraints

- No commit, push, merge, GitHub Actions, remote Git operation, deployment, or Docker use.
- Persistent requests require a client UUID `turnId`; preview/static requests do not persist a turn.
- The canonical fingerprint excludes session ID and request ID, and includes operation, case, source user, normalized authoritative message, normalized content refs, and reserved base version.
- Lock order is always `case row → turn row`; transaction isolation is `READ COMMITTED`.
- Historical `conversation_messages.turn_id` stays nullable; migration 11 must be expand/contract compatible with the current sequence trigger.
- No raw narrative, source quote, material plaintext, token, cookie, IP, or device data may enter turn snapshots or audit metadata.
- Production code is written only after a failing test has been observed for that behavior.

---

### Task 1: Canonical turn identity and bounded snapshots

**Files:**
- Create: `src/server/services/conversation-turn-contract.ts`
- Create: `tests/unit/conversation-turn-contract.test.ts`
- Modify: `src/ai/provider.ts` only if a narrow exported snapshot type is required

**Interfaces:**
- `type TurnOperation = "send" | "retry"`
- `interface TurnRequestIdentity { operation: TurnOperation; caseId: string; sourceUserMessageId?: string; message: string; contentRefs: string[]; baseCaseVersion: number }`
- `function canonicalizeTurnIdentity(input: TurnRequestIdentity): string`
- `function hashTurnIdentity(input: TurnRequestIdentity): string`
- `const turnResultSnapshotSchema` and `const turnResponseSnapshotSchema`

- [ ] **Step 1: Write the failing tests**

Add tests for Unicode NFC/trim normalization, content-ref dedupe+sort, exclusion of session/request IDs, meaningful retry/source/version differences, deterministic SHA-256, bounded assistant/draft/degraded snapshot parsing, and rejection of raw material/source-quote fields.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `pnpm exec vitest run tests/unit/conversation-turn-contract.test.ts`

Expected: FAIL because the contract module and schemas do not exist.

- [ ] **Step 3: Implement the minimal contract module**

Use `crypto.createHash("sha256")`, `String.normalize("NFC").trim()`, a sorted unique `contentRefs` copy, and Zod strict objects. The response snapshot must contain only assistant turn fields, optional case version, persistence IDs/booleans, status code, and safe error code/message; never accept arbitrary JSON.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/conversation-turn-contract.test.ts`

Expected: all contract tests pass with no warnings.

- [ ] **Step 5: Refactor only after GREEN**

Keep canonicalization pure and provider-independent; rerun the same test command.

### Task 2: Prisma model and migration 11

**Files:**
- Modify: `prisma/schema.prisma` (`ConversationMessage`, new `ConversationTurn`, enums)
- Create: `prisma/migrations/202609180011_add_conversation_turn_ledger/migration.sql`
- Create: `tests/unit/conversation-turn-migration-contract.test.ts`
- Modify: `tests/setup/integration.ts` to truncate `conversation_turns` before messages/cases

**Interfaces:**
- Prisma model `ConversationTurn` with `turnId`, account/case scope, operation/status, source/user IDs, base version, request hash, JSON snapshots, assistant ID, case version, attempts/lease, and timestamps.
- `ConversationMessage.turnId String? @map("turn_id") @db.Uuid`.

- [ ] **Step 1: Write migration contract tests**

Read the migration file as text and assert it creates the turn table, status/operation checks or enums, account+case+turn uniqueness, nullable `turn_id`, partial unique `(turn_id, role)` index, ownership FKs/indexes, bounded JSON columns, and does not backfill invented turn IDs or drop the sequence trigger.

- [ ] **Step 2: Run migration contract tests and verify RED**

Run: `pnpm exec vitest run tests/unit/conversation-turn-migration-contract.test.ts`

Expected: FAIL because migration 11 and schema model are absent.

- [ ] **Step 3: Add Prisma schema and SQL migration**

Use an expand/contract migration: create enum/table and indexes, add nullable `turn_id`, add a composite foreign key that prevents cross-account/case association, and add a partial unique index for non-null turn/role. Preserve historical NULLs and the existing message-sequence trigger. Set lock/statement timeouts as in migration 10.

- [ ] **Step 4: Generate Prisma and run the contract tests**

Run: `pnpm prisma generate; pnpm exec vitest run tests/unit/conversation-turn-migration-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Verify migration on isolated PostgreSQL**

Run the repository’s guarded integration setup with `MANBO_TEST_DATABASE_PORT=55433`, apply all migrations, and query the new constraints. Do not use port 5432 or a non-test database.

### Task 3: Turn repository reserve/result/replay primitives

**Files:**
- Create: `src/server/repositories/conversation-turn-repository.ts`
- Create: `tests/unit/conversation-turn-repository.test.ts`
- Modify: `src/server/repositories/message-repository.ts` with transaction-scoped append helpers

**Interfaces:**
- `reserveTurn(input): Promise<ReserveTurnResult>` returning `owner | replay | in_flight | idempotency_conflict | version_conflict`.
- `recordTurnResult(turnId, requestHash, resultSnapshot, responseDraft): Promise<TurnRecord>`.
- `getTurnForOwner(accountId, caseId, turnId): Promise<TurnRecord | null>`.
- `appendUserInTransaction(transaction, input)` and `appendAssistantInTransaction(transaction, input)`.

- [ ] **Step 1: Write RED unit tests**

Cover first-owner-only reservation, same-hash completed replay without provider, processing 202 state, hash mismatch 409 with no material/provider call, account/case isolation, ordinary send user creation in the reserve transaction, and retry binding without a second user.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm exec vitest run tests/unit/conversation-turn-repository.test.ts`

Expected: FAIL because the repository and transaction helpers are absent.

- [ ] **Step 3: Implement reserve and result recording**

Use Prisma interactive transactions with `READ COMMITTED`, `lockPrivateCase`, unique-create conflict handling, and explicit status transitions. All lookup queries must include account/case ownership and private, non-deleted case predicates.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/conversation-turn-repository.test.ts tests/unit/message-repository.test.ts`

Expected: PASS; existing sequence tests remain green.

### Task 4: Atomic finalizer and PostgreSQL rollback/concurrency proof

**Files:**
- Create: `src/server/services/conversation-turn-finalizer.ts`
- Create: `tests/unit/conversation-turn-finalizer.test.ts`
- Create: `tests/integration/conversation-turn.test.ts`
- Modify: `src/server/repositories/case-repository.ts` to expose transaction-scoped patch/revision/audit helpers
- Modify: `src/server/audit.ts` to support the bounded turn audit metadata/action

**Interfaces:**
- `finalizeTurn(input: { accountId; caseId; turnId; requestHash }): Promise<FinalizeTurnResult>`.
- `applyPrivatePatchInTransaction(transaction, accountId, caseId, patch, expectedVersion, turnId)`.
- `appendCaseRevisionInTransaction(transaction, row)` and `appendTurnAuditInTransaction(transaction, ...)`.

- [ ] **Step 1: Write unit RED tests**

Assert finalizer performs case patch, revision, bounded audit, assistant insert, and turn completion as one transaction; completed/conflict turns replay; stale latest user/base version marks conflict without assistant; injected failure at each write leaves no partial mock state.

- [ ] **Step 2: Run unit tests and verify RED**

Run: `pnpm exec vitest run tests/unit/conversation-turn-finalizer.test.ts`

Expected: FAIL because finalizer does not exist.

- [ ] **Step 3: Implement one transaction with fixed lock order**

Do not call `updatePrivate`, `appendAssistant`, or `recordAudit` from inside the finalizer because those methods open independent transactions. Reuse validated data helpers against the supplied transaction client. Store a stable assistant UUID and response snapshot before returning.

- [ ] **Step 4: Run unit tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/conversation-turn-finalizer.test.ts tests/unit/case-history.test.ts tests/unit/message-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Add PostgreSQL integration RED cases, then run them**

Use two Prisma connections and the existing advisory-lock pause helper. Assert concurrent same-key reserve/finalize yields one turn/assistant, distinct turns serialize message sequences, and failures injected in case update/revision/audit/assistant roll back case version, revisions, audit, and assistant together. Run: `MANBO_TEST_DATABASE_PORT=55433 pnpm test:integration -- tests/integration/conversation-turn.test.ts`.

- [ ] **Step 6: Make integration tests GREEN and verify no deadlock**

Run the focused integration file, then the existing case/message integration suites. Expected: all pass; no orphan turn or duplicate sequence.

### Task 5: Persistent conversation route lifecycle

**Files:**
- Modify: `src/app/api/conversation/route.ts`
- Modify: `tests/unit/conversation-persistence-route.test.ts`
- Modify: `tests/unit/conversation-route.test.ts`, `tests/unit/material-context-contract.test.ts`

**Interfaces:**
- Request schema adds required persistent `turnId: z.uuid()` while preserving preview behavior.
- Handler options gain a `turns` dependency with reserve/record/finalize methods; default wiring uses Prisma repositories.

- [ ] **Step 1: Add route RED tests**

Test missing/invalid turn ID, same-key byte-identical completed replay without material/provider/writes, processing 202, hash mismatch 409 before material resolution, retry replay with one user and one assistant, provider result persistence before finalization, degraded response replay, and cancellation after commit replay.

- [ ] **Step 2: Run the route tests and verify RED**

Run: `pnpm exec vitest run tests/unit/conversation-persistence-route.test.ts tests/unit/conversation-route.test.ts tests/unit/material-context-contract.test.ts`

Expected: FAIL on new turn contract assertions while existing preview tests continue to identify compatibility gaps.

- [ ] **Step 3: Implement route orchestration**

For persistent requests: authenticate and load the case, reserve turn (creating user atomically for send), return replay/in-flight/conflict immediately, resolve materials and call AI only for the owner, record validated result snapshot, then call finalizer. Remove independent `updatePrivate`, `appendAssistant*`, and out-of-transaction model-fallback audit calls from this path. Keep preview path unchanged except for shared validation helpers.

- [ ] **Step 4: Run focused route tests and fix all strict fixtures**

Run the command from Step 2 plus `pnpm exec vitest run tests/unit/conversation-bootstrap-route.test.ts`. Expected: PASS with no warning.

### Task 6: Bootstrap, recovery, and frontend stable turn IDs

**Files:**
- Modify: `src/app/api/cases/[caseId]/conversation/route.ts`
- Modify: `src/components/chat/conversation-resume.ts`, `src/components/chat/resume-conversation.tsx`
- Modify: `src/components/chat/conversation.tsx`, `src/components/chat/chat-state.ts`
- Modify: `tests/unit/conversation-bootstrap-route.test.ts`, `tests/unit/conversation-resume.test.ts`, `tests/unit/chat-state.test.ts`
- Modify: `tests/e2e/chat-controls.spec.ts`, `tests/e2e/saved-case-recovery.spec.ts`, `tests/e2e/conversation-persistence.spec.ts`

**Interfaces:**
- Persistent `ChatMessage` may carry `turnId`/`persistedMessageId`; preview messages do not.
- Bootstrap payload returns safe turn status summaries and message `turnId` values, never request hash or raw snapshot internals.

- [x] **Step 1: Write UI RED tests**

Assert each new persistent send creates one UUID, ambiguous network failure/`DEGRADED`/`TURN_IN_PROGRESS` retry reuses it, explicit terminal `TURN_FAILED`/`TURN_EXPIRED`/`INVALID_INPUT`/`CANCELLED` starts a new turn, duplicate clicks do not create another user bubble, retry uses a new turn ID bound to the same source, completed replay restores one assistant, and 409 idempotency conflict is not shown as saved. Assert bootstrap excludes system messages and sensitive turn fields.

- [x] **Step 2: Run focused UI tests and verify RED**

Run: `pnpm exec vitest run tests/unit/chat-state.test.ts tests/unit/conversation-resume.test.ts tests/unit/conversation-bootstrap-route.test.ts`; then run the three focused Playwright specs.

Expected: FAIL on turn ID and recovery assertions.

- [x] **Step 3: Implement stable-key state and recovery**

Store the active turn in a ref keyed by logical send; retain it through ambiguous network errors, `DEGRADED`, and `TURN_IN_PROGRESS`; release it for explicit terminal `TURN_FAILED`, `TURN_EXPIRED`, `INVALID_INPUT`, `CANCELLED`, and authorization/conflict responses. Generate a new key for edited messages and explicit retry. On bootstrap, render a safe pending/recoverable status and never generate a fresh user message for an existing turn.

- [x] **Step 4: Run focused tests and verify GREEN**

Run the commands in Step 2. Expected: unit and Playwright tests pass, with user avatar right and assistant avatar left unchanged.

### Task 7: Privacy, risk, operations, and documentation

**Files:**
- Modify: `tests/unit/privacy-controls.test.ts` or create it if absent
- Modify: `docs/risk-register.md`
- Modify: `docs/deployment.md`
- Modify: `docs/operations-runbook.md`
- Modify: `docs/release-gates.md`
- Modify: `docs/superpowers/specs/2026-09-18-conversation-turn-idempotency-design.md` only for verified implementation deviations

- [ ] **Step 1: Write privacy RED tests**

Assert turn audit metadata accepts only status/version/count/hash fields and rejects message/rawNarrative/sourceQuote/materialText/token/request ID plaintext; assert snapshots are bounded and no sensitive fields are logged.

- [ ] **Step 2: Run privacy tests and verify RED**

Run: `pnpm exec vitest run tests/unit/privacy-controls.test.ts`

Expected: FAIL until the turn audit contract is wired.

- [ ] **Step 3: Implement docs and controls**

Document migration 11 rollout/rollback, result-ready recovery, `TURN_IN_PROGRESS`, stale turn cleanup, metrics, no-AI-repeat guarantee boundaries, and the remaining facts/timeline dedupe risk. Keep R-22 release-blocking until all evidence exists.

- [ ] **Step 4: Run governance tests**

Run: `pnpm exec vitest run tests/unit/privacy-controls.test.ts tests/unit/documentation-governance.test.ts` and `pnpm knowledge:index`.

Expected: PASS and the knowledge index includes the new spec/plan.

### Task 8: Full local verification (no remote actions)

**Files:** none beyond fixes required by failing verification.

- [ ] **Step 1: Run static checks**

Run: `pnpm typecheck; pnpm lint; pnpm exec vitest run`.

Expected: typecheck, ESLint with zero warnings, and all unit tests pass.

- [ ] **Step 2: Run guarded PostgreSQL integration**

Start only the isolated PostgreSQL 17 test service on port 55433 using the existing project harness, apply all migrations, run `pnpm test:integration`, then stop and remove the temporary test service/data directory. Never use production `DATABASE_URL` or port 5432.

- [ ] **Step 3: Run browser and build checks**

Run: `pnpm test:e2e; pnpm build; pnpm test:ai-quality; pnpm audit --audit-level=high`.

Expected: all pass; any environment-only failure is recorded with the exact command and does not trigger remote deployment.

- [ ] **Step 4: Review diff and status without committing**

Run: `git diff --check; git status --short --branch`. Preserve all pre-existing user changes, do not stage or commit, and report changed files and test evidence to the user.
