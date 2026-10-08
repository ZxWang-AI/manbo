const $ = (selector) => document.querySelector(selector);
const conversationList = $('#conversation-list');
const caseList = $('#case-list');
const messageStream = $('#message-stream');
const composerInput = $('#composer-input');
const attachmentChips = $('#attachment-chips');
const providerSelect = $('#provider');
const sendButton = $('#send');
const confirmation = $('#confirmation');
const settingsDialog = $('#settings-dialog');
const appShell = $('#app-shell');

let conversations = [];
let cases = [];
let providers = [];
let activeConversation = null;
let activeCase = null;
let selectedEvidenceIds = new Set();
let pendingPreview = null;
let pendingDraft = null;
let pendingConversationId = null;
let activeRequestId = null;
let busy = false;
let accepting = false;
let omittedHistory = 0;
const uiError = '操作未完成，草稿已保留；请检查本地配置后重新确认。';

function setBusy(value) {
  busy = value;
  for (const control of document.querySelectorAll('button, input, textarea, select')) {
    if (!['accept-confirm','cancel-confirm','cancel-request','toggle-rail'].includes(control.id)) control.disabled = value;
  }
  $('#import-evidence').disabled = value || !activeCase;
  updateSendState();
}

async function localAction(operation) {
  if (busy) return;
  setBusy(true);
  try { await operation(); } catch { setStatus(uiError,true); }
  finally { setBusy(false); }
}

function setStatus(message, error = false) {
  const status = $('#status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function setProviderStatus(message, error = false) {
  const status = $('#provider-status');
  status.textContent = message;
  status.classList.toggle('error', error);
}

function activeProvider() {
  return providers.find((item) => item.id === providerSelect.value) ?? null;
}

function renderMessages(messages = []) {
  messageStream.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-chat';
    empty.innerHTML = '<strong>从一个问题开始</strong><span>可以问普通问题，也可以在右侧选择材料后整理时间线、证据链和举报准备内容。</span>';
    messageStream.append(empty);
    return;
  }
  for (const message of messages) {
    const row = document.createElement('article');
    row.className = `message ${message.role}`;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    const source = message.role === 'user' ? '你' : '模型回答 · 待核对';
    meta.innerHTML = `<span class="source">${source}</span><span>${message.evidenceIds?.length ? `使用 ${message.evidenceIds.length} 份材料` : '干净上下文'}</span>`;
    const body = document.createElement('div');
    body.textContent = message.text;
    row.append(meta, body);
    messageStream.append(row);
  }
  messageStream.scrollTop = messageStream.scrollHeight;
}

function renderConversationList() {
  conversationList.replaceChildren();
  $('#conversation-count').textContent = String(conversations.length);
  for (const item of conversations) {
    const button = document.createElement('button');
    button.className = `nav-item${item.id === activeConversation?.id ? ' active' : ''}`;
    button.dataset.conversationId = item.id;
    button.textContent = item.title || '新对话';
    const detail = document.createElement('small');
    detail.textContent = `${item.messageCount} 条消息${item.hasEvidence ? ' · 有材料' : ''}`;
    button.append(detail);
    button.disabled = busy;
    button.addEventListener('click', () => localAction(() => selectConversation(item.id)));
    conversationList.append(button);
  }
}

function renderCaseList() {
  caseList.replaceChildren();
  if (!cases.length) {
    const empty = document.createElement('div');
    empty.className = 'rail-empty';
    empty.textContent = '还没有案件';
    caseList.append(empty);
    return;
  }
  for (const item of cases) {
    const button = document.createElement('button');
    button.className = `nav-item${item.id === activeCase?.id ? ' active' : ''}`;
    button.dataset.caseId = item.id;
    button.textContent = `案件 ${item.id.slice(0, 8)}`;
    const detail = document.createElement('small');
    detail.textContent = `${item.evidence.length} 份材料`;
    button.append(detail);
    button.disabled = busy;
    button.addEventListener('click', () => localAction(() => openCase(item)));
    caseList.append(button);
  }
}

