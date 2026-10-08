import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('new chat bridge exposes structured conversation operations without secrets or generic IPC', async () => {
  const preload = await readFile(new URL('./preload.cjs', import.meta.url), 'utf8');
  for (const channel of ['conversation:list', 'conversation:create', 'conversation:load', 'chat:preview-v2', 'chat:send-v2', 'chat:result', 'chat:discard-preview', 'chat:abort']) {
    assert.match(preload, new RegExp(channel.replace(':', '\\:')));
  }
  assert.doesNotMatch(preload, /ipcRenderer\.(send|on|postMessage)|safeStorage|process\.env|generic|invoke:\s*\(/i);
});

test('main chat handlers keep attachment reads behind case IDs and confirmation', async () => {
  const main = await readFile(new URL('./main.cjs', import.meta.url), 'utf8');
  assert.match(main, /readEvidenceForOutbound/);
  assert.match(main, /import\('\.\.\/core\/evidence-reader\.mjs'\)/);
  assert.match(main, /reader\.readEvidenceForOutbound\(vaultRoot\(\), caseId, evidenceId\)/);
  assert.doesNotMatch(main, /bytes\.toString\('utf8'\)|pages:\s*\[\]/);
  assert.match(main, /createRequestLifecycle/);
  assert.match(main, /chatLifecycle\(\)\)\.start\(input\)/);
  assert.match(main, /chatLifecycle\(\)\)\.result\(requestId\)/);
  assert.match(main, /providerStore:\{readProvider/);
  assert.match(main, /appendExchange/);
  assert.doesNotMatch(main, /ipcMain\.handle\(['"]chat:send-v2['"][\s\S]{0,800}readFile\(input\.path/i);
});
