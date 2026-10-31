import type {
  ApiErrorEnvelope,
  EngineHealthResponse,
  paths,
} from "@ordiq/contracts";
import { getEnv } from "../platform/env";
import { AppError } from "../platform/errors";
import { logger } from "../platform/logger";

export type EngineHealthGetResponse =
  paths["/healthz"]["get"]["responses"][200];

export interface EngineClientOptions {
  baseUrl?: string;
  engineToken?: string;
  fetchImpl?: typeof fetch;
}

export class EngineClient {
  private readonly baseUrl: string;
  private readonly engineToken: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: EngineClientOptions = {}) {
    const env =
      options.baseUrl && options.engineToken ? null : getEnv();
    this.baseUrl = (options.baseUrl ?? env?.ENGINE_URL ?? "").replace(
      /\/+$/,
      "",
    );
    this.engineToken = options.engineToken ?? env?.ENGINE_TOKEN ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async getHealth(): Promise<EngineHealthResponse> {
    const url = `${this.baseUrl}/healthz`;
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "X-Engine-Token": this.engineToken,
        },
        cache: "no-store",
      });
    } catch (error) {
      logger.error("engine_connection_failed", {
        url,
        reason: error instanceof Error ? error.message : "Unknown network error",
      });
      throw new AppError(
        "ENGINE_UNAVAILABLE",
        "Unable to reach the ORDIQ scheduling engine.",
        503,
        { engineUrl: this.baseUrl },
      );
    }

    if (!response.ok) {
      let errorPayload: ApiErrorEnvelope | null = null;
      try {
        errorPayload = (await response.json()) as ApiErrorEnvelope;
      } catch {
        // Fallback when upstream did not return JSON
      }

      const code = errorPayload?.error?.code ?? "ENGINE_REQUEST_FAILED";
      const message =
        errorPayload?.error?.message ??
        `Engine returned HTTP ${response.status}.`;
      const details = errorPayload?.error?.details ?? {
        status: response.status,
      };

      throw new AppError(code, message, response.status, details);
    }

    const data = (await response.json()) as EngineHealthGetResponse;
    return data;
  }
}

export function createEngineClient(
  options?: EngineClientOptions,
): EngineClient {
  return new EngineClient(options);
}

