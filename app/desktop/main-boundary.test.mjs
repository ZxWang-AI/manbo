import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { constants, Script } from 'node:vm';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createConversation as createLegacyConversation, appendMessage } from '../core/conversations.mjs';

const mainUrl = new URL('./main.cjs', import.meta.url);
const mainFile = fileURLToPath(mainUrl);
const localUrl = pathToFileURL(join(dirname(mainFile), 'index.html')).href;

async function fixture(t, { platform = process.platform, backend = 'synthetic_encrypted', dialogError } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'manbo-ipc-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const handlers = new Map();
  const windows = [];
  let dialogs = 0;
  const app = new EventEmitter();
  app.getPath = () => root;
  app.whenReady = () => Promise.resolve();
  app.quit = () => {};
  class Window extends EventEmitter {
    constructor() {
      super(); this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: localUrl, isDestroyed: () => false };
      this.webContents.isDestroyed = () => this.destroyed;
      this.webContents.setWindowOpenHandler = (fn) => { this.openHandler = fn; };
      this.webContents.session = {
        setPermissionRequestHandler: (fn) => { this.permissionRequest = fn; },
        setPermissionCheckHandler: (fn) => { this.permissionCheck = fn; },
        on: (event, fn) => { if (event === 'will-download') this.download = fn; },
      };
      windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    async loadFile() {}
  }
  Window.getAllWindows = () => windows.filter((window) => !window.destroyed);
  const electron = {
    app, BrowserWindow: Window,
    dialog: { async showOpenDialog() { dialogs++; if (dialogError) throw dialogError; return { canceled: true, filePaths: [] }; } },
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => backend,
      encryptString: (value) => Buffer.from(`synthetic-encrypted:${value}`),
      decryptString: (value) => value.toString().replace(/^synthetic-encrypted:/, ''),
    },
  };
  const actualRequire = createRequire(mainUrl);
  new Script(await readFile(mainUrl, 'utf8'), { filename: mainFile, importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
    .runInNewContext({ require: (name) => name === 'electron' ? electron : actualRequire(name), __dirname: dirname(mainFile), process: { platform }, Buffer, AbortController });
  await new Promise((resolve) => setImmediate(resolve));
  const window = windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  return { root, handlers, window, trusted, app, dialogs: () => dialogs };
}

test('every real main IPC registration rejects foreign windows before any operation', async (t) => {
  const { handlers, window } = await fixture(t);
  for (const [channel, handler] of handlers) {
    await assert.rejects(handler({ sender: {}, senderFrame: window.webContents.mainFrame }), /Untrusted IPC/, channel);
  }
});

test('subframes, missing frames, remote documents and destroyed app windows are denied', async (t) => {
  const { handlers, window, trusted, dialogs } = await fixture(t);
  const handler = handlers.get('evidence:import');
  for (const event of [
    { sender: trusted.sender, senderFrame: { url: localUrl } },
    { sender: trusted.sender },
  ]) await assert.rejects(handler(event, '00000000-0000-4000-8000-000000000001'), /Untrusted IPC/);
  trusted.senderFrame.url = 'https://example.test/';
  await assert.rejects(handler(trusted, '00000000-0000-4000-8000-000000000001'), /Untrusted IPC/);
  trusted.senderFrame.url = localUrl;
  window.destroyed = true;
  await assert.rejects(handler(trusted, '00000000-0000-4000-8000-000000000001'), /Untrusted IPC/);
  assert.equal(dialogs(), 0);
});

test('a live exact main document still performs local create/list operations', async (t) => {
  const { handlers, trusted } = await fixture(t);
  assert.equal((await handlers.get('case:list')(trusted)).length, 0);
  const created = await handlers.get('case:create')(trusted);
  assert.equal((await handlers.get('case:list')(trusted))[0].id, created.id);
});

test('window policies deny navigation, redirects, popup, webview, downloads and permissions', async (t) => {
  const { window } = await fixture(t);
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    let prevented = false;
    window.webContents.emit(name, { preventDefault() { prevented = true; } });
    assert.equal(prevented, true, name);
  }
  assert.equal(window.openHandler({ url: 'https://example.test/' }).action, 'deny');
  assert.equal(window.permissionCheck({}, 'clipboard-read'), false);
  let permitted;
  window.permissionRequest({}, 'camera', (value) => { permitted = value; });
  assert.equal(permitted, false);
  let prevented = false;
  window.download({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('Linux basic_text backend cannot save a Key through the real provider handler', async (t) => {
  const { handlers, trusted } = await fixture(t, { platform: 'linux', backend: 'basic_text' });
  await assert.rejects(handlers.get('provider:save')(trusted, {
    id: 'synthetic', name: 'Synthetic', kind: 'openai-compatible', model: 'synthetic', endpoint: 'https://example.test/v1',
  }, 'SYNTHETIC-KEY-NOT-REAL'));
});

test('trusted IPC failures never forward native error contents to the renderer', async (t) => {
  const { handlers, trusted } = await fixture(t, { dialogError: new Error('SYNTHETIC-KEY prompt body echoed') });
  await assert.rejects(handlers.get('evidence:import')(trusted, '00000000-0000-4000-8000-000000000001'), (error) => {
    assert.doesNotMatch(error.message, /SYNTHETIC|prompt body|echoed/);
    return /操作未完成/.test(error.message);
  });
});

test('case conversation creation migrates an existing legacy conversation without altering it', async (t) => {
  const { root, handlers, trusted } = await fixture(t);
  const currentCase = await handlers.get('case:create')(trusted);
  const legacy = await createLegacyConversation(join(root, 'cases'), currentCase.id);
  await appendMessage(join(root, 'cases'), currentCase.id, { role: 'user', text: 'Synthetic legacy note', evidenceIds: [] });
  const source = join(root, 'cases', currentCase.id, 'conversation.json'); const before = await readFile(source);
  const conversation = await handlers.get('conversation:create')(trusted, { caseId: currentCase.id });
  assert.equal(conversation.id, legacy.id);
  assert.equal(conversation.messages[0].text, 'Synthetic legacy note');
  assert.deepEqual(await readFile(source), before);
});
