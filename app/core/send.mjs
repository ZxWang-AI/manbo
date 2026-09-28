import { randomUUID } from 'node:crypto';
import { createAuthorization } from './scope.mjs';

function normalizeDraft(caseManifest, draft) {
  if (!draft || typeof draft !== 'object') throw new Error('Invalid send draft');
  const { mode, provider, prompt } = draft;
  if (mode !== 'task' && mode !== 'autonomous') throw new Error('Invalid authorization mode');
  if (typeof provider !== 'string' || !provider.trim() || /[\x00-\x1f\x7f]/.test(provider)) {
    throw new Error('Invalid provider identifier');
  }
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required');

  const known = new Set(caseManifest.evidence.map((item) => item.id));
  const evidenceIds = mode === 'autonomous'
    ? caseManifest.evidence.map((item) => item.id)
    : draft.selectedEvidenceIds;
  if (!Array.isArray(evidenceIds) || (mode === 'task' && evidenceIds.length === 0)) {
    throw new Error('Task mode requires selected evidence');
  }
  if (new Set(evidenceIds).size !== evidenceIds.length || evidenceIds.some((id) => !known.has(id))) {
    throw new Error('Duplicate or unknown evidence ID');
  }
  return {
    mode,
    provider,
    prompt,
    evidenceIds: [...evidenceIds],
  };
}

function evidencePreview(caseManifest, evidenceIds) {
  const byId = new Map(caseManifest.evidence.map((item) => [item.id, item]));
  return evidenceIds.map((id) => {
    const item = byId.get(id);
    return {
      id: item.id,
      name: item.name,
      sha256: item.sha256,
      bytes: item.bytes,
    };
  });
}

function freezePreview(value) {
  Object.freeze(value.evidence);
  for (const item of value.evidence) Object.freeze(item);
  return Object.freeze(value);
}

export function previewSend(caseManifest, draft) {
  const normalized = normalizeDraft(caseManifest, draft);
  return freezePreview({
    caseId: caseManifest.id,
    mode: normalized.mode,
    provider: normalized.provider,
    evidence: evidencePreview(caseManifest, normalized.evidenceIds),
    prompt: normalized.prompt,
  });
}

export function confirmSend(caseManifest, draft, { accepted, preview } = {}) {
  if (accepted !== true) throw new Error('Explicit confirmation required before send');
  if (!preview || JSON.stringify(preview) !== JSON.stringify(previewSend(caseManifest, draft))) {
    throw new Error('Send confirmation changed');
  }
  const normalized = normalizeDraft(caseManifest, draft);
  const authorization = createAuthorization(caseManifest, {
    mode: normalized.mode,
    selectedEvidenceIds: normalized.evidenceIds,
    provider: normalized.provider,
  });
  return Object.freeze({
    requestId: randomUUID(),
    caseId: caseManifest.id,
    prompt: normalized.prompt,
    authorization,
  });
}
