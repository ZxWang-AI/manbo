# Local-First Desktop Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a runnable three-platform-targeted desktop foundation that imports immutable local evidence, records task-scoped authorization, and embeds Pi without exposing file or terminal tools before sandbox validation.

**Architecture:** Electron is the desktop shell with a sandboxed renderer and narrow preload bridge. The host owns a local case vault and permission manifests. The Pi SDK is embedded in a deliberately tool-free, in-memory session for this first increment; granting file/terminal tools is a separate security-gated plan and must not be inferred from a working UI.

**Tech Stack:** Node.js 24+, Electron 44.4.5, `@earendil-works/pi-coding-agent` 0.87.1, built-in `node:test`; ESM core modules and CommonJS Electron entry.

## Global Constraints

- Original imported bytes are never modified by the agent; only a user-initiated case deletion can remove the case vault.
- Case files and session contents are local. Import never triggers model upload.
- Task mode exposes only selected material; autonomous mode may expose the case at task start, but neither mode can modify originals.
- No Pi file, write, edit, bash, extension, or network capability is enabled by this foundation. Do not call this a secure sandbox.
- Default service keys must never be placed in a desktop package; no model request is made by this increment.
- Target Windows, macOS, and Linux, but do not claim release readiness without native isolation tests on each.
- Existing modified `docs/superpowers/plans/2026-08-31-ai-native-case-navigator.md` belongs to the user and must remain untouched.

---

## File map

- `package.json`: pinned dependencies and test/start commands.
- `app/core/cases.mjs`: local case creation, immutable-copy import, hashing and manifest persistence.
- `app/core/cases.test.mjs`: storage behavior and original-integrity regression.
- `app/core/scope.mjs`: task/autonomous authorization manifest validation.
- `app/core/scope.test.mjs`: authorization boundary tests.
- `app/agent/pi-session.mjs`: tool-free Pi SDK adapter, with injectable SDK for offline tests.
- `app/agent/pi-session.test.mjs`: verifies exact SDK options and disposal.
- `app/desktop/main.cjs`: Electron window and narrow IPC.
- `app/desktop/preload.cjs`: renderer API only for create/import/list, no arbitrary filesystem or process access.
- `app/desktop/index.html`: local case UI and explicit “not sent” state.
- `docs/superpowers/plans/2026-09-28-pi-sandbox-validation.md`: next-stage validation matrix, not permission to enable tools.

### Task 1: Immutable local case vault

**Files:** Create `package.json`, `app/core/cases.mjs`, `app/core/cases.test.mjs`; modify `.gitignore` to ignore `/app-data/` and `/node_modules/` if needed.

**Interfaces:** Produce `createCase(root): Promise<CaseManifest>`, `importEvidence(root, caseId, sourcePath): Promise<Evidence>`, `readCase(root, caseId): Promise<CaseManifest>`, and `listCases(root): Promise<CaseManifest[]>`. `CaseManifest` is `{id, createdAt, evidence: Evidence[]}`, `Evidence` is `{id, name, storedName, sha256, bytes, importedAt}`. `root` is an application-owned data directory, never the project repository.

- [ ] **Step 1: Write failing tests.** Create tests using `node:test`, `mkdtemp(join(tmpdir(), 'manbo-case-'))`, and `after(() => rm(root,{recursive:true,force:true}))`. Assert `createCase` creates empty manifest, `importEvidence` copies bytes and SHA-256 into `originals/<random-id>.<extension>`, original bytes remain unchanged, two same-name imports do not overwrite, and invalid case IDs reject. Use a small text file fixture created inside that unique temp directory.
- [ ] **Step 2: Verify red.** Run `npm test`; expected `ERR_MODULE_NOT_FOUND` for `app/core/cases.mjs`.
- [ ] **Step 3: Implement.** Use `randomUUID`, `createHash('sha256')`, `mkdir`, `copyFile(COPYFILE_EXCL)`, `readFile`, `writeFile` with `{flag:'wx'}` for temporary manifest, and `rename` for atomic replacement. Validate case IDs against `/^[0-9a-f-]{36}$/i`; resolve paths only beneath `root`; accept only `stat(sourcePath).isFile()`; copy before hashing the copied bytes; store sanitized display name via `basename(sourcePath)`. Never expose original paths to the renderer or Pi.
- [ ] **Step 4: Verify green.** Run `npm test`; expected all Task 1 tests pass. Run `git diff --check`.
- [ ] **Step 5: Commit.** Stage only Task 1 files and commit `feat: add immutable local case vault`.

### Task 2: Authorization manifests without implicit expansion

**Files:** Create `app/core/scope.mjs`, `app/core/scope.test.mjs`.

**Interfaces:** Consume `CaseManifest` from Task 1. Produce `createAuthorization(caseManifest, {mode, selectedEvidenceIds, provider}): Authorization`, `canReadEvidence(auth, id): boolean`; `Authorization` is `{taskId, caseId, mode, provider, evidenceIds, createdAt}`. `mode` is `task` or `autonomous`.

- [ ] **Step 1: Write failing tests.** Test: task mode includes exactly selected known IDs, rejects unknown/empty selections; autonomous mode snapshots all IDs at authorization time, excludes a subsequently imported ID; an unknown mode/provider rejects; mutation of caller's selected array cannot expand authorization.
- [ ] **Step 2: Verify red.** Run `npm test`; expected missing scope module.
- [ ] **Step 3: Implement.** Validate `provider` as a nonempty identifier without control characters; use a `Set` to reject duplicate or unknown IDs; create frozen copies of the ID array and authorization object; `canReadEvidence` checks only its snapshot. Keep `taskId` random and scope expiry on task completion in the later runner—not in a UI flag.
- [ ] **Step 4: Verify green.** Run `npm test`; expected both suites pass. Run `git diff --check`.
- [ ] **Step 5: Commit.** Stage only scope files and commit `feat: snapshot case authorization scope`.

