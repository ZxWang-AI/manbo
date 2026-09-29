# Conversation-First Desktop and BYOK Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Manbo desktop surface as a Codex-like conversation workspace that supports ordinary questions, explicit evidence scope, and user-configured model APIs without a Manbo-hosted key.

**Architecture:** Keep Electron’s main process as the only owner of local files, credentials, outbound HTTP, and Pi sessions. Add a conversation store that separates ordinary chats from case chats, an outbound payload builder that turns explicitly selected evidence into auditable text/image parts, and a broker that validates a frozen confirmation snapshot before invoking a no-tool Pi session with the user’s provider. The renderer receives redacted provider status and conversation data only, and presents the selected B layout with a permanent evidence rail.

**Tech Stack:** Electron 44, Node.js ESM/CommonJS boundary, `@earendil-works/pi-coding-agent` 0.87.1, native `fetch`, Node test runner, vanilla HTML/CSS/JavaScript.

## Global Constraints

- User-supplied API keys only; remove the local demo provider from the real-send path and never ship a shared Manbo key or default relay.
- Importing a file never uploads it; only an explicit outbound send can leave the device.
- Original evidence copies remain immutable; parsing, OCR, and derived prompts use memory or new derived files only.
- Renderer code never receives raw keys, filesystem paths, arbitrary IPC, or direct network access.
- First real cloud send for a clean conversation segment requires an explicit preview; same-provider, same-scope plain-text follow-ups may continue without a modal. Adding evidence, changing provider, or reusing sensitive history starts a new confirmation.
- The preview and actual request must be generated from the same frozen snapshot; a changed prompt, provider, attachment, hash, or context invalidates confirmation.
- Text and extractable PDF are supported in the first pass; images require the provider capability flag; unsupported, encrypted, empty, or oversized inputs are rejected before upload.
- Pi runs with no built-in tools, no extensions, no skills, no prompt templates, no context files, and no resource discovery. File/terminal/network tool access is not enabled by this plan.
- Custom endpoints must be HTTPS, must not resolve to loopback, link-local, private, or unspecified addresses, must not follow cross-origin redirects, and must not leak the key in logs.
- All tests use synthetic cases and provider fakes; no real personal evidence or production credentials.
- Run `npm test`, `git diff --check`, and an Electron smoke test before handing off each milestone.

---

### Task 1: Add a conversation store with clean and evidence-scoped segments

**Files:**
- Create: `app/core/chat-store.mjs`
- Create: `app/core/chat-store.test.mjs`
- Modify: `app/core/conversations.mjs`
- Modify: `app/core/conversations.test.mjs`

**Interfaces:**
- `createChatStore(root)` returns `{ create, list, read, append, startSegment }`.
- `create({ caseId?: string|null, title?: string })` returns a persisted conversation object `{ id, caseId, title, createdAt, updatedAt, activeSegmentId, segments, messages }`.
- `list()` returns newest-first redacted conversation summaries `{ id, caseId, title, updatedAt, messageCount, hasEvidence }`.
- `read(id)` returns the complete local conversation after validating its UUID and JSON shape.
- `append(id, { role, text, evidenceIds = [], segmentId, providerId, delivery })` writes an atomic append and returns the immutable message entry.
- `startSegment(id, { sensitivity: 'clean'|'evidence', providerId, evidenceIds })` creates a new segment and returns its immutable `{ id, sensitivity, providerId, evidenceIds }` snapshot.
- Existing `createConversation(root, caseId)`, `readConversation(root, caseId)`, and `appendMessage(root, caseId, message)` remain as compatibility wrappers for legacy case files and continue to pass current tests.

- [ ] **Step 1: Write failing tests for standalone and case conversations**

