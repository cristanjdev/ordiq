import { z } from "zod";

/**
 * Validated environment configuration for ORDIQ Web (apps/web).
 * Boot fails immediately on a missing or invalid variable.
 */
export const envSchema = z
  .object({
    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine(
        (val) => val.startsWith("postgresql://") || val.startsWith("postgres://"),
        "DATABASE_URL must be a valid PostgreSQL connection string",
      ),
    AUTH_SECRET: z
      .string()
      .min(16, "AUTH_SECRET must be at least 16 characters"),
    APP_ENCRYPTION_KEY: z
      .string()
      .min(16, "APP_ENCRYPTION_KEY must be at least 16 characters"),
    ENGINE_URL: z.string().url("ENGINE_URL must be a valid URL"),
    ENGINE_TOKEN: z
      .string()
      .min(16, "ENGINE_TOKEN must be at least 16 characters"),
    LLM_PROVIDER: z.enum(["openai", "anthropic", "ollama"]),
    LLM_MODEL: z.string().min(1, "LLM_MODEL is required"),
    LLM_API_KEY: z.string().optional(),
    LLM_BASE_URL: z.string().url().optional().or(z.literal("")),
    LLM_MONTHLY_TOKEN_BUDGET: z.coerce
      .number()
      .int()
      .positive("LLM_MONTHLY_TOKEN_BUDGET must be a positive integer"),
  })
  .superRefine((data, ctx) => {
    if (
      (data.LLM_PROVIDER === "openai" || data.LLM_PROVIDER === "anthropic") &&
      (!data.LLM_API_KEY || data.LLM_API_KEY.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LLM_API_KEY"],
        message: `LLM_API_KEY is required when LLM_PROVIDER is "${data.LLM_PROVIDER}"`,
      });
    }
    if (
      data.LLM_PROVIDER === "ollama" &&
      (!data.LLM_BASE_URL || data.LLM_BASE_URL.trim().length === 0)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["LLM_BASE_URL"],
        message: 'LLM_BASE_URL is required when LLM_PROVIDER is "ollama"',
      });
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }
  return parsed.data;
}

export function getEnv(): AppEnv {
  if (!cachedEnv) {
    cachedEnv = loadEnv(process.env);
  }
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}

