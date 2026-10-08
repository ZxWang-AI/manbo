import { isIP } from 'node:net';
import { createNoToolSession, createIsolatedModelRuntime } from './pi-session.mjs';

function privateHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') return true;
  const version = isIP(host);
  if (version === 4) {
    const parts = host.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  if (version === 6) return host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
  return false;
}

function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('Provider endpoint is invalid'); }
  if (url.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
  if (privateHost(url.hostname)) throw new Error('Private or local provider endpoints are not allowed');
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function validateScope(authorization, payload, providerId, model) {
  if (!authorization || authorization.provider !== providerId) throw new Error('Authorization provider mismatch');
  if (!Array.isArray(authorization.evidenceIds)) throw new Error('Invalid authorization scope');
  if (!payload || payload.providerId !== providerId || payload.model !== model) throw new Error('Payload provider or model mismatch');
  const requested = payload.scope?.evidenceIds;
  if (!Array.isArray(requested) || requested.some((id) => !authorization.evidenceIds.includes(id))) {
    throw new Error('Requested evidence is outside the authorization scope');
  }
}

function redactError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/secret|key|authorization|bearer|https?:\/\//i.test(message)) return new Error('Model request failed');
  return error instanceof Error ? error : new Error('Model request failed');
}

async function piSessionFactory({ provider, secret, model, promptContext, signal }) {
  const sdk = await import('@earendil-works/pi-coding-agent');
  const runtime = await createIsolatedModelRuntime(sdk, signal);
  runtime.registerProvider(provider.id, {
    name: provider.name,
    baseUrl: provider.endpoint,
    api: 'openai-completions',
    models: [{ id: model, name: model, reasoning: false, input: provider.capabilities?.images === true ? ['text', 'image'] : ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128_000, maxTokens: 8_192 }],
  });
  await runtime.setRuntimeApiKey(provider.id, secret, { signal });
  const selected = runtime.getModel(provider.id, model);
  if (!selected) throw new Error('Provider model is unavailable');
  return createNoToolSession({ cwd: process.cwd(), sdk, modelRuntime: runtime, promptContext, selectedModel: selected });
}

export function createModelGateway({ providerStore, sessionFactory = piSessionFactory, now = () => new Date().toISOString() } = {}) {
  if (!providerStore || typeof providerStore.readProvider !== 'function') throw new Error('Provider store is required');
  return Object.freeze({
    async send({ providerId, model, authorization, payload, signal } = {}) {
      if (typeof providerId !== 'string' || !providerId.trim()) throw new Error('Provider is required');
      if (providerId === 'local-demo') throw new Error('Local demo provider cannot make real model requests');
      const stored = await providerStore.readProvider(providerId);
      const provider = stored?.config;
      const secret = stored?.secret;
      if (!provider || provider.kind !== 'openai-compatible') throw new Error('Provider is not configured for real requests');
      if (typeof secret !== 'string' || !secret.trim()) throw new Error('Provider API key is missing');
      if (typeof model !== 'string' || !model.trim()) throw new Error('Model is required');
      validateEndpoint(provider.endpoint);
      validateScope(authorization, payload, providerId, model);
      const promptContext = Object.freeze({ messages: payload.messages, attachments: payload.attachments, scope: payload.scope });
      const hasImage = payload.messages.some((message) => message.content?.some?.((part) => part.type === 'image_url'));
      if (hasImage && provider.capabilities?.images !== true) throw new Error('Provider does not support image attachments');
      let session;
      try {
        session = await sessionFactory({ provider, secret, model, promptContext, authorization, signal });
        if (!session || typeof session.prompt !== 'function' || typeof session.dispose !== 'function') throw new Error('Model session is invalid');
        const text = await session.prompt(payload.prompt, { signal, context: promptContext });
        const response = typeof text === 'string' ? text : (typeof session.getLastAssistantText === 'function' ? session.getLastAssistantText() : '');
        if (!response || typeof response !== 'string') throw new Error('Model returned no text');
        return Object.freeze({ providerId, model, text: response, delivered: true, createdAt: now() });
      } catch (error) {
        throw redactError(error);
      } finally {
        if (session) {
          try { await session.dispose(); } catch { /* Cleanup must not replace the request outcome. */ }
        }
      }
    },
  });
}
