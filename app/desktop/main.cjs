const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

const activeChatRequests = new Map();
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
    for (const controller of activeChatRequests.values()) controller.abort();
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

async function configuredProviderStore() {
  const { readProvider } = await import('../core/providers.mjs');
  const settings = await providerSettings();
  return { readProvider: (id) => readProvider(settings, id) };
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
handle('chat:preview-v2', async (event, input = {}) => {
  if (!input || typeof input !== 'object' || typeof input.conversationId !== 'string') throw new Error('Invalid chat preview');
  const store = await chatStore();
  const conversation = await store.read(input.conversationId);
  const caseManifest = conversation.caseId ? await (await import('../core/cases.mjs')).readCase(vaultRoot(), conversation.caseId) : { evidence: [] };
  const { readProvider } = await import('../core/providers.mjs');
  const provider = await readProvider(await providerSettings(), input.draft?.provider);
  const { previewOutbound } = await import('../core/outbound-payload.mjs');
  return previewOutbound({ caseManifest, conversation, draft: { ...input.draft, model: input.draft?.model ?? provider.config.model }, readEvidence: (id) => readEvidenceForOutbound(conversation.caseId, id), capabilities: provider.config.capabilities });
});
handle('chat:send-v2', async (event, input = {}) => {
  if (!input || typeof input !== 'object' || typeof input.conversationId !== 'string') throw new Error('Invalid chat request');
  const store = await chatStore();
  const conversation = await store.read(input.conversationId);
  const caseManifest = conversation.caseId ? await (await import('../core/cases.mjs')).readCase(vaultRoot(), conversation.caseId) : { evidence: [] };
  const { readProvider } = await import('../core/providers.mjs');
  const provider = await readProvider(await providerSettings(), input.draft?.provider);
  const { confirmOutbound } = await import('../core/outbound-payload.mjs');
  const draft = { ...input.draft, model: input.draft?.model ?? provider.config.model };
  const confirmed = await confirmOutbound({ caseManifest, conversation, draft, readEvidence: (id) => readEvidenceForOutbound(conversation.caseId, id), capabilities: provider.config.capabilities }, input.confirmation);
  const controller = new AbortController();
  activeChatRequests.set(confirmed.requestId, controller);
  try {
    const { createModelGateway } = await import('../agent/model-gateway.mjs');
    const gateway = createModelGateway({ providerStore: await configuredProviderStore() });
    const response = await gateway.send({ providerId: provider.config.id, model: draft.model, authorization: confirmed.authorization, payload: confirmed.payload, signal: controller.signal });
    const sensitivity = confirmed.authorization.evidenceIds.length ? 'evidence' : 'clean';
    const current = await store.read(input.conversationId);
    let segment = current.segments.find((item) => item.id === current.activeSegmentId && item.providerId === provider.config.id && item.sensitivity === sensitivity && JSON.stringify(item.evidenceIds) === JSON.stringify(confirmed.authorization.evidenceIds));
    if (!segment) segment = await store.startSegment(input.conversationId, { sensitivity, providerId: provider.config.id, evidenceIds: confirmed.authorization.evidenceIds });
    const userMessage = await store.append(input.conversationId, { role: 'user', text: draft.prompt, segmentId: segment.id, providerId: provider.config.id, evidenceIds: confirmed.authorization.evidenceIds, delivery: { status: 'delivered', requestId: confirmed.requestId } });
    const assistantMessage = await store.append(input.conversationId, { role: 'assistant', text: response.text, segmentId: segment.id, providerId: provider.config.id, evidenceIds: confirmed.authorization.evidenceIds, delivery: { status: 'delivered', requestId: confirmed.requestId } });
    return Object.freeze({ requestId: confirmed.requestId, messages: [userMessage, assistantMessage], delivery: 'delivered' });
  } finally {
    activeChatRequests.delete(confirmed.requestId);
  }
});
handle('chat:abort', async (event, requestId) => {
  if (typeof requestId !== 'string') throw new Error('Invalid request ID');
  const controller = activeChatRequests.get(requestId);
  if (controller) controller.abort();
  return { aborted: Boolean(controller) };
});

app.whenReady().then(createWindow);
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
