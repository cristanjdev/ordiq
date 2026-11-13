import { NextResponse, type NextRequest } from "next/server";
import {
  LOGIN_PATH,
  SESSION_COOKIE_NAME,
  SESSION_ENDPOINT,
  type LoginNoticeReason,
} from "@/lib/auth-constants";
import { buildLoginUrl, sanitizeNextPath } from "@/lib/auth-redirect";

/**
 * Route guard for every page in the app (API routes enforce their own 401 via
 * `withAuth`). The Edge runtime cannot reach the session store (in-memory or
 * Postgres), so the session is validated by calling the passive session
 * endpoint on this same server. That keeps a single source of truth for
 * session rules (idle/absolute expiry, MFA stage, Dean role) and runs on every
 * navigation, including client-side route transitions and prefetches.
 *
 * Outcomes:
 *  - no/invalid/expired session on a protected page -> redirect to /login
 *    (preserving the destination in `next`, clearing any stale cookie)
 *  - valid session on /login                        -> redirect into the app
 *  - auth backend unreachable                       -> fail closed (503) on
 *                                                      protected pages
 */

type SessionCheck =
  | { state: "valid" }
  | { state: "rejected"; code: string | null }
  | { state: "unavailable" };

const VALIDATION_TIMEOUT_MS = 5_000;

async function checkSession(
  request: NextRequest,
  token: string,
): Promise<SessionCheck> {
  const origin =
    process.env.AUTH_INTERNAL_ORIGIN?.trim() || request.nextUrl.origin;
  try {
    const response = await fetch(`${origin}${SESSION_ENDPOINT}?passive=1`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(VALIDATION_TIMEOUT_MS),
    });
    if (response.ok) return { state: "valid" };
    if (response.status === 401 || response.status === 403) {
      let code: string | null = null;
      try {
        const body = (await response.json()) as {
          error?: { code?: string };
        };
        code = body.error?.code ?? null;
      } catch {
        // Non-JSON rejection: treat as a generic authentication failure.
      }
      return { state: "rejected", code };
    }
    return { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

function withNoStore(response: NextResponse): NextResponse {
  // Authenticated HTML must never be cached by the browser (back/forward
  // cache after sign-out) or by an intermediary.
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

function redirectToLogin(
  request: NextRequest,
  reason: LoginNoticeReason,
  clearCookie: boolean,
): NextResponse {
  const params = new URLSearchParams(request.nextUrl.search);
  params.delete("_rsc"); // internal Next.js client-navigation marker
  const query = params.toString();
  const destination = `${request.nextUrl.pathname}${query ? `?${query}` : ""}`;

  const target = new URL(
    buildLoginUrl({ next: destination, reason }),
    request.nextUrl.origin,
  );
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = target.pathname;
  loginUrl.search = target.search;

  const response = NextResponse.redirect(loginUrl);
  if (clearCookie) response.cookies.delete(SESSION_COOKIE_NAME);
  return withNoStore(response);
}

function authUnavailable(): NextResponse {
  return new NextResponse(
    "Authentication service temporarily unavailable. Please retry in a moment.",
    {
      status: 503,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Retry-After": "5",
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const isLoginRoute =
    pathname === LOGIN_PATH || pathname.startsWith(`${LOGIN_PATH}/`);
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return isLoginRoute
      ? withNoStore(NextResponse.next())
      : redirectToLogin(request, "required", false);
  }

  const check = await checkSession(request, token);

  if (isLoginRoute) {
    if (check.state === "valid") {
      // Already signed in: skip the form and go where the user was headed.
      const destination = sanitizeNextPath(
        request.nextUrl.searchParams.get("next"),
      );
      return withNoStore(
        NextResponse.redirect(new URL(destination, request.nextUrl.origin)),
      );
    }
    // Rejected or backend down: the sign-in form must always stay reachable.
    return withNoStore(NextResponse.next());
  }

  if (check.state === "valid") return withNoStore(NextResponse.next());
  if (check.state === "unavailable") return authUnavailable();

  return redirectToLogin(
    request,
    check.code === "SESSION_EXPIRED" ? "expired" : "required",
    true,
  );
}

export const config = {
  // Vercel Services does not support the Edge runtime, so the guard runs on
  // Node.js (stable in Next.js 15.5).
  runtime: "nodejs",
  matcher: [
    // Everything except API routes (self-protecting), Next.js internals, and
    // public static assets (logos/icons used by the sign-in screen).
    "/((?!api/|_next/|favicon\\.ico$|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|css|js|map|woff|woff2)$).*)",
  ],
};
