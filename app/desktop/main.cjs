const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

let chatLifecyclePromise;
const documentUrl = pathToFileURL(join(__dirname, 'index.html')).href;
let mainWindow = null;

function assertTrusted(event) {
  const contents = mainWindow?.webContents;
  if (!mainWindow || mainWindow.isDestroyed() || !contents || contents.isDestroyed()
    || !event || event.sender !== contents || !event.senderFrame
    || event.senderFrame !== contents.mainFrame || event.senderFrame.isDestroyed()
    || event.senderFrame.url !== documentUrl) {
    throw new Error('Untrusted IPC sender');
  }
}

function handle(channel, operation) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrusted(event);
    try { return await operation(event, ...args); }
    catch {
      // Provider errors can echo Keys, prompts or response bodies. Never forward them.
      throw new Error('操作未完成，请检查输入或本地配置；详细供应商错误不会展示。');
    }
  });
}

function vaultRoot() {
  return join(app.getPath('userData'), 'cases');
}

function settingsRoot() {
  return join(app.getPath('userData'), 'settings');
}

let settingsPromise;
async function providerSettings() {
  settingsPromise ??= import('../core/secret-store.mjs').then(({ createSafeSecretStore }) => ({
    root: settingsRoot(),
    secretStore: createSafeSecretStore({ root: settingsRoot(), safeStorage, platform: process.platform }),
  }));
  return settingsPromise;
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow = window;
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-redirect', 'will-attach-webview']) {
    window.webContents.on(name, (event) => event.preventDefault());
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.on('will-download', (event) => event.preventDefault());
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
    if (chatLifecyclePromise) void chatLifecyclePromise.then((lifecycle) => lifecycle.dispose());
    chatLifecyclePromise = null;
  });
  await window.loadFile(join(__dirname, 'index.html'));
}

handle('case:create', async () => {
  const { createCase } = await import('../core/cases.mjs');
  return createCase(vaultRoot());
});
handle('case:list', async () => {
  const { listCases } = await import('../core/cases.mjs');
  return listCases(vaultRoot());
});
handle('evidence:import', async (event, caseId) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (result.canceled || result.filePaths.length !== 1) return null;
  const { importEvidence } = await import('../core/cases.mjs');
  return importEvidence(vaultRoot(), caseId, result.filePaths[0]);
});
handle('send:preview', async (event, caseId, draft) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readCase } = await import('../core/cases.mjs');
  const { previewSend } = await import('../core/send.mjs');
  return previewSend(await readCase(vaultRoot(), caseId), draft);
});
handle('send:confirm', async (event, caseId, draft, confirmation) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readCase } = await import('../core/cases.mjs');
  const { confirmSend } = await import('../core/send.mjs');
  return confirmSend(await readCase(vaultRoot(), caseId), draft, confirmation);
});
handle('provider:list', async () => {
  const { listProviders } = await import('../core/providers.mjs');
  return listProviders(await providerSettings());
});
handle('provider:save', async (event, config, secret) => {
  const { saveProvider } = await import('../core/providers.mjs');
  return saveProvider(await providerSettings(), config, secret);
});
handle('provider:delete', async (event, providerId) => {
  const { deleteProvider } = await import('../core/providers.mjs');
  await deleteProvider(await providerSettings(), providerId);
  return { deleted: true };
});
handle('chat:load', async (event, caseId) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readConversation } = await import('../core/conversations.mjs');
  return readConversation(vaultRoot(), caseId);
});
handle('chat:send', async (event, caseId, draft, confirmation) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readCase } = await import('../core/cases.mjs');
  const { confirmSend } = await import('../core/send.mjs');
  const { appendMessage } = await import('../core/conversations.mjs');
  const { createLocalDemoBroker } = await import('../core/broker.mjs');
  const result = confirmSend(await readCase(vaultRoot(), caseId), draft, confirmation);
  const response = await createLocalDemoBroker().send({
    authorization: result.authorization,
    prompt: result.prompt,
    evidenceIds: result.authorization.evidenceIds,
  });
  const userMessage = await appendMessage(vaultRoot(), caseId, {
    role: 'user',
    text: result.prompt,
    evidenceIds: result.authorization.evidenceIds,
  });
  const assistantMessage = await appendMessage(vaultRoot(), caseId, {
    role: 'assistant',
    text: response.text,
    evidenceIds: result.authorization.evidenceIds,
  });
  return Object.freeze({ ...result, messages: [userMessage, assistantMessage] });
});

