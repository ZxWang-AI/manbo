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
  loadConversation: (caseId) => ipcRenderer.invoke('chat:load', caseId),
  sendMessage: (caseId, draft, confirmation) => ipcRenderer.invoke('chat:send', caseId, draft, confirmation),
  listConversations: () => ipcRenderer.invoke('conversation:list'),
  createConversation: (options) => ipcRenderer.invoke('conversation:create', options),
  loadConversationRecord: (conversationId) => ipcRenderer.invoke('conversation:load', conversationId),
  previewChat: (input) => ipcRenderer.invoke('chat:preview-v2', input),
  sendChat: (input) => ipcRenderer.invoke('chat:send-v2', input),
  waitChat: (requestId) => ipcRenderer.invoke('chat:result', requestId),
  discardChatPreview: (receiptId) => ipcRenderer.invoke('chat:discard-preview', receiptId),
  abortChat: (requestId) => ipcRenderer.invoke('chat:abort', requestId),
}));
