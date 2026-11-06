/**
 * Client helpers for the master-data API routes (`/api/v1/<segment>`).
 *
 * Errors keep the API's `{ error: { code, message, details } }` shape so forms
 * can show validation issues next to the field they belong to.
 */

export interface ApiIssue {
  path: Array<string | number>;
  message: string;
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly issues: ApiIssue[];

  constructor(code: string, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.issues = issues;
  }
}

async function toApiError(res: Response, fallback: string): Promise<ApiRequestError> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: { issues?: ApiIssue[] } };
    };
    return new ApiRequestError(
      body.error?.code ?? `HTTP_${res.status}`,
      body.error?.message ?? fallback,
      body.error?.details?.issues ?? [],
    );
  } catch {
    return new ApiRequestError(`HTTP_${res.status}`, fallback);
  }
}

export async function fetchItems<T>(segment: string, params?: Record<string, string>): Promise<T[]> {
  const query = params ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(`/api/v1/${segment}${query}`);
  if (!res.ok) throw await toApiError(res, "Sign in with the Dean account to view these records.");
  return ((await res.json()) as { items: T[] }).items;
}

/** Create or update one record (the API upserts by the record's natural key). */
export async function saveRecord<T>(segment: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/v1/${segment}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res, "The record could not be saved.");
  return ((await res.json()) as { item: T }).item;
}

export async function deleteRecord(segment: string, params: Record<string, string>): Promise<void> {
  const res = await fetch(`/api/v1/${segment}?${new URLSearchParams(params).toString()}`, {
    method: "DELETE",
  });
  if (!res.ok) throw await toApiError(res, "The record could not be deleted.");
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