Add tests that create a temporary root, call `createChatStore(root).create({ caseId: null, title: '普通问题' })`, append a clean user/assistant pair, reload it, and assert the API key string and absolute paths never occur in JSON. Add a case chat test with `evidenceIds: ['e1']`, assert `hasEvidence === true`, and assert a later clean segment has an empty evidence ID list. Add a test that `startSegment` rejects an unknown sensitivity, duplicate evidence IDs, or a segment provider mismatch.

```js
test('stores ordinary and evidence segments separately', async () => {
  const store = createChatStore(root);
  const chat = await store.create({ title: '普通问题' });
  const clean = await store.startSegment(chat.id, { sensitivity: 'clean', providerId: 'custom', evidenceIds: [] });
  await store.append(chat.id, { role: 'user', text: '什么是时间线？', segmentId: clean.id, providerId: 'custom' });
  const evidence = await store.startSegment(chat.id, { sensitivity: 'evidence', providerId: 'custom', evidenceIds: ['e1'] });
  await store.append(chat.id, { role: 'assistant', text: '待核对摘要', segmentId: evidence.id, providerId: 'custom', evidenceIds: ['e1'] });
  const saved = await store.read(chat.id);
  assert.equal(saved.segments[0].sensitivity, 'clean');
  assert.deepEqual(saved.segments[1].evidenceIds, ['e1']);
  assert.equal(JSON.stringify(saved).includes('sk-test-secret'), false);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run `node --test app/core/chat-store.test.mjs app/core/conversations.test.mjs`.

Expected: the new test fails because `app/core/chat-store.mjs` and the segment API do not exist; existing legacy tests remain the baseline.

- [ ] **Step 3: Implement atomic storage and compatibility wrappers**

Use `<root>/conversations/<conversation-id>.json` for new chats and keep legacy `<root>/<case-id>/conversation.json` readable. Validate UUIDs, roles, text length (20,000 characters), provider IDs, and unique evidence IDs. Write through a random temporary file with mode `0600`, then rename it. Store only IDs, hashes, and delivery status; never accept a `secret`, `endpoint`, `path`, or raw attachment content field.

- [ ] **Step 4: Run focused and full tests**

Run `node --test app/core/chat-store.test.mjs app/core/conversations.test.mjs` and then `npm test`.

Expected: all focused tests and the existing suite pass.

- [ ] **Step 5: Commit the storage boundary**

```bash
git add app/core/chat-store.mjs app/core/chat-store.test.mjs app/core/conversations.mjs app/core/conversations.test.mjs
git commit -m "feat: add ordinary and scoped conversation storage"
```

---

### Task 2: Build auditable evidence payloads and confirmation snapshots

**Files:**
- Create: `app/core/outbound-payload.mjs`
- Create: `app/core/outbound-payload.test.mjs`
- Modify: `app/core/send.mjs`
- Modify: `app/core/send.test.mjs`
- Modify: `app/core/scope.mjs`
- Modify: `app/core/scope.test.mjs`

**Interfaces:**
- `prepareOutbound({ caseManifest, conversation, draft, readEvidence, capabilities, maxBytes })` returns a frozen `{ providerId, model, prompt, messages, attachments, scope, requestHash }` payload. `messages` contains only text parts and approved image parts; `attachments` contains `{ evidenceId, name, kind, representation, sha256, bytes, pages? }` summaries.
- `previewOutbound(input)` returns a frozen redacted preview that contains no attachment bytes, API key, filesystem path, or full extracted text.
- `confirmOutbound(input, { accepted, preview })` returns `{ requestId, authorization, payload }` only when the new preview is byte-for-byte equal to the provided preview.
- `canReadEvidence(authorization, evidenceId)` remains the single scope predicate and must still reject unknown IDs.

- [ ] **Step 1: Write failing tests for no-attachment questions and content forms**

Cover these cases: a clean prompt with `selectedEvidenceIds: []` is valid; task mode no longer rejects empty attachments; an explicitly selected UTF-8 text file becomes a text part; a PDF fixture with extractable text produces page numbers and no original PDF bytes; an image is rejected when `capabilities.images` is false and accepted as a data URL when true; an encrypted/empty/oversized file is rejected; a changed prompt or evidence hash invalidates confirmation; autonomous mode remains rejected with `Pi tools are not enabled in this build`.

```js
test('ordinary questions can be prepared without evidence', async () => {
  const preview = await previewOutbound({ caseManifest, conversation, draft: {
    mode: 'task', provider: 'custom', model: 'model-1', prompt: '如何区分事实和推测？', selectedEvidenceIds: []
  }, readEvidence, capabilities: { images: false } });
  assert.deepEqual(preview.attachments, []);
  assert.equal(preview.scope.evidenceIds.length, 0);
});
```

- [ ] **Step 2: Run the focused tests and verify the old empty-scope behavior fails**

Run `node --test app/core/outbound-payload.test.mjs app/core/send.test.mjs app/core/scope.test.mjs`.

Expected: the new ordinary-chat test fails against the current “task mode requires selected evidence” validation.

- [ ] **Step 3: Implement representation-specific preparation**

Read only the selected case evidence through an injected `readEvidence(evidenceId)` function. For `.txt`, `.md`, `.csv`, `.json`, and other explicitly text-like extensions, decode UTF-8 with a strict size limit and include a source marker. For PDF, use a small local parser boundary that returns `{ pages: [{ page, text }] }`; keep parser output in memory or a derived file and reject no-text/encrypted PDFs. For images, create a data URL only after the capability flag and byte limit pass. Never include `storedName` or an absolute path in the model message.

- [ ] **Step 4: Relax only the evidence cardinality rule and preserve authorization checks**

Change `normalizeDraft` and `createAuthorization` so `task` mode accepts `[]`, while duplicate and unknown IDs remain errors. Autonomous mode must not silently become usable; return a dedicated error before reading the manifest. Freeze the selected IDs and request hash so the IPC layer cannot mutate the confirmed scope.

- [ ] **Step 5: Run focused and full tests**

Run `node --test app/core/outbound-payload.test.mjs app/core/send.test.mjs app/core/scope.test.mjs` and `npm test`.

Expected: ordinary no-attachment sends pass; all original-scope safety tests pass; autonomous and unsupported-file tests fail safely.

- [ ] **Step 6: Commit the outbound boundary**

```bash
git add app/core/outbound-payload.mjs app/core/outbound-payload.test.mjs app/core/send.mjs app/core/send.test.mjs app/core/scope.mjs app/core/scope.test.mjs
git commit -m "feat: prepare scoped evidence payloads and empty chat tasks"
```

---

### Task 3: Add a user-configured model gateway backed by a no-tool Pi session

**Files:**
- Create: `app/agent/model-gateway.mjs`
- Create: `app/agent/model-gateway.test.mjs`
- Modify: `app/agent/pi-session.mjs`
- Modify: `app/agent/pi-session.test.mjs`
- Modify: `app/core/providers.mjs`
- Modify: `app/core/providers.test.mjs`

**Interfaces:**
- `createNoToolSession({ cwd, sdk, model, promptContext })` keeps its current no-tool/resource-free behavior and optionally selects the injected model; it must expose `prompt(text)` and `dispose()` only to the gateway.
- `createModelGateway({ providerStore, sessionFactory = createNoToolSession, fetchImpl = fetch, now })` returns `{ send({ providerId, model, authorization, payload, signal }) }`.
- `send` validates the frozen authorization and payload, obtains the secret through `readProvider`, invokes only the selected provider, and returns `{ providerId, model, text, delivered: true, createdAt }` without persisting the key or request body.
- Provider public status becomes `{ id, name, kind, model, endpoint, hasKey, capabilities }`; the local demo remains available only as an offline UI fixture and is not accepted by the real gateway.

- [ ] **Step 1: Write failing gateway tests with injected fakes**

Test that the gateway rejects `local-demo`, missing keys, expired/mismatched authorization, unapproved evidence IDs, HTTP redirects, private endpoints, and provider capability mismatches. Test that a fake Pi session receives only the prepared prompt and approved parts, that `dispose()` runs on success and error, and that returned objects do not contain `secret`, `endpoint`, or request body fields. Test a fake `fetchImpl` for non-2xx, timeout, and malformed JSON responses.

```js
test('gateway sends only the frozen approved payload', async () => {
  const calls = [];
  const gateway = createModelGateway({ providerStore, sessionFactory: async ({ promptContext }) => ({
    async prompt(text) { calls.push({ text, promptContext }); return '模型回答'; },
    async dispose() { calls.push({ disposed: true }); },
  }) });
  const result = await gateway.send({ providerId: 'custom', model: 'm1', authorization, payload, signal: undefined });
  assert.equal(result.text, '模型回答');
  assert.equal('secret' in result, false);
  assert.equal(calls.at(-1).disposed, true);
});
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run `node --test app/agent/model-gateway.test.mjs app/agent/pi-session.test.mjs app/core/providers.test.mjs`.