function renderEvidenceRail() {
  $('#rail-title').textContent = activeCase ? `案件 ${activeCase.id.slice(0, 8)}` : '未选择案件';
  $('#rail-copy').textContent = activeCase ? '勾选本次明确要交给模型的材料。打开案件不会自动读取它们。' : '普通对话不会读取案件材料。选择案件后，勾选本次明确要发送的材料。';
  $('#import-evidence').disabled = busy || !activeCase;
  const list = $('#evidence-list');
  list.replaceChildren();
  if (!activeCase) {
    const empty = document.createElement('div'); empty.className = 'rail-empty'; empty.textContent = '当前对话没有案件上下文。'; list.append(empty);
  } else if (!activeCase.evidence.length) {
    const empty = document.createElement('div'); empty.className = 'rail-empty'; empty.textContent = '这个案件还没有材料。'; list.append(empty);
  } else {
    for (const item of activeCase.evidence) {
      const label = document.createElement('label'); label.className = 'evidence-row';
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selectedEvidenceIds.has(item.id); input.value = item.id;
      input.disabled = busy;
      input.addEventListener('change', () => { if (busy) return; if (input.checked) selectedEvidenceIds.add(item.id); else selectedEvidenceIds.delete(item.id); renderDraftScope(); updateSendState(); });
      const wrap = document.createElement('span'); const name = document.createElement('div'); name.className = 'evidence-name'; name.textContent = item.name; const meta = document.createElement('div'); meta.className = 'evidence-meta'; meta.textContent = `${item.bytes} bytes · ${item.sha256.slice(0, 10)}…`; wrap.append(name, meta); label.append(input, wrap); list.append(label);
    }
  }
  renderDraftScope();
}

function renderDraftScope() {
  const count = selectedEvidenceIds.size;
  const evidenceScope = count > 0;
  $('#scope-title').textContent = evidenceScope ? `证据范围 · ${count} 份材料` : '干净上下文';
  $('#scope-copy').textContent = evidenceScope ? '仅发送右侧勾选材料的受控表示；原始文件不会被修改。' : '未选择附件。普通问题不会带入案件材料或旧证据。';
  $('#scope-badge').textContent = evidenceScope ? `证据范围 · ${count}` : '干净上下文';
  attachmentChips.replaceChildren();
  for (const id of selectedEvidenceIds) {
    const item = activeCase?.evidence.find((entry) => entry.id === id); if (!item) continue;
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = item.name;
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = '移除附件'; remove.disabled = busy; remove.addEventListener('click', () => { if (busy) return; selectedEvidenceIds.delete(id); renderEvidenceRail(); updateSendState(); }); chip.append(remove); attachmentChips.append(chip);
  }
}

function updateSendState() {
  const provider = activeProvider();
  sendButton.disabled = busy || !activeConversation || !composerInput.value.trim() || !provider || provider.id === 'local-demo' || !provider.hasKey;
  $('#provider-badge').textContent = provider?.id === 'local-demo' ? '请配置 Provider' : provider?.hasKey ? provider.name : '未配置模型';
  $('#provider-badge').classList.toggle('warn', !provider || !provider.hasKey || provider.id === 'local-demo');
}

async function refreshProviders() {
  providers = await window.manbo.listProviders();
  providerSelect.replaceChildren();
  for (const provider of providers) {
    const option = document.createElement('option'); option.value = provider.id; option.textContent = provider.id === 'local-demo' ? '本地模拟（不能真实发送）' : `${provider.name}${provider.hasKey ? '' : ' · 未配置 Key'}`; option.disabled = provider.id === 'local-demo'; providerSelect.append(option);
  }
  const usable = providers.find((provider) => provider.id !== 'local-demo' && provider.hasKey);
  providerSelect.value = usable?.id ?? providers[0]?.id ?? '';
  updateSendState();
}

async function refreshCases(preferredId = activeCase?.id) {
  cases = await window.manbo.listCases();
  activeCase = cases.find((item) => item.id === preferredId) ?? (activeConversation?.caseId ? cases.find((item) => item.id === activeConversation.caseId) : null);
  renderCaseList(); renderEvidenceRail();
}

async function refreshConversations(preferredId = activeConversation?.id) {
  conversations = await window.manbo.listConversations();
  if (!conversations.length) {
    activeConversation = await window.manbo.createConversation({ title: '普通对话' });
    conversations = await window.manbo.listConversations();
  } else {
    const selected = conversations.find((item) => item.id === preferredId) ?? conversations[0];
    activeConversation = await window.manbo.loadConversationRecord(selected.id);
  }
  renderConversationList();
  await refreshCases(activeConversation.caseId);
  renderActiveConversation();
}

function renderActiveConversation() {
  if (!activeConversation) return;
  $('#chat-title').textContent = activeConversation.title || (activeConversation.caseId ? `案件 ${activeConversation.caseId.slice(0, 8)}` : '普通对话');
  $('#chat-subtitle').textContent = activeConversation.caseId ? '案件上下文已打开，但材料仍需逐项选择' : '普通问题不会自动读取案件材料';
  renderMessages(activeConversation.messages);
  renderConversationList(); renderCaseList(); updateSendState();
}

async function selectConversation(id) {
  activeConversation = await window.manbo.loadConversationRecord(id);
  selectedEvidenceIds = new Set();
  await refreshCases(activeConversation.caseId);
  renderActiveConversation();
  setStatus('已切换到本地对话。');
}

