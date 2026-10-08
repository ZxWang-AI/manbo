import { createNoToolSession, createIsolatedModelRuntime } from './pi-session.mjs';
import { createProviderTransport, validateProviderEndpoint } from './provider-transport.mjs';

function validateScope(authorization, payload, providerId, model) {
  if (!authorization || authorization.provider !== providerId) throw new Error('Authorization provider mismatch');
  if (!Array.isArray(authorization.evidenceIds)) throw new Error('Invalid authorization scope');
  if (!payload || payload.providerId !== providerId || payload.model !== model) throw new Error('Payload provider or model mismatch');
  const requested = payload.scope?.evidenceIds;
  if (!Array.isArray(requested) || requested.some((id) => !authorization.evidenceIds.includes(id))) {
    throw new Error('Requested evidence is outside the authorization scope');
  }
}

async function piSessionFactory({ provider, secret, model, promptContext, signal, requestFetch }) {
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
  return createNoToolSession({ cwd: process.cwd(), sdk, modelRuntime: runtime, promptContext, selectedModel: selected, requestFetch });
}

export function createModelGateway({ providerStore, sessionFactory = piSessionFactory, transportFactory = createProviderTransport, now = () => new Date().toISOString() } = {}) {
  if (!providerStore || typeof providerStore.readProvider !== 'function') throw new Error('Provider store is required');
  return Object.freeze({
    async send({ providerId, model, authorization, payload, signal } = {}) {
      if (typeof providerId !== 'string' || !providerId.trim()) throw new Error('Provider is required');
      if (providerId === 'local-demo') throw new Error('Local demo provider cannot make real model requests');
      const stored = await providerStore.readProvider(providerId);
      let provider = stored?.config;
      const secret = stored?.secret;
      if (!provider || provider.kind !== 'openai-compatible') throw new Error('Provider is not configured for real requests');
      if (typeof secret !== 'string' || !secret.trim()) throw new Error('Provider API key is missing');
      if (typeof model !== 'string' || !model.trim()) throw new Error('Model is required');
      provider = { ...provider, endpoint: validateProviderEndpoint(provider.endpoint) };
      validateScope(authorization, payload, providerId, model);
      const promptContext = Object.freeze({ messages: payload.messages, attachments: payload.attachments, scope: payload.scope });
      const hasImage = payload.messages.some((message) => message.content?.some?.((part) => part.type === 'image_url'));
      if (hasImage && provider.capabilities?.images !== true) throw new Error('Provider does not support image attachments');
      let session, transport;
      try {
        transport = transportFactory({ endpoint: provider.endpoint, secret, signal });
        session = await sessionFactory({ provider, secret, model, promptContext, authorization, signal, requestFetch: transport.fetch });
        if (!session || typeof session.prompt !== 'function' || typeof session.dispose !== 'function') throw new Error('Model session is invalid');
        const text = await session.prompt(payload.prompt, { signal, context: promptContext });
        const response = typeof text === 'string' ? text : (typeof session.getLastAssistantText === 'function' ? session.getLastAssistantText() : '');
        if (!response || typeof response !== 'string' || response.length > 20_000) throw new Error('Model returned invalid text');
        return Object.freeze({ providerId, model, text: response, delivered: true, createdAt: now() });
      } catch {
        throw new Error('Model request failed');
      } finally {
        if (session) {
          try { await session.dispose(); } catch { /* Cleanup must not replace the request outcome. */ }
        }
        transport?.dispose();
      }
    },
  });
}