Expected: the gateway module and capability fields are missing.

- [ ] **Step 3: Implement provider capability and endpoint validation**

Extend provider normalization with a finite capability object (`images`, `maxInputBytes`, `api: 'openai-chat-completions'`). Parse URLs with `new URL`, require `https:`, reject localhost, loopback, private IPv4 ranges, IPv6 loopback/link-local/ULA, and wildcard hosts, and use a fetch wrapper with `redirect: 'error'`. Keep raw credentials accessible only inside the main-process gateway call.

- [ ] **Step 4: Implement the Pi adapter with explicit no-tool resources**

Reuse `DefaultResourceLoader` overrides from `pi-session.mjs`: `noExtensions`, `noSkills`, `noPromptTemplates`, `noThemes`, `noContextFiles`, empty extension/skill/prompt arrays, `SessionManager.inMemory()`, `SettingsManager.inMemory()`, `noTools: 'all'`, and `tools: []`. Pass a model runtime/model only through the injected gateway boundary. Do not load project instructions or environment credentials. If the installed Pi SDK cannot accept the custom model without global credential discovery, fail with a clear “此 Provider 暂不支持安全直连” error rather than falling back to the default runtime.

- [ ] **Step 5: Implement lifecycle and error translation**

Create one short-lived session per request, pass an `AbortSignal`, dispose in a `finally` block, map timeout/abort/non-2xx/malformed responses to redacted user-facing error codes, and record only `{ providerId, model, requestId, status, createdAt }` in local task state. Do not retry automatically after an uncertain delivery result.

