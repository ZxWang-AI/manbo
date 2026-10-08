import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChatStore } from './chat-store.mjs';

async function fixture() {
  return mkdtemp(join(tmpdir(), 'manbo-chat-store-test-'));
}

test('stores ordinary and evidence segments separately', async () => {
  const root = await fixture();
  const store = createChatStore(root);
  const chat = await store.create({ title: '普通问题' });

  const clean = await store.startSegment(chat.id, {
    sensitivity: 'clean',
    providerId: 'custom',
    evidenceIds: [],
  });
  await store.append(chat.id, {
    role: 'user',
    text: '什么是时间线？',
    segmentId: clean.id,
    providerId: 'custom',
  });
  await store.append(chat.id, {
    role: 'assistant',
    text: '把事件按发生顺序排列。',
    segmentId: clean.id,
    providerId: 'custom',
  });

  const evidence = await store.startSegment(chat.id, {
    sensitivity: 'evidence',
    providerId: 'custom',
    evidenceIds: ['e1'],
  });
  await store.append(chat.id, {
    role: 'assistant',
    text: '待核对摘要',
    segmentId: evidence.id,
    providerId: 'custom',
    evidenceIds: ['e1'],
    delivery: { status: 'delivered', requestId: 'request-1' },
  });

  const saved = await store.read(chat.id);
  assert.equal(saved.caseId, null);
  assert.equal(saved.segments[0].sensitivity, 'clean');
  assert.deepEqual(saved.segments[1].evidenceIds, ['e1']);
  assert.equal(saved.activeSegmentId, evidence.id);
  assert.equal(JSON.stringify(saved).includes('sk-test-secret'), false);
  assert.equal(JSON.stringify(saved).includes('C:\\private\\evidence.txt'), false);
});

test('lists newest-first summaries and marks evidence chats', async () => {
  const root = await fixture();
  const store = createChatStore(root);
  const ordinary = await store.create({ title: '普通问题' });
  const caseChat = await store.create({ caseId: 'b99b9d2a-118e-4ff5-a296-730c510cd7e5', title: '案件' });
  const segment = await store.startSegment(caseChat.id, {
    sensitivity: 'evidence',
    providerId: 'custom',
    evidenceIds: ['e1'],
  });
  await store.append(caseChat.id, {
    role: 'user',
    text: '整理证据',
    segmentId: segment.id,
    providerId: 'custom',
    evidenceIds: ['e1'],
  });

  const summaries = await store.list();
  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].id, caseChat.id);
  assert.equal(summaries[0].messageCount, 1);
  assert.equal(summaries[0].hasEvidence, true);
  assert.equal(summaries[1].id, ordinary.id);
  assert.equal(summaries[1].hasEvidence, false);
  assert.equal('messages' in summaries[0], false);
});

test('rejects invalid segment scope and provider changes within a segment', async () => {
  const root = await fixture();
  const store = createChatStore(root);
  const chat = await store.create({ title: '范围校验' });

  await assert.rejects(
    () => store.startSegment(chat.id, { sensitivity: 'unknown', providerId: 'custom', evidenceIds: [] }),
    /sensitivity/i,
  );
  await assert.rejects(
    () => store.startSegment(chat.id, { sensitivity: 'evidence', providerId: 'custom', evidenceIds: ['e1', 'e1'] }),
    /evidence/i,
  );

  const segment = await store.startSegment(chat.id, {
    sensitivity: 'clean',
    providerId: 'custom',
    evidenceIds: [],
  });
  await assert.rejects(
    () => store.append(chat.id, {
      role: 'user',
      text: '不应使用另一个 Provider',
      segmentId: segment.id,
      providerId: 'other-provider',
    }),
    /provider/i,
  );
});

test('reloads a persisted ordinary conversation with a clean segment', async () => {
  const root = await fixture();
  const store = createChatStore(root);
  const chat = await store.create({ caseId: null, title: '可恢复对话' });
  const segment = await store.startSegment(chat.id, {
    sensitivity: 'clean',
    providerId: 'custom',
    evidenceIds: [],
  });
  await store.append(chat.id, {
    role: 'user',
    text: '你好',
    segmentId: segment.id,
    providerId: 'custom',
  });

  const reloaded = createChatStore(root);
  const saved = await reloaded.read(chat.id);
  assert.equal(saved.id, chat.id);
  assert.equal(saved.messages.length, 1);
  assert.deepEqual(saved.messages[0].evidenceIds, []);
});
