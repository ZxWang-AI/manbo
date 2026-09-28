import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const caseIdPattern = /^[0-9a-f-]{36}$/i;
const pendingImports = new Map();

function casePath(root, caseId) {
  if (typeof caseId !== 'string' || !caseIdPattern.test(caseId)) {
    throw new Error('Invalid case ID');
  }
  return join(root, caseId);
}

async function saveManifest(directory, manifest) {
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
  const id = randomUUID();
  const directory = casePath(root, id);
  const manifest = { id, createdAt: new Date().toISOString(), evidence: [] };
  await mkdir(join(directory, 'originals'), { recursive: true });
  await saveManifest(directory, manifest);
  return manifest;
}

export async function readCase(root, caseId) {
  const directory = casePath(root, caseId);
  return JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
}

export async function listCases(root) {
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const ids = entries.filter((entry) => entry.isDirectory() && caseIdPattern.test(entry.name));
  return Promise.all(ids.map((entry) => readCase(root, entry.name)));
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function importOne(root, caseId, sourcePath) {
  const directory = casePath(root, caseId);
  const source = await stat(sourcePath);
  if (!source.isFile()) throw new Error('Evidence source must be a regular file');
  const manifest = await readCase(root, caseId);
  const id = randomUUID();
  const storedName = `${id}${extname(sourcePath)}`;
  const target = join(directory, 'originals', storedName);
  await copyFile(sourcePath, target, constants.COPYFILE_EXCL);
  try {
    const copied = await stat(target);
    const evidence = {
      id,
      name: basename(sourcePath),
      storedName,
      sha256: await hashFile(target),
      bytes: copied.size,
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
