import type { NextRequest, NextResponse } from "next/server";
import { type AuthenticatedContext, withAuth } from "../platform/auth";
import { getStateSync } from "../repo/state-sync";

/**
 * Standard wrapper for every Dean-only data route under `/api/v1`:
 * authentication (`withAuth`), error envelopes, and the persistence unit of
 * work. GET and HEAD run as reads; every other method runs as a serialized
 * write whose changes are saved in one transaction before the response is sent.
 */
export function withDeanRoute<TContext = unknown>(
  handler: (
    request: NextRequest,
    auth: AuthenticatedContext,
    routeContext: TContext,
  ) => Promise<NextResponse>,
): (request: NextRequest, routeContext: TContext) => Promise<NextResponse> {
  return withAuth<TContext>(async (request, auth, routeContext) => {
    const sync = getStateSync();
    const run = () => handler(request, auth, routeContext);
    if (!sync) return run();
    const isRead = request.method === "GET" || request.method === "HEAD";
    return isRead ? sync.read(run) : sync.write(run);
  });
}
