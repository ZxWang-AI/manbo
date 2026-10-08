# Single-use request lifecycle safety plan

> **For agentic workers:** Inline executing-plans/TDD in the approved main worktree; no new Pi tools or provider capabilities.

**Goal:** Bind confirmation to immutable content and provider credentials, prevent repeat/concurrent requests, and permit timely cancellation without falsely claiming delivery.

**Architecture:** Main-process lifecycle owns expiring one-use preview receipts and captures a prepared payload/provider snapshot. Start consumes a receipt and reserves the conversation synchronously, returning an ID before revalidation/model work; result is a separate narrow IPC. The renderer locks the conversation during preparation/confirmation/request, displays exact historical context as text, retains drafts on uncertain outcomes, and can abort using the early ID. Exchange persistence is one bounded file update.

**Tech Stack:** Existing Node24/Electron/Pi; node:test with real stores, lifecycle callbacks only at external execution boundary; renderer VM DOM double followed by native verification separately.

## Constraints

- Preview expires after 5 minutes; at most 32 receipts, 8 active requests, 64 retained results. No secrets in public preview/errors. Receipt binds all provider config plus hashed Key, payload hash and conversation revision; changed input requires a fresh confirmation.
- One request per conversation. No automatic retry. Cancellation before send produces cancelled; cancellation/transport failure after invoking model or save failure produces unknown. Successful send+single-write save alone produces delivered. Cancellation cannot retract remote bytes.
- Provider snapshot is deeply frozen and used by gateway without rereading mutable settings. Revalidate same draft/content/provider before model work; clear pending receipts and abort on window close.
- Ordinary clean delivered history, up to40 recent messages, may be selected automatically; sensitive history included only when every source is currently selected. Preview displays actual included text and counts excluded history. Malformed stored history is rejected by the store, not hidden.

## Task 1: Lifecycle and atomic exchange

Files: new app/core/request-lifecycle.mjs, request-lifecycle.test.mjs; modify chat-store.mjs, history-safety.test.mjs, main.cjs, preload.cjs, main-boundary.test.mjs.

- [x] Add regressions for missing/forged/repeated/expired receipt, simultaneous same-conversation start, provider Key/endpoint/content/revision drift, early ID cancellation, timeout, disposal, save failure redaction, bounded receipts/results. Run before implementation.

```js
const preview = await lifecycle.preview(input);
const { requestId } = lifecycle.start({ receiptId: preview.receiptId, confirmation: { accepted:true, preview } });
lifecycle.abort(requestId);
assert.equal((await lifecycle.result(requestId)).delivery, 'cancelled');
assert.equal(calls, 0);
```

- [x] Implement createRequestLifecycle({prepare,send,persist,clock,timeoutMs}) with preview/start/result/abort/discard/dispose. Capture JSON input and deep-frozen prepared state; bind SHA256 of provider config/secret+payload+revision; public preview only nonsecret receiver/content fields. Consume synchronously; result always a fixed structured delivery status, never raw model errors.
- [x] Add appendExchange(id,{segment,user,assistant,requestId}) storing segment and both delivered messages in one validated JSON write; real-file failure leaves no half exchange.
- [x] Replace main send-v2 with start/result handlers, retain narrow preload method names and add waitChat/discardChatPreview. Main singleton lifecycle closes with window; tests run actual main VM handlers for forging/reuse/drift/cancel.

## Task 2: Renderer confirmation and cancellation

Files: renderer.js, index.html, new renderer-behavior.test.mjs; update existing source contract tests only for real new interfaces.

- [x] Write behavior tests executing actual renderer: malicious provider name/model cannot use HTML sink; double click starts once; active conversation captured/locked; actual context displayed; cancel promptly invokes abort; draft preserved on unknown/error. Demonstrate failures on old renderer.
- [x] Use textContent for all dynamic confirmation fields. Add cancel-request button; disable navigation/configuration/scope controls while busy, lock before first await. Choose only fully authorized delivered historical records, show included texts and omitted count. Confirmation cancel/Escape discards receipt; prevent close while acceptance in flight.
- [x] Catch all UI async listeners with fixed errors, preserve draft on nondelivered result; no automatic retry. Disable cancellation after result begins local refresh. Run focused/full tests, review diff, update README/readiness, ordinary commit/push with remote SHA check (separate receipt below).

## Self-review

This plan closes application request/UI boundaries only. Deadline adds cancellation but transport must enforce its own wire/DNS/redirect/size contract. Native Electron, OS credentials, real HTTP/SSE and four installers remain separate evidence; no public artifacts before gates close.


- [x] Ordinary commit/push and remote SHA verification: `0031005c1872bf001858f5fca6dbdf6ef5d5ecde`, normal push to origin/main; this is a source receipt, not a release receipt.
