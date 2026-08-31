import { z } from "zod";

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);
const databaseUrlSchema = z
  .string()
  .url()
  .refine((value) => value.startsWith("postgresql://") || value.startsWith("postgres://"), {
    message: "DATABASE_URL must use PostgreSQL",
  });
const httpsUrlSchema = z.string().url().refine((value) => value.startsWith("https://"), {
  message: "AI_GATEWAY_URL must use HTTPS",
});
const reviewedRetentionPolicySchema = z
  .string()
  .regex(/^reviewed:[A-Za-z0-9._-]+$/, "AI_RETENTION_POLICY_ID must identify a reviewed policy");
const productionSessionSecretSchema = z
  .string()
  .refine(
    (value) =>
      value !== "replace-with-at-least-32-random-characters" &&
      /^(?:[A-Fa-f0-9]{64,}|[A-Za-z0-9_-]{43,}={0,2})$/u.test(value),
    "SESSION_SECRET must encode at least 32 random bytes and must not use the published placeholder",
  );

const staticEnvironmentSchema = z.strictObject({
  NODE_ENV: nodeEnvironmentSchema,
  APP_MODE: z.literal("static"),
  DATABASE_URL: z.undefined().optional(),
  SESSION_SECRET: z.undefined().optional(),
  AI_PROVIDER: z.undefined().optional(),
  AI_GATEWAY_URL: z.undefined().optional(),
  AI_GATEWAY_TOKEN: z.undefined().optional(),
  AI_MODEL_ALIAS: z.undefined().optional(),
  AI_REGION: z.undefined().optional(),
  AI_RETENTION_POLICY_ID: z.undefined().optional(),
});

const mockEnvironmentSchema = z
  .strictObject({
    NODE_ENV: nodeEnvironmentSchema,
    APP_MODE: z.literal("normal"),
    DATABASE_URL: databaseUrlSchema,
    SESSION_SECRET: z.string().min(32),
    AI_PROVIDER: z.literal("mock"),
    AI_GATEWAY_URL: z.undefined().optional(),
    AI_GATEWAY_TOKEN: z.undefined().optional(),
    AI_MODEL_ALIAS: z.undefined().optional(),
    AI_REGION: z.undefined().optional(),
    AI_RETENTION_POLICY_ID: z.undefined().optional(),
  })
  .refine((environment) => environment.NODE_ENV !== "production", {
    message: "AI_PROVIDER=mock is not allowed in production",
    path: ["AI_PROVIDER"],
  });

const gatewayEnvironmentSchema = z
  .strictObject({
    NODE_ENV: nodeEnvironmentSchema,
    APP_MODE: z.literal("normal"),
    DATABASE_URL: databaseUrlSchema,
    SESSION_SECRET: z.string().min(32),
    AI_PROVIDER: z.literal("gateway"),
    AI_GATEWAY_URL: httpsUrlSchema,
    AI_GATEWAY_TOKEN: z.string().min(16),
    AI_MODEL_ALIAS: z.string().min(1),
    AI_REGION: z.string().min(2),
    AI_RETENTION_POLICY_ID: reviewedRetentionPolicySchema,
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      !productionSessionSecretSchema.safeParse(environment.SESSION_SECRET).success
    ) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message:
          "SESSION_SECRET must encode at least 32 random bytes and must not use the published placeholder",
      });
    }
  });

const modelEnvironmentSchema = z.discriminatedUnion("AI_PROVIDER", [
  mockEnvironmentSchema,
  gatewayEnvironmentSchema,
]);

export type AppEnvironment =
  | z.infer<typeof staticEnvironmentSchema>
  | z.infer<typeof modelEnvironmentSchema>;

const environmentKeys = [
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

function selectEnvironment(input: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  return Object.fromEntries(
    environmentKeys.map((key) => [key, input[key] === "" ? undefined : input[key]]),
  );
}

export function parseEnv(input: NodeJS.ProcessEnv | Record<string, string | undefined>): AppEnvironment {
  const environment = selectEnvironment(input);

  if (environment.APP_MODE === "static") {
    return staticEnvironmentSchema.parse(environment);
  }

  return modelEnvironmentSchema.parse(environment);
}
