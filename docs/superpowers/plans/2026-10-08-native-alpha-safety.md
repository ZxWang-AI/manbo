# Native Alpha safety validation plan

> **For agentic workers:** Use executing-plans and TDD inline in the approved main worktree. No delegation, public assets, test-only production IPC, or extra agent powers.

**Goal:** Fail closed on unverified image decoding and collect Windows native Electron evidence without touching user data; retain all four installer targets.

**Architecture:** Production attachment reading explicitly refuses image/PDF formats without verified parsers. A test-only entry sets an independently created temporary userData before loading the unchanged real main; main inspector checks isolation/credentials, and agent-browser connects only to that process's renderer CDP.

**Tech Stack:** Fixed Node 24.21.0, existing Electron 44.4.5 and Pi 1.1.0, real Windows safeStorage, agent-browser.

## Constraints

- Only synthetic files/Keys; verify exact isolated userData before any mutation.
- No plaintext backend, TLS bypass, real provider traffic, real user profile, or changes to production preferences to make tests pass.
- Image import remains a local copy; image/PDF send is explicitly unsupported for Alpha. Adapter projection tests are not claims of application format support.
- A development launch is not installed NSIS/DMG/AppImage acceptance. macOS x64/arm64 and Linux x64 remain unverified.

## Task 1: Unverified image boundary

Files: material-safety.test.mjs, evidence-reader.mjs, index.html, README.md, readiness record.

- [x] Add real-file rejection tests for PNG/GIF/JPEG/WebP signature fixtures and a truncated PNG; check source/copied hashes unchanged. Run before production change. These are signature fixtures, not proof of complete image decoding.

```js
await assert.rejects(readEvidenceForOutbound(root, id, item.id), /Image extraction is unsupported/);
assert.equal(createHash('sha256').update(await readFile(source)).digest('hex'), item.sha256);
```

- [x] Remove signature-only acceptance. Return a fixed unsupported error before constructing an outbound image data URL; keep strict text parser and PDF refusal. UI states text formats/2 MiB and disabled image capability for Alpha. Run full tests.

## Task 2: Native Windows evidence

Files: new test-only app/desktop/fixtures/native-entry.cjs and app/desktop/native-probe.mjs; readiness record.

Native review found the existing first-use requirement absent (only a banner). Add privacy-notice/accept-privacy in index.html and renderer startup gating: show before workspace initialization, require explicit acknowledgement, store only a versioned local marker, never hide on unavailable localStorage, prevent Escape dismissal. New renderer behavior tests must fail on the old implementation then pass; notice accurately distinguishes local records, Key encryption, cloud processing/retention, unsupported formats and Alpha limits, with no blanket liability waiver.

- [x] Launch test-only entry in a mkdtemp profile. Main inspector reads app.getPath('userData') and actual window preferences; abort test if not identical to generated profile or existing user data.
- [x] With agent-browser snapshot/interact, verify first-use notice, normal chat without case, provider plaintext name and no Key return, cancel confirmation/receipt invalidation, immutable scope and draft retention; no synthetic Key sent to a real API.
- [x] Main inspector verifies real safeStorage encrypt/decrypt, ciphertext contains no synthetic plaintext, and restart decrypt from the same isolated profile. Native tests cannot substitute for macOS/Linux backends.
- [x] Verify remote navigation/window opening and foreign renderer IPC refusal using real Chromium windows created solely in this profile. Subframes have no app/Node bridge; add CSP `frame-src 'none'` after native data-document navigation bypassed event-only protection, then verify actual CSP violation and blocked document. Subframe sender rejection itself is VM evidence, not an actual native subframe IPC invocation. Hash synthetic original files before/after.
- [x] Test-only module resolution redirects only main.cjs's gateway import to fixtures/native-model-gateway.mjs. That module delegates unchanged real gateway/Pi/transport with trusted test CA and TCP remap; no global fetch/DNS override or production hook. Verify native UI complete request and slow-stream cancellation, single request, exact approved prompt/material/history, no tools, atomic local records and unchanged original hashes. Keep this test boundary explicit; it is not real cloud-provider acceptance.
- [x] Record versions and exact proved behaviors; run full Node regression and diff check; ordinary commit/push with remote SHA receipt. Leave native installer/platform checks unchecked. Source commit `a4c97b187d0cc1f5b62a032912f943f7f21a9fbe` was ordinarily pushed and remote main matched; receipt documentation follows in a separate commit.

### Native review fixes and final verification

- [x] Real Chromium Escape could close the notice despite the cancel handler. Add `closedby="none"` after a failing contract test; native Escape leaves the notice open, explicit acknowledgement initializes the workspace, and the versioned local marker survives restart.
- [x] Confirmation initially showed only filename/size. Tests first failed for absent `attachmentParts` and missing full body; expose the same frozen payload parts and display full text/hash with `textContent`. Native preview and final real-Pi wire body match, including two authorized history messages; malicious HTML remains text.
- [x] Full regression: 184/184, 0 fail/skip, fixed Node 24.21.0; production and complete audits: zero advisories; diff whitespace check passes.
- [x] Final unchanged-profile restart: case has four delivered messages, ordinary conversation has two; synthetic Key decrypts, startup has not loaded the network fixture, accepted notice is retained, and source/copy hashes are unchanged. Only the synthetic Electron process and named browser session were closed (exit 0); no user app was closed.

## Self-review

The test-only global inspector reference is not an application API and must be excluded with all fixtures/native probe files from packages. Never disable Gatekeeper/SmartScreen or claim that source/native development tests are installer acceptance. Packaging follows only after application gates close; four target credentials/installer acceptance still required before public prerelease.

## Handoff boundary

This application-safety plan is complete within its explicit Windows/synthetic scope. Do not mark the four-target release complete. Read-only GitHub checks found Actions enabled, no configured repository secrets, no self-hosted runners, and no releases; hosted runners may build but are not proof of installed credentials/platform acceptance. Target environments and signing/notarization arrangements require user/external coordination. No workflow, public artifact, tag or Release was created.

Only a registry metadata lookup of candidate electron-builder 26.15.3 was performed (MIT, Node >=14); this is not a dependency/lifecycle audit or adoption. Neither manifest, lockfile nor installed dependencies changed. Builder adoption, actual ASAR review and clean packaged runtime validation remain separate implementation work after the missing platform handoff is resolved.
