import { ESLint } from "eslint";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { loadEnv } from "./env";
import { AppError, toErrorResponse } from "./errors";
import { formatLogEntry } from "./logger";

const VALID_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://ordiq:secret@localhost:5432/ordiq",
  AUTH_SECRET: "auth-secret-at-least-16-chars",
  APP_ENCRYPTION_KEY: "encryption-key-at-least-16-chars",
  ENGINE_URL: "http://localhost:8000",
  ENGINE_TOKEN: "engine-token-at-least-16-chars",
  LLM_PROVIDER: "openai",
  LLM_MODEL: "gpt-4o-mini",
  LLM_API_KEY: "sk-test-123456",
  LLM_MONTHLY_TOKEN_BUDGET: "500000",
};

describe("server/platform/env", () => {
  it("loads valid environment variables", () => {
    const parsed = loadEnv(VALID_ENV);
    expect(parsed.LLM_PROVIDER).toBe("openai");
    expect(parsed.LLM_MONTHLY_TOKEN_BUDGET).toBe(500000);
  });

  it("fails boot when required variables are missing or invalid", () => {
    expect(() =>
      loadEnv({
        ...VALID_ENV,
        ENGINE_TOKEN: "short",
      }),
    ).toThrow(/ENGINE_TOKEN/);

    expect(() =>
      loadEnv({
        ...VALID_ENV,
        LLM_PROVIDER: "openai",
        LLM_API_KEY: "",
      }),
    ).toThrow(/LLM_API_KEY/);

    expect(() =>
      loadEnv({
        ...VALID_ENV,
        LLM_PROVIDER: "ollama",
        LLM_BASE_URL: "",
      }),
    ).toThrow(/LLM_BASE_URL/);
  });
});

describe("server/platform/logger", () => {
  it("formats structured JSON logs and redacts personal data and secrets", () => {
    const raw = formatLogEntry("INFO", "schedule_checked", {
      scheduleId: "sched-01",
      facultyName: "Prof. Maria Santos",
      engine_token: "super-secret-token",
      nested: {
        message: "Move Prof. Santos away from Friday",
        roomCode: "EN-201",
      },
    });
    const parsed = JSON.parse(raw) as {
      service: string;
      event: string;
      context: Record<string, unknown>;
    };
    expect(parsed.service).toBe("ordiq-web");
    expect(parsed.event).toBe("schedule_checked");
    expect(parsed.context.scheduleId).toBe("sched-01");
    expect(parsed.context.facultyName).toBe("[REDACTED]");
    expect(parsed.context.engine_token).toBe("[REDACTED]");
    expect((parsed.context.nested as Record<string, unknown>).message).toBe(
      "[REDACTED]",
    );
    expect((parsed.context.nested as Record<string, unknown>).roomCode).toBe(
      "EN-201",
    );
  });
});

describe("server/platform/errors", () => {
  it("serializes AppError into the standard error envelope", async () => {
    const err = new AppError(
      "SCHEDULE_NOT_FOUND",
      "Candidate schedule does not exist.",
      404,
      { scheduleId: "abc" },
    );
    const res = toErrorResponse(err);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: {
        code: "SCHEDULE_NOT_FOUND",
        message: "Candidate schedule does not exist.",
        details: { scheduleId: "abc" },
      },
    });
  });

  it("serializes ZodError into a 422 VALIDATION_ERROR envelope", async () => {
    const schema = z.object({ slotSizeMin: z.number().int().positive() });
    const parsed = schema.safeParse({ slotSizeMin: -5 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const res = toErrorResponse(parsed.error);
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("architecture import boundaries (ESLint)", () => {
  it("fails when client/UI code in src/features/ imports from src/server/", async () => {
    const webRoot = path.resolve(__dirname, "../../..");
    const eslint = new ESLint({ cwd: webRoot });
    const results = await eslint.lintText(
      `import { getEnv } from "@/server/platform/env";\nexport const x = getEnv;\n`,
      {
        filePath: path.join(webRoot, "src/features/dashboard/illegal.ts"),
      },
    );
    expect(results).toHaveLength(1);
    const messages = results[0]?.messages ?? [];
    expect(
      messages.some((m) => m.ruleId === "no-restricted-imports"),
    ).toBe(true);
  });
});