- [ ] **Step 6: Run focused and full tests**

Run `node --test app/agent/model-gateway.test.mjs app/agent/pi-session.test.mjs app/core/providers.test.mjs` and `npm test`.

Expected: all gateway safety tests pass; the real provider path is covered by fakes and no network is attempted by the test suite.

- [ ] **Step 7: Commit the BYOK gateway**

```bash
git add app/agent/model-gateway.mjs app/agent/model-gateway.test.mjs app/agent/pi-session.mjs app/agent/pi-session.test.mjs app/core/providers.mjs app/core/providers.test.mjs
git commit -m "feat: add user-configured no-tool model gateway"
```

---

### Task 4: Wire main-process IPC and preserve secret/file boundaries

**Files:**
- Modify: `app/desktop/main.cjs`
- Modify: `app/desktop/preload.cjs`
- Modify: `app/desktop/shell.test.mjs`
- Create: `app/desktop/ipc-contract.test.mjs`

**Interfaces:**
- IPC additions: `chat:list`, `chat:create`, `chat:load`, `chat:preview`, `chat:send`, and `chat:abort`.
- `chat:preview` accepts `{ conversationId, caseId, draft }` and returns only the redacted preview.
- `chat:send` accepts `{ conversationId, caseId, draft, confirmation }`, re-reads the case and provider in the main process, verifies the confirmation, calls the gateway, and appends user/assistant messages with segment metadata.
- `preload.cjs` exposes only `listConversations`, `createConversation`, `loadConversation`, `previewChat`, `sendChat`, `abortChat`, and the existing redacted provider methods.

