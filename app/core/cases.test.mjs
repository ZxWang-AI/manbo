import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCase, importEvidence, listCases, readCase } from './cases.mjs';

const roots = [];
after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function freshRoot() {
  const root = await mkdtemp(join(tmpdir(), 'manbo-case-'));
  roots.push(root);
  return root;
}

test('creates and lists a local case with an empty evidence manifest', async () => {
  const root = await freshRoot();
  const manifest = await createCase(root);
  assert.match(manifest.id, /^[0-9a-f-]{36}$/i);
  assert.deepEqual(manifest.evidence, []);
  assert.ok(Number.isFinite(Date.parse(manifest.createdAt)));
  assert.deepEqual(await readCase(root, manifest.id), manifest);
  assert.deepEqual(await listCases(root), [manifest]);
});

test('imports a byte-for-byte copy with a hash without changing the source', async () => {
  const root = await freshRoot();
  const source = join(root, 'sample.txt');
  const content = Buffer.from('A synthetic report\r\n', 'utf8');
  await writeFile(source, content);
  const { id } = await createCase(root);

  const evidence = await importEvidence(root, id, source);

  assert.equal(evidence.name, 'sample.txt');
  assert.match(evidence.storedName, /^[0-9a-f-]{36}\.txt$/i);
  assert.equal(evidence.bytes, content.length);
  assert.equal(evidence.sha256, createHash('sha256').update(content).digest('hex'));
  assert.deepEqual(await readFile(join(root, id, 'originals', evidence.storedName)), content);
  assert.deepEqual(await readFile(source), content);
  assert.deepEqual((await readCase(root, id)).evidence, [evidence]);
});

test('same-name imports retain separate originals', async () => {
  const root = await freshRoot();
  const source = join(root, 'sample.txt');
  const { id } = await createCase(root);
  await writeFile(source, 'first');
  const first = await importEvidence(root, id, source);
  await writeFile(source, 'second');
  const second = await importEvidence(root, id, source);

  assert.notEqual(first.storedName, second.storedName);
  assert.equal(await readFile(join(root, id, 'originals', first.storedName), 'utf8'), 'first');
  assert.equal(await readFile(join(root, id, 'originals', second.storedName), 'utf8'), 'second');
  assert.equal((await readCase(root, id)).evidence.length, 2);
});

test('rejects a path-like case ID before accessing a file', async () => {
  const root = await freshRoot();
  const source = join(root, 'sample.txt');
  await writeFile(source, 'synthetic');
  await assert.rejects(readCase(root, '../elsewhere'), /case ID/i);
  await assert.rejects(importEvidence(root, '../elsewhere', source), /case ID/i);
  assert.deepEqual(await readdir(root), ['sample.txt']);
});

test('rejects non-file sources', async () => {
  const root = await freshRoot();
  const { id } = await createCase(root);
  await assert.rejects(importEvidence(root, id, root), /regular file/i);
});

test('concurrent imports do not lose evidence entries', async () => {
  const root = await freshRoot();
  const source = join(root, 'sample.txt');
  await writeFile(source, 'synthetic');
  const { id } = await createCase(root);
  const imported = await Promise.all(Array.from({ length: 4 }, () => importEvidence(root, id, source)));
  const manifest = await readCase(root, id);
  assert.deepEqual(new Set(manifest.evidence.map((item) => item.id)), new Set(imported.map((item) => item.id)));
});

test('rejects an oversized import before copying or changing the manifest', async () => {
  const root = await freshRoot();
  const source = join(root, 'large.txt');
  await writeFile(source, Buffer.alloc(2 * 1024 * 1024 + 1, 65));
  const { id } = await createCase(root);
  await assert.rejects(importEvidence(root, id, source), /large|limit/i);
  assert.deepEqual((await readCase(root, id)).evidence, []);
  assert.deepEqual(await readdir(join(root, id, 'originals')), []);
});

test('rejects a stored filename escaping its generated evidence ID', async () => {
  const root = await freshRoot();
  const source = join(root, 'sample.txt');
  await writeFile(source, 'safe');
  const { id } = await createCase(root);
  await importEvidence(root, id, source);
  const manifest = await readCase(root, id);
  manifest.evidence[0].storedName = '../../sample.txt';
  await writeFile(join(root, id, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(readCase(root, id), /manifest|stored|path/i);
});

test('rejects a manifest whose ID differs from its directory ID', async () => {
  const root = await freshRoot();
  const { id } = await createCase(root);
  const other = await createCase(root);
  const manifest = await readCase(root, id);
  manifest.id = other.id;
  await writeFile(join(root, id, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(readCase(root, id), /manifest|case ID/i);
});
