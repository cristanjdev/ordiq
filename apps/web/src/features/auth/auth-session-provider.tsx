"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import * as React from "react";
import {
  AUTH_BROADCAST_CHANNEL,
  LOGOUT_ENDPOINT,
  SESSION_ENDPOINT,
  type LoginNoticeReason,
} from "@/lib/auth-constants";
import { buildLoginUrl } from "@/lib/auth-redirect";

export interface SessionUser {
  id: string;
  username: string;
  email: string;
  role: "DEAN";
}

interface AuthSessionContextValue {
  user: SessionUser | null;
  /** Ends the session on the server, then signs out every open tab. */
  signOut: () => Promise<void>;
}

const AuthSessionContext = React.createContext<AuthSessionContextValue | null>(
  null,
);

export function useAuthSession(): AuthSessionContextValue {
  const ctx = React.useContext(AuthSessionContext);
  if (!ctx) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider");
  }
  return ctx;
}

/** Cadence for confirming the session (and extending it, if the user was active). */
const HEARTBEAT_INTERVAL_MS = 60_000;
/** Avoid hammering the server when focus/visibility/navigation events cluster. */
const MIN_CHECK_GAP_MS = 5_000;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;

/** Auth endpoints that legitimately return 401 as part of the sign-in flow. */
const UNGUARDED_ENDPOINTS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/totp",
  LOGOUT_ENDPOINT,
]);

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return new URL(raw, window.location.href);
  } catch {
    return null;
  }
}

/**
 * Many views call `fetch` directly. Rather than teach each one about session
 * expiry, any 401 from our own `/api/v1/*` surface (outside the sign-in flow)
 * is treated as "session is gone" and routed to the sign-in screen. The
 * original `fetch` is restored on cleanup.
 */
function installUnauthorizedInterceptor(
  onUnauthorized: (reason: LoginNoticeReason) => void,
): () => void {
  const originalFetch = window.fetch;
  const guardedFetch: typeof window.fetch = async (input, init) => {
    const response = await originalFetch.call(window, input, init);
    if (response.status === 401) {
      const url = requestUrl(input);
      if (
        url &&
        url.origin === window.location.origin &&
        url.pathname.startsWith("/api/v1/") &&
        !UNGUARDED_ENDPOINTS.has(url.pathname)
      ) {
        let reason: LoginNoticeReason = "required";
        try {
          const body = (await response.clone().json()) as {
            error?: { code?: string };
          };
          if (body.error?.code === "SESSION_EXPIRED") reason = "expired";
        } catch {
          // Non-JSON 401: fall back to the generic "sign in required" notice.
        }
        onUnauthorized(reason);
      }
    }
    return response;
  };
  window.fetch = guardedFetch;
  return () => {
    if (window.fetch === guardedFetch) window.fetch = originalFetch;
  };
}

export function AuthSessionProvider({
  initialUser = null,
  children,
}: {
  initialUser?: SessionUser | null;
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const [user, setUser] = React.useState<SessionUser | null>(initialUser);

  const lastActivityAtRef = React.useRef(Date.now());
  const lastSlideAtRef = React.useRef(0);
  const lastCheckAtRef = React.useRef(0);
  const leavingRef = React.useRef(false);
  const channelRef = React.useRef<BroadcastChannel | null>(null);

  const leave = React.useCallback(
    (reason: LoginNoticeReason) => {
      if (leavingRef.current) return;
      leavingRef.current = true;
      // Drop every cached server response so nothing from this session can
      // leak into the next one. A hard navigation also resets all client state.
      queryClient.clear();
      const destination =
        reason === "signed_out"
          ? null
          : `${window.location.pathname}${window.location.search}`;
      window.location.replace(buildLoginUrl({ next: destination, reason }));
    },
    [queryClient],
  );

  const verifySession = React.useCallback(
    async (options: { slide: boolean }) => {
      const now = Date.now();
      lastCheckAtRef.current = now;
      if (options.slide) lastSlideAtRef.current = now;
      try {
        const response = await fetch(
          options.slide ? SESSION_ENDPOINT : `${SESSION_ENDPOINT}?passive=1`,
          { cache: "no-store", headers: { Accept: "application/json" } },
        );
        if (response.ok) {
          const data = (await response.json()) as { user: SessionUser };
          setUser(data.user);
        }
        // A 401 is handled centrally by the fetch interceptor.
      } catch {
        // Transient network failure: keep the page and retry on the next tick.
      }
    },
    [],
  );

  React.useEffect(() => {
    const restoreFetch = installUnauthorizedInterceptor(leave);

    const markActive = () => {
      lastActivityAtRef.current = Date.now();
    };
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, markActive, {
        passive: true,
        capture: true,
      });
    }

    // Only genuine user activity extends the idle window; an unattended open
    // tab merely observes the session and is signed out when it lapses.
    const heartbeat = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void verifySession({
        slide: lastActivityAtRef.current > lastSlideAtRef.current,
      });
    }, HEARTBEAT_INTERVAL_MS);

    const recheck = () => {
      if (document.visibilityState === "hidden") return;
      if (Date.now() - lastCheckAtRef.current < MIN_CHECK_GAP_MS) return;
      void verifySession({ slide: false });
    };
    const onPageShow = (event: PageTransitionEvent) => {
      // Restored from the back/forward cache (e.g. Back after sign-out).
      if (event.persisted) {
        lastCheckAtRef.current = 0;
        recheck();
      }
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", onPageShow);

    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
        if (event.data?.type === "signed_out") leave("signed_out");
      };
      channelRef.current = channel;
    }

    return () => {
      restoreFetch();
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, markActive, { capture: true });
      }
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
      window.removeEventListener("pageshow", onPageShow);
      channel?.close();
      channelRef.current = null;
    };
  }, [leave, verifySession]);

  // Re-validate on every client-side navigation (the route guard only runs on
  // requests; this also catches sessions that lapsed while the page was open).
  React.useEffect(() => {
    const isFirstCheck = lastCheckAtRef.current === 0;
    if (!isFirstCheck && Date.now() - lastCheckAtRef.current < MIN_CHECK_GAP_MS) {
      return;
    }
    void verifySession({ slide: false });
  }, [pathname, verifySession]);

  const signOut = React.useCallback(async () => {
    const response = await fetch(LOGOUT_ENDPOINT, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Sign-out failed with HTTP ${response.status}`);
    }
    channelRef.current?.postMessage({ type: "signed_out" });
    leave("signed_out");
  }, [leave]);

  const value = React.useMemo(() => ({ user, signOut }), [user, signOut]);

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}
