import {
  LOGIN_NOTICE_REASONS,
  LOGIN_PATH,
  type LoginNoticeReason,
} from "./auth-constants";

const MAX_NEXT_PATH_LENGTH = 512;
const SENTINEL_ORIGIN = "http://ordiq.invalid";

function hasControlOrBackslash(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f || code === 0x5c) {
      return true;
    }
  }
  return false;
}

/**
 * Validates a post-login destination so the sign-in flow can never be used as
 * an open redirect. Only same-origin, in-app relative paths are accepted;
 * everything else collapses to `fallback`.
 */
export function sanitizeNextPath(
  raw: string | null | undefined,
  fallback = "/",
): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_NEXT_PATH_LENGTH) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (hasControlOrBackslash(value)) return fallback;

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (decoded.startsWith("//") || hasControlOrBackslash(decoded)) {
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, SENTINEL_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== SENTINEL_ORIGIN) return fallback;

  const pathname = parsed.pathname;
  if (
    pathname === LOGIN_PATH ||
    pathname.startsWith(`${LOGIN_PATH}/`) ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/")
  ) {
    return fallback;
  }

  return value;
}

export function parseLoginNotice(
  raw: string | null | undefined,
): LoginNoticeReason | null {
  return (LOGIN_NOTICE_REASONS as readonly string[]).includes(raw ?? "")
    ? (raw as LoginNoticeReason)
    : null;
}

/** Builds `/login` with an optional notice reason and a sanitized `next` path. */
export function buildLoginUrl(options: {
  next?: string | null;
  reason?: LoginNoticeReason;
}): string {
  const params = new URLSearchParams();
  if (options.reason && options.reason !== "required") {
    params.set("reason", options.reason);
  }
  const next = sanitizeNextPath(options.next, "/");
  if (next !== "/") params.set("next", next);
  const query = params.toString();
  return query ? `${LOGIN_PATH}?${query}` : LOGIN_PATH;
}
