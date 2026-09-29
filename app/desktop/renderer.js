const list = document.querySelector('#cases');
const attachments = document.querySelector('#attachment-list');
const conversation = document.querySelector('#conversation');
const sendButton = document.querySelector('#send');
const status = document.querySelector('#status');
const confirmation = document.querySelector('#confirmation');
const settingsDialog = document.querySelector('#settings-dialog');
const providerSelect = document.querySelector('#provider');
let cases = [];
let providers = [];
let selectedCase = null;
let pendingDraft = null;
let pendingPreview = null;

function setStatus(message, error = false) {
  status.textContent = message;
  status.style.color = error ? '#ff9b8f' : '';
}

function setProviderStatus(message, error = false) {
  const target = document.querySelector('#provider-status');
  target.textContent = message;
  target.style.color = error ? '#ff9b8f' : '';
}

function selectedEvidenceIds() {
  return [...attachments.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function updateSendState() {
  const autonomous = document.querySelector('#mode').value === 'autonomous';
  const hasEvidence = autonomous ? Boolean(selectedCase?.evidence.length) : selectedEvidenceIds().length > 0;
  sendButton.disabled = !selectedCase || !hasEvidence || !document.querySelector('#prompt').value.trim();
}

function renderConversation(messages = []) {
  conversation.replaceChildren();
  if (messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有对话。选择附件并写下你的第一个任务。';
    conversation.append(empty);
    return;
  }
  for (const message of messages) {
    const row = document.createElement('article');
    row.className = `message ${message.role}`;
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = message.role === 'user' ? '你 · 本地记录' : 'AI · 待核对';
    const body = document.createElement('div');
    body.textContent = message.text;
    row.append(meta, body);
    conversation.append(row);
  }
  conversation.scrollTop = conversation.scrollHeight;
}

async function loadConversation() {
  if (!selectedCase) {
    renderConversation();
    return;
  }
  const saved = await window.manbo.loadConversation(selectedCase.id);
  renderConversation(saved.messages);
}

function renderAttachments() {
  if (!selectedCase) {
    attachments.className = 'empty';
    attachments.textContent = '先在左侧创建或选择一个案件。';
    updateSendState();
    return;
  }
  attachments.className = '';
  attachments.replaceChildren();
  if (selectedCase.evidence.length === 0) {
    attachments.className = 'empty';
    attachments.textContent = '这个案件还没有材料。导入后，材料会出现在这里。';
    updateSendState();
    return;
  }
  const heading = document.createElement('div');
  heading.className = 'muted';
  heading.textContent = '本次附件（只发送勾选项）';
  attachments.append(heading);
  for (const item of selectedCase.evidence) {
    const label = document.createElement('label');
    label.className = 'evidence';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = item.id;
    input.addEventListener('change', updateSendState);
    const text = document.createElement('span');
    text.textContent = `${item.name} · ${item.bytes} bytes · SHA-256 ${item.sha256.slice(0, 12)}…`;
    label.append(input, text);
    attachments.append(label);
  }
  updateSendState();
}

async function selectCase(item) {
  selectedCase = item;
  renderAttachments();
  await loadConversation();
  for (const row of list.querySelectorAll('li[data-case-id]')) row.style.borderColor = row.dataset.caseId === item.id ? '#8be0bc' : '';
  setStatus(`已选择案件 ${item.id}`);
}

async function refreshProviders() {
  providers = await window.manbo.listProviders();
  const previous = providerSelect.value;
  providerSelect.replaceChildren(...providers.map((provider) => {
    const option = document.createElement('option');
    option.value = provider.id;
    option.textContent = `${provider.name}${provider.hasKey ? ' · 已配置 Key' : ''}`;
    return option;
  }));
  providerSelect.value = providers.some((item) => item.id === previous) ? previous : (providers[0]?.id ?? 'local-demo');
}

async function refresh(preferredId = selectedCase?.id) {
  cases = await window.manbo.listCases();
  list.replaceChildren();
  if (cases.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '还没有案件。';
    list.append(empty);
  }
  for (const item of cases) {
    const row = document.createElement('li');
    row.dataset.caseId = item.id;
    const title = document.createElement('div');
    title.textContent = `案件 ${item.id}`;
    const meta = document.createElement('div');
    meta.className = 'muted';
    meta.textContent = `${item.evidence.length} 份材料 · 创建于 ${new Date(item.createdAt).toLocaleString()}`;
    const select = document.createElement('button');
    select.className = 'secondary';
    select.textContent = '选择';
    select.addEventListener('click', () => { void selectCase(item); });
    const importButton = document.createElement('button');
    importButton.textContent = '导入材料';
    importButton.addEventListener('click', async () => {
      const imported = await window.manbo.importEvidence(item.id);
      if (imported) {
        setStatus(`已在本地导入 ${imported.name}，尚未发送。`);
        await refresh(item.id);
      }
    });
    row.append(title, meta, select, importButton);
    list.append(row);
  }
  const next = cases.find((item) => item.id === preferredId) ?? cases[0] ?? null;
  if (next) await selectCase(next);
  else {
    selectedCase = null;
    renderAttachments();
    renderConversation();
  }
}

function renderConfirmation(preview) {
  const copy = document.querySelector('#confirmation-copy');
  copy.replaceChildren();
  const info = document.createElement('p');
  const provider = providers.find((item) => item.id === preview.provider);
  info.textContent = `接收方：${provider?.name ?? preview.provider} · 模式：${preview.mode === 'autonomous' ? '自治模式' : '任务授权'}`;
  const files = document.createElement('ul');
  for (const item of preview.evidence) {
    const row = document.createElement('li');
    row.textContent = `${item.name} · ${item.bytes} bytes`;
    files.append(row);
  }
  const prompt = document.createElement('p');
  prompt.textContent = `提示词：${preview.prompt}`;
  copy.append(info, files, prompt);
}

sendButton.addEventListener('click', async () => {
  try {
    pendingDraft = {
      mode: document.querySelector('#mode').value,
      provider: providerSelect.value,
      selectedEvidenceIds: selectedEvidenceIds(),
      prompt: document.querySelector('#prompt').value,
    };
    pendingPreview = await window.manbo.previewSend(selectedCase.id, pendingDraft);
    renderConfirmation(pendingPreview);
    confirmation.showModal();
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#cancel-confirm').addEventListener('click', () => {
  confirmation.close();
  pendingDraft = null;
  pendingPreview = null;
  setStatus('已取消，本次没有发送。');
});

document.querySelector('#accept-confirm').addEventListener('click', async () => {
  try {
    const result = await window.manbo.sendMessage(selectedCase.id, pendingDraft, { accepted: true, preview: pendingPreview });
    confirmation.close();
    renderConversation(result.messages);
    document.querySelector('#prompt').value = '';
    updateSendState();
    setStatus('已完成本地演示对话；内容没有离开设备。');
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#settings').addEventListener('click', () => {
  setProviderStatus('Key 不会显示；保存新的 Key 会替换旧值。');
  settingsDialog.showModal();
});
document.querySelector('#close-settings').addEventListener('click', () => settingsDialog.close());
document.querySelector('#save-provider').addEventListener('click', async () => {
  try {
    const config = {
      id: document.querySelector('#provider-id').value,
      name: document.querySelector('#provider-name').value,
      kind: 'openai-compatible',
      model: document.querySelector('#provider-model').value,
      endpoint: document.querySelector('#provider-endpoint').value,
    };
    await window.manbo.saveProvider(config, document.querySelector('#provider-secret').value);
    document.querySelector('#provider-secret').value = '';
    await refreshProviders();
    setProviderStatus('已保存到本机系统凭据存储。');
  } catch (error) {
    setProviderStatus(error.message, true);
  }
});
document.querySelector('#delete-provider').addEventListener('click', async () => {
  try {
    const id = providerSelect.value;
    if (id === 'local-demo') throw new Error('本地演示 Provider 不能删除');
    await window.manbo.deleteProvider(id);
    await refreshProviders();
    setProviderStatus('已删除 Provider 和本机凭据。');
  } catch (error) {
    setProviderStatus(error.message, true);
  }
});

document.querySelector('#create').addEventListener('click', async () => {
  const item = await window.manbo.createCase();
  await refresh(item.id);
});
document.querySelector('#refresh').addEventListener('click', () => { void refresh(); });
for (const input of document.querySelectorAll('#prompt, #provider, #mode')) {
  input.addEventListener('input', updateSendState);
  input.addEventListener('change', updateSendState);
}
document.querySelector('#pause-task').addEventListener('click', () => setStatus('当前没有正在运行的模型任务。'));
document.querySelector('#revoke-task').addEventListener('click', () => setStatus('当前没有可撤销的模型任务。'));

Promise.all([refreshProviders(), refresh()]).catch((error) => setStatus(error.message, true));
