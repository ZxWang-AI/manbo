import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createModelGateway } from './model-gateway.mjs';

const sdkRequire = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
const esmConditions = { conditions: new Set(['node', 'import']) };
const { createAssistantMessageEventStream } = await import(pathToFileURL(sdkRequire.resolve('@earendil-works/pi-ai/utils/event-stream', esmConditions)).href);
const { getCurrentSystemPrompt, getCurrentTools } = await import(pathToFileURL(sdkRequire.resolve('@earendil-works/pi-ai/utils/transcript', esmConditions)).href);

function assistant(model, stopReason = 'stop') {
  return {
    role: 'assistant', content: [{ type: 'text', text: '受控回复' }],
    api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  };
}

function approve(messages) {
  return {
    providerId: 'custom', model: 'synthetic-m1',
    authorization: { mode: 'task', provider: 'custom', evidenceIds: ['note'] },
    payload: {
      providerId: 'custom', model: 'synthetic-m1', prompt: '整理', messages,
      attachments: [{ evidenceId: 'note', representation: 'extracted-text' }],
      scope: { evidenceIds: ['note'], contextMessageIds: ['u1', 'a1'] },
    },
  };
}

function controlledGateway(t, respond, { images = false, secret = 'synthetic-key' } = {}) {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Uncontrolled external HTTP request'); });
  const captured = { requests: [], registrations: [], runtimeOptions: [] };
  const create = sdk.ModelRuntime.create;
  const register = sdk.ModelRuntime.prototype.registerProvider;
  t.mock.method(sdk.ModelRuntime, 'create', async function (options) {
    captured.runtimeOptions.push(options);
    return create.call(this, options);
  });
  t.mock.method(sdk.ModelRuntime.prototype, 'registerProvider', function (id, config) {
    captured.registrations.push(config);
    return register.call(this, id, {
      ...config,
      streamSimple(model, context, options) {
        captured.requests.push({ model, context, options });
        const stream = createAssistantMessageEventStream();
        respond(stream, model, options);
        return stream;
      },
    });
  });
  const gateway = createModelGateway({ providerStore: {
    async readProvider() {
      return { config: { id: 'custom', name: 'Synthetic', kind: 'openai-compatible', endpoint: 'https://api.example.test/v1', capabilities: { images } }, secret };
    },
  } });
  return { gateway, captured };
}

function finish(stream, model, reason = 'stop') {
  const message = assistant(model, reason);
  if (reason === 'error' || reason === 'aborted') stream.push({ type: 'error', reason, error: message });
  else stream.push({ type: 'done', reason, message });
  stream.end();
}

const succeed = (stream, model) => finish(stream, model);

test('default gateway uses real Pi to send approved history and source-marked text/PDF', async (t) => {
  const { gateway, captured } = controlledGateway(t, succeed);
  const messages = [
    { role: 'user', content: [{ type: 'text', text: '授权历史问题' }] },
    { role: 'assistant', content: [{ type: 'text', text: '授权历史回答' }] },
    { role: 'user', content: [{ type: 'text', text: '整理' }, { type: 'text', text: '[材料：synthetic.txt]\n合成事实' }, { type: 'text', text: '[材料：synthetic.pdf]\n[第 1 页]\n合成报告' }] },
  ];
  const result = await gateway.send(approve(messages));
  assert.equal(result.text, '受控回复');
  assert.equal(result.delivered, true);
  assert.equal(captured.requests.length, 1);
  const transcript = captured.requests[0].context.messages.filter((message) => message.role !== 'system');
  assert.deepEqual(transcript.map((message) => message.role), ['user', 'assistant', 'user']);
  assert.deepEqual(transcript.map((message) => message.content.map((part) => part.text).join('\n\n')), messages.map((message) => message.content.map((part) => part.text).join('\n\n')));
  assert.deepEqual(getCurrentTools(captured.requests[0].context.messages), []);
  const system = getCurrentSystemPrompt(captured.requests[0].context.messages);
  assert.match(system, /慢波/);
  assert.equal(system.includes(process.cwd().replaceAll('\\', '/')), false);
  assert.doesNotMatch(system, /coding assistant|project_instructions|<cwd>/i);
});

test('default gateway supplies explicit memory credentials and disables implicit model calls', async (t) => {
  const { gateway, captured } = controlledGateway(t, succeed);
  await gateway.send(approve([{ role: 'user', content: [{ type: 'text', text: '/skill:synthetic 普通提问' }] }]));
  const options = captured.runtimeOptions[0];
  assert.ok(options.credentials, 'must not fall back to Pi global auth storage');
  assert.equal(options.modelsPath, null);
  assert.equal(options.allowModelNetwork, false);
  assert.equal(options.refreshOnCreate, false);
  assert.equal(await options.credentials.read('custom'), undefined);
  assert.deepEqual(await options.credentials.list(), []);
  assert.equal('apiKey' in captured.registrations[0], false);
  assert.equal(captured.requests[0].options.apiKey, 'synthetic-key');
  assert.equal(captured.requests[0].options.maxRetries, 0);
  assert.equal(captured.requests.length, 1);
});

