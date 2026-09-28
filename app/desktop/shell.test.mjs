import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preloadPath = new URL('./preload.cjs', import.meta.url);
const mainPath = new URL('./main.cjs', import.meta.url);
const htmlPath = new URL('./index.html', import.meta.url);

test('preload exposes only the narrow case bridge', async () => {
  const source = await readFile(preloadPath, 'utf8');
  assert.match(source, /contextBridge\.exposeInMainWorld\(['"]manbo['"]/);
  assert.deepEqual([...source.matchAll(/\n\s*(\w+):\s*\(/g)].map((match) => match[1]).sort(), ['createCase', 'importEvidence', 'listCases'].sort());
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
  assert.doesNotMatch(source, /shell\.openExternal|execute|apiKey|process\.env/i);
});

test('desktop HTML is self-contained and explains the external model boundary', async () => {
  const source = await readFile(htmlPath, 'utf8');
  assert.match(source, /案件和材料保存在本设备/);
  assert.match(source, /导入不会上传/);
  assert.match(source, /云端 AI/);
  assert.doesNotMatch(source, /<script[^>]+src=['"]https?:/i);
  assert.match(source, /<script src=['"]\.\/renderer\.js['"]><\/script>/);
  assert.doesNotMatch(source, /<script>(?!\s*<\/script>)[\s\S]*?<\/script>/i);
  await readFile(new URL('./renderer.js', import.meta.url), 'utf8');
});
