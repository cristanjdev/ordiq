import { beforeEach, describe, expect, it } from "vitest";
import { createEngineClient } from "../../engine/engine.client";
import { resetEnvCacheForTests } from "../../platform/env";
import { AppError } from "../../platform/errors";
import { getSystemHealth } from "./health.service";

describe("EngineClient & getSystemHealth", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://ordiq:secret@localhost:5432/ordiq";
    process.env.AUTH_SECRET = "auth-secret-at-least-16-chars";
    process.env.APP_ENCRYPTION_KEY = "encryption-key-at-least-16-chars";
    process.env.ENGINE_URL = "http://engine.internal:8000";
    process.env.ENGINE_TOKEN = "shared-engine-token-123456";
    process.env.LLM_PROVIDER = "openai";
    process.env.LLM_MODEL = "gpt-4o-mini";
    process.env.LLM_API_KEY = "sk-test-key";
    process.env.LLM_MONTHLY_TOKEN_BUDGET = "500000";
    resetEnvCacheForTests();
  });

  it("calls /healthz with X-Engine-Token and returns typed system health", async () => {
    let capturedToken: string | null = null;
    const client = createEngineClient({
      baseUrl: "http://engine.internal:8000",
      engineToken: "shared-engine-token-123456",
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers);
        capturedToken = headers.get("X-Engine-Token");
        return new Response(
          JSON.stringify({
            status: "ok",
            service: "ordiq-engine",
            version: "0.1.0",
            solver_time_limit_seconds: 120,
            solver_workers: 4,
            supported_hard_constraints: ["HC-01", "HC-02", "HC-03"],
            supported_soft_constraints: ["SC-01", "SC-02"],
            supported_directives: ["FACULTY_NOT_ON_DAY"],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const summary = await getSystemHealth(client);
    expect(capturedToken).toBe("shared-engine-token-123456");
    expect(summary.status).toBe("ok");
    expect(summary.engine.connected).toBe(true);
    expect(summary.engine.solverTimeLimitSeconds).toBe(120);
    expect(summary.engine.solverWorkers).toBe(4);
    expect(summary.engine.hardConstraintCount).toBe(3);
  });

  it("throws AppError when the engine returns an error envelope", async () => {
    const client = createEngineClient({
      baseUrl: "http://engine.internal:8000",
      engineToken: "bad-token-12345678",
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              code: "ENGINE_UNAUTHORIZED",
              message: "Invalid engine authentication token.",
              details: {},
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
    });

    await expect(client.getHealth()).rejects.toBeInstanceOf(AppError);
    const degraded = await getSystemHealth(client);
    expect(degraded.status).toBe("degraded");
    expect(degraded.engine.connected).toBe(false);
    expect(degraded.engine.errorCode).toBe("ENGINE_UNAUTHORIZED");
  });
});

