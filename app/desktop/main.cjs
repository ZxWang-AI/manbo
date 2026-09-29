const { app, BrowserWindow, dialog, ipcMain, safeStorage } = require('electron');
const { readFile, rename, unlink, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

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
    await require('node:fs/promises').mkdir(settingsRoot(), { recursive: true });
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
