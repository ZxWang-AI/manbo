import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertLocalDirectory } from './local-files.mjs';
import { readLocalJson, serializeLocalMutation, writeLocalJson } from './local-json.mjs';
import { readConversation } from './conversations.mjs';

const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set(['user', 'assistant']);
const sensitivities = new Set(['clean', 'evidence']);
const deliveryStatuses = new Set(['pending', 'queued', 'delivered', 'failed', 'unknown']);
const timestamps = new Map();
const maxConversationBytes = 4 * 1024 * 1024;

function assertRoot(root) {
  if (typeof root !== 'string' || !root.trim()) throw new Error('Conversation root is required');
  return root;
}

function assertId(id, label = 'conversation ID') {
  if (typeof id !== 'string' || !idPattern.test(id)) throw new Error(`Invalid ${label}`);
  return id;
}

function normalizeProviderId(providerId) {
  if (typeof providerId !== 'string' || !providerId.trim() || providerId.length > 128 || /[\\/\0\r\n]/.test(providerId)) {
    throw new Error('Invalid provider ID');
  }
  return providerId;
}

function normalizeEvidenceIds(evidenceIds) {
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 1024) throw new Error('Invalid conversation evidence IDs');
  if (evidenceIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id))) {
    throw new Error('Invalid conversation evidence IDs');
  }
  if (new Set(evidenceIds).size !== evidenceIds.length) throw new Error('Duplicate conversation evidence IDs');
  return [...evidenceIds];
}

function nextTimestamp(root, floor) {
  const floorMs = floor ? Date.parse(floor) : 0;
  const previousMs = timestamps.get(root) ?? 0;
  const nowMs = Date.now();
  const value = Math.max(nowMs, floorMs + 1, previousMs + 1);
  timestamps.set(root, value);
  return new Date(value).toISOString();
}

function normalizeTitle(title, caseId) {
  if (title === undefined || title === null || title === '') return caseId ? `案件 ${caseId.slice(0, 8)}` : '新对话';
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Invalid conversation title');
  return title.trim();
}

function normalizeDelivery(delivery) {
  if (delivery === undefined || delivery === null) return undefined;
  if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) throw new Error('Invalid delivery status');
  const result = {};
  if (delivery.status !== undefined) {
    if (typeof delivery.status !== 'string' || !deliveryStatuses.has(delivery.status)) throw new Error('Invalid delivery status');
    result.status = delivery.status;
  }
  if (delivery.requestId !== undefined) {
    if (typeof delivery.requestId !== 'string' || !delivery.requestId.trim() || delivery.requestId.length > 128) {
      throw new Error('Invalid delivery request ID');
    }
    result.requestId = delivery.requestId;
  }
  if (delivery.createdAt !== undefined) {
    if (typeof delivery.createdAt !== 'string' || Number.isNaN(Date.parse(delivery.createdAt))) {
      throw new Error('Invalid delivery timestamp');
    }
    result.createdAt = delivery.createdAt;
  }
  return result;
}

function normalizeSegmentInput(input = {}) {
  if (!input || typeof input !== 'object') throw new Error('Invalid segment');
  const { sensitivity, providerId } = input;
  if (!sensitivities.has(sensitivity)) throw new Error('Invalid segment sensitivity');
  const normalizedProviderId = normalizeProviderId(providerId);
  const evidenceIds = normalizeEvidenceIds(input.evidenceIds ?? []);
  if (sensitivity === 'clean' && evidenceIds.length > 0) throw new Error('Clean segment cannot include evidence');
  if (sensitivity === 'evidence' && evidenceIds.length === 0) throw new Error('Evidence segment requires evidence IDs');
  return { sensitivity, providerId: normalizedProviderId, evidenceIds };
}

function normalizeMessageInput(message, segment) {
  if (!message || typeof message !== 'object' || !roles.has(message.role)) throw new Error('Invalid conversation role');
  if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 20_000) {
    throw new Error('Invalid conversation text');
  }
  const evidenceIds = normalizeEvidenceIds(message.evidenceIds ?? []);
  const allowedEvidence = new Set(segment.evidenceIds);
  if (evidenceIds.some((id) => !allowedEvidence.has(id))) throw new Error('Message evidence is outside segment scope');
  const providerId = message.providerId === undefined ? segment.providerId : normalizeProviderId(message.providerId);
  if (providerId !== segment.providerId) throw new Error('Message provider does not match segment provider');
  const delivery = normalizeDelivery(message.delivery);
  // Outputs derived in an evidence segment retain ALL its sources, including historical ones.
  return { role: message.role, text: message.text, evidenceIds: [...segment.evidenceIds], providerId, ...(delivery ? { delivery } : {}) };
}

