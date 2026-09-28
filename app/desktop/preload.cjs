const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manbo', Object.freeze({
  createCase: () => ipcRenderer.invoke('case:create'),
  listCases: () => ipcRenderer.invoke('case:list'),
  importEvidence: (caseId) => ipcRenderer.invoke('evidence:import', caseId),
}));
