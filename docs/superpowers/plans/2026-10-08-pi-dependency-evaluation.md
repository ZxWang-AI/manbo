# Pi 1.1.0 controlled dependency evaluation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execute inline in the existing linked worktree; main changes and ordinary push are authorized.

**Goal:** Replace the vulnerable Pi 0.87.1 tree only if Pi 1.1.0 passes clean dependency replay and the unchanged transport tests plus stronger no-discovery regressions.

**Architecture:** Evaluate a copy of the application in a unique temporary directory, with scripts disabled. Use the public Pi ResourceLoader interface with an explicit in-memory, empty resource set instead of discovery followed by filtering. Keep explicit memory credentials, a single provider call, empty tool allowlist and the existing payload boundary. Adopt only the candidate lockfile and tested adapter changes.

**Tech Stack:** Pi coding-agent 1.1.0 (evaluated and adopted), Electron 44.4.5 (unchanged), Node 24.21.0 (verification target), npm, node:test.

## Global constraints

- User approved the recommended strategy in `docs/testing/2026-10-08-desktop-release-readiness.md`; this plan does not request the same approval again.
- Worktree: `D:/Users/kotei/My Document/ChatGPT/Manbo/.worktrees/local-first-main`, branch `main`. Leave the legacy checkout and backup branches alone.
- BYOK only; no real API Key/case, Manbo relay, built-in Key or real provider request in tests.
- No original evidence changes, file/terminal/MCP/codemode tools, autonomous mode or permission expansion.
- Electron stays exactly 44.4.5. No force audit fix, audit ignores, hand-patched dependency source, tag, installer or public Release. Preserve the same-version existing Electron native files across main ci; restoration is not runtime acceptance.
- All existing 60 tests remain; changing implementation-specific loader assertions must retain their security contract, not weaken it.
- A green event-stream test is not HTTP/SSE, DNS, redirect, system credential, Electron runtime or cross-platform installation acceptance.
- Stop adoption on any unexplained regression, unresolved production high/critical, lifecycle requirement outside the approved scope or non-reproducible lockfile.

## File map

- `package.json`, `package-lock.json`: adopt reviewed candidate tree after gates.
- `app/agent/pi-resources.mjs` (new): fixed prompt and empty ResourceLoader, with no filesystem/package discovery.
- `app/agent/pi-resources.test.mjs` (new): immutable empty resources, fresh runtime, fixed prompt, rejected resource injection.
- `app/agent/pi-session.mjs`: consume empty loader; keep single-call adapter and runtime credential isolation.
- `app/agent/pi-session.test.mjs`: retain settings/cleanup assertions against the new interface; check real active/callable/registered tools, resources and I/O boundary.
- `app/agent/pi-gateway.integration.test.mjs`: retain real-session provider-boundary coverage; add persistence rejection assertions.
- This plan, readiness, Alpha spec status and `README.md`: evidence and accurate remaining gates.

## Task 1: Install and review an independent candidate

**Files:** Temporary candidate `C:/Users/kotei/AppData/Local/Temp/manbo-pi-eval-bb715a0ccba14c7d9ef0206af842d4c1/package.json` and its generated lockfile; application copy in its `app/`.

**Interfaces:** Candidate manifest is the application manifest with only `dependencies['@earendil-works/pi-coding-agent']='1.1.0'`. Output is the actual npm lockfile, audit metadata and resolved tree; it is not yet an adopted main dependency.

- [x] Create the exact candidate manifest using apply_patch. Copy only `app/` with PowerShell `Copy-Item -LiteralPath`; do not copy node_modules, userData, secrets or the old platform.
- [x] Run `npm install --ignore-scripts --no-fund`. Expected: candidate dependencies and lockfile only; no dependency lifecycle execution or Electron binary download.
- [x] Run `npm ls @earendil-works/pi-coding-agent @earendil-works/pi-ai @earendil-works/pi-agent-core @earendil-works/pi-mcp @earendil-works/pi-codemode brace-expansion balanced-match`; inspect every actual brace-expansion path.
- [x] Run `npm audit --omit=dev --json` and `npm audit --json`. Inspect advisory details if nonzero; do not suppress them.
- [x] Enumerate `hasInstallScript` from the candidate lockfile and read each corresponding installed package's `scripts`, plus `binding.gyp` when present. Do not enable scripts to hide a compatibility error.
- [x] Run unchanged `npm test` in the candidate. Expected: 60/60; if it fails, preserve the failure and limit any adapter repair to that demonstrated incompatibility.

