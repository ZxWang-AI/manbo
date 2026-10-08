import { readLocalJson, serializeLocalMutation, writeLocalJson } from './local-json.mjs';

const file = 'provider-secrets.json';
const linuxBackends = new Set(['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6']);
const idPattern = /^[a-z][a-z0-9._-]{0,63}$/;

function assertId(id) {
  if (typeof id !== 'string' || !idPattern.test(id) || ['constructor', 'prototype'].includes(id)) throw new Error('Invalid credential ID');
}

function assertKey(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /[^\x20-\x7e]/.test(value)) throw new Error('Invalid provider Key value');
}

export function createSafeSecretStore({ root, safeStorage, platform = process.platform }) {
  function assertBackend() {
    if (!safeStorage.isEncryptionAvailable()
      || (platform === 'linux' && !linuxBackends.has(safeStorage.getSelectedStorageBackend?.()))) {
      throw new Error('系统凭据存储不可用或使用明文后端，无法使用 Provider Key');
    }
  }
  async function readRecords() {
    const records = await readLocalJson(root, file, {});
    if (!records || typeof records !== 'object' || Array.isArray(records) || Object.keys(records).length > 64) throw new Error('Invalid credential records');
    for (const [id, encoded] of Object.entries(records)) {
      assertId(id);
      if (typeof encoded !== 'string' || !encoded || encoded.length > 32768
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || Buffer.from(encoded, 'base64').toString('base64') !== encoded) {
        throw new Error('Invalid credential encoding');
      }
    }
    return records;
  }
  return Object.freeze({
    async get(id) {
      assertId(id);
      const records = await readRecords();
      if (!Object.hasOwn(records, id)) return null;
      assertBackend();
      try {
        const value = safeStorage.decryptString(Buffer.from(records[id], 'base64'));
        assertKey(value);
        return value;
      } catch { throw new Error('Provider credentials are unreadable'); }
    },
    async set(id, value) {
      assertId(id); assertKey(value); assertBackend();
      return serializeLocalMutation(root, file, async () => {
        const records = await readRecords();
        if (!Object.hasOwn(records, id) && Object.keys(records).length >= 64) throw new Error('Credential record limit exceeded');
        assertBackend();
        const encrypted = safeStorage.encryptString(value.trim());
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0 || encrypted.length > 24576) throw new Error('Invalid encrypted credential');
        records[id] = encrypted.toString('base64');
        await writeLocalJson(root, file, records);
      });
    },
    async delete(id) {
      assertId(id);
      return serializeLocalMutation(root, file, async () => {
        const records = await readRecords();
        delete records[id];
        await writeLocalJson(root, file, records);
      });
    },
  });
}
