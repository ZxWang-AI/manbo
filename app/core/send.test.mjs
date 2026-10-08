import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmSend, previewSend } from './send.mjs';

const caseManifest = {
  id: 'b99b9d2a-118e-4ff5-a296-730c510cd7e5',
  evidence: [
    { id: 'one', name: 'first.txt', sha256: 'a'.repeat(64), bytes: 4 },
    { id: 'two', name: 'second.txt', sha256: 'b'.repeat(64), bytes: 5 },
  ],
};

test('preview lists selected attachments without reading or embedding file contents', () => {
  const preview = previewSend(caseManifest, {
    mode: 'task',
    provider: 'default-service',
    selectedEvidenceIds: ['two'],
    prompt: '整理时间线并标出待核实信息',
  });

  assert.deepEqual(preview, {
    caseId: caseManifest.id,
    mode: 'task',
    provider: 'default-service',
    evidence: [{ id: 'two', name: 'second.txt', sha256: 'b'.repeat(64), bytes: 5 }],
    prompt: '整理时间线并标出待核实信息',
  });
  assert.equal('content' in preview.evidence[0], false);
});

test('confirmation is required before a send authorization is created', () => {
  const draft = {
    mode: 'task',
    provider: 'default-service',
    selectedEvidenceIds: ['one'],
    prompt: '只整理事实，不作法律结论',
  };
  const preview = previewSend(caseManifest, draft);

  assert.throws(() => confirmSend(caseManifest, draft, { accepted: false }), /confirm/i);
  const result = confirmSend(caseManifest, draft, { accepted: true, preview });
  assert.equal(result.caseId, caseManifest.id);
  assert.equal(result.prompt, draft.prompt);
  assert.deepEqual(result.authorization.evidenceIds, ['one']);
  assert.equal(result.authorization.mode, 'task');
  assert.match(result.requestId, /^[0-9a-f-]{36}$/i);
});

test('confirmation rejects a changed draft while allowing a clean task scope', () => {
  const draft = {
    mode: 'task',
    provider: 'default-service',
    selectedEvidenceIds: ['one'],
    prompt: '原始提示词',
  };
  const preview = previewSend(caseManifest, draft);

  assert.throws(() => confirmSend(caseManifest, { ...draft, prompt: '修改后的提示词' }, { accepted: true, preview }), /changed/i);
  assert.throws(() => previewSend(caseManifest, { ...draft, selectedEvidenceIds: ['missing'] }), /unknown/i);
  assert.deepEqual(previewSend(caseManifest, { ...draft, selectedEvidenceIds: [] }).evidence, []);
  assert.throws(() => previewSend(caseManifest, { ...draft, prompt: '   ' }), /prompt/i);
});

test('autonomous mode remains unavailable until Pi tools are verified', () => {
  const draft = {
    mode: 'autonomous',
    provider: 'custom-provider',
    prompt: '自行整理案件工作区并列出下一步',
  };
  assert.throws(() => previewSend(caseManifest, draft), /autonomous|Pi|tools/i);
});
