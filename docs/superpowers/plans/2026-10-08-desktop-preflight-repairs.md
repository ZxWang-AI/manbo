# Desktop preflight repairs implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution stays inline in the existing worktree; the user has authorized work on `main` and pushing fixes.

**Goal:** Repair the approved conversation design's confirmation and Pi transport defects before planning Alpha packaging.

**Architecture:** Keep the outbound payload builder as the authorization boundary. Compare one prepared payload with its preview and deeply freeze it. Use one isolated, in-memory, no-tool Pi session for both text and images; preload only explicitly selected history through SessionManager, and disable implicit extra model calls. Test with real Pi SDK sessions and a controlled provider event stream, not real credentials or cases.

**Tech Stack:** Node >=24, node:test, Electron 44.4.5, Pi coding-agent 0.87.1, npm lockfile.

## Global constraints

- Approved design: `docs/superpowers/specs/2026-09-29-conversation-first-desktop-design.md` (user approved in conversation).
- BYOK only; no Manbo server, bundled Key, arbitrary file/terminal/network tools, or autonomous mode.
- Original evidence remains unchanged. Only approved payload content enters the model; no global Pi auth/settings/project discovery.
- Failure/abort/length/tool-call results are not marked successful. No automatic retry, compaction or cache warming.
- This plan does not claim PDF extraction, DNS boundary checks, context-segment UI, installation, or three-platform verification is complete.

## Task 1: Bind confirmation to one immutable read

**Files:** Modify `app/core/outbound-payload.mjs`; test `app/core/outbound-payload.test.mjs`.

**Interfaces:** `previewOutbound(input)` returns preview metadata; `confirmOutbound(input, {accepted, preview})` returns the frozen payload if and only if the preview matches that same prepared payload.

- [x] Add an independent synthetic-file test whose reader returns changed text on the first confirmation read and old text on the second. Confirmation must reject (`/changed/`), never authorize the first payload based on the second.
- [x] Add a successful-confirmation read-count test (`assert.equal(reads, 1)`) and mutation tests for `messages[0].content[0].text`, nested image URL, and PDF page list (`assert.throws(..., TypeError)`). Avoid the older shared fixture mutated by another test.
- [x] Run `node --test app/core/outbound-payload.test.mjs`; observe the expected failures (three regression tests red).
- [x] Add `deepFreeze(value)` using `Object.values(value)` recursively. Return `deepFreeze({...payload, requestHash: hash(payload)})`. Extract `previewFromPayload(payload)`; use it in preview and confirmation, replacing `await previewOutbound(input)` in confirmation.
- [x] Re-run the targeted tests and `npm test`; commit only task files and this plan after green (8/8 targeted, 48/48 overall).

## Task 2: Repair isolated real Pi transport

**Files:** Modify `app/agent/model-gateway.mjs`, `app/agent/pi-session.mjs`; test `app/agent/model-gateway.test.mjs`, `app/agent/pi-session.test.mjs`; add `app/agent/pi-gateway.integration.test.mjs`.

**Interfaces:** `createNoToolSession({cwd, sdk, modelRuntime, selectedModel, promptContext})` retains `{session, dispose}` and exposes an adapter `prompt()` returning checked assistant text. The gateway's default factory registers the selected model and installs the user's literal Key with `await runtime.setRuntimeApiKey(provider.id, secret)`, never provider configuration or disk auth.

