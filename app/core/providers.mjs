import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEMO_PROVIDER = Object.freeze({
  id: 'local-demo',
  name: '本地演示模型',
  kind: 'demo',
  model: 'local-demo-1',
  endpoint: null,
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
  if (!/^[a-z][a-z0-9._-]*$/.test(id)) throw new Error('Invalid provider id');
  const kind = cleanText(input.kind, 'kind', 32);
  if (kind !== 'demo' && kind !== 'openai-compatible') throw new Error('Invalid provider kind');
  const model = cleanText(input.model, 'model', 160);
  const name = cleanText(input.name, 'name', 120);
  let endpoint = null;
  if (kind === 'openai-compatible') {
    if (typeof input.endpoint !== 'string') throw new Error('Invalid provider endpoint');
    let url;
    try { url = new URL(input.endpoint); } catch { throw new Error('Invalid provider endpoint'); }
    if (url.protocol !== 'https:') throw new Error('Provider endpoint must use HTTPS');
    endpoint = url.toString().replace(/\/$/, '');
  }
  return Object.freeze({ id, name, kind, model, endpoint });
}

function publicConfig(config, hasKey) {
  return Object.freeze({ ...config, hasKey: Boolean(hasKey) });
}

async function readConfigs(root) {
  if (!root) return [];
  try {
    const parsed = JSON.parse(await readFile(join(root, 'providers.json'), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeConfig).filter((config) => config.id !== DEMO_PROVIDER.id);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Provider settings are unreadable');
  }
}

async function writeConfigs(root, configs) {
  if (!root) return;
  await mkdir(root, { recursive: true });
  const temporary = join(root, `providers.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify(configs, null, 2), { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(root, 'providers.json'));
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
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

export async function saveProvider({ root, secretStore }, input, secret) {
  if (!secretStore || typeof secretStore.set !== 'function') throw new Error('Secret store is required');
  const config = normalizeConfig(input);
  if (config.kind !== 'demo' && (typeof secret !== 'string' || !secret.trim())) throw new Error('Provider key is required');
  if (config.kind === 'demo') await secretStore.delete(config.id);
  else await secretStore.set(config.id, secret);
  const existing = await readConfigs(root);
  const next = [...existing.filter((item) => item.id !== config.id && item.id !== DEMO_PROVIDER.id), config];
  await writeConfigs(root, next);
  return publicConfig(config, config.kind === 'demo' ? false : true);
}

export async function deleteProvider({ root, secretStore }, id) {
  const providerId = cleanText(id, 'id', 64).toLowerCase();
  if (providerId === DEMO_PROVIDER.id) throw new Error('The local demo provider cannot be deleted');
  await secretStore.delete(providerId);
  const existing = await readConfigs(root);
  await writeConfigs(root, existing.filter((item) => item.id !== providerId));
}

export async function readProvider({ root, secretStore }, id) {
  const providerId = cleanText(id, 'id', 64).toLowerCase();
  const configs = await readConfigs(root);
  const config = providerId === DEMO_PROVIDER.id ? DEMO_PROVIDER : configs.find((item) => item.id === providerId);
  if (!config) throw new Error('Unknown provider');
  return { config, secret: await secretStore.get(providerId) };
}
