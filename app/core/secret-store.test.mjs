import { test } from 'node:test';
import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSafeSecretStore } from './secret-store.mjs';

async function fixture(t) {
  const parent = await mkdtemp(join(tmpdir(), 'manbo-secret-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'settings');
  let available = true;
  let backend = 'gnome_libsecret';
  // Only the native safeStorage boundary is doubled. This is NOT an OS encryption acceptance test.
  const safeStorage = {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => backend,
    encryptString: (value) => Buffer.from(`synthetic-encrypted:${value}`),
    decryptString: (value) => {
      if (!value.toString().startsWith('synthetic-encrypted:')) throw new Error('echoed-SYNTHETIC-KEY');
      return value.toString().slice('synthetic-encrypted:'.length);
    },
  };
  const options = { root, safeStorage, platform: 'linux' };
  return { parent, root, path: join(root, 'provider-secrets.json'), options, store: createSafeSecretStore(options),
    setAvailable: (value) => { available = value; }, setBackend: (value) => { backend = value; } };
}

test('unavailable and Linux basic_text backends refuse persistence before creating storage', async (t) => {
  const f = await fixture(t);
  for (const backend of ['basic_text', undefined, 'unknown']) {
    f.setBackend(backend);
    await assert.rejects(f.store.set('first', 'SYNTHETIC'), /凭据|credential/i);
  }
  f.setBackend('gnome_libsecret'); f.setAvailable(false);
  await assert.rejects(f.store.set('first', 'SYNTHETIC'), /凭据|credential/i);
  await assert.rejects(readFile(f.path), { code: 'ENOENT' });
});

test('serialized mutations survive across store instances and restart without plaintext records', async (t) => {
  const f = await fixture(t);
  const second = createSafeSecretStore(f.options);
  await Promise.all([f.store.set('first', 'SYNTHETIC-A'), second.set('second', 'SYNTHETIC-B')]);
  const restarted = createSafeSecretStore(f.options);
  assert.equal(await restarted.get('first'), 'SYNTHETIC-A');
  assert.equal(await restarted.get('second'), 'SYNTHETIC-B');
  assert.equal((await readFile(f.path, 'utf8')).includes('SYNTHETIC'), false);
  await Promise.all([f.store.delete('first'), second.set('third', 'SYNTHETIC-C')]);
  assert.equal(await restarted.get('first'), null);
  assert.equal(await restarted.get('third'), 'SYNTHETIC-C');
});

test('backend downgrade prevents decrypting previously saved credentials', async (t) => {
  const f = await fixture(t);
  await f.store.set('first', 'SYNTHETIC'); f.setBackend('basic_text');
  await assert.rejects(f.store.get('first'), /凭据|credential/i);
});

test('malformed, oversized and invalid base64 credential files fail closed', async (t) => {
  const f = await fixture(t); await mkdir(f.root);
  for (const value of ['[]', '{"first":"bad!base64"}', '{"constructor":"YQ=="}', 'x'.repeat(1024 * 1024 + 1)]) {
    await writeFile(f.path, value);
    await assert.rejects(f.store.get('first'), /unreadable|invalid|limit|large/i);
  }
});

test('linked credential file and junction directory are refused without changing targets', async (t) => {
  const f = await fixture(t); await mkdir(f.root);
  const outside = join(f.parent, 'outside.json');
  await writeFile(outside, '{}'); await link(outside, f.path);
  await assert.rejects(f.store.get('first'), /link|unreadable/i);
  assert.equal(await readFile(outside, 'utf8'), '{}');
  const moved = join(f.parent, 'moved'); await rename(f.root, moved);
  await symlink(moved, f.root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.store.set('first', 'SYNTHETIC'), /link|path|directory|unreadable/i);
  assert.equal(await readFile(outside, 'utf8'), '{}');
});

test('decryption errors never expose echoed secret and invalid IDs/values are refused', async (t) => {
  const f = await fixture(t); await mkdir(f.root);
  await writeFile(f.path, JSON.stringify({ first: Buffer.from('bad-encryption').toString('base64') }));
  await assert.rejects(f.store.get('first'), (error) => {
    assert.doesNotMatch(error.message, /echoed|SYNTHETIC/); return /unreadable/i.test(error.message);
  });
  for (const id of ['../first', '__proto__', 'constructor']) await assert.rejects(f.store.set(id, 'SYNTHETIC'), /id/i);
  for (const value of ['', 'x'.repeat(8193), 'key\nheader']) await assert.rejects(f.store.set('first', value), /key|value/i);
});
