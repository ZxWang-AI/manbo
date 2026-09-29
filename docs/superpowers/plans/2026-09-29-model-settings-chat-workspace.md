# Model Settings and Chat Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a local model-settings surface and a persisted case chat workspace while keeping provider calls behind an explicit Broker and a safe local demo provider.

**Architecture:** The core layer owns provider metadata, encrypted credential storage through an injected secret-store boundary, and append-only conversation records. The desktop main process owns Electron `safeStorage`, IPC validation, and the Broker; the renderer only receives redacted provider status and conversation messages. The default provider is local demo mode, which never performs network I/O.

**Tech Stack:** Node.js ESM core modules, Electron 44 `safeStorage`, existing Node test runner, vanilla HTML/CSS/JS renderer.

## Global Constraints

- Original evidence files remain immutable and are never sent before explicit confirmation.
- Case data, conversations, and derived files are persisted locally only.
- Provider secrets never enter case manifests, conversation records, renderer state, logs, or environment variables.
- The renderer cannot access filesystem paths, arbitrary IPC channels, network APIs, or raw secrets.
- Real network providers are not enabled by default; the local demo provider is the only provider used in tests and first-run UI.
- Pi remains configured with no tools or discovery until the three-platform sandbox gate passes.

### Task 1: Provider settings and secret-store boundary

**Files:**
- Create: `app/core/providers.mjs`
- Create: `app/core/providers.test.mjs`
- Modify: `app/desktop/main.cjs`
- Modify: `app/desktop/preload.cjs`
- Modify: `app/desktop/shell.test.mjs`

Produce validated provider metadata, redacted public status, and an injected secret-store interface. Main-process Electron integration may use `safeStorage`, but tests use an in-memory store. No provider request is sent in this task.

### Task 2: Local conversation store and demo Broker

**Files:**
- Create: `app/core/conversations.mjs`
- Create: `app/core/conversations.test.mjs`
- Create: `app/core/broker.mjs`
- Create: `app/core/broker.test.mjs`

Persist messages under each case directory with atomic writes. The Broker accepts an authorization snapshot and rejects out-of-scope evidence IDs. The demo provider returns a clearly labeled local response and never reads evidence bytes or performs network I/O.

### Task 3: Desktop settings and chat workspace

**Files:**
- Modify: `app/desktop/index.html`
- Modify: `app/desktop/renderer.js`
- Modify: `app/desktop/main.cjs`
- Modify: `app/desktop/preload.cjs`
- Modify: `app/desktop/shell.test.mjs`

Add a provider settings dialog, conversation timeline, composer, local demo send action, task pause/revoke controls, and clear status copy. Attachments remain draft-scoped and the existing confirmation dialog precedes every send.

### Task 4: Verification and handoff

- Run `npm test` and `git diff --check`.
- Run Electron with CDP and verify settings, new case, attachment selection, confirmation, demo response, and reload persistence using synthetic data only.
- Commit each completed task with focused messages.

