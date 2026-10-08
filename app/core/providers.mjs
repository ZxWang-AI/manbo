import { readLocalJson, serializeLocalMutation, writeLocalJson } from './local-json.mjs';

const DEMO_PROVIDER = Object.freeze({
  id: 'local-demo',
  name: '本地演示模型',
  kind: 'demo',
  model: 'local-demo-1',
  endpoint: null,
  capabilities: Object.freeze({ images: false, maxInputBytes: 2 * 1024 * 1024, api: 'demo' }),
});

function cleanText(value, field, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`Invalid provider ${field}`);
  }
  return value.trim();
}

function normalizeConfig(input) {
  if (!input || typeof input !== 'object') throw new Error('Invalid provider config');
  const id = cleanText(input.id, 'id', 64).toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(id) || ['constructor', 'prototype'].includes(id)) throw new Error('Invalid provider id');
  const kind = cleanText(input.kind, 'kind', 32);
  if (kind !== 'demo' && kind !== 'openai-compatible') throw new Error('Invalid provider kind');
  const model = cleanText(input.model, 'model', 160);
  const name = cleanText(input.name, 'name', 120);
  let endpoint = null;
  const requestedCapabilities = input.capabilities && typeof input.capabilities === 'object' ? input.capabilities : {};
  const capabilities = Object.freeze({
    images: requestedCapabilities.images === true,
    maxInputBytes: Number.isSafeInteger(requestedCapabilities.maxInputBytes) && requestedCapabilities.maxInputBytes > 0
      ? Math.min(requestedCapabilities.maxInputBytes, 20 * 1024 * 1024)
      : 2 * 1024 * 1024,
    api: 'openai-completions',
  });
  if (kind === 'openai-compatible') {
    if (typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw new Error('Invalid provider endpoint');
    let url;
    try { url = new URL(input.endpoint); } catch { throw new Error('Invalid provider endpoint'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Invalid provider endpoint: HTTPS without credentials/query/fragment is required');
    endpoint = url.toString().replace(/\/$/, '');
  }
  return Object.freeze({ id, name, kind, model, endpoint, capabilities: kind === 'demo' ? DEMO_PROVIDER.capabilities : capabilities });
}

function publicConfig(config, hasKey) {
  return Object.freeze({ ...config, hasKey: Boolean(hasKey) });
}

async function readConfigs(root) {
  if (!root) return [];
  try {
    const parsed = await readLocalJson(root, 'providers.json', []);
    if (!Array.isArray(parsed) || parsed.length > 64) throw new Error('Invalid provider settings');
    const configs = parsed.map(normalizeConfig);
    if (new Set(configs.map((config) => config.id)).size !== configs.length) throw new Error('Duplicate provider ID');
    return configs.filter((config) => config.id !== DEMO_PROVIDER.id);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Provider settings are unreadable');
  }
}

async function writeConfigs(root, configs) {
  if (!root) return;
  await writeLocalJson(root, 'providers.json', configs);
}

export function createMemorySecretStore() {
  const values = new Map();
  return Object.freeze({
    async get(id) { return values.get(id) ?? null; },
    async set(id, value) { values.set(id, value); },
    async delete(id) { values.delete(id); },
  });
}

export async function listProviders({ root, secretStore, configs } = {}) {
  if (!secretStore || typeof secretStore.get !== 'function') throw new Error('Secret store is required');
  const custom = configs
    ? configs.map(({ hasKey: _hasKey, ...config }) => normalizeConfig(config))
    : await readConfigs(root);
  const all = [DEMO_PROVIDER, ...custom.filter((config) => config.id !== DEMO_PROVIDER.id)];
  return Promise.all(all.map(async (config) => publicConfig(config, Boolean(await secretStore.get(config.id)))));
}

async function saveOne({ root, secretStore }, input, secret) {
  if (!secretStore || typeof secretStore.set !== 'function') throw new Error('Secret store is required');
  const config = normalizeConfig(input);
  if (config.id === DEMO_PROVIDER.id) throw new Error('The local demo provider cannot be overwritten');
  if (config.kind !== 'demo' && (typeof secret !== 'string' || !secret.trim() || secret.length > 8192 || /[^\x20-\x7e]/.test(secret))) throw new Error('Invalid provider key');
  const existing = await readConfigs(root);
  const next = [...existing.filter((item) => item.id !== config.id && item.id !== DEMO_PROVIDER.id), config];
  if (next.length > 64) throw new Error('Provider count limit exceeded');
  if (config.kind === 'demo') await secretStore.delete(config.id);
  else await secretStore.set(config.id, secret);
  await writeConfigs(root, next);
  return publicConfig(config, config.kind === 'demo' ? false : true);
}

export function saveProvider(settings, input, secret) {
  return settings.root ? serializeLocalMutation(settings.root, 'providers.json', () => saveOne(settings, input, secret)) : saveOne(settings, input, secret);
}

async function deleteOne({ root, secretStore }, id) {
  const providerId = cleanText(id, 'id', 64).toLowerCase();
  if (providerId === DEMO_PROVIDER.id) throw new Error('The local demo provider cannot be deleted');
  await secretStore.delete(providerId);
  const existing = await readConfigs(root);
  await writeConfigs(root, existing.filter((item) => item.id !== providerId));
}

export function deleteProvider(settings, id) {
  return settings.root ? serializeLocalMutation(settings.root, 'providers.json', () => deleteOne(settings, id)) : deleteOne(settings, id);
}

export async function readProvider({ root, secretStore }, id) {
  const providerId = cleanText(id, 'id', 64).toLowerCase();
  const configs = await readConfigs(root);
  const config = providerId === DEMO_PROVIDER.id ? DEMO_PROVIDER : configs.find((item) => item.id === providerId);
  if (!config) throw new Error('Unknown provider');
  return { config, secret: await secretStore.get(providerId) };
}
