import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemorySecretStore, deleteProvider, listProviders, saveProvider } from './providers.mjs';

test('lists a local demo provider without exposing a secret', async () => {
  const store = createMemorySecretStore();
  const providers = await listProviders({ root: null, secretStore: store });
  assert.deepEqual(providers, [{
    id: 'local-demo',
    name: '本地演示模型',
    kind: 'demo',
    model: 'local-demo-1',
    endpoint: null,
    capabilities: { images: false, maxInputBytes: 2 * 1024 * 1024, api: 'demo' },
    hasKey: false,
  }]);
  assert.equal(providers[0].secret, undefined);
  assert.equal(providers[0].apiKey, undefined);
});

const config = (id) => ({ id, name: id, kind: 'openai-compatible', model: 'synthetic', endpoint: 'https://example.test/v1' });
async function diskFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'manbo-provider-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, secretStore: createMemorySecretStore() };
}

test('concurrent distinct provider saves preserve both configurations', async (t) => {
  const settings = await diskFixture(t);
  await Promise.all(['first', 'second'].map((id) => saveProvider(settings, config(id), 'SYNTHETIC')));
  assert.deepEqual((await listProviders(settings)).map((item) => item.id).sort(), ['first', 'local-demo', 'second']);
});

test('malformed provider metadata is rejected instead of silently becoming empty', async (t) => {
  const settings = await diskFixture(t);
  await writeFile(join(settings.root, 'providers.json'), '{}');
  await assert.rejects(listProviders(settings), /unreadable|invalid/i);
});

test('provider endpoint cannot persist credentials or query secrets and Key length is bounded', async (t) => {
  const settings = await diskFixture(t);
  for (const endpoint of ['https://user:secret@example.test/v1', 'https://example.test/v1?key=secret', 'https://example.test/v1#secret']) {
    await assert.rejects(saveProvider(settings, { ...config('synthetic'), endpoint }, 'SYNTHETIC'), /endpoint/i);
  }
  await assert.rejects(saveProvider(settings, config('synthetic'), 'x'.repeat(8193)), /key/i);
  await assert.rejects(readFile(join(settings.root, 'providers.json')), { code: 'ENOENT' });
});

test('saves custom provider metadata separately from its secret', async () => {
  const store = createMemorySecretStore();
  const saved = await saveProvider({ root: null, secretStore: store }, {
    id: 'custom-openai',
    name: '我的兼容接口',
    kind: 'openai-compatible',
    model: 'my-model',
    endpoint: 'https://example.test/v1/chat/completions',
  }, 'sk-secret-value');

  assert.deepEqual(saved, {
    id: 'custom-openai',
    name: '我的兼容接口',
    kind: 'openai-compatible',
    model: 'my-model',
    endpoint: 'https://example.test/v1/chat/completions',
    capabilities: { images: false, maxInputBytes: 2 * 1024 * 1024, api: 'openai-completions' },
    hasKey: true,
  });
  assert.deepEqual(await store.get('custom-openai'), 'sk-secret-value');
  const providers = await listProviders({ root: null, secretStore: store, configs: [saved] });
  assert.equal(JSON.stringify(providers).includes('sk-secret-value'), false);
});

test('rejects unsafe or incomplete provider settings and removes secrets explicitly', async () => {
  const store = createMemorySecretStore();
  await assert.rejects(() => saveProvider({ root: null, secretStore: store }, {
    id: 'bad', name: 'Bad', kind: 'openai-compatible', model: 'm', endpoint: 'file:///secret',
  }, 'secret'), /endpoint/i);
  await assert.rejects(() => saveProvider({ root: null, secretStore: store }, {
    id: 'bad', name: 'Bad', kind: 'openai-compatible', model: 'm', endpoint: 'https://example.test',
  }, ''), /key/i);

  await saveProvider({ root: null, secretStore: store }, {
    id: 'custom-openai', name: 'Custom', kind: 'openai-compatible', model: 'm', endpoint: 'https://example.test',
  }, 'secret');
  await deleteProvider({ root: null, secretStore: store }, 'custom-openai');
  assert.equal(await store.get('custom-openai'), null);
});