function normalizeSegment(segment) {
  if (!segment || typeof segment !== 'object' || !idPattern.test(segment.id)) throw new Error('Conversation segment is invalid');
  const normalized = normalizeSegmentInput(segment);
  return { id: segment.id, ...normalized };
}

function validateConversation(conversation) {
  if (!conversation || typeof conversation !== 'object') throw new Error('Conversation is invalid');
  assertId(conversation.id);
  if (conversation.caseId !== null && (typeof conversation.caseId !== 'string' || !idPattern.test(conversation.caseId))) {
    throw new Error('Conversation case ID is invalid');
  }
  if (typeof conversation.title !== 'string' || !conversation.title.trim() || conversation.title.length > 200) {
    throw new Error('Conversation title is invalid');
  }
  if (typeof conversation.createdAt !== 'string' || Number.isNaN(Date.parse(conversation.createdAt))) throw new Error('Conversation createdAt is invalid');
  if (typeof conversation.updatedAt !== 'string' || Number.isNaN(Date.parse(conversation.updatedAt))) throw new Error('Conversation updatedAt is invalid');
  if (!Array.isArray(conversation.segments) || !Array.isArray(conversation.messages)
    || conversation.segments.length > 1024 || conversation.messages.length > 1024) throw new Error('Conversation shape or count limit is invalid');
  const segments = conversation.segments.map(normalizeSegment);
  const segmentIds = new Set(segments.map((segment) => segment.id));
  if (new Set(segmentIds).size !== segments.length) throw new Error('Conversation segments are duplicated');
  if (conversation.activeSegmentId !== null && (!segmentIds.has(conversation.activeSegmentId))) throw new Error('Conversation active segment is invalid');
  const messageIds = new Set();
  const messages = conversation.messages.map((message) => {
    if (!message || typeof message !== 'object' || !idPattern.test(message.id)) throw new Error('Conversation message is invalid');
    if (!segmentIds.has(message.segmentId)) throw new Error('Conversation message segment is invalid');
    if (messageIds.has(message.id)) throw new Error('Duplicate conversation message ID');
    messageIds.add(message.id);
    const segment = segments.find((item) => item.id === message.segmentId);
    const normalized = normalizeMessageInput(message, segment);
    if (message.createdAt !== undefined && (typeof message.createdAt !== 'string' || Number.isNaN(Date.parse(message.createdAt)))) {
      throw new Error('Conversation message timestamp is invalid');
    }
    return { id: message.id, segmentId: message.segmentId, ...normalized, ...(message.createdAt ? { createdAt: message.createdAt } : {}) };
  });
  return { id: conversation.id, caseId: conversation.caseId, title: conversation.title, createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt, activeSegmentId: conversation.activeSegmentId, segments, messages };
}

function conversationFile(root, id) {
  return join(assertRoot(root), 'conversations', `${assertId(id)}.json`);
}

async function writeConversation(root, conversation) {
  const directory = join(assertRoot(root), 'conversations');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertLocalDirectory(root);
  conversationFile(root, conversation.id);
  await writeLocalJson(directory, `${conversation.id}.json`, validateConversation(conversation), maxConversationBytes);
}

function blankConversation(root, options = {}) {
  if (!options || typeof options !== 'object') throw new Error('Conversation options are required');
  const caseId = options.caseId === undefined ? null : options.caseId;
  if (caseId !== null) assertId(caseId, 'case ID');
  const id = randomUUID();
  const timestamp = nextTimestamp(root);
  return {
    id,
    caseId,
    title: normalizeTitle(options.title, caseId),
    createdAt: timestamp,
    updatedAt: timestamp,
    activeSegmentId: null,
    segments: [],
    messages: [],
  };
}

