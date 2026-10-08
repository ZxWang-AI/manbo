import { createHash, randomUUID } from 'node:crypto';

const idPattern = /^[0-9a-f-]{36}$/i;
const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.yaml', '.yml']);
const defaultMaxBytes = 2 * 1024 * 1024;

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(message);
}

function assertId(value, label) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`Invalid ${label}`);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function hash(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeIds(value) {
  if (!Array.isArray(value)) throw new Error('Evidence IDs must be an array');
  if (new Set(value).size !== value.length || value.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error('Duplicate or invalid evidence IDs');
  }
  return [...value];
}

function manifestEvidence(caseManifest, ids) {
  assertObject(caseManifest, 'Case manifest is required');
  const known = new Map((caseManifest.evidence ?? []).map((item) => [item.id, item]));
  for (const id of ids) if (!known.has(id)) throw new Error('Unknown evidence ID');
  return ids.map((id) => known.get(id));
}

function extension(name = '') {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index).toLowerCase() : '';
}

function textFromPdf(item) {
  if (!Array.isArray(item.pages) || item.pages.length === 0) throw new Error('PDF has no extractable text');
  const pages = item.pages.map((page) => {
    if (!page || !Number.isInteger(page.page) || typeof page.text !== 'string' || !page.text.trim()) {
      throw new Error('PDF has no extractable text');
    }
    return { page: page.page, text: page.text };
  });
  return { text: pages.map((page) => `[第 ${page.page} 页]\n${page.text}`).join('\n\n'), pages: pages.map((page) => page.page) };
}

async function prepareAttachment(manifestItem, readEvidence, capabilities, maxBytes) {
  if (!manifestItem || typeof manifestItem.id !== 'string') throw new Error('Evidence manifest item is invalid');
  const item = await readEvidence(manifestItem.id);
  assertObject(item, 'Evidence could not be read');
  if (item.id !== manifestItem.id || item.sha256 !== manifestItem.sha256) throw new Error('Evidence changed since import');
  if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > maxBytes) throw new Error('Evidence is empty or too large');
  const ext = extension(item.name ?? manifestItem.name);
  const mimeType = item.mimeType ?? manifestItem.mimeType ?? '';
  if (mimeType === 'application/pdf' || ext === '.pdf') {
    const extracted = textFromPdf(item);
    return {
      part: { type: 'text', text: `[材料：${manifestItem.name}]\n${extracted.text}` },
      summary: { evidenceId: item.id, name: manifestItem.name, kind: 'pdf', representation: 'extracted-text', sha256: item.sha256, bytes: item.bytes, pages: extracted.pages },
    };
  }
  if (mimeType.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) {
    if (capabilities?.images !== true) throw new Error('Provider does not support image attachments');
    if (typeof item.dataUrl !== 'string' || !item.dataUrl.startsWith('data:image/')) throw new Error('Image data is unavailable');
    return {
      part: { type: 'image_url', image_url: { url: item.dataUrl } },
      summary: { evidenceId: item.id, name: manifestItem.name, kind: 'image', representation: 'image', sha256: item.sha256, bytes: item.bytes },
    };
  }
  if (!textExtensions.has(ext) && mimeType && !mimeType.startsWith('text/')) throw new Error('Unsupported evidence format');
  if (typeof item.content !== 'string' || !item.content.trim()) throw new Error('Text evidence is empty or unreadable');
  return {
    part: { type: 'text', text: `[材料：${manifestItem.name}]\n${item.content}` },
    summary: { evidenceId: item.id, name: manifestItem.name, kind: 'text', representation: 'extracted-text', sha256: item.sha256, bytes: item.bytes },
  };
}

