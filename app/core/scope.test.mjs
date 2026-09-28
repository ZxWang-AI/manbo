import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canReadEvidence, createAuthorization } from './scope.mjs';

const caseManifest = {
  id: 'b99b9d2a-118e-4ff5-a296-730c510cd7e5',
  evidence: [{ id: 'one' }, { id: 'two' }],
};

test('task mode grants only selected known evidence IDs', () => {
  const selectedEvidenceIds = ['one'];
  const auth = createAuthorization(caseManifest, { mode: 'task', selectedEvidenceIds, provider: 'test-provider' });
  selectedEvidenceIds.push('two');
  assert.equal(auth.caseId, caseManifest.id);
  assert.equal(auth.mode, 'task');
  assert.equal(auth.provider, 'test-provider');
  assert.match(auth.taskId, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(auth.evidenceIds, ['one']);
  assert.equal(canReadEvidence(auth, 'one'), true);
  assert.equal(canReadEvidence(auth, 'two'), false);
  assert.ok(Object.isFrozen(auth));
  assert.ok(Object.isFrozen(auth.evidenceIds));
});

test('autonomous mode snapshots existing evidence, not later imports', () => {
  const manifest = structuredClone(caseManifest);
  const auth = createAuthorization(manifest, { mode: 'autonomous', provider: 'test-provider' });
  manifest.evidence.push({ id: 'later' });
  assert.deepEqual(auth.evidenceIds, ['one', 'two']);
  assert.equal(canReadEvidence(auth, 'later'), false);
});

test('task mode rejects empty, duplicate and unknown selections', () => {
  for (const selectedEvidenceIds of [[], ['one', 'one'], ['missing']]) {
    assert.throws(() => createAuthorization(caseManifest, { mode: 'task', selectedEvidenceIds, provider: 'test-provider' }));
  }
});

test('rejects unknown modes and invalid provider identifiers', () => {
  assert.throws(() => createAuthorization(caseManifest, { mode: 'other', provider: 'test-provider' }), /mode/i);
  for (const provider of ['', 'bad\nprovider', undefined]) {
    assert.throws(() => createAuthorization(caseManifest, { mode: 'autonomous', provider }), /provider/i);
  }
});