- [x] Use real imported Pi SDK. Temporarily intercept `ModelRuntime.prototype.registerProvider` to supply a controlled `streamSimple` event stream at the provider boundary while preserving registration and session execution.
- [x] Send a payload containing explicit user/assistant history plus current prompt and source-marked text/PDF. Assert captured provider transcript contains those exact texts, correct roles, no tools/cwd/project instructions, and exactly one call. Observe current `Model session is invalid` failure.
- [x] Assert `ModelRuntime.create` receives explicit nonpersistent credentials and no-network/no-refresh/null-model-path settings; registered provider has no `apiKey`; selected runtime credential equals the synthetic literal Key.
- [x] Create an isolated runtime helper with explicit empty nonpersistent CredentialStore. Share one in-memory SettingsManager with resource loader and session: `compaction.enabled=false`, `retry.enabled=false`, `retry.provider.maxRetries=0`, `cacheWarming='off'`, `images.autoResize=false`, telemetry/analytics disabled. Supply a fixed Manbo system prompt and no appended prompt.
- [x] Preload approved history with `sessionManager.appendMessage(...)` (Pi user/assistant message types, timestamps and zero usage for imported assistant text). For the current message, join text parts with `\n\n`, convert data URLs to Pi `{type:'image', mimeType, data}`, and call `session.prompt(text, {images, expandPromptTemplates:false})`.
- [x] Expose adapter `prompt` on the wrapper and get reply using the actual session's final assistant message. Reject error, abort, truncation, tool-call and empty replies. Wire AbortSignal to `session.abort()` with listener cleanup. Change gateway cleanup to tolerate synchronous dispose via `try { await session.dispose(); } catch {}`.
- [x] First add image and cancellation/error regression tests; observe the expected failures, then remove the direct-image fetch path so all content uses Pi. Assert image bytes preserved, unsupported image capability refused, failures not delivered, and no retries.
- [x] Run `node --test app/agent/*.test.mjs` and `npm test`; inspect `git diff --check`; commit after green (19/19 targeted, 60/60 overall; whitespace check passed with line-ending notices). Transport substituting the stream does not constitute real-provider/HTTP validation. Renamed the loopback-only test to avoid implying redirect coverage.

## Task 3: Resolve announced dependency vulnerability

**Files:** Modify `package.json`, `package-lock.json`.

- [x] Run `npm audit --omit=dev --json` and `npm ls brace-expansion`; retain only advisory/package metadata (no secrets). Found `brace-expansion@5.0.9` under Pi/minimatch with one production high finding.
- [ ] Add scoped override `"overrides": {"brace-expansion": "5.0.12"}` using apply_patch, then `npm install` to regenerate the lockfile. Do not use `--force` or upgrade Pi/Electron incidentally.
- [ ] Run `npm ls brace-expansion`, `npm audit --omit=dev`, and `npm test`. Require no production vulnerability finding and the pinned fixed version before committing.

**Blocked checkpoint (2026-10-08):** The override was tried, but `npm install` and `npm update brace-expansion --ignore-scripts` both retained 5.0.9. `npm audit fix --dry-run --ignore-scripts --json` proposed zero changes and still reported the high finding. Pi 0.87.1 ships `npm-shrinkwrap.json` (`hasShrinkwrap: true` in the application lockfile). Removed the ineffective override and incidental lock metadata changes; Pi/Electron pins are unchanged. Stop dependency implementation here pending review of an explicit SDK upgrade or reproducible upstream patch strategy. Do not mark the audit or packaging gate complete. Task 4 may document this failure and deliver the already-approved source push independently.

## Task 4: Report evidence and write the packaging spec

**Files:** Update `docs/testing/2026-10-08-desktop-release-readiness.md` and the current-status paragraph in `README.md`; create `docs/superpowers/specs/2026-10-08-desktop-alpha-release-design.md`.

- [x] Record actual targeted/full-test counts, dependency audit and fixed blockers; keep remaining release blockers explicit. Preserved first-check history and appended repair evidence; README now reports 60/60 with the event-stream and audit limitations.
- [x] Write the agreed three-platform Alpha packaging spec: Windows NSIS x64, macOS DMG x64/arm64, Linux AppImage x64; native GitHub Actions runners; allowlist package contents; no secrets/user data; SHA-256; accurate unsigned/pre-release warnings; manual publish only after required gates.
- [x] Review the written spec for ambiguous scope/claims. Commit and push ordinary `main` updates (`git push origin main`); verify remote HEAD with `git ls-remote origin refs/heads/main`. Commit `e06e78208a68c838b0cd8f54b12570057d796502` was verified against remote main again on 2026-10-08.
- [x] Ask the user to review the new written packaging spec before its implementation plan. The user replied “确认”; the written spec is approved. No Release/tag or installer was created. Task 3 remains blocked pending the separately reviewed dependency strategy.
