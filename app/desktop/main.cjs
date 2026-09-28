const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { join } = require('node:path');

function vaultRoot() {
  return join(app.getPath('userData'), 'cases');
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

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