let chatStorePromise;
function chatStore() {
  chatStorePromise ??= import('../core/chat-store.mjs').then(({ createChatStore }) => createChatStore(vaultRoot()));
  return chatStorePromise;
}

async function readEvidenceForOutbound(caseId, evidenceId) {
  if (typeof caseId !== 'string') throw new Error('Evidence requires a case');
  const reader = await import('../core/evidence-reader.mjs');
  return reader.readEvidenceForOutbound(vaultRoot(), caseId, evidenceId);
}

handle('conversation:list', async () => (await chatStore()).list());
handle('conversation:create', async (event, options = {}) => {
  if (!options || typeof options !== 'object') throw new Error('Invalid conversation options');
  const store = await chatStore();
  if (options.caseId) {
    const { readCase } = await import('../core/cases.mjs');
    await readCase(vaultRoot(), options.caseId);
    const migrated = await store.migrateLegacy(options.caseId);
    if (migrated) return migrated;
  }
  return store.create({ caseId: options.caseId ?? null, title: options.title });
});
handle('conversation:load', async (event, conversationId) => (await chatStore()).read(conversationId));
async function prepareChat(input = {}) {
  if (!input || typeof input !== 'object' || typeof input.conversationId !== 'string') throw new Error('Invalid chat preview');
  const store = await chatStore();
  const conversation = await store.read(input.conversationId);
  const caseManifest = conversation.caseId ? await (await import('../core/cases.mjs')).readCase(vaultRoot(), conversation.caseId) : { evidence: [] };
  const { readProvider } = await import('../core/providers.mjs');
  const provider = await readProvider(await providerSettings(), input.draft?.provider);
  if (provider.config.id === 'local-demo' || !provider.secret) throw new Error('Configured Key required');
  const { prepareOutbound, previewFromPayload } = await import('../core/outbound-payload.mjs');
  const payload = await prepareOutbound({ caseManifest, conversation, draft: { ...input.draft, model: input.draft?.model ?? provider.config.model }, readEvidence: (id) => readEvidenceForOutbound(conversation.caseId, id), capabilities: provider.config.capabilities });
  return { conversationId:conversation.id, revision:conversation.updatedAt, provider, payload, preview:previewFromPayload(payload) };
}

function chatLifecycle() {
  chatLifecyclePromise ??= import('../core/request-lifecycle.mjs').then(({ createRequestLifecycle }) => createRequestLifecycle({
    prepare:prepareChat,
    async send(prepared,{signal}) {
      const { createModelGateway } = await import('../agent/model-gateway.mjs');
      const providerId = prepared.provider.config.id;
      const gateway = createModelGateway({providerStore:{readProvider:async (id) => {
        if (id !== providerId) throw new Error('Provider mismatch');
        return prepared.provider;
      }}});
      return gateway.send({providerId,model:prepared.payload.model,payload:prepared.payload,
        authorization:{mode:'task',provider:providerId,evidenceIds:prepared.payload.scope.evidenceIds},signal});
    },
    async persist(prepared,response,{requestId}) {
      const evidenceIds = prepared.payload.scope.evidenceIds;
      return (await chatStore()).appendExchange(prepared.conversationId,{
        segment:{sensitivity:evidenceIds.length ? 'evidence' : 'clean',providerId:prepared.provider.config.id,evidenceIds},
        user:prepared.payload.prompt,assistant:response.text,requestId,
      });
    },
  }));
  return chatLifecyclePromise;
}

handle('chat:preview-v2', async (event,input) => (await chatLifecycle()).preview(input));
handle('chat:send-v2', async (event,input) => (await chatLifecycle()).start(input));
handle('chat:result', async (event,requestId) => (await chatLifecycle()).result(requestId));
handle('chat:discard-preview', async (event,receiptId) => (await chatLifecycle()).discard(receiptId));
handle('chat:abort', async (event,requestId) => (await chatLifecycle()).abort(requestId));

app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
