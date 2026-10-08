import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const userData = await mkdtemp(join(tmpdir(), 'manbo-electron-smoke-'));
const port = 9300 + Math.floor(Math.random() * 500);
const binary = process.platform === 'win32'
  ? join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
  : join(root, 'node_modules', '.bin', 'electron');
const child = spawn(binary, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '.'], { cwd: root, stdio: 'ignore', windowsHide: true });

async function readJson() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return response.json();
}

try {
  let targets;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      targets = await readJson();
      if (Array.isArray(targets) && targets.some((target) => /app[\\/]desktop[\\/]index\.html/.test(target.url) && /慢波 Manbo/.test(target.title))) break;
    } catch { /* wait for Electron's page target */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const pageTarget = targets?.find((target) => /app[\\/]desktop[\\/]index\.html/.test(target.url));
  assert.ok(pageTarget, 'Electron did not expose the desktop page target');
  assert.match(pageTarget.title, /慢波 Manbo/);
  console.log('Electron smoke test passed: desktop page target loaded without a network dependency.');
} finally {
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
  await rm(userData, { recursive: true, force: true });
}
