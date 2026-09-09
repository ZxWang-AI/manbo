import type { MaterialObjectReader, MaterialObjectStore } from "./object-store";
import { LocalEncryptedObjectStore } from "./local-object-store";

export interface MaterialObjectStoreConfiguration {
  available: boolean;
  mode: "local" | "unavailable";
  store: MaterialObjectStore;
  reader?: MaterialObjectReader;
}

const unavailableMaterialObjectStore: MaterialObjectStore = {
  async beginEncryptedUpload() { throw new Error("MATERIAL_OBJECT_STORAGE_UNAVAILABLE"); },
  async completeEncryptedUpload() { throw new Error("MATERIAL_OBJECT_STORAGE_UNAVAILABLE"); },
  async abortUpload() {},
  async deleteObject() {},
};

function unavailable(): MaterialObjectStoreConfiguration {
  return {
    available: false,
    mode: "unavailable",
    store: unavailableMaterialObjectStore,
  };
}

function parseMasterKey(value: string | undefined): Uint8Array | null {
  if (!value || !/^[a-f0-9]{64}$/iu.test(value)) return null;
  const key = Buffer.from(value, "hex");
  return key.byteLength === 32 ? key : null;
}

function isAbsolutePath(value: string | undefined): value is string {
  if (!value) return false;
  return /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("/");
}

export function createMaterialObjectStoreFromEnv(
  environment: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): MaterialObjectStoreConfiguration {
  if (environment.NODE_ENV === "production" || environment.APP_MODE === "static") {
    return unavailable();
  }
  if (environment.MATERIAL_OBJECT_STORE !== "local") {
    return unavailable();
  }

  const rootDir = environment.MATERIAL_OBJECT_STORE_ROOT;
  const masterKey = parseMasterKey(environment.MATERIAL_OBJECT_STORE_MASTER_KEY);
  const keyVersion = environment.MATERIAL_OBJECT_STORE_KEY_VERSION;
  if (!isAbsolutePath(rootDir) || !masterKey || !keyVersion || !/^[A-Za-z0-9._-]{1,80}$/u.test(keyVersion)) {
    return unavailable();
  }

  try {
    const store = new LocalEncryptedObjectStore({ rootDir, masterKey, keyVersion });
    return { available: true, mode: "local", store, reader: store };
  } catch {
    return unavailable();
  }
}