- [ ] **Step 1: Write failing IPC contract tests**

Assert that preload source contains only the named invoke channels; no `shell`, `execute`, `process.env`, raw path, or key API is exposed. Assert that main handlers reject renderer-supplied evidence content, provider secrets, arbitrary conversation paths, mismatched case IDs, and confirmation snapshots whose request hash changed. Assert that a normal chat can use `caseId: null` and `selectedEvidenceIds: []`.

- [ ] **Step 2: Run the contract tests and verify they fail**

Run `node --test app/desktop/ipc-contract.test.mjs app/desktop/shell.test.mjs`.

Expected: the new channels and empty-case behavior are absent.

- [ ] **Step 3: Add main-process handlers**

Instantiate the chat store, outbound builder, provider store, and gateway only in the main process. For `chat:preview`, derive evidence from `vaultRoot()` and return a redacted preview. For `chat:send`, require `{ accepted: true, preview }`, re-create the payload, compare the request hash, call the gateway, then append messages. For ordinary chats, omit `caseId` and keep evidence IDs empty. Track one `AbortController` per request ID and delete it on completion.

- [ ] **Step 4: Narrow the preload bridge**

Expose structured functions that validate primitive arguments before invoking IPC. Do not expose `ipcRenderer`, `fetch`, `safeStorage`, paths, or a generic `invoke(channel, ...args)` helper. Keep `saveProvider` accepting the secret only as a call argument that never returns it.

- [ ] **Step 5: Run all tests and commit the IPC layer**

Run `npm test` and `git diff --check`.

```bash
git add app/desktop/main.cjs app/desktop/preload.cjs app/desktop/shell.test.mjs app/desktop/ipc-contract.test.mjs
git commit -m "feat: expose scoped chat IPC without renderer secrets"
```

---

### Task 5: Replace the form-first renderer with the B conversation workspace

**Files:**
- Modify: `app/desktop/index.html`
- Modify: `app/desktop/renderer.js`
- Modify: `app/desktop/shell.test.mjs`
- Create: `app/desktop/renderer.test.mjs`

**Interfaces:**
- Renderer state tracks `{ activeConversation, activeCase, selectedEvidenceIds, providers, pendingPreview, authorizationState }`.
- UI elements use stable IDs: `conversation-list`, `case-list`, `message-stream`, `composer`, `composer-input`, `attachment-chips`, `evidence-rail`, `provider-badge`, `scope-badge`, `send`, `confirmation`, `settings-dialog`.
- Renderer never reads files or constructs request payloads; it sends only IDs and text to the preload bridge.

- [ ] **Step 1: Write failing DOM/source tests for B layout and ordinary send**

Extend shell tests to require the left navigation, central message stream, permanent evidence rail, fixed composer, provider badge, and a no-attachment send path. Add a renderer test harness with a stubbed `window.manbo` that creates a standalone chat, types `你好`, clicks send, confirms the first provider disclosure, and asserts `previewChat` received `selectedEvidenceIds: []`.

- [ ] **Step 2: Run focused UI tests and verify they fail**

Run `node --test app/desktop/shell.test.mjs app/desktop/renderer.test.mjs`.

Expected: the current two-column form and evidence-required send logic fail the selectors and ordinary-chat assertion.

- [ ] **Step 3: Implement the B layout and responsive rail**

Make the page a three-column grid: a compact left navigation, a central scrollable message stream, and a right evidence rail. On widths below 980px, collapse the rail behind a button while keeping the central composer full width. Keep the first-use data-boundary notice concise and visible; move detailed model/provider configuration into the settings dialog.

- [ ] **Step 4: Implement renderer state transitions**

