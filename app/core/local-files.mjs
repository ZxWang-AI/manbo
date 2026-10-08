import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MAX_MATERIAL_BYTES = 2 * 1024 * 1024;

function sameIdentity(a, b) {
  return a.dev === b.dev && a.ino === b.ino;
}

async function assertCanonicalPath(path) {
  const actual = await realpath(path);
  const expected = resolve(path);
  const normalize = process.platform === 'win32' ? (value) => value.toLowerCase() : (value) => value;
  if (normalize(actual) !== normalize(expected)) throw new Error('Linked local path is not allowed');
}

export async function assertLocalDirectory(directory) {
  const before = await lstat(directory);
  if (before.isSymbolicLink() || !before.isDirectory()) throw new Error('Local directory links are not allowed');
  await assertCanonicalPath(directory);
  const after = await lstat(directory);
  if (after.isSymbolicLink() || !after.isDirectory() || !sameIdentity(before, after)) {
    throw new Error('Local directory changed during access');
  }
}

function assertFile(stats, maxBytes) {
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error('Evidence must be a regular file, not a link');
  if (stats.nlink !== 1) throw new Error('Hardlinked local files are not allowed');
  if (!Number.isSafeInteger(stats.size) || stats.size < 1 || stats.size > maxBytes) {
    throw new Error('Local file is empty or exceeds the size limit (too large)');
  }
}

export async function readBoundedFile(filePath, maxBytes) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid local file size limit');
  const before = await lstat(filePath);
  assertFile(before, maxBytes);
  await assertCanonicalPath(filePath);
  const handle = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    assertFile(opened, maxBytes);
    if (!sameIdentity(before, opened) || before.size !== opened.size
      || before.mtimeMs !== opened.mtimeMs || before.ctimeMs !== opened.ctimeMs) {
      throw new Error('Local file changed before reading');
    }
    // One extra byte detects growth without an unbounded readFile allocation.
    const buffer = Buffer.alloc(opened.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const finished = await handle.stat();
    const current = await lstat(filePath);
    assertFile(finished, maxBytes);
    assertFile(current, maxBytes);
    await assertCanonicalPath(filePath);
    if (length !== opened.size || !sameIdentity(opened, finished) || !sameIdentity(opened, current)
      || [finished, current].some((stats) => stats.size !== opened.size
        || stats.mtimeMs !== opened.mtimeMs || stats.ctimeMs !== opened.ctimeMs)) {
      throw new Error('Local file changed during reading');
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export function decodeUtf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('Local text is not valid UTF-8'); }
}
