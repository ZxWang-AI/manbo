import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assertLocalDirectory } from './local-files.mjs';
import { readLocalJson, serializeLocalMutation, writeLocalJson } from './local-json.mjs';

const caseIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roles = new Set(['user', 'assistant']);

function conversationPath(root, caseId) {
  if (typeof caseId !== 'string' || !caseIdPattern.test(caseId)) throw new Error('Invalid case ID');
  if (typeof root !== 'string' || !root) throw new Error('Conversation root is required');
  return join(root, caseId, 'conversation.json');
}

function validateMessage(message) {
  if (!message || typeof message !== 'object' || !roles.has(message.role)) throw new Error('Invalid conversation role');
  if (typeof message.text !== 'string' || !message.text.trim() || message.text.length > 20_000) {
    throw new Error('Invalid conversation text');
  }
  const evidenceIds = message.evidenceIds ?? [];
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 1024
    || evidenceIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id))
    || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error('Invalid conversation evidence IDs');
  }
  return { role: message.role, text: message.text, evidenceIds: [...evidenceIds] };
}

function blankConversation(caseId) {
  const timestamp = new Date().toISOString();
  return { id: randomUUID(), caseId, createdAt: timestamp, updatedAt: timestamp, messages: [] };
}

async function saveConversation(root, caseId, conversation) {
  conversationPath(root, caseId);
  const directory = join(root, caseId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await assertLocalDirectory(root);
  await writeLocalJson(directory, 'conversation.json', normalizeConversation(conversation, caseId), 4 * 1024 * 1024);
}

export async function createConversation(root, caseId) {
  const conversation = blankConversation(caseId);
  await saveConversation(root, caseId, conversation);
  return conversation;
}

function normalizeConversation(value, caseId) {
  if (!value || value.caseId !== caseId || !caseIdPattern.test(value.id)
    || !Array.isArray(value.messages) || value.messages.length > 1024
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid legacy conversation');
  const ids = new Set();
  const messages = value.messages.map((message) => {
    if (!message || typeof message.id !== 'string' || !caseIdPattern.test(message.id) || ids.has(message.id)
      || typeof message.createdAt !== 'string' || !Number.isFinite(Date.parse(message.createdAt))) throw new Error('Invalid legacy message');
    ids.add(message.id);
    return { id: message.id, ...validateMessage(message), createdAt: message.createdAt };
  });
  return { id: value.id, caseId, createdAt: value.createdAt, updatedAt: value.updatedAt, messages };
}

export async function readConversation(root, caseId, options = {}) {
  conversationPath(root, caseId);
  try {
    const missing = Symbol('missing');
    const value = await readLocalJson(join(root, caseId), 'conversation.json', missing, 4 * 1024 * 1024);
    return value !== missing ? normalizeConversation(value, caseId) : options.missing === null ? null : blankConversation(caseId);
  } catch (error) {
    if (error.code === 'ENOENT') return options.missing === null ? null : blankConversation(caseId);
    throw new Error('Conversation is unreadable');
  }
}

async function appendOne(root, caseId, message) {
  const conversation = await readConversation(root, caseId);
  const normalized = validateMessage(message);
  const entry = Object.freeze({ id: randomUUID(), ...normalized, createdAt: new Date().toISOString() });
  const next = {
    ...conversation,
    updatedAt: entry.createdAt,
    messages: [...conversation.messages, entry],
  };
  await saveConversation(root, caseId, next);
  return entry;
}

export function appendMessage(root, caseId, message) {
  conversationPath(root, caseId);
  return serializeLocalMutation(join(root, caseId), 'conversation.json', () => appendOne(root, caseId, message));
}
