# Material read safety implementation plan

> **Status:** Tasks 1–2 and review verified (78/78); Task 3 commit/push executed at this checkpoint. No public release gate waived.

> **For agentic workers:** Use superpowers:executing-plans inline in the existing linked worktree. Steps use checkbox (`- [x]`) syntax. User authorized safety verification followed by public release; this is the first independently verifiable prerequisite, not permission to waive the other gates.

**Goal:** Reject altered, oversized, malformed or path-escaping material before an outbound preview/request, preserving original files.

**Architecture:** Read a bounded snapshot through a checked file handle. Validate local vault directories and manifest entries before using their paths; calculate hash and byte length from the snapshot, not from metadata. Both preview and confirmation use the same reader.

**Tech Stack:** Fixed Node v24.21.0, node:test, fs/promises, crypto; Electron 44.4.5 and Pi 1.1.0 unchanged.

## Global constraints

- Worktree `D:/Users/kotei/My Document/ChatGPT/Manbo/.worktrees/local-first-main`, branch `main`; preserve the legacy tree and backup branches.
- Synthetic fixtures only, no real Key or case; no agent file/terminal/MCP/autonomy permission expansion.
- Imported single-file limit 2 MiB, matching the current outbound limit. Manifest limit 2 MiB. Nonempty regular single-link files only; reject symlinks/junctions and hardlinks inside the vault. Source selection does not authorize linked source files.
- For reads, use `O_RDONLY | (O_NOFOLLOW ?? 0)`, compare lstat/fstat identity, bound reads to limit + 1, check size/time/identity again afterwards. These are application checks, not an OS sandbox against a malicious same-user process.
- UTF-8 decoding uses `new TextDecoder('utf-8', { fatal: true })`. No replacement decoding for text or JSON. Unknown formats reject; PDF remains explicitly unsupported until a real bounded parser is implemented and verified, not represented as empty successful extraction.
- Windows is the current validation host. Link/path tests on this host are not three-platform installation acceptance. Public release remains blocked until all existing release design gates pass.

## File map and interfaces

- New `app/core/local-files.mjs`: `assertLocalDirectory(directory)` and `readBoundedFile(filePath, maxBytes)`; returns a Buffer from the verified open handle. No write access to input.
- Modify `app/core/cases.mjs`: validate manifest ID, item IDs, strict stored name `${id}${extname}`, hash, size, unique items; use bounded reads; import writes a bounded snapshot using `wx`, size/hash come from that snapshot.
- New `app/core/evidence-reader.mjs`: `readEvidenceForOutbound(root, caseId, evidenceId)` calls validated readCase, checked originals directory, bounded snapshot, actual hash/bytes comparison, strict format conversion.
- Modify `app/desktop/main.cjs`: existing `readEvidenceForOutbound(caseId, evidenceId)` becomes a narrow delegating wrapper with vaultRoot; never accepts a path from IPC.
- Tests: new `app/core/material-safety.test.mjs`, additions to `app/core/cases.test.mjs`, `app/desktop/ipc-contract.test.mjs`; readiness and README evidence updates at checkpoint.

## Task 1: Expose the unsafe paths with regressions

- [x] Add real temporary-file tests using `createCase` and `importEvidence`. Rewrite a stored copy with equal-length different bytes, then require `readEvidenceForOutbound(root, id, item.id)` to reject `/changed/`; source bytes must remain identical.

```js
await writeFile(join(root, id, 'originals', item.storedName), 'xxxx');
await assert.rejects(readEvidenceForOutbound(root, id, item.id), /changed/i);
assert.equal(await readFile(source, 'utf8'), 'safe');
```

- [x] Add import-limit and malformed-manifest tests against existing functions before implementation. A source of `Buffer.alloc(2 * 1024 * 1024 + 1)` must reject `/large|limit/`, leave no copy and leave manifest evidence empty. A manifest storedName changed to `../../outside.txt` must reject before reading outside the vault.
- [x] Add strict decoding, hardlink, directory-junction, unknown format/PDF and valid snapshot tests. Link fixtures use fs.link and Windows directory symlink type `junction`; no skipped-success claims. Test teardown only removes exact mkdtemp-created directories.
- [x] Run fixed Node `--test app/core/cases.test.mjs app/core/material-safety.test.mjs`; retain expected red evidence (new export absent plus existing import/manifest behaviors fail).

## Task 2: Implement checked bounded snapshots and integrate

- [x] Implement `assertLocalDirectory`: lstat regular directory, reject links, compare realpath to resolve (case-insensitive Windows), and recheck identity.
- [x] Implement `readBoundedFile`: lstat rejects nonregular/link/multiple-link, size in `1..maxBytes`; open read-only/no-follow, fstat same dev/ino as lstat; read at most `maxBytes + 1`; post-read fstat/lstat identity, length, size, mtime/ctime unchanged. Close in finally; return copied immutable-in-use snapshot buffer.

```js
const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
try {
  const opened = await handle.stat();
  // Check dev/ino, nlink and the size bound before allocating/reading.
  const buffer = Buffer.alloc(opened.size + 1);
  let length = 0;
  while (length < buffer.length) {
    const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
    if (!bytesRead) break;
    length += bytesRead;
  }
  // Reject change/growth and recheck path/handle metadata before returning.
  return buffer.subarray(0, length);
} finally { await handle.close(); }
```

- [x] Validate readCase manifest before path use. Import reads source snapshot first, then writes only the generated UUID target with `wx`/0600. Preserve existing per-case import serialization and rollback of only the newly created copy.
- [x] Implement reader hash as `createHash('sha256').update(bytes).digest('hex')`, compare both hash and actual byte length with validated manifest. Text requires supported extension and fatal UTF-8/nonempty text; images require matching PNG/JPEG/GIF/WebP magic; PDF throws a clear unsupported-parser error.
- [x] Delegate main's reader to the new module; strengthen source contract assertion that old `bytes.toString('utf8')` and `pages: []` paths are gone.
- [x] Run target tests, full `node --test app/**/*.test.mjs`, `git diff --check`. Existing 64 security contracts stay intact. Record exact count and platform limitations.

## Task 3: Review and checkpoint

- [x] Review all changed files, verify synthetic fixtures only and no dependency/runtime change. Update readiness with red/green evidence and remaining gates; do not mark Desktop Gate complete.
- [x] Ordinary commit and push the exact plan/source/test/document files; compare local HEAD with remote main. Then separately plan IPC/request lifecycle, history/storage, transport and credentials, followed by packaging only once application gates pass.

## Self-review

This plan implements only material reads/imports and manifest path validation from the approved release design. It deliberately does not claim PDF support, DNS/HTTP/SSE, IPC sender/cancel, safeStorage backend, history migration or four-target packaging acceptance. Those remain prerequisites for public release.
