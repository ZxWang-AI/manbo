import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from '@earendil-works/pi-coding-agent';
import { createEmptyResourceLoader } from './pi-resources.mjs';

test('empty loader exposes only the fixed prompt and immutable empty resources', async () => {
  const loader = createEmptyResourceLoader(sdk, 'fixed synthetic prompt');
  assert.equal(loader.getSystemPrompt(), 'fixed synthetic prompt');
  assert.equal(loader.getSystemPromptSource(), undefined);
  assert.deepEqual(loader.getAppendSystemPrompt(), []);
  assert.deepEqual(loader.getAppendSystemPromptSources(), []);
  assert.deepEqual(loader.getSkills(), { skills: [], diagnostics: [] });
  assert.deepEqual(loader.getPrompts(), { prompts: [], diagnostics: [] });
  assert.deepEqual(loader.getThemes(), { themes: [], diagnostics: [] });
  assert.deepEqual(loader.getAgentsFiles(), { agentsFiles: [] });
  const resources = loader.getExtensions();
  assert.deepEqual(resources.extensions, []);
  assert.deepEqual(resources.errors, []);
  assert.ok(resources.runtime.flagValues instanceof Map);
  assert.deepEqual(resources.runtime.pendingProviderRegistrations, []);
  assert.deepEqual(resources.runtime.pendingNativeProviderRegistrations, []);
  for (const list of [resources.extensions, resources.errors, loader.getSkills().skills,
    loader.getPrompts().prompts, loader.getThemes().themes, loader.getAgentsFiles().agentsFiles,
    loader.getAppendSystemPrompt(), loader.getAppendSystemPromptSources()]) {
    assert.throws(() => list.push('unapproved'), TypeError);
  }
  assert.throws(() => { loader.getExtensions = () => ({ extensions: ['unapproved'] }); }, TypeError);
  await loader.reload();
  assert.equal(loader.getExtensions(), resources);
});

test('each empty loader owns a separate extension runtime', () => {
  const first = createEmptyResourceLoader(sdk, 'one').getExtensions().runtime;
  const second = createEmptyResourceLoader(sdk, 'two').getExtensions().runtime;
  assert.notEqual(first, second);
  first.flagValues.set('synthetic', true);
  first.registerProvider('synthetic-provider', {});
  assert.equal(second.flagValues.has('synthetic'), false);
  assert.deepEqual(second.pendingProviderRegistrations, []);
});

test('resource injection rejects nonempty, malformed or unknown paths', async () => {
  const loader = createEmptyResourceLoader(sdk, 'fixed');
  for (const paths of [undefined, {}, { skillPaths: [], promptPaths: [], themePaths: [] }]) {
    assert.doesNotThrow(() => loader.extendResources(paths));
  }
  for (const paths of [null, [], 'path', { extensions: [] }, { skillPaths: undefined },
    { skillPaths: 'path' }, { skillPaths: [{ path: 'unapproved' }] },
    { promptPaths: [{ path: 'unapproved' }] }, { themePaths: [{ path: 'unapproved' }] }]) {
    assert.throws(() => loader.extendResources(paths), /disabled/);
  }
  await loader.reload();
  assert.deepEqual(loader.getSkills().skills, []);
  assert.equal(loader.getSystemPrompt(), 'fixed');
});
