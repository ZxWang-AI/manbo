const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { mkdir, readFile, rename, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');
const { extname } = require('node:path');

const activeChatRequests = new Map();

function vaultRoot() {
  return join(app.getPath('userData'), 'cases');
}

function settingsRoot() {
  return join(app.getPath('userData'), 'settings');
}

function createSafeSecretStore() {
  const filePath = join(settingsRoot(), 'provider-secrets.json');
  async function readSecrets() {
    try { return JSON.parse(await readFile(filePath, 'utf8')); } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new Error('Provider credentials are unreadable');
    }
  }
  async function writeSecrets(secrets) {
    const temporary = join(settingsRoot(), `provider-secrets.${Date.now()}.tmp`);
    await mkdir(settingsRoot(), { recursive: true });
    try {
      await writeFile(temporary, JSON.stringify(secrets), { flag: 'wx', mode: 0o600 });
      await rename(temporary, filePath);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
  return {
    async get(id) {
      const encoded = (await readSecrets())[id];
      if (!encoded || !safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    },
    async set(id, value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统凭据存储不可用，无法保存 Provider Key');
      const secrets = await readSecrets();
      secrets[id] = safeStorage.encryptString(value).toString('base64');
      await writeSecrets(secrets);
    },
    async delete(id) {
      const secrets = await readSecrets();
      delete secrets[id];
      await writeSecrets(secrets);
    },
  };
}

function providerSettings() {
  return { root: settingsRoot(), secretStore: createSafeSecretStore() };
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
  await window.loadFile(join(__dirname, 'index.html'));
}

ipcMain.handle('case:create', async () => {
  const { createCase } = await import('../core/cases.mjs');
  return createCase(vaultRoot());
});
ipcMain.handle('case:list', async () => {
  const { listCases } = await import('../core/cases.mjs');
  return listCases(vaultRoot());
});
ipcMain.handle('evidence:import', async (event, caseId) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const result = await dialog.showOpenDialog({ properties: ['openFile'] });
  if (result.canceled || result.filePaths.length !== 1) return null;
  const { importEvidence } = await import('../core/cases.mjs');
  return importEvidence(vaultRoot(), caseId, result.filePaths[0]);
});
ipcMain.handle('send:preview', async (event, caseId, draft) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readCase } = await import('../core/cases.mjs');
  const { previewSend } = await import('../core/send.mjs');
  return previewSend(await readCase(vaultRoot(), caseId), draft);
});
ipcMain.handle('send:confirm', async (event, caseId, draft, confirmation) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readCase } = await import('../core/cases.mjs');
  const { confirmSend } = await import('../core/send.mjs');
  return confirmSend(await readCase(vaultRoot(), caseId), draft, confirmation);
});
ipcMain.handle('provider:list', async () => {
  const { listProviders } = await import('../core/providers.mjs');
  return listProviders(providerSettings());
});
ipcMain.handle('provider:save', async (event, config, secret) => {
  const { saveProvider } = await import('../core/providers.mjs');
  return saveProvider(providerSettings(), config, secret);
});
ipcMain.handle('provider:delete', async (event, providerId) => {
  const { deleteProvider } = await import('../core/providers.mjs');
  await deleteProvider(providerSettings(), providerId);
  return { deleted: true };
});
ipcMain.handle('chat:load', async (event, caseId) => {
  if (typeof caseId !== 'string') throw new Error('Invalid case ID');
  const { readConversation } = await import('../core/conversations.mjs');
  return readConversation(vaultRoot(), caseId);
});
ipcMain.handle('chat:send', async (event, caseId, draft, confirmation) => {
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

function chatStore() {
  return import('../core/chat-store.mjs').then(({ createChatStore }) => createChatStore(vaultRoot()));
}

async function readEvidenceForOutbound(caseId, evidenceId) {
  if (typeof caseId !== 'string') throw new Error('Evidence requires a case');
  const { readCase } = await import('../core/cases.mjs');
  const manifest = await readCase(vaultRoot(), caseId);
  const item = manifest.evidence.find((entry) => entry.id === evidenceId);
  if (!item) throw new Error('Unknown evidence ID');
  const bytes = await readFile(join(vaultRoot(), caseId, 'originals', item.storedName));
  const extension = extname(item.name).toLowerCase();
  const mimeType = extension === '.pdf' ? 'application/pdf'
    : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(extension) ? `image/${extension.slice(1) === 'jpg' ? 'jpeg' : extension.slice(1)}`
      : ['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.yaml', '.yml'].includes(extension) ? 'text/plain'
        : 'application/octet-stream';
  if (mimeType.startsWith('image/')) return { ...item, mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` };
  if (mimeType === 'application/pdf') return { ...item, mimeType, pages: [] };
  return { ...item, mimeType, content: bytes.toString('utf8') };
}

async function configuredProviderStore() {
  const { readProvider } = await import('../core/providers.mjs');
  return { readProvider: (id) => readProvider(providerSettings(), id) };
}

ipcMain.handle('conversation:list', async () => (await chatStore()).list());
ipcMain.handle('conversation:create', async (event, options = {}) => {
  if (!options || typeof options !== 'object') throw new Error('Invalid conversation options');
  return (await chatStore()).create({ caseId: options.caseId ?? null, title: options.title });
});
ipcMain.handle('conversation:load', async (event, conversationId) => (await chatStore()).read(conversationId));
ipcMain.handle('chat:preview-v2', async (event, input = {}) => {
  if (!input || typeof input !== 'object' || typeof input.conversationId !== 'string') throw new Error('Invalid chat preview');
  const store = await chatStore();
  const conversation = await store.read(input.conversationId);
  const caseManifest = conversation.caseId ? await (await import('../core/cases.mjs')).readCase(vaultRoot(), conversation.caseId) : { evidence: [] };
  const { readProvider } = await import('../core/providers.mjs');
  const provider = await readProvider(providerSettings(), input.draft?.provider);
  const { previewOutbound } = await import('../core/outbound-payload.mjs');
  return previewOutbound({ caseManifest, conversation, draft: { ...input.draft, model: input.draft?.model ?? provider.config.model }, readEvidence: (id) => readEvidenceForOutbound(conversation.caseId, id), capabilities: provider.config.capabilities });
});
ipcMain.handle('chat:send-v2', async (event, input = {}) => {
  if (!input || typeof input !== 'object' || typeof input.conversationId !== 'string') throw new Error('Invalid chat request');
  const store = await chatStore();
  const conversation = await store.read(input.conversationId);
  const caseManifest = conversation.caseId ? await (await import('../core/cases.mjs')).readCase(vaultRoot(), conversation.caseId) : { evidence: [] };
  const { readProvider } = await import('../core/providers.mjs');
  const provider = await readProvider(providerSettings(), input.draft?.provider);
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
ipcMain.handle('chat:abort', async (event, requestId) => {
  if (typeof requestId !== 'string') throw new Error('Invalid request ID');
  const controller = activeChatRequests.get(requestId);
  if (controller) controller.abort();
  return { aborted: Boolean(controller) };
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