async function openCase(item) {
  activeCase = item; selectedEvidenceIds = new Set();
  const existing = conversations.find((conversation) => conversation.caseId === item.id);
  if (existing) activeConversation = await window.manbo.loadConversationRecord(existing.id);
  else { activeConversation = await window.manbo.createConversation({ caseId: item.id, title: `案件 ${item.id.slice(0, 8)}` }); conversations = await window.manbo.listConversations(); }
  renderActiveConversation(); renderEvidenceRail();
}

function renderConfirmation(preview) {
  const copy = $('#confirmation-copy'); copy.replaceChildren();
  const header = document.createElement('div'); header.className = 'scope-card';
  const name = document.createElement('strong'); name.textContent = `接收方：${preview.receiver?.name ?? preview.provider}`;
  const endpoint = document.createElement('p'); endpoint.textContent = `地址：${preview.receiver?.endpoint ?? '未提供'}`;
  const details = document.createElement('span'); details.textContent = `模型：${preview.model} · 范围：${preview.scope.evidenceIds.length ? `${preview.scope.evidenceIds.length} 份材料` : '普通问题'}`;
  header.append(name,endpoint,details); copy.append(header);
  const list = document.createElement('ul'); list.className = 'confirm-list';
  if (!preview.attachments.length) { const row = document.createElement('li'); row.textContent = '本次没有附件；只发送提示词和明确授权的干净上下文。'; list.append(row); }
  for (const item of preview.attachments) { const row = document.createElement('li'); row.textContent = `${item.name} · ${item.representation}${item.pages ? ` · 第 ${item.pages.join(', ')} 页` : ''} · ${item.bytes} bytes`; list.append(row); }
  const prompt = document.createElement('p'); prompt.textContent = `提示词：${preview.prompt}`; copy.append(list, prompt);
  const context = preview.contextMessages ?? [];
  const historyTitle = document.createElement('p'); historyTitle.textContent = `本次包含 ${context.length} 条历史消息；${omittedHistory} 条未授权、未完成或超出数量范围的历史不会发送。`; copy.append(historyTitle);
  for (const message of context) {
    const row = document.createElement('p'); row.className = 'history-preview';
    row.textContent = `${message.role === 'user' ? '你' : '模型'}${message.evidenceIds?.length ? ` · 来源：${message.evidenceIds.join(', ')}` : ' · 干净上下文'}\n${message.text}`; copy.append(row);
  }
}

function selectedHistory() {
  const messages = activeConversation?.messages ?? [];
  const eligible = messages.filter((message) => {
    if (message.delivery?.status && message.delivery.status !== 'delivered') return false;
    const segment = activeConversation.segments?.find((item) => item.id === message.segmentId);
    const sources = new Set([...(message.evidenceIds ?? []),...(segment?.evidenceIds ?? [])]);
    return [...sources].every((id) => selectedEvidenceIds.has(id));
  }).slice(-40);
  omittedHistory = messages.length - eligible.length;
  return eligible.map((message) => message.id);
}

$('#send').addEventListener('click', async () => {
  if (busy || sendButton.disabled) return;
  setBusy(true);
  try {
    const provider = activeProvider();
    if (!provider || provider.id === 'local-demo' || !provider.hasKey) throw new Error('请先在模型设置中配置自己的 API Key');
    pendingConversationId = activeConversation.id;
    pendingDraft = { mode: 'task', provider: provider.id, model: provider.model, prompt: composerInput.value.trim(), selectedEvidenceIds: [...selectedEvidenceIds], contextMessageIds:selectedHistory() };
    pendingPreview = await window.manbo.previewChat({ conversationId: pendingConversationId, draft: pendingDraft });
    $('#accept-confirm').disabled = false; $('#cancel-confirm').disabled = false;
    renderConfirmation(pendingPreview); confirmation.showModal();
  } catch { pendingPreview=null; pendingDraft=null; pendingConversationId=null; setBusy(false); setStatus(uiError,true); }
});

