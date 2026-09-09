import { GatewayAiProvider } from "@/ai/gateway-provider";
import type {
  AiProvider,
  ModelInputPolicy,
} from "@/ai/provider";
import { parseEnv, type AppEnvironment } from "@/server/env";

export type AiProviderFactory = (
  sourceMessageId: string,
  input: string,
) => AiProvider | undefined;

export interface AiProviderFactoryOptions {
  environment: AppEnvironment;
  inputPolicy?: ModelInputPolicy;
  knowledgeSourceIds?: readonly string[];
  fetchImpl?: typeof fetch;
  requestId?: () => string;
  locale?: string;
}

const defaultInputPolicy: ModelInputPolicy = {
  async prepare(input) {
    return { kind: "approved", text: input, basis: "no_hint" };
  },
};

function knownEnvironmentValues(input: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return {
    NODE_ENV: input.NODE_ENV ?? "development",
    APP_MODE: input.APP_MODE ?? "normal",
    DATABASE_URL: input.DATABASE_URL,
    SESSION_SECRET: input.SESSION_SECRET,
    AI_PROVIDER: input.AI_PROVIDER,
    AI_GATEWAY_URL: input.AI_GATEWAY_URL,
    AI_GATEWAY_TOKEN: input.AI_GATEWAY_TOKEN,
    AI_MODEL_ALIAS: input.AI_MODEL_ALIAS,
    AI_REGION: input.AI_REGION,
    AI_RETENTION_POLICY_ID: input.AI_RETENTION_POLICY_ID,
  };
}

/**
 * Builds the provider selected by an already validated application environment.
 * The mock branch intentionally returns undefined so the conversation route can
 * use its deterministic local provider without ever constructing a gateway.
 */
export function createAiProviderFactory(
  options: AiProviderFactoryOptions,
): AiProviderFactory {
  const { environment } = options;

  if (environment.APP_MODE === "static" || environment.AI_PROVIDER === "mock") {
    return () => undefined;
  }

  const gatewayOptions = {
    baseUrl: environment.AI_GATEWAY_URL,
    token: environment.AI_GATEWAY_TOKEN,
    modelAlias: environment.AI_MODEL_ALIAS,
    region: environment.AI_REGION,
    retentionPolicyId: environment.AI_RETENTION_POLICY_ID,
    locale: options.locale ?? "zh-CN",
    inputPolicy: options.inputPolicy ?? defaultInputPolicy,
    ...(options.knowledgeSourceIds ? { knowledgeSourceIds: options.knowledgeSourceIds } : {}),
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
  };
  const provider = new GatewayAiProvider(gatewayOptions);

  return () => provider;
}

/**
 * Reads only the application-owned environment keys and sanitizes validation
 * failures. In particular, a malformed or missing gateway token must never be
 * copied into an exception that could reach logs or an HTTP response.
 */
export function createAiProviderFactoryFromProcessEnv(
  input: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: Omit<AiProviderFactoryOptions, "environment"> = {},
): AiProviderFactory {
  const providerName = input.AI_PROVIDER ?? "mock";

  if (providerName === "mock" && input.APP_MODE !== "static") {
    return () => undefined;
  }

  try {
    const environment = parseEnv(knownEnvironmentValues(input));
    return createAiProviderFactory({ ...options, environment });
  } catch {
    if (providerName === "gateway") {
      throw new Error("AI gateway configuration is invalid");
    }
    throw new Error("Application configuration is invalid");
  }
}
