import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { readCase } from './cases.mjs';
import { assertLocalDirectory, decodeUtf8, MAX_MATERIAL_BYTES, readBoundedFile } from './local-files.mjs';

const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.yaml', '.yml']);

export async function readEvidenceForOutbound(root, caseId, evidenceId) {
  if (typeof evidenceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(evidenceId)) throw new Error('Invalid evidence ID');
  const manifest = await readCase(root, caseId);
  const item = manifest.evidence.find((entry) => entry.id === evidenceId);
  if (!item) throw new Error('Unknown evidence ID');
  const originals = join(root, caseId, 'originals');
  await assertLocalDirectory(originals);
  const bytes = await readBoundedFile(join(originals, item.storedName), MAX_MATERIAL_BYTES);
  await assertLocalDirectory(originals);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== item.sha256 || bytes.length !== item.bytes) throw new Error('Evidence changed since import');
  const result = { ...item, sha256, bytes: bytes.length };
  const extension = extname(item.name).toLowerCase();
  if (extension === '.pdf') throw new Error('PDF extraction is unsupported: a verified local parser is not available');
  if (textExtensions.has(extension)) {
    const content = decodeUtf8(bytes);
    if (!content.trim() || content.includes('\0')) throw new Error('Text evidence is empty or unreadable');
    return { ...result, mimeType: 'text/plain', content };
  }
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(extension)) {
    throw new Error('Image extraction is unsupported: a verified local decoder is not available');
  }
  throw new Error('Unsupported evidence format');
}
