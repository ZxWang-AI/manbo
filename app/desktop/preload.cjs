const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manbo', Object.freeze({
  createCase: () => ipcRenderer.invoke('case:create'),
  listCases: () => ipcRenderer.invoke('case:list'),
  importEvidence: (caseId) => ipcRenderer.invoke('evidence:import', caseId),
  previewSend: (caseId, draft) => ipcRenderer.invoke('send:preview', caseId, draft),
  confirmSend: (caseId, draft, confirmation) => ipcRenderer.invoke('send:confirm', caseId, draft, confirmation),
  listProviders: () => ipcRenderer.invoke('provider:list'),
  saveProvider: (config, secret) => ipcRenderer.invoke('provider:save', config, secret),
  deleteProvider: (providerId) => ipcRenderer.invoke('provider:delete', providerId),
}));
