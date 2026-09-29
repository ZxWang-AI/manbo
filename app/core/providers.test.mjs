import { test } from 'node:test';
import assert from 'node:assert/strict';
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
    hasKey: false,
  }]);
  assert.equal(providers[0].secret, undefined);
  assert.equal(providers[0].apiKey, undefined);
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
