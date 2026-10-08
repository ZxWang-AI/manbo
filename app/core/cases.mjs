import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { assertLocalDirectory, decodeUtf8, MAX_MATERIAL_BYTES, readBoundedFile } from './local-files.mjs';

const caseIdPattern = /^[0-9a-f-]{36}$/i;
const pendingImports = new Map();

function casePath(root, caseId) {
  if (typeof caseId !== 'string' || !caseIdPattern.test(caseId)) {
    throw new Error('Invalid case ID');
  }
  return join(root, caseId);
}

async function saveManifest(directory, manifest) {
  await assertLocalDirectory(directory);
  const temporary = join(directory, `manifest.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await rename(temporary, join(directory, 'manifest.json'));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

export async function createCase(root) {
  await mkdir(root, { recursive: true });
  await assertLocalDirectory(root);
  const id = randomUUID();
  const directory = casePath(root, id);
  const manifest = { id, createdAt: new Date().toISOString(), evidence: [] };
  await mkdir(join(directory, 'originals'), { recursive: true });
  await saveManifest(directory, manifest);
  return manifest;
}

export async function readCase(root, caseId) {
  const directory = casePath(root, caseId);
  await assertLocalDirectory(root);
  await assertLocalDirectory(directory);
  const manifest = JSON.parse(decodeUtf8(await readBoundedFile(join(directory, 'manifest.json'), 2 * 1024 * 1024)));
  if (!manifest || manifest.id !== caseId || !Array.isArray(manifest.evidence) || manifest.evidence.length > 1024
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new Error('Invalid case manifest');
  }
  const known = new Set();
  for (const item of manifest.evidence) {
    if (!item || typeof item.id !== 'string' || !caseIdPattern.test(item.id) || known.has(item.id)
      || typeof item.name !== 'string' || !item.name || item.name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(item.name)
      || typeof item.storedName !== 'string' || item.storedName !== `${item.id}${extname(item.name)}`
      || !/^[0-9a-f-]{36}(?:\.[a-z0-9]{1,16})?$/i.test(item.storedName)
      || typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)
      || !Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > MAX_MATERIAL_BYTES
      || typeof item.importedAt !== 'string' || !Number.isFinite(Date.parse(item.importedAt))) {
      throw new Error('Invalid evidence manifest or stored path');
    }
    known.add(item.id);
  }
  await assertLocalDirectory(directory);
  return manifest;
}

export async function listCases(root) {
  try { await assertLocalDirectory(root); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const ids = entries.filter((entry) => entry.isDirectory() && caseIdPattern.test(entry.name));
  return Promise.all(ids.map((entry) => readCase(root, entry.name)));
}

async function importOne(root, caseId, sourcePath) {
  const directory = casePath(root, caseId);
  const manifest = await readCase(root, caseId);
  if (manifest.evidence.length >= 1024) throw new Error('Case evidence count limit reached');
  const name = basename(sourcePath);
  const extension = extname(sourcePath);
  if (!name || name.length > 255 || /[\\/\x00-\x1f\x7f]/.test(name) || (extension && !/^\.[a-z0-9]{1,16}$/i.test(extension))) {
    throw new Error('Invalid evidence filename');
  }
  const snapshot = await readBoundedFile(sourcePath, MAX_MATERIAL_BYTES);
  await assertLocalDirectory(join(directory, 'originals'));
  const id = randomUUID();
  const storedName = `${id}${extension}`;
  const target = join(directory, 'originals', storedName);
  await writeFile(target, snapshot, { flag: 'wx', mode: 0o600 });
  try {
    const evidence = {
      id,
      name,
      storedName,
      sha256: createHash('sha256').update(snapshot).digest('hex'),
      bytes: snapshot.length,
      importedAt: new Date().toISOString(),
    };
    await saveManifest(directory, { ...manifest, evidence: [...manifest.evidence, evidence] });
    return evidence;
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
}

export async function importEvidence(root, caseId, sourcePath) {
  const directory = casePath(root, caseId);
  const previous = pendingImports.get(directory) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => importOne(root, caseId, sourcePath));
  const settled = current.catch(() => {});
  pendingImports.set(directory, settled);
  void settled.then(() => {
    if (pendingImports.get(directory) === settled) pendingImports.delete(directory);
  });
  return current;
}
