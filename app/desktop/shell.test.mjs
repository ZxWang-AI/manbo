import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preloadPath = new URL('./preload.cjs', import.meta.url);
const mainPath = new URL('./main.cjs', import.meta.url);
const htmlPath = new URL('./index.html', import.meta.url);

test('preload exposes only the narrow case bridge', async () => {
  const source = await readFile(preloadPath, 'utf8');
  assert.match(source, /contextBridge\.exposeInMainWorld\(['"]manbo['"]/);
  assert.deepEqual([...source.matchAll(/\n\s*(\w+):\s*\(/g)].map((match) => match[1]).sort(), ['abortChat', 'confirmSend', 'createCase', 'createConversation', 'deleteProvider', 'importEvidence', 'listCases', 'listConversations', 'listProviders', 'loadConversation', 'loadConversationRecord', 'previewChat', 'previewSend', 'saveProvider', 'sendChat', 'sendMessage'].sort());
  assert.doesNotMatch(source, /path|shell|execute|apiKey|token/i);
});

test('desktop main declares renderer isolation and local-only IPC channels', async () => {
  const source = await readFile(mainPath, 'utf8');
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webSecurity:\s*true/);
  assert.match(source, /case:create/);
  assert.match(source, /case:list/);
  assert.match(source, /evidence:import/);
  assert.match(source, /send:preview/);
  assert.match(source, /send:confirm/);
  assert.match(source, /provider:list/);
  assert.match(source, /provider:save/);
  assert.match(source, /provider:delete/);
  assert.match(source, /chat:load/);
  assert.match(source, /chat:send/);
  assert.match(source, /conversation:list/);
  assert.match(source, /conversation:create/);
  assert.match(source, /chat:preview-v2/);
  assert.match(source, /chat:send-v2/);
  assert.match(source, /chat:abort/);
  assert.match(source, /safeStorage/);
  assert.doesNotMatch(source, /shell\.openExternal|execute|apiKey|process\.env/i);
});

test('desktop HTML is self-contained and explains the external model boundary', async () => {
  const source = await readFile(htmlPath, 'utf8');
  assert.match(source, /本机优先/);
  assert.match(source, /导入不会上传/);
  assert.match(source, /模型供应商/);
  assert.match(source, /确认本次发送范围/);
  for (const id of ['workspace', 'composer-input', 'provider', 'send', 'confirmation', 'settings', 'settings-dialog', 'message-stream', 'sidebar', 'evidence-rail', 'attachment-chips']) {
    assert.match(source, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(source, /<script[^>]+src=['"]https?:/i);
  assert.match(source, /<script src=['"]\.\/renderer\.js['"]><\/script>/);
  assert.doesNotMatch(source, /<script>(?!\s*<\/script>)[\s\S]*?<\/script>/i);
  await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
});

test('renderer keeps attachments in a draft and only invokes confirmation after preview', async () => {
  const source = await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
  assert.match(source, /previewChat/);
  assert.match(source, /sendChat/);
  assert.match(source, /accepted:\s*true/);
  assert.match(source, /selectedEvidenceIds/);
  assert.match(source, /loadConversationRecord/);
  assert.match(source, /listConversations/);
  assert.match(source, /listProviders/);
  assert.match(source, /saveProvider/);
  assert.doesNotMatch(source, /fetch\(|XMLHttpRequest|sendBeacon/);
});