## Task 2: Remove discovery, fail closed on resource injection

**Files:** New `app/agent/pi-resources.mjs`, `app/agent/pi-resources.test.mjs`; modify `app/agent/pi-session.mjs`, `app/agent/pi-session.test.mjs`, `app/agent/pi-gateway.integration.test.mjs` in candidate first.

**Interfaces:** `createEmptyResourceLoader(sdk, systemPrompt)` returns the public Pi ResourceLoader interface. `getExtensions()` returns `{extensions:[], errors:[], runtime:sdk.createExtensionRuntime()}`; all other resources are empty and prompt sources undefined. `reload()` has no I/O; `extendResources()` accepts only undefined or empty known lists and throws for nonempty/unknown input. Session creation supplies its empty temporary `agentDir` explicitly.

- [x] Add a real-SDK regression in `pi-session.test.mjs`. In a unique synthetic project/global resource directory, instrument `node:fs` and `node:fs/promises` path probes/reads, synchronize builtin exports, and observe forbidden `.pi`, AGENTS.md, settings/auth/models resource access. Block network and subprocess launch at their boundaries. First run a real DefaultResourceLoader positive control to prove probes are observed; then require `createNoToolSession` plus session reload/disposal to make zero such accesses. Keep fixture cleanup outside observation and restore env/mocks in finally.
- [x] Run `node --test app/agent/pi-session.test.mjs`. Expected: the new assertion fails because the current DefaultResourceLoader resolves packages despite no-resource flags. A type/import error is not the expected red evidence.
- [x] Add empty-loader contract tests before implementation:

```js
const loader = createEmptyResourceLoader(sdk, 'fixed synthetic prompt');
assert.deepEqual(loader.getSkills(), { skills: [], diagnostics: [] });
assert.deepEqual(loader.getAgentsFiles(), { agentsFiles: [] });
assert.equal(loader.getSystemPrompt(), 'fixed synthetic prompt');
assert.equal(loader.getSystemPromptSource(), undefined);
assert.deepEqual(loader.getAppendSystemPrompt(), []);
assert.throws(() => loader.extendResources({ skillPaths: [{ path: 'unapproved' }] }), /disabled/);
assert.throws(() => loader.extendResources({ extensions: [] }), /disabled/);
await loader.reload();
assert.deepEqual(loader.getExtensions().extensions, []);
```

- [x] Run `node --test app/agent/pi-resources.test.mjs` and observe the missing implementation failure; then implement the complete interface:

```js
export function createEmptyResourceLoader(sdk, systemPrompt) {
  const empty = Object.freeze([]);
  const extensions = Object.freeze({ extensions: empty, errors: empty, runtime: sdk.createExtensionRuntime() });
  return Object.freeze({
    getExtensions: () => extensions,
    getSkills: () => Object.freeze({ skills: empty, diagnostics: empty }),
    getPrompts: () => Object.freeze({ prompts: empty, diagnostics: empty }),
    getThemes: () => Object.freeze({ themes: empty, diagnostics: empty }),
    getAgentsFiles: () => Object.freeze({ agentsFiles: empty }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => empty,
    getAppendSystemPromptSources: () => empty,
    extendResources(paths = {}) {
      if (!paths || typeof paths !== 'object' || Array.isArray(paths) || Object.entries(paths).some(([key, value]) =>
        !['skillPaths', 'promptPaths', 'themePaths'].includes(key) || !Array.isArray(value) || value.length !== 0)) {
        throw new Error('Pi resource extension is disabled');
      }
    },
    async reload() {},
  });
}
```

- [x] Replace DefaultResourceLoader construction/reload in `pi-session.mjs` with `createEmptyResourceLoader(sdk, SYSTEM_PROMPT)` and pass `agentDir` to `createAgentSession`. Do not change prompt projection, history, credential storage, cancellation or finishTurn.
- [x] Update the existing injected-SDK test to provide the public `createExtensionRuntime` stub. Assert the resource getters, shared in-memory settings, explicit empty agentDir and disposal cleanup instead of DefaultResourceLoader options. Retain all previous security expectations.
- [x] Strengthen the real-session assertion (these methods exist in candidate 1.1.0):

