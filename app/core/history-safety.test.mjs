import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { link, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatStore } from './chat-store.mjs';
import { previewOutbound } from './outbound-payload.mjs';
import { createConversation, appendMessage, readConversation } from './conversations.mjs';

async function fixture(t, sensitivity = 'clean', evidenceIds = []) {
  const root = await mkdtemp(join(tmpdir(), 'manbo-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createChatStore(root);
  const conversation = await store.create();
  const segment = await store.startSegment(conversation.id, { sensitivity, providerId: 'custom', evidenceIds });
  return { root, store, conversation, segment, file: join(root, 'conversations', `${conversation.id}.json`) };
}

test('simultaneous append across stores retains both messages', async (t) => {
  const { root, store, conversation } = await fixture(t);
  const other = createChatStore(root);
  await Promise.all([store.append(conversation.id, { role: 'user', text: 'one' }), other.append(conversation.id, { role: 'user', text: 'two' })]);
  assert.deepEqual((await store.read(conversation.id)).messages.map((m) => m.text).sort(), ['one', 'two']);
});

test('read whitelists fields and rejects a record whose ID differs from filename', async (t) => {
  const { store, conversation, file } = await fixture(t);
  const value = JSON.parse(await readFile(file, 'utf8'));
  value.apiKey = 'SYNTHETIC-UNEXPECTED-SECRET'; value.segments[0].apiKey = value.apiKey;
  await writeFile(file, JSON.stringify(value));
  assert.equal(JSON.stringify(await store.read(conversation.id)).includes('SYNTHETIC'), false);
  value.id = randomUUID(); await writeFile(file, JSON.stringify(value));
  await assert.rejects(store.read(conversation.id), /ID|mismatch|invalid/i);
});

test('evidence segment provenance cannot be cleared by a message', async (t) => {
  const { store, conversation } = await fixture(t, 'evidence', ['e1', 'e2']);
  const message = await store.append(conversation.id, { role: 'assistant', text: 'Derived evidence summary', evidenceIds: [] });
  assert.deepEqual(message.evidenceIds, ['e1', 'e2']);
  assert.deepEqual((await store.read(conversation.id)).messages[0].evidenceIds, ['e1', 'e2']);
});

test('linked conversation files and directory junctions are refused', async (t) => {
  const { root, store, conversation, file } = await fixture(t);
  await link(file, join(root, 'alias.json'));
  await assert.rejects(store.read(conversation.id), /link|unreadable/i);
  const directory = join(root, 'conversations'); const moved = join(root, 'moved');
  await rename(directory, moved); await symlink(moved, directory, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(store.list(), /link|path|directory/i);
});

test('legacy migration is idempotent, conservative and preserves original bytes', async (t) => {
  const { root, store } = await fixture(t);
  const caseId = randomUUID();
  const legacy = await createConversation(root, caseId);
  await appendMessage(root, caseId, { role: 'user', text: 'Selected source', evidenceIds: ['e1'] });
  await appendMessage(root, caseId, { role: 'assistant', text: 'Derived summary', evidenceIds: [] });
  const source = join(root, caseId, 'conversation.json'); const before = await readFile(source);
  const migrated = await store.migrateLegacy(caseId);
  assert.equal(migrated.id, legacy.id);
  assert.deepEqual(migrated.messages[1].evidenceIds, ['e1']);
  assert.equal(migrated.messages[1].providerId, 'legacy-local');
  assert.equal((await store.migrateLegacy(caseId)).id, migrated.id);
  assert.deepEqual(await createChatStore(root).read(migrated.id), migrated);
  assert.deepEqual(await readFile(source), before);
});

test('legacy records reject malformed IDs and unbounded or control-character provenance', async (t) => {
  const { root, store } = await fixture(t);
  const caseId = randomUUID(); await createConversation(root, caseId);
  await appendMessage(root, caseId, { role: 'user', text: 'Synthetic' });
  const file = join(root, caseId, 'conversation.json');
  const valid = JSON.parse(await readFile(file, 'utf8'));
  for (const value of [null, { ...valid, id: '-'.repeat(36) },
    ...[['bad\u0001id'], ['x'.repeat(257)], Array.from({length:1025}, (_,i) => `e${i}`)].map((evidenceIds) => ({ ...valid, messages: [{ ...valid.messages[0], evidenceIds }] }))]) {
    await writeFile(file, JSON.stringify(value)); const before = await readFile(file);
    await assert.rejects(store.migrateLegacy(caseId), /invalid|unreadable/i);
    assert.deepEqual(await readFile(file), before);
  }
});

test('history files are bounded and missing legacy records return null without creation', async (t) => {
  const { root, store, conversation, file } = await fixture(t);
  const missing = randomUUID();
  assert.equal(await readConversation(root, missing, { missing: null }), null);
  assert.equal(await store.migrateLegacy(missing), null);
  await writeFile(file, ' '.repeat(4 * 1024 * 1024 + 1));
  await assert.rejects(store.read(conversation.id), /unreadable|limit/i);
});

test('migration never overwrites a corrupt target and chat provenance rejects controls', async (t) => {
  const { root, store, conversation } = await fixture(t);
  const caseId = randomUUID(); const legacy = await createConversation(root, caseId);
  const target = join(root, 'conversations', `${legacy.id}.json`);
  await writeFile(target, 'null');
  await assert.rejects(store.migrateLegacy(caseId), /invalid|mismatch|not found/i);
  assert.equal(await readFile(target, 'utf8'), 'null');
  await assert.rejects(store.startSegment(conversation.id, { sensitivity:'evidence', providerId:'custom', evidenceIds:['e\u0001'] }), /invalid/i);
});

function historyInput({ selected = ['e1'], messages, segments, prompt = 'Summarize' } = {}) {
  const file = { id: 'e1', name: 'synthetic.txt', sha256: 'a'.repeat(64), bytes: 5, content: 'safe' };
  return {
    caseManifest: { evidence: [file] },
    conversation: { messages: messages ?? [{ id: 'm1', segmentId: 's1', role: 'assistant', text: 'Sensitive history', evidenceIds: [] }], segments: segments ?? [{ id: 's1', sensitivity: 'evidence', evidenceIds: ['e1', 'e2'] }] },
    draft: { mode: 'task', provider: 'custom', model: 'synthetic', prompt, selectedEvidenceIds: selected, contextMessageIds: ['m1'] },
    readEvidence: async () => file,
  };
}

test('every segment-derived history source must be authorized before any material read', async () => {
  const input = historyInput(); let reads = 0;
  input.readEvidence = async () => { reads++; throw new Error('must not read'); };
  await assert.rejects(previewOutbound(input), /Sensitive context/i);
  assert.equal(reads, 0);
});

test('history preview includes actual selected text and rejects duplicate IDs', async () => {
  const input = historyInput({ selected: [], segments: [{ id: 's1', sensitivity: 'clean', evidenceIds: [] }] });
  const preview = await previewOutbound(input);
  assert.equal(preview.contextMessages[0].text, 'Sensitive history');
  await assert.rejects(previewOutbound({ ...input, draft: { ...input.draft, contextMessageIds: ['m1', 'm1'] } }), /Duplicate|invalid/i);
});

test('prompt and history count limits are enforced before reads', async () => {
  const input = historyInput({ selected: [], segments: [{ id: 's1', sensitivity: 'clean', evidenceIds: [] }] });
  await assert.rejects(previewOutbound({ ...input, draft: { ...input.draft, prompt: 'x'.repeat(20001) } }), /Prompt|limit/i);
  const messages = Array.from({ length: 41 }, (_, i) => ({ id: `m${i}`, role: 'user', text: 'short', evidenceIds: [] }));
  await assert.rejects(previewOutbound({ ...input, conversation: { messages }, draft: { ...input.draft, contextMessageIds: messages.map((m) => m.id) } }), /limit/i);
});

test('aggregate UTF-8 representations obey Provider input byte cap', async () => {
  const input = historyInput({ selected: ['e1'], segments: [{ id: 's1', sensitivity: 'clean', evidenceIds: [] }] });
  input.readEvidence = async () => ({ id: 'e1', name: 'synthetic.txt', sha256: 'a'.repeat(64), bytes: 5, content: '汉'.repeat(1000) });
  input.capabilities = { maxInputBytes: 2048 };
  await assert.rejects(previewOutbound(input), /size|limit|large/i);
});

test('attachment count and missing context IDs reject before material access', async () => {
  const input = historyInput({ selected: [], segments: [{ id: 's1', sensitivity: 'clean', evidenceIds: [] }] });
  await assert.rejects(previewOutbound({ ...input, conversation: undefined }), /context/i);
  const items = Array.from({ length: 17 }, (_, i) => ({ id: `e${i}`, name: 's.txt', bytes: 1, sha256: 'a'.repeat(64), content: 'x' }));
  let reads = 0;
  await assert.rejects(previewOutbound({ ...input, caseManifest: { evidence: items }, draft: { ...input.draft, selectedEvidenceIds: items.map((item) => item.id) }, readEvidence: async (id) => { reads++; return items.find((item) => item.id === id); } }), /limit/i);
  assert.equal(reads, 0);
});
