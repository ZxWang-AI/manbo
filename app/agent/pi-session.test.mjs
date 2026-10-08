import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createIsolatedModelRuntime, createNoToolSession } from './pi-session.mjs';

test('creates an in-memory Pi session with no tools or project discovery', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'manbo-pi-'));
  const calls = [];
  let settingsInput;
  const session = { agent: {}, dispose: async () => calls.push('dispose') };
  const sdk = {
    ModelRuntime: { create: async () => ({ kind: 'isolated-runtime' }) },
    SessionManager: { inMemory: () => ({ kind: 'session-memory' }) },
    SettingsManager: { inMemory: (settings) => { settingsInput = settings; return { kind: 'settings-memory' }; } },
    createExtensionRuntime: () => ({ kind: 'extension-runtime' }),
    createAgentSession: async (options) => {
      calls.push(['create', options]);
      return { session };
    },
  };

  const result = await createNoToolSession({ cwd, sdk });
  const create = calls.find((entry) => entry[0] === 'create')[1];
  assert.equal(create.cwd, cwd);
  assert.equal(create.noTools, 'all');
  assert.deepEqual(create.tools, []);
  assert.deepEqual(create.sessionManager, { kind: 'session-memory' });
  assert.deepEqual(create.settingsManager, { kind: 'settings-memory' });
  assert.equal(settingsInput.compaction.enabled, false);
  assert.equal(settingsInput.retry.enabled, false);
  assert.equal(settingsInput.retry.provider.maxRetries, 0);
  assert.equal(settingsInput.cacheWarming, 'off');
  assert.equal(settingsInput.images.autoResize, false);
  assert.equal(settingsInput.enableAnalytics, false);
  assert.equal(settingsInput.enableInstallTelemetry, false);
  assert.ok(create.resourceLoader);
  assert.deepEqual(create.resourceLoader.getSkills(), { skills: [], diagnostics: [] });
  assert.deepEqual(create.resourceLoader.getPrompts(), { prompts: [], diagnostics: [] });
  assert.deepEqual(create.resourceLoader.getThemes(), { themes: [], diagnostics: [] });
  assert.deepEqual(create.resourceLoader.getAgentsFiles(), { agentsFiles: [] });
  assert.deepEqual(create.resourceLoader.getExtensions(), { extensions: [], errors: [], runtime: { kind: 'extension-runtime' } });
  assert.match(create.resourceLoader.getSystemPrompt(), /慢波/);
  assert.equal(create.resourceLoader.getSystemPromptSource(), undefined);
  assert.deepEqual(create.resourceLoader.getAppendSystemPrompt(), []);
  assert.deepEqual(create.resourceLoader.getAppendSystemPromptSources(), []);
  assert.throws(() => create.resourceLoader.extendResources({ skillPaths: ['hostile'] }), /disabled/);
  assert.ok(create.agentDir);
  assert.notEqual(create.agentDir, cwd);
  assert.equal(create.agentDir.startsWith(cwd), false);
  assert.deepEqual(await readdir(create.agentDir), []);
  await result.dispose();
  assert.deepEqual(calls.at(-1), 'dispose');
  await assert.rejects(stat(create.agentDir), { code: 'ENOENT' });
  await rm(cwd, { recursive: true, force: true });
});

test('rejects a missing cwd and a caller tool override', async () => {
  const sdk = { createAgentSession: async () => ({ session: { dispose() {} } }) };
  await assert.rejects(createNoToolSession({ cwd: join(tmpdir(), 'missing-manbo-cwd'), sdk }), /cwd/i);
  const cwd = await mkdtemp(join(tmpdir(), 'manbo-pi-'));
  await assert.rejects(createNoToolSession({ cwd, tools: ['bash'], sdk }), /tools/i);
  await rm(cwd, { recursive: true, force: true });
});

