import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalDemoBroker } from './broker.mjs';

const authorization = Object.freeze({
  taskId: 'task-1',
  caseId: 'case-1',
  mode: 'task',
  provider: 'local-demo',
  evidenceIds: Object.freeze(['one']),
});

test('local demo broker returns a clearly labeled local response', async () => {
  const broker = createLocalDemoBroker();
  const response = await broker.send({ authorization, prompt: '整理事实', evidenceIds: ['one'] });
  assert.equal(response.role, 'assistant');
  assert.equal(response.provider, 'local-demo');
  assert.match(response.text, /本地演示/);
  assert.match(response.text, /整理事实/);
});

test('broker rejects attachments outside the confirmed authorization', async () => {
  const broker = createLocalDemoBroker();
  await assert.rejects(() => broker.send({ authorization, prompt: '读取其他材料', evidenceIds: ['two'] }), /scope|授权/i);
  await assert.rejects(() => broker.send({ authorization, prompt: 'x', evidenceIds: ['one', 'two'] }), /scope|授权/i);
});

test('broker rejects non-demo providers until a real provider adapter is explicitly added', async () => {
  const broker = createLocalDemoBroker();
  await assert.rejects(() => broker.send({
    authorization: { ...authorization, provider: 'custom-openai' },
    prompt: '发送',
    evidenceIds: ['one'],
  }), /demo|provider/i);
});