export function createChatStore(root) {
  assertRoot(root);

  async function create(options = {}) {
    const conversation = blankConversation(root, options);
    await writeConversation(root, conversation);
    return conversation;
  }

  async function read(id) {
    let parsed;
    try {
      conversationFile(root, id);
      parsed = await readLocalJson(join(root, 'conversations'), `${id}.json`, null, maxConversationBytes);
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Conversation not found');
      throw new Error('Conversation is unreadable');
    }
    if (!parsed) throw new Error('Conversation not found');
    if (parsed.id !== id) throw new Error('Conversation ID mismatch');
    return validateConversation(parsed);
  }

  async function list() {
    let entries;
    try {
      await assertLocalDirectory(join(root, 'conversations'));
      entries = await readdir(join(root, 'conversations'), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const summaries = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      if (!idPattern.test(id)) continue;
      const conversation = await read(id);
      const hasEvidence = conversation.segments.some((segment) => segment.evidenceIds.length > 0)
        || conversation.messages.some((message) => message.evidenceIds.length > 0);
      summaries.push({
        id: conversation.id,
        caseId: conversation.caseId,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        messageCount: conversation.messages.length,
        hasEvidence,
      });
    }
    return summaries.sort((a, b) => {
      const byDate = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
      return byDate || b.id.localeCompare(a.id);
    });
  }

  async function startSegmentOne(id, input = {}) {
    const conversation = await read(id);
    const normalized = normalizeSegmentInput(input);
    const segment = Object.freeze({ id: randomUUID(), ...normalized, evidenceIds: Object.freeze(normalized.evidenceIds) });
    const timestamp = nextTimestamp(root, conversation.updatedAt);
    const next = {
      ...conversation,
      updatedAt: timestamp,
      activeSegmentId: segment.id,
      segments: [...conversation.segments, segment],
    };
    await writeConversation(root, next);
    return segment;
  }

  async function appendOne(id, message = {}) {
    const conversation = await read(id);
    const segmentId = message.segmentId ?? conversation.activeSegmentId;
    if (typeof segmentId !== 'string') throw new Error('Conversation segment is required');
    const segment = conversation.segments.find((item) => item.id === segmentId);
    if (!segment) throw new Error('Conversation segment not found');
    const normalized = normalizeMessageInput(message, segment);
    const entry = Object.freeze({
      id: randomUUID(),
      segmentId,
      ...normalized,
      evidenceIds: Object.freeze(normalized.evidenceIds),
      ...(normalized.delivery ? { delivery: Object.freeze(normalized.delivery) } : {}),
      createdAt: nextTimestamp(root, conversation.updatedAt),
    });
    const next = { ...conversation, updatedAt: entry.createdAt, messages: [...conversation.messages, entry] };
    await writeConversation(root, next);
    return entry;
  }

  function mutate(id, operation) {
    conversationFile(root, id);
    return serializeLocalMutation(join(root, 'conversations'), `${id}.json`, operation);
  }

  async function appendExchangeOne(id, { segment: input, user, assistant, requestId } = {}) {
    const current = await read(id); const normalized = normalizeSegmentInput(input);
    const segment = { id:randomUUID(),...normalized };
    const messages = [['user',user],['assistant',assistant]].map(([role,text]) => ({
      id:randomUUID(),segmentId:segment.id,
      ...normalizeMessageInput({role,text,delivery:{status:'delivered',requestId}},segment),
      createdAt:nextTimestamp(root,current.updatedAt),
    }));
    await writeConversation(root,{...current,updatedAt:messages[1].createdAt,activeSegmentId:segment.id,
      segments:[...current.segments,segment],messages:[...current.messages,...messages]});
    return messages;
  }

  async function migrateLegacy(caseId) {
    assertId(caseId, 'case ID');
    const legacy = await readConversation(root, caseId, { missing: null });
    if (!legacy) return null;
    return mutate(legacy.id, async () => {
      const missing = Symbol('missing');
      const existing = await readLocalJson(join(root, 'conversations'), `${legacy.id}.json`, missing, maxConversationBytes);
      if (existing !== missing) {
        if (!existing || existing.caseId !== caseId) throw new Error('Legacy migration case mismatch');
        return read(legacy.id);
      }
      const segments = []; const messages = []; const inherited = new Set();
      for (const message of legacy.messages) {
        for (const id of message.evidenceIds) inherited.add(id);
        const segment = { id: randomUUID(), sensitivity: inherited.size ? 'evidence' : 'clean', providerId: 'legacy-local', evidenceIds: [...inherited] };
        segments.push(segment);
        messages.push({ id: message.id, segmentId: segment.id, role: message.role, text: message.text, providerId: 'legacy-local', evidenceIds: [...inherited], createdAt: message.createdAt });
      }
      const result = { id: legacy.id, caseId, title: `案件 ${caseId.slice(0, 8)}（旧记录）`, createdAt: legacy.createdAt, updatedAt: legacy.updatedAt,
        activeSegmentId: segments.at(-1)?.id ?? null, segments, messages };
      await writeConversation(root, result);
      return validateConversation(result);
    });
  }
  return Object.freeze({ create, list, read, migrateLegacy,
    appendExchange: (id,input) => mutate(id, () => appendExchangeOne(id,input)),
    append: (id, message = {}) => mutate(id, () => appendOne(id, message)),
    startSegment: (id, input = {}) => mutate(id, () => startSegmentOne(id, input)),
  });
}
