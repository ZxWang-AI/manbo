import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertLocalDirectory, decodeUtf8, readBoundedFile } from './local-files.mjs';

const mutations = new Map();
export const MAX_SETTINGS_BYTES = 1024 * 1024;

export async function readLocalJson(root, name, fallback, maxBytes = MAX_SETTINGS_BYTES) {
  try { await assertLocalDirectory(root); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
  try {
    const value = JSON.parse(decodeUtf8(await readBoundedFile(join(root, name), maxBytes)));
    await assertLocalDirectory(root);
    return value;
  } catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

export async function writeLocalJson(root, name, value, maxBytes = MAX_SETTINGS_BYTES) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) throw new Error('Local JSON size limit exceeded');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertLocalDirectory(root);
  const temporary = join(root, `${name}.${randomUUID()}.tmp`);
  let created = false;
  try {
    await writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    created = true;
    await assertLocalDirectory(root);
    await rename(temporary, join(root, name));
  } catch (error) {
    if (created) await unlink(temporary).catch(() => {});
    throw error;
  }
}

export function serializeLocalMutation(root, name, operation) {
  const key = `${resolve(root)}\0${name}`;
  const previous = mutations.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const settled = current.catch(() => {});
  mutations.set(key, settled);
  void settled.then(() => { if (mutations.get(key) === settled) mutations.delete(key); });
  return current;
}
