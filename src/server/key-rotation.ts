export interface RewrapDataEncryptionKeyInput {
  wrappedKey: string;
  currentVersion: string;
  nextVersion: string;
  unwrap(wrappedKey: string, keyVersion: string): Promise<Uint8Array>;
  wrap(dataEncryptionKey: Uint8Array, keyVersion: string): Promise<string>;
  verify(wrappedKey: string, keyVersion: string): Promise<void>;
}

export interface RewrappedDataEncryptionKey {
  wrappedKey: string;
  keyVersion: string;
}

/**
 * Re-wraps only the data-encryption key. Plaintext objects never enter this
 * operation. If any step fails, the caller keeps the original version.
 */
export async function rewrapDataEncryptionKey(
  input: RewrapDataEncryptionKeyInput,
): Promise<RewrappedDataEncryptionKey> {
  if (!input.wrappedKey || !input.currentVersion || !input.nextVersion || input.currentVersion === input.nextVersion) {
    throw new Error("KEY_ROTATION_INPUT_INVALID");
  }
  const dataEncryptionKey = await input.unwrap(input.wrappedKey, input.currentVersion);
  if (dataEncryptionKey.byteLength !== 32) {
    throw new Error("KEY_ROTATION_DATA_KEY_INVALID");
  }
  const wrappedKey = await input.wrap(dataEncryptionKey, input.nextVersion);
  await input.verify(wrappedKey, input.nextVersion);
  return { wrappedKey, keyVersion: input.nextVersion };
}

export const rotateWrappedKey = rewrapDataEncryptionKey;
