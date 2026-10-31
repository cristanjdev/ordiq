import {
  createEngineClient,
  type EngineClient,
} from "../../engine/engine.client";
import { getEnv } from "../../platform/env";
import { AppError } from "../../platform/errors";
import {
  systemHealthResponseSchema,
  type SystemHealthResponse,
} from "./health.schema";

export async function getSystemHealth(
  engineClient: EngineClient = createEngineClient(),
): Promise<SystemHealthResponse> {
  const env = getEnv();

  try {
    const engineHealth = await engineClient.getHealth();
    return systemHealthResponseSchema.parse({
      status: "ok",
      web: {
        status: "ok",
        version: "0.1.0",
        llmProvider: env.LLM_PROVIDER,
      },
      engine: {
        connected: true,
        version: engineHealth.version,
        solverTimeLimitSeconds: engineHealth.solver_time_limit_seconds,
        solverWorkers: engineHealth.solver_workers,
        hardConstraintCount:
          engineHealth.supported_hard_constraints?.length ?? 15,
        softConstraintCount:
          engineHealth.supported_soft_constraints?.length ?? 16,
        directiveCount: engineHealth.supported_directives?.length ?? 8,
        errorCode: null,
      },
    });
  } catch (error) {
    const errorCode =
      error instanceof AppError ? error.code : "ENGINE_UNAVAILABLE";
    return systemHealthResponseSchema.parse({
      status: "degraded",
      web: {
        status: "ok",
        version: "0.1.0",
        llmProvider: env.LLM_PROVIDER,
      },
      engine: {
        connected: false,
        version: null,
        solverTimeLimitSeconds: null,
        solverWorkers: null,
        hardConstraintCount: 15,
        softConstraintCount: 16,
        directiveCount: 8,
        errorCode,
      },
    });
  }
}

