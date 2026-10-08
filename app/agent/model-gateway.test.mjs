import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createModelGateway } from './model-gateway.mjs';

const authorization = Object.freeze({ taskId: 'a99b9d2a-118e-4ff5-a296-730c510cd7e5', mode: 'task', provider: 'custom', evidenceIds: Object.freeze(['e1']) });
const payload = Object.freeze({
  providerId: 'custom',
  model: 'm1',
  messages: [{ role: 'user', content: [{ type: 'text', text: '整理' }] }],
  attachments: Object.freeze([{ evidenceId: 'e1', representation: 'extracted-text', sha256: 'a'.repeat(64), bytes: 5 }]),
  scope: Object.freeze({ evidenceIds: Object.freeze(['e1']), contextMessageIds: Object.freeze([]) }),
  requestHash: 'hash',
});

const providerStore = {
  async readProvider(id) {
    if (id !== 'custom') throw new Error('Unknown provider');
    return { config: { id: 'custom', name: 'Custom', kind: 'openai-compatible', model: 'm1', endpoint: 'https://api.example.test/v1' }, secret: 'sk-test-secret' };
  },
};

test('gateway sends only the frozen approved payload and disposes the session', async () => {
  const calls = [];
  const gateway = createModelGateway({
    providerStore,
    sessionFactory: async ({ promptContext }) => ({
      async prompt(text) { calls.push({ text, promptContext }); return '模型回答'; },
      async dispose() { calls.push({ disposed: true }); },
    }),
  });
  const result = await gateway.send({ providerId: 'custom', model: 'm1', authorization, payload });
  assert.equal(result.text, '模型回答');
  assert.equal(result.delivered, true);
  assert.equal('secret' in result, false);
  assert.equal('endpoint' in result, false);
  assert.deepEqual(calls[0].promptContext.attachments, payload.attachments);
  assert.equal(calls.at(-1).disposed, true);
});

test('gateway rejects demo provider, missing key, and out-of-scope evidence', async () => {
  const gateway = createModelGateway({ providerStore, sessionFactory: async () => { throw new Error('should not run'); } });
  await assert.rejects(() => gateway.send({ providerId: 'local-demo', model: 'local-demo-1', authorization: { ...authorization, provider: 'local-demo' }, payload: { ...payload, providerId: 'local-demo' } }), /demo|Provider|real/i);
  await assert.rejects(() => gateway.send({ providerId: 'custom', model: 'm1', authorization, payload: { ...payload, scope: { evidenceIds: ['outside'], contextMessageIds: [] } } }), /scope|evidence/i);
});

test('gateway rejects a literal loopback endpoint before session creation', async () => {
  const privateStore = { async readProvider() { return { config: { id: 'custom', kind: 'openai-compatible', model: 'm1', endpoint: 'https://127.0.0.1/v1' }, secret: 'secret' }; } };
  const gateway = createModelGateway({ providerStore: privateStore, sessionFactory: async () => { throw new Error('should not run'); } });
  await assert.rejects(() => gateway.send({ providerId: 'custom', model: 'm1', authorization, payload }), /private|local|endpoint/i);
});

test('gateway disposes the session when prompting fails', async () => {
  let disposed = false;
  const gateway = createModelGateway({
    providerStore,
    sessionFactory: async () => ({ async prompt() { throw new Error('timeout'); }, async dispose() { disposed = true; } }),
  });
  await assert.rejects(() => gateway.send({ providerId: 'custom', model: 'm1', authorization, payload }), /timeout/i);
  assert.equal(disposed, true);
});

test('gateway handles Pi-style synchronous disposal without replacing the reply', async () => {
  let disposed = false;
  const gateway = createModelGateway({
    providerStore,
    sessionFactory: async () => ({ async prompt() { return '真实回复'; }, dispose() { disposed = true; } }),
  });
  const result = await gateway.send({ providerId: 'custom', model: 'm1', authorization, payload });
  assert.equal(result.text, '真实回复');
  assert.equal(disposed, true);
});