test('creates a real Pi SDK session with empty active, callable and registered tools', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'manbo-real-pi-'));
  try {
    const result = await createNoToolSession({ cwd });
    assert.deepEqual(result.session.getActiveToolNames(), []);
    assert.deepEqual(result.session.getCallableToolNames(), []);
    assert.deepEqual(result.session.getAllTools(), []);
    assert.deepEqual(result.session.resourceLoader.getExtensions().extensions, []);
    await result.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('real Pi session never probes project/global resources or starts network/process work', async (t) => {
  const sdk = await import('@earendil-works/pi-coding-agent');
  const sdkRequire = createRequire(import.meta.resolve('@earendil-works/pi-coding-agent'));
  const { createAssistantMessageEventStream } = await import(pathToFileURL(sdkRequire.resolve(
    '@earendil-works/pi-ai/utils/event-stream', { conditions: new Set(['node', 'import']) },
  )).href);
  const fixture = await mkdtemp(join(tmpdir(), 'manbo-pi-discovery-'));
  const cwd = join(fixture, 'project');
  const globalDir = join(fixture, 'global');
  await fsPromises.mkdir(join(cwd, '.pi', 'extensions'), { recursive: true });
  await fsPromises.mkdir(join(globalDir, 'extensions'), { recursive: true });
  const files = new Map([
    [join(cwd, 'AGENTS.md'), 'SYNTHETIC_UNAPPROVED_PROJECT_INSTRUCTIONS'],
    [join(cwd, '.pi', 'settings.json'), '{"extensions":["./extensions/unapproved.mjs"]}'],
    [join(globalDir, 'settings.json'), '{"extensions":["./extensions/unapproved.mjs"]}'],
    [join(globalDir, 'auth.json'), '{"synthetic-unapproved":{"type":"api_key","key":"synthetic-not-for-use"}}'],
    [join(globalDir, 'models.json'), '{"providers":{}}'],
    [join(cwd, '.pi', 'extensions', 'unapproved.mjs'), 'throw new Error("unapproved project extension executed");'],
    [join(globalDir, 'extensions', 'unapproved.mjs'), 'throw new Error("unapproved global extension executed");'],
  ]);
  for (const [path, content] of files) await fsPromises.writeFile(path, content);
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = globalDir;
  const accesses = [];
  const effects = [];
  const isResource = (path) => {
    const normalized = String(path).replaceAll('\\', '/').toLowerCase();
    return normalized.startsWith(globalDir.replaceAll('\\', '/').toLowerCase()) ||
      /\/(?:\.pi)(?:\/|$)|\/(?:agents\.md|auth\.json|models\.json|settings\.json)$/.test(normalized);
  };
  const observe = (object, names) => {
    for (const name of names) {
      const original = object[name];
      t.mock.method(object, name, function (...args) {
        if (isResource(args[0])) accesses.push({ operation: name, path: String(args[0]) });
        return original.apply(this, args);
      });
    }
  };
  observe(fs, ['existsSync', 'readFileSync', 'readdirSync', 'statSync', 'lstatSync', 'realpathSync', 'openSync', 'writeFileSync', 'mkdirSync']);
  observe(fsPromises, ['access', 'readFile', 'readdir', 'stat', 'lstat', 'realpath', 'open', 'writeFile', 'mkdir']);
  const block = (object, name) => t.mock.method(object, name, () => {
    effects.push(name);
    throw new Error(`Unapproved side effect: ${name}`);
  });
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) block(childProcess, name);
  for (const object of [http, https]) for (const name of ['request', 'get']) block(object, name);
  for (const name of ['connect', 'createConnection']) block(net, name);
  block(tls, 'connect');
  block(globalThis, 'fetch');
  syncBuiltinESMExports();
  let result;
  try {
    // Positive control: the same flags still perform resource discovery in Pi.
    const discovery = new sdk.DefaultResourceLoader({
      cwd, agentDir: globalDir, settingsManager: sdk.SettingsManager.inMemory(),
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    });
    await discovery.reload();
    assert.ok(accesses.length > 0, 'resource I/O observer must catch actual DefaultResourceLoader probes');
    accesses.length = 0;
    effects.length = 0;

    const runtime = await createIsolatedModelRuntime(sdk);
    const requests = [];
    runtime.registerProvider('synthetic-isolation', {
      baseUrl: 'https://api.example.test/v1', api: 'openai-completions',
      models: [{ id: 'synthetic-m1', name: 'Synthetic', reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_192 }],
      streamSimple(model, context) {
        requests.push(context);
        const stream = createAssistantMessageEventStream();
        const message = { role: 'assistant', content: [{ type: 'text', text: '合成隔离回复' }],
          api: model.api, provider: model.provider, model: model.id, stopReason: 'stop', timestamp: 0,
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
        stream.push({ type: 'done', reason: 'stop', message });
        stream.end();
        return stream;
      },
    });
    await runtime.setRuntimeApiKey('synthetic-isolation', 'synthetic-memory-only-key');
    result = await createNoToolSession({ cwd, sdk, modelRuntime: runtime,
      selectedModel: runtime.getModel('synthetic-isolation', 'synthetic-m1'),
      promptContext: { messages: [{ role: 'user', content: [{ type: 'text', text: '/skill:synthetic 普通提问' }] }] } });
    assert.deepEqual(result.session.getActiveToolNames(), []);
    assert.deepEqual(result.session.getCallableToolNames(), []);
    assert.deepEqual(result.session.getAllTools(), []);
    assert.deepEqual(result.session.resourceLoader.getExtensions().extensions, []);
    assert.deepEqual(result.session.resourceLoader.getExtensions().errors, []);
    assert.equal(await result.prompt('ordinary question'), '合成隔离回复');
    assert.equal(requests.length, 1);
    assert.doesNotMatch(JSON.stringify(requests), /SYNTHETIC_UNAPPROVED|synthetic-not-for-use/);
    await result.session.reload();
    assert.deepEqual(result.session.getActiveToolNames(), []);
    assert.deepEqual(result.session.getCallableToolNames(), []);
    assert.deepEqual(result.session.getAllTools(), []);
    await result.dispose();
    result = undefined;
    assert.deepEqual(accesses, [], 'adapter must not probe unapproved resources before filtering them');
    assert.deepEqual(effects, [], 'adapter must not launch subprocesses or uncontrolled network work');
  } finally {
    await result?.dispose();
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    for (const [path, content] of files) assert.equal(await fsPromises.readFile(path, 'utf8'), content);
    await rm(fixture, { recursive: true, force: true });
  }
});
