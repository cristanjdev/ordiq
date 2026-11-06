import { z } from "zod";

export const systemHealthResponseSchema = z.object({
  status: z.enum(["ok", "degraded"]),
  web: z.object({
    status: z.literal("ok"),
    version: z.string(),
    llmProvider: z.enum(["openai", "anthropic", "gemini", "ollama"]),
  }),
  engine: z.object({
    connected: z.boolean(),
    version: z.string().nullable(),
    solverTimeLimitSeconds: z.number().int().nullable(),
    solverWorkers: z.number().int().nullable(),
    hardConstraintCount: z.number().int(),
    softConstraintCount: z.number().int(),
    directiveCount: z.number().int(),
    errorCode: z.string().nullable(),
  }),
});

export type SystemHealthResponse = z.infer<typeof systemHealthResponseSchema>;

