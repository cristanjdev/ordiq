import type { ApiErrorEnvelope } from "@ordiq/contracts";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "./logger";

/**
 * Shared application error and Next.js Route Handler error wrapper.
 *
 * Follows Section 4 API Error format:
 * { "error": { "code": "SCHEDULE_NOT_FOUND", "message": "...", "details": {} } }
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    statusCode = 400,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function buildErrorEnvelope(
  code: string,
  message: string,
  details: Record<string, unknown> = {},
): ApiErrorEnvelope {
  return {
    error: {
      code,
      message,
      details,
    },
  };
}

export function toErrorResponse(error: unknown): NextResponse<ApiErrorEnvelope> {
  if (error instanceof AppError) {
    logger.warn("api_app_error", {
      code: error.code,
      statusCode: error.statusCode,
    });
    return NextResponse.json(
      buildErrorEnvelope(error.code, error.message, error.details),
      { status: error.statusCode },
    );
  }

  if (error instanceof ZodError) {
    logger.warn("api_validation_error", {
      issueCount: error.issues.length,
    });
    return NextResponse.json(
      buildErrorEnvelope(
        "VALIDATION_ERROR",
        "Request payload failed schema validation.",
        { issues: error.issues },
      ),
      { status: 422 },
    );
  }

  logger.error("api_unhandled_error", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  return NextResponse.json(
    buildErrorEnvelope(
      "INTERNAL_SERVER_ERROR",
      "An unexpected error occurred.",
      {},
    ),
    { status: 500 },
  );
}

export function withErrorHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<NextResponse>,
): (...args: TArgs) => Promise<NextResponse> {
  return async (...args: TArgs): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

