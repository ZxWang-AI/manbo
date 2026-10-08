import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdtemp, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCase, importEvidence, readCase } from './cases.mjs';
import { readEvidenceForOutbound } from './evidence-reader.mjs';
import { confirmOutbound, previewOutbound } from './outbound-payload.mjs';

async function fixture(t, content = Buffer.from('safe'), name = 'sample.txt') {
  const root = await mkdtemp(join(tmpdir(), 'manbo-material-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, name);
  await writeFile(source, content);
  const { id } = await createCase(root);
  const item = await importEvidence(root, id, source);
  return { root, source, id, item, target: join(root, id, 'originals', item.storedName) };
}

test('outbound material hash and size come from actual bytes; source stays unchanged', async (t) => {
  const { root, source, id, item } = await fixture(t);
  const result = await readEvidenceForOutbound(root, id, item.id);
  assert.equal(result.content, 'safe');
  assert.equal(result.bytes, 4);
  assert.equal(result.sha256, createHash('sha256').update('safe').digest('hex'));
  assert.equal(await readFile(source, 'utf8'), 'safe');
});

test('same-size tampering is rejected before outbound preparation', async (t) => {
  const { root, source, id, item, target } = await fixture(t);
  await writeFile(target, 'xxxx');
  await assert.rejects(readEvidenceForOutbound(root, id, item.id), /changed/i);
  assert.equal(await readFile(source, 'utf8'), 'safe');
});

test('real-file tampering after preview cannot reach a confirmed payload', async (t) => {
  const { root, source, id, item, target } = await fixture(t);
  const input = {
    caseManifest: await readCase(root, id),
    draft: { mode: 'task', provider: 'synthetic', model: 'synthetic', prompt: 'Summarize', selectedEvidenceIds: [item.id] },
    readEvidence: (evidenceId) => readEvidenceForOutbound(root, id, evidenceId),
  };
  const preview = await previewOutbound(input);
  await writeFile(target, 'xxxx');
  await assert.rejects(confirmOutbound(input, { accepted: true, preview }), /changed/i);
  assert.equal(await readFile(source, 'utf8'), 'safe');
});

test('larger material copy is rejected instead of trusting manifest size', async (t) => {
  const { root, id, item, target } = await fixture(t);
  await writeFile(target, Buffer.alloc(2 * 1024 * 1024 + 1));
  await assert.rejects(readEvidenceForOutbound(root, id, item.id), /large|limit/i);
});

test('malformed UTF-8 text is never silently replacement-decoded', async (t) => {
  const { root, id, item } = await fixture(t, Buffer.from([0xc3, 0x28]));
  await assert.rejects(readEvidenceForOutbound(root, id, item.id), /UTF-8/i);
});

test('hardlinked evidence copies are rejected', async (t) => {
  const { root, id, item, target, source } = await fixture(t);
  await unlink(target);
  await link(source, target);
  await assert.rejects(readEvidenceForOutbound(root, id, item.id), /link/i);
  assert.equal(await readFile(source, 'utf8'), 'safe');
});

test('hardlinked import sources are rejected without modifying either link', async (t) => {
  const { root, id, source } = await fixture(t);
  const other = join(root, 'linked.txt');
  await link(source, other);
  await assert.rejects(importEvidence(root, id, other), /link/i);
  assert.equal(await readFile(source, 'utf8'), 'safe');
  assert.equal(await readFile(other, 'utf8'), 'safe');
});

test('an originals directory junction cannot redirect material reads', async (t) => {
  const { root, id, item } = await fixture(t);
  const originals = join(root, id, 'originals');
  const moved = join(root, 'moved');
  await rename(originals, moved);
  await symlink(moved, originals, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readEvidenceForOutbound(root, id, item.id), /link|directory|path/i);
});

test('unknown formats and PDF are explicitly refused without a real parser', async (t) => {
  for (const name of ['sample.exe', 'sample.pdf']) {
    const { root, id, item } = await fixture(t, Buffer.from('synthetic not a parsed document'), name);
    await assert.rejects(readEvidenceForOutbound(root, id, item.id), /Unsupported|PDF/i);
  }
});

test('an image extension cannot disguise non-image bytes', async (t) => {
  const { root, id, item } = await fixture(t, Buffer.from('not a PNG'), 'sample.png');
  await assert.rejects(readEvidenceForOutbound(root, id, item.id), /image|signature/i);
});

test('path-like and unknown evidence IDs cannot trigger a read outside the manifest', async (t) => {
  const { root, id } = await fixture(t);
  await assert.rejects(readEvidenceForOutbound(root, id, '../sample.txt'), /ID/i);
  await assert.rejects(readEvidenceForOutbound(root, id, '00000000-0000-4000-8000-000000000001'), /Unknown evidence/i);
});
