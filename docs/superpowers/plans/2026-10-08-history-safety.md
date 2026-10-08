# Conversation/history safety implementation plan

> **For agentic workers:** Inline executing-plans/TDD in the existing user-approved main worktree. Synthetic fixtures only, no platform or Pi capability expansion.

**Goal:** Persist conversations without lost updates, reject linked/mismatched records, and require authorization for every sensitive history source.

**Architecture:** Reuse checked bounded local JSON I/O and root/file mutation queues. Normalize returned records to known fields; segment provenance conservatively propagates to messages. Legacy records migrate to a separate new file without altering their source. Outbound preview contains actual selected history text/provenance and bounds total request size.

**Tech Stack:** Fixed Node 24.21.0 node:test, current Electron/Pi and lockfile unchanged.

## Global constraints

- 4 MiB conversation JSON, max1024 messages/segments, text <=20000 chars, history <=40 messages, attachments <=16, prompt <=20000 chars, outbound JSON <=2 MiB or smaller Provider maxInputBytes.
- UUID conversation/segment/message IDs; exact file ID match, unique message IDs, strict UTF-8/canonical directories/single-link files. Unknown config fields not returned; original legacy records unchanged.
- A message inherits the entire evidence provenance of its segment. History may be sent only when every inherited source is explicitly selected; no “any evidence enables all history”. Duplicate/unknown context IDs reject, actual history shown in confirmation.
- Legacy migration retains source bytes and stable conversation ID, labels provider legacy-local, conservatively carries all earlier evidence sources forward; invalid legacy records reject, not silently reset/delete.

## Task 1: Safe storage and migration

**Files:** modify app/core/chat-store.mjs, conversations.mjs; new app/core/history-safety.test.mjs; main.cjs uses singleton chat store and migration when opening case conversation.

- [x] Add baseline regression tests: simultaneous append via two stores retains both; unknown apiKey property not returned; filename/id mismatch rejected; evidence segment message cannot be labeled clean by evidenceIds:[]; hardlinks/junction reject. Run and record failures before changes.

```js
await Promise.all([a.append(id, {role:'user',text:'one'}), b.append(id, {role:'user',text:'two'})]);
assert.equal((await a.read(id)).messages.length, 2);
```

- [x] Implement normalized whitelisted validateConversation result, shared mutation queue for startSegment/append, bounded JSON I/O (4 MiB), roots checked before writes/list. Legacy read/append bounded, validated and serialized.
- [x] Implement migrateLegacy(caseId) -> normalized conversation or null if no source; separate target keyed by source id, idempotent; original untouched. Preserve source provider/taint conservatively. Tests real file/restart/idempotence and malformed source, source hash identical.
- [x] Run storage/legacy/full tests; document queues are process-local, no OS hostile-process sandbox or encrypted conversation claim.

## Task 2: History scope and total bounds

**Files:** modify app/core/outbound-payload.mjs; extend history-safety.test.mjs; renderer integration follows request lifecycle plan.

- [x] Add failing context tests where segment e1/e2 but only e1 selected, message claims evidenceIds:[]; duplicate/unknown IDs, prompt>20000, 41history, >16attachments and aggregate UTF-8 JSON bytes exceed capability. Reject before unnecessary material reads. Red evidence qualifications are recorded in readiness; the 17-attachment assertion initially did not execute independently.

```js
await assert.rejects(previewOutbound(inputWithUnselectedSource), /Sensitive context/);
assert.equal(evidenceReads, 0);
```

- [x] Implement context normalization from stored segment/message union, explicit subset check, text/role/delivery validation. Preview adds contextMessages with actual role/text/evidenceIds; hash covers payload+scope/provenance. Limit before material reads where possible, bound aggregate after preparing actual representations.
- [x] Run all tests and diff review; update readiness/README/plan, ordinary commit/push and remote SHA check. No installer/public Release until other application/native gates pass. Source checkpoint fe41bae68ecdf9740027a3496c65b512317038d9 equals remote main.

## Self-review

Storage/history scope only. Request receipt/cancel/UI flow, transport/HTTP/SSE, image decoder and native installation remain separate prerequisites. No unverified old record is automatically sent; reading/migration is local only.

Verification: Node v24.21.0 Windows x64, 107/107 tests, exit 0. Additional red/green covers invalid legacy null/ID/provenance, corrupt migration target preservation, and control-character rejection. UI confirmation display remains in the next plan.
