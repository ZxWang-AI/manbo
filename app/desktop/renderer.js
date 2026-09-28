const list = document.querySelector('#cases');
const attachments = document.querySelector('#attachment-list');
const sendButton = document.querySelector('#send');
const status = document.querySelector('#status');
const confirmation = document.querySelector('#confirmation');
let cases = [];
let selectedCase = null;
let pendingDraft = null;
let pendingPreview = null;

function setStatus(message, error = false) {
  status.textContent = message;
  status.style.color = error ? '#ff9b8f' : '';
}

function selectedEvidenceIds() {
  return [...attachments.querySelectorAll('input[type="checkbox"]:checked')].map((input) => input.value);
}

function updateSendState() {
  sendButton.disabled = !selectedCase || selectedEvidenceIds().length === 0 || !document.querySelector('#prompt').value.trim();
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

function selectCase(item) {
  selectedCase = item;
  renderAttachments();
  for (const row of list.querySelectorAll('li[data-case-id]')) row.style.borderColor = row.dataset.caseId === item.id ? '#8be0bc' : '';
  setStatus(`已选择案件 ${item.id}`);
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
    select.addEventListener('click', () => selectCase(item));
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
  if (next) selectCase(next);
  else {
    selectedCase = null;
    renderAttachments();
  }
}

function renderConfirmation(preview) {
  const copy = document.querySelector('#confirmation-copy');
  copy.replaceChildren();
  const info = document.createElement('p');
  info.textContent = `接收方：${preview.provider} · 模式：${preview.mode === 'autonomous' ? '自治模式' : '任务授权'}`;
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
      provider: document.querySelector('#provider').value,
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
  setStatus('已取消，本次没有创建发送授权。');
});

document.querySelector('#accept-confirm').addEventListener('click', async () => {
  try {
    const result = await window.manbo.confirmSend(selectedCase.id, pendingDraft, { accepted: true, preview: pendingPreview });
    confirmation.close();
    setStatus(`已创建本地一次性授权 ${result.requestId}。当前版本不会实际发送模型请求。`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

document.querySelector('#create').addEventListener('click', async () => {
  const item = await window.manbo.createCase();
  await refresh(item.id);
});
document.querySelector('#refresh').addEventListener('click', () => refresh());
for (const input of document.querySelectorAll('#prompt, #provider, #mode')) input.addEventListener('input', updateSendState);
refresh().catch((error) => setStatus(error.message, true));