test('image attachments use the same real Pi path without rewriting approved bytes', async (t) => {
  const { gateway, captured } = controlledGateway(t, succeed, { images: true });
  const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT3sAAAAASUVORK5CYII=';
  const result = await gateway.send(approve([{ role: 'user', content: [{ type: 'text', text: '看合成图片' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${imageData}` } }] }]));
  assert.equal(result.text, '受控回复');
  assert.equal(captured.requests.length, 1);
  assert.ok(captured.requests[0].model.input.includes('image'));
  assert.deepEqual(captured.requests[0].context.messages.at(-1).content, [{ type: 'text', text: '看合成图片' }, { type: 'image', mimeType: 'image/png', data: imageData }]);
});

test('gateway rejects images when the configured provider has not enabled them', async (t) => {
  const { gateway, captured } = controlledGateway(t, succeed);
  await assert.rejects(gateway.send(approve([{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==' } }] }])), /support.*image|image.*support/i);
  assert.equal(captured.requests.length, 0);
});

test('runtime treats a Key matching an environment name as a literal credential', async (t) => {
  const previous = process.env.MANBO_SYNTHETIC_KEY;
  process.env.MANBO_SYNTHETIC_KEY = 'unapproved-synthetic-value';
  t.after(() => {
    if (previous === undefined) delete process.env.MANBO_SYNTHETIC_KEY;
    else process.env.MANBO_SYNTHETIC_KEY = previous;
  });
  const { gateway, captured } = controlledGateway(t, succeed, { secret: 'MANBO_SYNTHETIC_KEY' });
  await gateway.send(approve([{ role: 'user', content: [{ type: 'text', text: '普通提问' }] }]));
  assert.equal(captured.requests[0].options.apiKey, 'MANBO_SYNTHETIC_KEY');
});

for (const reason of ['error', 'aborted', 'length']) {
  test(`real Pi ${reason} result is rejected even when it contains partial assistant text`, async (t) => {
    const { gateway, captured } = controlledGateway(t, (stream, model) => finish(stream, model, reason));
    await assert.rejects(gateway.send(approve([{ role: 'user', content: [{ type: 'text', text: '普通提问' }] }])), /failed|abort|incomplete|truncated/i);
    assert.equal(captured.requests.length, 1);
  });
}

test('unexpected model tool calls cannot trigger a second model request', async (t) => {
  const { gateway, captured } = controlledGateway(t, (stream, model) => {
    const message = assistant(model, 'toolUse');
    message.content = [{ type: 'toolCall', id: 'synthetic-tool', name: 'read', arguments: { path: 'not-authorized.txt' } }];
    // End later responses cleanly so an unfixed agent loop cannot hang the test.
    if (captured.requests.length > 1) finish(stream, model);
    else { stream.push({ type: 'done', reason: 'toolUse', message }); stream.end(); }
  });
  await assert.rejects(gateway.send(approve([{ role: 'user', content: [{ type: 'text', text: '普通提问' }] }])), /tool|incomplete|failed/i);
  assert.equal(captured.requests.length, 1);
});

test('pre-aborted request never reaches the provider', async (t) => {
  const { gateway, captured } = controlledGateway(t, succeed);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(gateway.send({ ...approve([{ role: 'user', content: [{ type: 'text', text: '普通提问' }] }]), signal: controller.signal }), /abort|failed/i);
  assert.equal(captured.requests.length, 0);
});

test('abort while streaming cancels Pi and does not report partial text as delivered', { timeout: 5_000 }, async (t) => {
  const controller = new AbortController();
  let observedAbort = false;
  const { gateway, captured } = controlledGateway(t, (stream, model, options) => {
    options.signal.addEventListener('abort', () => { observedAbort = true; finish(stream, model, 'aborted'); }, { once: true });
    setImmediate(() => controller.abort());
    // An unfixed cancellation path fails deterministically rather than hanging.
    const timer = setTimeout(() => finish(stream, model), 100);
    timer.unref();
  });
  await assert.rejects(gateway.send({ ...approve([{ role: 'user', content: [{ type: 'text', text: '普通提问' }] }]), signal: controller.signal }), /abort|failed/i);
  assert.equal(observedAbort, true);
  assert.equal(captured.requests.length, 1);
});
