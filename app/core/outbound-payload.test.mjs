import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareOutbound, previewOutbound, confirmOutbound } from './outbound-payload.mjs';

const caseManifest = {
  id: 'b99b9d2a-118e-4ff5-a296-730c510cd7e5',
  evidence: [
    { id: 'txt', name: 'note.txt', bytes: 12, sha256: 'a'.repeat(64), mimeType: 'text/plain' },
    { id: 'pdf', name: 'report.pdf', bytes: 100, sha256: 'b'.repeat(64), mimeType: 'application/pdf' },
    { id: 'img', name: 'photo.png', bytes: 20, sha256: 'c'.repeat(64), mimeType: 'image/png' },
  ],
};

const conversation = {
  id: 'c99b9d2a-118e-4ff5-a296-730c510cd7e5',
  messages: [],
};

const evidence = {
  txt: { id: 'txt', name: 'note.txt', bytes: 12, sha256: 'a'.repeat(64), mimeType: 'text/plain', content: '事实：2026-01-02。' },
  pdf: { id: 'pdf', name: 'report.pdf', bytes: 100, sha256: 'b'.repeat(64), mimeType: 'application/pdf', pages: [{ page: 1, text: '报告正文' }] },
  img: { id: 'img', name: 'photo.png', bytes: 20, sha256: 'c'.repeat(64), mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' },
};

const readEvidence = async (id) => evidence[id];

test('ordinary questions can be prepared without evidence', async () => {
  const payload = await prepareOutbound({
    caseManifest,
    conversation,
    draft: { mode: 'task', provider: 'custom', model: 'model-1', prompt: '如何区分事实和推测？', selectedEvidenceIds: [] },
    readEvidence,
    capabilities: { images: false },
  });
  assert.deepEqual(payload.attachments, []);
  assert.deepEqual(payload.scope.evidenceIds, []);
  assert.match(payload.messages.at(-1).content[0].text, /区分事实/);
});

test('text and PDF evidence become source-marked text parts without original bytes', async () => {
  const payload = await prepareOutbound({
    caseManifest,
    conversation,
    draft: { mode: 'task', provider: 'custom', model: 'model-1', prompt: '整理材料', selectedEvidenceIds: ['txt', 'pdf'] },
    readEvidence,
    capabilities: { images: false },
  });
  assert.equal(payload.attachments[0].representation, 'extracted-text');
  assert.equal(payload.attachments[1].representation, 'extracted-text');
  assert.match(payload.messages.at(-1).content.map((part) => part.text ?? '').join('\n'), /报告正文/);
  assert.equal(JSON.stringify(payload).includes('data:application/pdf'), false);
});

test('image evidence requires an explicitly supported provider capability', async () => {
  await assert.rejects(
    () => prepareOutbound({
      caseManifest,
      conversation,
      draft: { mode: 'task', provider: 'custom', model: 'model-1', prompt: '看图', selectedEvidenceIds: ['img'] },
      readEvidence,
      capabilities: { images: false },
    }),
    /image|图片|support/i,
  );
  const payload = await prepareOutbound({
    caseManifest,
    conversation,
    draft: { mode: 'task', provider: 'custom', model: 'model-1', prompt: '看图', selectedEvidenceIds: ['img'] },
    readEvidence,
    capabilities: { images: true },
  });
  assert.equal(payload.attachments[0].representation, 'image');
  assert.equal(payload.messages.at(-1).content.at(-1).type, 'image_url');
});

test('preview and confirmation reject changed prompt or evidence hash', async () => {
  const input = {
    caseManifest,
    conversation,
    draft: { mode: 'task', provider: 'custom', model: 'model-1', prompt: '整理', selectedEvidenceIds: ['txt'] },
    readEvidence,
    capabilities: { images: false },
  };
  const preview = await previewOutbound(input);
  assert.equal('content' in preview.attachments[0], false);
  await assert.rejects(
    () => confirmOutbound({ ...input, draft: { ...input.draft, prompt: '改过' } }, { accepted: true, preview }),
    /changed|mismatch|一致/i,
  );
  evidence.txt.sha256 = 'd'.repeat(64);
  await assert.rejects(
    () => confirmOutbound(input, { accepted: true, preview }),
    /changed|mismatch|一致/i,
  );
});

test('autonomous mode remains unavailable until isolated Pi tools are verified', async () => {
  await assert.rejects(
    () => prepareOutbound({
      caseManifest,
      conversation,
      draft: { mode: 'autonomous', provider: 'custom', model: 'model-1', prompt: '自动处理' },
      readEvidence,
      capabilities: { images: false },
    }),
    /Pi|tools|自治/i,
  );
});