Add ordinary-chat creation and listing, case selection without automatic attachment selection, chips for selected evidence, provider readiness states, clean/evidence scope labels, confirmation rendering with actual representation summaries, abort state, and redacted failure messages. The send button is enabled for a non-empty prompt with a configured provider even when the attachment list is empty. After confirmation, update the stream from the main-process response and clear only the prompt/chips required by the completed scope.

- [ ] **Step 5: Mark demo and unavailable capabilities accurately**

If the local demo remains in the settings list for offline UI testing, label it “本地模拟（不具备通用知识，不发送材料）” and disable it for real sends. Display Pi file/terminal/network tools as unavailable pending three-platform isolation validation; do not render an enabled autonomous control.

- [ ] **Step 6: Run UI tests, full tests, and commit**

Run `node --test app/desktop/shell.test.mjs app/desktop/renderer.test.mjs`, `npm test`, and `git diff --check`.

```bash
git add app/desktop/index.html app/desktop/renderer.js app/desktop/shell.test.mjs app/desktop/renderer.test.mjs
git commit -m "feat: redesign desktop as conversation-first evidence workspace"
```

---

### Task 6: Electron smoke test, security copy, and handoff checks

**Files:**
- Modify: `README.md`
- Modify: `docs/release-gates.md`
- Modify: `knowledge-base/06-communication/disclaimers.md`
- Create: `app/desktop/smoke-test.mjs`

- [ ] **Step 1: Add synthetic smoke fixtures and assertions**

Create a temporary app-data root and synthetic text/PDF/image fixtures. Launch Electron with the existing smoke harness, create a standalone chat, answer a no-attachment question through a fake provider, create a case, import a synthetic file, select it, verify the confirmation lists its representation, send, reload, and verify messages remain. Assert the original fixture hash is unchanged and no provider secret appears in app-data JSON or logs.

- [ ] **Step 2: Update user-facing boundaries**

Update README and disclaimers to say: Manbo stores cases locally; import does not upload; user-configured providers may process sent content under their own policies; Manbo does not provide a shared key or guarantee server-side deletion at a model supplier; Manbo does not submit reports or make legal findings. Remove any sentence that says all information is processed locally or that the page has no information-protection responsibility.

- [ ] **Step 3: Run the complete verification set**

Run, in order:

```bash
npm test
git diff --check
node app/desktop/smoke-test.mjs
```

Expected: all Node tests pass, diff check is clean, Electron smoke test passes with synthetic data, and no network call occurs unless the test explicitly uses the injected fake provider.

- [ ] **Step 4: Commit verification and documentation**

```bash
git add README.md docs/release-gates.md knowledge-base/06-communication/disclaimers.md app/desktop/smoke-test.mjs
git commit -m "test: verify conversation-first local boundaries"
```

- [ ] **Step 5: Review platform gate status**

Record Windows validation results and mark macOS/Linux as unverified unless their isolated Pi/file/terminal tests actually run. Do not claim autonomous Pi tools are production-ready based on the UI smoke test.

## Plan Self-Review

- **Spec coverage:** B layout is Task 5; ordinary and case chats are Task 1; evidence representation and frozen confirmation are Task 2; BYOK and no-tool Pi are Task 3; main-process-only secrets and IPC are Task 4; failures and copy are Tasks 3, 5, and 6; three-platform Pi gates are explicitly left as release validation in Tasks 3 and 6.
- **Placeholder scan:** no incomplete implementation directives remain; each task gives file paths, interfaces, test commands, and expected results.
- **Type consistency:** `previewOutbound`/`confirmOutbound` produce the payload and request hash consumed by `chat:preview`/`chat:send`; `createChatStore` owns the conversation IDs consumed by the preload bridge; `createModelGateway` consumes the provider store and frozen payload produced by Task 2.
- **Scope check:** the plan keeps one integrated desktop milestone but separates storage, payload authorization, model gateway, IPC, renderer, and verification into independently testable commits.
