import { randomUUID } from 'node:crypto';

function validateRequest({ authorization, prompt, evidenceIds }) {
  if (!authorization || authorization.provider !== 'local-demo') throw new Error('Only the local demo provider is enabled');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Prompt is required');
  if (!Array.isArray(evidenceIds) || evidenceIds.some((id) => !authorization.evidenceIds.includes(id))) {
    throw new Error('Requested evidence is outside the authorization scope');
  }
}

export function createLocalDemoBroker({ now = () => new Date().toISOString() } = {}) {
  return Object.freeze({
    async send(request) {
      validateRequest(request);
      const files = request.evidenceIds.length === 0 ? '没有附件' : `${request.evidenceIds.length} 份已授权附件`;
      return Object.freeze({
        id: randomUUID(),
        role: 'assistant',
        provider: 'local-demo',
        text: `【本地演示回复】我已收到任务“${request.prompt.trim()}”，当前只在本机模拟处理，未向云端发送内容。范围：${files}。结果仍需你自行核对。`,
        createdAt: now(),
      });
    },
  });
}
