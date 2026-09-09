import { describe, expect, it, vi } from "vitest";

import { GatewayAiProvider } from "@/ai/gateway-provider";
import {
  createAiProviderFactory,
  createAiProviderFactoryFromProcessEnv,
} from "@/ai/provider-factory";
import { parseEnv } from "@/server/env";

const gatewayEnvironment = parseEnv({
  NODE_ENV: "test",
  APP_MODE: "normal",
  DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo_test",
  SESSION_SECRET: "0123456789abcdef0123456789abcdef",
  AI_PROVIDER: "gateway",
  AI_GATEWAY_URL: "https://gateway.example.test",
  AI_GATEWAY_TOKEN: "gateway-token-value",
  AI_MODEL_ALIAS: "reviewed-model-alias",
  AI_REGION: "eu-central",
  AI_RETENTION_POLICY_ID: "reviewed:no-training",
});

describe("AI provider factory", () => {
  it("creates a GatewayAiProvider for gateway configuration", () => {
    const factory = createAiProviderFactory({ environment: gatewayEnvironment });

    expect(factory("message-1", "普通描述")).toBeInstanceOf(GatewayAiProvider);
  });

  it("keeps the gateway provider selected when the gateway later fails", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 503 }),
    );
    const factory = createAiProviderFactory({
      environment: gatewayEnvironment,
      fetchImpl: fetchImpl as typeof fetch,
    });
    const provider = factory("message-1", "普通描述");

    await expect(provider?.detectSafety("普通描述")).rejects.toThrow(/HTTP 503/u);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed with a sanitized configuration error", () => {
    expect(() =>
      createAiProviderFactoryFromProcessEnv({
        NODE_ENV: "production",
        APP_MODE: "normal",
        DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        AI_PROVIDER: "gateway",
        AI_GATEWAY_URL: "https://gateway.example.test",
        AI_GATEWAY_TOKEN: "short",
        AI_MODEL_ALIAS: "review-model",
        AI_REGION: "cn",
        AI_RETENTION_POLICY_ID: "reviewed:no-training",
      }),
    ).toThrow("AI gateway configuration is invalid");

    try {
      createAiProviderFactoryFromProcessEnv({
        NODE_ENV: "production",
        APP_MODE: "normal",
        DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        AI_PROVIDER: "gateway",
        AI_GATEWAY_URL: "https://gateway.example.test",
        AI_GATEWAY_TOKEN: "short",
        AI_MODEL_ALIAS: "review-model",
        AI_REGION: "cn",
        AI_RETENTION_POLICY_ID: "reviewed:no-training",
      });
    } catch (error) {
      expect(error).not.toHaveProperty("message", expect.stringContaining("short"));
    }
  });

  it("uses the local fallback path for mock configuration without constructing a gateway", () => {
    const factory = createAiProviderFactoryFromProcessEnv({
      NODE_ENV: "test",
      APP_MODE: "normal",
      AI_PROVIDER: "mock",
    });

    expect(factory("message-1", "普通描述")).toBeUndefined();
  });
});