### Task 3: Embed Pi in a no-tool feasibility adapter

**Files:** Create `app/agent/pi-session.mjs`, `app/agent/pi-session.test.mjs`.

**Interfaces:** Produce `createNoToolSession({cwd, sdk}): Promise<{session, dispose}>`. `sdk` defaults to a dynamic import of `@earendil-works/pi-coding-agent` and can be an injected fake in tests. No model prompt is sent during creation or tests.

- [ ] **Step 1: Write failing tests.** Inject a fake `createAgentSession`, `SessionManager.inMemory`, `SettingsManager.inMemory`, and `DefaultResourceLoader` with `reload()`. Assert `cwd` is explicit, `noTools: true`, `tools: []`, both managers in memory, skills/context/prompts overrides return empty collections, and `dispose()` forwards to `session.dispose()`. Reject nonexistent `cwd` and reject an attempted `tools` override.
- [ ] **Step 2: Verify red.** Run `npm test`; expected missing Pi adapter module.
- [ ] **Step 3: Implement.** Follow Pi SDK 0.87.1 documented `createAgentSession` options, constructing `DefaultResourceLoader` with empty `skillsOverride`, `agentsFilesOverride`, `promptsOverride`, then `await reload()`. Pass `noTools:true`, `tools:[]`, explicit `cwd`, `SessionManager.inMemory()`, `SettingsManager.inMemory()`, and an app-controlled empty agent directory. Disable project resource discovery; if SDK still loads extensions/context files, fail this task rather than marking it secure. Never call `prompt()` in this increment.
- [ ] **Step 4: Verify green and real import.** Run `npm test`, then `node -e "import('@earendil-works/pi-coding-agent').then(m=>console.log(typeof m.createAgentSession))"`; expect tests pass and `function`. Inspect `session.getActiveToolNames()` in an isolated temporary case; expect `[]`. Run `git diff --check`.
- [ ] **Step 5: Commit.** Stage only adapter files and commit `feat: embed Pi with no tools or discovery`.

### Task 4: Desktop case management shell

**Files:** Create `app/desktop/main.cjs`, `app/desktop/preload.cjs`, `app/desktop/index.html`; modify `package.json` scripts.

**Interfaces:** Renderer bridge exposes exactly `createCase(): Promise<CaseManifest>`, `listCases(): Promise<CaseManifest[]>`, `importEvidence(caseId): Promise<Evidence|null>` (OS file dialog, canceled = null). No filesystem path, API key, shell command or arbitrary IPC channel is accepted from renderer.

- [ ] **Step 1: Write failing smoke tests.** Add `app/desktop/shell.test.mjs` to check the preload's exposed method names against the exact list, HTML does not load remote scripts, and main declares `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`. These tests are defense-in-depth, not proof of OS isolation.
- [ ] **Step 2: Verify red.** Run `npm test`; expected missing desktop files.
- [ ] **Step 3: Implement.** Electron main uses `app.getPath('userData')/cases` for the vault, a `BrowserWindow` with `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, `webSecurity:true`, explicit preload and local `loadFile`. `ipcMain.handle` supports only `case:create`, `case:list`, `evidence:import`; import opens native file dialog and passes its selected path directly to the host vault. Set a restrictive local Content-Security-Policy. HTML renders case list, a create button and import button, with text that import stays local and AI sending is unavailable until the isolated runner is validated.
- [ ] **Step 4: Verify green and manual smoke.** Run `npm test`, then `npm start`; create a case and import a synthetic text file; verify the imported copy and SHA-256 in the app data directory, close the app, reopen and confirm persistence. Run `git diff --check`. Do not open a model connection.
- [ ] **Step 5: Commit.** Stage only desktop files and `package.json`/lockfile and commit `feat: add local-only desktop case shell`.

### Task 5: Record the next security gate

**Files:** Create `docs/superpowers/plans/2026-09-28-pi-sandbox-validation.md`.

**Interfaces:** No runtime API. This document is the prerequisite to adding Pi file/terminal tools and model requests.

- [ ] **Step 1: Write a matrix** with Windows, macOS, Linux rows and explicit tests for read-only original mounts, writable derived area, workspace escape, symlinks/archives, child processes, environment/credential access, blocked direct network, broker-only model requests, extension loading, and rollback. Record commands, observed outcome and platform evidence rather than claiming an unrun pass.
- [ ] **Step 2: Check the gate.** Run `rg -n 'TBD|TODO|passed without test' docs/superpowers/plans/2026-09-28-pi-sandbox-validation.md`; expected no placeholder or unearned pass. Run `git diff --check`.
- [ ] **Step 3: Commit.** Stage only the gate document and commit `docs: define Pi sandbox validation gate`.

## Plan self-review / handoff

This increment covers local storage, authorization snapshots, a Pi SDK integration seam and a local-only desktop UI. It intentionally does **not** enable agent tools, cloud models, default-key forwarding, evidence extraction, knowledge-base navigation, PDF export or release packaging. Those are separate testable increments under the approved design; implementation may begin only after the isolation gate is proven on each release platform. The existing static prototype and legacy plan are not modified.
