import { describe, expect, it } from "vitest";
import path from "node:path";

import {
  createMaterialObjectStoreFromEnv,
  type MaterialObjectStoreConfiguration,
} from "@/media/storage/object-store-factory";

const validEnvironment = {
  NODE_ENV: "development",
  APP_MODE: "normal",
  MATERIAL_OBJECT_STORE: "local",
  MATERIAL_OBJECT_STORE_ROOT: path.resolve("manbo-private-materials"),
  MATERIAL_OBJECT_STORE_MASTER_KEY: "07".repeat(32),
  MATERIAL_OBJECT_STORE_KEY_VERSION: "local-kek-v1",
};

describe("material object store configuration", () => {
  it("enables the local encrypted adapter only with explicit non-production configuration", () => {
    const configuration = createMaterialObjectStoreFromEnv(validEnvironment);

    expect(configuration).toMatchObject<Partial<MaterialObjectStoreConfiguration>>({
      available: true,
      mode: "local",
    });
    expect(configuration.store).toBeDefined();
  });

  it("fails closed in production even when local storage variables are present", () => {
    const configuration = createMaterialObjectStoreFromEnv({ ...validEnvironment, NODE_ENV: "production" });

    expect(configuration).toMatchObject({ available: false, mode: "unavailable" });
  });

  it.each([
    { ...validEnvironment, MATERIAL_OBJECT_STORE: undefined },
    { ...validEnvironment, MATERIAL_OBJECT_STORE_ROOT: undefined },
    { ...validEnvironment, MATERIAL_OBJECT_STORE_MASTER_KEY: "too-short" },
    { ...validEnvironment, MATERIAL_OBJECT_STORE_KEY_VERSION: "" },
    { ...validEnvironment, MATERIAL_OBJECT_STORE_ROOT: "relative\\path" },
  ])("fails closed for incomplete or unsafe configuration", (environment) => {
    expect(createMaterialObjectStoreFromEnv(environment)).toMatchObject({ available: false, mode: "unavailable" });
  });
});
