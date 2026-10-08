import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { readCase } from './cases.mjs';
import { assertLocalDirectory, decodeUtf8, MAX_MATERIAL_BYTES, readBoundedFile } from './local-files.mjs';

const textExtensions = new Set(['.txt', '.md', '.csv', '.json', '.log', '.xml', '.html', '.yaml', '.yml']);

function imageMime(extension, bytes) {
  if (extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (['.jpg', '.jpeg'].includes(extension) && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (extension === '.gif' && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (extension === '.webp' && bytes.length >= 16 && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) return 'image/webp';
  throw new Error('Image signature does not match its format');
}

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
    const mimeType = imageMime(extension, bytes);
    return { ...result, mimeType, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` };
  }
  throw new Error('Unsupported evidence format');
}
