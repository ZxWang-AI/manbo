# IPC and credentials safety implementation plan

> **For agentic workers:** Use executing-plans inline in the existing linked main worktree (explicit user authorization). Use TDD; do not waive native backend/platform acceptance.

**Goal:** Reject non-app IPC before local side effects and never persist a Key using an unavailable/plaintext backend.

**Architecture:** One guarded IPC registration path trusts only the live app main frame and exact local document. A singleton credential adapter serializes read/modify/write, validates bounded encrypted records and uses checked local directories. Provider metadata mutations are separately serialized and bounded.

**Tech Stack:** Node 24.21.0/node:test, Electron 44.4.5 safeStorage; Pi 1.1.0 unchanged.

## Global constraints

- Existing local-first worktree/main only; synthetic Keys/material, preserve backups; no new tools or network capability.
- Trust event.sender === live window.webContents, event.senderFrame === its mainFrame, exact pathToFileURL(index.html).href; reject missing/destroyed/foreign frames.
- Block navigation/redirects/window.open/webview/downloads and all renderer permission requests/checks. CSP already denies renderer network.
- Deny credentials if !isEncryptionAvailable(), and Linux getSelectedStorageBackend() is missing or basic_text; no plaintext fallback. This does not encrypt cases/messages.
- Credentials max 64 records, each Key 8192 chars, store/config JSON 1 MiB; canonical single-link regular files, strict UTF-8, safe UUID temporary write+rename mode 0600. No raw error payloads returned from IPC.

## Task 1: Guard real main registrations

**Files:** new app/desktop/main-boundary.test.mjs; modify app/desktop/main.cjs; existing contract tests remain.

- [x] Write Node VM tests executing actual main source with Electron interface doubles (native boundary only), real temporary disk: foreign sender/subframe/remote URL/missing frame rejected by every registered handler; no import dialog opened; valid main frame can create/list cases.

```js
await assert.rejects(handlers.get('case:create')({ sender: foreign, senderFrame: frame }), /Untrusted IPC/);
assert.equal((await handlers.get('case:list')(trusted)).length, 0);
```

- [x] Run `node --test app/desktop/main-boundary.test.mjs`; old implementation must fail with missing rejection, not invalid fixture behavior.
- [x] Implement guard registration and window policies. Wrap internal failures in a fixed safe message; no error.message passthrough. Test navigation/permission/window policy callbacks, stale window, valid create/list and error redaction.

```js
function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event);
    try { return await operation(event, ...args); }
    catch { throw new Error('操作未完成，请检查输入或本地配置；详细供应商错误不会展示。'); }
  });
}
```

- [x] Run target/full tests and diff check; VM is main behavior evidence but not Chromium/native Electron security acceptance.

## Task 2: Credentials and metadata

The shared app/core/local-json.mjs provides bounded canonical JSON read/write (1 MiB) and root/file-scoped process-local serialization used by both stores; atomic writes use UUID temp names. Linux backend allowlist is gnome_libsecret/kwallet/kwallet5/kwallet6. Windows tests use native doubles, not OS acceptance.

**Files:** new app/core/secret-store.mjs and secret-store.test.mjs; modify app/core/providers.mjs/providers.test.mjs and main.cjs.

**Interfaces:** createSafeSecretStore({root,safeStorage,platform=process.platform}) -> {get,set,delete}; main providerSettings() becomes async and caches a single secret store. Public provider response contains hasKey only.

- [x] Before production changes, add behavior regressions using actual current main provider save and provider metadata concurrent writes; Linux basic_text save must reject and create no secret file; concurrent distinct providers must both survive.

```js
await Promise.all(['first','second'].map(id => saveProvider(settings, config(id), 'synthetic')));
assert.equal((await listProviders(settings)).length, 3);
```

- [x] Run and observe baseline failures. Add focused new-module tests for unavailable/basic_text backend, available synthetic encryption roundtrip, concurrent mutations/restart, malformed/base64/oversize/hardlink/junction storage, backend switch rejection; test actual disk records but do not claim mock encryption proves OS protection.
- [x] Implement checked secret store, serial queue per resolved root shared across instances; prevent prototype IDs; sanitize decryption errors. Provider read bounded/strict/canonical, whitelist normalization, max64 configs, randomUUID temporary, serialize saves/deletes per root and restrict Key length; reject malformed metadata rather than silent empty fallback.
- [x] Integrate singleton secret store via async providerSettings; run all tests and review no secrets in public configs/errors. Update readiness, plan and README; ordinary commit/push and verify remote main.

## Self-review

This plan covers IPC origin/window policies and credential/config local boundaries only. It does not claim native safeStorage acceptance, UI request cancellation, historical sensitivity/migration, DNS/HTTP/SSE control, image decoding or four-target packaging. They remain release prerequisites; no installer/Release is created by this plan.
