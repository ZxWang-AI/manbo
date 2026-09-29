import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const caseIdPattern = /^[0-9a-f-]{36}$/i;
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
  if (!Array.isArray(evidenceIds) || evidenceIds.some((id) => typeof id !== 'string' || !id) || new Set(evidenceIds).size !== evidenceIds.length) {
    throw new Error('Invalid conversation evidence IDs');
  }
  return { role: message.role, text: message.text, evidenceIds: [...evidenceIds] };
}

function blankConversation(caseId) {
  const timestamp = new Date().toISOString();
  return { id: randomUUID(), caseId, createdAt: timestamp, updatedAt: timestamp, messages: [] };
}

async function saveConversation(root, caseId, conversation) {
  const file = conversationPath(root, caseId);
  const directory = join(root, caseId);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `conversation.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(conversation, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function createConversation(root, caseId) {
  const conversation = blankConversation(caseId);
  await saveConversation(root, caseId, conversation);
  return conversation;
}

export async function readConversation(root, caseId) {
  const file = conversationPath(root, caseId);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return blankConversation(caseId);
    throw new Error('Conversation is unreadable');
  }
}

export async function appendMessage(root, caseId, message) {
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
