import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseEnv } from "@/server/env";

describe("application baseline", () => {
  it("exposes a deterministic test command", () => {
    expect(process.env.NODE_ENV).toBeDefined();
  });

  it("allows the credential-free mock provider outside production", () => {
    const environment = parseEnv({
      NODE_ENV: "test",
      APP_MODE: "normal",
      DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo_test",
      SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      AI_PROVIDER: "mock",
    });

    expect(environment.AI_PROVIDER).toBe("mock");
  });

  it("rejects the mock provider in production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        APP_MODE: "normal",
        DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        AI_PROVIDER: "mock",
      }),
    ).toThrow();
  });

  it("requires static mode to remain credential-free", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        APP_MODE: "static",
        DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        AI_PROVIDER: "mock",
      }),
    ).toThrow();
  });

  it("allows a static production deployment without persistence or a model", () => {
    const environment = parseEnv({
      NODE_ENV: "production",
      APP_MODE: "static",
    });

    expect(environment.APP_MODE).toBe("static");
  });

  it("requires HTTPS and reviewed retention for the gateway", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        APP_MODE: "normal",
        DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo",
        SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        AI_PROVIDER: "gateway",
        AI_GATEWAY_URL: "http://gateway.example.test",
        AI_GATEWAY_TOKEN: "0123456789abcdef",
        AI_MODEL_ALIAS: "review-model",
        AI_REGION: "cn",
        AI_RETENTION_POLICY_ID: "draft-policy",
      }),
    ).toThrow();
  });

  it("parses the checked-in development environment example", () => {
    const example = Object.fromEntries(
      readFileSync(".env.example", "utf8")
        .split(/\r?\n/u)
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );

    expect(parseEnv(example).AI_PROVIDER).toBe("mock");
  });

  it("rejects the published placeholder session secret in production", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "production",
        APP_MODE: "normal",
        DATABASE_URL: "postgresql://manbo:test@127.0.0.1:55432/manbo",
        SESSION_SECRET: "replace-with-at-least-32-random-characters",
        AI_PROVIDER: "gateway",
        AI_GATEWAY_URL: "https://gateway.example.test",
        AI_GATEWAY_TOKEN: "0123456789abcdef",
        AI_MODEL_ALIAS: "review-model",
        AI_REGION: "cn",
        AI_RETENTION_POLICY_ID: "reviewed:no-training",
      }),
    ).toThrow(/SESSION_SECRET/u);
  });
});