$('#accept-confirm').addEventListener('click', async () => {
  if (accepting || !pendingPreview || !pendingConversationId) return;
  accepting = true; $('#accept-confirm').disabled = true; $('#cancel-confirm').disabled = true;
  const conversationId = pendingConversationId;
  let delivered = false;
  try {
    const begun = await window.manbo.sendChat({receiptId:pendingPreview.receiptId, confirmation: { accepted: true, preview: pendingPreview } });
    activeRequestId = begun.requestId; confirmation.close(); $('#cancel-request').hidden = false; $('#cancel-request').disabled = false;
    setStatus('模型正在处理；取消无法撤回已到达供应商的数据。');
    const result = await window.manbo.waitChat(activeRequestId);
    activeRequestId=null; $('#cancel-request').hidden=true;
    if (result.delivery === 'delivered') {
      delivered = true;
      const refreshed = await window.manbo.loadConversationRecord(conversationId);
      conversations = await window.manbo.listConversations(); activeConversation = refreshed;
      composerInput.value = ''; selectedEvidenceIds = new Set();
      renderActiveConversation(); renderEvidenceRail();
      setStatus('已发送并收到模型回答；请核对内容与来源。');
    } else setStatus(result.delivery === 'unknown' ? '发送或本地保存状态不确定；草稿已保留。重发前请核对供应商是否收到，避免重复外发。' : result.delivery === 'cancelled' ? '已在模型调用前取消，草稿已保留。' : '确认已失效或请求未开始；草稿已保留，请重新确认。',true);
  } catch { setStatus(delivered ? '已发送并保存，但界面刷新失败；草稿已保留，请勿重复发送同一内容。' : '发送状态不确定，草稿已保留；重发前请核对供应商是否收到。',true); }
  finally {
    activeRequestId=null; accepting=false; pendingDraft=null; pendingPreview=null; pendingConversationId=null;
    confirmation.close(); $('#cancel-request').hidden=true; setBusy(false);
  }
});

async function cancelConfirmation() {
  if (accepting) return;
  const receiptId=pendingPreview?.receiptId;
  confirmation.close(); pendingDraft=null; pendingPreview=null; pendingConversationId=null;
  try { if(receiptId) await window.manbo.discardChatPreview(receiptId); }
  catch { setStatus(uiError,true); }
  finally { setBusy(false); }
  setStatus('已取消本次发送，草稿与材料仍在本机。');
}
$('#cancel-confirm').addEventListener('click',cancelConfirmation);
confirmation.addEventListener('cancel', (event) => {event.preventDefault(); void cancelConfirmation();});
$('#cancel-request').addEventListener('click',async () => {
  if(!activeRequestId) return;
  const requestId = activeRequestId;
  $('#cancel-request').disabled=true;
  try { const result=await window.manbo.abortChat(requestId); if(activeRequestId === requestId) setStatus(result.aborted ? '已请求停止；已经到达供应商的数据无法撤回。' : '模型已结束，正在完成本地保存。'); }
  catch {if(activeRequestId === requestId) setStatus('停止状态不确定，请等待本次结果。',true);}
});
$('#composer-input').addEventListener('input', updateSendState);
$('#provider').addEventListener('change', updateSendState);
$('#new-chat').addEventListener('click', () => localAction(async () => { activeConversation = await window.manbo.createConversation({ title: '普通对话' }); conversations = await window.manbo.listConversations(); activeCase = null; selectedEvidenceIds = new Set(); renderActiveConversation(); renderEvidenceRail(); }));
$('#create-case').addEventListener('click', () => localAction(async () => { const item = await window.manbo.createCase(); cases = await window.manbo.listCases(); await openCase(item); }));
$('#import-evidence').addEventListener('click', () => localAction(async () => { if (!activeCase) return; const caseId=activeCase.id; const imported = await window.manbo.importEvidence(caseId); if (imported) { cases = await window.manbo.listCases(); activeCase = cases.find((item) => item.id === caseId); renderEvidenceRail(); setStatus(`已在本地导入 ${imported.name}，尚未发送。`); } }));
$('#clear-attachments').addEventListener('click', () => { if(busy) return; selectedEvidenceIds = new Set(); renderEvidenceRail(); updateSendState(); });
$('#toggle-rail').addEventListener('click', () => appShell.classList.toggle('rail-open'));
$('#settings').addEventListener('click', () => { if(busy) return; setProviderStatus('Key 不会显示；保存新的 Key 会替换旧值。'); settingsDialog.showModal(); });
$('#close-settings').addEventListener('click', () => settingsDialog.close());
$('#save-provider').addEventListener('click', async () => { if(busy) return; setBusy(true); try { const config = { id: $('#provider-id').value, name: $('#provider-name').value, kind: 'openai-compatible', model: $('#provider-model').value, endpoint: $('#provider-endpoint').value, capabilities: { images: $('#provider-images').checked } }; await window.manbo.saveProvider(config, $('#provider-secret').value); $('#provider-secret').value = ''; await refreshProviders(); settingsDialog.close(); setStatus('Provider 已保存到本机系统凭据存储。'); } catch { setProviderStatus('Provider 保存失败，请检查 HTTPS 地址和系统凭据后端。', true); } finally {setBusy(false);} });

setBusy(true);
Promise.all([refreshProviders(), refreshConversations()]).catch(() => setStatus(uiError,true)).finally(() => setBusy(false));
