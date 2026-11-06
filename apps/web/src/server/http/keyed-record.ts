import type { NextRequest } from "next/server";
import { AppError } from "../platform/errors";

/**
 * Body of a create/edit request for a record identified by a natural key
 * (fixed blocks, availability, qualifications, preferences). `replaceId` names
 * the record being edited, so a changed key replaces it instead of adding one.
 */
export async function readKeyedBody(
  request: NextRequest,
): Promise<{ input: Record<string, unknown>; replaceId?: string }> {
  const body = (await request.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("INVALID_BODY", "Expected a JSON object.", 400);
  }
  const { replaceId, ...input } = body as Record<string, unknown>;
  if (replaceId !== undefined && replaceId !== null && typeof replaceId !== "string") {
    throw new AppError("INVALID_BODY", "replaceId must be a string.", 400);
  }
  return { input, replaceId: typeof replaceId === "string" && replaceId ? replaceId : undefined };
}

export function requireIdParam(request: NextRequest): string {
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) throw new AppError("MISSING_ID", "The id query parameter is required.", 400);
  return id;
}
