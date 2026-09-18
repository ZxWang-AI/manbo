import { parseEnv } from "@/server/env";

// Keep configuration diagnostics request-time even if the deployment later
// enables a cache-components configuration.
export const dynamic = "force-dynamic";

const applicationEnvironmentKeys = [
  "NODE_ENV",
  "APP_MODE",
  "DATABASE_URL",
  "SESSION_SECRET",
  "AI_PROVIDER",
  "AI_GATEWAY_URL",
  "AI_GATEWAY_TOKEN",
  "AI_MODEL_ALIAS",
  "AI_REGION",
  "AI_RETENTION_POLICY_ID",
] as const;

type ApplicationEnvironmentKey = (typeof applicationEnvironmentKeys)[number];
type EnvironmentInput = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type RuntimeHealthPayload = {
  status: "static" | "configured" | "degraded";
  mode: "static" | "normal";
  missing: ApplicationEnvironmentKey[];
  invalid: ApplicationEnvironmentKey[];
};

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueInDeclarationOrder(keys: readonly ApplicationEnvironmentKey[]): ApplicationEnvironmentKey[] {
  const wanted = new Set(keys);
  return applicationEnvironmentKeys.filter((key) => wanted.has(key));
}

function issueKeys(error: unknown): ApplicationEnvironmentKey[] {
  if (!error || typeof error !== "object" || !("issues" in error)) return [];
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];

  const known = new Set<string>(applicationEnvironmentKeys);
  return issues.flatMap((issue) => {
    if (!issue || typeof issue !== "object" || !("path" in issue)) return [];
    const path = (issue as { path?: unknown }).path;
    if (!Array.isArray(path) || typeof path[0] !== "string" || !known.has(path[0])) return [];
    return [path[0] as ApplicationEnvironmentKey];
  });
}

function parseEnvironmentSafely(input: EnvironmentInput): { valid: true } | { valid: false; invalid: ApplicationEnvironmentKey[] } {
  try {
    parseEnv(input);
    return { valid: true };
  } catch (error) {
    return { valid: false, invalid: uniqueInDeclarationOrder(issueKeys(error)) };
  }
}

function applicationInput(input: EnvironmentInput): Record<string, string | undefined> {
  return Object.fromEntries(applicationEnvironmentKeys.map((key) => [key, input[key]]));
}

/**
 * Inspects only the shape of application configuration. It deliberately does
 * not connect to PostgreSQL or an AI gateway, and it never returns values.
 */
export function inspectRuntimeConfiguration(input: EnvironmentInput): RuntimeHealthPayload {
  const mode = input.APP_MODE === "static" ? "static" : "normal";
  const missing: ApplicationEnvironmentKey[] = [];
  const invalid: ApplicationEnvironmentKey[] = [];

  if (!hasValue(input.NODE_ENV)) missing.push("NODE_ENV");
  else if (!(["development", "test", "production"] as const).includes(input.NODE_ENV as never)) {
    invalid.push("NODE_ENV");
  }

  if (!hasValue(input.APP_MODE)) missing.push("APP_MODE");
  else if (input.APP_MODE !== "static" && input.APP_MODE !== "normal") invalid.push("APP_MODE");

  if (mode === "static") {
    for (const key of applicationEnvironmentKeys) {
      if (key === "NODE_ENV" || key === "APP_MODE") continue;
      if (hasValue(input[key])) invalid.push(key);
    }
  } else {
    for (const key of ["DATABASE_URL", "SESSION_SECRET", "AI_PROVIDER"] as const) {
      if (!hasValue(input[key])) missing.push(key);
    }

    if (input.AI_PROVIDER === "gateway") {
      for (const key of [
        "AI_GATEWAY_URL",
        "AI_GATEWAY_TOKEN",
        "AI_MODEL_ALIAS",
        "AI_REGION",
        "AI_RETENTION_POLICY_ID",
      ] as const) {
        if (!hasValue(input[key])) missing.push(key);
      }
    }

    if (
      input.AI_PROVIDER !== undefined &&
      input.AI_PROVIDER !== "mock" &&
      input.AI_PROVIDER !== "gateway"
    ) {
      invalid.push("AI_PROVIDER");
    }
    if (input.AI_PROVIDER === "mock" && input.NODE_ENV === "production") {
      invalid.push("AI_PROVIDER");
    }
  }

  const orderedMissing = uniqueInDeclarationOrder(missing);
  const orderedInvalid = uniqueInDeclarationOrder(invalid);
  if (orderedMissing.length > 0 || orderedInvalid.length > 0) {
    return { status: "degraded", mode, missing: orderedMissing, invalid: orderedInvalid };
  }

  const parsed = parseEnvironmentSafely(applicationInput(input));
  if (!parsed.valid) {
    return { status: "degraded", mode, missing: [], invalid: parsed.invalid };
  }

  return {
    status: mode === "static" ? "static" : "configured",
    mode,
    missing: [],
    invalid: [],
  };
}

export interface HealthGetHandlerOptions {
  env?: EnvironmentInput;
}

export function createHealthGetHandler({ env = process.env }: HealthGetHandlerOptions = {}) {
  return async (request: Request): Promise<Response> => {
    void request;
    const payload = inspectRuntimeConfiguration(env);
    return Response.json(payload, {
      status: payload.status === "degraded" ? 503 : 200,
      headers: {
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  };
}

export async function GET(request: Request): Promise<Response> {
  return createHealthGetHandler()(request);
}
