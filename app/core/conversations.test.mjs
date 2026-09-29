import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendMessage, createConversation, readConversation } from './conversations.mjs';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'manbo-conversation-test-'));
  const caseId = 'b99b9d2a-118e-4ff5-a296-730c510cd7e5';
  return { root, caseId };
}

test('creates and reloads a local conversation without any remote side effect', async () => {
  const { root, caseId } = await fixture();
  const conversation = await createConversation(root, caseId);
  assert.equal(conversation.caseId, caseId);
  assert.deepEqual(conversation.messages, []);
  await appendMessage(root, caseId, { role: 'user', text: '整理时间线', evidenceIds: ['evidence-1'] });
  const reloaded = await readConversation(root, caseId);
  assert.equal(reloaded.messages.length, 1);
  assert.equal(reloaded.messages[0].role, 'user');
  assert.deepEqual(reloaded.messages[0].evidenceIds, ['evidence-1']);
  assert.equal(JSON.stringify(reloaded).includes('apiKey'), false);
});

test('conversation messages are validated and appended atomically', async () => {
  const { root, caseId } = await fixture();
  await assert.rejects(() => appendMessage(root, caseId, { role: 'assistant', text: '   ' }), /text/i);
  await assert.rejects(() => appendMessage(root, caseId, { role: 'system', text: 'not allowed' }), /role/i);
  await appendMessage(root, caseId, { role: 'assistant', text: '待核实', evidenceIds: [] });
  const file = join(root, caseId, 'conversation.json');
  const raw = await readFile(file, 'utf8');
  assert.doesNotMatch(raw, /\.tmp/);
});