function contextMessages(conversation, draft) {
  const requested = draft.contextMessageIds ?? [];
  if (!Array.isArray(requested) || new Set(requested).size !== requested.length
    || requested.some((id) => typeof id !== 'string' || !id || id.length > 256)) throw new Error('Duplicate or invalid context message IDs');
  if (requested.length > 40) throw new Error('Context count limit exceeded');
  const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
  const selected = requested.length ? messages.filter((message) => requested.includes(message.id)) : [];
  if (selected.length !== requested.length) throw new Error('Unknown context message ID');
  const allowed = new Set(draft.selectedEvidenceIds ?? []);
  return selected.map((message) => {
    if (!['user', 'assistant'].includes(message.role) || typeof message.text !== 'string' || !message.text.trim() || message.text.length > 20000
      || (message.delivery?.status && message.delivery.status !== 'delivered')) throw new Error('Invalid or undelivered context message');
    const segment = (conversation?.segments ?? []).find((item) => item.id === message.segmentId);
    if (message.segmentId && !segment) throw new Error('Unknown context segment');
    const evidenceIds = normalizeIds([...new Set([...(message.evidenceIds ?? []), ...(segment?.evidenceIds ?? [])])]);
    if (evidenceIds.some((id) => !allowed.has(id))) throw new Error('Sensitive context requires every evidence source to be explicitly selected');
    return { id: message.id, role: message.role, text: message.text, evidenceIds };
  });
}

export async function prepareOutbound({ caseManifest, conversation, draft, readEvidence, capabilities = {}, maxBytes = defaultMaxBytes } = {}) {
  assertObject(draft, 'Draft is required');
  if (draft.mode !== 'task') throw new Error('Autonomous mode is unavailable until Pi tools are verified');
  if (typeof draft.provider !== 'string' || !draft.provider.trim()) throw new Error('Provider is required');
  if (typeof draft.model !== 'string' || !draft.model.trim()) throw new Error('Model is required');
  if (typeof draft.prompt !== 'string' || !draft.prompt.trim() || draft.prompt.length > 20000) throw new Error('Prompt is empty or exceeds the text limit');
  if (typeof readEvidence !== 'function') throw new Error('Evidence reader is required');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid evidence size limit');
  const ids = normalizeIds(draft.selectedEvidenceIds ?? []);
  if (ids.length > 16) throw new Error('Attachment count limit exceeded');
  const context = contextMessages(conversation ?? { messages: [] }, draft);
  const manifestItems = manifestEvidence(caseManifest ?? { evidence: [] }, ids);
  const prepared = [];
  for (const item of manifestItems) prepared.push(await prepareAttachment(item, readEvidence, capabilities, maxBytes));
  const content = [{ type: 'text', text: draft.prompt.trim() }, ...prepared.map((item) => item.part)];
  const messages = [...context.map((message) => ({ role: message.role, content: [{ type: 'text', text: message.text }] })), { role: 'user', content }];
  const scope = Object.freeze({ evidenceIds: Object.freeze([...ids]), contextMessageIds: Object.freeze([...(draft.contextMessageIds ?? [])]) });
  const attachments = Object.freeze(prepared.map((item) => Object.freeze(item.summary)));
  const payload = {
    providerId: draft.provider,
    model: draft.model,
    prompt: draft.prompt.trim(),
    messages,
    context,
    attachments,
    scope,
  };
  const totalLimit = Math.min(defaultMaxBytes, capabilities.maxInputBytes ?? defaultMaxBytes);
  if (!Number.isSafeInteger(totalLimit) || totalLimit < 1 || Buffer.byteLength(JSON.stringify(payload), 'utf8') > totalLimit) throw new Error('Total outbound request size limit exceeded');
  return deepFreeze({ ...payload, requestHash: hash(payload) });
}

function previewFromPayload(payload) {
  return Object.freeze({
    provider: payload.providerId,
    model: payload.model,
    prompt: payload.prompt,
    attachments: payload.attachments,
    scope: payload.scope,
    contextMessageIds: payload.scope.contextMessageIds,
    contextMessages: payload.context,
    requestHash: payload.requestHash,
  });
}

export async function previewOutbound(input) {
  return previewFromPayload(await prepareOutbound(input));
}

export async function confirmOutbound(input, { accepted, preview } = {}) {
  if (accepted !== true) throw new Error('Explicit confirmation required before send');
  if (!preview || typeof preview.requestHash !== 'string') throw new Error('Send confirmation is required');
  const payload = await prepareOutbound(input);
  const expected = previewFromPayload(payload);
  if (stable(expected) !== stable(preview)) throw new Error('Send confirmation changed');
  return Object.freeze({ requestId: randomUUID(), authorization: Object.freeze({ mode: input.draft.mode, provider: payload.providerId, evidenceIds: payload.scope.evidenceIds }), payload });
}
