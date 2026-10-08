import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNoToolSession } from './pi-session.mjs';

test('creates an in-memory Pi session with no tools or project discovery', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'manbo-pi-'));
  const calls = [];
  let loaderOptions;
  let settingsInput;
  const session = { agent: {}, dispose: async () => calls.push('dispose') };
  const sdk = {
    ModelRuntime: { create: async () => ({ kind: 'isolated-runtime' }) },
    SessionManager: { inMemory: () => ({ kind: 'session-memory' }) },
    SettingsManager: { inMemory: (settings) => { settingsInput = settings; return { kind: 'settings-memory' }; } },
    DefaultResourceLoader: class {
      constructor(options) { loaderOptions = options; calls.push(['loader', options]); }
      async reload() {
        calls.push('reload');
        assert.notEqual(loaderOptions.agentDir, cwd);
        assert.equal(loaderOptions.agentDir.startsWith(`${cwd}/`), false);
        assert.deepEqual(await readdir(loaderOptions.agentDir), []);
      }
    },
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
  assert.equal(loaderOptions.settingsManager, create.settingsManager);
  assert.equal(settingsInput.compaction.enabled, false);
  assert.equal(settingsInput.retry.enabled, false);
  assert.equal(settingsInput.retry.provider.maxRetries, 0);
  assert.equal(settingsInput.cacheWarming, 'off');
  assert.equal(settingsInput.images.autoResize, false);
  assert.equal(settingsInput.enableAnalytics, false);
  assert.equal(settingsInput.enableInstallTelemetry, false);
  assert.ok(create.resourceLoader);
  assert.deepEqual(loaderOptions.skillsOverride({ skills: ['hostile'], diagnostics: ['hostile'] }), { skills: [], diagnostics: [] });
  assert.deepEqual(loaderOptions.agentsFilesOverride({ agentsFiles: ['hostile'] }), { agentsFiles: [] });
  assert.deepEqual(loaderOptions.promptsOverride({ prompts: ['hostile'], diagnostics: ['hostile'] }), { prompts: [], diagnostics: [] });
  assert.deepEqual(loaderOptions.extensionsOverride({ extensions: ['hostile'], errors: ['hostile'], runtime: 'runtime' }), { extensions: [], errors: [], runtime: 'runtime' });
  assert.equal(loaderOptions.noExtensions, true);
  assert.equal(loaderOptions.noSkills, true);
  assert.equal(loaderOptions.noPromptTemplates, true);
  assert.equal(loaderOptions.noThemes, true);
  assert.equal(loaderOptions.noContextFiles, true);
  assert.equal(loaderOptions.cwd, cwd);
  assert.ok(loaderOptions.agentDir);
  assert.equal(calls.some((entry) => entry[0] === 'loader'), true);
  assert.equal(calls.includes('reload'), true);
  await result.dispose();
  assert.deepEqual(calls.at(-1), 'dispose');
  await assert.rejects(stat(loaderOptions.agentDir), { code: 'ENOENT' });
  await rm(cwd, { recursive: true, force: true });
});

test('rejects a missing cwd and a caller tool override', async () => {
  const sdk = { createAgentSession: async () => ({ session: { dispose() {} } }) };
  await assert.rejects(createNoToolSession({ cwd: join(tmpdir(), 'missing-manbo-cwd'), sdk }), /cwd/i);
  const cwd = await mkdtemp(join(tmpdir(), 'manbo-pi-'));
  await assert.rejects(createNoToolSession({ cwd, tools: ['bash'], sdk }), /tools/i);
  await rm(cwd, { recursive: true, force: true });
});

test('creates a real Pi SDK session with an empty active tool set', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'manbo-real-pi-'));
  try {
    const result = await createNoToolSession({ cwd });
    assert.deepEqual(result.session.getActiveToolNames(), []);
    await result.dispose();
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
