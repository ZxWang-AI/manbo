import { describe, expect, it } from "vitest";

import {
  createHealthGetHandler,
  inspectRuntimeConfiguration,
} from "@/app/api/health/route";

const completeProductionEnvironment = {
  NODE_ENV: "production",
  APP_MODE: "normal",
  DATABASE_URL: "postgresql://health-user:health-password@db.example.test:5432/manbo",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  AI_PROVIDER: "gateway",
  AI_GATEWAY_URL: "https://ai-gateway.example.test",
  AI_GATEWAY_TOKEN: "gateway-token-that-must-not-appear",
  AI_MODEL_ALIAS: "review-model",
  AI_REGION: "us-east-1",
  AI_RETENTION_POLICY_ID: "reviewed:no-training",
} as const;

describe("runtime health configuration contract", () => {
  it("reports a credential-free static deployment without exposing environment values", async () => {
    const response = await createHealthGetHandler({
      env: { NODE_ENV: "production", APP_MODE: "static" },
    })(new Request("https://manbo.example/api/health"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({
      status: "static",
      mode: "static",
      missing: [],
      invalid: [],
    });
  });

  it("reports a complete production gateway configuration as configured", () => {
    expect(inspectRuntimeConfiguration(completeProductionEnvironment)).toEqual({
      status: "configured",
      mode: "normal",
      missing: [],
      invalid: [],
    });
  });

  it("identifies missing production variables without echoing secrets", async () => {
    const response = await createHealthGetHandler({
      env: {
        ...completeProductionEnvironment,
        SESSION_SECRET: undefined,
      },
    })(new Request("https://manbo.example/api/health"));

    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({
      status: "degraded",
      mode: "normal",
      missing: ["SESSION_SECRET"],
      invalid: [],
    });
    expect(JSON.stringify(body)).not.toContain("health-password");
    expect(JSON.stringify(body)).not.toContain("gateway-token-that-must-not-appear");
  });

  it("rejects a production mock provider and reports only safe field names", () => {
    expect(
      inspectRuntimeConfiguration({
        ...completeProductionEnvironment,
        AI_PROVIDER: "mock",
      }),
    ).toEqual({
      status: "degraded",
      mode: "normal",
      missing: [],
      invalid: ["AI_PROVIDER"],
    });
  });

  it("does not claim readiness when the gateway URL is malformed", () => {
    expect(
      inspectRuntimeConfiguration({
        ...completeProductionEnvironment,
        AI_GATEWAY_URL: "http://ai-gateway.example.test",
      }),
    ).toEqual({
      status: "degraded",
      mode: "normal",
      missing: [],
      invalid: ["AI_GATEWAY_URL"],
    });
  });

  it("rejects an unknown provider without requiring gateway details", () => {
    expect(
      inspectRuntimeConfiguration({
        ...completeProductionEnvironment,
        AI_PROVIDER: "untrusted-provider",
      }),
    ).toEqual({
      status: "degraded",
      mode: "normal",
      missing: [],
      invalid: ["AI_PROVIDER"],
    });
  });

  it("reports a malformed database URL as invalid configuration", () => {
    expect(
      inspectRuntimeConfiguration({
        ...completeProductionEnvironment,
        DATABASE_URL: "https://not-a-postgres-url.example.test",
      }),
    ).toEqual({
      status: "degraded",
      mode: "normal",
      missing: [],
      invalid: ["DATABASE_URL"],
    });
  });

  it("keeps static mode credential-free and flags stray application variables", () => {
    expect(
      inspectRuntimeConfiguration({
        NODE_ENV: "production",
        APP_MODE: "static",
        DATABASE_URL: "postgresql://should-not-be-present",
      }),
    ).toEqual({
      status: "degraded",
      mode: "static",
      missing: [],
      invalid: ["DATABASE_URL"],
    });
  });
});