```js
assert.deepEqual(result.session.getActiveToolNames(), []);
assert.deepEqual(result.session.getCallableToolNames(), []);
assert.deepEqual(result.session.getAllTools(), []);
assert.deepEqual(result.session.resourceLoader.getExtensions().extensions, []);
```

  The candidate's public `AgentSession.resourceLoader` getter is confirmed in `agent-session.d.ts`. Also check the empty loader independently through its public API.
- [x] In the existing real gateway credential test require `credentials.modify()` and `credentials.delete()` to reject with `/persistence is disabled/`. Run `node --test app/agent/*.test.mjs` and `npm test`. Expected: all old and new tests green with one provider call and no uncontrolled request.

## Task 3: Replay under fixed Node 24 and adopt only after gates

**Files:** Main `package.json`, `package-lock.json`, tested adapter/test files; readiness, README, Alpha spec status and old preflight Task 3 status.

**Interfaces:** Candidate lockfile becomes the reproducible dependency source only after a second unique-directory `npm ci --ignore-scripts` and fixed Node 24 full tests pass.

- [x] Download official `node-v24.21.0-win-x64.zip` and release `SHASUMS256.txt` from `https://nodejs.org/dist/v24.21.0/` into a unique temporary directory. Verify SHA-256 before extraction/execution; no npm wrapper install scripts. Record the exact matched checksum and runtime version; checksum matching is not a publisher-signature validation.
- [x] Create a second unique temporary directory. Copy candidate `package.json`, `package-lock.json`, tested `app/`; run the verified Node binary on its bundled npm CLI: `npm ci --ignore-scripts --no-fund`, `npm audit --omit=dev --json`, `npm ls brace-expansion`, and `node --test app/**/*.test.mjs`. Set PATH only for that command to the verified Node directory so subprocesses use the same runtime. Check the lockfile hash unchanged after ci.
- [x] Compare resolved candidate/replay trees and audit metadata. Review `git diff --no-index` of the original vs candidate adapter; adopt only if every task gate passed. Copy the generated lockfile as generated artifact; use apply_patch for source/manifest changes.
- [x] Before main ci, verify Electron package/dist version 44.4.5 and copy only its existing dist and path.txt to a unique temporary backup. Run main `npm ci --ignore-scripts --no-fund` with fixed Node 24, then restore those same-version files only if ci removed them. Compare every restored dist file SHA-256 and path.txt; do not download/upgrade Electron or edit dependency source. Record that preserving files is not native runtime acceptance. Run all tests, production/full audit, `npm ls` and `git diff --check` again. Do not enable dependency scripts without review.
- [x] Append exact versions, test counts, checksums, lifecycle review, red/green evidence and remaining blockers to readiness. Mark historical old override steps as superseded, not as successful. Update README and Alpha status without claiming packaging or platform support.
- [ ] Review the entire staged diff, verify no user data/Key entered it, commit the exact task files (`fix: isolate Pi resources and adopt audited 1.1.0 tree`). Ordinary `git push origin main`; compare `git rev-parse HEAD` with `git ls-remote origin refs/heads/main`.

## Plan self-review

- Covers only the approved Pi dependency subproject; other Alpha blockers remain explicitly outside this plan.
- No permission weakening, audit bypass or new provider behavior is proposed.
- Public ResourceLoader interface and `AgentSession.resourceLoader` getter confirmed in candidate tarball.
- No actual installation, clean replay or Node 24 results are claimed until commands run.

## Execution evidence (2026-10-08)

- Candidate install, original 60/60 baseline, lifecycle review and audit completed before main adoption.
- Real no-discovery regression failed on the old loader with 24 project resource probes; missing-loader contract tests also ran red before implementation. Empty public loader then passed; three loader tests and one real discovery test bring the total to 64 without removing original tests.
- Official fixed Node v24.21.0 archive checksum verified; candidate, second clean replay and adopted main each passed 64/64. Main Agent tests passed 23/23. Production/full audit reports had zero findings in all three trees; node-domexception deprecation warning remains distinct from audit results.
- Lockfile SHA-256: `1b33de2e83af2d58f569ef477e8abdbdb2c1160d92f17c82112b1f500990aa90`; normalized actual tree SHA-256: `82cd413072db057250023e044295e3ee17ddce23592b709cc4e233645e2783d3`, matching across all three trees.
- Main ci used disabled scripts; retained existing Electron 44.4.5 dist/path.txt. All 73 dist file hashes and launcher matched the backup. No native startup/installation acceptance or Release/tag/build was performed.
- See readiness appendix for full checksums, transitive changes, observation boundaries and remaining Alpha gates.
