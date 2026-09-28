import { randomUUID } from 'node:crypto';

export function createAuthorization(caseManifest, { mode, selectedEvidenceIds, provider }) {
  if (mode !== 'task' && mode !== 'autonomous') throw new Error('Invalid authorization mode');
  if (typeof provider !== 'string' || !provider.trim() || /[\x00-\x1f\x7f]/.test(provider)) {
    throw new Error('Invalid provider identifier');
  }
  const known = new Set(caseManifest.evidence.map((item) => item.id));
  const ids = mode === 'task' ? selectedEvidenceIds : caseManifest.evidence.map((item) => item.id);
  if (!Array.isArray(ids) || (mode === 'task' && ids.length === 0)) {
    throw new Error('Task mode requires selected evidence');
  }
  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new Error('Duplicate or unknown evidence ID');
  }
  return Object.freeze({
    taskId: randomUUID(),
    caseId: caseManifest.id,
    mode,
    provider,
    evidenceIds: Object.freeze([...ids]),
    createdAt: new Date().toISOString(),
  });
}

export function canReadEvidence(authorization, id) {
  return authorization.evidenceIds.includes(id);
}
